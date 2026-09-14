// Limite le catalogue au chapitre importé. Les data.win récents sont cumulatifs :
// ils conservent une grande partie du code et des textes des chapitres précédents.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildReferenceFromLangJson,
  makeCodeOnlyCsx,
  scanCatalog,
} from "./import-lib.mjs";

function chapterFromDirectory(directory) {
  const name = path.basename(directory);
  const match = name.match(/chapter([0-9]+)/i);
  return match ? Number(match[1]) : null;
}

export function detectChapter(codeDir, dataWinPath = null) {
  const gamestart = path.join(codeDir, "gml_GlobalScript_scr_gamestart.gml");
  if (fs.existsSync(gamestart)) {
    const source = fs.readFileSync(gamestart, "utf8");
    const match = source.match(/\bglobal\.chapter\s*=\s*([0-9]+)\s*;/);
    if (match) return Number(match[1]);
  }
  return dataWinPath ? chapterFromDirectory(path.dirname(dataWinPath)) : null;
}

export function findPreviousChapterDataWin(dataWinPath, chapter) {
  if (!Number.isInteger(chapter) || chapter <= 1) return null;
  const gameDir = path.dirname(dataWinPath);
  const parent = path.dirname(gameDir);
  const currentName = path.basename(gameDir);
  const previousName = currentName.replace(
    /(chapter)([0-9]+)/i,
    (_whole, prefix) => `${prefix}${chapter - 1}`
  );
  if (previousName === currentName) return null;
  const candidate = path.join(parent, previousName, path.basename(dataWinPath));
  return fs.existsSync(candidate) ? candidate : null;
}

function cacheMatches(manifestPath, dataWinPath) {
  if (!fs.existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const stat = fs.statSync(dataWinPath);
    return (
      manifest.dataWinPath === path.resolve(dataWinPath) &&
      manifest.size === stat.size &&
      manifest.mtimeMs === stat.mtimeMs
    );
  } catch {
    return false;
  }
}

function extractBaselineCode(dataWinPath, cli, cacheDir, force, log) {
  const codeDir = path.join(cacheDir, "CodeEntries");
  const manifestPath = path.join(cacheDir, "source.json");
  const ready =
    fs.existsSync(codeDir) &&
    fs.readdirSync(codeDir).length > 100 &&
    cacheMatches(manifestPath, dataWinPath);
  if (ready && !force) {
    log("  référence du chapitre précédent : cache réutilisé.");
    return codeDir;
  }

  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const csxPath = path.join(os.tmpdir(), `deltatranslate_baseline_${Date.now()}.csx`);
  fs.writeFileSync(csxPath, makeCodeOnlyCsx(cacheDir), "utf8");
  const result = spawnSync(cli, ["load", dataWinPath, "-s", csxPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.rmSync(csxPath, { force: true });
  if (result.error) throw result.error;
  if (result.status !== 0 || !fs.existsSync(codeDir)) {
    throw new Error(
      `la décompilation du chapitre précédent a échoué.\n${(result.stderr || result.stdout || "").slice(-2000)}`
    );
  }
  const stat = fs.statSync(dataWinPath);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ dataWinPath: path.resolve(dataWinPath), size: stat.size, mtimeMs: stat.mtimeMs }),
    "utf8"
  );
  return codeDir;
}

function legacyEnglishPath(dataWinPath) {
  const langDir = path.join(path.dirname(dataWinPath), "lang");
  const original = path.join(langDir, "lang_en.json.original");
  const plain = path.join(langDir, "lang_en.json");
  if (fs.existsSync(original)) return original;
  if (fs.existsSync(plain)) return plain;
  return null;
}

function identity(entry) {
  const file = String(entry.file ?? "").replace(/\.gml$/, "");
  const english = String(entry.en ?? entry.english ?? "");
  return `${file}\u0000${english}`;
}

export function removeInheritedEntries(reference, previousEntries, retainedKeys = []) {
  const inherited = new Set(previousEntries.map(identity));
  const retained = new Set(retainedKeys);
  const scoped = {};
  let removed = 0;
  for (const [id, entry] of Object.entries(reference)) {
    // Une ligne conservée dans le fichier de langue doit garder son anglais
    // pour distinguer une traduction d'un texte encore identique à l'original.
    if (inherited.has(identity(entry)) && !retained.has(id)) {
      removed++;
      continue;
    }
    scoped[id] = entry;
  }
  return { reference: scoped, removed };
}

export function scopeReferenceToChapter({
  reference,
  codeDir,
  dataWinPath,
  cli,
  outDir,
  retainedKeys = [],
  force = false,
  log = () => {},
}) {
  const chapter = detectChapter(codeDir, dataWinPath);
  if (!chapter || chapter <= 1) {
    log(`  périmètre du chapitre : ${chapter === 1 ? "chapitre 1 (catalogue complet)" : "indéterminé"}.`);
    return { reference, chapter, removed: 0, scoped: chapter === 1 };
  }

  const previousDataWin = findPreviousChapterDataWin(dataWinPath, chapter);
  if (!previousDataWin) {
    log(
      `  AVERTISSEMENT : data.win du chapitre ${chapter - 1} introuvable à côté du chapitre courant ; catalogue cumulatif conservé.`
    );
    return { reference, chapter, removed: 0, scoped: false };
  }

  log(`  comparaison avec le chapitre ${chapter - 1} pour retirer les textes hérités…`);
  const cacheDir = path.join(outDir, `baseline-chapter${chapter - 1}`);
  const previousCodeDir = extractBaselineCode(previousDataWin, cli, cacheDir, force, log);
  let previousEntries = scanCatalog(previousCodeDir, log);
  if (previousEntries.length < 50) {
    const englishPath = legacyEnglishPath(previousDataWin);
    if (!englishPath) {
      log(
        `  AVERTISSEMENT : anglais du chapitre ${chapter - 1} introuvable ; catalogue cumulatif conservé.`
      );
      return { reference, chapter, removed: 0, scoped: false };
    }
    const english = JSON.parse(fs.readFileSync(englishPath, "utf8"));
    previousEntries = Object.values(buildReferenceFromLangJson(previousCodeDir, english, log));
  }

  const result = removeInheritedEntries(reference, previousEntries, retainedKeys);
  log(
    `  périmètre chapitre ${chapter} : ${Object.keys(result.reference).length} textes propres, modifiés ou déjà présents dans la traduction, ` +
      `${result.removed} textes hérités masqués.`
  );
  return { ...result, chapter, scoped: true, previousDataWin };
}
