// Régénère extracted/reference.json depuis extracted/CodeEntries
// (scan des appels de localisation + détection des visages — voir import-lib.mjs)
import fs from "node:fs";
import path from "node:path";
import { buildReference } from "./import-lib.mjs";
import { attachRoomContexts } from "./room-context.mjs";
import { ensureBattleActorSprites } from "./battle-actors.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const codeDir = path.join(ROOT, "extracted", "CodeEntries");
const ref = attachRoomContexts(
  buildReference(codeDir, console.log),
  codeDir,
  path.join(ROOT, "extracted"),
  console.log
);

// Sprites des acteurs de combat : best-effort via les chemins de config.json
// (le pipeline d'import complet fait la même passe pour les autres chapitres).
try {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const dataWin = config.dataWinPath;
  const cli = config.utmtDir
    ? path.join(
        config.utmtDir,
        process.platform === "win32" ? "UndertaleModCli.exe" : "UndertaleModCli"
      )
    : null;
  ensureBattleActorSprites({
    reference: ref,
    outDir: path.join(ROOT, "extracted"),
    dataWin,
    cli,
    force: process.argv.includes("--force"),
    log: console.log,
  });
} catch (err) {
  console.log(`  ⚠ sprites des acteurs de combat non extraits : ${err.message}`);
}

fs.writeFileSync(path.join(ROOT, "extracted", "reference.json"), JSON.stringify(ref));
console.log("reference.json écrit:", Object.keys(ref).length, "ids");
