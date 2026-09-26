const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLocalizedSpriteMap, spriteTextSources } = require("./sprite-text.js");

const GML = `
        if (global.lang == "ja")
        {
            var sm = global.chemg_sprite_map;
            ds_map_add(sm, "spr_btact", spr_ja_btact);
            ds_map_add(sm, "spr_green_sign", spr_green_sign_ja);
            ds_map_add(sm, "spr_fieldmuslogo", spr_fieldmuslogo);
            ds_map_add(fm, "main", fnt_ja_main);
        }`;

test("lit la table des sprites localisés de scr_84_init_localization", () => {
  assert.deepEqual([...parseLocalizedSpriteMap(GML)], [
    ["spr_btact", "spr_ja_btact"],
    ["spr_green_sign", "spr_green_sign_ja"],
  ]);
});

test("détecte les sprites à texte et isole les variantes japonaises", () => {
  const names = ["spr_btact", "spr_ja_btact", "spr_green_sign", "spr_green_sign_ja",
    "spr_sign_ja", "spr_sign", "spr_orphan_ja", "spr_kris"];
  const { sources, japanese } = spriteTextSources(names, GML);
  assert.deepEqual([...sources.keys()].sort(), ["spr_btact", "spr_green_sign", "spr_sign"]);
  assert.equal(sources.get("spr_sign"), "spr_sign_ja");
  assert.deepEqual([...japanese].sort(), ["spr_green_sign_ja", "spr_ja_btact", "spr_sign_ja"]);
  assert.equal(sources.has("spr_kris"), false);
  assert.equal(japanese.has("spr_orphan_ja"), false);
});

test("reste fonctionnel sans code GML", () => {
  const { sources } = spriteTextSources(new Set(["spr_a", "spr_a_ja"]), null);
  assert.deepEqual([...sources], [["spr_a", "spr_a_ja"]]);
});
