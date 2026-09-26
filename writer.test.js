const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

async function loadWriter() {
  const typers = fs.readFileSync("src/engine/typers.js", "utf8");
  const typersUrl = `data:text/javascript;base64,${Buffer.from(typers).toString("base64")}`;
  const writer = fs
    .readFileSync("src/engine/writer.js", "utf8")
    .replace("./typers.js", typersUrl);
  const writerUrl = `data:text/javascript;base64,${Buffer.from(writer).toString("base64")}`;
  return import(writerUrl);
}

test("reproduit les espaces fines insécables ajoutées au français par le jeu", async () => {
  const { applyLanguageTypography } = await loadWriter();
  assert.equal(
    applyLanguageTypography("Oui ! Quoi ? Note : « test »", "fr"),
    "Oui ! Quoi ? Note : « test »"
  );
  assert.equal(applyLanguageTypography("Yes !", "en"), "Yes !");
});

test("le wrap de Mad Mew Mew correspond au rendu en jeu", async () => {
  const { applyLanguageTypography, formatText } = await loadWriter();
  const source = "\\E7* Fleur ou pas fleur, J'EN AI RIEN À FOUTRE !!!/";
  const runtimeText = applyLanguageTypography(source, "fr");
  assert.equal(
    formatText(runtimeText, { charline: 23, dialoguer: true, initialFc: 0 }).text,
    "\\E7* Fleur ou pas fleur,&||J'EN AI RIEN À&||FOUTRE !!!/"
  );
});

test("le bonus de cinq caractères du plateformer garde la réplique sur une ligne", async () => {
  const { formatText } = await loadWriter();
  const source = "\\E7* Cool^1! I wrecked the tree!";
  assert.equal(
    formatText(source, { charline: 31, dialoguer: true, initialFc: 1 }).text,
    source
  );
  assert.match(
    formatText(source, { charline: 26, dialoguer: true, initialFc: 1 }).text,
    /&/
  );
});


test("le japonais utilise les pas entiers et demi-chasse du writer", async () => {
  const { layoutText } = await loadWriter();
  const jp = layoutText("あAｱい", { typer: 6, language: "ja" });
  assert.deepEqual(jp.ops.map(op => op.x), [0, 27, 40.5, 54]);
  assert.equal(jp.maxX, 81);
  assert.equal(layoutText("wi", { typer: 6, language: "en" }).maxX, 32);
});

test("le japonais garde ses métriques après un changement de typer", async () => {
  const { layoutText } = await loadWriter();
  const jp = layoutText("\\TSあ&い", { typer: 6, dark: true, language: "ja" });
  assert.equal(jp.hspace, 27);
  assert.equal(jp.ops[1].y, 36);
  const bubble = layoutText("あ&い", { typer: 69, language: "ja" });
  assert.equal(bubble.hspace, 15.625);
  assert.equal(bubble.ops[1].y, 22);
  assert.equal(layoutText("あ", { typer: 14, language: "ja" }).ops[0].textscale, 0.5);
});

test("les retours explicites japonais ne reçoivent pas l’indentation anglaise", async () => {
  const { formatText } = await loadWriter();
  assert.equal(formatText("* あ&い", { language: "ja" }).text, "* あ&い");
  assert.equal(formatText("* A&B", { language: "en" }).text, "* A&||B");
});
