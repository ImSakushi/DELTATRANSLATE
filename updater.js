const CHECK_DELAY_MS = 1500;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const { checkRelease, RELEASE_URL } = require("./release-check.js");

function releaseNotesText(releaseNotes) {
  const notes = Array.isArray(releaseNotes)
    ? releaseNotes.map((entry) => entry?.note ?? "").join("\n")
    : String(releaseNotes ?? "");
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const text = notes
    .replace(/\r/g, "")
    .replace(/<table\b[\s\S]*$/i, "")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/?(?:h[1-6]|p|div|ul|ol)\b[^>]*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
      if (!code.startsWith("#")) return entities[code.toLowerCase()];
      const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map(line => line.trim());
  const end = text.findIndex(line => /^(?:Télécharger|Téléchargements?|Downloads?)\b/i.test(line) || /^\|.*\|$/.test(line));
  const lines = (end < 0 ? text : text.slice(0, end)).filter(Boolean);
  const summary = lines.slice(0, 8).join("\n");
  if (summary.length > 700) return summary.slice(0, 699).trimEnd() + "…";
  return summary + (lines.length > 8 ? "…" : "");
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
  bundledGit = require("./package.json").bundledGit === true,
  manualUpdates = platform === "darwin",
  fetchRelease = checkRelease,
  openExternal = url => require("electron").shell.openExternal(url),
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
  const watchedWindows = new WeakSet();
  const delays = new Set();
  let interval = null;
  let state = {
    enabled: app.isPackaged,
    phase: "idle",
    currentVersion: app.getVersion(),
    version: null,
    percent: null,
    downloaded: false,
    bundledGit,
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
          (info.manual
            ? "La page de téléchargement va s’ouvrir dans votre navigateur. Choisissez votre édition et remplacez l’application après avoir sauvegardé votre travail."
            : "La version adaptée à ce système sera téléchargée depuis la release GitHub. Vous choisirez ensuite quand installer et redémarrer.") +
          (!info.manual && platform === "win32" && portable
            ? "\nLa mise à jour installera DELTATRANSLATE pour votre compte. Utilisez ensuite le raccourci créé ; votre ancien fichier portable restera sur le disque."
            : ""),
        buttons: [info.manual ? "Ouvrir les téléchargements" : "Télécharger et mettre à jour", "Plus tard"],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response !== 0) return;
      if (info.manual) {
        await openExternal(RELEASE_URL);
        return;
      }
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
    autoUpdater.channel = bundledGit ? "bundled" : "latest";
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
    autoUpdater.on("update-available", announce);
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

  function announce(info) {
    availableInfo = info;
    setState({ phase: "available", version: info.version, percent: null, error: null, manual: Boolean(info.manual) });
    if (mainWindow() && !offeredVersions.has(info.version)) {
      offeredVersions.add(info.version);
      void offerDownload(info).catch(handleError);
    }
  }

  async function check(manual = false) {
    if (!started || checking || downloading || downloaded || installing || dialogOpen) return { ok: true };
    checking = true;
    downloadRequested = false;
    setState({ phase: "checking", percent: null, error: null });
    try {
      const nativeResult = manualUpdates ? null : await autoUpdater.checkForUpdates();
      if (nativeResult === null) {
        const info = await fetchRelease(app.getVersion());
        if (info) announce(info);
        else {
          availableInfo = null;
          setState({ phase: "idle", version: null, percent: null, error: null });
        }
      }
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
    if (!app.isPackaged || watchedWindows.has(win)) return;
    watchedWindows.add(win);
    if (!started) {
      started = true;
      configure();
      app.once?.("before-quit", () => {
        for (const timer of delays) clearTimeout(timer);
        clearInterval(interval);
      });
    }
    let scheduled = false;
    const loaded = () => {
      if (scheduled || win.isDestroyed()) return;
      scheduled = true;
      setState({});
      const delay = setTimeout(() => {
        delays.delete(delay);
        if (win.isDestroyed()) return;
        offeredVersions.clear();
        void check();
      }, checkDelayMs);
      delays.add(delay);
      delay.unref?.();
      if (!interval) {
        interval = setInterval(() => void check(), checkIntervalMs);
        interval.unref?.();
      }
    };
    win.webContents.once("did-finish-load", loaded);
    if (win.webContents.getURL?.() && !win.webContents.isLoadingMainFrame?.()) loaded();
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
