// Debug temporaire : liste les substitutions irrésolues avec leur expression brute
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codeDir = path.join(ROOT, "extracted", "CodeEntries");

const src = fs.readFileSync(path.join(ROOT, "extraction", "import-lib.mjs"), "utf8");
// réutilise parseArgs via import
const lib = await import("./import-lib.mjs");

const CALL_RE =
  /\b(stringsetsubloc|msgsetsubloc|msgnextsubloc|c_msgsetsubloc|c_msgnextsubloc)\s*\(/g;
const TEXT_ARG = { stringsetsubloc: 0, msgsetsubloc: 1, msgnextsubloc: 0, c_msgsetsubloc: 1, c_msgnextsubloc: 0 };

// copie minimale de parseArgs (non exporté) : on ré-extrait avec une regex d'équilibrage simple
function parseArgs(text, openIdx) {
  const args = [];
  let depth = 1, cur = "", i = openIdx, inStr = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      cur += ch;
      if (ch === "\\") { cur += text[++i]; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") { depth--; if (depth === 0) break; }
    if (ch === "," && depth === 1) { args.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  args.push(cur.trim());
  return args;
}

for (const file of fs.readdirSync(codeDir).filter((f) => f.endsWith(".gml"))) {
  const text = fs.readFileSync(path.join(codeDir, file), "utf8");
  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(text))) {
    const args = parseArgs(text, m.index + m[0].length);
    const ta = TEXT_ARG[m[1]];
    const subs = args.slice(ta + 1, -1);
    const nonLiteral = subs.filter((s) => !/^"/.test(s) && !/global\.lang/.test(s));
    if (nonLiteral.length) {
      console.log(`${file} :: ${m[1]}`);
      console.log(`   id=${args.at(-1)}`);
      for (const s of subs) console.log(`   ARG: ${s}`);
    }
  }
}
