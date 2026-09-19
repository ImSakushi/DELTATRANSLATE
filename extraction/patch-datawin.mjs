// Reconstruit un data.win depuis le snapshot anglais et les traductions.
// Le fichier source n'est jamais modifié : UTMT écrit dans --output, puis le
// processus principal remplace le data.win actif de façon sûre.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { spriteImportCsx } from "./sprite-overrides.mjs";
import { prepareCodeEntries } from "./code-overrides.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Argument --${name} manquant.`);
  return path.resolve(value);
}

function csxString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const source = required("source");
const output = required("output");
const cli = required("cli");
const codeDir = required("code");
const referencePath = required("reference");
const translationPath = arg("translation") ? path.resolve(arg("translation")) : null;
const overridesDir = arg("overrides") ? path.resolve(arg("overrides")) : null;
const spriteOverridesDir = arg("sprites") ? path.resolve(arg("sprites")) : null;
const overridesOnly = process.argv.includes("--overrides-only");

if (!overridesOnly && !translationPath) {
  throw new Error("Argument --translation manquant.");
}
for (const file of [source, cli, referencePath, ...(translationPath ? [translationPath] : [])]) {
  if (!fs.existsSync(file)) throw new Error(`Fichier introuvable : ${file}`);
}
if (!fs.existsSync(codeDir)) throw new Error(`Code GML extrait introuvable : ${codeDir}`);

const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"));
const translation = overridesOnly
  ? {}
  : JSON.parse(fs.readFileSync(translationPath, "utf8"));
const translated = {};
for (const [id, entry] of Object.entries(reference)) {
  if (translation[id] != null && String(translation[id]) !== String(entry.en)) {
    translated[id] = String(translation[id]);
  }
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-patch-"));
const patchedDir = path.join(temporary, "CodeEntries");
fs.mkdirSync(patchedDir);
const spriteCount =
  spriteOverridesDir && fs.existsSync(spriteOverridesDir)
    ? fs
        .readdirSync(spriteOverridesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .reduce(
          (total, entry) =>
            total +
            fs
              .readdirSync(path.join(spriteOverridesDir, entry.name))
              .filter((name) => /^\d+\.png$/i.test(name)).length,
          0
        )
    : 0;
try {
  const { siteCount, fileCount, overrideCount } = prepareCodeEntries({
    codeDir,
    overridesDir,
    outputDir: patchedDir,
    translations: translated,
  });

  console.log(
    `PATCH_INFO ${fileCount} fichiers GML, ${overrideCount} overrides, ` +
      `${siteCount} sites traduits, ${spriteCount} frames de sprites`
  );
  fs.rmSync(output, { force: true });
  if (!fileCount && !spriteCount) {
    fs.copyFileSync(source, output);
    console.log("PATCH_DONE aucune traduction différente de l’anglais");
    process.exit(0);
  }

  const scriptPath = path.join(temporary, "import.csx");
  const escapedDir = csxString(patchedDir);
  const escapedSpriteDir = csxString(spriteOverridesDir ?? "");
  fs.writeFileSync(
    scriptPath,
    `using System;
using System.IO;
using ImageMagick;
using UndertaleModLib;
using UndertaleModLib.Models;
using UndertaleModLib.Util;

EnsureDataLoaded();
string importFolder = "${escapedDir}";
string[] files = Directory.GetFiles(importFolder, "*.gml");
UndertaleModLib.Compiler.CodeImportGroup importGroup = new(Data)
{
    AutoCreateAssets = false,
    MainThreadAction = MainThreadAction
};
foreach (string file in files)
{
    importGroup.QueueReplace(Path.GetFileNameWithoutExtension(file), File.ReadAllText(file));
}
importGroup.Import();
ScriptMessage($"PATCH_COMPILED {files.Length}");

${spriteImportCsx}
string spriteFolder = "${escapedSpriteDir}";
int importedSprites = 0;
if (Directory.Exists(spriteFolder))
{
    foreach (string spriteDirectory in Directory.GetDirectories(spriteFolder))
    {
        string spriteName = Path.GetFileName(spriteDirectory);
        var sprite = Data.Sprites.ByName(spriteName);
        if (sprite is null)
            throw new Exception($"Sprite cible introuvable : {spriteName}");

        importedSprites += ImportSpriteFrames(sprite, spriteDirectory);
    }
}
ScriptMessage($"SPRITES_PATCHED {importedSprites}");
`,
    "utf8"
  );

  const result = spawnSync(cli, ["load", source, "-s", scriptPath, "-o", output], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`UTMT a quitté avec le code ${result.status}.`);
  if (!fs.existsSync(output) || fs.statSync(output).size < 1024 * 1024) {
    throw new Error("UTMT n’a pas produit de data.win valide.");
  }
  console.log(`PATCH_DONE ${siteCount} sites écrits dans ${output}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
