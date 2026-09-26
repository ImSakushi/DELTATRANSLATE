import fs from "node:fs";
import path from "node:path";
import { makeFontsCsx } from "./import-lib.mjs";
import { runTool } from "./process-runner.mjs";
import { beginWorkspace, commitWorkspace, abandonWorkspace } from "./workspace-transaction.mjs";

export function fontSource(dataWin) {
  const stat = fs.statSync(dataWin);
  return { path: path.resolve(dataWin), size: stat.size, mtimeMs: stat.mtimeMs };
}

export function readFontCsvs(directory) {
  const fonts = {};
  for (const file of fs.readdirSync(directory)) {
    if (!/^glyphs_.+\.csv$/.test(file)) continue;
    const name = file.slice(7, -4);
    if (!fs.existsSync(path.join(directory, name + ".png"))) throw new Error(`Texture de police absente : ${name}`);
    fonts[name] = fs.readFileSync(path.join(directory, file), "utf8");
  }
  if (!fonts.fnt_main) throw new Error("Extraction incomplète : la police principale est absente.");
  return fonts;
}

export async function refreshFonts({ cli, dataWin, outDir, force = false, runner = runTool }) {
  const source = fontSource(dataWin);
  const manifest = path.join(outDir, "font-extraction-source.json");
  if (!force) {
    try {
      if (JSON.stringify(JSON.parse(fs.readFileSync(manifest, "utf8"))) === JSON.stringify(source))
        return readFontCsvs(path.join(outDir, "fonts"));
    } catch { /* Le cache absent ou incomplet doit être reconstruit. */ }
  }
  const transaction = beginWorkspace(path.join(outDir, "fonts"));
  const script = path.join(transaction.stage, "export.csx");
  try {
    fs.writeFileSync(script, makeFontsCsx(transaction.stage));
    const result = await runner(cli, ["load", dataWin, "-s", script]);
    if (result.error || result.status !== 0 || !/FONTS_OK/.test(result.stdout ?? ""))
      throw new Error(`Extraction des polices impossible : ${result.error?.message ?? result.stderr ?? result.status}`);
    const generated = path.join(transaction.stage, "fonts");
    const fonts = readFontCsvs(generated);
    if (JSON.stringify(fontSource(dataWin)) !== JSON.stringify(source)) throw new Error("Le data.win a changé pendant l’extraction. Réessaie une fois le jeu fermé.");
    // Le répertoire temporaire initial contient l'ancien cache. N'installer
    // que les couples PNG/CSV complets produits par cette extraction.
    for (const file of fs.readdirSync(transaction.stage)) {
      if (file !== "fonts") fs.rmSync(path.join(transaction.stage, file), { recursive: true, force: true });
    }
    for (const file of fs.readdirSync(generated)) fs.renameSync(path.join(generated, file), path.join(transaction.stage, file));
    fs.rmdirSync(generated);
    commitWorkspace(transaction);
    fs.writeFileSync(manifest, JSON.stringify(source));
    return fonts;
  } finally { abandonWorkspace(transaction); }
}
