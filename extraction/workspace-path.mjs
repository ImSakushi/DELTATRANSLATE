import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function normalized(directory) {
  const absolute = path.resolve(directory);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export function extractionDirectory(root, dataWin) {
  const gameDir = path.dirname(dataWin);
  const name = path.basename(gameDir).replace(/[^\w.-]+/g, "_");
  const legacy = path.join(root, name);
  const hash = createHash("sha256").update(normalized(gameDir)).digest("hex").slice(0, 12);
  const isolated = path.join(root, `${name}-${hash}`);
  if (fs.existsSync(isolated)) return isolated;
  // Réutiliser le travail ancien uniquement si son manifeste désigne cette installation.
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(legacy, "extraction-source.json"), "utf8"));
    if (normalized(path.dirname(manifest.path)) === normalized(gameDir)) return legacy;
  } catch {}
  return isolated;
}
