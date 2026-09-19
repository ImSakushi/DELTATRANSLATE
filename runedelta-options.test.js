const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { isRunedeltaProjectConnected, projectBinding } = require("./runedelta-sync.js");
const { projectId } = require("./storage.js");
function connectedConfig() {
  const config = { dataWinPath: "/game/chapter5_windows/data.win", runedelta: { storage: "game", modeEnabled: true, enabled: true, remoteUrl: "remote" } };
  config.runedelta.projects = { [projectId(config)]: projectBinding(config, "remote") };
  return config;
}

function backend(initial) {
  const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  let config = structuredClone(initial);
  const calls = [];
  const handlers = new Map();
  const context = vm.createContext({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getConfig: () => config,
    updateConfig: patch => (config = { ...config, ...patch }),
    runedeltaSettings: () => { calls.push("settings"); return {}; },
    runedeltaStatus: async () => { calls.push("status"); return {}; },
    installRunedelta: async () => { throw new Error("Installation inattendue"); },
    synchronizeRunedelta: async options => { calls.push(options); return { ok: false, error: "Résultat simulé" }; },
    storage: { projectId: () => "project", assertRevision: () => {} },
    detectChapter: () => 5,
    isRunedeltaProjectConnected,
    serializeLanguage: JSON.stringify,
    runedeltaBackup: () => {},
    saveRunning: false, codeApplyRunning: false, importRunning: false,
  });
  vm.runInContext(
    source.slice(source.indexOf("function runedeltaEnabledForCurrentChapter"), source.indexOf("function formatRunedeltaConflict")) +
    source.slice(source.indexOf("async function syncConfiguredRunedelta"), source.indexOf("function getConfig")) +
    source.slice(source.indexOf('ipcMain.handle("get-runedelta-status"'), source.indexOf('ipcMain.handle("set-title-bar-theme"')),
    context,
  );
  return { call: (name, ...args) => handlers.get(name)({}, ...args), calls, config: () => config };
}

test("sans activation explicite, même un ancien projet connecté ne lance pas Git", async () => {
  for (const runedelta of [undefined, { enabled: true }, { enabled: true, modeEnabled: false, publishEnabled: true }]) {
    const app = backend({ runedelta });
    assert.equal((await app.call("get-runedelta-status")).enabled, false);
    assert.deepEqual(Object.keys((await app.call("get-runedelta-attributions")).attributions), []);
    assert.equal((await app.call("connect-runedelta")).ok, false);
    assert.equal((await app.call("sync-runedelta", {}, null, null, "project")).ok, false);
    app.call("open-runedelta");
    assert.deepEqual(app.calls, []);
  }
});

test("la publication nécessite les deux options, y compris via IPC", async () => {
  const app = backend(connectedConfig());
  const refused = await app.call("sync-runedelta", {}, null, null, "project");
  assert.match(refused.error, /publication GitHub est désactivée/);
  assert.deepEqual(app.calls, []);
  app.call("set-runedelta-options", { modeEnabled: true, publishEnabled: true });
  await app.call("sync-runedelta", {}, null, null, "project");
  assert.equal(app.calls[0], "settings");
  assert.equal(app.calls[1].push, true);
});

test("désactiver le mode conserve le projet et retire l’autorisation de publier", () => {
  const initial = {
    langFrPath: "chapitre/lang/lang_fr.json",
    runedelta: { modeEnabled: true, publishEnabled: true, enabled: true, directory: "depot", remoteUrl: "remote", installedChapters: { 5: true } },
  };
  const app = backend(initial);
  app.call("set-runedelta-options", { modeEnabled: false, publishEnabled: true });
  assert.equal(app.config().langFrPath, initial.langFrPath);
  assert.equal(app.config().runedelta.directory, "depot");
  assert.equal(app.config().runedelta.remoteUrl, "remote");
  assert.deepEqual(app.config().runedelta.installedChapters, { 5: true });
  assert.equal(app.config().runedelta.enabled, true);
  assert.equal(app.config().runedelta.publishEnabled, false);
  app.call("set-runedelta-options", { modeEnabled: true });
  assert.equal(app.config().runedelta.publishEnabled, false);
  assert.deepEqual(app.calls, []);
});

test("l’interface masque les outils désactivés sans demander le statut Git", async () => {
  const source = fs.readFileSync(path.join(__dirname, "src/app.js"), "utf8");
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { dataset: {}, setAttribute() {}, classList: {
        toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
        contains: name => classes.has(name),
      } });
    }
    return nodes.get(id);
  };
  const context = vm.createContext({
    $: node,
    appConfig: { dataWinPath: "data.win", runedelta: { enabled: true } },
    runedeltaBusy: false,
    window: { api: { getRunedeltaStatus: () => { throw new Error("Git ne doit pas être interrogé"); } } },
  });
  vm.runInContext(source.slice(source.indexOf("function renderRunedeltaStatus"), source.indexOf("async function connectRunedelta")), context);
  await vm.runInContext("refreshRunedeltaStatus()", context);
  assert.equal(node("btn-runedelta").classList.contains("hidden"), true);
  assert.equal(node("runedelta-status").textContent, "Mode local — Runedelta est désactivé.");
  for (const publishEnabled of [false, true]) {
    context.appConfig.runedelta = { modeEnabled: true, enabled: true, publishEnabled, remoteUrl: "https://github.com/Traducteurs-Aurifiques/Runedelta.git" };
    vm.runInContext("renderRunedeltaStatus({ available: true, enabled: true })", context);
    assert.equal(node("btn-runedelta").classList.contains("hidden"), false);
    for (const id of ["btn-publish", "btn-publish-runedelta"]) {
      assert.equal(node(id).classList.contains("hidden"), !publishEnabled);
      assert.equal(node(id).disabled, !publishEnabled);
    }
  }
  for (const remoteUrl of [undefined, "", "C:/depot", "https://gitlab.com/equipe/projet.git"]) {
    context.appConfig.runedelta = { modeEnabled: true, enabled: true, publishEnabled: true, remoteUrl };
    vm.runInContext("renderRunedeltaStatus({ available: true, enabled: true })", context);
    for (const id of ["btn-publish", "btn-publish-runedelta"]) {
      assert.equal(node(id).classList.contains("hidden"), true);
      assert.equal(node(id).disabled, true);
    }
  }
});


test("la récupération est autorisée sans publication, mais reste liée au projet actif", async () => {
  const app = backend(connectedConfig());
  await app.call("receive-runedelta", {}, null, null, "project");
  assert.equal(app.calls[1].push, false);
  assert.equal(app.calls[1].receiveOnly, true);
  const wrong = await app.call("receive-runedelta", {}, null, null, "autre");
  assert.match(wrong.error, /chapitre actif a changé/);
  const legacy = backend({ dataWinPath: "/game/chapter5_windows/data.win", runedelta: { modeEnabled: true, enabled: true, publishEnabled: true, installedChapters: { 5: true } } });
  assert.match((await legacy.call("receive-runedelta", {}, null, null, "project")).error, /pas installé/);
});

test("annuler un conflit réactive les actions, y compris en récupération seule", async () => {
  const source = fs.readFileSync(path.join(__dirname, "src/app.js"), "utf8");
  for (const receiveOnly of [true, false]) {
    const states = [];
    let calls = 0;
    const context = vm.createContext({
      appConfig: { runedelta: { modeEnabled: true, publishEnabled: !receiveOnly } },
      runedeltaBusy: false, savePromise: null, importing: false, codeApplyRunning: false,
      dirty: false, lang: {}, languageRevision: "rev",
      window: { api: {
        syncRunedelta: async () => { assert.equal(receiveOnly, false); calls++; return { ok: false, conflict: true }; },
        receiveRunedelta: async () => { assert.equal(receiveOnly, true); calls++; return { ok: false, conflict: true }; },
      } },
      renderRunedeltaStatus: () => {}, resolveConflicts: async () => null,
      refreshRunedeltaStatus: async () => states.push(context.runedeltaBusy),
    });
    vm.runInContext(source.slice(source.indexOf("async function publishRunedeltaNow"), source.indexOf("async function configureRunedeltaGithub")), context);
    await vm.runInContext(`publishRunedeltaNow(${receiveOnly})`, context);
    assert.equal(calls, 1);
    assert.equal(context.runedeltaBusy, false);
    assert.deepEqual(states, [false]);
  }
});

test("le backup Runedelta utilise l’historique même si les backups courants sont désactivés", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const calls = [];
  const context = vm.createContext({ backupsEnabled: () => false, backupFile: (...args) => { calls.push(args); return "copie"; } });
  vm.runInContext(source.slice(source.indexOf("function runedeltaBackup"), source.indexOf("function runedeltaEnabledForCurrentChapter")), context);
  assert.equal(vm.runInContext('runedeltaBackup("catalogue.json", "nouveau contenu")', context), "copie");
  assert.deepEqual(calls, [["catalogue.json", "nouveau contenu"]]);
});
