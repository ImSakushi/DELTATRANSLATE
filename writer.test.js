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
