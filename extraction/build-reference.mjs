// Régénère extracted/reference.json depuis extracted/CodeEntries
// (scan des appels de localisation + détection des visages — voir import-lib.mjs)
import fs from "node:fs";
import path from "node:path";
import { buildReference } from "./import-lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const codeDir = path.join(ROOT, "extracted", "CodeEntries");
const ref = buildReference(codeDir, console.log);
fs.writeFileSync(path.join(ROOT, "extracted", "reference.json"), JSON.stringify(ref));
console.log("reference.json écrit:", Object.keys(ref).length, "ids");
