// Import complet d'un data.win DELTARUNE :
//   node extraction/import-datawin.mjs --datawin "<...>/data.win" --cli "<UndertaleModCli>"
// 1. extrait code GML + fonts + sprites via UndertaleModTool CLI
// 2. construit reference.json (catalogue EN + visages)
// 3. ajoute une langue indépendante et son sélecteur dans le jeu
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { refreshFonts } from "./refresh-fonts.mjs";
import { runTool } from "./process-runner.mjs";
import { beginWorkspace, commitWorkspace, abandonWorkspace } from "./workspace-transaction.mjs";
import { chooseSource, recordGeneratedVersion } from "./source-version.mjs";
import { normalizeLanguage } from "./languages.mjs";
import { planMigration } from "./translation-migration.mjs";
import { installLanguage, restoreTransaction } from "./install-language.mjs";
import {
  buildReference,
  buildReferenceFromLangJson,
  makeCsx,
} from "./import-lib.mjs";
import { scopeReferenceToChapter } from "./chapter-scope.mjs";
import {
  ROOM_CONTEXT_VERSION,
  attachRoomContexts,
  collectRoomContextRequests,
  makeRoomContextCsx,
} from "./room-context.mjs";
import { ensureBattleActorSprites } from "./battle-actors.mjs";
import { extractionDirectory } from "./workspace-path.mjs";

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
    "battle-actors.json",
    "extraction-source.json",
    "font-extraction-source.json",
  ]) {
    fs.rmSync(path.join(outDir, file), { force: true });
  }
}

const dataWin = arg("datawin");
const targetLanguage = normalizeLanguage(arg("language", "fr"));
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
const extractionRoot = path.resolve(arg("outdir", path.join(ROOT, "extracted-imports")));
const finalDir = extractionDirectory(extractionRoot, dataWin);
const transaction = beginWorkspace(finalDir, stage => log(`IMPORT_WORKSPACE ${JSON.stringify(stage)}`));
const outDir = transaction.stage;
let committed = false;
process.on("exit", () => { if (!committed) { try { abandonWorkspace(transaction); } catch {} } });

const langDir = path.join(gameDir, "lang");
const previousReferencePath = path.join(outDir, "reference.json");
const previousReference = fs.existsSync(previousReferencePath) ? JSON.parse(fs.readFileSync(previousReferencePath, "utf8")) : {};
const previousLanguagePath = [path.join(langDir, `lang_${targetLanguage}.json`), path.join(outDir, `translation_${targetLanguage}.json`)].find(file => fs.existsSync(file));
const previousLanguage = previousLanguagePath ? JSON.parse(fs.readFileSync(previousLanguagePath, "utf8")) : {};
const version = chooseSource(dataWin, outDir, { hasLangFr: false, originalConfirmed: process.argv.includes("--new-original") });
const sourceDataWin = version.source;
if (version.changed) {
  log("Nouvelle version du jeu : conservation des anciennes modifications GML et sprites dans un historique séparé.");
  for (const directory of ["CodeOverrides", "SpriteOverrides", "LanguageSprites"]) {
    const previous = path.join(outDir, directory);
    if (fs.existsSync(previous)) fs.renameSync(previous, path.join(outDir, directory + "-previous-" + Date.now()));
  }
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
  const result = await runTool(cli, ["load", sourceDataWin, "-s", csxPath]);
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
}

const scope = scopeReferenceToChapter({
  reference: ref,
  retainedKeys: Object.keys(previousLanguage),
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
let roomContextVersion = 0;
try {
  roomContextVersion = JSON.parse(fs.readFileSync(roomContextPath, "utf8")).version ?? 0;
} catch {}
const hasRoomContext =
  roomContextVersion >= ROOM_CONTEXT_VERSION &&
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
  const roomResult = await runTool(cli, ["load", sourceDataWin, "-s", roomCsxPath]);
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

// --- 2c. sprites des acteurs de combat (personnage qui parle en bulle) ---
ensureBattleActorSprites({
  reference: ref,
  outDir,
  dataWin: sourceDataWin,
  cli,
  force,
  log,
});

// Conserver la référence JP avec le cache lorsque l’installation est déplacée.
const japanesePath = path.join(path.dirname(sourceDataWin), "lang", "lang_ja.json");
if (fs.existsSync(japanesePath)) fs.copyFileSync(japanesePath, path.join(outDir, "lang_ja.json"));

const referencePath = path.join(outDir, "reference.json");
fs.writeFileSync(referencePath, JSON.stringify(ref), "utf8");
const migration = planMigration(previousReference, ref, previousLanguage);
fs.writeFileSync(path.join(outDir, `migration-${targetLanguage}.json`), JSON.stringify(migration), "utf8");
log(`Migration : ${Object.keys(migration.suggestions).length} traductions retrouvées, ${migration.review.length} textes anglais modifiés à relire, ${migration.orphaned.length} clés conservées sans référence.`);

// --- 3. cible de traduction ---
log("Étape 3/3 — cible de traduction…");
const beforeInstall = async () => {
  if (!process.argv.includes("--coordinated-install")) return;
  await new Promise((resolve, reject) => {
    process.stdin.once("data", (data) => {
      // Sous Windows, pause() laisse le pipe actif et empêche la fin du processus.
      process.stdin.destroy();
      if (data.toString().trim() === "INSTALL") resolve();
      else reject(new Error("Installation interrompue avant toute écriture."));
    });
    process.stdin.resume();
    log("IMPORT_INSTALLING");
  });
};
const languageConfig = await installLanguage({ dataWin, source: sourceDataWin, cli, codeDir,
  workspace: outDir, reference: ref, language: targetLanguage, fontDonor: arg("font-donor"), force, log, beforeInstall });
try {
  // Les variantes de langue et les glyphes du donneur n'existent qu'après
  // installLanguage : la preview doit suivre le fichier effectivement joué.
  log("Actualisation des polices de la preview…");
  await refreshFonts({ cli, dataWin, outDir, force });
  recordGeneratedVersion(dataWin, outDir);
  commitWorkspace(transaction);
  committed = true;
} catch (error) {
  restoreTransaction(languageConfig.installationBackup);
  throw error;
}
log(`  Langue ${targetLanguage.toUpperCase()} prête : ${languageConfig.langFrPath}`);
console.log(
  `IMPORT_DONE ${JSON.stringify({
    extractedDir: finalDir,
    ...languageConfig,
    dataWinPath: dataWin,
    sourceDataWinPath: sourceDataWin,
  })}`
);
