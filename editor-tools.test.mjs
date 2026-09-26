import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { colorInsertion, githubDeviceCode, previewFaceText } from "./src/editor-tools.mjs";

test("la couleur conserve la sélection et replace le curseur entre les balises", () => {
  assert.deepEqual(colorInsertion("Un été !", 3, 6, "R"), { text: "\\cRété\\cW", start: 6, end: 9 });
  assert.deepEqual(colorInsertion("", 0, 0, "Y"), { text: "\\cY\\cW", start: 3, end: 3 });
});

test("le code GitHub est extrait du journal même coloré, sans confondre une autre valeur", () => {
  assert.equal(githubDeviceCode("! First copy your one-time code: \x1b[1;32mAB12-CD34\x1b[0m\n"), "AB12-CD34");
  assert.equal(githubDeviceCode("one-time code: AB12-"), null);
  assert.equal(githubDeviceCode("une autre valeur AB12-CD34"), null);
});

test("Aucun neutralise les portraits inline dans le writer, Auto les conserve", async () => {
  const typers = "data:text/javascript;base64," + Buffer.from(fs.readFileSync("src/engine/typers.js")).toString("base64");
  const writer = fs.readFileSync("src/engine/writer.js", "utf8").replace("./typers.js", typers);
  const { layoutText, formatText } = await import("data:text/javascript;base64," + Buffer.from(writer).toString("base64"));
  const text = "\\Fb\\E2* Bonjour\\cR !\\cW";
  assert.equal(previewFaceText(text, null), text);
  const visible = previewFaceText(text, { fc: 0, fe: 0 });
  const rendered = layoutText(formatText(visible, { charline: 33, initialFc: 0 }).text, { fc: 0, fe: 0 });
  assert.equal(rendered.fc, 0);
  assert.ok(visible.includes("\\cR"));
  assert.equal(layoutText(text, { fc: 0, fe: 0 }).fc, 19);
  assert.equal(previewFaceText("`\\Fb", { fc: 0 }), "`\\Fb");
});

test("les polices FR gardent les accents, les URL spéciales et les erreurs de chargement", async () => {
  const source = fs.readFileSync("src/engine/bitmapfont.js");
  const { loadFonts } = await import("data:text/javascript;base64," + source.toString("base64"));
  const original = globalThis.Image;
  const urls = [];
  globalThis.Image = class {
    async decode() { urls.push(this.src); if (this.src.includes("mainbig")) throw new Error("PNG invalide"); }
  };
  try {
    const csv = "font;12\n233;0;0;8;12;8;0\n201;8;0;8;12;8;0\n";
    const fonts = await loadFonts("/tmp/Mod #1 été", { fnt_main_fr: csv, fnt_main: "font;12\n", fnt_mainbig: csv });
    assert.ok(fonts.main.hasChar("é"));
    assert.ok(fonts.main.hasChar("É"));
    fonts.main.drawChar({}, "à", 0, 0);
    assert.deepEqual([...fonts.main.missingGlyphs], ["à"]);
    assert.match(urls[0], /^file:\/\/\/tmp\/Mod%20%231%20%C3%A9t%C3%A9\/fonts\/fnt_main_fr.png\?v=/);
    assert.equal(fonts.mainbig, undefined);
    assert.match(fonts.loadWarnings[0], /fnt_mainbig illisible/);
  } finally { globalThis.Image = original; }
});

test("les balises des répliques précédentes ne traversent pas deux cases voisins", () => {
  const source = fs.readFileSync("src/app.js", "utf8");
  const context = vm.createContext({
    sequences: null,
    entries: [{ key: "a", file: "script", line: 3 }, { key: "b", file: "script", line: 5 }, { key: "c", file: "script", line: 6 }],
    reference: { a: { dialogueScope: 1 }, b: { dialogueScope: 4 }, c: { dialogueScope: 4 } },
  });
  vm.runInContext(source.slice(source.indexOf("function buildSequences()"), source.indexOf("function speakerLabel")), context);
  vm.runInContext("buildSequences()", context);
  assert.equal(context.sequences.get("a").length, 1);
  assert.equal(context.sequences.get("b").length, 2);
});
