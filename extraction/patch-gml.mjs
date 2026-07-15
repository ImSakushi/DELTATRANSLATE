// Remplacement ciblé des textes inline dans le GML décompilé. Ce module reste
// indépendant du scanner de référence afin que le patch data.win soit testable
// sans charger les tables de portraits.
const LOC_TEXT_ARG = {
  stringsetloc: 0,
  stringsetsubloc: 0,
  msgsetloc: 1,
  msgsetsubloc: 1,
  msgnextloc: 0,
  msgnextsubloc: 0,
  c_msgsetloc: 1,
  c_msgsetsubloc: 1,
  c_msgnextloc: 0,
  c_msgnextsubloc: 0,
};

const CALL_RE = new RegExp(`\\b(${Object.keys(LOC_TEXT_ARG).join("|")})\\s*\\(`, "g");

function decodeString(raw) {
  const match = raw.match(/^"((?:[^"\\]|\\.)*)"$/s);
  if (!match) return null;
  return match[1]
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function parseArgs(text, start) {
  const args = [];
  let current = "";
  let depth = 1;
  let inString = false;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (inString) {
      current += char;
      if (char === "\\" && index + 1 < text.length) {
        current += text[index + 1];
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      index++;
      continue;
    }
    if (char === '"') {
      inString = true;
      current += char;
    } else if (char === "(" || char === "[") {
      depth++;
      current += char;
    } else if (char === ")" || char === "]") {
      depth--;
      if (depth === 0) {
        args.push(current.trim());
        return { args, end: index };
      }
      current += char;
    } else if (char === "," && depth === 1) {
      args.push(current.trim());
      current = "";
    } else {
      current += char;
    }
    index++;
  }
  return null;
}

function encodeGmlString(value) {
  return JSON.stringify(String(value))
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function patchLocalizedGml(text, translations) {
  const replacements = [];
  CALL_RE.lastIndex = 0;
  let match;
  while ((match = CALL_RE.exec(text))) {
    const argsStart = match.index + match[0].length;
    const parsed = parseArgs(text, argsStart);
    if (!parsed || parsed.args.length < 2) continue;
    const id = decodeString(parsed.args.at(-1));
    const textIndex = LOC_TEXT_ARG[match[1]];
    const english = decodeString(parsed.args[textIndex]);
    if (id == null || english == null) continue;
    if (!Object.prototype.hasOwnProperty.call(translations, id)) continue;
    const translated = String(translations[id]);
    if (translated === english) continue;
    const args = [...parsed.args];
    args[textIndex] = encodeGmlString(translated);
    replacements.push({ start: argsStart, end: parsed.end, value: args.join(", ") });
  }

  if (!replacements.length) return { text, count: 0 };
  let patched = text;
  for (let index = replacements.length - 1; index >= 0; index--) {
    const item = replacements[index];
    patched = patched.slice(0, item.start) + item.value + patched.slice(item.end);
  }
  return { text: patched, count: replacements.length };
}
