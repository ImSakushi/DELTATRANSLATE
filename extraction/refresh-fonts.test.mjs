import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { refreshFonts } from "./refresh-fonts.mjs";
import { repairDialogueScopes } from "./repair-dialogue-scopes.mjs";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dt-font-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataWin = path.join(dir, "data.win");
  fs.writeFileSync(dataWin, "jeu inchangé");
  const outDir = path.join(dir, "cache");
  fs.mkdirSync(path.join(outDir, "fonts"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "fonts", "glyphs_fnt_main.csv"), "ancien");
  fs.writeFileSync(path.join(outDir, "fonts", "fnt_main.png"), "ancienne texture");
  return { cli: "utmt", dir, dataWin, outDir };
}

test("un échec d'extraction garde le cache précédent et le jeu", async t => {
  for (const result of [{ status: 1, stderr: "échec" }, { status: 0, stdout: "FONTS_OK" }]) {
    const setup = fixture(t);
    await assert.rejects(refreshFonts({ ...setup, runner: async () => result }));
    assert.equal(fs.readFileSync(path.join(setup.outDir, "fonts", "glyphs_fnt_main.csv"), "utf8"), "ancien");
    assert.equal(fs.readFileSync(setup.dataWin, "utf8"), "jeu inchangé");
    assert.deepEqual(fs.readdirSync(setup.outDir), ["fonts"]);
  }
});

test("les nouveaux glyphes remplacent le cache, qui est réutilisé uniquement pour le même jeu", async t => {
  const setup = fixture(t);
  let calls = 0;
  const runner = async (_cli, args) => {
    calls++;
    assert.deepEqual(args.slice(0, 3), ["load", setup.dataWin, "-s"]);
    const fonts = path.join(path.dirname(args[3]), "fonts");
    fs.mkdirSync(fonts);
    fs.writeFileSync(path.join(fonts, "glyphs_fnt_main.csv"), "nouvelle police\n233;0;0;8;12;8;0");
    fs.writeFileSync(path.join(fonts, "fnt_main.png"), "nouvelle texture");
    return { status: 0, stdout: "FONTS_OK" };
  };
  const result = await refreshFonts({ ...setup, runner });
  assert.match(result.fnt_main, /233;/);
  await refreshFonts({ ...setup, runner });
  assert.equal(calls, 1);
  fs.appendFileSync(setup.dataWin, " modifié");
  await refreshFonts({ ...setup, runner });
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(setup.dataWin, "utf8"), "jeu inchangé modifié");
});

test("les métadonnées déjà en cache perdent le faux portrait sans changer les textes", t => {
  const { dir } = fixture(t);
  fs.writeFileSync(path.join(dir, "script.gml"), 'switch (scene) {\ncase 1:\nglobal.fc = 19;\nbreak;\ncase 2:\nmsg[0] = "Après";\n}');
  const reference = { id: { file: "script", line: 6, channel: "message", en: "Après", face: { fc: 19, fe: 0 }, speaker: "burgerpants" } };
  repairDialogueScopes(reference, dir);
  assert.equal(reference.id.face, undefined);
  assert.equal(reference.id.speaker, undefined);
  assert.equal(reference.id.en, "Après");
});
