import fs from "node:fs";
import path from "node:path";

export function normalizeLanguage(value = "fr") {
  const code = String(value).trim().toLowerCase().replaceAll("-", "_");
  if (!/^[a-z]{2,3}(?:_[a-z0-9]{2,8}){0,2}$/.test(code)) {
    throw new Error("Code de langue invalide : utilise fr, es, de ou pt-BR, par exemple.");
  }
  if (code === "en" || code === "ja") {
    throw new Error("L’anglais et le japonais sont les langues originales. Choisis une nouvelle langue.");
  }
  return code;
}

export function readLanguage(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  if (!value || Array.isArray(value) || typeof value !== "object" ||
      Object.entries(value).some(([key, text]) => key !== "date" && typeof text !== "string")) {
    throw new Error(`Fichier de langue invalide : ${file}`);
  }
  return value;
}

export function serializeLanguage(value) {
  return "{\n" + Object.entries(value).map(([key, text]) =>
    `  ${JSON.stringify(key)}: ${JSON.stringify(text)}`).join(",\n") + "\n}";
}

export function prepareLanguage({ reference, language, langDir, workspace }) {
  const code = normalizeLanguage(language);
  const target = path.join(langDir, `lang_${code}.json`);
  // L’existence du fichier n’est pas une preuve que le code du jeu sait le charger.
  const existing = fs.existsSync(target) ? readLanguage(target) : null;
  const legacy = path.join(workspace, `translation_${code}.json`);
  const previous = existing ?? (fs.existsSync(legacy) ? readLanguage(legacy) : {});
  const merged = { date: previous.date ?? String(Date.now()), ...previous };
  for (const [key, entry] of Object.entries(reference)) {
    if (!Object.hasOwn(merged, key)) merged[key] = entry.en;
  }
  return { code, target, content: existing && Object.keys(merged).length === Object.keys(existing).length
    ? fs.readFileSync(target, "utf8") : serializeLanguage(merged) };
}

export function installedLanguages(langDir) {
  if (!fs.existsSync(langDir)) return [];
  return fs.readdirSync(langDir).flatMap((file) => {
    const code = file.match(/^lang_([a-z]{2,3}(?:_[a-z0-9]{2,8}){0,2})\.json$/)?.[1];
    return code && code !== "en" && code !== "ja" ? [code] : [];
  }).sort();
}
