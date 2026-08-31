import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReference } from "./import-lib.mjs";

test("reconnaît les textes réellement envoyés au writer d'un shop", () => {
  const codeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-shop-"));
  try {
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_shop_ch5_Create_0.gml"),
      [
        '_intro_text = stringsetloc("* Intro sans fermeture", "shop_intro");',
        'menu_label = stringsetloc("Acheter", "shop_label");',
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_shop_ch5_Draw_0.gml"),
      [
        "global.msg[0] = _intro_text;",
        'global.msg[0] = stringsetloc("Message latéral", "shop_direct");',
        'msgsetloc(0, "Message sans fermeture", "shop_msgset");',
        "instance_create(30, 270, obj_writer);",
      ].join("\n"),
      "utf8"
    );

    const reference = buildReference(codeDir);
    assert.equal(reference.shop_intro.previewMode, "shop");
    assert.equal(reference.shop_direct.previewMode, "shop");
    assert.equal(reference.shop_msgset.previewMode, "shop");
    assert.equal(reference.shop_label.previewMode, undefined);
  } finally {
    fs.rmSync(codeDir, { recursive: true, force: true });
  }
});

test("ne requalifie pas une variable qui n'alimente aucun writer", () => {
  const codeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-shop-label-"));
  try {
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_shop_ch5_Draw_0.gml"),
      'label = stringsetloc("* Libellé étoilé", "starred_label");',
      "utf8"
    );

    const reference = buildReference(codeDir);
    assert.equal(reference.starred_label.previewMode, undefined);
  } finally {
    fs.rmSync(codeDir, { recursive: true, force: true });
  }
});
