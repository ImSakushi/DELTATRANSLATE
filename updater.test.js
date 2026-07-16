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
