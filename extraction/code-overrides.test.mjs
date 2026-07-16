import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareCodeEntries } from "./code-overrides.mjs";

test("prepareCodeEntries fusionne overrides et traductions sans toucher aux sources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-code-test-"));
  const codeDir = path.join(root, "CodeEntries");
  const overridesDir = path.join(root, "CodeOverrides");
  const outputDir = path.join(root, "Patched");
  fs.mkdirSync(codeDir);
  fs.mkdirSync(overridesDir);
  fs.mkdirSync(outputDir);

  try {
    const localized = 'msgsetloc("speaker", "Hello", "scene_slash_line");';
    fs.writeFileSync(path.join(codeDir, "gml_Object_scene_Step_0.gml"), localized);
    fs.writeFileSync(path.join(codeDir, "gml_Object_scene_Create_0.gml"), "speed = 1;");
    fs.writeFileSync(path.join(codeDir, "gml_Script_unused.gml"), "return 0;");
    fs.writeFileSync(
      path.join(overridesDir, "gml_Object_scene_Create_0.gml"),
      "speed = 2;"
    );

    const result = prepareCodeEntries({
      codeDir,
      overridesDir,
      outputDir,
      translations: { scene_slash_line: "Bonjour" },
    });

    assert.deepEqual(result, { siteCount: 1, fileCount: 2, overrideCount: 1 });
    assert.equal(
      fs.readFileSync(path.join(outputDir, "gml_Object_scene_Step_0.gml"), "utf8"),
      'msgsetloc("speaker", "Bonjour", "scene_slash_line");'
    );
    assert.equal(
      fs.readFileSync(path.join(outputDir, "gml_Object_scene_Create_0.gml"), "utf8"),
      "speed = 2;"
    );
    assert.equal(fs.readFileSync(path.join(codeDir, "gml_Object_scene_Create_0.gml"), "utf8"), "speed = 1;");
    assert.equal(fs.existsSync(path.join(outputDir, "gml_Script_unused.gml")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
