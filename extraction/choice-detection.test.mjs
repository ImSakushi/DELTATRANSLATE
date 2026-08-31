import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReference, buildReferenceFromLangJson } from "./import-lib.mjs";

function withCodeFile(name, lines, run) {
  const codeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-choice-"));
  try {
    fs.writeFileSync(path.join(codeDir, name), lines.join("\n"), "utf8");
    run(codeDir);
  } finally {
    fs.rmSync(codeDir, { recursive: true, force: true });
  }
}

test("relie les global.choicemsg d'un même choix et conserve le côté de la textbox", () => {
  withCodeFile(
    "gml_Object_obj_scene_Step_0.gml",
    [
      'c_msgside("top");',
      'global.choicemsg[1] = stringsetloc("#Boire toute#l’eau", "drink");',
      'global.choicemsg[0] = stringsetloc("#Ma fin#heureuse", "happy");',
      'global.choicemsg[2] = stringset("");',
      'global.choicemsg[3] = stringset("");',
      'c_msgset(0, "\\\\C2");',
    ],
    (codeDir) => {
      const reference = buildReference(codeDir);
      assert.deepEqual(reference.happy.choice, {
        options: [{ key: "happy" }, { key: "drink" }],
        index: 0,
        side: 0,
      });
      assert.equal(reference.drink.choice.index, 1);
      assert.equal(reference.drink.previewMode, "darkbox");
    }
  );
});

test("suit les variables de scr_readychoicer et garde la variante la plus complète", () => {
  withCodeFile(
    "gml_Object_obj_scene_Step_0.gml",
    [
      'var opt1 = stringsetloc("#Donner", "give");',
      'var opt2 = stringsetloc("#Masser", "massage");',
      'var opt3 = stringsetloc("Rien", "nothing");',
      'opt3 = "#" + opt3;',
      'scr_readychoicer(opt1, opt2, opt3);',
      'scr_readychoicer(opt2, opt3);',
    ],
    (codeDir) => {
      const reference = buildReference(codeDir);
      assert.deepEqual(
        reference.massage.choice.options.map((option) => option.key),
        ["give", "massage", "nothing"]
      );
      assert.equal(reference.nothing.choice.index, 2);
    }
  );
});

test("relie aussi les ids des anciens chapitres lus depuis lang_en.json", () => {
  withCodeFile(
    "gml_Object_obj_scene_Step_0.gml",
    [
      'global.choicemsg[0] = scr_84_get_lang_string("yes");',
      'global.choicemsg[1] = scr_84_get_lang_string("no");',
      'msgnext("\\\\C2");',
    ],
    (codeDir) => {
      const reference = buildReferenceFromLangJson(codeDir, { yes: "Yes", no: "No" });
      assert.deepEqual(
        reference.yes.choice.options.map((option) => option.key),
        ["yes", "no"]
      );
      assert.equal(reference.no.choice.index, 1);
    }
  );
});
