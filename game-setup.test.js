const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { discoverChapters, findChapters, steamLibraryPaths, validateDataWin } = require("./game-discovery.js");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deltatranslate-setup-"));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith("deltatranslate-setup-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

async function dataWin(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const buffer = Buffer.alloc(16);
  buffer.write("FORM");
  buffer.writeUInt32LE(8, 4);
  await fs.writeFile(file, buffer);
  return file;
}

test("bibliothèques Steam : chemins Windows échappés et chemins avec espaces", () => {
  const source = '"libraryfolders" { "0" { "path" "C:\\\\Program Files\\\\Steam" } "1" { "path" "/media/Jeux Steam" } }';
  assert.deepEqual(steamLibraryPaths(source), ["C:\\Program Files\\Steam", "/media/Jeux Steam"]);
});

test("premier lancement sans Steam ni extraction : résultat vide", async (t) => {
  const root = await fixture(t);
  assert.deepEqual(await discoverChapters({ steamRoots: [root] }), []);
});

test("détecter une bibliothèque secondaire, ignorer le lanceur et les autres jeux", async (t) => {
  const root = await fixture(t);
  const steam = path.join(root, "Steam");
  const library = path.join(root, "Jeux ailleurs");
  await fs.mkdir(path.join(steam, "steamapps"), { recursive: true });
  await fs.writeFile(path.join(steam, "steamapps", "libraryfolders.vdf"), `"path" ${JSON.stringify(library)}`);
  const game = path.join(library, "steamapps", "common", "DELTARUNE");
  const chapter = await dataWin(path.join(game, "chapter2_windows", "data.win"));
  await dataWin(path.join(game, "data.win"));
  await dataWin(path.join(library, "steamapps", "common", "Autre jeu", "data.win"));
  const found = await discoverChapters({ steamRoots: [steam, library] });
  assert.deepEqual(found.map((item) => item.path), [chapter]);
  assert.equal(found[0].label, "Chapitre 2");
});

test("dossier choisi : chapitres triés, sous-dossiers inutiles ignorés", async (t) => {
  const root = await fixture(t);
  await dataWin(path.join(root, "chapter10_windows", "data.win"));
  await dataWin(path.join(root, "chapter2_windows", "data.win"));
  await dataWin(path.join(root, "backups", "data.win"));
  assert.deepEqual((await findChapters(root)).map((item) => item.label), ["Chapitre 2", "Chapitre 10"]);
});

test("dossier macOS : trouver les données dans le bundle du chapitre", async (t) => {
  const root = await fixture(t);
  const file = await dataWin(path.join(root, "chapter1_mac", "DELTARUNE.app", "Contents", "Resources", "data.win"));
  assert.deepEqual((await findChapters(root)).map((item) => item.path), [file]);
});

test("chapitre actuel : retrouver les voisins sans doublons", async (t) => {
  const root = await fixture(t);
  const file = await dataWin(path.join(root, "chapter3_windows", "data.win"));
  await dataWin(path.join(root, "chapter4_windows", "data.win"));
  const found = await discoverChapters({ steamRoots: [], currentDataWin: file });
  assert.equal(found.length, 2);
  assert.equal(new Set(found.map((item) => item.path)).size, 2);
});

test("validation : refuser les mauvais fichiers avant tout téléchargement, sans modifier le jeu", async (t) => {
  const root = await fixture(t);
  const file = await dataWin(path.join(root, "data.win"));
  const before = await fs.readFile(file);
  assert.equal((await validateDataWin(file)).ok, true);
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await validateDataWin(root)).ok, false);
  assert.equal((await validateDataWin(null)).ok, false);
  assert.equal((await validateDataWin(path.join(root, "absent", "data.win"))).ok, false);
  await fs.writeFile(file, "un fichier sans données GameMaker");
  assert.equal((await validateDataWin(file)).ok, false);
});

function fakeApi(overrides = {}) {
  const calls = [];
  const api = {};
  const results = {
    validateDataWin: { ok: true }, getUtmtStatus: { ready: false },
    installUtmt: { ok: true }, importDataWin: { ok: true, config: { dataWinPath: "chapitre/data.win" } },
    ...overrides,
  };
  for (const [name, result] of Object.entries(results)) {
    api[name] = async () => { calls.push(name); if (result instanceof Error) throw result; return result; };
  }
  return { api, calls };
}

test("préparation complète : valider, installer automatiquement puis importer", async () => {
  const { prepareChapter } = await import("./src/setup-flow.mjs");
  const { api, calls } = fakeApi();
  const stages = [];
  const result = await prepareChapter(api, "chapitre/data.win", (stage) => stages.push(stage));
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["validateDataWin", "getUtmtStatus", "installUtmt", "importDataWin"]);
  assert.deepEqual(stages, ["tools", "import", "done"]);
});

test("UTMT déjà présent : importer sans réseau", async () => {
  const { prepareChapter } = await import("./src/setup-flow.mjs");
  const { api, calls } = fakeApi({ getUtmtStatus: { ready: true } });
  await prepareChapter(api, "data.win", () => {});
  assert.ok(!calls.includes("installUtmt"));
});

test("erreurs : arrêter à l’étape en échec et permettre une nouvelle tentative", async () => {
  const { prepareChapter } = await import("./src/setup-flow.mjs");
  for (const [failure, expectedCalls] of [["validateDataWin", 1], ["installUtmt", 3], ["importDataWin", 4]]) {
    const { api, calls } = fakeApi({ [failure]: { ok: false, error: "Échec simulé" } });
    const stages = [];
    await assert.rejects(prepareChapter(api, "data.win", (stage) => stages.push(stage)), /Échec simulé/);
    assert.equal(calls.length, expectedCalls);
    assert.ok(!stages.includes("done"));
    api[failure] = async () => ({ ok: true });
    await prepareChapter(api, "data.win", () => {});
  }
  const { api } = fakeApi({ installUtmt: new Error("Connexion interrompue") });
  await assert.rejects(prepareChapter(api, "data.win", () => {}), /Connexion interrompue/);
});

test("deux installations du même chapitre gardent des espaces de traduction distincts", async (t) => {
  const { extractionDirectory } = await import("./extraction/workspace-path.mjs");
  const root = await fixture(t);
  const first = path.join(root, "Jeu", "chapter5_windows", "data.win");
  const second = path.join(root, "Copie", "chapter5_windows", "data.win");
  assert.notEqual(extractionDirectory(root, first), extractionDirectory(root, second));
  assert.equal(extractionDirectory(root, first), extractionDirectory(root, first));
});

test("réimport : conserver le workspace historique appartenant à cette installation", async (t) => {
  const { extractionDirectory } = await import("./extraction/workspace-path.mjs");
  const root = await fixture(t);
  const source = path.join(root, "Jeu", "chapter5_windows", "data.win");
  const legacy = path.join(root, "chapter5_windows");
  await fs.mkdir(legacy);
  await fs.writeFile(path.join(legacy, "extraction-source.json"), JSON.stringify({ path: path.join(path.dirname(source), "data-original.win") }));
  await fs.writeFile(path.join(legacy, "translation_fr.json"), '{"travail":"à conserver"}');
  assert.equal(extractionDirectory(root, source), legacy);
  assert.notEqual(extractionDirectory(root, path.join(root, "Copie", "chapter5_windows", "data.win")), legacy);
  assert.equal(await fs.readFile(path.join(legacy, "translation_fr.json"), "utf8"), '{"travail":"à conserver"}');
});
