import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReference } from "./import-lib.mjs";
import { objectFromCodeFile } from "./room-context.mjs";

test("retrouve l'objet de room derrière un événement Collision", () => {
  assert.equal(
    objectFromCodeFile(
      "gml_Object_obj_darkfruit_tree_plat_Collision_obj_plat_susieaxe_hbx"
    ),
    "obj_darkfruit_tree_plat"
  );
});

test("reconnaît une séquence automatique rendue par obj_dialoguer_plat", () => {
  const codeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-platform-"));
  try {
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_tree_Collision_obj_axe.gml"),
      [
        'scr_speaker("susie");',
        'msgsetsubloc(0, "\\\\E7* Cool! I wrecked the tree!", "&", "platform_line");',
        "d_make_plat(0, 7);",
      ].join("\n"),
      "utf8"
    );

    const reference = buildReference(codeDir);
    assert.equal(reference.platform_line.previewMode, "platform");
    assert.deepEqual(reference.platform_line.face, { fc: 1, fe: 0 });
  } finally {
    fs.rmSync(codeDir, { recursive: true, force: true });
  }
});

test("ne confond pas d_make avec le renderer plateformer dans un objet mixte", () => {
  const codeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-platform-mixed-"));
  try {
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_mixed_Step_0.gml"),
      ['msgsetloc(0, "* Plateformer/%", "platform_line");', "d_make_plat(0, 1);"].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_mixed_Other_0.gml"),
      ['msgsetloc(0, "* Classique/%", "regular_line");', "d_make(0);"].join("\n"),
      "utf8"
    );

    const reference = buildReference(codeDir);
    assert.equal(reference.platform_line.previewMode, "platform");
    assert.notEqual(reference.regular_line.previewMode, "platform");
  } finally {
    fs.rmSync(codeDir, { recursive: true, force: true });
  }
});

test("reconnaît les dialogues de cutscene quand talk choisit obj_dialoguer_plat", () => {
  const codeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-platform-cutscene-"));
  try {
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_platform_cutscene_Step_0.gml"),
      [
        "scr_setup_plat_actor(npc_seth, \"seth\");",
        'c_msgsetsubloc(0, "~1* They might follow us~2to the Castle!/%", "\\\\m1  ", "&  ", "platform_cutscene");',
        "c_talk_wait();",
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_regular_cutscene_Step_0.gml"),
      ['c_msgsetloc(0, "* Dialogue classique/%", "regular_cutscene");', "c_talk_wait();"].join("\n"),
      "utf8"
    );

    const reference = buildReference(codeDir);
    assert.equal(reference.platform_cutscene.previewMode, "platform");
    assert.equal(reference.platform_cutscene.platformSide, 1);
    assert.notEqual(reference.regular_cutscene.previewMode, "platform");
  } finally {
    fs.rmSync(codeDir, { recursive: true, force: true });
  }
});

test("conserve le côté imposé par c_msgside dans une cutscene plateformer", () => {
  const codeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-platform-side-"));
  try {
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_platform_cutscene_Step_0.gml"),
      [
        "scr_setup_plat_actor(npc_seth, \"seth\");",
        'c_msgside("top");',
        'c_msgsetloc(0, "* En haut/%", "platform_top");',
        "c_talk_wait();",
      ].join("\n"),
      "utf8"
    );

    const reference = buildReference(codeDir);
    assert.equal(reference.platform_top.previewMode, "platform");
    assert.equal(reference.platform_top.platformSide, 0);
  } finally {
    fs.rmSync(codeDir, { recursive: true, force: true });
  }
});

test("sépare d_make et d_make_plat dans un même événement", () => {
  const codeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-platform-same-event-"));
  try {
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_mixed_Step_0.gml"),
      [
        'msgsetloc(0, "* Classique/%", "regular_line");',
        "d_make();",
        'msgsetloc(0, "* Plateformer/%", "platform_line");',
        "d_make_plat(0, 1);",
      ].join("\n"),
      "utf8"
    );

    const reference = buildReference(codeDir);
    assert.notEqual(reference.regular_line.previewMode, "platform");
    assert.equal(reference.platform_line.previewMode, "platform");
  } finally {
    fs.rmSync(codeDir, { recursive: true, force: true });
  }
});

test("résout les sprites numériques des petits portraits plateformer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-platform-smallface-"));
  const codeDir = path.join(root, "CodeEntries");
  fs.mkdirSync(codeDir);
  try {
    fs.writeFileSync(
      path.join(root, "sprites_list.txt"),
      ["spr_zero;1;1;1;0;0", "spr_one;1;1;1;0;0", "spr_custom_face;3;20;20;0;0"].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_platform_Step_0.gml"),
      [
        'var small_text = stringsetloc("Encore !", "small_face_text");',
        'scr_smallface(0, 2, 1, "mid", "topmid", small_text);',
        'msgsetloc(0, "* Plus vite !\\\\f0", "platform_dialogue");',
        "d_make_plat(0, 1);",
      ].join("\n"),
      "utf8"
    );

    const reference = buildReference(codeDir);
    assert.equal(reference.platform_dialogue.previewMode, "platform");
    assert.equal(reference.small_face_text.smallFace.dialogueKey, "platform_dialogue");
    assert.equal(reference.small_face_text.smallFace.speaker, "spr_custom_face");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
