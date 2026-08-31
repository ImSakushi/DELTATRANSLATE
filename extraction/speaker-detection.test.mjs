import assert from "node:assert/strict";
import test from "node:test";

import { findFace, findSpeaker } from "./import-lib.mjs";

test("détecte un speaker sans portrait", () => {
  const lines = ['c_speaker("tenna");', 'msgsetloc("Hello", "id");'];
  assert.equal(findSpeaker(lines, 1), "tenna");
});

test("regroupe les variantes d'un même personnage", () => {
  const lines = ['c_facenext("flowery_noface", 0);', 'c_msgnextloc("Hello", "id");'];
  assert.equal(findSpeaker(lines, 1), "flowery");
});

test("reconnaît les helpers de visage dédiés", () => {
  const lines = ["scr_ruface(global.msgno, 2);", 'msgnextloc("Hello", "id");'];
  assert.equal(findSpeaker(lines, 1), "rouxls");
});

test("un speaker sans nom arrête la persistance du personnage précédent", () => {
  const lines = [
    'c_speaker("susie");',
    'c_speaker("no_name");',
    'msgsetloc("Hello", "id");',
  ];
  assert.equal(findSpeaker(lines, 2), null);
});

test("c_fefc(0, 0) retire le portrait posé par c_speaker pour toute la séquence", () => {
  const lines = [
    'c_speaker("noelle");',
    "c_fefc(0, 0);",
    'c_msgsetloc(0, "* Since Dess left.../", "dialogue-1");',
    'c_msgnextloc("* All I\'ve been doing has just been.../%", "dialogue-2");',
  ];
  assert.equal(findFace(lines, 2), null);
  assert.equal(findFace(lines, 3), null);
  assert.equal(findSpeaker(lines, 3), "noelle");
});

test("détecte la banque sans chapeau de Ralsei depuis son sprite de cutscene", () => {
  const lines = [
    "c_sel(ra);",
    "c_sprite(spr_ralsei_head_down_sad_right);",
    'c_speaker("ralsei");',
    'c_msgsetloc(0, "\\\\EO* Désolé./", "dialogue");',
  ];
  assert.deepEqual(findFace(lines, 3), { fc: 2, fe: 0, variant: "ralsei-nohat" });
});

test("conserve la banque avec chapeau quand le flag 1311 est posé", () => {
  const lines = [
    "scr_flag_set(1311, 1);",
    'c_speaker("ralsei");',
    'c_msgsetloc(0, "\\\\E3* Bonjour./", "dialogue");',
  ];
  assert.deepEqual(findFace(lines, 2), { fc: 2, fe: 0, variant: "ralsei-hat" });
});
