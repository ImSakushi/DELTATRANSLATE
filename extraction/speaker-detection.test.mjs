import assert from "node:assert/strict";
import test from "node:test";

import { findSpeaker } from "./import-lib.mjs";

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
