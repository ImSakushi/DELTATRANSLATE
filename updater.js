const CHECK_DELAY_MS = 1500;

function releaseNotesText(releaseNotes) {
  const notes = Array.isArray(releaseNotes)
    ? releaseNotes.map((entry) => entry?.note ?? "").join("\n")
    : String(releaseNotes ?? "");
  return notes
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1200);
}

function createUpdaterController({
  app,
  BrowserWindow,
  dialog,
  allowWindowsToClose,
  autoUpdater: providedAutoUpdater,
  checkDelayMs = CHECK_DELAY_MS,
}) {
  const autoUpdater = providedAutoUpdater ?? require("electron-updater").autoUpdater;
  let started = false;
  let downloadRequested = false;
  let downloadErrorShown = false;
  let downloaded = false;
  let installing = false;
  let state = {
    phase: "idle",
    currentVersion: app.getVersion(),
    version: null,
    percent: null,
  };

  function windows() {
    return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  }

  function mainWindow() {
    return windows()[0] ?? null;
  }

  function setState(patch) {
    state = { ...state, ...patch };
    for (const win of windows()) win.webContents.send("update-status", state);
  }

  function setProgress(value) {
    for (const win of windows()) win.setProgressBar(value);
  }

  async function showMessageBox(win, options) {
    if (!win || win.isDestroyed()) return { response: options.cancelId ?? 0 };
    return dialog.showMessageBox(win, { noLink: true, ...options });
  }

  async function offerDownload(info) {
    const notes = releaseNotesText(info.releaseNotes);
    const result = await showMessageBox(mainWindow(), {
      type: "info",
      title: "Mise à jour disponible",
      message: `DELTATRANSLATE ${info.version} est disponible.`,
      detail:
        `Version installée : ${app.getVersion()}\n\n` +
        (notes ? `${notes}\n\n` : "") +
        "La version adaptée à ce système sera téléchargée depuis la release GitHub.",
      buttons: ["Télécharger et mettre à jour", "Plus tard"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response !== 0) return;

    downloadRequested = true;
    downloadErrorShown = false;
    setState({ phase: "downloading", version: info.version, percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      handleError(error);
    }
  }

  async function offerInstall(info) {
    const result = await showMessageBox(mainWindow(), {
      type: "info",
      title: "Mise à jour prête",
      message: `DELTATRANSLATE ${info.version} a été téléchargé.`,
      detail:
        "L’application va sauvegarder les traductions en cours, installer la mise à jour puis redémarrer.",
      buttons: ["Installer et redémarrer", "Plus tard"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      mainWindow()?.webContents.send("update-install-requested", info.version);
    }
  }

  function handleError(error) {
    const message = error?.message ?? String(error);
    console.error(`[update] ${message}`);
    setProgress(-1);
    setState({ phase: "error", percent: null, error: message });
    if (!downloadRequested || downloadErrorShown) return;
    downloadErrorShown = true;
    void showMessageBox(mainWindow(), {
      type: "error",
      title: "Mise à jour impossible",
      message: "La mise à jour n’a pas pu être téléchargée.",
      detail: `${message}\n\nDELTATRANSLATE continuera de fonctionner normalement.`,
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
    });
  }

  function configure() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on("checking-for-update", () => {
      setState({ phase: "checking", percent: null, error: null });
    });
    autoUpdater.on("update-not-available", () => {
      setState({ phase: "idle", version: null, percent: null, error: null });
    });
    autoUpdater.on("update-available", (info) => {
      setState({ phase: "available", version: info.version, percent: null, error: null });
      void offerDownload(info);
    });
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent ?? 0)));
      setProgress(percent / 100);
      setState({ phase: "downloading", percent });
    });
    autoUpdater.on("update-downloaded", (info) => {
      downloaded = true;
      setProgress(-1);
      setState({ phase: "downloaded", version: info.version, percent: 100, error: null });
      void offerInstall(info);
    });
    autoUpdater.on("error", handleError);
  }

  function start(win) {
    if (started || !app.isPackaged) return;
    started = true;
    configure();
    win.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(handleError);
      }, checkDelayMs);
    });
  }

  function install() {
    if (installing) return { ok: true };
    if (!downloaded) {
      return { ok: false, error: "Aucune mise à jour téléchargée n’est prête." };
    }
    installing = true;
    setState({ phase: "installing" });
    allowWindowsToClose();
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(process.platform === "win32", true);
      } catch (error) {
        installing = false;
        handleError(error);
      }
    });
    return { ok: true };
  }

  return {
    getState: () => ({ ...state }),
    install,
    start,
  };
}

module.exports = { createUpdaterController, releaseNotesText };
