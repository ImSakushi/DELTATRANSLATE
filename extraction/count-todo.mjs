// Réplique exacte de computeTodo/hasWords d'app.js pour vérification
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ref = JSON.parse(fs.readFileSync(path.join(ROOT, "extracted", "reference.json"), "utf8"));
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
} catch {}
const langPath =
  cfg.langFrPath ??
  "E:\\SteamLibrary\\steamapps\\common\\DELTARUNE - Traduction FR\\chapter5_windows\\lang\\lang_fr.json";
const lang = JSON.parse(fs.readFileSync(langPath, "utf8"));
const prefs = JSON.parse(fs.readFileSync(path.join(ROOT, "prefs.json"), "utf8"));

function hasWords(text) {
  const stripped = text
    .replace(/`./g, "")
    .replace(/\\../g, "")
    .replace(/\^[0-9]/g, "")
    .replace(/[&|/%*#~0-9\s.,!?'"()\-:;]/g, "");
  return /[A-Za-zÀ-ÿ]/.test(stripped);
}

let withRef = 0, todo = 0, sameNoWords = 0, validated = 0;
const samples = [];
for (const key of Object.keys(lang)) {
  if (key === "date") continue;
  const r = ref[key];
  if (!r) continue;
  withRef++;
  const fr = lang[key];
  if (fr === r.en) {
    if (!hasWords(r.en)) { sameNoWords++; continue; }
    if (prefs.validated?.[key]) { validated++; continue; }
    todo++;
    if (samples.length < 5) samples.push(key + " | " + r.en.slice(0, 40));
  }
}
console.log({ withRef, todo, sameNoWords, validated, done: withRef - todo });
console.log(samples);
