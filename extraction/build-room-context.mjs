// Régénère les décors contextuels du chapitre configuré à partir du data.win.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runToolSync } from "./process-runner.mjs";
import { buildReference } from "./import-lib.mjs";
import {
  attachRoomContexts,
  collectRoomContextRequests,
  makeRoomContextCsx,
} from "./room-context.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const dataWin = config.sourceDataWinPath ?? config.dataWinPath;
const cli = path.join(
  config.utmtDir,
  process.platform === "win32" ? "UndertaleModCli.exe" : "UndertaleModCli"
);
const outDir = config.extractedDir;
const codeDir = path.join(outDir, "CodeEntries");
for (const required of [dataWin, cli, codeDir]) {
  if (!required || !fs.existsSync(required)) throw new Error(`Introuvable : ${required}`);
}

let ref = buildReference(codeDir, console.log);
const requests = collectRoomContextRequests(ref, codeDir);
const csx = path.join(os.tmpdir(), `deltatranslate_rooms_${Date.now()}.csx`);
fs.writeFileSync(csx, makeRoomContextCsx(outDir, requests), "utf8");
const result = runToolSync(cli, ["load", dataWin, "-s", csx], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});
fs.rmSync(csx, { force: true });
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
if (result.status !== 0) process.exit(result.status ?? 1);
ref = attachRoomContexts(ref, codeDir, outDir, console.log);
fs.writeFileSync(path.join(outDir, "reference.json"), JSON.stringify(ref), "utf8");
console.log(`reference.json écrit : ${Object.keys(ref).length} ids`);
