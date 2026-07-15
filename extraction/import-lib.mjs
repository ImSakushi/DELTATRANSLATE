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

  const stringLiteral = '"(?:[^"\\\\]|\\\\.)*"';
  const languageTernary = new RegExp(
    `^\\(?\\s*global\\.lang\\s*(==|!=)\\s*(${stringLiteral})\\s*\\)?\\s*\\?\\s*(${stringLiteral})\\s*:\\s*(${stringLiteral})\\s*$`,
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

export function scanCatalog(codeDir, log = () => {}) {
  const files = fs.readdirSync(codeDir).filter((f) => f.endsWith(".gml"));
  const entries = [];
  let scanned = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(codeDir, file), "utf8");
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
        entry.substitutions = parsed.args
          .slice(spec.textArg + 1, -1)
          .map((arg) => resolveStaticSubstitution(arg));
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

// Cherche le visage actif pour la ligne `lineIdx` (0-based) en remontant.
// Le visage persiste de message en message jusqu'à changement explicite,
// d'où une fenêtre de scan large. Le plus proche match gagne.
function findFace(lines, lineIdx) {
  const from = Math.max(0, lineIdx - 120);
  for (let i = lineIdx; i >= from; i--) {
    const l = lines[i];

    // c_facenext("susie", "C") / c_face / c_msgface — le plus courant en cutscene
    let m = l.match(/c_(?:facenext|face|msgface)\(\s*"([\w ]+)"\s*,\s*([^,)]+)/);
    if (m) {
      const fc = SPEAKER_FC[m[1].toLowerCase()];
      if (fc !== undefined) return fc === 0 ? null : { fc, fe: decodeEmotion(m[2]) ?? 0 };
    }
    // scr_anyface_next("susie", emotion)
    m = l.match(/scr_anyface_next\(\s*"([\w ]+)"\s*,\s*([^,)]+)\s*\)/);
    if (m) {
      const fc = SPEAKER_FC[m[1].toLowerCase()];
      if (fc !== undefined) return fc === 0 ? null : { fc, fe: decodeEmotion(m[2]) ?? 0 };
    }
    // scr_anyface("susie", msgno, emotion)
    m = l.match(/scr_anyface\(\s*"([\w ]+)"\s*,\s*[^,]+,\s*([^,)]+)\s*\)/);
    if (m) {
      const fc = SPEAKER_FC[m[1].toLowerCase()];
      if (fc !== undefined) return fc === 0 ? null : { fc, fe: decodeEmotion(m[2]) ?? 0 };
    }
    // scr_susface(msgno, emotion) et variantes dédiées
    m = l.match(/(scr_\w*face)\(\s*[^,)]+(?:,\s*([^,)]+))?\)/);
    if (m && FACE_FN_FC[m[1]]) {
      return { fc: FACE_FN_FC[m[1]], fe: decodeEmotion(m[2]) ?? 0 };
    }
    // c_speaker("susie") / scr_speaker : remet fc à 0 puis pose le visage du
    // personnage (scr_speaker : susie→1, ralsei→2, noelle→3, queen→21, etc.)
    m = l.match(/(?:c_speaker|scr_speaker)\(\s*"([\w ]+)"/);
    if (m && i !== lineIdx) {
      const fc = SPEAKER_FC[m[1].toLowerCase()];
      return fc ? { fc, fe: 0 } : null;
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
          return { fc, fe };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Construit reference.json à partir du dossier CodeEntries
// ---------------------------------------------------------------------------
export function buildReference(codeDir, log = () => {}) {
  const entries = scanCatalog(codeDir, log);
  log(`  ${entries.length} appels localisés trouvés`);
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
  for (const e of entries) {
    if (ref[e.id]) continue;
    const entry = {
      en: e.english,
      call: e.call,
      channel: e.channel,
      file: e.file.replace(/\.gml$/, ""),
      line: e.line,
    };
    if (e.substitutions?.length) entry.substitutions = e.substitutions;
    if (e.channel !== "string") {
      const lines = getLines(e.file);
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
  log(`  ${Object.keys(ref).length} ids uniques, ${faceCount} visages détectés`);
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
      if (/global\.msg\[|msgset|msgnext/.test(ctx)) entry.channel = "message";
      else if (/c_cmd|cutscene/.test(ctx)) entry.channel = "cutscene-message";
      if (entry.channel !== "string" && lines) {
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
        sw.WriteLine($"{spr.Name.Content};{spr.Textures.Count};{spr.Width};{spr.Height}");
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
    "button_", "spr_smallface", "spr_darkface", "spr_alphysface"
};
int exported = 0;
using (TextureWorker worker = new())
{
    foreach (var spr in Data.Sprites)
    {
        if (spr is null) continue;
        string name = spr.Name.Content;
        if (!prefixes.Any(p => name.StartsWith(p))) continue;
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
