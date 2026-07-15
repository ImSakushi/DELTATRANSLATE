const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { findUtmtCli, installLatestUtmt } = require("./utmt-manager.js");

const ROOT = __dirname;
const APP_ICON_PATH = path.join(ROOT, "src", "assets", "deltatranslate-icon.png");
const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const windowsAllowedToClose = new WeakSet();
const TITLE_BAR_HEIGHT = 32;
const TITLE_BAR_THEMES = {
  deltarune: { color: "#000000", symbolColor: "#ffffff", height: TITLE_BAR_HEIGHT },
  classic: { color: "#121219", symbolColor: "#e8e8f0", height: TITLE_BAR_HEIGHT },
};
const DEFAULT_CONFIG = {
  langFrPath: null,
  extractedDir: null,
  dataWinPath: null,
  sourceDataWinPath: null,
  storageMode: null,
  utmtDir: null,
};

app.setName("DELTATRANSLATE");

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Les anciennes installations stockaient ces fichiers à côté du code. On les
// conserve sur place s'ils existent afin de ne jamais perdre le travail de
// l'utilisateur ; les nouvelles installations utilisent userData.
function runtimeFile(name) {
  const legacy = path.join(ROOT, name);
  if (fs.existsSync(legacy)) return legacy;
  const directory = app.getPath("userData");
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}

function runtimeDirectory(name) {
  const legacy = path.join(ROOT, name);
  if (fs.existsSync(legacy)) return legacy;
  const directory = path.join(app.getPath("userData"), name);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function configPath() {
  return runtimeFile("config.json");
}

function prefsPath() {
  return runtimeFile("prefs.json");
}

function getConfig() {
  return Object.assign({}, DEFAULT_CONFIG, loadJson(configPath(), {}));
}

function saveConfig(config) {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
  return config;
}

function updateConfig(patch) {
  return saveConfig(Object.assign(getConfig(), patch));
}

function isUsableExtraction(directory) {
  return Boolean(
    directory &&
      fs.existsSync(path.join(directory, "reference.json")) &&
      fs.existsSync(path.join(directory, "CodeEntries")) &&
      fs.existsSync(path.join(directory, "fonts"))
  );
}

function resolveExtractionDirectory(config) {
  const candidates = [config.extractedDir, path.join(ROOT, "extracted")];
  return candidates.find(isUsableExtraction) ?? config.extractedDir;
}

function getUtmtStatus() {
  const config = getConfig();
  let cliPath = findUtmtCli(config.utmtDir, 2);
  if (!cliPath) {
    const installedRoot = path.join(app.getPath("userData"), "utmt");
    cliPath = findUtmtCli(installedRoot, 3);
    if (cliPath) updateConfig({ utmtDir: path.dirname(cliPath) });
  }
  return {
    ready: Boolean(cliPath),
    cliPath,
    directory: cliPath ? path.dirname(cliPath) : config.utmtDir,
    platform: process.platform,
  };
}

function serializeLanguage(langObj) {
  const lines = ["{"];
  const keys = Object.keys(langObj);
  keys.forEach((key, index) => {
    const comma = index < keys.length - 1 ? "," : "";
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(langObj[key])}${comma}`);
  });
  lines.push("}");
  return lines.join("\n");
}

function backupContent(file, content) {
  if (!file || !fs.existsSync(file)) return null;
  const directory = runtimeDirectory("backups");
  const stem = path.basename(file).replace(/[^\w.-]+/g, "_");
  const backups = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith(`${stem}_`) && name.endsWith(".bak"))
    .map((name) => ({ name, modifiedAt: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => a.modifiedAt - b.modifiedAt);
  const latest = backups.at(-1);
  if (latest && Date.now() - latest.modifiedAt < BACKUP_INTERVAL_MS) return null;
  if (
    latest &&
    fs.readFileSync(path.join(directory, latest.name), "utf8") === content
  ) {
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(directory, `${stem}_${stamp}.bak`);
  fs.writeFileSync(destination, content, "utf8");
  backups.push({ name: path.basename(destination), modifiedAt: Date.now() });
  while (backups.length > 40) {
    fs.unlinkSync(path.join(directory, backups.shift().name));
  }
  return destination;
}

function backupFile(file, nextContent) {
  if (!file || !fs.existsSync(file)) return null;
  const currentContent = fs.readFileSync(file, "utf8");
  if (currentContent === nextContent) return null;
  return backupContent(file, currentContent);
}

function runNodeScript(script, args, onLine = () => {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }),
    });
    let buffer = "";
    const consume = (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.trim()) onLine(line);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => resolve({ code: -1, error }));
    child.on("close", (code) => {
      if (buffer.trim()) onLine(buffer.trim());
      resolve({ code, error: null });
    });
  });
}

function replaceDataWinSafely(generated, target) {
  const previous = `${target}.deltatranslate-previous`;
  fs.rmSync(previous, { force: true });
  fs.renameSync(target, previous);
  try {
    fs.renameSync(generated, target);
    fs.rmSync(previous, { force: true });
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(previous)) fs.renameSync(previous, target);
    throw error;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    backgroundColor: "#000000",
    icon: APP_ICON_PATH,
    ...(process.platform === "win32" && {
      titleBarStyle: "hidden",
      titleBarOverlay: TITLE_BAR_THEMES.deltarune,
    }),
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "DELTATRANSLATE",
  });
  win.setMenuBarVisibility(false);
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on("before-input-event", (event, input) => {
    const shortcut = input.control || input.meta;
    if (input.type === "keyDown" && shortcut && !input.alt && input.key.toLowerCase() === "s") {
      event.preventDefault();
      win.webContents.send("save-requested");
    }
  });
  win.on("close", (event) => {
    if (windowsAllowedToClose.has(win)) return;
    event.preventDefault();
    win.webContents.send("close-requested");
  });
  const query = process.env.DEV_KEY ? { key: process.env.DEV_KEY } : {};
  win.loadFile(path.join(ROOT, "src", "index.html"), { query });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------- IPC ----------

ipcMain.handle("get-config", () => getConfig());
ipcMain.handle("set-config", (_event, patch) => updateConfig(patch));
ipcMain.handle("get-utmt-status", () => getUtmtStatus());

ipcMain.handle("set-title-bar-theme", (event, theme) => {
  if (process.platform !== "win32") return;
  BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(
    TITLE_BAR_THEMES[theme] ?? TITLE_BAR_THEMES.deltarune
  );
});

ipcMain.handle("confirm-close", async (event, unsavedCount) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return "cancel";
  const count = Math.max(0, Number(unsavedCount) || 0);
  if (count === 0) return "discard";
  const plural = count > 1;
  const result = await dialog.showMessageBox(win, {
    type: "question",
    title: "Traductions non sauvegardées",
    message:
      `Vous avez ${count} nouvelle${plural ? "s" : ""} traduction${plural ? "s" : ""} ` +
      `non sauvegardée${plural ? "s" : ""}.`,
    detail: `Voulez-vous ${plural ? "les" : "la"} sauvegarder avant de quitter ?`,
    buttons: ["Oui", "Non"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return result.response === 0 ? "save" : "discard";
});

ipcMain.handle("close-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  windowsAllowedToClose.add(win);
  win.close();
  return true;
});

ipcMain.handle("load-data", () => {
  let config = getConfig();
  const detectedExtraction = resolveExtractionDirectory(config);
  if (detectedExtraction && detectedExtraction !== config.extractedDir) {
    config = updateConfig({ extractedDir: detectedExtraction });
  }
  const prefs = loadJson(prefsPath(), {});
  const referencePath = config.extractedDir
    ? path.join(config.extractedDir, "reference.json")
    : null;
  const ready = Boolean(
    config.langFrPath &&
      fs.existsSync(config.langFrPath) &&
      referencePath &&
      fs.existsSync(referencePath)
  );
  if (!ready) {
    return {
      ready: false,
      config,
      prefs,
      setupReason: "Aucun chapitre extrait n'est disponible.",
      utmt: getUtmtStatus(),
    };
  }

  const result = {
    ready: true,
    config,
    prefs,
    utmt: getUtmtStatus(),
    lang: JSON.parse(fs.readFileSync(config.langFrPath, "utf8")),
    reference: loadJson(referencePath, {}),
    extractedDir: config.extractedDir,
    fonts: {},
  };
  const spritesDir = path.join(config.extractedDir, "sprites");
  result.spriteFiles = fs.existsSync(spritesDir) ? fs.readdirSync(spritesDir) : [];
  result.spriteMeta = {};
  const spriteListPath = path.join(config.extractedDir, "sprites_list.txt");
  if (fs.existsSync(spriteListPath)) {
    for (const line of fs.readFileSync(spriteListPath, "utf8").split(/\r?\n/)) {
      const [name, frames, width, height, originX = "0", originY = "0"] = line.split(";");
      if (!name) continue;
      result.spriteMeta[name] = {
        frames: Number(frames) || 0,
        width: Number(width) || 0,
        height: Number(height) || 0,
        originX: Number(originX) || 0,
        originY: Number(originY) || 0,
      };
    }
  }
  const fontsDir = path.join(config.extractedDir, "fonts");
  if (fs.existsSync(fontsDir)) {
    for (const file of fs.readdirSync(fontsDir)) {
      if (!file.startsWith("glyphs_") || !file.endsWith(".csv")) continue;
      const name = file.slice("glyphs_".length, -".csv".length);
      result.fonts[name] = fs.readFileSync(path.join(fontsDir, file), "utf8");
    }
  }
  return result;
});

let saveRunning = false;
ipcMain.handle("save-lang", async (event, langObj) => {
  if (saveRunning) return { ok: false, error: "Une sauvegarde est déjà en cours." };
  saveRunning = true;
  const config = getConfig();
  const serialized = serializeLanguage(langObj);
  let translationTemp = null;
  let dataWinTemp = null;
  try {
    if (config.storageMode !== "datawin") {
      const backup = backupFile(config.langFrPath, serialized);
      fs.writeFileSync(config.langFrPath, serialized, "utf8");
      return {
        ok: true,
        savedAt: new Date().toISOString(),
        mode: "lang-json",
        backupCreated: Boolean(backup),
      };
    }

    const utmt = getUtmtStatus();
    if (!utmt.ready) throw new Error("UTMT CLI est requis pour écrire dans data.win.");
    const required = [
      config.langFrPath,
      config.dataWinPath,
      config.sourceDataWinPath,
      config.extractedDir,
    ];
    if (required.some((item) => !item)) throw new Error("Configuration data.win incomplète.");

    const backup = backupFile(config.langFrPath, serialized);
    translationTemp = `${config.langFrPath}.tmp-${process.pid}`;
    dataWinTemp = `${config.dataWinPath}.deltatranslate-tmp-${process.pid}`;
    fs.writeFileSync(translationTemp, serialized, "utf8");
    fs.rmSync(dataWinTemp, { force: true });
    const lines = [];
    event.sender.send("save-progress", "Recompilation du data.win via UTMT…");
    const result = await runNodeScript(
      path.join(ROOT, "extraction", "patch-datawin.mjs"),
      [
        "--source",
        config.sourceDataWinPath,
        "--output",
        dataWinTemp,
        "--cli",
        utmt.cliPath,
        "--code",
        path.join(config.extractedDir, "CodeEntries"),
        "--reference",
        path.join(config.extractedDir, "reference.json"),
        "--translation",
        translationTemp,
      ],
      (line) => {
        lines.push(line);
        event.sender.send("save-progress", line);
      }
    );
    if (result.code !== 0) {
      throw new Error(`La recompilation UTMT a échoué (code ${result.code}).\n${lines.slice(-8).join("\n")}`);
    }
    replaceDataWinSafely(dataWinTemp, config.dataWinPath);
    fs.writeFileSync(config.langFrPath, serialized, "utf8");
    fs.rmSync(translationTemp, { force: true });
    return {
      ok: true,
      savedAt: new Date().toISOString(),
      mode: "datawin",
      backupCreated: Boolean(backup),
    };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (translationTemp) fs.rmSync(translationTemp, { force: true });
    if (dataWinTemp) fs.rmSync(dataWinTemp, { force: true });
    saveRunning = false;
  }
});

ipcMain.handle("backup-lang", (_event, langObj) => {
  try {
    const config = getConfig();
    const serialized = serializeLanguage(langObj);
    if (!config.langFrPath || !fs.existsSync(config.langFrPath)) {
      throw new Error("Le fichier de langue est introuvable.");
    }
    if (fs.readFileSync(config.langFrPath, "utf8") === serialized) {
      return { ok: true, backupCreated: false };
    }
    const backup = backupContent(config.langFrPath, serialized);
    return { ok: true, backupCreated: Boolean(backup) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("save-prefs", (_event, prefs) => {
  fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), "utf8");
  return true;
});

ipcMain.handle("open-backups", () => shell.openPath(runtimeDirectory("backups")));

ipcMain.handle("pick-datawin", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choisir le data.win d'un chapitre de DELTARUNE",
    filters: [{ name: "GameMaker data", extensions: ["win"] }],
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("pick-utmt-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choisir le dossier d'UTMT CLI",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  const cliPath = findUtmtCli(result.filePaths[0], 3);
  if (!cliPath) {
    return { ok: false, error: "UndertaleModCli est introuvable dans ce dossier." };
  }
  updateConfig({ utmtDir: path.dirname(cliPath) });
  return { ok: true, ...getUtmtStatus() };
});

let installRunning = false;
ipcMain.handle("install-utmt", async (event) => {
  if (installRunning) return { ok: false, error: "L'installation est déjà en cours." };
  installRunning = true;
  try {
    const result = await installLatestUtmt(
      path.join(app.getPath("userData"), "utmt"),
      (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("utmt-progress", progress);
      }
    );
    updateConfig({ utmtDir: result.directory });
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    installRunning = false;
  }
});

let importRunning = false;
ipcMain.handle("import-datawin", async (event, dataWinPath) => {
  if (importRunning) return { ok: false, error: "Un import est déjà en cours." };
  if (!dataWinPath || !fs.existsSync(dataWinPath)) {
    return { ok: false, error: "Le fichier data.win est introuvable." };
  }
  const utmt = getUtmtStatus();
  if (!utmt.ready) return { ok: false, error: "Installe ou lie UTMT CLI avant l'import." };
  importRunning = true;
  let imported = null;
  const lines = [];
  try {
    const result = await runNodeScript(
      path.join(ROOT, "extraction", "import-datawin.mjs"),
      [
        "--datawin",
        dataWinPath,
        "--cli",
        utmt.cliPath,
        "--outdir",
        runtimeDirectory("extracted-imports"),
      ],
      (line) => {
        if (line.startsWith("IMPORT_DONE ")) {
          try {
            imported = JSON.parse(line.slice("IMPORT_DONE ".length));
          } catch {}
          return;
        }
        lines.push(line);
        if (!event.sender.isDestroyed()) event.sender.send("import-progress", line);
      }
    );
    if (result.code === 0 && imported) {
      const config = updateConfig(imported);
      event.sender.send("import-progress", "Import terminé ✔ — configuration mise à jour.");
      return { ok: true, config };
    }
    return {
      ok: false,
      error: `L'import a échoué (code ${result.code}).\n${lines.slice(-8).join("\n")}`,
    };
  } finally {
    importRunning = false;
  }
});
