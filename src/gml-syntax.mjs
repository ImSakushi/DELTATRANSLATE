const KEYWORDS = new Set(`var globalvar static function constructor enum if else then
for while do until repeat with switch case default break continue return exit
try catch finally throw new delete begin end`.split(/\s+/));
const CONSTANTS = new Set(`true false undefined noone self other all global local
pi infinity NaN pointer_null pointer_invalid`.split(/\s+/));
const WORD_OPERATORS = new Set(["and", "or", "xor", "not", "div", "mod"]);

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
}

export function highlightGml(source) {
  // Le scan porte sur le fichier entier pour conserver les commentaires et chaînes multilignes.
  const tokens = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|@"[^"]*(?:"|$)|@'[^']*(?:'|$)|"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|#[a-zA-Z_]+|\b0[xX][\da-fA-F]+\b|\$[\da-fA-F]+\b|(?:\b\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\b|\b[a-zA-Z_][\w]*\b|[+*/%=!<>?:&|^~\-]+/g;
  let html = "";
  let offset = 0;
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    let kind = "";
    if (token.startsWith("//") || token.startsWith("/*")) kind = "comment";
    else if (/^@?["']/.test(token)) kind = "string";
    else if (token.startsWith("#")) kind = "directive";
    else if (/^(?:\d|\$|\.\d)/.test(token)) kind = "number";
    else if (KEYWORDS.has(token)) kind = "keyword";
    else if (CONSTANTS.has(token)) kind = "constant";
    else if (WORD_OPERATORS.has(token) || /^[+*/%=!<>?:&|^~\-]/.test(token)) kind = "operator";
    else if (/^\s*\(/.test(source.slice(match.index + token.length))) kind = "function";
    html += escapeHtml(source.slice(offset, match.index));
    // Chaque ligne reçoit ses propres balises pour le lecteur avec numéros de ligne.
    html += token.split("\n").map((line) => kind
      ? `<span class="gml-${kind}">${escapeHtml(line)}</span>`
      : escapeHtml(line)).join("\n");
    offset = match.index + token.length;
  }
  return html + escapeHtml(source.slice(offset));
}
