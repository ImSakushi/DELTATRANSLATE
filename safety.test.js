const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const storage = require("./storage.js");
const vm = require("node:vm");

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-safety-"));
  t.after(() => {
    const absolute = path.resolve(root);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith("deltatranslate-safety-"));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return root;
}

test("une saisie pendant la sauvegarde reste présente et distincte de la version enregistrée", async () => {
  const { mergeSavedEdits } = await import("./src/editor-state.mjs");
  const snapshot = { date: "0", a: "première traduction", b: "inchangé" };
  const current = { ...snapshot, a: "nouvelle saisie", c: "nouvelle clé" };
  const saved = { ...snapshot, b: "mise à jour distante" };
  assert.deepEqual(mergeSavedEdits(current, snapshot, saved), { date: "0", a: "nouvelle saisie", b: "mise à jour distante", c: "nouvelle clé" });
  assert.equal(saved.a, "première traduction");
});

test("les clés sans référence restent accessibles après réimport", async () => {
  const { catalogKeys } = await import("./src/editor-state.mjs");
  assert.deepEqual(catalogKeys({ date: "0", known: "a", orphan: "b" }, { known: {}, added: {} }), ["known", "orphan", "added"]);
});

test("l’écriture JSON préserve ordre, date et valeurs, et refuse un contenu invalide", t => {
  const root = workspace(t), file = path.join(root, "lang.json");
  const content = '{\n  "date": "10",\n  "z": "\\\\E7 Été",\n  "a": "~1"\n}';
  storage.atomicWrite(file, content, { json: true });
  assert.equal(fs.readFileSync(file, "utf8"), content);
  assert.throws(() => storage.atomicWrite(file, "{", { json: true }));
  assert.equal(fs.readFileSync(file, "utf8"), content);
});

test("un échec du remplacement atomique laisse le fichier précédent intact", t => {
  const root = workspace(t), file = path.join(root, "lang.json");
  fs.writeFileSync(file, '{"a":"avant"}');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error("Fichier verrouillé"); };
  try { assert.throws(() => storage.atomicWrite(file, '{"a":"après"}', { json: true }), /verrouillé/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file, "utf8"), '{"a":"avant"}');
  assert.deepEqual(fs.readdirSync(root), ["lang.json"]);
});

test("un fichier modifié extérieurement n’est pas écrasé", t => {
  const root = workspace(t), file = path.join(root, "lang.json");
  storage.atomicWrite(file, '{"a":"base"}');
  const expected = storage.revision(file);
  storage.atomicWrite(file, '{"a":"externe"}');
  assert.throws(() => storage.atomicWrite(file, '{"a":"éditeur"}', { expected, json: true }), /changé/);
  assert.equal(fs.readFileSync(file, "utf8"), '{"a":"externe"}');
  assert.deepEqual(fs.readdirSync(root), ["lang.json"]);
});

test("deux chapitres ont chacun 40 backups et des brouillons indépendants", t => {
  const root = workspace(t), backups = path.join(root, "backups");
  const first = path.join(root, "chapter1", "lang_fr.json"), fifth = path.join(root, "chapter5", "lang_fr.json");
  for (let index = 0; index < 43; index++) storage.backup(backups, first, JSON.stringify({ a: String(index) }));
  assert.ok(storage.backup(backups, fifth, '{"a":"chapitre 5"}'));
  assert.ok(storage.backup(backups, first, '{"a":"brouillon"}', { kind: "draft", interval: 60000 }));
  assert.equal(storage.listBackups(backups, first).filter(item => item.kind === "saved").length, 40);
  assert.equal(storage.listBackups(backups, first).filter(item => item.kind === "draft").length, 1);
  assert.equal(storage.listBackups(backups, fifth).length, 1);
  const item = storage.listBackups(backups, fifth)[0];
  assert.deepEqual(storage.readBackup(backups, fifth, item.id), { a: "chapitre 5" });
  assert.throws(() => storage.readBackup(backups, fifth, "../../prefs.json"));
});

test("les préférences historiques migrent vers un seul projet sans perdre les validations", () => {
  const original = { theme: "classic", validated: { common: true }, faceOverrides: { common: { fc: 2 } } };
  const migrated = storage.migratePreferences(original, "first");
  const updated = storage.mergePreferences(migrated, "second", { theme: "deltarune", validated: { other: true } });
  assert.equal(storage.scopedPreferences(updated, "first").validated.common, true);
  assert.deepEqual(storage.scopedPreferences(updated, "second").validated, { other: true });
  assert.equal(storage.scopedPreferences(updated, "first").theme, "deltarune");
  assert.deepEqual(original.validated, { common: true });
});

test("un horodatage de fichier en avance ne supprime pas les backups sans intervalle", t => {
  const root = workspace(t), backups = path.join(root, "backups"), file = path.join(root, "lang.json");
  const first = storage.backup(backups, file, '{"a":"avant"}');
  const future = new Date(Date.now() + 1000);
  fs.utimesSync(first, future, future);
  assert.ok(storage.backup(backups, file, '{"a":"après"}'));
  assert.equal(storage.listBackups(backups, file).length, 2);
  assert.equal(storage.backup(backups, file, '{"a":"intervalle"}', { interval: 60_000 }), null);
});

test("un fichier de préférences corrompu est signalé et préservé", t => {
  const file = path.join(workspace(t), "prefs.json");
  fs.writeFileSync(file, '{"validated":');
  assert.throws(() => storage.readJson(file), /conservé/);
  assert.equal(fs.readFileSync(file, "utf8"), '{"validated":');
});

test("un réimport abandonné garde le chapitre utilisable et ses overrides", async t => {
  const { beginWorkspace, abandonWorkspace, commitWorkspace, cleanupInterruptedWorkspace } = await import("./extraction/workspace-transaction.mjs");
  const root = workspace(t), target = path.join(root, "chapter5");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "reference.json"), "ancienne référence");
  fs.writeFileSync(path.join(target, "override.gml"), "travail utilisateur");
  const canceled = beginWorkspace(target);
  fs.writeFileSync(path.join(canceled.stage, "reference.json"), "incomplet");
  abandonWorkspace(canceled);
  assert.equal(fs.readFileSync(path.join(target, "reference.json"), "utf8"), "ancienne référence");
  const completed = beginWorkspace(target);
  fs.writeFileSync(path.join(completed.stage, "reference.json"), "nouvelle référence");
  commitWorkspace(completed);
  assert.equal(fs.readFileSync(path.join(target, "reference.json"), "utf8"), "nouvelle référence");
  assert.equal(fs.readFileSync(path.join(target, "override.gml"), "utf8"), "travail utilisateur");
  const interrupted = beginWorkspace(target);
  cleanupInterruptedWorkspace(root, interrupted.stage);
  assert.equal(fs.existsSync(interrupted.stage), false);
  assert.throws(() => cleanupInterruptedWorkspace(root, target), /invalide/);
  assert.equal(fs.existsSync(target), true);
});

test("une mise à jour officielle n’est jamais recompilée depuis l’ancien original", async t => {
  const { chooseSource, assertActiveVersion, recordGeneratedVersion } = await import("./extraction/source-version.mjs");
  const root = workspace(t), file = path.join(root, "data.win"), cache = path.join(root, "cache");
  fs.mkdirSync(cache);
  fs.writeFileSync(file, "original v1");
  const first = chooseSource(file, cache);
  fs.writeFileSync(file, "compilation v1");
  recordGeneratedVersion(file, cache);
  assert.equal(chooseSource(file, cache).source, first.source);
  fs.writeFileSync(file, "original v2");
  assert.throws(() => assertActiveVersion(file, cache), /changé/);
  assert.throws(() => chooseSource(file, cache), /nouvel original/);
  const next = chooseSource(file, cache, { originalConfirmed: true });
  assert.notEqual(first.source, next.source);
  assert.equal(fs.readFileSync(first.source, "utf8"), "original v1");
  assert.equal(fs.readFileSync(next.source, "utf8"), "original v2");
  assert.equal(next.changed, true);
});

test("les conflits acceptent des choix différents par clé et une traduction manuelle", () => {
  const { mergeLanguages } = require("./runedelta-sync.js");
  const base = { a: "base", b: "base", c: "base" };
  const local = { a: "local", b: "local", c: "local" };
  const remote = { a: "distant", b: "distant", c: "distant" };
  const result = mergeLanguages(base, local, remote, { a: "local", b: "remote", c: { value: "manuel" } });
  assert.deepEqual(result.language, { a: "local", b: "distant", c: "manuel" });
  assert.deepEqual(result.conflicts, []);
  const changedWhileReading = mergeLanguages({ a: "base" }, { a: "local" }, { a: "nouveau distant" }, {
    a: { choice: "local", expected: { base: "base", local: "local", remote: "ancien distant" } },
  });
  assert.deepEqual(changedWhileReading.conflicts, ["a"]);
});

test("le contrôle qualité détecte les arguments perdus et les balises incomplètes", async () => {
  const { textIssues } = await import("./src/review-tools.mjs");
  assert.deepEqual(textIssues("Hi ~1 /", "Salut ~1 /"), []);
  assert.ok(textIssues("~1 ~2", "~1").some(issue => issue.includes("arguments")));
  assert.ok(textIssues("Hello", "Bonjour\\E").some(issue => issue.includes("incomplète")));
});

test("la migration retrouve une clé renommée et signale un anglais modifié", async () => {
  const { planMigration } = await import("./extraction/translation-migration.mjs");
  const old = { old: { file: "scene", en: "Hello" }, same: { file: "scene", en: "Old" } };
  const next = { new: { file: "scene", en: "Hello" }, same: { file: "scene", en: "New" } };
  const migration = planMigration(old, next, { old: "Bonjour", same: "Ancien" });
  assert.deepEqual(migration.suggestions, { new: { from: "old", value: "Bonjour" } });
  assert.deepEqual(migration.review, ["same"]);
  assert.deepEqual(migration.orphaned, ["old"]);
});

test("deux langues de la même installation ont des préférences distinctes", () => {
  const config = { dataWinPath: path.resolve("chapter5/data.win") };
  assert.notEqual(storage.projectId({ ...config, targetLanguage: "fr" }), storage.projectId({ ...config, targetLanguage: "es" }));
});

function mainHarness(t) {
  const root = workspace(t);
  const languageFile = path.join(root, "lang_fr.json");
  fs.writeFileSync(languageFile, '{\n  "date": "0",\n  "key": "Ancien"\n}');
  const config = { langFrPath: languageFile, dataWinPath: path.join(root, "data.win"), targetLanguage: "fr", storageMode: "lang-json" };
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(config));
  const handlers = new Map();
  let closeOptions;
  const window = { isDestroyed: () => false };
  const electron = {
    app: { setName() {}, getPath: () => root, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { fromWebContents: () => window, getAllWindows: () => [] },
    dialog: { showMessageBox: async (_window, options) => { closeOptions = options; return { response: options.cancelId }; } },
    shell: {},
  };
  const context = {
    __dirname: root, process, console, Buffer, URL, WeakSet, AbortController,
    require(name) {
      if (name === "electron") return electron;
      if (name === "./updater.js") return { createUpdaterController: () => ({}) };
      return require(name.startsWith("./") ? path.resolve(__dirname, name) : name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "main.js"), "utf8"), context, { filename: "main.js" });
  return { root, languageFile, config, handlers, closeOptions: () => closeOptions };
}

test("IPC sauvegarde : protège le fichier externe et conserve une copie de la saisie refusée", async t => {
  const harness = mainHarness(t);
  fs.writeFileSync(path.join(harness.root, "prefs.json"), JSON.stringify({ backupsEnabled: true }));
  const expected = storage.revision(harness.languageFile);
  fs.writeFileSync(harness.languageFile, '{"date":"0","key":"Externe"}');
  const result = await harness.handlers.get("save-lang")({}, { date: "0", key: "Saisie" }, expected, storage.projectId(harness.config));
  assert.equal(result.ok, false);
  assert.match(result.error, /changé/);
  assert.equal(JSON.parse(fs.readFileSync(harness.languageFile, "utf8")).key, "Externe");
  const drafts = storage.listBackups(path.join(harness.root, "backups"), harness.languageFile);
  assert.equal(drafts[0].kind, "draft");
  assert.equal(storage.readBackup(path.join(harness.root, "backups"), harness.languageFile, drafts[0].id).key, "Saisie");
});

test("IPC sauvegarde : conserve date et ordre et retourne la nouvelle révision", async t => {
  const harness = mainHarness(t);
  fs.writeFileSync(path.join(harness.root, "prefs.json"), JSON.stringify({ backupsEnabled: true }));
  const expected = storage.revision(harness.languageFile);
  const result = await harness.handlers.get("save-lang")({}, { date: "0", key: "Nouveau" }, expected, storage.projectId(harness.config));
  assert.equal(result.ok, true);
  assert.equal(result.revision, storage.revision(harness.languageFile));
  assert.equal(fs.readFileSync(harness.languageFile, "utf8"), '{\n  "date": "0",\n  "key": "Nouveau"\n}');
  assert.equal(result.backupCreated, true);
});

test("IPC backups : désactivés par défaut, activables et désactivables sans perdre les préférences", async t => {
  const harness = mainHarness(t);
  const project = storage.projectId(harness.config);
  const prefsFile = path.join(harness.root, "prefs.json");
  const backups = path.join(harness.root, "backups");
  const save = () => harness.handlers.get("save-lang")({}, { date: "0", key: "Nouveau" }, storage.revision(harness.languageFile), project);
  const draft = () => harness.handlers.get("backup-lang")({}, { date: "0", key: "Brouillon" }, project);
  assert.equal((await save()).backupCreated, false);
  assert.equal(draft().disabled, true);
  harness.handlers.get("save-prefs")({}, { validated: { key: true } }, project);
  assert.equal(fs.existsSync(backups), false);
  harness.handlers.get("save-prefs")({}, { backupsEnabled: true }, project);
  assert.equal(draft().backupCreated, true);
  const count = storage.listBackups(backups, prefsFile).length;
  harness.handlers.get("save-prefs")({}, { backupsEnabled: false }, project);
  assert.equal(storage.listBackups(backups, prefsFile).length, count);
  assert.equal(storage.scopedPreferences(storage.readJson(prefsFile), project).validated.key, true);
  assert.equal((await save()).backupCreated, false);
  assert.equal(draft().disabled, true);
  const before = storage.listBackups(backups, harness.languageFile).length;
  const rejected = await harness.handlers.get("save-lang")({}, { key: "Conflit" }, "ancienne révision", project);
  assert.equal(rejected.ok, false);
  assert.equal(storage.listBackups(backups, harness.languageFile).length, before);
});

test("IPC fermeture : Échap annule sans abandonner la traduction", async t => {
  const harness = mainHarness(t);
  const result = await harness.handlers.get("confirm-close")({ sender: {} }, 2);
  assert.equal(result, "cancel");
  assert.equal(harness.closeOptions().buttons[2], "Annuler");
});

test("l’éditeur conserve réellement la saisie et le compteur après le retour IPC", async () => {
  const { mergeSavedEdits } = await import("./src/editor-state.mjs");
  const source = fs.readFileSync(path.join(__dirname, "src/app.js"), "utf8");
  const saveFunction = source.slice(source.indexOf("function save("), source.indexOf("async function saveAndGotoNext("));
  const context = vm.createContext({ mergeSavedEdits, console });
  const result = await vm.runInContext(`
    let importing=false, setupDone=false, runedeltaBusy=false, dirty=true, savePromise=null;
    let lang={date:'0',line:'Version A'}, languageRevision='before', reference={};
    let entries=[{key:'line',fr:'Version A'}], savedTranslations=new Map(), unsavedKeys=new Set(['line']);
    let selectedKey='line', appConfig={}, runedeltaAttributions={}, complete;
    const window={api:{saveLang:()=>new Promise(resolve=>complete=resolve)}};
    const $=()=>({});
    function computeTodo(){return false}; function buildSearchable(e){return e.fr};
    function setDirty(value){dirty=value}; function setSaveButtonLoading(){};
    function updateProgress(){}; function renderList(){}; function refreshHighlight(){}; function schedulePreview(){};
    function alert(message){throw new Error(message)};
    ${saveFunction}
    const pending=save();
    lang.line='Version B'; entries[0].fr='Version B';
    complete({ok:true,revision:'after',savedAt:new Date().toISOString()});
    pending.then(()=>({value:lang.line,entry:entries[0].fr,dirty,count:unsavedKeys.size,saved:savedTranslations.get('line'),revision:languageRevision}));
  `, context);
  assert.equal(result.value, "Version B");
  assert.equal(result.entry, "Version B");
  assert.equal(result.dirty, true);
  assert.equal(result.count, 1);
  assert.equal(result.saved, "Version A");
  assert.equal(result.revision, "after");
});

test("le lanceur non interactif ferme stdin et transmet les résultats sans bloquer", { timeout: 5000 }, async () => {
  const { runTool } = await import("./extraction/process-runner.mjs");
  const result = await runTool(process.execPath, ["-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('DT_TEST_COMPLETED')); "]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /DT_TEST_COMPLETED/);
});

test("l’import coordonné se termine même si le parent garde son entrée ouverte", { timeout: 8000 }, async t => {
  const { spawn } = require("node:child_process");
  const source = fs.readFileSync(path.join(__dirname, "extraction/import-datawin.mjs"), "utf8");
  const handshake = source.slice(source.indexOf("const beforeInstall ="), source.indexOf("const languageConfig ="));
  assert.ok(handshake.includes("IMPORT_INSTALLING"));
  const file = path.join(workspace(t), "import-coordonne.mjs");
  fs.writeFileSync(file, `const log = console.log;\n${handshake}\nawait beforeInstall();\nconsole.log('IMPORT_DONE {}');\n`);
  const child = spawn(process.execPath, [file, "--coordinated-install"], { windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = "", sent = false, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 4000);
  t.after(() => clearTimeout(timer));
  child.stdout.on("data", chunk => {
    output += chunk.toString();
    if (!sent && output.includes("IMPORT_INSTALLING\n")) {
      sent = true;
      child.stdin.write("INSTALL\n");
    }
  });
  let errors = "";
  child.stderr.on("data", chunk => { errors += chunk.toString(); });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.match(output, /IMPORT_DONE \{\}/);
  assert.equal(timedOut, false, "L’import a annoncé sa réussite mais son processus reste ouvert.");
  assert.equal(code, 0, errors);
});

test('IPC Runedelta : sauvegarde le vrai JSON Git, copie facultative et protection contre un ancien onglet', async t => {
  const harness = mainHarness(t);
  const { execFileSync } = require('node:child_process');
  const directory = path.join(harness.root, 'clone');
  const file = path.join(directory, 'strings', 'strings_chapitre_5.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ date: '0', key: 'Catalogue Git' }));
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory });
  const config = { ...harness.config, langFrPath: file, dataWinPath: path.join(harness.root, 'chapter5_windows', 'data.win'),
    storageMode: 'runedelta-json', runedelta: { directory, branch: 'main', storage: 'git' } };
  fs.writeFileSync(path.join(harness.root, 'config.json'), JSON.stringify(config));
  const game = path.join(harness.root, 'chapter5_windows', 'lang', 'lang_fr.json');
  const save = expectedPath => harness.handlers.get('save-lang')({}, { date: '0', key: 'Sauvegarde Git' }, storage.revision(file), storage.projectId(config), expectedPath);
  const rejected = await save('ancien-clone/strings/strings_chapitre_5.json');
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /branche a changé/);
  assert.equal(JSON.parse(fs.readFileSync(file)).key, 'Catalogue Git');
  const saved = await save(file);
  assert.equal(saved.ok, true);
  assert.equal(saved.backupCreated, true);
  assert.equal(JSON.parse(fs.readFileSync(file)).key, 'Sauvegarde Git');
  assert.equal(fs.existsSync(game), false);
  config.runedelta.copyToGame = true;
  fs.writeFileSync(path.join(harness.root, 'config.json'), JSON.stringify(config));
  const copied = await save(file);
  assert.equal(copied.ok, true);
  assert.equal(copied.gameCopyPath, game);
  assert.equal(JSON.parse(fs.readFileSync(game)).key, 'Sauvegarde Git');
});
