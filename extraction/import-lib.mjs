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
  // scr_speaker remet fc=0 et ne pose aucun visage pour ces personnages
  spamton: 0,
  napstablook: 0,
  starwalker: 0,
  k_k: 0,
  floradinn: 0,
  none: 0, x: 0, no_name: 0, "no name": 0, silent: 0,
};

// Identité logique du personnage, distincte du portrait : plusieurs speakers
// (Tenna, Jackenstein, les fleurs colorées...) règlent uniquement le typer et
// laissent volontairement global.fc à 0 dans scr_speaker/scr_anyface.
const SPEAKER_ALIASES = {
  sus: "susie",
  ral: "ralsei",
  noe: "noelle",
  tor: "toriel",
  lan: "lancer",
  san: "sans",
  und: "undyne",
  asg: "asgore",
  alp: "alphys",
  alph: "alphys",
  ber: "berdly",
  joc: "jockington",
  jock: "jockington",
  rud: "rudy",
  caddy: "catty",
  bra: "bratty",
  rou: "rouxls",
  rurus: "rouxls",
  bur: "burgerpants",
  kin: "king",
  que: "queen",
  queen2: "queen",
  que2: "queen",
  queen_2: "queen",
  que_2: "queen",
  flowery_s: "flowery",
  flowery_noface: "flowery",
  purple: "seth",
  sneo: "spamton",
};

const NO_SPEAKER_NAMES = new Set([
  "none",
  "x",
  "no_name",
  "no name",
  "noone",
  "no_one",
  "no one",
  "noname",
  "silent",
  "normal",
  "balloon",
  "enemy",
]);

const FC_SPEAKERS = {
  1: "susie",
  2: "ralsei",
  3: "noelle",
  4: "toriel",
  5: "lancer",
  6: "sans",
  9: "undyne",
  10: "asgore",
  11: "alphys",
  12: "berdly",
  13: "catti",
  14: "jockington",
  15: "rudy",
  16: "catty",
  17: "bratty",
  18: "rouxls",
  19: "burgerpants",
  20: "king",
  21: "queen",
  22: "carol",
  23: "flowery",
  24: "flowery",
  25: "bluef",
};

function canonicalSpeaker(raw) {
  const speaker = String(raw ?? "").trim().toLowerCase();
  if (!speaker || NO_SPEAKER_NAMES.has(speaker)) return null;
  return SPEAKER_ALIASES[speaker] ?? speaker;
}

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
// obj_face Draw_0 : Ralsei choisit spr_face_r_dark quand le flag 1311 vaut 1,
// sinon spr_face_r_nohat à partir du chapitre 2. Les cutscenes reflètent cet
// état dans ses sprites d'acteur : spr_ralsei_* sans chapeau, spr_ralsei[drlu]
// avec chapeau. On utilise le dernier indice explicite avant le dialogue.
function findRalseiFaceVariant(lines, lineIdx) {
  for (const i of dialogueScan(lines, lineIdx, 80)) {
    const flag = lines[i].match(
      /(?:scr_flag_set\(\s*1311\s*,|global\.flag\[1311\]\s*=)\s*([01])/
    );
    if (flag) return flag[1] === "1" ? "ralsei-hat" : "ralsei-nohat";
    if (/\bc_sprite\(\s*spr_ralsei_\w+/.test(lines[i])) return "ralsei-nohat";
    if (/\bc_sprite\(\s*spr_ralsei[drlu](?:\b|_)/.test(lines[i])) return "ralsei-hat";
  }
  return null;
}

// obj_face Draw_0 : Noelle utilise spr_face_n_matome_extended quand
// global.tempflag[63] vaut 1 ; obj_ch5_LW20 alimente ce flag via face_extended.
function findFaceVariant(lines, lineIdx, fc) {
  if (fc === 2) return findRalseiFaceVariant(lines, lineIdx);
  if (fc !== 3) return null;
  for (const i of dialogueScan(lines, lineIdx, lineIdx)) {
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

function readSpriteNamesById(codeDir) {
  try {
    return fs
      .readFileSync(path.join(codeDir, "..", "sprites_list.txt"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.split(";", 1)[0] || null);
  } catch {
    return [];
  }
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
const dialogueScopeCache = new WeakMap();

function dialogueScopeRanges(lines, lineIdx) {
  if (!dialogueScopeCache.has(lines)) {
    // scr_text case 345 est appelé après global.fc = 0 (obj_npc_room
    // Other_10), pas après le case Burgerpants précédent dans le fichier.
    const source = lines.join("\n").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
      value => value.replace(/[^\n]/g, " "));
    const scopes = [{ open: 0, branch: null }];
    const bounds = source.split("\n").map((line, index) => {
      for (const token of line.matchAll(/\bcase\b[^:]*:|\bdefault\s*:|[{}]/g)) {
        if (token[0] === "{") scopes.push({ open: index, branch: null });
        else if (token[0] === "}") { if (scopes.length > 1) scopes.pop(); }
        else scopes.at(-1).branch = index;
      }
      return scopes.filter(scope => scope.branch != null).map(scope => [scope.open + 1, scope.branch]);
    });
    dialogueScopeCache.set(lines, bounds);
  }
  return dialogueScopeCache.get(lines)[lineIdx] ?? [];
}

export function dialogueScopeStart(lines, lineIdx) {
  return dialogueScopeRanges(lines, lineIdx).at(-1)?.[1] ?? 0;
}

function* dialogueScan(lines, lineIdx, distance = 120) {
  const ranges = dialogueScopeRanges(lines, lineIdx);
  for (let i = lineIdx; i >= Math.max(0, lineIdx - distance); i--) {
    if (ranges.some(([start, end]) => i >= start && i < end)) continue;
    yield i;
  }
}

export function findFace(lines, lineIdx) {
  let pendingFe = null; // dernier global.fe rencontré en remontant
  for (const i of dialogueScan(lines, lineIdx)) {
    const l = lines[i];

    // scr_cutscene_commands, commande "fe" : c_fefc(fe, fc) remplace les
    // deux globals après c_speaker. c_fefc(0, 0) sert notamment aux scènes
    // sans portrait de Noelle, Susie et Flowery ; cette remise à zéro doit
    // donc gagner sur le speaker rencontré plus haut.
    let m = l.match(/\bc_fefc\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/);
    if (m && i !== lineIdx) {
      const fe = Number(m[1]);
      const fc = Number(m[2]);
      return fc === 0 ? null : withFaceVariant(lines, lineIdx, { fc, fe });
    }

    // Cutscenes qui règlent le writer directement : global.fc = 2 / global.fe = 1
    m = l.match(/global\.fe\s*=\s*(\d+)/);
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

// Cherche l'identité du speaker indépendamment du portrait. Comme global.fc,
// le speaker persiste jusqu'à la prochaine commande de dialogue. Une commande
// « sans nom » constitue donc une frontière et doit arrêter la remontée.
export function findSpeaker(lines, lineIdx) {
  for (const i of dialogueScan(lines, lineIdx)) {
    const line = lines[i];
    const calls = [];
    const speakerCallRe =
      /(?:c_(?:facenext|face|msgface|speaker)|scr_(?:anyface_next|anyface|speaker))\s*\(\s*["']([\w ]+)["']/g;
    let match;
    while ((match = speakerCallRe.exec(line))) {
      calls.push({ index: match.index, speaker: canonicalSpeaker(match[1]) });
    }

    const faceCallRe = /\b(scr_\w*face)\s*\(/g;
    while ((match = faceCallRe.exec(line))) {
      const fc = FACE_FN_FC[match[1]];
      if (fc) calls.push({ index: match.index, speaker: FC_SPEAKERS[fc] });
    }

    if (i !== lineIdx) {
      for (const tag of line.matchAll(/\\\\F(.)/g)) {
        if (!(tag[1] in F_TAG_FC)) continue;
        const fc = F_TAG_FC[tag[1]];
        calls.push({ index: tag.index, speaker: fc === 0 ? null : FC_SPEAKERS[fc] ?? null });
      }
    }

    if (calls.length) return calls.sort((a, b) => b.index - a.index)[0].speaker;

    // Quelques scènes pilotent directement le writer sans passer par les
    // helpers. Le mapping fc reste alors la seule identité disponible.
    if (i !== lineIdx) {
      const fcAssignments = [...line.matchAll(/global\.fc\s*=\s*(\d+)/g)];
      if (fcAssignments.length) {
        const fc = Number(fcAssignments.at(-1)[1]);
        return fc === 0 ? null : FC_SPEAKERS[fc] ?? null;
      }
    }
  }
  return null;
}

// Même remontée que findFace, mais uniquement pour les typers qui changent
// visiblement le rendu. Les commandes de cutscene injectent leur \T hors de la
// chaîne localisée ; sans cette métadonnée la preview retomberait sur du blanc.
function findTyper(lines, lineIdx, ownerTyper = null) {
  for (const i of dialogueScan(lines, lineIdx)) {
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

function isShopOwner(file) {
  return /^gml_Object_obj_shop\w*_(?:Create|Draw|Other)_\d+$/.test(
    String(file).replace(/\.gml$/, "")
  );
}

function isLargeShopDialogue(file, text) {
  const source = String(text);
  return (
    isShopOwner(file) &&
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

// obj_dialoguer_plat est créé soit par d_make_plat, soit par la commande de
// cutscene `talk` quand obj_plat_player existe (scr_cutscene_commands).
// Certains événements mélangent d_make et d_make_plat : les lignes proches du
// constructeur sont alors suivies séparément pour ne pas requalifier le reste.
function findPlatformDialogueFlow(codeDir) {
  const files = new Set();
  const cutsceneFiles = new Set();
  const lines = new Set();
  const ownersWithPlatform = new Set();
  const ownersWithRegular = new Set();
  for (const file of fs.readdirSync(codeDir).filter((name) => name.endsWith(".gml"))) {
    const source = fs.readFileSync(path.join(codeDir, file), "utf8");
    const sourceLines = source.split(/\r?\n/);
    const cleanFile = file.replace(/\.gml$/, "");
    const owner = codeOwner(file);
    const hasPlatformMake = /\bd_make_plat\s*\(/.test(source);
    const hasRegularMake = /\bd_make\s*\(/.test(source);
    if (hasPlatformMake) {
      ownersWithPlatform.add(owner);
      if (!hasRegularMake) files.add(cleanFile);

      for (let i = 0; i < sourceLines.length; i++) {
        if (!/\bd_make_plat\s*\(/.test(sourceLines[i])) continue;
        for (let j = i - 1; j >= Math.max(0, i - 40); j--) {
          if (/\bd_make(?:_plat)?\s*\(/.test(sourceLines[j])) break;
          if (/(?:msg(?:set|next)|stringset)(?:sub)?loc\s*\(/.test(sourceLines[j]))
            lines.add(`${cleanFile}:${j + 1}`);
        }
      }
    }
    if (hasRegularMake) ownersWithRegular.add(owner);

    const platformRuntimeSignal =
      /\bc_plat_|\bscr_setup_plat_actor\b|\bscr_get_plat_followers\b|\bobj_dialoguer_plat\b|\bobj_plat_player\b|\bglobal\.pause_plat\b|\bscr_plat(?:swap)?_/.test(
        source
      );
    if (platformRuntimeSignal && /\bc_(?:msg|talk)/.test(source)) {
      cutsceneFiles.add(cleanFile);
      ownersWithPlatform.add(owner);
    }
  }
  return {
    files,
    cutsceneFiles,
    lines,
    exclusiveOwners: new Set(
      [...ownersWithPlatform].filter((owner) => !ownersWithRegular.has(owner))
    ),
  };
}

const BATTLE_FILE_RE = /enemy|battle|blcon|_attack|encounter|boss|trashy_trio/i;
const TRIAL_CASE_RE = /\bcase_info\s*\[\s*(\d+)\s*\]\s*=/;

function trialCaseFromLine(contextLine) {
  const match = String(contextLine).match(TRIAL_CASE_RE);
  return match ? Number(match[1]) : null;
}

// c_msgside alimente scr_cutscene_commands.msgside avant la commande `talk`.
// Sans forçage, la position dépend du joueur et ne peut pas être reconstruite
// statiquement ; le bas est le placement représentatif des cutscenes plat.
function findCutscenePlatformSide(lines, lineIdx) {
  for (let i = lineIdx; i >= Math.max(0, lineIdx - 250); i--) {
    const match = lines[i].match(/\bc_msgside\s*\(\s*"(top|bottom|any)"/);
    if (!match) continue;
    if (match[1] === "top") return 0;
    if (match[1] === "bottom") return 1;
    return 1;
  }
  return 1;
}

// Les choix modernes sont dessinés par obj_choicer_neo à partir de deux à
// quatre chaînes distinctes. Le catalogue les expose séparément : on relie ici
// les options qui alimentent un même \C2/\C3/\C4 ou scr_readychoicer().
function findChoiceGroups(entriesByFile, getLines) {
  const groups = [];
  for (const [file, entries] of entriesByFile) {
    const lines = getLines(file);
    if (!lines) continue;
    const entriesByLine = new Map();
    for (const entry of entries) {
      if (!entriesByLine.has(entry.line)) entriesByLine.set(entry.line, []);
      entriesByLine.get(entry.line).push(entry);
    }

    const localizedOptionAt = (lineNumber, expectedText = null) => {
      const candidates = entriesByLine.get(lineNumber) ?? [];
      if (expectedText != null) {
        const exact = candidates.find((entry) => entry.english === expectedText);
        if (exact) return { key: exact.id, text: exact.english };
      }
      const candidate = candidates.find((entry) => entry.channel === "string");
      return candidate ? { key: candidate.id, text: candidate.english } : null;
    };

    const globalAssignment = (lineNumber) => {
      const line = lines[lineNumber - 1] ?? "";
      const match = line.match(/global\.choicemsg\s*\[\s*([0-3])\s*\]\s*=\s*(.+?);?\s*$/);
      if (!match) return null;
      const localized = localizedOptionAt(lineNumber);
      return {
        index: Number(match[1]),
        option: localized ?? { key: null, text: literalString(match[2]) ?? "" },
      };
    };

    // Affectations global.choicemsg[] suivies d'un message technique \C2..4.
    for (let trigger = 1; trigger <= lines.length; trigger++) {
      const countMatch = (lines[trigger - 1] ?? "").match(/\\+C([2-4])/);
      if (!countMatch) continue;
      const count = Number(countMatch[1]);
      const options = Array(count).fill(null);
      for (let lineNumber = trigger - 1; lineNumber >= Math.max(1, trigger - 40); lineNumber--) {
        const assignment = globalAssignment(lineNumber);
        if (!assignment || assignment.index >= count || options[assignment.index]) continue;
        options[assignment.index] = assignment.option;
        if (options.every(Boolean)) break;
      }
      if (options.every(Boolean) && options.some((option) => option.key)) {
        groups.push({ file, triggerLine: trigger, options });
      }
    }

    // Variables locales (opt1, option2...) passées à scr_readychoicer().
    let previousReadyLine = 0;
    for (let trigger = 1; trigger <= lines.length; trigger++) {
      const line = lines[trigger - 1] ?? "";
      const call = /\bscr_readychoicer\s*\(/g.exec(line);
      if (!call) continue;
      const parsed = parseArgs(line, call.index + call[0].length);
      if (!parsed || parsed.args.length < 2) continue;
      const rawOptions = parsed.args.slice(0, 4);
      let count = 2;
      for (let index = 2; index < rawOptions.length; index++) {
        const raw = rawOptions[index].raw.trim();
        if (!raw || raw === "undefined" || literalString(raw) === "") break;
        count = index + 1;
      }

      const options = [];
      for (let index = 0; index < count; index++) {
        const arg = rawOptions[index];
        if (!arg) {
          options.push({ key: null, text: "" });
          continue;
        }
        const directText = literalString(arg.raw);
        let option = localizedOptionAt(trigger, directText);
        const variable = arg.raw.trim().match(/^[A-Za-z_]\w*$/)?.[0];
        if (!option && variable) {
          const assignRe = new RegExp(
            `(?:\\bvar\\s+)?\\b${variable}\\s*(?<![=!<>+\\-*/])=(?!=)\\s*(.+?);?\\s*$`
          );
          for (
            let lineNumber = trigger - 1;
            lineNumber > Math.max(previousReadyLine, trigger - 100);
            lineNumber--
          ) {
            const assignment = (lines[lineNumber - 1] ?? "").match(assignRe);
            if (!assignment) continue;
            const localized = localizedOptionAt(lineNumber);
            if (localized) {
              option = localized;
              break;
            }
            const fallback = literalString(assignment[1]);
            if (fallback != null) {
              option = { key: null, text: fallback };
              break;
            }
          }
        }
        options.push(option ?? { key: null, text: directText ?? "" });
      }
      if (options.some((option) => option.key)) {
        groups.push({ file, triggerLine: trigger, options });
      }
      previousReadyLine = trigger;
    }
  }
  return groups;
}

function choicePreviewMode(file, triggerLine, battleTextOwners, battleFlowOwners, platformFlow) {
  const cleanFile = file.replace(/\.gml$/, "");
  const owner = codeOwner(cleanFile);
  if (
    battleTextOwners.has(owner) ||
    battleFlowOwners.has(owner) ||
    BATTLE_FILE_RE.test(cleanFile)
  ) {
    return "battletext";
  }
  if (
    platformFlow.lines.has(`${cleanFile}:${triggerLine}`) ||
    platformFlow.files.has(cleanFile) ||
    platformFlow.cutsceneFiles.has(cleanFile) ||
    platformFlow.exclusiveOwners.has(owner)
  ) {
    return "platform";
  }
  return "darkbox";
}

function attachChoiceMetadata(
  ref,
  entriesByFile,
  getLines,
  battleTextOwners,
  battleFlowOwners,
  platformFlow
) {
  let count = 0;
  for (const group of findChoiceGroups(entriesByFile, getLines)) {
    const lines = getLines(group.file);
    const mode = choicePreviewMode(
      group.file,
      group.triggerLine,
      battleTextOwners,
      battleFlowOwners,
      platformFlow
    );
    const side = mode === "platform" ? 1 : findCutscenePlatformSide(lines, group.triggerLine - 1);
    const options = group.options.map((option) => ({
      ...(option.key ? { key: option.key } : {}),
      ...(!option.key || !ref[option.key] ? { text: option.text } : {}),
    }));
    group.options.forEach((option, index) => {
      if (!option.key || !ref[option.key]) return;
      const previous = ref[option.key].choice;
      if (previous && previous.options.length >= options.length) return;
      ref[option.key].previewMode = mode;
      ref[option.key].choice = { options, index, side };
      if (!previous) count++;
    });
  }
  return count;
}

// Certains scripts globaux alimentent le panneau de combat sans le trahir dans
// leur nom (scr_spelltext : global.msg[0] = "* ~1 cast RUDE BUSTER!/%", appelé
// par obj_spellphase). On propage le contexte combat aux scripts globaux dont
// TOUS les appelants sont eux-mêmes en contexte combat.
function findBattleFlowScripts(codeDir, battleTextOwners) {
  const defined = new Map(); // "scr_x" → propriétaire du GlobalScript
  const callers = new Map(); // "scr_x" → Set<propriétaires appelants>
  for (const file of fs.readdirSync(codeDir).filter((name) => name.endsWith(".gml"))) {
    const owner = codeOwner(file);
    const definition = file.match(/^gml_GlobalScript_(scr_\w+)\.gml$/);
    if (definition) defined.set(definition[1], owner);
    const source = fs.readFileSync(path.join(codeDir, file), "utf8");
    for (const call of source.matchAll(/\b(scr_\w+)\s*\(/g)) {
      if (!callers.has(call[1])) callers.set(call[1], new Set());
      callers.get(call[1]).add(owner);
    }
  }
  const battleFlow = new Set();
  for (const [fn, owner] of defined) {
    const callingOwners = [...(callers.get(fn) ?? [])].filter((c) => c !== owner);
    if (!callingOwners.length) continue;
    const allBattle = callingOwners.every(
      (c) => battleTextOwners.has(c) || BATTLE_FILE_RE.test(c)
    );
    if (allBattle) battleFlow.add(owner);
  }
  return battleFlow;
}

function inferPreviewMode(
  file,
  text,
  battleTextOwners,
  contextLine = "",
  channel = null,
  battleFlowOwners = new Set(),
  platformFlow = {
    files: new Set(),
    cutsceneFiles: new Set(),
    lines: new Set(),
    exclusiveOwners: new Set(),
  },
  lineNumber = 0
) {
  const cleanFile = file.replace(/\.gml$/, "");
  // obj_yellow_trial_manager Draw_0 dessine case_info[trial_counter]
  // directement dans l'interface du procès, sans obj_writer ni textbox.
  if (trialCaseFromLine(contextLine) != null) return "trial";
  const owner = codeOwner(cleanFile);
  const exactPlatformLine = platformFlow.lines.has(`${cleanFile}:${lineNumber}`);
  const cutsceneChannel = String(channel ?? "").startsWith("cutscene-");
  if (cutsceneChannel) {
    // scr_cutscene_commands, commande `talk` : le moteur choisit précisément
    // obj_dialoguer_plat lorsqu'un obj_plat_player est actif.
    if (
      exactPlatformLine ||
      platformFlow.cutsceneFiles.has(cleanFile) ||
      platformFlow.exclusiveOwners.has(owner)
    ) {
      return "platform";
    }
    return null;
  }
  const platformSource =
    exactPlatformLine ||
    platformFlow.files.has(cleanFile) ||
    platformFlow.exclusiveOwners.has(owner);
  if (
    platformSource &&
    (channel !== "string" || endsWithWriterClose(text) || /\bglobal\.msg\s*\[/.test(contextLine))
  ) {
    return "platform";
  }
  // Dans les objets obj_shop*, les appels msg* et les affectations directes de
  // global.msg sont rendus par leur obj_writer dans l'interface de boutique.
  // Le texte n'a pas forcément de / ou de % : obj_shop_ch5 conserve notamment
  // son message d'accueil dans _intro_text avant de le copier dans global.msg.
  if (
    isShopOwner(cleanFile) &&
    (channel !== "string" || /\bglobal\.msg\s*\[[^\]]+\]\s*=/.test(contextLine))
  ) {
    return "shop";
  }
  // Filet de compatibilité pour les textes de conversation stockés dans un
  // tableau ou une structure que l'analyse de flux statique ne sait pas suivre.
  if (isLargeShopDialogue(cleanFile, text)) return "shop";
  const inBattleOwner =
    battleTextOwners.has(owner) ||
    battleFlowOwners.has(owner) ||
    /scr_encountersetup|obj_battlecontroller/.test(cleanFile);
  if (startsWithWriterAsterisk(text) && inBattleOwner) return "battletext";
  // Fragments concaténés au message du panneau de combat (scr_spelltext :
  // spelltext += " became enraptured!&"...) : `&` final = saut de ligne writer.
  if (battleFlowOwners.has(owner) && channel === "string" && /&\s*$/.test(String(text)))
    return "battletext";
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
  if (inBattleOwner || BATTLE_FILE_RE.test(cleanFile)) return null;
  if (/\bmsg\s*\[[^\]]*\]\s*=/.test(contextLine) || /\bmsgset\s*\(/.test(contextLine))
    return "darkbox";
  if (/global\.choicemsg\s*\[/.test(contextLine) || /\bscr_readychoicer\s*\(/.test(contextLine))
    return "darkbox";
  // Variables intermédiaires (ex. _dialogue[i], transmises à msgset plus bas) :
  // la terminaison writer signe un message de textbox.
  if (endsWithWriterClose(text)) return "darkbox";
  return null;
}

// scr_auto_convo("toriel", stringsetloc(...)) : constructeur du ch5 consommé
// par obj_ch5_LW01W Step_0 via scr_speaker(_convo.speaker) puis
// msgset(0, _convo.dialogue) → boîte de dialogue, visage de scr_speaker.
function findAutoConvo(id, contextLine) {
  const idPos = contextLine.indexOf(`"${id}"`);
  if (idPos < 0) return null;
  let speaker = null;
  for (const m of contextLine.matchAll(/new\s+scr_auto_convo\s*\(\s*"([\w ]+)"/g)) {
    if (m.index > idPos) break;
    speaker = m[1];
  }
  if (!speaker) return null;
  const fc = SPEAKER_FC[speaker.toLowerCase()] ?? 0;
  return {
    mode: "darkbox",
    speaker: canonicalSpeaker(speaker),
    face: fc ? { fc, fe: 0 } : null,
  };
}

// Textes affectés à une variable puis transmis au writer ailleurs dans le même
// objet : msgset(n, v) / msgset_add(v, x, y, ...) (outros d'ennemis, bulles du
// procès du ch5...). obj_trial_perp Create_0 (testimony_balloon) lit aussi le
// champ testimony[] du manager : msgset + scr_enemyblcon, typer 50.
function findVariableMessage(id, contextLine, ownerSource, file) {
  const idPos = contextLine.indexOf(`"${id}"`);
  if (idPos < 0 || !ownerSource) return null;
  let variable = null;
  for (const m of contextLine.matchAll(
    /(?:\bvar\s+)?\b([A-Za-z_]\w*)\s*=\s*(?:stringsetloc|stringsetsubloc)\s*\(/g
  )) {
    if (m.index > idPos) break;
    variable = m[1];
  }
  if (!variable) return null;

  if (new RegExp(`testimony:\\s*\\[[^\\]]*\\b${variable}\\b`).test(ownerSource)) {
    const speakerToken = variable.match(/^t\d+_([a-z]+)_test$/);
    return {
      mode: "bubble",
      typer: 50, // obj_trial_perp Create_0, testimony_balloon
      speaker: speakerToken ? canonicalSpeaker(speakerToken[1]) : null,
    };
  }

  const reference = `(?:\\w+\\.)?${variable}`;
  const queuedToGlobalMessage = new RegExp(
    `\\bglobal\\.msg\\s*\\[[^\\]]+\\]\\s*=\\s*${reference}\\s*;`
  ).test(ownerSource);
  const queued =
    queuedToGlobalMessage ||
    new RegExp(`\\bmsgset\\s*\\(\\s*[^,()]+,\\s*${reference}\\s*[),]`).test(ownerSource) ||
    new RegExp(`\\bmsgset_add\\s*\\(\\s*${reference}\\s*[),]`).test(ownerSource);
  if (queued) {
    // msgset seul remplit la file d'obj_writer (textbox) ; la présence de
    // bulles chez le même propriétaire (scr_enemyblcon / msgset_add avec
    // coordonnées) signe un affichage en bulle.
    const bubbles = /\bscr_enemyblcon\s*\(|\bmsgset_add\s*\(/.test(ownerSource);
    return { mode: isShopOwner(file) ? "shop" : bubbles ? "bubble" : "darkbox" };
  }

  // Fermeture writer ajoutée au runtime : scr_itemget_anytype_text construit
  // itemgetstring = "* (...)" puis itemgetstring += "/%".
  if (new RegExp(`\\b${variable}\\s*\\+=\\s*"(?:/%|%)"`).test(ownerSource))
    return { mode: "darkbox" };
  return null;
}

// ---------------------------------------------------------------------------
// Acteur d'une bulle de combat : obj_battleblcon ne connaît pas son locuteur,
// l'ancrage est purement par coordonnées. On retrouve donc statiquement qui
// parle : l'appel scr_heroblcon/scr_enemyblcon/msgset_add le plus proche SOUS
// le msgsetloc désigne le locuteur (les ennemis appellent typiquement
// scr_enemyblcon(x - 10, y + 40, 10) après avoir rempli la file).
// ---------------------------------------------------------------------------

// Sprites idle de combat des héros (obj_heroparent Create_0, échelle 2).
// Ralsei : spr_ralsei_idle par défaut, spr_ralseib_idle si le flag 1311 est
// posé — on garde les deux candidats, la preview prend le premier disponible.
const HERO_BUBBLE_SPRITES = {
  kris: ["spr_krisb_idle"],
  susie: ["spr_susieb_idle"],
  ralsei: ["spr_ralsei_idle", "spr_ralseib_idle"],
  noelle: ["spr_noelleb_idle"],
};

// Arguments acceptés par scr_heroblcon (1/"kris"/"kr", 2/"susie"/"su"…).
const HERO_BLCON_TOKENS = {
  1: "kris", kris: "kris", kr: "kris",
  2: "susie", susie: "susie", su: "susie",
  3: "ralsei", ralsei: "ralsei", ra: "ralsei",
  4: "noelle", noelle: "noelle", no: "noelle",
};

// idlesprite = spr_xxx le plus proche AU-DESSUS du texte dans le même fichier
// (les ennemis réassignent parfois leur pose juste avant de parler), sinon la
// première affectation du Create_0 (pose de base, scr_enemy_drawidle_generic).
function findEnemyIdleSprite(lines, lineIdx, createLines) {
  const IDLE_RE = /\bidlesprite\s*=\s*(spr_\w+)/;
  for (let i = Math.min(lineIdx, lines.length - 1); i >= 0; i--) {
    const m = lines[i].match(IDLE_RE);
    if (m) return m[1];
  }
  for (const line of createLines ?? []) {
    const m = line.match(IDLE_RE);
    if (m) return m[1];
  }
  return null;
}

function enemyBubbleActor(file, lines, lineIdx, getLines) {
  const owner = codeOwner(file.replace(/\.gml$/, ""));
  const objectName = owner.match(/^gml_Object_(obj_\w*_enemy)$/)?.[1];
  if (!objectName) return null;
  const sprite = findEnemyIdleSprite(lines, lineIdx, getLines(`${owner}_Create_0.gml`));
  if (!sprite) return null;
  return {
    kind: "enemy",
    name: objectName.replace(/^obj_/, "").replace(/_enemy$/, ""),
    sprites: [sprite],
  };
}

export function findBubbleActor(file, lines, lineIdx, getLines = () => null) {
  const to = Math.min(lines.length - 1, lineIdx + 25);
  for (let i = lineIdx; i <= to; i++) {
    const hero = lines[i].match(/\bscr_heroblcon\s*\(\s*["']?([A-Za-z0-9_]+)["']?/);
    if (hero) {
      const name = HERO_BLCON_TOKENS[hero[1].toLowerCase()];
      if (!name) return null;
      return { kind: "hero", name, sprites: [...HERO_BUBBLE_SPRITES[name]] };
    }
    if (/\bscr_enemyblcon\s*\(|\bmsgset_add\s*\(/.test(lines[i]))
      return enemyBubbleActor(file, lines, lineIdx, getLines);
  }
  // Repli : texte déclaré dans Create et envoyé en bulle depuis un autre
  // événement (outros d'ennemis via msgset_add) — le propriétaire parle.
  return enemyBubbleActor(file, lines, lineIdx, getLines);
}

// L'acteur n'a de sens que pour une entrée susceptible d'être rendue en bulle :
// previewMode bubble explicite, ou entrée de combat que l'heuristique
// bubble/battletext de l'app peut faire basculer.
function isBubbleActorCandidate(entry, file, battleTextOwners) {
  if (String(entry.channel ?? "").startsWith("cutscene-")) return false;
  if (entry.previewMode === "bubble") return true;
  if (entry.previewMode != null && entry.previewMode !== "battletext") return false;
  const cleanFile = file.replace(/\.gml$/, "");
  return battleTextOwners.has(codeOwner(cleanFile)) || BATTLE_FILE_RE.test(cleanFile);
}

// ---------------------------------------------------------------------------
// Construit reference.json à partir du dossier CodeEntries
// ---------------------------------------------------------------------------
export function buildReference(codeDir, log = () => {}) {
  const entries = scanCatalog(codeDir, log);
  const battleTextOwners = findBattleTextOwners(codeDir);
  const battleFlowOwners = findBattleFlowScripts(codeDir, battleTextOwners);
  const platformFlow = findPlatformDialogueFlow(codeDir);
  const miniFaceBanks = findMiniFaceBanks(codeDir);
  const pinkSpeakerOwners = findPinkSpeakerOwners(codeDir);
  const ownerTypers = findOwnerTypers(codeDir);
  const spriteNamesById = readSpriteNamesById(codeDir);
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
  // Source concaténée de tous les événements d'un objet, pour suivre une
  // variable de texte déclarée dans Create et consommée dans Step/Draw.
  const ownerFiles = new Map();
  for (const file of fs.readdirSync(codeDir).filter((f) => f.endsWith(".gml"))) {
    const owner = codeOwner(file);
    if (!ownerFiles.has(owner)) ownerFiles.set(owner, []);
    ownerFiles.get(owner).push(file);
  }
  const ownerSourceCache = new Map();
  const getOwnerSource = (file) => {
    const owner = codeOwner(file);
    if (!ownerSourceCache.has(owner)) {
      ownerSourceCache.set(
        owner,
        (ownerFiles.get(owner) ?? [])
          .map((f) => getLines(f)?.join("\n") ?? "")
          .join("\n")
      );
    }
    return ownerSourceCache.get(owner);
  };

  const ref = {};
  let faceCount = 0;
  let smallFaceCount = 0;
  let linkedSmallFaceCount = 0;
  let bubbleActorCount = 0;
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
      e.channel,
      battleFlowOwners,
      platformFlow,
      e.line
    );
    if (previewMode) entry.previewMode = previewMode;
    if (previewMode === "platform" && String(e.channel).startsWith("cutscene-") && lines)
      entry.platformSide = findCutscenePlatformSide(lines, e.line - 1);
    const trialCase = trialCaseFromLine(contextLine);
    if (previewMode === "trial" && trialCase != null) entry.trialCase = trialCase;
    if (!entry.previewMode && e.channel === "string") {
      const autoConvo = findAutoConvo(e.id, contextLine);
      const varMessage =
        autoConvo ?? findVariableMessage(e.id, contextLine, getOwnerSource(e.file), e.file);
      if (varMessage) {
        entry.previewMode = varMessage.mode;
        if (varMessage.typer != null) entry.typer = varMessage.typer;
        if (varMessage.speaker) entry.speaker = varMessage.speaker;
        if (varMessage.face) {
          entry.face = varMessage.face;
          faceCount++;
        }
      }
    }
    if (e.substitutions?.length) entry.substitutions = e.substitutions;
    if (e.substitutionSamples?.length) entry.substitutionSamples = e.substitutionSamples;
    if (lines) {
      const typer = findTyper(lines, e.line - 1, ownerTypers.get(codeOwner(e.file)) ?? null);
      if (typer != null && entry.typer == null) entry.typer = typer;
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
          speaker:
            typeof smallFace.speaker === "number"
              ? spriteNamesById[smallFace.speaker] ?? smallFace.speaker
              : smallFace.speaker,
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
      entry.previewMode === "shop" ||
      entry.previewMode === "device" ||
      entry.previewMode === "battletext" ||
      entry.previewMode === "platform" ||
      entry.previewMode === "bubble";
    if (isDialogue) {
      if (lines) {
        const speaker = findSpeaker(lines, e.line - 1);
        if (speaker && !entry.speaker) entry.speaker = speaker;
        const face = findFace(lines, e.line - 1);
        if (face && !entry.face) {
          entry.face = face;
          faceCount++;
        }
      }
    }
    if (lines && isBubbleActorCandidate(entry, e.file, battleTextOwners)) {
      const bubbleActor = findBubbleActor(e.file, lines, e.line - 1, getLines);
      if (bubbleActor) {
        entry.bubbleActor = bubbleActor;
        bubbleActorCount++;
      }
    }
    ref[e.id] = entry;
  }
  const choiceCount = attachChoiceMetadata(
    ref,
    entriesByFile,
    getLines,
    battleTextOwners,
    battleFlowOwners,
    platformFlow
  );
  log(
    `  ${Object.keys(ref).length} ids uniques, ${faceCount} visages détectés, ` +
      `${smallFaceCount} textes secondaires (${linkedSmallFaceCount} reliés), ` +
      `${bubbleActorCount} acteurs de bulle, ${choiceCount} options de choix reliées`
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
  const battleFlowOwners = findBattleFlowScripts(codeDir, battleTextOwners);
  const platformFlow = findPlatformDialogueFlow(codeDir);
  const miniFaceBanks = findMiniFaceBanks(codeDir);
  const pinkSpeakerOwners = findPinkSpeakerOwners(codeDir);
  const ownerTypers = findOwnerTypers(codeDir);
  const sites = new Map(); // id → {file, line, context}
  const entriesByFile = new Map();
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
      if (/\bc_(?:msgset|msgnext)/.test(ctx)) entry.channel = "cutscene-message";
      else if (/global\.msg\[|msgset|msgnext/.test(ctx)) entry.channel = "message";
      const previewMode = inferPreviewMode(
        site.file,
        entry.en,
        battleTextOwners,
        ctx,
        entry.channel,
        battleFlowOwners,
        platformFlow,
        site.line
      );
      if (previewMode) entry.previewMode = previewMode;
      if (previewMode === "platform" && String(entry.channel).startsWith("cutscene-") && lines)
        entry.platformSide = findCutscenePlatformSide(lines, site.line - 1);
      const trialCase = trialCaseFromLine(ctx);
      if (previewMode === "trial" && trialCase != null) entry.trialCase = trialCase;
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
        const speaker = findSpeaker(lines, site.line - 1);
        if (speaker) entry.speaker = speaker;
        const face = findFace(lines, site.line - 1);
        if (face) {
          entry.face = face;
          faceCount++;
        }
      }
      if (lines && isBubbleActorCandidate(entry, site.file, battleTextOwners)) {
        const bubbleActor = findBubbleActor(site.file, lines, site.line - 1, getLines);
        if (bubbleActor) entry.bubbleActor = bubbleActor;
      }
    } else {
      entry.file = null;
      entry.line = 0;
    }
    ref[id] = entry;
  }
  for (const [id, site] of sites) {
    const candidate = {
      id,
      english: enJson[id],
      call: "lang_string",
      channel: "string",
      file: site.file,
      line: site.line,
    };
    if (!entriesByFile.has(site.file)) entriesByFile.set(site.file, []);
    entriesByFile.get(site.file).push(candidate);
  }
  const choiceCount = attachChoiceMetadata(
    ref,
    entriesByFile,
    getLines,
    battleTextOwners,
    battleFlowOwners,
    platformFlow
  );
  log(
    `  ${Object.keys(ref).length} ids, ${faceCount} visages détectés, ` +
      `${choiceCount} options de choix reliées`
  );
  return ref;
}

// ---------------------------------------------------------------------------
// Génère le script .csx UTMT (chemins injectés)
// ---------------------------------------------------------------------------
export function makeFontsCsx(outRoot) {
  const esc = outRoot.replace(/\\/g, "\\\\");
  return `// Generated by TranslatorTool - targeted font extraction
using System.IO;
using UndertaleModLib.Util;

EnsureDataLoaded();

string fontFolder = Path.Combine("${esc}", "fonts");
Directory.CreateDirectory(fontFolder);

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
`;
}

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
    "spr_gradient_triangle_dialoguer_plat", "spr_gradient20",
    "spr_trial_podium", "spr_kris_lawyer", "spr_kris_lawyer_alt",
    "spr_susie_lawyer", "spr_ralsei_lawyer", "spr_trial_spotlight",
    "spr_aqua_walk_down", "spr_seth_walk_down", "spr_enemy_green_walk",
    "spr_yellow_walk_down", "spr_blue_poses", "spr_heart_centered", "spr_heartsmall_white",
    "spr_sneo_bullet_arrow",
    "spr_empty",
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
        bool localizedPair =
            name.EndsWith("_fr") || Data.Sprites.Any(candidate => candidate?.Name?.Content == name + "_fr");
        bool faceLike = name.IndexOf("face", StringComparison.OrdinalIgnoreCase) >= 0;
        if (!prefixes.Any(p => name.StartsWith(p)) && !previewNames.Contains(name) && !localizedPair && !faceLike) continue;
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

// Décompilation minimale utilisée pour comparer le catalogue cumulatif avec le
// chapitre précédent. Aucun sprite, font ou autre ressource du jeu n'est copié.
export function makeCodeOnlyCsx(outRoot) {
  const esc = outRoot.replace(/\\/g, "\\\\");
  return `// Généré par TranslatorTool — catalogue de référence local
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Linq;
using UndertaleModLib.Util;

EnsureDataLoaded();

string codeFolder = Path.Combine("${esc}", "CodeEntries");
Directory.CreateDirectory(codeFolder);
GlobalDecompileContext globalDecompileContext = new(Data);
Underanalyzer.Decompiler.IDecompileSettings decompilerSettings = Data.ToolInfo.DecompilerSettings;
List<UndertaleCode> toDump = Data.Code.Where(c => c.ParentEntry is null).ToList();
int done = 0;
Parallel.ForEach(toDump, code =>
{
    if (code is not null)
    {
        string output = Path.Combine(codeFolder, code.Name.Content + ".gml");
        try
        {
            File.WriteAllText(output, new Underanalyzer.Decompiler.DecompileContext(globalDecompileContext, code, decompilerSettings).DecompileToString());
        }
        catch (Exception error)
        {
            File.WriteAllText(output, "/*\\nDECOMPILER FAILED!\\n\\n" + error.ToString() + "\\n*/");
        }
    }
    Interlocked.Increment(ref done);
});
ScriptMessage($"CODE_ONLY_OK {done}");
`;
}
