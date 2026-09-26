import test from "node:test";
import assert from "node:assert/strict";
import { frameFromFileName, spriteState } from "./src/sprite-workflow.mjs";

const catalog = new Map([
  ["spr_sign", { name: "spr_sign", targetName: "spr_sign_fr" }],
  ["spr_sign_big", { name: "spr_sign_big", targetName: "spr_sign_big" }],
]);
const lookup = (name) => catalog.get(name);

test("associe un PNG exporté à son sprite et à sa frame", () => {
  assert.deepEqual(frameFromFileName("spr_sign_2.png", lookup), { name: "spr_sign", frame: 2 });
  assert.deepEqual(frameFromFileName("spr_sign_big_0.PNG", lookup), { name: "spr_sign_big", frame: 0 });
  assert.deepEqual(frameFromFileName("spr_sign_fr_1.png", lookup), { name: "spr_sign", frame: 1 });
});

test("les noms numériques visent le sprite sélectionné", () => {
  assert.deepEqual(frameFromFileName("3.png", lookup, "spr_sign"), { name: "spr_sign", frame: 3 });
  assert.equal(frameFromFileName("3.png", lookup), null);
});

test("ignore les noms qui ne désignent aucun sprite", () => {
  assert.equal(frameFromFileName("panneau traduit.png", lookup), null);
  assert.equal(frameFromFileName("spr_unknown_0.png", lookup), null);
  assert.equal(frameFromFileName("spr_sign_de_0.png", lookup), null);
});

test("l'état met en avant ce qui reste à faire", () => {
  assert.equal(spriteState({ overrideFrames: [0], pendingFrames: [0] }).key, "pending");
  assert.equal(spriteState({ overrideFrames: [0], pendingFrames: [] }).key, "imported");
  assert.equal(spriteState({ overrideFrames: [], variant: { name: "x_fr" }, variantGenerated: false }).key, "done");
  assert.equal(spriteState({ overrideFrames: [], variant: { name: "x_fr" }, variantGenerated: true, hasText: true }).key, "todo");
  assert.equal(spriteState({ overrideFrames: [] }).key, "none");
});

test("en mode Runedelta, l'état d'un sprite suit la branche de travail", () => {
  const runedelta = (frames, unpublishedFrames = []) => ({ branch: "Alex", frames, unpublishedFrames });
  assert.equal(spriteState({ overrideFrames: [0], runedelta: runedelta([], [0]) }).label, "À publier");
  assert.equal(spriteState({ overrideFrames: [0], runedelta: runedelta([0]) }).label, "✓ Publié");
  assert.equal(spriteState({ overrideFrames: [], hasText: true, runedelta: runedelta([0, 1]) }).label, "✓ Sur Runedelta");
  assert.equal(spriteState({ overrideFrames: [0], pendingFrames: [0], runedelta: runedelta([], [0]) }).label, "À appliquer");
  assert.equal(spriteState({ overrideFrames: [0] }).label, "✓ Importé");
});
