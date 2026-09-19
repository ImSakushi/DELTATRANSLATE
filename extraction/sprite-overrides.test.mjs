import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { spriteBounds, validatePlacement } from "../src/sprite-geometry.mjs";
import { readPlacement, readPngSize, validateSpriteOverrides } from "./sprite-overrides.mjs";

test("une texture plus grande et décalée conserve tous ses pixels et le repère original", () => {
  const original = { width: 29, height: 9 };
  assert.deepEqual(spriteBounds(original, [{ width: 57, height: 12, x: -14, y: -2 }]),
    { left: -14, top: -2, width: 57, height: 12 });
  assert.deepEqual(spriteBounds(original, [{ width: 8, height: 4, x: 3, y: 2 }]),
    { left: 0, top: 0, width: 29, height: 9 });
  const frames = [{ width: 57, height: 12, x: -14, y: -2 }, { width: 31, height: 10, x: 20, y: 4 }];
  const bounds = spriteBounds(original, frames);
  for (const frame of [...frames, { x: 0, y: 0, ...original }]) {
    assert.ok(frame.x - bounds.left >= 0 && frame.x + frame.width - bounds.left <= bounds.width);
    // L'origine compensée laisse le placement visible indépendant des autres frames.
    assert.equal((frame.x - bounds.left) - (7 - bounds.left), frame.x - 7);
  }
});

test("refuse les positions fractionnaires, les PNG vides et les limites cumulées", () => {
  for (const x of [NaN, Infinity, .5, "2", 8193]) assert.throws(() => validatePlacement({ x, y: 0 }));
  assert.throws(() => spriteBounds({ width: 29, height: 9 }, [{ x: 0, y: 0, width: 0, height: 9 }]));
  assert.throws(() => spriteBounds({ width: 29, height: 9 }, [{ x: 8190, y: 0, width: 29, height: 9 }]));
  assert.throws(() => spriteBounds({ width: 29, height: 9 }, [{ x: 0, y: 0, width: 8192, height: 8192 }]));
});

test("les positions persistent par frame ; les anciens imports restent à 0,0", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dt-sprites-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual(readPlacement(directory, 0), { x: 0, y: 0 });
  fs.writeFileSync(path.join(directory, "0.offset"), "-14;2\n");
  assert.deepEqual(readPlacement(directory, 0), { x: -14, y: 2 });
  assert.deepEqual(readPlacement(directory, 1), { x: 0, y: 0 });
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.write("IHDR", 12); header.writeUInt32BE(57, 16); header.writeUInt32BE(12, 20);
  fs.writeFileSync(path.join(directory, "0.png"), header);
  assert.deepEqual(readPngSize(path.join(directory, "0.png")), { width: 57, height: 12 });
  assert.deepEqual(validateSpriteOverrides(directory, { width: 29, height: 9 }, { frame: 1, width: 31, height: 10, x: 20, y: 4 }),
    { left: -14, top: 0, width: 65, height: 14 });
  // Le remplacement d'une frame n'additionne pas les dimensions de sa version précédente.
  assert.deepEqual(validateSpriteOverrides(directory, { width: 29, height: 9 }, { frame: 0, width: 29, height: 9, x: 0, y: 0 }),
    { left: 0, top: 0, width: 29, height: 9 });
  fs.writeFileSync(path.join(directory, "0.offset"), "oops;0");
  assert.throws(() => readPlacement(directory, 0), /Position invalide/);
  fs.writeFileSync(path.join(directory, "0.png"), "PNG tronqué");
  assert.throws(() => readPngSize(path.join(directory, "0.png")), /PNG valide/);
});

function loadRenderer(file, dependencies = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace("export class", "class");
  return vm.runInNewContext(`${source}\n${file.includes("placement") ? "SpritePlacement" : "SpriteEditor"};`, dependencies);
}

test("déplacer au clavier et à la souris suit le zoom, sans déplacer le repère de la vue", () => {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", checked: false, clientWidth: 0, clientHeight: 0,
      events: {}, addEventListener(type, cb) { this.events[type] = cb; }, focus() {}, setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 400 }) });
    return elements.get(id);
  };
  const Placement = loadRenderer("../src/sprite-placement.js", { spriteBounds, validatePlacement, ResizeObserver: class { observe() {} } });
  const preview = new Placement($, () => {});
  preview.load({ width: 29, height: 9, originX: 0, originY: 0 }, { translated: { width: 57, height: 12 } }, { x: -14, y: 0 }, true);
  preview.zoom = 4; preview.center = { x: 0, y: 0 };
  const canvas = $("sprite-placement-canvas");
  const event = { preventDefault() {}, stopPropagation() {}, key: "ArrowRight", shiftKey: false };
  canvas.events.keydown(event);
  assert.equal(preview.position.x, -13);
  canvas.events.keydown({ ...event, key: "ArrowUp", shiftKey: true });
  assert.equal(preview.position.y, -10);
  canvas.events.pointerdown({ ...event, button: 0, clientX: 500, clientY: 200, pointerId: 1 });
  canvas.events.pointermove({ clientX: 508, clientY: 204 });
  assert.equal(preview.position.x, -11);
  assert.equal(preview.position.y, -9);
  assert.equal(preview.center.x, 0);
  preview.busy = true;
  canvas.events.keydown(event);
  assert.equal(preview.position.x, -11);
});

test("un échec de sauvegarde de position empêche le changement de sprite et garde le brouillon", async () => {
  const Editor = loadRenderer("../src/sprites.js", { window: { api: { saveSpritePlacement: async () => ({ ok: false, error: "Disque plein" }) } } });
  const editor = new Editor(() => ({}));
  editor.selectedName = "first";
  editor.catalog = [{ name: "second" }];
  editor.placement = { dirty: true, position: { x: -3, y: 1 }, saved: { x: 0, y: 0 } };
  editor.setBusy = (value) => { editor.operationRunning = value; };
  editor.message = (message) => { editor.error = message; };
  await editor.select("second");
  assert.equal(editor.selectedName, "first");
  assert.equal(editor.placement.position.x, -3);
  assert.equal(editor.placement.saved.x, 0);
  assert.equal(editor.operationRunning, false);
  assert.equal(editor.error, "Disque plein");
});

test("l'ouverture depuis le GML révèle une traduction filtrée et respecte l'annulation de fermeture", () => {
  const source = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const code = source.slice(source.indexOf("function openCodeTranslation("), source.indexOf("\nfunction entryFileOrder("));
  const nodes = new Map();
  const context = { selectedKey: "wanted", entriesByKey: new Map([["wanted", {}]]), filtered: [], prefs: { speakerFilter: "susie" },
    closeCodeModal: () => false, spriteEditor: { showView() { context.shown = true; } }, selectKey() {},
    $: (id) => { if (!nodes.has(id)) nodes.set(id, { focus() { this.focused = true; } }); return nodes.get(id); },
    document: { querySelector: () => ({ classList: { add() {}, remove() {} } }) },
    applyFilter() { context.revealed = true; }, scrollToSelected() {},
  };
  vm.runInNewContext(`${code}\nopenCodeTranslation();`, context);
  assert.equal(context.shown, undefined);
  context.closeCodeModal = () => true;
  vm.runInNewContext("openCodeTranslation();", context);
  assert.equal(context.shown, true);
  assert.equal(context.revealed, true);
  assert.equal(context.prefs.speakerFilter, "all");
  assert.equal(nodes.get("fr-input").focused, true);
});
