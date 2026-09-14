const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createUpdaterController, releaseNotesText } = require("./updater.js");

function waitForEvents() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("releaseNotesText nettoie les notes HTML et les listes de notes", () => {
  assert.equal(releaseNotesText("<h2>Nouveau</h2><p>Correction</p>"), "Nouveau Correction");
  assert.equal(releaseNotesText([{ note: "A" }, { note: "B" }]), "A\nB");
});

test("le contrôleur télécharge puis installe la release choisie", async () => {
  const sent = [];
  const progress = [];
  const webContents = new EventEmitter();
  webContents.send = (...args) => sent.push(args);
  const win = {
    isDestroyed: () => false,
    setProgressBar: (value) => progress.push(value),
    webContents,
  };

  const fakeUpdater = new EventEmitter();
  let checks = 0;
  let downloads = 0;
  let installs = 0;
  fakeUpdater.checkForUpdates = async () => {
    checks += 1;
  };
  fakeUpdater.downloadUpdate = async () => {
    downloads += 1;
  };
  fakeUpdater.quitAndInstall = () => {
    installs += 1;
  };

  let allowCloseCalls = 0;
  const controller = createUpdaterController({
    app: { getVersion: () => "1.0.0", isPackaged: true },
    BrowserWindow: { getAllWindows: () => [win] },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    allowWindowsToClose: () => {
      allowCloseCalls += 1;
    },
    autoUpdater: fakeUpdater,
    checkDelayMs: 0,
  });

  controller.start(win);
  webContents.emit("did-finish-load");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(checks, 1);

  fakeUpdater.emit("update-available", { version: "1.1.0", releaseNotes: "Nouveau" });
  await waitForEvents();
  assert.equal(downloads, 1);
  assert.equal(controller.getState().phase, "downloading");

  fakeUpdater.emit("download-progress", { percent: 42.4 });
  assert.equal(controller.getState().percent, 42);
  assert.equal(progress.at(-1), 0.42);

  fakeUpdater.emit("update-downloaded", { version: "1.1.0" });
  await waitForEvents();
  assert.ok(sent.some(([channel]) => channel === "update-install-requested"));
  assert.deepEqual(controller.install(), { ok: true });
  await waitForEvents();
  assert.equal(allowCloseCalls, 1);
  assert.equal(installs, 1);
});

test("aucune vérification n’est lancée depuis le code source", () => {
  const fakeUpdater = new EventEmitter();
  let checks = 0;
  fakeUpdater.checkForUpdates = async () => {
    checks += 1;
  };
  const controller = createUpdaterController({
    app: { getVersion: () => "1.0.0", isPackaged: false },
    BrowserWindow: { getAllWindows: () => [] },
    dialog: {},
    allowWindowsToClose: () => {},
    autoUpdater: fakeUpdater,
    checkDelayMs: 0,
  });
  controller.start({ webContents: new EventEmitter() });
  assert.equal(checks, 0);
});

function updaterFixture(t, options = {}) {
  const updater = new EventEmitter();
  const app = Object.assign(new EventEmitter(), { getVersion: () => "1.0.0", isPackaged: true });
  const webContents = Object.assign(new EventEmitter(), { send: (...args) => sent.push(args) });
  const sent = [];
  const prompts = [];
  const calls = { checks: 0, downloads: 0, installs: 0, restored: 0 };
  const win = { isDestroyed: () => false, webContents, setProgressBar() {} };
  let response = 1;
  updater.checkForUpdates = async () => {
    calls.checks++;
    updater.emit("update-available", { version: "1.1.1" });
  };
  updater.downloadUpdate = async () => { calls.downloads++; };
  updater.quitAndInstall = () => { calls.installs++; };
  const controller = createUpdaterController({
    app, BrowserWindow: { getAllWindows: () => [win] },
    dialog: { showMessageBox: async (_win, prompt) => { prompts.push(prompt); return { response }; } },
    allowWindowsToClose() {},
    restoreCloseProtection() { calls.restored++; },
    autoUpdater: updater,
    checkDelayMs: 100_000,
    ...options,
  });
  controller.start(win);
  webContents.emit("did-finish-load");
  t.after(() => app.emit("before-quit"));
  return { controller, updater, calls, prompts, sent, setResponse(value) { response = value; } };
}

test("Plus tard ne télécharge rien et permet de reprendre sans relancer l’application", async (t) => {
  const f = updaterFixture(t);
  await f.controller.check();
  await waitForEvents();
  assert.equal(f.calls.downloads, 0);
  assert.equal(f.controller.getState().phase, "available");
  await f.controller.check();
  assert.equal(f.prompts.length, 1, "pas de rappel répétitif pour la même version");
  f.setResponse(0);
  await f.controller.download();
  assert.equal(f.calls.downloads, 1);
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowPrerelease, false);
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal(f.calls.installs, 0);
});

test("Plus tard après téléchargement ne lance aucune installation, même à la fermeture", async (t) => {
  const f = updaterFixture(t);
  await f.controller.check();
  await waitForEvents();
  f.setResponse(0);
  await f.controller.download();
  f.setResponse(1);
  f.updater.emit("update-downloaded", { version: "1.1.1" });
  await waitForEvents();
  assert.equal(f.controller.getState().downloaded, true);
  assert.equal(f.sent.some(([channel]) => channel === "update-install-requested"), false);
  await f.controller.check();
  assert.equal(f.calls.checks, 1, "préserve le téléchargement prêt");
  assert.equal(f.calls.installs, 0);
});

test("une erreur réseau au démarrage reste discrète et peut être réessayée", async (t) => {
  const f = updaterFixture(t);
  f.updater.checkForUpdates = async () => { throw new Error("Hors ligne"); };
  assert.equal((await f.controller.check()).ok, false);
  assert.equal(f.controller.getState().phase, "error");
  assert.equal(f.prompts.length, 0);
  f.updater.checkForUpdates = async () => f.updater.emit("update-not-available");
  assert.equal((await f.controller.check(true)).ok, true);
  assert.equal(f.controller.getState().phase, "idle");
  assert.match(f.prompts.at(-1).message, /est à jour/);
});

test("un téléchargement échoué se réessaie sans installer et sans doubler l’alerte", async (t) => {
  const f = updaterFixture(t);
  await f.controller.check();
  await waitForEvents();
  f.setResponse(0);
  f.updater.downloadUpdate = async () => {
    const error = new Error("Téléchargement interrompu");
    f.updater.emit("error", error);
    throw error;
  };
  await f.controller.download();
  assert.equal(f.prompts.filter((p) => p.type === "error").length, 1);
  assert.equal(f.controller.install().ok, false);
  f.updater.downloadUpdate = async () => {
    f.calls.downloads++;
    f.updater.emit("update-downloaded", { version: "1.1.1" });
  };
  await f.controller.download();
  assert.equal(f.controller.getState().downloaded, true);
  assert.equal(f.calls.downloads, 1);
  assert.equal(f.calls.installs, 0);
});

test("un échec d’installation restaure la protection de fermeture et autorise un nouvel essai", async (t) => {
  const f = updaterFixture(t);
  await f.controller.check();
  await waitForEvents();
  f.setResponse(0);
  await f.controller.download();
  f.setResponse(1);
  f.updater.emit("update-downloaded", { version: "1.1.1" });
  f.updater.quitAndInstall = () => f.updater.emit("error", new Error("Installateur indisponible"));
  f.controller.install();
  await waitForEvents();
  assert.equal(f.calls.restored, 1);
  assert.equal(f.controller.getState().phase, "error");
  f.updater.quitAndInstall = () => { f.calls.installs++; };
  f.controller.install();
  f.controller.install();
  await waitForEvents();
  assert.equal(f.calls.installs, 1);
});

test("la vérification périodique fonctionne sans lancement concurrent", async (t) => {
  const f = updaterFixture(t, { checkIntervalMs: 10 });
  let finish;
  const checked = new Promise((resolve) => { finish = resolve; });
  f.updater.checkForUpdates = async () => { f.calls.checks++; await checked; };
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(f.calls.checks, 1);
  finish();
});

test("le bouton vérifie ou télécharge avant de proposer une installation", async () => {
  const { runUpdateAction, updateAction } = await import("./src/update-flow.mjs");
  const calls = [];
  let status = { enabled: true, phase: "idle" };
  const api = {
    getUpdateStatus: async () => status,
    checkForUpdates: async () => calls.push("check"),
    downloadUpdate: async () => calls.push("download"),
  };
  const install = async () => calls.push("install");
  await runUpdateAction(api, install);
  status = { enabled: true, phase: "available", version: "1.1.1" };
  await runUpdateAction(api, install);
  status.phase = "downloading";
  await runUpdateAction(api, install);
  status = { ...status, phase: "downloaded", downloaded: true };
  await runUpdateAction(api, install);
  assert.deepEqual(calls, ["check", "download", "install"]);
  assert.equal(updateAction({ enabled: false, phase: "idle" }), "disabled");
  assert.equal(updateAction({ ...status, phase: "error" }), "install");
});

test("l’installation attend chaque sauvegarde et s’arrête au moindre échec", async () => {
  const { prepareUpdateInstall } = await import("./src/update-flow.mjs");
  for (const failure of ["preferences", "code", "language", null]) {
    const calls = [];
    const save = (kind) => async () => { calls.push(kind); return failure !== kind; };
    const result = await prepareUpdateInstall({
      isBusy: () => false, isDirty: () => false,
      savePreferences: save("preferences"), saveCode: save("code"), saveLanguage: save("language"),
      install: async () => { calls.push("install"); return { ok: true }; },
    });
    assert.equal(result.ok, failure === null);
    assert.equal(calls.includes("install"), failure === null);
    if (!failure) assert.deepEqual(calls, ["preferences", "code", "language", "install"]);
  }
});

test("une opération en cours ou de nouvelles modifications empêchent le redémarrage", async () => {
  const { prepareUpdateInstall } = await import("./src/update-flow.mjs");
  for (const busy of [true, false]) {
    const result = await prepareUpdateInstall({
      isBusy: () => busy, isDirty: () => true,
      savePreferences: async () => true, saveCode: async () => true, saveLanguage: async () => true,
      install: () => assert.fail("Installation interdite"),
    });
    assert.equal(result.ok, false);
  }
});
