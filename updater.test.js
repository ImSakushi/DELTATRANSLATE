const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createUpdaterController, releaseNotesText } = require("./updater.js");

function waitForEvents() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("releaseNotesText nettoie les notes HTML et les listes de notes", () => {
  assert.equal(releaseNotesText("<h2>Nouveau</h2><p>Correction</p>"), "Nouveau\nCorrection");
  assert.equal(releaseNotesText([{ note: "A" }, { note: "B" }]), "A\nB");
});

test("la fenêtre conserve les nouveautés sans la section de téléchargement HTML ou Markdown", () => {
  const markdown = "**Nouveautés**\n\n- Correction des sprites.\n- [Édition](https://example.com) améliorée.\n\n## Télécharger\n\n| Plateforme | Standard |\n| --- | --- |\n| Windows | Télécharger |\n\nInstructions d’installation.";
  const html = '<p><strong>Nouveautés</strong></p>\n<ul>\n<li>Correction des sprites.</li>\n<li><a href="https://example.com">Édition</a> améliorée.</li>\n</ul>\n<h2 id="télécharger">Télécharger</h2>\n<table><tr><td>Windows</td></tr></table>\n<p>Instructions d’installation.</p>';
  for (const notes of [markdown, html]) {
    assert.equal(releaseNotesText(notes), "Nouveautés\n• Correction des sprites.\n• Édition améliorée.");
  }
  assert.equal(releaseNotesText("<p>Une correction.</p><table><tr><td>Windows</td></tr></table>"), "Une correction.");
  assert.equal(releaseNotesText("<p>L&#8217;édition &amp; les polices&nbsp;: &#xE9;.</p>"), "L’édition & les polices : é.");
});

test("les notes restent compactes même sans section de téléchargement", () => {
  assert.equal(releaseNotesText(null), "");
  assert.equal(releaseNotesText("A".repeat(1000)), "A".repeat(699) + "…");
  const summary = releaseNotesText(Array.from({ length: 30 }, (_, i) => `- Correction ${i}`).join("\n\n"));
  assert.equal(summary.split("\n").length, 8);
  assert.ok(summary.endsWith("…"));
});

test("la notification utilise le résumé sans modifier les notes de la release", async t => {
  const fs = require("node:fs");
  const path = require("node:path");
  const notes = fs.readFileSync(path.join(__dirname, "release-notes.md"), "utf8");
  const f = updaterFixture(t);
  const info = { version: "1.2.1", releaseNotes: notes };
  f.updater.emit("update-available", info);
  await waitForEvents();
  const detail = f.prompts[0].detail;
  assert.match(detail, /sprites/);
  assert.doesNotMatch(detail, /Windows Setup|macOS DMG|Plateforme|https:\/\/|##|\*\*/);
  assert.ok(detail.length < 1000);
  assert.equal(info.releaseNotes, notes);
  assert.equal(f.calls.downloads, 0);
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
    platform: "win32",
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
    platform: "win32",
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
  const windows = [win];
  let response = 1;
  updater.checkForUpdates = async () => {
    calls.checks++;
    updater.emit("update-available", { version: "1.1.1" });
  };
  updater.downloadUpdate = async () => { calls.downloads++; };
  updater.quitAndInstall = () => { calls.installs++; };
  const controller = createUpdaterController({
    app, BrowserWindow: { getAllWindows: () => windows },
    dialog: { showMessageBox: async (_win, prompt) => { prompts.push(prompt); return { response }; } },
    allowWindowsToClose() {},
    restoreCloseProtection() { calls.restored++; },
    autoUpdater: updater,
    platform: "win32",
    checkDelayMs: 100_000,
    ...options,
  });
  controller.start(win);
  webContents.emit("did-finish-load");
  t.after(() => app.emit("before-quit"));
  return { controller, updater, calls, prompts, sent, win, windows, app, setResponse(value) { response = value; } };
}

test("chaque démarrage signale une nouvelle version, même après Plus tard à la session précédente", async t => {
  for (let session = 0; session < 2; session++) {
    const f = updaterFixture(t, { checkDelayMs: 0 });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.calls.checks, 1);
    assert.equal(f.prompts[0].title, "Mise à jour disponible");
    assert.equal(f.controller.getState().phase, "available");
    assert.equal(f.calls.downloads, 0);
  }
});

test("rouvrir une fenêtre déjà chargée relance la vérification sans doubler les écouteurs", async t => {
  const f = updaterFixture(t, { checkDelayMs: 0 });
  await new Promise(resolve => setTimeout(resolve, 20));
  f.win.isDestroyed = () => true;
  const webContents = Object.assign(new EventEmitter(), {
    getURL: () => "file:///app/index.html", isLoadingMainFrame: () => false, send() {},
  });
  const next = { isDestroyed: () => false, webContents, setProgressBar() {} };
  f.windows.push(next);
  f.controller.start(next);
  f.controller.start(next);
  webContents.emit("did-finish-load");
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.calls.checks, 2);
  assert.equal(f.prompts.length, 2);
  assert.equal(f.updater.listenerCount("update-available"), 1);
});

test("les éditions utilisent leurs propres canaux sans autoriser les rétrogradations", t => {
  for (const bundledGit of [false, true]) {
    const f = updaterFixture(t, { bundledGit });
    assert.equal(f.updater.channel, bundledGit ? "bundled" : "latest");
    assert.equal(f.updater.allowDowngrade, false);
  }
});

test("les formats sans installation automatique signalent les nouveautés et ouvrent la release", async t => {
  for (const platform of ["darwin", "linux"]) {
    const opened = [];
    const f = updaterFixture(t, { platform, manualUpdates: true,
      fetchRelease: async () => ({ version: "1.3.0", manual: true }),
      openExternal: async url => opened.push(url),
    });
    f.setResponse(0);
    await f.controller.check();
    await waitForEvents();
    assert.equal(f.controller.getState().phase, "available");
    assert.equal(f.prompts[0].buttons[0], "Ouvrir les téléchargements");
    assert.deepEqual(opened, ["https://github.com/ImSakushi/DELTATRANSLATE/releases/latest"]);
    assert.equal(f.calls.downloads, 0);
    assert.equal(f.calls.checks, 0);
  }
});

test("un updater natif désactivé ne bloque pas la détection ni le signalement au démarrage", async t => {
  const f = updaterFixture(t, { checkDelayMs: 0,
    fetchRelease: async () => ({ version: "1.3.0", manual: true }),
  });
  f.updater.checkForUpdates = async () => null;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.controller.getState().phase, "available");
  assert.equal(f.prompts[0].title, "Mise à jour disponible");
  assert.equal(f.calls.downloads, 0);
});

test("la vérification GitHub écarte les versions identiques, anciennes, privées et préversions", async () => {
  const { checkRelease, newerVersion } = require("./release-check.js");
  assert.equal(newerVersion("v1.10.0", "1.2.0"), true);
  for (const release of [{ tag_name: "v1.2.0" }, { tag_name: "v1.1.9" },
    { tag_name: "v1.3.0-beta" }, { tag_name: "v1.3.0", draft: true }, { tag_name: "v1.3.0", prerelease: true }]) {
    assert.equal(await checkRelease("1.2.0", async () => ({ ok: true, json: async () => release })), null);
  }
  const available = await checkRelease("1.2.0", async () => ({ ok: true, json: async () => ({ tag_name: "v1.3.0", body: "Corrections" }) }));
  assert.equal(available.version, "1.3.0");
  await assert.rejects(checkRelease("1.2.0", async () => ({ ok: false, status: 503 })), /503/);
});

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
