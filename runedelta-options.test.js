const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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
  const app = backend({ runedelta: { modeEnabled: true, enabled: true } });
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
    context.appConfig.runedelta = { modeEnabled: true, enabled: true, publishEnabled };
    vm.runInContext("renderRunedeltaStatus({ available: true, enabled: true })", context);
    assert.equal(node("btn-runedelta").classList.contains("hidden"), false);
    for (const id of ["btn-publish", "btn-publish-runedelta"]) {
      assert.equal(node(id).classList.contains("hidden"), !publishEnabled);
      assert.equal(node(id).disabled, !publishEnabled);
    }
  }
});
