export function colorInsertion(value, start, end, color) {
  const selected = value.slice(start, end);
  return { text: `\\c${color}${selected}\\cW`, start: start + 3, end: start + 3 + selected.length };
}

export function githubDeviceCode(output) {
  const plain = String(output).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  return plain.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})\b/i)?.[1]?.toUpperCase() ?? null;
}

export function previewFaceText(text, override) {
  // obj_writer Draw_0 : les balises F/E remplacent l’état initial du writer.
  // Un choix manuel doit gagner, sans modifier la traduction sauvegardée.
  if (!override) return text;
  let visible = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "`") { visible += text.slice(i, i + 2); i++; }
    else if (text[i] === "\\") {
      if (text[i + 1] !== "F" && text[i + 1] !== "E") visible += text.slice(i, i + 3);
      i += 2;
    } else visible += text[i];
  }
  return visible;
}
