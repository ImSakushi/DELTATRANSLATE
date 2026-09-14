import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  detectChapter,
  findPreviousChapterDataWin,
  removeInheritedEntries,
} from "./chapter-scope.mjs";

test("detectChapter lit la valeur compilée plutôt que le nom du dossier", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-chapter-"));
  try {
    fs.writeFileSync(
      path.join(directory, "gml_GlobalScript_scr_gamestart.gml"),
      "function scr_gamestart() { global.chapter = 5; }",
      "utf8"
    );
    assert.equal(detectChapter(directory, "C:/jeu/chapter2_windows/data.win"), 5);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("findPreviousChapterDataWin conserve la forme du dossier courant", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-siblings-"));
  try {
    const previous = path.join(root, "chapter4_windows");
    const current = path.join(root, "chapter5_windows");
    fs.mkdirSync(previous);
    fs.mkdirSync(current);
    fs.writeFileSync(path.join(previous, "data.win"), "test", "utf8");
    assert.equal(
      findPreviousChapterDataWin(path.join(current, "data.win"), 5),
      path.join(previous, "data.win")
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removeInheritedEntries compare le fichier et l'anglais, pas les clés instables", () => {
  const current = {
    nouvelle_cle: { file: "gml_Object_obj_story_Step_0", en: "Same dialogue" },
    texte_modifie: { file: "gml_Object_obj_story_Step_0", en: "Changed dialogue" },
    autre_fichier: { file: "gml_Object_obj_other_Step_0", en: "Same dialogue" },
  };
  const previous = [
    {
      id: "ancienne_cle",
      file: "gml_Object_obj_story_Step_0.gml",
      english: "Same dialogue",
    },
  ];
  const result = removeInheritedEntries(current, previous);
  assert.equal(result.removed, 1);
  assert.deepEqual(Object.keys(result.reference), ["texte_modifie", "autre_fichier"]);
});

test("le filtrage conserve la référence des lignes héritées déjà dans le fichier de langue", () => {
  const reference = {
    anglais: { file: "gml_GlobalScript_scr_text", en: "* Well^1, there was not a man here./%", channel: "msg" },
    traduit: { file: "gml_GlobalScript_scr_text", en: "* You got the Egg./%" },
    absent: { file: "gml_GlobalScript_scr_text", en: "Other chapter" },
    nouveau: { file: "gml_GlobalScript_scr_text", en: "New dialogue" },
  };
  const language = { date: "123", anglais: reference.anglais.en, traduit: "* Tu as obtenu l'Œuf./%", orphelin: "À conserver" };
  const before = structuredClone(language);
  const previous = Object.entries(reference).filter(([key]) => key !== "nouveau").map(([id, entry]) => ({ id, ...entry }));
  const result = removeInheritedEntries(reference, previous, Object.keys(language));
  assert.deepEqual(Object.keys(result.reference), ["anglais", "traduit", "nouveau"]);
  assert.equal(result.removed, 1);
  assert.equal(result.reference.anglais.en, language.anglais);
  assert.notEqual(result.reference.traduit.en, language.traduit);
  assert.equal(result.reference.orphelin, undefined);
  assert.deepEqual(language, before);
});
