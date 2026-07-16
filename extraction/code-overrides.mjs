import fs from "node:fs";
import path from "node:path";
import { patchLocalizedGml } from "./patch-gml.mjs";

// Prépare uniquement les CodeEntries qui doivent être réimportées par UTMT :
// les overrides utilisateur et les fichiers contenant des traductions inline.
export function prepareCodeEntries({ codeDir, overridesDir, outputDir, translations }) {
  let siteCount = 0;
  let fileCount = 0;
  let overrideCount = 0;

  for (const file of fs.readdirSync(codeDir)) {
    if (!file.endsWith(".gml")) continue;
    const override = overridesDir ? path.join(overridesDir, file) : null;
    const hasOverride = Boolean(override && fs.existsSync(override));
    const base = fs.readFileSync(hasOverride ? override : path.join(codeDir, file), "utf8");
    const patched = patchLocalizedGml(base, translations);
    if (!hasOverride && !patched.count) continue;
    fs.writeFileSync(path.join(outputDir, file), patched.text, "utf8");
    siteCount += patched.count;
    fileCount++;
    if (hasOverride) overrideCount++;
  }

  return { siteCount, fileCount, overrideCount };
}
