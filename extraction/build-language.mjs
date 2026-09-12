import path from "node:path";
import { buildLanguageDataWin } from "./install-language.mjs";
import { installedLanguages, normalizeLanguage } from "./languages.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Argument --${name} absent.`);
  return process.argv[index + 1];
}
const source = arg("source");
const dataWin = arg("datawin");
const languages = [...new Set([...installedLanguages(path.join(path.dirname(dataWin), "lang")), normalizeLanguage(arg("language"))])].sort();
await buildLanguageDataWin({ source, output: arg("output"), cli: arg("cli"), codeDir: arg("code"),
  workspace: arg("workspace"), languages });
