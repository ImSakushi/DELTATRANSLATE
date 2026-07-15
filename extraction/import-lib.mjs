// Bibliothèque d'import : scan du GML décompilé → catalogue id → EN + visages
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Scanner des appels de localisation (port de l'extracteur du sidecar)
// ---------------------------------------------------------------------------
const LOC_CALLS = {
  stringsetloc: { textArg: 0, channel: "string" },
  stringsetsubloc: { textArg: 0, channel: "string" },
  msgsetloc: { textArg: 1, channel: "message" },
  msgsetsubloc: { textArg: 1, channel: "message" },
  msgnextloc: { textArg: 0, channel: "message-next" },
  msgnextsubloc: { textArg: 0, channel: "message-next" },
  c_msgsetloc: { textArg: 1, channel: "cutscene-message" },
  c_msgsetsubloc: { textArg: 1, channel: "cutscene-message" },
  c_msgnextloc: { textArg: 0, channel: "cutscene-next" },
  c_msgnextsubloc: { textArg: 0, channel: "cutscene-next" },
};

const CALL_RE =
  /\b(stringsetloc|stringsetsubloc|msgsetloc|msgsetsubloc|msgnextloc|msgnextsubloc|c_msgsetloc|c_msgsetsubloc|c_msgnextloc|c_msgnextsubloc)\s*\(/g;

const SUBLOC_CALLS = new Set([
  "stringsetsubloc",
  "msgsetsubloc",
  "msgnextsubloc",
  "c_msgsetsubloc",
  "c_msgnextsubloc",
]);

// Découpe les arguments d'un appel à partir de l'index qui suit la parenthèse
// ouvrante. Retourne { args: [{raw, string|null}], end } ou null si malformé.
function parseArgs(text, openIdx) {
  const args = [];
  let depth = 1;
  let cur = "";
  let i = openIdx;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      cur += c;
      if (c === "\\" && i + 1 < text.length) {
        cur += text[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      cur += c;
    } else if (c === "(" || c === "[") {
      depth++;
      cur += c;
    } else if (c === ")" || c === "]") {
      depth--;
      if (depth === 0) {
        args.push(cur.trim());
        return { args: args.map(analyzeArg), end: i };
      }
      cur += c;
    } else if (c === "," && depth === 1) {
      args.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
    i++;
  }
  return null;
}

function analyzeArg(raw) {
  const m = raw.match(/^"((?:[^"\\]|\\.)*)"$/s);
  if (!m) return { raw, string: null };
  // séquences d'échappement du décompilateur GML
  const value = m[1]
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
  return { raw, string: value };
}

// Les wrappers *subloc appellent substringargs() avant de transmettre le texte
// au writer. On résout ici les valeurs déterminables hors partie, notamment le
// motif très fréquent du ch5 qui choisit un retrait différent en japonais.
function resolveStaticSubstitution(arg, lang = "fr") {
  if (arg.string != null) return arg.string;

  // stringset() est un wrapper identité : accepter les branches avec ou sans
  const stringLiteral = '"(?:[^"\\\\]|\\\\.)*"';
  const branch = `(?:stringset\\(\\s*)?(${stringLiteral})\\s*\\)?`;
  const languageTernary = new RegExp(
    `^\\(?\\s*global\\.lang\\s*(==|!=)\\s*(${stringLiteral})\\s*\\)?\\s*\\?\\s*${branch}\\s*:\\s*${branch}\\s*$`,
    "s"
  );
  const match = arg.raw.match(languageTernary);
  if (!match) return null;

  const comparedLang = analyzeArg(match[2]).string;
  const whenTrue = analyzeArg(match[3]).string;
  const whenFalse = analyzeArg(match[4]).string;
  if (comparedLang == null || whenTrue == null || whenFalse == null) return null;

  const condition = match[1] === "==" ? lang === comparedLang : lang !== comparedLang;
  return condition ? whenTrue : whenFalse;
}

// scr_get_input_name hors manette : "[" + global.asc_def[global.input_k[n]] + "]".
// Bindings clavier par défaut : scr_controls_default ; noms : scr_ascii_input_names.
const DEFAULT_KEY_NAMES = {
  0: "[Down]", 1: "[Right]", 2: "[Up]", 3: "[Left]", 4: "[Z]",
  5: "[X]", 6: "[C]", 7: "[Enter]", 8: "[Shift]", 9: "[Control]",
};

// Littéral nu ou enveloppé dans stringset()/stringsetloc() (wrappers identité
// pour la valeur anglaise) → la chaîne, sinon null.
function literalString(expr) {
  const direct = analyzeArg(expr.trim());
  if (direct.string != null) return direct.string;
  const setloc = expr.trim().match(/^stringset(?:loc)?\(\s*("(?:[^"\\]|\\.)*")/);
  return setloc ? analyzeArg(setloc[1]).string : null;
}

// Découpe `cond ? A : B` au premier niveau (hors chaînes et parenthèses).
function splitTernary(expr) {
  let depth = 0;
  let inString = false;
  let question = -1;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "?" && depth === 0) {
      if (question >= 0) return null; // ternaire imbriqué : on passe
      question = i;
    } else if (c === ":" && depth === 0 && question >= 0) {
      return {
        whenTrue: expr.slice(question + 1, i).trim(),
        whenFalse: expr.slice(i + 1).trim(),
      };
    }
  }
  return null;
}

// Valeur d'exemple pour une expression irrésoluble hors partie. Jamais écrite
// dans le fichier de langue : la preview s'en sert pour remplacer ~N par une
// valeur de la même famille que celle que le jeu injecterait (avec avertissement).
// `emotion` : le ~N alimente un tag \E → il faut un unique caractère 0-9/A-Z/a-z.
function sampleExpression(raw, emotion = false) {
  const expr = raw.trim().replace(/;$/, "");
  const inputCall = expr.match(/^scr_get_input_name\(\s*(\d)\s*\)$/);
  if (inputCall) return DEFAULT_KEY_NAMES[inputCall[1]] ?? "[?]";
  if (/^global\.l?charname\b/.test(expr)) return "Susie";
  if (/^global\.(?:name|truename)\b/.test(expr)) return "Kris";
  if (/^global\.monstername\b/.test(expr)) return "Leafling";
  if (/^(?:global\.l?)?(?:item|weapon|armor)name\b/i.test(expr)) return "Dark Candy";
  if (
    /^(?:string|real|floor|ceil|round|abs)\s*\(/.test(expr) ||
    /^global\.(?:flag|l(?:hp|maxhp|lv|gold|xp|at|df))\b/.test(expr) ||
    /^-?\d+(?:\.\d+)?$/.test(expr)
  ) {
    return emotion ? "0" : "12";
  }
  if (/^choose\(/.test(expr)) {
    const parsed = parseArgs(expr, "choose(".length);
    const first = parsed?.args?.[0];
    if (first) return first.string ?? literalString(first.raw);
  }
  const ternary = splitTernary(expr);
  if (ternary) return literalString(ternary.whenTrue) ?? literalString(ternary.whenFalse);
  // noms de variables clairement numériques (cost, moneyamt, foxes_counted…)
  if (
    /^[\w.\[\]]+$/.test(expr) &&
    /(?:cost|price|amount|amt|count(?:ed)?|bonus|coins?|gold|exp|hp|lv|level|slot|total|num|crown)(?:$|_)/i.test(expr)
  ) {
    return emotion ? "0" : "12";
  }
  // arithmétique simple sans chaîne (MENUCOORD[10] + 1, 4 - gardencount…)
  if (!expr.includes('"') && /^[\w.\[\]\s()]+[+\-*/]\s*[\w.\[\]\s()]+$/.test(expr) && /\d/.test(expr)) {
    return emotion ? "0" : "12";
  }
  return null;
}

// Remonte la dernière assignation d'une variable locale au-dessus de l'appel
// (cas `var timestring = string(sec)` ou `var s = stringsetloc(...)`).
function sampleFromAssignment(lines, lineIdx, name, emotion) {
  const assignRe = new RegExp(
    `(?:\\bvar\\s+)?\\b${name}\\s*(?<![=!<>+\\-*/])=(?!=)\\s*(.+?);?\\s*$`
  );
  for (let i = lineIdx; i >= Math.max(0, lineIdx - 80); i--) {
    const m = lines[i].match(assignRe);
    if (!m) continue;
    const expr = m[1].trim().replace(/;$/, "");
    const literal = literalString(expr);
    if (literal != null) return literal;
    return sampleExpression(expr, emotion);
  }
  return null;
}

function sampleSubstitution(arg, lines, lineIdx, emotion) {
  const direct = sampleExpression(arg.raw, emotion);
  if (direct != null) return direct;
  if (!lines) return null;
  const raw = arg.raw.trim();
  const name = raw.match(/^[A-Za-z_]\w*$/);
  if (name) return sampleFromAssignment(lines, lineIdx, name[0], emotion);
  // élément de tableau (face[hatState]) : une assignation d'élément ou de
  // tableau littéral (`face = ["8", "2"]`) fournit une valeur de la bonne famille
  const indexed = raw.match(/^([A-Za-z_]\w*)\[[^\]]+\]$/);
  if (indexed) {
    const element = sampleFromAssignment(lines, lineIdx, `${indexed[1]}\\[[^\\]]*\\]`, emotion);
    if (element != null) return element;
    const arrayRe = new RegExp(`(?:\\bvar\\s+)?\\b${indexed[1]}\\s*=\\s*\\[(.+)\\]\\s*;?\\s*$`);
    for (let i = lineIdx; i >= Math.max(0, lineIdx - 80); i--) {
      const m = lines[i].match(arrayRe);
      if (!m) continue;
      const first = parseArgs(`${m[1]})`, 0)?.args?.[0];
      return first ? first.string ?? literalString(first.raw) : null;
    }
  }
  return null;
}

export function scanCatalog(codeDir, log = () => {}) {
  const files = fs.readdirSync(codeDir).filter((f) => f.endsWith(".gml"));
  const entries = [];
  let scanned = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(codeDir, file), "utf8");
    let fileLines = null;
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(text))) {
      const spec = LOC_CALLS[m[1]];
      const parsed = parseArgs(text, m.index + m[0].length);
      if (!parsed || parsed.args.length < 2) continue;
      const textArg = parsed.args[spec.textArg];
      const idArg = parsed.args[parsed.args.length - 1];
      if (!textArg || textArg.string == null || !idArg || idArg.string == null) continue;
      const entry = {
        id: idArg.string,
        english: textArg.string,
        call: m[1],
        channel: spec.channel,
        file,
        line: text.slice(0, m.index).split("\n").length,
      };
      if (SUBLOC_CALLS.has(m[1])) {
        const argSpecs = parsed.args.slice(spec.textArg + 1, -1);
        entry.substitutions = argSpecs.map((arg) => resolveStaticSubstitution(arg));
        const samples = argSpecs.map((arg, i) => {
          if (entry.substitutions[i] != null) return null;
          fileLines ??= text.split(/\r?\n/);
          const emotion = new RegExp(`\\\\E~${i + 1}\\b`).test(entry.english);
          return sampleSubstitution(arg, fileLines, entry.line - 1, emotion);
        });
        if (samples.some((s) => s != null)) entry.substitutionSamples = samples;
      }
      entries.push(entry);
    }
    if (++scanned % 2000 === 0) log(`  scan GML : ${scanned}/${files.length}`);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Détection du visage actif au-dessus d'un site d'appel
// ---------------------------------------------------------------------------
// Mapping speaker → fc, complété depuis scr_anyface + scr_speaker.
// 0 = « pose explicitement aucun visage » (voix seule) — on s'arrête quand même.
const SPEAKER_FC = {
  susie: 1, sus: 1,
  ralsei: 2, ral: 2,
  noelle: 3, noe: 3,
  toriel: 4, tor: 4,
  lancer: 5, lan: 5,
  sans: 6, san: 6,
  undyne: 9, und: 9,
  asgore: 10, asg: 10,
  alphys: 11, alp: 11, alph: 11,
  berdly: 12, ber: 12,
  catti: 13,
  jockington: 14, joc: 14, jock: 14,
  rudy: 15, rud: 15,
  catty: 16, caddy: 16,
  bratty: 17, bra: 17,
  rouxls: 18, rou: 18, rurus: 18,
  burgerpants: 19, bur: 19,
  king: 20, kin: 20,
  queen: 21, que: 21,
  carol: 22,
  flowery: 23,
  flowery_s: 23,
  bluef: 25,
  // voix sans portrait
  queen2: 0, que2: 0,
  flowery_noface: 0,
  sneo: 0,
  jackenstein: 0,
  tenna: 0,
  aqua: 0,
  seth: 0, purple: 0,
  yellow: 0, orange: 0, blue: 0, green: 0, pink: 0,
  opuppet: 0,
  none: 0, x: 0, no_name: 0, "no name": 0, silent: 0,
};

// Typers dont la couleur ou la police diffère du writer sombre par défaut.
// scr_speaker et scr_anyface(_next) utilisent les mêmes valeurs via les tags
// \T4…\T9 ; les conserver dans la référence est indispensable quand le tag est
// injecté par c_speaker/c_facenext et n'apparaît donc pas dans la chaîne traduite.
const SPEAKER_TYPER = {
  jackenstein: 83,
  tenna: 84,
  flowery_s: 86,
  flowery: 88,
  flowery_noface: 88,
  aqua: 90,
  seth: 91,
  purple: 91,
  yellow: 92,
  orange: 93,
  blue: 94,
  bluef: 94,
  green: 95,
  pink: 97,
  opuppet: 98,
};

// \Fx → fc (obj_writer_Draw_0), pour les tags inline dans les textes
const F_TAG_FC = {
  "0": 0, S: 1, R: 2, N: 3, T: 4, L: 5, s: 6, U: 9, A: 10, a: 11,
  B: 12, b: 19, r: 15, u: 18, K: 20, Q: 21, C: 22, F: 23, f: 24,
  J: 14, y: 17, i: 13, k: 16, "◘": 25,
};

const FACE_FN_FC = {
  scr_susface: 1,
  scr_ralface: 2,
  scr_noeface: 3,
  scr_torface: 4,
  scr_lanface: 5,
  scr_sansface: 6,
  scr_undface: 9,
  scr_asgface: 10,
  scr_alphface: 11,
  scr_berface: 12,
  scr_rudface: 15,
  scr_ruface: 18,
  scr_kingface: 20,
  scr_queenface: 21,
  scr_carolface: 22,
};

function decodeEmotion(raw) {
  if (raw == null) return 0;
  const t = String(raw).trim().replace(/^["']|["']$/g, "");
  if (/^-?\d+$/.test(t)) return Math.max(0, parseInt(t, 10));
  if (t.length === 1) {
    const c = t.charCodeAt(0);
    if (c >= 48 && c <= 57) return c - 48;
    if (c >= 65 && c <= 90) return c - 55;
    if (c >= 97 && c <= 122) return c - 61;
  }
  return null; // expression dynamique
}

// Certaines scènes remplacent la banque de portraits sans changer fc/fe.
// obj_face Draw_0 : Noelle utilise spr_face_n_matome_extended quand
// global.tempflag[63] vaut 1 ; obj_ch5_LW20 alimente ce flag via face_extended.
function findFaceVariant(lines, lineIdx, fc) {
  if (fc !== 3) return null;
  for (let i = lineIdx; i >= 0; i--) {
    const m = lines[i].match(
      /c_var_instance\(\s*id\s*,\s*["']face_extended["']\s*,\s*([01])\s*\)/
    );
    if (m) return m[1] === "1" ? "noelle-extended" : null;
  }
  return null;
}

function withFaceVariant(lines, lineIdx, face) {
  const variant = findFaceVariant(lines, lineIdx, face.fc);
  return variant ? { ...face, variant } : face;
}

function staticSmallFaceArg(arg) {
  if (!arg) return null;
  if (arg.string != null) return arg.string;
  const raw = arg.raw.trim();
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
}

// scr_smallface prépare un portrait secondaire qui sera créé plus tard par un
// tag \f0…\f9 du writer. La chaîne localisée peut être passée directement ou
// stockée dans une variable juste avant l'appel.
function findSmallFace(lines, lineIdx, id) {
  const localizedLine = lines[lineIdx] ?? "";
  const assignment = localizedLine.match(
    /(?:\bvar\s+)?([A-Za-z_]\w*)\s*=\s*(?:stringsetloc|stringsetsubloc)\s*\(/
  );
  const variable = assignment?.[1] ?? null;

  for (let i = lineIdx; i <= Math.min(lines.length - 1, lineIdx + 8); i++) {
    const line = lines[i];
    let from = 0;
    while (from < line.length) {
      const call = line.indexOf("scr_smallface(", from);
      if (call < 0) break;
      const parsed = parseArgs(line, call + "scr_smallface(".length);
      from = call + "scr_smallface(".length;
      if (!parsed || parsed.args.length < 6) continue;

      const textArg = parsed.args[5];
      const usesLocalizedText =
        (i === lineIdx && line.includes(`"${id}"`)) ||
        (variable && textArg.raw.trim() === variable);
      if (!usesLocalizedText) continue;

      const [slotArg, speakerArg, expressionArg, xArg, yArg] = parsed.args;
      const slot = staticSmallFaceArg(slotArg);
      const speaker = staticSmallFaceArg(speakerArg);
      const expression = staticSmallFaceArg(expressionArg);
      const x = staticSmallFaceArg(xArg);
      const y = staticSmallFaceArg(yArg);
      if (slot == null || speaker == null || expression == null || x == null || y == null)
        return null;
      return { slot, speaker, expression, x, y, callLine: i + 1 };
    }
  }
  return null;
}

// Cherche le visage actif pour la ligne `lineIdx` (0-based) en remontant.
// Le visage persiste de message en message jusqu'à changement explicite,
// d'où une fenêtre de scan large. Le plus proche match gagne.
function findFace(lines, lineIdx) {
  const from = Math.max(0, lineIdx - 120);
  let pendingFe = null; // dernier global.fe rencontré en remontant
  for (let i = lineIdx; i >= from; i--) {
    const l = lines[i];

    // Cutscenes qui règlent le writer directement : global.fc = 2 / global.fe = 1
    let m = l.match(/global\.fe\s*=\s*(\d+)/);
    if (m && i !== lineIdx && pendingFe == null) pendingFe = Number(m[1]);
    m = l.match(/global\.fc\s*=\s*(\d+)/);
    if (m && i !== lineIdx) {
      const fc = Number(m[1]);
      return fc === 0 ? null : withFaceVariant(lines, lineIdx, { fc, fe: pendingFe ?? 0 });
    }

    // c_facenext("susie", "C") / c_face / c_msgface — le plus courant en cutscene
    m = l.match(/c_(?:facenext|face|msgface)\(\s*"([\w ]+)"\s*,\s*([^,)]+)/);
    if (m) {
      const fc = SPEAKER_FC[m[1].toLowerCase()];
      if (fc !== undefined)
        return fc === 0
          ? null
          : withFaceVariant(lines, lineIdx, { fc, fe: decodeEmotion(m[2]) ?? 0 });
    }
    // scr_anyface_next("susie", emotion)
    m = l.match(/scr_anyface_next\(\s*"([\w ]+)"\s*,\s*([^,)]+)\s*\)/);
    if (m) {
      const fc = SPEAKER_FC[m[1].toLowerCase()];
      if (fc !== undefined)
        return fc === 0
          ? null
          : withFaceVariant(lines, lineIdx, { fc, fe: decodeEmotion(m[2]) ?? 0 });
    }
    // scr_anyface("susie", msgno, emotion)
    m = l.match(/scr_anyface\(\s*"([\w ]+)"\s*,\s*[^,]+,\s*([^,)]+)\s*\)/);
    if (m) {
      const fc = SPEAKER_FC[m[1].toLowerCase()];
      if (fc !== undefined)
        return fc === 0
          ? null
          : withFaceVariant(lines, lineIdx, { fc, fe: decodeEmotion(m[2]) ?? 0 });
    }
    // scr_susface(msgno, emotion) et variantes dédiées
    m = l.match(/(scr_\w*face)\(\s*[^,)]+(?:,\s*([^,)]+))?\)/);
    if (m && FACE_FN_FC[m[1]]) {
      return withFaceVariant(lines, lineIdx, {
        fc: FACE_FN_FC[m[1]],
        fe: decodeEmotion(m[2]) ?? 0,
      });
    }
    // c_speaker("susie") / scr_speaker : remet fc à 0 puis pose le visage du
    // personnage (scr_speaker : susie→1, ralsei→2, noelle→3, queen→21, etc.)
    m = l.match(/(?:c_speaker|scr_speaker)\(\s*"([\w ]+)"/);
    if (m && i !== lineIdx) {
      const fc = SPEAKER_FC[m[1].toLowerCase()];
      return fc ? withFaceVariant(lines, lineIdx, { fc, fe: 0 }) : null;
    }
    // tags \Fx inline dans un texte au-dessus (le dernier de la ligne gagne)
    if (i !== lineIdx) {
      const fTags = [...l.matchAll(/\\\\F(.)/g)];
      if (fTags.length) {
        const ch = fTags[fTags.length - 1][1];
        if (ch in F_TAG_FC) {
          const fc = F_TAG_FC[ch];
          if (fc === 0) return null;
          const eTags = [...l.matchAll(/\\\\E(.)/g)];
          const fe = eTags.length
            ? decodeEmotion(eTags[eTags.length - 1][1]) ?? 0
            : 0;
          return withFaceVariant(lines, lineIdx, { fc, fe });
        }
      }
    }
  }
  return null;
}

// Même remontée que findFace, mais uniquement pour les typers qui changent
// visiblement le rendu. Les commandes de cutscene injectent leur \T hors de la
// chaîne localisée ; sans cette métadonnée la preview retomberait sur du blanc.
function findTyper(lines, lineIdx, ownerTyper = null) {
  const from = Math.max(0, lineIdx - 120);
  for (let i = lineIdx; i >= from; i--) {
    const line = lines[i];
    const speakers = [
      ...line.matchAll(
        /(?:c_(?:facenext|face|msgface|speaker)|scr_(?:anyface_next|anyface|speaker))\(\s*"([\w ]+)"/g
      ),
    ];
    if (speakers.length) {
      const speaker = speakers[speakers.length - 1][1].toLowerCase();
      return SPEAKER_TYPER[speaker] ?? null;
    }

    const typerAssignments = [...line.matchAll(/global\.typer\s*=\s*(\d+)/g)];
    if (typerAssignments.length) return Number(typerAssignments.at(-1)[1]);
  }
  return ownerTyper;
}

// Certaines interfaces créent le writer dans Draw/Step alors que leur typer
// est initialisé dans Create. Cette valeur appartient à l'objet, tous événements
// confondus, et sert uniquement de repli après la recherche locale ci-dessus.
function findOwnerTypers(codeDir) {
  const typers = new Map();
  for (const file of fs.readdirSync(codeDir).filter((name) => /_Create_\d+\.gml$/.test(name))) {
    const source = fs.readFileSync(path.join(codeDir, file), "utf8");
    const assignments = [...source.matchAll(/global\.typer\s*=\s*(\d+)/g)];
    if (assignments.length) typers.set(codeOwner(file), Number(assignments.at(-1)[1]));
  }
  return typers;
}

function assignedNumber(lines, lineIdx, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`);
  for (let i = lineIdx; i >= Math.max(0, lineIdx - 120); i--) {
    const match = lines[i].match(re);
    if (!match) continue;
    // La preview est française : ignorer les overrides contenus dans le petit
    // bloc `if (global.lang == "ja")` qui suit souvent la valeur par défaut.
    let japaneseOnly = false;
    for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
      if (/^\s*}\s*$/.test(lines[j])) break;
      if (/if\s*\(\s*global\.lang\s*==\s*["']ja["']\s*\)/.test(lines[j])) {
        japaneseOnly = true;
        break;
      }
    }
    if (!japaneseOnly) return Number(match[1]);
  }
  return null;
}

function staticDeviceCoordinate(raw, lines, lineIdx) {
  let expression = raw.trim();
  const langopt = expression.match(/^langopt\(\s*(-?\d+(?:\.\d+)?)\s*,/);
  if (langopt) return Number(langopt[1]); // langopt : le premier argument hors japonais
  if (/^-?\d+(?:\.\d+)?$/.test(expression)) return Number(expression);

  let total = 0;
  let found = false;
  for (const term of expression.matchAll(/(^|[+-])\s*(-?\d+(?:\.\d+)?|[A-Za-z_]\w*)/g)) {
    const sign = term[1] === "-" ? -1 : 1;
    const token = term[2];
    const value = /^-?\d/.test(token) ? Number(token) : assignedNumber(lines, lineIdx, token);
    if (value == null) return null;
    total += sign * value;
    found = true;
  }
  return found ? total : null;
}

function findDeviceWriter(lines, lineIdx) {
  const context = lines[lineIdx] ?? "";
  if (!/global\.msg\s*\[|\b(?:msgset|msgnext)(?:sub)?loc\s*\(/.test(context)) return null;

  for (let i = lineIdx; i <= Math.min(lines.length - 1, lineIdx + 40); i++) {
    let from = 0;
    while (from < lines[i].length) {
      const call = lines[i].indexOf("instance_create(", from);
      if (call < 0) break;
      const parsed = parseArgs(lines[i], call + "instance_create(".length);
      from = call + "instance_create(".length;
      if (!parsed || parsed.args.length < 3) continue;
      if (parsed.args.at(-1).raw.trim() !== "obj_writer") continue;
      const x = staticDeviceCoordinate(parsed.args[0].raw, lines, i);
      const y = staticDeviceCoordinate(parsed.args[1].raw, lines, i);
      if (x == null || y == null) return null;

      let hspaceScale = 1;
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 12); j++) {
        const scale = lines[j].match(/\bhspace\s*\*=\s*(-?\d+(?:\.\d+)?)/);
        if (scale) {
          hspaceScale = Number(scale[1]);
          break;
        }
      }
      return { x, y, ...(hspaceScale !== 1 ? { hspaceScale } : {}) };
    }
  }
  return null;
}

function findDeviceVessel(lines, lineIdx) {
  let vessel = null;
  for (let i = 0; i <= lineIdx; i++) {
    const creation = lines[i].match(
      /\bGM\s*=\s*instance_create\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*DEVICE_GONERMAKER\s*\)/
    );
    if (creation) {
      const x = staticDeviceCoordinate(creation[1], lines, i);
      const y = staticDeviceCoordinate(creation[2], lines, i);
      vessel = x == null || y == null ? null : { x, y, steps: 1 };
    }
    const steps = lines[i].match(/\bGM\.STEP\s*=\s*(\d+)/);
    if (steps && vessel) vessel.steps = Number(steps[1]);
  }
  return vessel;
}

function findDeviceStyle(entry, lines, lineIdx, typer) {
  if (typer !== 666 && typer !== 667) return null;
  const writer = findDeviceWriter(lines, lineIdx);
  if (!writer) return null;
  const owner = codeOwner(entry.file);
  const contact = /DEVICE_(?:CONTACT|NAMER)/i.test(owner);
  const vessel = /DEVICE_CONTACT/i.test(owner) ? findDeviceVessel(lines, lineIdx) : null;
  return {
    ...writer,
    background: contact ? "contact" : "failure",
    ...(vessel ? { vessel } : {}),
  };
}

// Mad Mew Mew n'utilise pas obj_face : obj_pinkspeaker est une grande instance
// de scène ancrée au bord droit de la caméra. On repère les propriétaires qui
// la créent afin de ne pas confondre les autres usages du typer rose (97).
function findPinkSpeakerOwners(codeDir) {
  const owners = new Map();
  for (const file of fs.readdirSync(codeDir).filter((name) => name.endsWith(".gml"))) {
    const source = fs.readFileSync(path.join(codeDir, file), "utf8");
    const creations = [
      ...source.matchAll(
        /\b([A-Za-z_]\w*)\s*=\s*instance_create(?:_depth)?\([^;]*\bobj_pinkspeaker\s*\)/g
      ),
    ];
    if (!creations.length) continue;

    const owner = codeOwner(file);
    const spec = owners.get(owner) ?? { variables: new Set(), defaultVisible: true };
    for (const creation of creations) {
      const variable = creation[1];
      spec.variables.add(variable);
      const after = source.slice(creation.index + creation[0].length, creation.index + creation[0].length + 400);
      if (new RegExp(`\\b${variable}\\.visible\\s*=\\s*false\\b`).test(after)) {
        spec.defaultVisible = false;
      }
    }
    owners.set(owner, spec);
  }
  return owners;
}

function pinkSpeakerBool(line, variables, property) {
  const names = [...variables].join("|");
  if (!names) return null;
  const direct = line.match(
    new RegExp(`\\b(?:${names})\\.${property}\\s*=\\s*(true|false)\\b`)
  );
  if (direct) return direct[1] === "true";

  const command = line.match(
    new RegExp(
      `\\bc_(?:var_instance|msgvar_instance)\\(\\s*(?:${names})\\s*,\\s*["']${property}["']\\s*,\\s*(true|false)\\b`
    )
  );
  if (command) return command[1] === "true";

  const delayed = line.match(
    new RegExp(
      `\\bc_delaycmd\\([^;]*?["']var["']\\s*,\\s*(?:${names})\\s*,\\s*["']${property}["']\\s*,\\s*(true|false)\\b`
    )
  );
  return delayed ? delayed[1] === "true" : null;
}

function findPinkSpeakerExpression(entry, lines, lineIdx) {
  const current = [...resolvedLocalizedText(entry).matchAll(/\\E(.)/g)];
  if (current.length) return decodeEmotion(current.at(-1)[1]) ?? 0;
  for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 120); i--) {
    const tags = [...lines[i].matchAll(/\\\\E(.)/g)];
    if (tags.length) return decodeEmotion(tags.at(-1)[1]) ?? 0;
    if (/(?:c_speaker|scr_speaker)\s*\(/.test(lines[i])) break;
  }
  return 0;
}

function findPinkSpeakerOverlay(entry, lines, lineIdx, typer, owners) {
  if (typer !== 97 || entry.channel === "string") return null;
  const owner = owners.get(codeOwner(entry.file));
  if (!owner) return null;

  let visible = owner.defaultVisible;
  let sweat = false;
  for (let i = 0; i <= lineIdx; i++) {
    const visibleValue = pinkSpeakerBool(lines[i], owner.variables, "visible");
    if (visibleValue != null) visible = visibleValue;
    const sweatValue = pinkSpeakerBool(lines[i], owner.variables, "sweat");
    if (sweatValue != null) sweat = sweatValue;
  }

  // c_msgvar_instance placé juste après c_msgset s'applique au message qui
  // vient d'être créé. On le prend avant le prochain appel localisé.
  for (let i = lineIdx + 1; i <= Math.min(lines.length - 1, lineIdx + 5); i++) {
    if (/\b(?:stringset|msgset|msgnext|c_msg)/.test(lines[i])) break;
    const sweatValue = pinkSpeakerBool(lines[i], owner.variables, "sweat");
    if (sweatValue != null) sweat = sweatValue;
  }

  if (!visible) return null;
  return {
    kind: "pinkspeaker",
    expression: findPinkSpeakerExpression(entry, lines, lineIdx),
    ...(sweat ? { sweat: true } : {}),
  };
}

function resolvedLocalizedText(entry) {
  let text = entry.english ?? entry.en ?? "";
  for (let i = 0; i < (entry.substitutions?.length ?? 0); i++) {
    const value = entry.substitutions[i];
    if (typeof value === "string") text = text.replaceAll(`~${i + 1}`, value);
  }
  return text;
}

function findMiniFaceBanks(codeDir) {
  const byOwner = new Map();
  for (const file of fs.readdirSync(codeDir).filter((name) => name.endsWith(".gml"))) {
    const source = fs.readFileSync(path.join(codeDir, file), "utf8");
    const banks = [...source.matchAll(/\bscr_miniface_init_([A-Za-z0-9_]+)\s*\(\s*\)/g)];
    if (!banks.length || file.startsWith("gml_GlobalScript_scr_miniface_init_")) continue;
    const owner = codeOwner(file);
    if (!byOwner.has(owner)) byOwner.set(owner, new Set());
    for (const match of banks) byOwner.get(owner).add(match[1]);
  }
  return byOwner;
}

// global.writerimg est une banque mutable. On prend d'abord le dernier init
// exécuté plus haut dans le même événement, puis l'init unique de l'objet (cas
// du shop musical : init dans Create, textes dans Draw).
function findMiniFaceBank(file, lines, lineIdx, ownerBanks) {
  for (let i = lineIdx; i >= 0; i--) {
    const matches = [...lines[i].matchAll(/\bscr_miniface_init_([A-Za-z0-9_]+)\s*\(/g)];
    if (matches.length) return matches.at(-1)[1];
  }
  const banks = ownerBanks.get(codeOwner(file));
  return banks?.size === 1 ? [...banks][0] : null;
}

function inferMiniFaceBank(file, lines, lineIdx, ownerBanks, typer) {
  const initialized = findMiniFaceBank(file, lines, lineIdx, ownerBanks);
  if (initialized) return initialized;
  // Les typers 90–95 sont les six fleurs et 98 leur marionnette orange.
  // Dans leurs scripts de combat, la banque flowers est initialisée par le
  // contrôleur de scène plutôt que par l'objet qui contient le texte.
  return (typer >= 90 && typer <= 95) || typer === 98 ? "flowers" : null;
}

function codeOwner(file) {
  return file
    .replace(/\.gml$/, "")
    .replace(/_(?:Create|Step|Draw|Other|Alarm|Destroy|CleanUp|PreCreate)_\d+$/, "");
}

function startsWithWriterAsterisk(text) {
  return String(text).replace(/^(?:\\..|\^[0-9]|[|&]|\s)*/, "").startsWith("*");
}

// `/` (attend) et `%` (fin) sont des codes de flux du writer : une chaîne qui
// se termine ainsi est un message de textbox, pas un libellé de menu. Un code
// de flux est collé au texte : précédé d'un espace c'est un caractère littéral
// (« Numpad / ») ; précédé d'un chiffre, `%` est un vrai pourcentage.
function endsWithWriterClose(text) {
  const s = String(text).trimEnd();
  const m = s.match(/(\/%|%%|\/|%)$/);
  if (!m) return false;
  const before = s[s.length - m[1].length - 1];
  if (before === " ") return false;
  if (m[1] === "%" && /\d/.test(before ?? "")) return false;
  return true;
}

function isLargeShopDialogue(file, text) {
  const source = String(text);
  return (
    /gml_Object_obj_shop\w*_(?:Create|Draw|Other)_\d+/.test(file) &&
    /(?:\/%|[/%])$/.test(source) &&
    startsWithWriterAsterisk(source)
  );
}

// Un texte peut être déclaré dans Create et envoyé à scr_battletext depuis
// Step. On raisonne donc par propriétaire d'objet, tous événements confondus.
function findBattleTextOwners(codeDir) {
  const owners = new Set();
  for (const file of fs.readdirSync(codeDir).filter((name) => name.endsWith(".gml"))) {
    const source = fs.readFileSync(path.join(codeDir, file), "utf8");
    if (/\bscr_battletext(?:_default)?\s*\(/.test(source)) owners.add(codeOwner(file));
  }
  return owners;
}

function inferPreviewMode(file, text, battleTextOwners, contextLine = "", channel = null) {
  const cleanFile = file.replace(/\.gml$/, "");
  if (isLargeShopDialogue(cleanFile, text)) return "shop";
  // c_msgsetloc/c_msgnextloc passent par la file de cinématique puis par
  // obj_dialoguer : même dans un objet qui contient aussi un combat, ce ne
  // sont jamais les lignes du panneau de combat du bas.
  if (String(channel ?? "").startsWith("cutscene-")) return null;
  const inBattleOwner =
    battleTextOwners.has(codeOwner(cleanFile)) ||
    /scr_encountersetup|obj_battlecontroller/.test(cleanFile);
  if (startsWithWriterAsterisk(text) && inBattleOwner) return "battletext";
  if (channel !== "string") return null;
  // Les stringsetloc qui alimentent la file du writer sont des dialogues, pas
  // des libellés : global.battlemsg[] → recopié dans global.msg[0] par
  // obj_battlecontroller (texte de combat du bas), global.msg[]/msgset →
  // obj_dialoguer, global.choicemsg[] → scr_readychoicer (choix rendus dans la
  // textbox). Chez un battle owner, global.msg sert aussi aux bulles
  // (msgset + scr_enemyblcon) : on laisse l'heuristique bubble/battletext de
  // l'app trancher (astérisque).
  if (/global\.battlemsg\s*\[/.test(contextLine)) return "battletext";
  // En contexte de combat (même hors battleTextOwner : managers d'attaque,
  // cutscenes de boss…), global.msg et les variables intermédiaires peuvent
  // alimenter des bulles (obj_battleblcon) : on laisse l'heuristique
  // bubble/battletext de l'app trancher.
  if (inBattleOwner || /enemy|battle|blcon|_attack|encounter|boss|trashy_trio/i.test(cleanFile))
    return null;
  if (/\bmsg\s*\[[^\]]*\]\s*=/.test(contextLine) || /\bmsgset\s*\(/.test(contextLine))
    return "darkbox";
  if (/global\.choicemsg\s*\[/.test(contextLine) || /\bscr_readychoicer\s*\(/.test(contextLine))
    return "darkbox";
  // Variables intermédiaires (ex. _dialogue[i], transmises à msgset plus bas) :
  // la terminaison writer signe un message de textbox.
  if (endsWithWriterClose(text)) return "darkbox";
  return null;
}

// ---------------------------------------------------------------------------
// Construit reference.json à partir du dossier CodeEntries
// ---------------------------------------------------------------------------
export function buildReference(codeDir, log = () => {}) {
  const entries = scanCatalog(codeDir, log);
  const battleTextOwners = findBattleTextOwners(codeDir);
  const miniFaceBanks = findMiniFaceBanks(codeDir);
  const pinkSpeakerOwners = findPinkSpeakerOwners(codeDir);
  const ownerTypers = findOwnerTypers(codeDir);
  log(`  ${entries.length} appels localisés trouvés`);
  const entriesByFile = new Map();
  for (const entry of entries) {
    if (!entriesByFile.has(entry.file)) entriesByFile.set(entry.file, []);
    entriesByFile.get(entry.file).push(entry);
  }
  const fileCache = new Map();
  const getLines = (file) => {
    if (!fileCache.has(file)) {
      try {
        fileCache.set(
          file,
          fs.readFileSync(path.join(codeDir, file), "utf8").split(/\r?\n/)
        );
      } catch {
        fileCache.set(file, null);
      }
    }
    return fileCache.get(file);
  };

  const ref = {};
  let faceCount = 0;
  let smallFaceCount = 0;
  let linkedSmallFaceCount = 0;
  for (const e of entries) {
    if (ref[e.id]) continue;
    const entry = {
      en: e.english,
      call: e.call,
      channel: e.channel,
      file: e.file.replace(/\.gml$/, ""),
      line: e.line,
    };
    const lines = getLines(e.file);
    const contextLine = lines?.[e.line - 1] ?? "";
    const previewMode = inferPreviewMode(
      e.file,
      e.english,
      battleTextOwners,
      contextLine,
      e.channel
    );
    if (previewMode) entry.previewMode = previewMode;
    if (e.substitutions?.length) entry.substitutions = e.substitutions;
    if (e.substitutionSamples?.length) entry.substitutionSamples = e.substitutionSamples;
    if (lines) {
      const typer = findTyper(lines, e.line - 1, ownerTypers.get(codeOwner(e.file)) ?? null);
      if (typer != null) entry.typer = typer;
      const deviceStyle = findDeviceStyle(e, lines, e.line - 1, typer);
      if (deviceStyle) {
        entry.previewMode = "device";
        entry.deviceStyle = deviceStyle;
      }
      const speakerOverlay = findPinkSpeakerOverlay(
        e,
        lines,
        e.line - 1,
        typer,
        pinkSpeakerOwners
      );
      if (speakerOverlay) entry.speakerOverlay = speakerOverlay;
      if (/\\m\d/.test(resolvedLocalizedText(e))) {
        const miniFaceBank = inferMiniFaceBank(
          e.file,
          lines,
          e.line - 1,
          miniFaceBanks,
          typer
        );
        if (miniFaceBank) entry.miniFaceBank = miniFaceBank;
      }
      const smallFace = findSmallFace(lines, e.line - 1, e.id);
      if (smallFace) {
        const triggerTag = `\\f${smallFace.slot}`;
        const trigger = (entriesByFile.get(e.file) ?? []).find(
          (candidate) =>
            candidate.line >= smallFace.callLine &&
            candidate.line <= smallFace.callLine + 80 &&
            candidate.channel !== "string" &&
            candidate.english.includes(triggerTag)
        );
        entry.smallFace = {
          slot: smallFace.slot,
          speaker: smallFace.speaker,
          expression: smallFace.expression,
          x: smallFace.x,
          y: smallFace.y,
          ...(trigger ? { dialogueKey: trigger.id } : {}),
        };
        smallFaceCount++;
        if (trigger) linkedSmallFaceCount++;
      }
    }
    // Les strings requalifiées en dialogue (global.msg[]…) ont un visage actif
    // au même titre que les canaux message.
    const isDialogue =
      e.channel !== "string" ||
      entry.previewMode === "darkbox" ||
      entry.previewMode === "device" ||
      entry.previewMode === "battletext";
    if (isDialogue) {
      if (lines) {
        const face = findFace(lines, e.line - 1);
        if (face) {
          entry.face = face;
          faceCount++;
        }
      }
    }
    ref[e.id] = entry;
  }
  log(
    `  ${Object.keys(ref).length} ids uniques, ${faceCount} visages détectés, ` +
      `${smallFaceCount} textes secondaires (${linkedSmallFaceCount} reliés)`
  );
  return ref;
}

// ---------------------------------------------------------------------------
// Anciens chapitres (1/2) : pas d'anglais inline — le code appelle
// scr_84_get_lang_string("id") et l'anglais vit dans lang_en.json.
// On construit la référence depuis ce json + un scan du code pour retrouver
// fichier/ligne (et détecter le visage actif).
// ---------------------------------------------------------------------------
export function buildReferenceFromLangJson(codeDir, enJson, log = () => {}) {
  const ids = new Set(Object.keys(enJson).filter((k) => k !== "date"));
  const files = fs.readdirSync(codeDir).filter((f) => f.endsWith(".gml"));
  const battleTextOwners = findBattleTextOwners(codeDir);
  const miniFaceBanks = findMiniFaceBanks(codeDir);
  const pinkSpeakerOwners = findPinkSpeakerOwners(codeDir);
  const ownerTypers = findOwnerTypers(codeDir);
  const sites = new Map(); // id → {file, line, context}
  const STR_RE = /"((?:[^"\\]|\\.)+)"/g;
  let scanned = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(codeDir, file), "utf8");
    STR_RE.lastIndex = 0;
    let m;
    while ((m = STR_RE.exec(text))) {
      const s = m[1];
      if (!ids.has(s) || sites.has(s)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      sites.set(s, { file, line });
    }
    if (++scanned % 500 === 0) log(`  scan GML : ${scanned}/${files.length}`);
  }
  log(`  ${sites.size}/${ids.size} ids localisés dans le code`);

  const fileCache = new Map();
  const getLines = (file) => {
    if (!fileCache.has(file)) {
      try {
        fileCache.set(
          file,
          fs.readFileSync(path.join(codeDir, file), "utf8").split(/\r?\n/)
        );
      } catch {
        fileCache.set(file, null);
      }
    }
    return fileCache.get(file);
  };

  const ref = {};
  let faceCount = 0;
  for (const id of ids) {
    const site = sites.get(id);
    const entry = { en: enJson[id], call: "lang_string", channel: "string" };
    if (site) {
      entry.file = site.file.replace(/\.gml$/, "");
      entry.line = site.line;
      const lines = getLines(site.file);
      const ctx = lines ? lines[site.line - 1] ?? "" : "";
      const previewMode = inferPreviewMode(
        site.file,
        entry.en,
        battleTextOwners,
        ctx,
        entry.channel
      );
      if (previewMode) entry.previewMode = previewMode;
      if (/global\.msg\[|msgset|msgnext/.test(ctx)) entry.channel = "message";
      else if (/c_cmd|cutscene/.test(ctx)) entry.channel = "cutscene-message";
      if (entry.channel !== "string" && lines) {
        const typer = findTyper(
          lines,
          site.line - 1,
          ownerTypers.get(codeOwner(site.file)) ?? null
        );
        if (typer != null) entry.typer = typer;
        const deviceStyle = findDeviceStyle(
          { ...entry, file: site.file },
          lines,
          site.line - 1,
          typer
        );
        if (deviceStyle) {
          entry.previewMode = "device";
          entry.deviceStyle = deviceStyle;
        }
        const speakerOverlay = findPinkSpeakerOverlay(
          { ...entry, file: site.file },
          lines,
          site.line - 1,
          typer,
          pinkSpeakerOwners
        );
        if (speakerOverlay) entry.speakerOverlay = speakerOverlay;
        if (/\\m\d/.test(entry.en)) {
          const miniFaceBank = inferMiniFaceBank(
            site.file,
            lines,
            site.line - 1,
            miniFaceBanks,
            typer
          );
          if (miniFaceBank) entry.miniFaceBank = miniFaceBank;
        }
        const face = findFace(lines, site.line - 1);
        if (face) {
          entry.face = face;
          faceCount++;
        }
      }
    } else {
      entry.file = null;
      entry.line = 0;
    }
    ref[id] = entry;
  }
  log(`  ${Object.keys(ref).length} ids, ${faceCount} visages détectés`);
  return ref;
}

// ---------------------------------------------------------------------------
// Génère le script .csx UTMT (chemins injectés)
// ---------------------------------------------------------------------------
export function makeCsx(outRoot) {
  const esc = outRoot.replace(/\\/g, "\\\\");
  return `// Généré par TranslatorTool — extraction complète pour l'éditeur
using System.Text;
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Linq;
using UndertaleModLib.Util;

EnsureDataLoaded();

string outRoot = "${esc}";
string codeFolder = Path.Combine(outRoot, "CodeEntries");
string fontFolder = Path.Combine(outRoot, "fonts");
string spriteFolder = Path.Combine(outRoot, "sprites");
Directory.CreateDirectory(codeFolder);
Directory.CreateDirectory(fontFolder);
Directory.CreateDirectory(spriteFolder);

using (StreamWriter sw = new(Path.Combine(outRoot, "sprites_list.txt")))
{
    foreach (var spr in Data.Sprites)
    {
        if (spr is null) continue;
        sw.WriteLine($"{spr.Name.Content};{spr.Textures.Count};{spr.Width};{spr.Height};{spr.OriginX};{spr.OriginY}");
    }
}
ScriptMessage("SPRITELIST_OK");

using (TextureWorker worker = new())
{
    foreach (var font in Data.Fonts)
    {
        if (font is null) continue;
        worker.ExportAsPNG(font.Texture, Path.Combine(fontFolder, $"{font.Name.Content}.png"));
        using (StreamWriter writer = new(Path.Combine(fontFolder, $"glyphs_{font.Name.Content}.csv")))
        {
            writer.WriteLine($"{font.DisplayName};{font.EmSize};{font.Bold};{font.Italic};{font.Charset};{font.AntiAliasing};{font.ScaleX};{font.ScaleY}");
            foreach (var g in font.Glyphs)
            {
                writer.WriteLine($"{g.Character};{g.SourceX};{g.SourceY};{g.SourceWidth};{g.SourceHeight};{g.Shift};{g.Offset}");
            }
        }
    }
}
ScriptMessage("FONTS_OK");

string[] prefixes = new string[] {
    "spr_face_", "spr_face", "spr_textbox_", "spr_pxwhite", "spr_battleblcon", "spr_blcon",
    "button_", "spr_smallface", "spr_darkface", "spr_alphysface", "spr_seam_", "spr_miniface_",
    "spr_pinkspeaker",
    "spr_head", "spr_bname", "spr_tensionbar"
};
string[] previewNames = new string[] {
    "bg_seam_shop_ch2", "bg_battleback1", "spr_npc_trashy",
    "IMAGE_DEPTH", "IMAGE_GONERHEAD", "IMAGE_GONERBODY", "IMAGE_GONERLEGS", "IMAGE_SOUL_BLUR",
    "spr_npc_nubert_super_burrow", "spr_ballperson_battle",
    "spr_ballperson_battle_wig", "spr_bullet_trash", "spr_trashy_hoop",
    "spr_krisb_act", "spr_krisb_idle", "spr_susieb_idle", "spr_ralseib_act",
    "spr_ralseib_idle", "spr_ralsei_act", "spr_ralsei_idle",
    "spr_hpslash", "spr_hpname", "spr_numbersfontsmall", "spr_tplogo",
    "spr_tensionbar_cutout", "spr_tensionmarker"
};
int exported = 0;
using (TextureWorker worker = new())
{
    foreach (var spr in Data.Sprites)
    {
        if (spr is null) continue;
        string name = spr.Name.Content;
        if (!prefixes.Any(p => name.StartsWith(p)) && !previewNames.Contains(name)) continue;
        for (int i = 0; i < spr.Textures.Count; i++)
        {
            if (spr.Textures[i]?.Texture is null) continue;
            try
            {
                worker.ExportAsPNG(spr.Textures[i].Texture, Path.Combine(spriteFolder, $"{name}_{i}.png"), null, true);
                exported++;
            }
            catch (Exception) {}
        }
    }
}
ScriptMessage($"SPRITES_OK {exported}");

GlobalDecompileContext globalDecompileContext = new(Data);
Underanalyzer.Decompiler.IDecompileSettings decompilerSettings = Data.ToolInfo.DecompilerSettings;
List<UndertaleCode> toDump = Data.Code.Where(c => c.ParentEntry is null).ToList();
ScriptMessage($"CODE_TOTAL {toDump.Count}");

int done = 0;
Parallel.ForEach(toDump, code =>
{
    if (code is not null)
    {
        string p = Path.Combine(codeFolder, code.Name.Content + ".gml");
        try
        {
            File.WriteAllText(p, new Underanalyzer.Decompiler.DecompileContext(globalDecompileContext, code, decompilerSettings).DecompileToString());
        }
        catch (Exception e)
        {
            File.WriteAllText(p, "/*\\nDECOMPILER FAILED!\\n\\n" + e.ToString() + "\\n*/");
        }
    }
    int d = Interlocked.Increment(ref done);
    if (d % 1000 == 0) ScriptMessage($"CODE_PROGRESS {d}");
});
ScriptMessage("CODE_OK");
`;
}
