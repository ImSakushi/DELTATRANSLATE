// Détection de l'acteur des bulles de combat (findBubbleActor) : la bulle ne
// connaît pas son locuteur, on retrouve qui parle depuis les appels
// scr_enemyblcon / scr_heroblcon / msgset_add sous le msgsetloc.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReference } from "./import-lib.mjs";

function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bubble-actor-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  return dir;
}

test("ennemi qui parle : idlesprite du Create_0, side ennemi", () => {
  const dir = makeFixture({
    "gml_Object_obj_leafybug_enemy_Create_0.gml": [
      "idlesprite = spr_leafybug_idle;",
      "",
    ].join("\n"),
    "gml_Object_obj_leafybug_enemy_Step_0.gml": [
      "if (talked == 0)",
      "{",
      '    msgsetloc(0, "* Bzzzt./%", "obj_leafybug_enemy_slash_Step_0_gml_3_0");',
      "    scr_enemyblcon(x - 10, y + 40, 10);",
      "}",
    ].join("\n"),
  });
  try {
    const ref = buildReference(dir);
    const actor = ref.obj_leafybug_enemy_slash_Step_0_gml_3_0?.bubbleActor;
    assert.deepEqual(actor, {
      kind: "enemy",
      name: "leafybug",
      sprites: ["spr_leafybug_idle"],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("l'idlesprite réassigné juste avant la réplique l'emporte sur le Create", () => {
  const dir = makeFixture({
    "gml_Object_obj_leafybug_enemy_Create_0.gml": "idlesprite = spr_leafybug_idle;\n",
    "gml_Object_obj_leafybug_enemy_Step_0.gml": [
      "idlesprite = spr_leafybug_serious;",
      'msgsetloc(0, "* Grr./%", "obj_leafybug_enemy_slash_Step_0_gml_2_0");',
      "scr_enemyblcon(x - 10, y + 40, 10);",
    ].join("\n"),
  });
  try {
    const ref = buildReference(dir);
    assert.deepEqual(ref.obj_leafybug_enemy_slash_Step_0_gml_2_0?.bubbleActor?.sprites, [
      "spr_leafybug_serious",
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scr_heroblcon attribue la bulle au héros, pas à l'ennemi propriétaire", () => {
  const dir = makeFixture({
    "gml_Object_obj_leafybug_enemy_Create_0.gml": "idlesprite = spr_leafybug_idle;\n",
    "gml_Object_obj_leafybug_enemy_Step_0.gml": [
      'msgsetloc(0, "Hé, l\'insecte !/%", "obj_leafybug_enemy_slash_Step_0_gml_1_0");',
      "global.typer = 75;",
      'scr_heroblcon("susie");',
    ].join("\n"),
  });
  try {
    const ref = buildReference(dir);
    const actor = ref.obj_leafybug_enemy_slash_Step_0_gml_1_0?.bubbleActor;
    assert.deepEqual(actor, {
      kind: "hero",
      name: "susie",
      sprites: ["spr_susieb_idle"],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("outro déclarée dans Create et envoyée par msgset_add → repli propriétaire", () => {
  const dir = makeFixture({
    "gml_Object_obj_leafybug_enemy_Create_0.gml": [
      "idlesprite = spr_leafybug_idle;",
      'outro = stringsetloc("* See ya./%", "obj_leafybug_enemy_slash_Create_0_gml_2_0");',
    ].join("\n"),
    "gml_Object_obj_leafybug_enemy_Step_0.gml": "msgset_add(outro, x - 20, y + 25, 10);\n",
  });
  try {
    const ref = buildReference(dir);
    const entry = ref.obj_leafybug_enemy_slash_Create_0_gml_2_0;
    assert.equal(entry?.previewMode, "bubble");
    assert.deepEqual(entry?.bubbleActor, {
      kind: "enemy",
      name: "leafybug",
      sprites: ["spr_leafybug_idle"],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pas d'acteur hors combat", () => {
  const dir = makeFixture({
    "gml_Object_obj_npc_town_Step_0.gml": [
      'msgsetloc(0, "* Belle journée./%", "obj_npc_town_slash_Step_0_gml_1_0");',
    ].join("\n"),
  });
  try {
    const ref = buildReference(dir);
    assert.equal(ref.obj_npc_town_slash_Step_0_gml_1_0?.bubbleActor, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
