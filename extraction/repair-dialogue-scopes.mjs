import fs from "node:fs";
import path from "node:path";
import { dialogueScopeStart, findFace, findSpeaker } from "./import-lib.mjs";

// Répare aussi les catalogues déjà importés, en mémoire. Les textes et les
// overrides utilisateur restent indépendants de ces métadonnées calculées.
export function repairDialogueScopes(reference, codeDir) {
  const files = new Map();
  for (const entry of Object.values(reference)) {
    if (!entry.file || !entry.line) continue;
    if (!files.has(entry.file)) {
      try {
        if (path.basename(entry.file) !== entry.file) continue;
        const file = entry.file.endsWith(".gml") ? entry.file : entry.file + ".gml";
        files.set(entry.file, fs.readFileSync(path.join(codeDir, file), "utf8").split(/\r?\n/));
      } catch { files.set(entry.file, null); }
    }
    const lines = files.get(entry.file);
    if (!lines) continue;
    entry.dialogueScope = dialogueScopeStart(lines, entry.line - 1);
    if (!entry.dialogueScope || entry.channel === "string") continue;
    const face = findFace(lines, entry.line - 1);
    const speaker = findSpeaker(lines, entry.line - 1);
    if (face) entry.face = face;
    else delete entry.face;
    if (speaker) entry.speaker = speaker;
    else delete entry.speaker;
  }
  return reference;
}
