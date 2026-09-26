// Export ciblé des sprites des acteurs de combat (personnage qui parle dans
// une bulle obj_battleblcon). Les sprites nécessaires sont détectés par
// findBubbleActor (import-lib.mjs) et rangés dans reference.json ; cette passe
// UTMT les extrait vers <outDir>/sprites/ où la preview les charge comme les
// autres. Aucun sprite n'est distribué avec l'outil : tout vient du data.win
// de l'utilisateur (contrainte de distribution, CLAUDE.md §2.1).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runToolSync } from "./process-runner.mjs";

export const BATTLE_ACTORS_VERSION = 1;

export function collectBubbleActorSprites(reference) {
  const names = new Set();
  for (const entry of Object.values(reference ?? {})) {
    for (const sprite of entry?.bubbleActor?.sprites ?? []) {
      if (/^[A-Za-z0-9_]+$/.test(sprite)) names.add(sprite);
    }
  }
  return [...names].sort();
}

export function makeBattleActorsCsx(outDir, names) {
  const esc = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const csxNames = names.map((name) => `"${esc(name)}"`).join(", ");
  return `// Généré par TranslatorTool — sprites des acteurs de combat (bulles)
using System;
using System.IO;
using System.Linq;
using UndertaleModLib.Util;

EnsureDataLoaded();
string spriteFolder = Path.Combine("${esc(outDir)}", "sprites");
Directory.CreateDirectory(spriteFolder);
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
            try
            {
                worker.ExportAsPNG(sprite.Textures[frame].Texture, Path.Combine(spriteFolder, $"{name}_{frame}.png"), null, true);
                exported++;
            }
            catch (Exception) {}
        }
    }
}
ScriptMessage($"BATTLE_ACTORS_OK {exported}");
`;
}

// Lance la passe UTMT si le manifeste ne couvre pas déjà tous les sprites
// demandés. Échec non fatal : la preview des bulles retombe sur le rendu sans
// personnage, avec un avertissement invitant à réimporter.
export function ensureBattleActorSprites({
  reference,
  outDir,
  dataWin,
  cli,
  force = false,
  log = () => {},
}) {
  const sprites = collectBubbleActorSprites(reference);
  if (!sprites.length) return true;

  const manifestPath = path.join(outDir, "battle-actors.json");
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {}
  const upToDate =
    (manifest?.version ?? 0) >= BATTLE_ACTORS_VERSION &&
    sprites.every((name) => manifest.sprites?.includes(name));
  if (upToDate && !force) {
    log("  sprites des acteurs de combat : déjà extraits.");
    return true;
  }
  if (!dataWin || !fs.existsSync(dataWin) || !cli || !fs.existsSync(cli)) {
    log("  ⚠ data.win ou UTMT introuvable — sprites des acteurs de combat non extraits.");
    return false;
  }

  log(`  extraction de ${sprites.length} sprites d'acteurs de combat…`);
  const csxPath = path.join(os.tmpdir(), `deltatranslate_actors_${Date.now()}.csx`);
  fs.writeFileSync(csxPath, makeBattleActorsCsx(outDir, sprites), "utf8");
  const result = runToolSync(cli, ["load", dataWin, "-s", csxPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.rmSync(csxPath, { force: true });
  for (const line of (result.stdout || "").split(/\r?\n/)) {
    if (line.trim().startsWith("BATTLE_ACTORS_")) log(`  ${line.trim()}`);
  }
  const ok =
    !result.error && result.status === 0 && /BATTLE_ACTORS_OK/.test(result.stdout || "");
  if (!ok) {
    log("  ⚠ extraction des acteurs de combat échouée — la preview des bulles restera sans personnage.");
    log((result.stderr || result.stdout || "").slice(-1000));
    return false;
  }
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ version: BATTLE_ACTORS_VERSION, sprites }),
    "utf8"
  );
  return true;
}
