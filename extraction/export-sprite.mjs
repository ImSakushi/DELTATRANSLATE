// Extrait à la demande les frames complètes d'un ou plusieurs sprites.
// Le cache obtenu reste local au workspace et n'est jamais distribué.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

const dataWin = required("datawin");
const cli = required("cli");
const output = required("output");
const names = String(arg("names") ?? "")
  .split("|")
  .map((name) => name.trim())
  .filter(Boolean);

if (!fs.existsSync(dataWin)) throw new Error(`data.win introuvable : ${dataWin}`);
if (!fs.existsSync(cli)) throw new Error(`UndertaleModCli introuvable : ${cli}`);
if (!names.length) throw new Error("Aucun sprite à extraire.");
if (names.some((name) => !/^[A-Za-z0-9_]+$/.test(name))) {
  throw new Error("Nom de sprite invalide.");
}

fs.mkdirSync(output, { recursive: true });
const scriptPath = path.join(os.tmpdir(), `deltatranslate_sprite_${Date.now()}.csx`);
const csxNames = names.map((name) => `"${csxString(name)}"`).join(", ");
fs.writeFileSync(
  scriptPath,
  `using System;
using System.IO;
using System.Linq;
using UndertaleModLib.Util;

EnsureDataLoaded();
string output = "${csxString(output)}";
Directory.CreateDirectory(output);
string[] names = new string[] { ${csxNames} };
int exported = 0;
using (TextureWorker worker = new())
{
    foreach (string name in names)
    {
        var sprite = Data.Sprites.ByName(name);
        if (sprite is null) continue;
        for (int frame = 0; frame < sprite.Textures.Count; frame++)
        {
            if (sprite.Textures[frame]?.Texture is null) continue;
            worker.ExportAsPNG(
                sprite.Textures[frame].Texture,
                Path.Combine(output, $"{name}_{frame}.png"),
                null,
                true
            );
            exported++;
        }
    }
}
ScriptMessage($"SPRITE_EXPORT_DONE {exported}");
`,
  "utf8"
);

try {
  const result = spawnSync(cli, ["load", dataWin, "-s", scriptPath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`UTMT a quitté avec le code ${result.status}.`);
  }
} finally {
  fs.rmSync(scriptPath, { force: true });
}
