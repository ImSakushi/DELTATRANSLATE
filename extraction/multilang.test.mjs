import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeLanguage, prepareLanguage, installedLanguages } from "./languages.mjs";
import { routeDrawCalls, prepareMultilangGml, runtimeGml } from "./multilang-gml.mjs";
import { installTransaction, restoreTransaction, hashFile } from "./install-language.mjs";
import { prepareLauncherGml } from "./launcher-language.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dt-language-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("codes de langue : régions, normalisation, langues natives et chemins refusés", () => {
  assert.equal(normalizeLanguage(" FR "), "fr");
  assert.equal(normalizeLanguage("pt-BR"), "pt_br");
  assert.equal(normalizeLanguage("zh-Hant-TW"), "zh_hant_tw");
  for (const value of ["en", "ja", "../fr", "fr/foo", "fr.json", "", "../../data.win", 'fr";'])
    assert.throws(() => normalizeLanguage(value));
});

test("ajouter les clés anglaises absentes préserve les traductions, tags, date et anciennes clés", (t) => {
  const root = fixture(t);
  const original = { date: "100", dialog: "Déjà traduit^1!\\E0", ancien: "Conserver" };
  fs.writeFileSync(path.join(root, "lang_fr.json"), JSON.stringify(original));
  const result = prepareLanguage({ reference: { dialog: { en: "English" }, nouveau: { en: "New" } }, language: "fr", langDir: root, workspace: root });
  assert.deepEqual(JSON.parse(result.content), { ...original, nouveau: "New" });
  assert.deepEqual(JSON.parse(fs.readFileSync(result.target)), original);
});

test("réimport sans nouvelles clés : conservation exacte des octets du JSON", (t) => {
  const root = fixture(t);
  const original = '{\r\n  "date": "001",\r\n  "hello": "Bonjour"\r\n}\r\n';
  fs.writeFileSync(path.join(root, "lang_fr.json"), original);
  const result = prepareLanguage({ reference: { hello: { en: "Hi" } }, language: "fr", langDir: root, workspace: root });
  assert.equal(result.content, original);
  assert.equal(prepareLanguage({ reference: { hello: { en: "Hi" } }, language: "es", langDir: root, workspace: root }).target, path.join(root, "lang_es.json"));
});

test("fichier de langue invalide : aucune réinitialisation silencieuse", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "lang_fr.json"), '{"texte":42}');
  assert.throws(() => prepareLanguage({ reference: {}, language: "fr", langDir: root, workspace: root }));
  assert.equal(fs.readFileSync(path.join(root, "lang_fr.json"), "utf8"), '{"texte":42}');
});

test("découverte des langues : les fichiers natifs et sauvegardes ne sont pas des ajouts", (t) => {
  const root = fixture(t);
  for (const name of ["lang_fr.json", "lang_ja.json", "lang_en.json", "lang_es.json", "lang_fr.json.bak", "lang_pt_br.json"])
    fs.writeFileSync(path.join(root, name), "{}");
  assert.deepEqual(installedLanguages(root), ["es", "fr", "pt_br"]);
});

test("routage graphique : ignorer déclarations, chaînes et commentaires ; conserver les indices du gameplay", () => {
  const source = 'function draw_sprite_custom(sprite, x) { draw_sprite_ext(sprite, 0, x, f(1,2)); }\n' +
    'sprite_index = 12; if (sprite_index == 12) draw_self();\n' +
    '// draw_sprite(texte, 0)\nvar texte = "draw_sprite(texte, 0)";\n' +
    'layer_sprite_create(layer, x, y, choose(sprite, other));\ndraw_set_font(font);\n' +
    'sprite_get_texture(sprite, 0); sprite_get_uvs(sprite, 0);';
  const routed = routeDrawCalls(source);
  assert.ok(routed.includes("function draw_sprite_custom(sprite, x)"));
  assert.ok(routed.includes("draw_sprite_ext(dt_sprite(sprite), 0, x, f(1,2))"));
  assert.ok(routed.includes("sprite_index = 12; if (sprite_index == 12) dt_draw_self();"));
  assert.ok(routed.includes('// draw_sprite(texte, 0)\nvar texte = "draw_sprite(texte, 0)";'));
  assert.ok(routed.includes("layer_sprite_create(layer, x, y,dt_sprite( choose(sprite, other)))"));
  assert.ok(routed.includes("draw_set_font(dt_font(font))"));
  assert.ok(routed.includes("sprite_get_texture(dt_sprite(sprite), 0); sprite_get_uvs(dt_sprite(sprite), 0)"));
  assert.equal(routeDrawCalls(routed), routed);
});

test("cycle extensible : les langues natives entourent les ajouts uniques", () => {
  const source = runtimeGml(["fr", "es", "fr"]);
  assert.ok(source.includes('["en","es","fr","ja"]'));
  assert.ok(source.includes("file_exists"));
  assert.ok(!source.includes("sprite_index = dt_sprite"));
});

test("installation transactionnelle : sauvegarde, restauration et échec partiel", (t) => {
  const root = fixture(t);
  const source = path.join(root, "build.win");
  const target = path.join(root, "data.win");
  const json = path.join(root, "lang_fr.json");
  fs.writeFileSync(source, "nouveau");
  fs.writeFileSync(target, "original");
  const backup = installTransaction([{ source, target }, { source, target: json }], path.join(root, "backups"));
  assert.equal(hashFile(target), hashFile(source));
  restoreTransaction(backup);
  assert.equal(fs.readFileSync(target, "utf8"), "original");
  assert.equal(fs.existsSync(json), false);
  assert.throws(() => installTransaction([{ source, target }, { source: path.join(root, "absent"), target: json }], path.join(root, "backups")));
  assert.equal(fs.readFileSync(target, "utf8"), "original");
  assert.equal(fs.existsSync(json), false);
});

test("version inconnue du jeu : refuser avant compilation et conserver la source", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "inconnu.gml"), "var x = 1;");
  assert.throws(() => prepareMultilangGml({ codeDir: root, outputDir: path.join(root, "out"), languages: ["fr"] }), /non reconnue/);
  assert.equal(fs.existsSync(path.join(root, "out")), false);
});

test("installation : une traduction modifiée pendant la compilation reste intacte", (t) => {
  const root = fixture(t);
  const source = path.join(root, "build.win");
  const target = path.join(root, "data.win");
  const lang = path.join(root, "lang_fr.json");
  fs.writeFileSync(source, "nouveau");
  fs.writeFileSync(target, "original");
  fs.writeFileSync(lang, "première traduction");
  const expected = hashFile(lang);
  fs.writeFileSync(lang, "traduction en cours");
  assert.throws(() => installTransaction([{ source, target }, { source, target: lang, expected }], path.join(root, "backups")), /changé/);
  assert.equal(fs.readFileSync(target, "utf8"), "original");
  assert.equal(fs.readFileSync(lang, "utf8"), "traduction en cours");
  assert.equal(fs.existsSync(path.join(root, "backups")), false);
});

test("lanceur : prochain choix, fonte japonaise, garde des chapitres sans traduction", (t) => {
  const root = fixture(t);
  const main = 'var chapstring = string(_target_chapter);\nvar target_lang = (global.lang == "en") ? "ja" : "en";\nglobal.lang = target_lang;';
  const footer = 'var language_text = (global.lang == "en") ? "日本語" : "English";\nif (global.lang == "en") { language_choice.set_font(1); }';
  fs.writeFileSync(path.join(root, "gml_Object_obj_CHAPTER_SELECT_Create_0.gml"), main);
  fs.writeFileSync(path.join(root, "gml_Object_obj_screen_select_footer_Create_0.gml"), footer);
  fs.writeFileSync(path.join(root, "gml_GlobalScript_scr_init.gml"), "function scr_init() {}\n");
  const out = path.join(root, "out");
  prepareLauncherGml(root, out, ["fr", "es"]);
  assert.match(fs.readFileSync(path.join(out, "gml_Object_obj_CHAPTER_SELECT_Create_0.gml"), "utf8"), /target_lang = dt_launcher_next/);
  assert.match(fs.readFileSync(path.join(out, "gml_Object_obj_screen_select_footer_Create_0.gml"), "utf8"), /dt_launcher_next\(\) == "ja"/);
  assert.match(fs.readFileSync(path.join(out, "gml_GlobalScript_scr_init.gml"), "utf8"), /file_exists/);
});
