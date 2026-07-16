// Import complet d'un data.win DELTARUNE :
//   node extraction/import-datawin.mjs --datawin "<...>/data.win" --cli "<UndertaleModCli>"
// 1. extrait code GML + fonts + sprites via UndertaleModTool CLI
// 2. construit reference.json (catalogue EN + visages)
// 3. utilise lang_fr.json s'il existe, sinon prépare un workspace dont les
//    sauvegardes seront recompilées directement dans data.win
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { buildReference, buildReferenceFromLangJson, makeCsx } from "./import-lib.mjs";
import { scopeReferenceToChapter } from "./chapter-scope.mjs";
import {
  attachRoomContexts,
  collectRoomContextRequests,
  makeRoomContextCsx,
} from "./room-context.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function sourceFingerprint(file) {
  const stat = fs.statSync(file);
  return { path: path.resolve(file), size: stat.size, mtimeMs: stat.mtimeMs };
}

function extractionMatches(manifestPath, source) {
  if (!fs.existsSync(manifestPath)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const current = sourceFingerprint(source);
    return (
      saved.path === current.path &&
      saved.size === current.size &&
      saved.mtimeMs === current.mtimeMs
    );
  } catch {
    return false;
  }
}

function clearGeneratedExtraction(outDir) {
  for (const directory of ["CodeEntries", "fonts", "sprites", "SpriteEditorCache", "room-scenes"]) {
    fs.rmSync(path.join(outDir, directory), { recursive: true, force: true });
  }
  for (const file of [
    "sprites_list.txt",
    "reference.json",
    "room-context.json",
    "chapter-scope.json",
    "extraction-source.json",
  ]) {
    fs.rmSync(path.join(outDir, file), { force: true });
  }
}

const dataWin = arg("datawin");
const utmtDir = arg("utmt");
const cli =
  arg("cli") ??
  (utmtDir
    ? path.join(utmtDir, process.platform === "win32" ? "UndertaleModCli.exe" : "UndertaleModCli")
    : null);
const log = (message) => console.log(message);

if (!dataWin || !fs.existsSync(dataWin)) {
  console.error(`ERREUR: data.win introuvable : ${dataWin}`);
  process.exit(1);
}
if (!cli || !fs.existsSync(cli)) {
  console.error(`ERREUR: UndertaleModCli introuvable : ${cli}`);
  console.error("Indique l'exécutable avec --cli ou son dossier avec --utmt.");
  process.exit(1);
}

const gameDir = path.dirname(dataWin);
const name = path.basename(gameDir).replace(/[^\w.-]+/g, "_");
const extractionRoot = path.resolve(arg("outdir", path.join(ROOT, "extracted-imports")));
const outDir = path.join(extractionRoot, name);
fs.mkdirSync(outDir, { recursive: true });

const langDir = path.join(gameDir, "lang");
const langFrCandidate = path.join(langDir, "lang_fr.json");
const hasLangFr = fs.existsSync(langFrCandidate);
const originalDataWin = path.join(gameDir, "data-original.win");
let sourceDataWin = dataWin;
if (!hasLangFr) {
  if (!fs.existsSync(originalDataWin)) {
    fs.copyFileSync(dataWin, originalDataWin);
    log(`Snapshot anglais créé : ${originalDataWin}`);
  }
  sourceDataWin = originalDataWin;
  log(`Source de vérité : ${sourceDataWin}`);
}

log(`Import de : ${sourceDataWin}`);
log(`Destination : ${outDir}`);

// --- 1. extraction UTMT ---
const force = process.argv.includes("--force");
const codeDir = path.join(outDir, "CodeEntries");
const extractionManifestPath = path.join(outDir, "extraction-source.json");
const alreadyExtracted =
  fs.existsSync(codeDir) &&
  fs.readdirSync(codeDir).length > 100 &&
  extractionMatches(extractionManifestPath, sourceDataWin);
if (alreadyExtracted && !force) {
  log("Étape 1/3 — extraction UTMT : déjà faite (utilise --force pour refaire).");
} else {
  clearGeneratedExtraction(outDir);
  log("Étape 1/3 — extraction UTMT (peut prendre quelques minutes)…");
  const csxPath = path.join(os.tmpdir(), `deltatranslate_export_${Date.now()}.csx`);
  fs.writeFileSync(csxPath, makeCsx(outDir), "utf8");
  const result = spawnSync(cli, ["load", sourceDataWin, "-s", csxPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.rmSync(csxPath, { force: true });
  if (result.error) {
    console.error(`ERREUR UTMT: ${result.error.message}`);
    process.exit(1);
  }
  for (const line of (result.stdout || "").split(/\r?\n/)) {
    if (/^(SPRITELIST|FONTS|SPRITES|CODE)_/.test(line.trim())) log(`  ${line.trim()}`);
  }
  if (result.status !== 0 || !fs.existsSync(codeDir)) {
    console.error("ERREUR: la décompilation n'a rien produit.");
    console.error((result.stdout || "").slice(-2000));
    console.error((result.stderr || "").slice(-2000));
    process.exit(1);
  }
  fs.writeFileSync(
    extractionManifestPath,
    JSON.stringify(sourceFingerprint(sourceDataWin)),
    "utf8"
  );
}

// --- 2. référence anglaise + visages ---
log("Étape 2/3 — catalogue anglais + détection des visages…");
let ref = buildReference(codeDir, log);
let legacyLanguagePath = null;
if (Object.keys(ref).length < 50) {
  // Chapitres 1/2 : l'anglais vit dans lang_en.json, pas inline dans le code.
  log("  peu d'appels inline — bascule sur l'ancien système (lang_en.json)…");
  const originalLang = path.join(langDir, "lang_en.json.original");
  const plainLang = path.join(langDir, "lang_en.json");
  const englishSource = fs.existsSync(originalLang)
    ? originalLang
    : fs.existsSync(plainLang)
      ? plainLang
      : null;
  if (!englishSource) {
    console.error("ERREUR: aucun lang_en.json trouvé à côté du data.win.");
    process.exit(1);
  }
  if (englishSource === plainLang && !fs.existsSync(originalLang)) {
    fs.copyFileSync(plainLang, originalLang);
    log(`  snapshot anglais créé : ${originalLang}`);
  }
  const enJson = JSON.parse(fs.readFileSync(englishSource, "utf8"));
  ref = buildReferenceFromLangJson(codeDir, enJson, log);
  legacyLanguagePath = plainLang;
}

const scope = scopeReferenceToChapter({
  reference: ref,
  codeDir,
  dataWinPath: dataWin,
  cli,
  outDir,
  force,
  log,
});
ref = scope.reference;
fs.writeFileSync(
  path.join(outDir, "chapter-scope.json"),
  JSON.stringify({
    chapter: scope.chapter,
    scoped: scope.scoped,
    removed: scope.removed,
    count: Object.keys(ref).length,
  }),
  "utf8"
);

// --- 2b. rooms + vues contextuelles ---
const roomContextPath = path.join(outDir, "room-context.json");
const roomScenesDir = path.join(outDir, "room-scenes");
const hasRoomContext =
  fs.existsSync(roomContextPath) &&
  fs.existsSync(roomScenesDir) &&
  fs.readdirSync(roomScenesDir).some((name) => name.endsWith(".png"));
if (hasRoomContext && !force) {
  log("  contexte des rooms : déjà extrait (utilise --force pour refaire).");
} else {
  log("  extraction automatique des décors et placements de texte…");
  fs.mkdirSync(roomScenesDir, { recursive: true });
  const requests = collectRoomContextRequests(ref, codeDir);
  const roomCsxPath = path.join(os.tmpdir(), `deltatranslate_rooms_${Date.now()}.csx`);
  fs.writeFileSync(roomCsxPath, makeRoomContextCsx(outDir, requests), "utf8");
  const roomResult = spawnSync(cli, ["load", sourceDataWin, "-s", roomCsxPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.rmSync(roomCsxPath, { force: true });
  for (const line of (roomResult.stdout || "").split(/\r?\n/)) {
    if (line.trim().startsWith("ROOM_CONTEXT_")) log(`  ${line.trim()}`);
  }
  if (roomResult.status !== 0 || !fs.existsSync(roomContextPath)) {
    console.error("ERREUR: l’extraction du contexte des rooms a échoué.");
    console.error((roomResult.stdout || "").slice(-3000));
    console.error((roomResult.stderr || "").slice(-3000));
    process.exit(1);
  }
}
attachRoomContexts(ref, codeDir, outDir, log);
const referencePath = path.join(outDir, "reference.json");
fs.writeFileSync(referencePath, JSON.stringify(ref), "utf8");

// --- 3. cible de traduction ---
log("Étape 3/3 — cible de traduction…");
let langFrPath;
let storageMode;
if (hasLangFr) {
  langFrPath = langFrCandidate;
  storageMode = "lang-json";
  log(`  lang_fr.json existant : ${langFrPath}`);
} else if (legacyLanguagePath && fs.existsSync(legacyLanguagePath)) {
  // Ces chapitres lisent lang_en.json à l'exécution : modifier data.win ne
  // changerait rien. Le snapshot .original reste la source anglaise immuable.
  langFrPath = legacyLanguagePath;
  storageMode = "lang-json";
  log(`  ancien système : édition directe de ${langFrPath}`);
} else {
  langFrPath = path.join(outDir, "translation_fr.json");
  storageMode = "datawin";
  if (!fs.existsSync(langFrPath)) {
    const ids = Object.keys(ref);
    const lines = ["{", `  "date": ${JSON.stringify(String(Date.now()))},`];
    ids.forEach((id, index) => {
      const comma = index < ids.length - 1 ? "," : "";
      lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(ref[id].en)}${comma}`);
    });
    lines.push("}");
    fs.writeFileSync(langFrPath, lines.join("\n"), "utf8");
  }
  log(`  mode data.win : workspace ${langFrPath}`);
  log(`  chaque sauvegarde recompilera ${dataWin} depuis le snapshot anglais.`);
}

console.log(
  `IMPORT_DONE ${JSON.stringify({
    extractedDir: outDir,
    langFrPath,
    dataWinPath: dataWin,
    sourceDataWinPath: sourceDataWin,
    storageMode,
  })}`
);
