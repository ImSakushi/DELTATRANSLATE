const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

async function loadChoiceLayout() {
  const source = fs.readFileSync("src/engine/choice.js", "utf8");
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(url);
}

test("place les choix néo comme obj_choicer_neo dans une boîte sombre en haut", async () => {
  const { neoChoiceLayout } = await loadChoiceLayout();
  const layout = neoChoiceLayout(
    ["#My happy#ending is#with you#too", "#Drink all#the water#in the#pool"],
    { scale: 2, side: 0, measure: (line) => line.length * 10 }
  );
  assert.equal(layout[0].text, "My happy#ending is#with you#too");
  assert.deepEqual([layout[0].x, layout[0].y], [155, 83]);
  assert.deepEqual([layout[1].x, layout[1].y], [487, 83]);
  assert.equal(layout[1].heartY, 75);
  assert.equal(layout[1].heartX, 487 - 45 - 22);
});

test("place les choix classiques aux coordonnées combat de la branche neostyle = 0", async () => {
  const { classicChoiceLayout } = await loadChoiceLayout();
  const layout = classicChoiceLayout(["Oui", "Non"], {
    scale: 2,
    dAdd: 155,
    fightingOffset: 30,
    measure: (line) => line.length * 14,
  });
  assert.deepEqual([layout[0].x, layout[0].y], [92, 366]);
  assert.deepEqual([layout[0].heartX, layout[0].heartY], [60, 408]);
  assert.equal(layout[1].heartX, 552 - 42);
});
