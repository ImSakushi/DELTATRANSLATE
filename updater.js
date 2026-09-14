const CHECK_DELAY_MS = 1500;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
  restoreCloseProtection = () => {},
  autoUpdater: providedAutoUpdater,
  checkDelayMs = CHECK_DELAY_MS,
  checkIntervalMs = CHECK_INTERVAL_MS,
  platform = process.platform,
  portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
}) {
  const autoUpdater = providedAutoUpdater ?? require("electron-updater").autoUpdater;
  let started = false;
  let downloadRequested = false;
  let downloadErrorShown = false;
  let downloaded = false;
  let installing = false;
  let checking = false;
  let downloading = false;
  let dialogOpen = false;
  let availableInfo = null;
  const offeredVersions = new Set();
  let state = {
    enabled: app.isPackaged,
    phase: "idle",
    currentVersion: app.getVersion(),
    version: null,
    percent: null,
    downloaded: false,
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
    if (dialogOpen || downloading || downloaded || installing) return;
    dialogOpen = true;
    try {
      const notes = releaseNotesText(info.releaseNotes);
      const result = await showMessageBox(mainWindow(), {
        type: "info",
        title: "Mise à jour disponible",
        message: `DELTATRANSLATE ${info.version} est disponible.`,
        detail:
          `Version installée : ${app.getVersion()}\n\n` +
          (notes ? `${notes}\n\n` : "") +
          "La version adaptée à ce système sera téléchargée depuis la release GitHub. " +
          "Vous choisirez ensuite quand installer et redémarrer." +
          (platform === "win32" && portable
            ? "\nLa mise à jour installera DELTATRANSLATE pour votre compte. Utilisez ensuite le raccourci créé ; votre ancien fichier portable restera sur le disque."
            : ""),
        buttons: ["Télécharger et mettre à jour", "Plus tard"],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response !== 0) return;
      downloading = true;
      downloadRequested = true;
      downloadErrorShown = false;
      setState({ phase: "downloading", version: info.version, percent: 0, error: null });
      dialogOpen = false;
      await autoUpdater.downloadUpdate();
    } catch (error) {
      handleError(error);
    } finally {
      downloading = false;
      dialogOpen = false;
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
    const installationFailed = installing;
    if (installing) {
      installing = false;
      restoreCloseProtection();
    }
    setState({ phase: "error", percent: null, error: message });
    if (!downloadRequested || downloadErrorShown) return;
    downloadErrorShown = true;
    void showMessageBox(mainWindow(), {
      type: "error",
      title: "Mise à jour impossible",
      message: installationFailed
        ? "La mise à jour n’a pas pu être installée."
        : "La mise à jour n’a pas pu être téléchargée.",
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
    autoUpdater.allowDowngrade = false;

    autoUpdater.on("checking-for-update", () => {
      setState({ phase: "checking", percent: null, error: null });
    });
    autoUpdater.on("update-not-available", () => {
      availableInfo = null;
      setState({ phase: "idle", version: null, percent: null, error: null });
    });
    autoUpdater.on("update-available", (info) => {
      availableInfo = info;
      setState({ phase: "available", version: info.version, percent: null, error: null });
      if (!offeredVersions.has(info.version)) {
        offeredVersions.add(info.version);
        void offerDownload(info).catch(handleError);
      }
    });
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent ?? 0)));
      setProgress(percent / 100);
      setState({ phase: "downloading", percent });
    });
    autoUpdater.on("update-downloaded", (info) => {
      if (!downloadRequested) return;
      downloaded = true;
      setProgress(-1);
      setState({ phase: "downloaded", downloaded: true, version: info.version, percent: 100, error: null });
      void offerInstall(info).catch(handleError);
    });
    autoUpdater.on("error", handleError);
  }

  async function check(manual = false) {
    if (!started || checking || downloading || downloaded || installing || dialogOpen) return { ok: true };
    checking = true;
    downloadRequested = false;
    setState({ phase: "checking", percent: null, error: null });
    try {
      await autoUpdater.checkForUpdates();
      if (manual && state.phase === "idle") {
        await showMessageBox(mainWindow(), {
          type: "info", title: "Mises à jour",
          message: `DELTATRANSLATE ${app.getVersion()} est à jour.`,
          buttons: ["OK"], cancelId: 0,
        });
      }
      return { ok: true };
    } catch (error) {
      handleError(error);
      return { ok: false, error: error.message ?? String(error) };
    } finally {
      checking = false;
    }
  }

  async function download() {
    if (!started || checking || !availableInfo) return { ok: false, error: "Vérifiez d’abord les mises à jour." };
    try {
      await offerDownload(availableInfo);
      return { ok: true };
    } catch (error) {
      handleError(error);
      return { ok: false, error: error.message ?? String(error) };
    }
  }

  function start(win) {
    if (started || !app.isPackaged) return;
    started = true;
    configure();
    win.webContents.once("did-finish-load", () => {
      const delay = setTimeout(() => void check(), checkDelayMs);
      delay.unref?.();
      const interval = setInterval(() => void check(), checkIntervalMs);
      interval.unref?.();
      app.once?.("before-quit", () => {
        clearTimeout(delay);
        clearInterval(interval);
      });
    });
  }

  function install() {
    if (installing) return { ok: true };
    if (!downloaded) {
      return { ok: false, error: "Aucune mise à jour téléchargée n’est prête." };
    }
    installing = true;
    downloadErrorShown = false;
    setState({ phase: "installing" });
    allowWindowsToClose();
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(platform === "win32", true);
      } catch (error) {
        handleError(error);
      }
    });
    return { ok: true };
  }

  return {
    getState: () => ({ ...state }),
    check,
    download,
    install,
    start,
  };
}

module.exports = { createUpdaterController, releaseNotesText };
