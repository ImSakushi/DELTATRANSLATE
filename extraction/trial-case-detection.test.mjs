import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReference } from "./import-lib.mjs";

test("reconnaît les dossiers dessinés directement par l'interface du procès", () => {
  const codeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-trial-"));
  try {
    fs.writeFileSync(
      path.join(codeDir, "gml_Object_obj_yellow_enemy_Create_0.gml"),
      [
        'case_info[0] = stringsetloc("Case 1: A Floradinn was#crushed flat!", "trial_case_0");',
        'case_info[3] = stringsetloc("Case 4: Petals missing!", "trial_case_3");',
        'menu_label = stringsetloc("Evidence", "ordinary_label");',
      ].join("\n"),
      "utf8"
    );

    const reference = buildReference(codeDir);
    assert.equal(reference.trial_case_0.previewMode, "trial");
    assert.equal(reference.trial_case_0.trialCase, 0);
    assert.equal(reference.trial_case_3.previewMode, "trial");
    assert.equal(reference.trial_case_3.trialCase, 3);
    assert.notEqual(reference.ordinary_label.previewMode, "trial");
  } finally {
    fs.rmSync(codeDir, { recursive: true, force: true });
  }
});
