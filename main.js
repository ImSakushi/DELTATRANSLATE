const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const storage = require("./storage.js");
const { spriteTextSources } = require("./sprite-text.js");
const { findUtmtCli, installLatestUtmt } = require("./utmt-manager.js");
const { discoverChapters, findChapters, validateDataWin } = require("./game-discovery.js");
const { createUpdaterController } = require("./updater.js");
const {
  DEFAULT_RUNEDDELTA_REMOTE,
  loadRunedeltaReference,
  assertRunedeltaWorkingFile,
  copyRunedeltaToGame,
  detectChapter,
  projectBinding,
  listRunedeltaBranches,
  isRunedeltaProjectConnected,
  installRunedelta,
  languageAttributions,
  languageRelativePath,
  runedeltaStatus,
  runedeltaPublication,
  branchSpritesSync,
  readBranchSpriteSync,
  gitBlobHash,
  synchronizeRunedelta,
} = require("./runedelta-sync.js");

const githubSetup = require("./runedelta-github.js").createGithubSetup();

const ROOT = __dirname;
const APP_ICON_PATH = path.join(ROOT, "src", "assets", "deltatranslate-icon.png");
const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const windowsAllowedToClose = new WeakSet();
const TITLE_BAR_HEIGHT = 32;
const TITLE_BAR_STYLE = { color: "#000000", symbolColor: "#ffffff", height: TITLE_BAR_HEIGHT };
const DEFAULT_CONFIG = {
  langFrPath: null,
  extractedDir: null,
  dataWinPath: null,
  sourceDataWinPath: null,
  storageMode: null,
  targetLanguage: "fr",
  multilang: false,
  utmtDir: null,
  runedelta: null,
};

app.setName("DELTATRANSLATE");

const updater = createUpdaterController({
  app,
  BrowserWindow,
  dialog,
  allowWindowsToClose: () => {
    for (const win of BrowserWindow.getAllWindows()) windowsAllowedToClose.add(win);
  },
  restoreCloseProtection: () => {
    for (const win of BrowserWindow.getAllWindows()) windowsAllowedToClose.delete(win);
  },
});

function loadJson(file, fallback) {
  return file ? storage.readJson(file, fallback) : fallback;
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

function backupsEnabled() {
  return loadJson(prefsPath(), {}).backupsEnabled === true;
}

function runedeltaSettings(config = getConfig()) {
  return {
    directory: config.runedelta?.directory ?? runtimeDirectory("runedelta"),
    remoteUrl: config.runedelta?.remoteUrl ?? DEFAULT_RUNEDDELTA_REMOTE,
  };
}

function runedeltaBackup(file, content) {
  return backupFile(file, content);
}

function runedeltaEnabledForCurrentChapter(config) {
  return isRunedeltaProjectConnected(config);
}

function formatRunedeltaConflict(result) {
  const keys = result.conflicts.slice(0, 12);
  const remaining = result.conflicts.length - keys.length;
  const examples = (result.conflictDetails ?? [])
    .slice(0, 3)
    .map(
      (item) =>
        `\n\n${item.key}\nLOCAL : ${item.local ?? "<clé supprimée>"}\nGITHUB : ${item.remote ?? "<clé supprimée>"}`
    )
    .join("");
  return (
    `Runedelta et le fichier local ont modifié ${result.conflicts.length} même${result.conflicts.length > 1 ? "s" : ""} clé${result.conflicts.length > 1 ? "s" : ""} différemment :\n` +
    keys.join("\n") +
    (remaining > 0 ? `\n… et ${remaining} autre${remaining > 1 ? "s" : ""}.` : "") +
    examples
  );
}

async function syncConfiguredRunedelta(config, language = null, conflictResolution = null, receiveOnly = false, commitMessage = null) {
  if (config.runedelta?.modeEnabled !== true || (!receiveOnly && config.runedelta?.publishEnabled !== true)) {
    throw new Error("La publication GitHub est désactivée dans les options Runedelta.");
  }
  const settings = runedeltaSettings(config);
  return synchronizeRunedelta({
    config,
    ...settings,
    language,
    conflictResolution,
    commitMessage,
    push: !receiveOnly,
    receiveOnly,
    serializeLanguage,
    backupFile: runedeltaBackup,
    sprites: receiveOnly ? [] : publishableSprites(config),
  });
}

// Les PNG importés partent sur la branche Runedelta uniquement quand on publie.
function publishableSprites(config) {
  if (!config.extractedDir) return [];
  const root = spriteOverrideRoot(config);
  return spriteCatalog(config).flatMap(entry => entry.overrideFrames.map(frame => ({
    name: entry.name, frame, frames: entry.frames, file: path.join(root, entry.targetName, `${frame}.png`),
  })));
}

function getConfig() {
  return Object.assign({}, DEFAULT_CONFIG, loadJson(configPath(), {}));
}

function saveConfig(config) {
  storage.atomicWrite(configPath(), JSON.stringify(config, null, 2), { json: true });
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

function resolveJapaneseLanguagePath(config) {
  const candidates = [
    config.langFrPath && path.join(path.dirname(config.langFrPath), "lang_ja.json"),
    config.dataWinPath && path.join(path.dirname(config.dataWinPath), "lang", "lang_ja.json"),
    config.sourceDataWinPath &&
      path.join(path.dirname(config.sourceDataWinPath), "lang", "lang_ja.json"),
    config.extractedDir && path.join(config.extractedDir, "lang_ja.json"),
  ].filter(Boolean);
  return [...new Set(candidates)].find((file) => fs.existsSync(file)) ?? null;
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
  return file ? storage.backup(runtimeDirectory("backups"), file, content) : null;
}

function backupFile(file, nextContent) {
  if (!file || !fs.existsSync(file)) return null;
  const currentContent = fs.readFileSync(file, "utf8");
  if (currentContent === nextContent) return null;
  return backupContent(file, currentContent);
}

function codePaths(file) {
  const config = getConfig();
  const input = String(file ?? "");
  const name = input.endsWith(".gml") ? input : `${input}.gml`;
  if (!input || path.basename(name) !== name || !name.endsWith(".gml")) {
    throw new Error("Nom de fichier GML invalide.");
  }
  if (!config.extractedDir) throw new Error("Aucune extraction de chapitre n'est chargée.");
  const source = path.join(config.extractedDir, "CodeEntries", name);
  const overridesDir = path.join(config.extractedDir, "CodeOverrides");
  if (!fs.existsSync(source)) throw new Error(`Code GML introuvable : ${name}`);
  return { config, name, source, overridesDir, override: path.join(overridesDir, name) };
}

function readSpriteMetadata(config = getConfig()) {
  const metadata = new Map();
  const listPath = path.join(config.extractedDir ?? "", "sprites_list.txt");
  if (!fs.existsSync(listPath)) return metadata;
  for (const line of fs.readFileSync(listPath, "utf8").split(/\r?\n/)) {
    const [name, frames, width, height, originX = "0", originY = "0"] = line.split(";");
    if (!name || !/^[A-Za-z0-9_]+$/.test(name)) continue;
    metadata.set(name, {
      name,
      frames: Math.max(0, Number(frames) || 0),
      width: Math.max(0, Number(width) || 0),
      height: Math.max(0, Number(height) || 0),
      originX: Number(originX) || 0,
      originY: Number(originY) || 0,
    });
  }
  return metadata;
}

function spriteOverrideRoot(config = getConfig()) {
  if (!config.extractedDir) throw new Error("Aucune extraction de chapitre n'est chargée.");
  return config.multilang
    ? path.join(config.extractedDir, "LanguageSprites", config.targetLanguage ?? "fr")
    : path.join(config.extractedDir, "SpriteOverrides");
}

const spriteTextCache = { key: null, value: null };
function readSpriteTextSources(metadata, config = getConfig()) {
  const listPath = path.join(config.extractedDir ?? "", "sprites_list.txt");
  const gmlPath = path.join(config.extractedDir ?? "", "CodeEntries", "gml_GlobalScript_scr_84_init_localization.gml");
  const stamp = (file) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0);
  const key = `${listPath}|${stamp(listPath)}|${stamp(gmlPath)}`;
  if (spriteTextCache.key !== key) {
    const gml = fs.existsSync(gmlPath) ? fs.readFileSync(gmlPath, "utf8") : "";
    spriteTextCache.key = key;
    spriteTextCache.value = spriteTextSources(new Set(metadata.keys()), gml);
  }
  return spriteTextCache.value;
}

// Une frame est « en attente » tant qu'elle est plus récente que le data.win
// installé : chaque recompilation réécrit le data.win avec tous les imports.
function dataWinAppliedAt(config = getConfig()) {
  try { return config.dataWinPath ? fs.statSync(config.dataWinPath).mtimeMs : 0; } catch { return 0; }
}

function buildSpriteEntry(item, metadata, root, config = getConfig(), text = readSpriteTextSources(metadata, config), appliedAt = null) {
  const code = config.targetLanguage ?? "fr";
  const originalVariant = metadata.get(`${item.name}_${code}`) ?? null;
  const variant = originalVariant ?? (config.multilang ? { ...item, name: `${item.name}_${code}` } : null);
  const targetName = variant?.name ?? item.name;
  const directory = path.join(root, targetName);
  const overrideFrames = fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .map((name) => name.match(/^(\d+)\.png$/i)?.[1])
        .filter((frame) => frame != null)
        .map(Number)
        .filter((frame) => Number.isInteger(frame) && frame >= 0)
        .sort((a, b) => a - b)
    : [];
  const modifiedAt = (frame) => Math.max(...[`${frame}.png`, `${frame}.offset`].map((file) => {
    try { return fs.statSync(path.join(directory, file)).mtimeMs; } catch { return 0; }
  }));
  if (overrideFrames.length && appliedAt == null) appliedAt = dataWinAppliedAt(config);
  const pendingFrames = overrideFrames.filter((frame) => modifiedAt(frame) > appliedAt);
  return {
    ...item,
    hasText: Boolean(text.sources.has(item.name) || originalVariant),
    textSource: text.sources.get(item.name) ?? null,
    pendingFrames,
    variant,
    variantGenerated: Boolean(variant && !originalVariant),
    targetName,
    overrideFrames,
    language: code,
    independent: Boolean(config.multilang),
    translated: Boolean(originalVariant || overrideFrames.length),
  };
}

// État Runedelta d'un sprite, lu dans le commit local de la branche (jamais dans main) :
// une frame importée est « publiée » quand son PNG est identique à celui de la branche.
function runedeltaSprites(config) {
  if (!runedeltaEnabledForCurrentChapter(config) || (config.runedelta?.storage ?? "git") !== "git") return null;
  try { return { branch: config.runedelta.branch, ...branchSpritesSync(runedeltaSettings(config).directory) }; }
  catch (error) { console.warn(`Sprites Runedelta illisibles : ${error.message}`); return null; }
}

function annotateRunedeltaSprite(entry, repository, root) {
  if (!repository) return entry;
  const frames = repository.sprites.get(entry.name) ?? new Map();
  const unpublishedFrames = entry.overrideFrames.filter(frame => {
    const file = path.join(root, entry.targetName, `${frame}.png`);
    try { return frames.get(frame)?.blob !== gitBlobHash(fs.readFileSync(file)); } catch { return true; }
  });
  return {
    ...entry,
    runedelta: { branch: repository.branch, frames: [...frames.keys()].sort((a, b) => a - b), unpublishedFrames },
    translated: entry.translated || frames.size > 0,
  };
}

function spriteCatalog(config = getConfig()) {
  const metadata = readSpriteMetadata(config);
  const root = spriteOverrideRoot(config);
  const text = readSpriteTextSources(metadata, config);
  const appliedAt = dataWinAppliedAt(config);
  const repository = runedeltaSprites(config);
  const result = [];
  for (const item of metadata.values()) {
    if ((config.languages ?? ["fr"]).some((code) => item.name.endsWith(`_${code}`) && metadata.has(item.name.slice(0, -code.length - 1)))) continue;
    if (text.japanese.has(item.name)) continue;
    result.push(annotateRunedeltaSprite(buildSpriteEntry(item, metadata, root, config, text, appliedAt), repository, root));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
}

function spriteEntry(baseName, config = getConfig()) {
  const safeName = String(baseName ?? "");
  if (!/^[A-Za-z0-9_]+$/.test(safeName)) {
    throw new Error("Nom de sprite invalide.");
  }
  const metadata = readSpriteMetadata(config);
  const item = metadata.get(safeName);
  if (!item) throw new Error(`Sprite introuvable : ${safeName}`);
  const root = spriteOverrideRoot(config);
  return annotateRunedeltaSprite(buildSpriteEntry(item, metadata, root, config), runedeltaSprites(config), root);
}

function missingSourceMessage(source) {
  return source
    ? `Le data.win du chapitre n’existe plus à cet emplacement :\n${source}\nRechoisis-le avec « Chapitre » pour extraire les originaux.`
    : "Aucun data.win n’est associé à ce chapitre. Choisis-le avec « Chapitre » pour extraire les originaux.";
}

function imageDataUrl(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
}

const spriteExtractionPromises = new Map();
async function ensureSpriteCached(entry, event) {
  const config = getConfig();
  const cache = path.join(config.extractedDir, "SpriteEditorSourceCache");
  const names = [entry.name, entry.variantGenerated ? null : entry.variant?.name].filter(Boolean);
  const expected = names.flatMap((name) => {
    const count = name === entry.name ? entry.frames : entry.variant.frames;
    return Array.from({ length: count }, (_unused, frame) => path.join(cache, `${name}_${frame}.png`));
  });
  if (expected.length && expected.every((file) => fs.existsSync(file))) return cache;
  // Le pré-chargement groupé contient peut-être déjà ce sprite : inutile de relancer UTMT.
  if (spritePrefetch) {
    await spritePrefetch;
    if (expected.length && expected.every((file) => fs.existsSync(file))) return cache;
  }

  const key = `${config.sourceDataWinPath ?? config.dataWinPath}|${names.join("|")}`;
  if (!spriteExtractionPromises.has(key)) {
    const promise = (async () => {
      const utmt = getUtmtStatus();
      if (!utmt.ready) throw new Error("UTMT CLI est requis pour extraire l'aperçu.");
      const source = config.sourceDataWinPath ?? config.dataWinPath;
      if (!source || !fs.existsSync(source)) throw new Error(missingSourceMessage(source));
      if (!event.sender.isDestroyed()) {
        event.sender.send("sprite-progress", `Extraction de ${entry.name}…`);
      }
      const lines = [];
      const result = await runNodeScript(
        path.join(ROOT, "extraction", "export-sprite.mjs"),
        ["--datawin", source, "--cli", utmt.cliPath, "--output", cache, "--names", names.join("|")],
        (line) => lines.push(line)
      );
      if (result.code !== 0) {
        throw new Error(`L'extraction du sprite a échoué.\n${lines.slice(-5).join("\n")}`);
      }
      return cache;
    })().finally(() => spriteExtractionPromises.delete(key));
    spriteExtractionPromises.set(key, promise);
  }
  return spriteExtractionPromises.get(key);
}

function ensureImmutableDataWinSource(config) {
  if (!config.dataWinPath || !fs.existsSync(config.dataWinPath)) {
    throw new Error("Le data.win actif est introuvable.");
  }
  const configuredSource = config.sourceDataWinPath;
  if (
    configuredSource &&
    fs.existsSync(configuredSource) &&
    path.resolve(configuredSource) !== path.resolve(config.dataWinPath)
  ) {
    return config;
  }

  const snapshot = path.join(path.dirname(config.dataWinPath), "data-deltatranslate-original.win");
  // Un nouvel import remet sourceDataWinPath sur le data.win actif : on rafraîchit
  // alors ce snapshot pour ne jamais recompiler une ancienne version du jeu.
  fs.copyFileSync(config.dataWinPath, snapshot);
  return updateConfig({ sourceDataWinPath: snapshot });
}

function runNodeScript(script, args, onLine = () => {}, signal = null) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve({ code: -1, error: new Error("Préparation annulée.") }); return; }
    const child = spawn(process.execPath, [script, ...args], {
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }),
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const cancel = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    let buffer = "";
    const consume = (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.trim()) onLine(line, child);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => resolve({ code: -1, error }));
    child.on("close", (code) => {
      signal?.removeEventListener("abort", cancel);
      if (buffer.trim()) onLine(buffer.trim(), child);
      resolve({ code, error: null });
    });
  });
}

function replaceDataWinSafely(generated, target, afterReplace = () => {}) {
  const previous = `${target}.deltatranslate-previous`;
  fs.rmSync(previous, { force: true });
  fs.renameSync(target, previous);
  try {
    fs.renameSync(generated, target);
    afterReplace();
  } catch (error) {
    if (fs.existsSync(previous)) {
      fs.rmSync(target, { force: true });
      fs.renameSync(previous, target);
    }
    throw error;
  }
  try { fs.rmSync(previous, { force: true }); } catch {}
}

function replaceWorkspaceFileSafely(generated, target) {
  if (!fs.existsSync(target)) {
    fs.renameSync(generated, target);
    return;
  }
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
      titleBarOverlay: TITLE_BAR_STYLE,
    }),
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "DELTATRANSLATE",
  });
  updater.start(win);
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
ipcMain.handle("copy-dialogue-image", (_event, dataUrl) => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 32 * 1024 * 1024)
    throw new Error("Image du dialogue invalide.");
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("L’image du dialogue est vide.");
  clipboard.writeImage(image);
});
ipcMain.handle("set-config", (_event, patch) => updateConfig(patch));
ipcMain.handle("get-utmt-status", () => getUtmtStatus());
ipcMain.handle("get-update-status", () => updater.getState());
ipcMain.handle("check-for-updates", () => updater.check(true));
ipcMain.handle("download-update", () => updater.download());
ipcMain.handle("install-update", () => updater.install());
ipcMain.handle("get-runedelta-status", async () => {
  const config = getConfig();
  if (config.runedelta?.modeEnabled !== true) return { enabled: false, configured: false };
  const settings = runedeltaSettings(config);
  return runedeltaStatus(config, settings.directory, settings.remoteUrl);
});

ipcMain.handle("get-runedelta-attributions", async () => {
  try {
    const config = getConfig();
    if (!runedeltaEnabledForCurrentChapter(config)) {
      return { ok: true, attributions: {} };
    }
    const chapter = detectChapter(config);
    const settings = runedeltaSettings(config);
    const relativePath = languageRelativePath(chapter);
    return {
      ok: true,
      attributions: await languageAttributions(settings.directory, relativePath),
    };
  } catch (error) {
    return { ok: false, attributions: {}, error: error.message };
  }
});

// Lecture seule : elle ne bloque pas les sauvegardes, mais les synchronisations Git l'attendent (un fetch déplace origin/*).
let publicationTask = null;
ipcMain.handle("get-runedelta-publication", (_event, fetch = false) => {
  const config = getConfig();
  if (!runedeltaEnabledForCurrentChapter(config)) return { ok: false, disabled: true };
  if (runedeltaRunning) return { ok: false, busy: true };
  if (publicationTask) return publicationTask;
  publicationTask = runedeltaPublication(config, runedeltaSettings(config).directory, { fetch: fetch === true })
    .catch(error => ({ ok: false, error: error.message }))
    .finally(() => { publicationTask = null; });
  return publicationTask;
});

let runedeltaRunning = false;
ipcMain.handle("set-runedelta-options", (_event, options = {}) => {
  if (runedeltaRunning || saveRunning || codeApplyRunning || importRunning) throw new Error("Une écriture est déjà en cours.");
  const config = getConfig();
  const modeEnabled = options.modeEnabled === true;
  return updateConfig({
    runedelta: {
      ...config.runedelta,
      modeEnabled,
      publishEnabled: modeEnabled && (options.publishEnabled ?? config.runedelta?.publishEnabled ?? true) === true,
      copyToGame: options.copyToGame === true,
    },
  });
});

ipcMain.handle("list-runedelta-branches", async (_event, remoteUrl) => {
  if (getConfig().runedelta?.modeEnabled !== true) return { ok: false, error: "Active le mode Runedelta." };
  try { return await listRunedeltaBranches(remoteUrl, { details: true }); }
  catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle("connect-runedelta", async (_event, requestedRemote, requestedBranch = null) => {
  await publicationTask;
  if (runedeltaRunning || saveRunning || codeApplyRunning || importRunning) return { ok: false, error: "Une écriture est déjà en cours." };
  runedeltaRunning = true;
  try {
    const config = getConfig();
    if (config.runedelta?.modeEnabled !== true) throw new Error("Active d’abord le mode Runedelta dans Chapitre → Fonctions facultatives.");
    if ((config.targetLanguage ?? "fr") !== "fr") throw new Error("Runedelta fournit la traduction française. Ouvre la langue FR avant de le connecter.");
    const previous = runedeltaSettings(config);
    const remoteUrl = String(requestedRemote ?? "").trim() || DEFAULT_RUNEDDELTA_REMOTE;
    const result = await installRunedelta({
      config: { ...config, runedelta: { ...config.runedelta, storage: "git" } },
      directory: previous.directory,
      branch: requestedBranch,
      remoteUrl,
      serializeLanguage,
      backupFile: runedeltaBackup,
    });
    const nextConfig = updateConfig({
      langFrPath: result.targetPath,
      storageMode: "runedelta-json",
      runedelta: {
        ...config.runedelta,
        enabled: true,
        branch: result.branch,
        storage: "git",
        remoteUrl,
        directory: result.directory,
        baseDirectory: result.baseDirectory,
        projects: {
          ...(config.runedelta?.projects ?? {}),
          [storage.projectId(config)]: projectBinding({ ...config, runedelta: { ...config.runedelta, storage: "git", directory: result.directory } }, remoteUrl, result.branch),
        },
      },
    });
    return { ...result, config: nextConfig };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally { runedeltaRunning = false; }
});

async function handleRunedeltaSync(_event, language = null, conflictResolution = null, expectedRevision, expectedProject, expectedPath, commitMessage = null, receiveOnly = false) {
  await publicationTask;
  if (runedeltaRunning || saveRunning || codeApplyRunning || importRunning) return { ok: false, error: "Une écriture est déjà en cours." };
  runedeltaRunning = true;
  try {
    const config = getConfig();
    if (expectedProject !== storage.projectId(config)) throw new Error("Le chapitre actif a changé.");
    if (config.storageMode === "runedelta-json" && expectedPath !== config.langFrPath) throw new Error("Le catalogue ou la branche a changé. Recharge l’éditeur.");
    storage.assertRevision(config.langFrPath, expectedRevision);
    if (!runedeltaEnabledForCurrentChapter(config)) {
      return { ok: false, error: "Runedelta n’est pas installé pour ce chapitre." };
    }
    const result = await syncConfiguredRunedelta(config, language, conflictResolution, receiveOnly, commitMessage);
    if (result.conflict) return { ...result, error: formatRunedeltaConflict(result) };
    if (result.ok && result.targetPath !== config.langFrPath) {
      updateConfig({ langFrPath: result.targetPath, storageMode: "runedelta-json" });
    }
    return result.ok
      ? {
          ...result,
          savedAt: new Date().toISOString(),
          mode: "runedelta",
          revision: storage.revision(result.targetPath),
          reference: await loadRunedeltaReference(config),
        }
      : result;
  } catch (error) {
    return { ok: false, error: error.message };
  } finally { runedeltaRunning = false; }
}
ipcMain.handle("sync-runedelta", (...args) => handleRunedeltaSync(...args));
ipcMain.handle("receive-runedelta", (event, language, resolution, revision, project, file) => handleRunedeltaSync(event, language, resolution, revision, project, file, null, true));

ipcMain.handle("check-runedelta-access", async (_event, remoteUrl) => {
  if (getConfig().runedelta?.modeEnabled !== true) return { ok: false, error: "Active le mode Runedelta." };
  try { return await githubSetup.check(remoteUrl); }
  catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("login-runedelta-github", async event => {
  if (runedeltaRunning || saveRunning || codeApplyRunning || importRunning) return { ok: false, error: "Une opération est déjà en cours." };
  if (getConfig().runedelta?.modeEnabled !== true) return { ok: false, error: "Active le mode Runedelta." };
  runedeltaRunning = true;
  try {
    const result = await githubSetup.login(text => {
      if (!event.sender.isDestroyed()) event.sender.send("runedelta-login-progress", text);
    }, () => {
      shell.openExternal("https://github.com/login/device").catch(() => {
        if (!event.sender.isDestroyed()) event.sender.send("runedelta-login-progress", "\nOuvre https://github.com/login/device dans ton navigateur pour continuer.\n");
      });
    });
    const config = getConfig();
    return { ...result, config: updateConfig({ runedelta: { ...config.runedelta, identity: result.identity } }) };
  } catch (error) { return { ok: false, error: error.message }; }
  finally { runedeltaRunning = false; }
});
ipcMain.handle("set-runedelta-identity", (_event, identity) => {
  if (runedeltaRunning || saveRunning || codeApplyRunning || importRunning) throw new Error("Une opération est déjà en cours.");
  const config = getConfig();
  if (config.runedelta?.modeEnabled !== true) throw new Error("Active le mode Runedelta.");
  const name = String(identity?.name ?? "").trim(), email = String(identity?.email ?? "").trim();
  if (!name || !email.includes("@") || /[\r\n\0]/.test(name + email)) throw new Error("Renseigne un nom et un e-mail Git valides.");
  return updateConfig({ runedelta: { ...config.runedelta, identity: { name, email } } });
});
ipcMain.handle("open-runedelta-pull-request", (_event, number) => {
  const pr = Number(number);
  const match = String(runedeltaSettings().remoteUrl).match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!Number.isSafeInteger(pr) || pr < 1 || !match) return false;
  return shell.openExternal(`https://github.com/${match[1]}/${match[2]}/pull/${pr}`);
});
ipcMain.handle("open-runedelta-help", (_event, topic) => {
  const urls = { git: "https://git-scm.com/downloads", gh: "https://cli.github.com/", device: "https://github.com/login/device" };
  if (Object.hasOwn(urls, topic)) return shell.openExternal(urls[topic]);
});

ipcMain.handle("disconnect-runedelta", () => {
  if (runedeltaRunning || saveRunning || codeApplyRunning || importRunning) throw new Error("Une opération est déjà en cours.");
  const config = getConfig();
  return updateConfig({
    runedelta: config.runedelta
      ? { ...config.runedelta, enabled: false, publishEnabled: false }
      : { enabled: false, remoteUrl: DEFAULT_RUNEDDELTA_REMOTE },
  });
});

ipcMain.handle("open-runedelta", () => {
  if (getConfig().runedelta?.modeEnabled !== true) return;
  const directory = runedeltaSettings().directory;
  fs.mkdirSync(directory, { recursive: true });
  return shell.openPath(directory);
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
    buttons: ["Enregistrer", "Quitter sans enregistrer", "Annuler"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return ["save", "discard", "cancel"][result.response] ?? "cancel";
});

ipcMain.handle("close-window", (event) => {
  if (importInstalling) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  windowsAllowedToClose.add(win);
  win.close();
  return true;
});

ipcMain.handle("load-data", async () => {
  let config = getConfig();
  const runedeltaSync = null;
  const detectedExtraction = resolveExtractionDirectory(config);
  if (detectedExtraction && detectedExtraction !== config.extractedDir) {
    config = updateConfig({ extractedDir: detectedExtraction });
  }
  const projectId = storage.projectId(config);
  const document = loadJson(prefsPath(), {});
  const migrated = config.dataWinPath ? storage.migratePreferences(document, projectId) : document;
  if (migrated !== document) {
    if (backupsEnabled() && fs.existsSync(prefsPath())) backupFile(prefsPath(), JSON.stringify(migrated, null, 2));
    storage.atomicWrite(prefsPath(), JSON.stringify(migrated, null, 2), { json: true });
  }
  const prefs = storage.scopedPreferences(migrated, projectId);
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
      projectId,
      setupReason: "Aucun chapitre extrait n'est disponible.",
      utmt: getUtmtStatus(),
      runedeltaSync,
    };
  }

  const result = {
    ready: true,
    config,
    prefs,
    projectId,
    revision: storage.revision(config.langFrPath),
    utmt: getUtmtStatus(),
    lang: JSON.parse(fs.readFileSync(config.langFrPath, "utf8")),
    japanese: loadJson(resolveJapaneseLanguagePath(config), {}),
    reference: await loadRunedeltaReference(config, loadJson(referencePath, {})),
    migration: loadJson(path.join(config.extractedDir, `migration-${config.targetLanguage ?? "fr"}.json`), {}),
    extractedDir: config.extractedDir,
    fonts: {},
    runedeltaSync,
  };
  const { repairDialogueScopes } = await import("./extraction/repair-dialogue-scopes.mjs");
  repairDialogueScopes(result.reference, path.join(config.extractedDir, "CodeEntries"));
  const spritesDir = path.join(config.extractedDir, "sprites");
  result.spriteFiles = fs.existsSync(spritesDir) ? fs.readdirSync(spritesDir) : [];
  result.spriteCatalog = spriteCatalog(config);
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

ipcMain.handle("refresh-preview-fonts", async (_event, expectedProject) => {
  if (importRunning || saveRunning || codeApplyRunning || runedeltaRunning) return { ok: false, error: "Une opération est déjà en cours." };
  importRunning = true;
  try {
    const config = getConfig();
    if (storage.projectId(config) !== expectedProject) throw new Error("Le chapitre actif a changé.");
    const utmt = getUtmtStatus();
    if (!utmt.ready) throw new Error("Installe ou lie UTMT CLI dans les options du chapitre.");
    const { refreshFonts } = await import("./extraction/refresh-fonts.mjs");
    const fonts = await refreshFonts({ cli: utmt.cliPath, dataWin: config.dataWinPath, outDir: config.extractedDir, force: true });
    return { ok: true, fonts, extractedDir: config.extractedDir, language: config.targetLanguage ?? "fr" };
  } catch (error) { return { ok: false, error: error.message }; }
  finally { importRunning = false; }
});

ipcMain.handle("get-sprite-frame", async (event, baseName, role = "original", frame = 0) => {
  try {
    const config = getConfig();
    const entry = spriteEntry(baseName, config);
    const index = Math.max(0, Number(frame) || 0);
    const translated = role === "translated";
    const targetName = translated && !entry.variantGenerated ? entry.targetName : entry.name;
    const frameCount = translated ? (entry.variant?.frames ?? entry.frames) : entry.frames;
    if (index >= frameCount) throw new Error(`La frame ${index} n'existe pas pour ${targetName}.`);

    if (translated) {
      const override = path.join(spriteOverrideRoot(config), entry.targetName, `${index}.png`);
      if (fs.existsSync(override)) {
        const { readPlacement } = await import("./extraction/sprite-overrides.mjs");
        return { ok: true, dataUrl: imageDataUrl(override), source: "override", placement: readPlacement(path.dirname(override), index) };
      }
      const published = entry.runedelta && runedeltaSprites(config)?.sprites.get(entry.name)?.get(index);
      if (published) {
        const content = readBranchSpriteSync(runedeltaSettings(config).directory, published.path);
        return { ok: true, dataUrl: `data:image/png;base64,${content.toString("base64")}`, source: "runedelta", repositoryPath: published.path };
      }
    }

    const extracted = path.join(config.extractedDir, "sprites", `${targetName}_${index}.png`);
    const cache = path.join(config.extractedDir, "SpriteEditorSourceCache", `${targetName}_${index}.png`);
    let image = !translated && fs.existsSync(extracted) ? extracted : fs.existsSync(cache) ? cache : null;
    if (!image) {
      const cacheDirectory = await ensureSpriteCached(entry, event);
      image = path.join(cacheDirectory, `${targetName}_${index}.png`);
    }
    if (!fs.existsSync(image)) throw new Error(`Impossible d'extraire ${targetName}, frame ${index}.`);
    return { ok: true, dataUrl: imageDataUrl(image), source: translated && entry.variant ? "variant" : "original" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("export-sprite-frame", async (event, baseName, frame = 0) => {
  try {
    const config = getConfig();
    const entry = spriteEntry(baseName, config);
    const index = Math.max(0, Number(frame) || 0);
    if (index >= entry.frames) throw new Error(`La frame ${index} n'existe pas pour ${entry.name}.`);
    const extracted = path.join(config.extractedDir, "sprites", `${entry.name}_${index}.png`);
    const cache = path.join(config.extractedDir, "SpriteEditorSourceCache", `${entry.name}_${index}.png`);
    let image = fs.existsSync(extracted) ? extracted : fs.existsSync(cache) ? cache : null;
    if (!image) {
      const cacheDirectory = await ensureSpriteCached(entry, event);
      image = path.join(cacheDirectory, `${entry.name}_${index}.png`);
    }
    if (!fs.existsSync(image)) throw new Error("La frame originale n'a pas pu être extraite.");
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "Exporter la frame originale",
      defaultPath: `${entry.name}_${index}.png`,
      filters: [{ name: "Image PNG", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    fs.copyFileSync(image, result.filePath);
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("get-sprite-catalog", () => {
  try { return { ok: true, catalog: spriteCatalog() }; } catch (error) { return { ok: false, error: error.message }; }
});

// Miniatures de la liste : uniquement les frames déjà extraites, sans lancer UTMT.
ipcMain.handle("get-sprite-thumbnails", (_event, names) => {
  const config = getConfig();
  const result = {};
  if (!config.extractedDir || !Array.isArray(names)) return result;
  const repository = runedeltaSprites(config);
  for (const name of names.slice(0, 80)) {
    if (typeof name !== "string" || !/^[A-Za-z0-9_]+$/.test(name)) continue;
    const file = [
      path.join(config.extractedDir, "sprites", `${name}_0.png`),
      path.join(config.extractedDir, "SpriteEditorSourceCache", `${name}_0.png`),
    ].find((candidate) => fs.existsSync(candidate));
    result[name] = file && fs.statSync(file).size <= 262144 ? imageDataUrl(file) : null;
    // Sans original extrait (data.win absent), la version publiée sur la branche sert de miniature.
    const published = !result[name] && repository?.sprites.get(name)?.get(0);
    if (published) {
      try {
        const content = readBranchSpriteSync(runedeltaSettings(config).directory, published.path);
        if (content.length <= 262144) result[name] = `data:image/png;base64,${content.toString("base64")}`;
      } catch {}
    }
  }
  return result;
});

// Extrait en un seul passage UTMT les aperçus manquants (sprites à texte).
let spritePrefetch = null;
ipcMain.handle("prefetch-sprite-previews", async (_event, names) => {
  if (spritePrefetch) return spritePrefetch;
  if (codeApplyRunning || saveRunning || importRunning) return { ok: false, busy: true };
  spritePrefetch = (async () => {
    try {
      const config = getConfig();
      const metadata = readSpriteMetadata(config);
      const cache = path.join(config.extractedDir, "SpriteEditorSourceCache");
      const missing = (Array.isArray(names) ? names : [])
        .filter((name) => typeof name === "string" && metadata.has(name))
        .filter((name) => ![path.join(config.extractedDir, "sprites", `${name}_0.png`), path.join(cache, `${name}_0.png`)].some((file) => fs.existsSync(file)))
        .slice(0, 400);
      if (!missing.length) return { ok: true, extracted: 0 };
      const utmt = getUtmtStatus();
      const source = config.sourceDataWinPath ?? config.dataWinPath;
      if (!source || !fs.existsSync(source)) return { ok: false, error: missingSourceMessage(source) };
      if (!utmt.ready) return { ok: false, error: "UTMT CLI est requis pour extraire les aperçus." };
      const lines = [];
      const result = await runNodeScript(
        path.join(ROOT, "extraction", "export-sprite.mjs"),
        ["--datawin", source, "--cli", utmt.cliPath, "--output", cache, "--names", missing.join("|")],
        (line) => lines.push(line)
      );
      if (result.code !== 0) return { ok: false, error: lines.slice(-3).join("\n") };
      return { ok: true, extracted: missing.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  })().finally(() => { spritePrefetch = null; });
  return spritePrefetch;
});

ipcMain.handle("export-sprite-frames", async (event, baseName) => {
  try {
    const config = getConfig();
    const entry = spriteEntry(baseName, config);
    const choice = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: `Exporter toutes les frames de ${entry.name}`,
      properties: ["openDirectory", "createDirectory"],
    });
    if (choice.canceled || !choice.filePaths[0]) return { ok: true, canceled: true };
    const destination = choice.filePaths[0];
    const source = (index) => [
      path.join(config.extractedDir, "sprites", `${entry.name}_${index}.png`),
      path.join(config.extractedDir, "SpriteEditorSourceCache", `${entry.name}_${index}.png`),
    ].find((file) => fs.existsSync(file));
    const frames = Array.from({ length: entry.frames }, (_unused, index) => index);
    if (frames.some((index) => !source(index))) await ensureSpriteCached(entry, event);
    let exported = 0;
    const skipped = [];
    for (const index of frames) {
      const image = source(index);
      if (!image) throw new Error(`Impossible d'extraire ${entry.name}, frame ${index}.`);
      const target = path.join(destination, `${entry.name}_${index}.png`);
      // Ne jamais écraser une frame que l'utilisateur est peut-être en train de retoucher.
      if (fs.existsSync(target)) { skipped.push(path.basename(target)); continue; }
      fs.copyFileSync(image, target);
      exported++;
    }
    return { ok: true, directory: destination, exported, skipped };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("import-sprite-frame", async (_event, baseName, frame, sourceFile) => {
  let temporary = null;
  try {
    const config = getConfig();
    const entry = spriteEntry(baseName, config);
    const index = Number(frame);
    if (!Number.isInteger(index) || index < 0) throw new Error("Numéro de frame invalide.");
    const frameCount = entry.variant?.frames ?? entry.frames;
    if (index >= frameCount) throw new Error(`La frame ${index} n'existe pas pour ce sprite.`);
    const source = path.resolve(String(sourceFile ?? ""));
    if (!fs.existsSync(source) || path.extname(source).toLowerCase() !== ".png") {
      throw new Error("Choisis une image PNG existante.");
    }
    if (codeApplyRunning || saveRunning || importRunning) throw new Error("Attends la fin de l’opération en cours.");
    const { readPngSize, readPlacement, validateSpriteOverrides } = await import("./extraction/sprite-overrides.mjs");
    if (codeApplyRunning || saveRunning || importRunning) throw new Error("Attends la fin de l’opération en cours.");
    const size = readPngSize(source);
    const directory = path.join(spriteOverrideRoot(config), entry.targetName);
    const placement = readPlacement(directory, index);
    validateSpriteOverrides(directory, entry.variant ?? entry, { frame: index, ...size, ...placement });
    if (nativeImage.createFromPath(source).isEmpty()) throw new Error("Le PNG est incomplet ou illisible.");
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, `${index}.png`);
    if (backupsEnabled() && fs.existsSync(destination)) {
      backupContent(destination, fs.readFileSync(destination));
    }
    temporary = `${destination}.tmp-${process.pid}`;
    fs.copyFileSync(source, temporary);
    replaceWorkspaceFileSafely(temporary, destination);
    return { ok: true, entry: spriteEntry(baseName, config), dataUrl: imageDataUrl(destination), placement };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
  }
});

ipcMain.handle("save-sprite-placement", async (_event, baseName, frame, placement) => {
  try {
    if (codeApplyRunning || saveRunning || importRunning) throw new Error("Attends la fin de l’opération en cours.");
    const config = getConfig();
    const entry = spriteEntry(baseName, config);
    if (!Number.isInteger(frame) || !entry.overrideFrames.includes(frame)) throw new Error("Importe d’abord un PNG pour cette frame.");
    const { readPngSize, validateSpriteOverrides } = await import("./extraction/sprite-overrides.mjs");
    const { validatePlacement } = await import("./src/sprite-geometry.mjs");
    if (codeApplyRunning || saveRunning || importRunning) throw new Error("Attends la fin de l’opération en cours.");
    const position = validatePlacement(placement);
    const directory = path.join(spriteOverrideRoot(config), entry.targetName);
    validateSpriteOverrides(directory, entry.variant ?? entry, {
      frame, ...readPngSize(path.join(directory, `${frame}.png`)), ...position,
    });
    const file = path.join(directory, `${frame}.offset`);
    if (backupsEnabled() && fs.existsSync(file)) backupContent(file, fs.readFileSync(file));
    storage.atomicWrite(file, `${position.x};${position.y}\n`);
    return { ok: true, placement: position };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("reset-sprite-frame", (_event, baseName, frame) => {
  try {
    const config = getConfig();
    const entry = spriteEntry(baseName, config);
    const index = Number(frame);
    if (index < 0 || !Number.isInteger(index)) throw new Error("Numéro de frame invalide.");
    if (codeApplyRunning || saveRunning || importRunning) throw new Error("Attends la fin de l’opération en cours.");
    const override = path.join(spriteOverrideRoot(config), entry.targetName, `${index}.png`);
    const offset = path.join(path.dirname(override), `${index}.offset`);
    if (backupsEnabled() && fs.existsSync(offset)) backupContent(offset, fs.readFileSync(offset));
    if (backupsEnabled() && fs.existsSync(override)) {
      backupContent(override, fs.readFileSync(override));
    }
    fs.rmSync(override, { force: true });
    fs.rmSync(offset, { force: true });
    const directory = path.dirname(override);
    if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
      fs.rmdirSync(directory);
    }
    return { ok: true, entry: spriteEntry(baseName, config) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Reprend dans les imports locaux les frames publiées sur la branche, pour pouvoir les retoucher ou les appliquer au jeu.
ipcMain.handle("adopt-runedelta-sprite", async (_event, baseName) => {
  const written = [];
  try {
    if (codeApplyRunning || saveRunning || importRunning || runedeltaRunning) throw new Error("Attends la fin de l’opération en cours.");
    const config = getConfig();
    const entry = spriteEntry(baseName, config);
    const published = runedeltaSprites(config)?.sprites.get(entry.name);
    if (!published?.size) throw new Error("Ce sprite n’est pas sur ta branche Runedelta.");
    const { readPngSize, validateSpriteOverrides } = await import("./extraction/sprite-overrides.mjs");
    const directory = path.join(spriteOverrideRoot(config), entry.targetName);
    const frameCount = entry.variant?.frames ?? entry.frames;
    fs.mkdirSync(directory, { recursive: true });
    for (const [frame, file] of published) {
      if (frame >= frameCount || entry.overrideFrames.includes(frame)) continue;
      const destination = path.join(directory, `${frame}.png`);
      storage.atomicWrite(destination, readBranchSpriteSync(runedeltaSettings(config).directory, file.path));
      written.push(destination);
      validateSpriteOverrides(directory, entry.variant ?? entry, { frame, ...readPngSize(destination), x: 0, y: 0 });
    }
    return { ok: true, adopted: written.length, entry: spriteEntry(baseName, config) };
  } catch (error) {
    for (const file of written) fs.rmSync(file, { force: true });
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("open-sprite-overrides", () => {
  const directory = spriteOverrideRoot();
  fs.mkdirSync(directory, { recursive: true });
  return shell.openPath(directory);
});

let saveRunning = false;
ipcMain.handle("save-lang", async (event, langObj, expectedRevision, expectedProject, expectedPath) => {
  if (saveRunning || codeApplyRunning || importRunning || runedeltaRunning) return { ok: false, error: "Une écriture est déjà en cours." };
  saveRunning = true;
  let config = null;
  let translationTemp = null;
  let dataWinTemp = null;
  try {
    config = getConfig();
    if (expectedProject !== storage.projectId(config)) throw new Error("Le chapitre actif a changé. Recharge l’éditeur.");
    if (config.storageMode === "runedelta-json" && expectedPath !== config.langFrPath) throw new Error("Le catalogue ou la branche a changé. Recharge l’éditeur.");
    const serialized = serializeLanguage(langObj);
    storage.assertRevision(config.langFrPath, expectedRevision);
    if (config.storageMode !== "datawin") {
      await assertRunedeltaWorkingFile(config);
      const backup = backupsEnabled() || config.storageMode === "runedelta-json"
        ? backupFile(config.langFrPath, serialized)
        : null;
      storage.atomicWrite(config.langFrPath, serialized, { json: true, expected: expectedRevision });
      return {
        ok: true,
        savedAt: new Date().toISOString(),
        mode: "lang-json",
        backupCreated: Boolean(backup),
        revision: storage.revision(config.langFrPath),
        ...(config.storageMode === "runedelta-json" ? copyRunedeltaToGame(config, langObj, serializeLanguage, runedeltaBackup) : {}),
      };
    }

    const versions = await import("./extraction/source-version.mjs");
    versions.assertActiveVersion(config.dataWinPath, config.extractedDir);

    const utmt = getUtmtStatus();
    if (!utmt.ready) throw new Error("UTMT CLI est requis pour écrire dans data.win.");
    const required = [
      config.langFrPath,
      config.dataWinPath,
      config.sourceDataWinPath,
      config.extractedDir,
    ];
    if (required.some((item) => !item)) throw new Error("Configuration data.win incomplète.");

    const backup = backupsEnabled()
      ? backupFile(config.langFrPath, serialized)
      : null;
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
        "--overrides",
        path.join(config.extractedDir, "CodeOverrides"),
        "--sprites",
        path.join(config.extractedDir, "SpriteOverrides"),
      ],
      (line) => {
        lines.push(line);
        event.sender.send("save-progress", line);
      }
    );
    if (result.code !== 0) {
      throw new Error(`La recompilation UTMT a échoué (code ${result.code}).\n${lines.slice(-8).join("\n")}`);
    }
    storage.assertRevision(config.langFrPath, expectedRevision);
    versions.assertActiveVersion(config.dataWinPath, config.extractedDir);
    versions.recordGeneratedVersion(dataWinTemp, config.extractedDir);
    replaceDataWinSafely(dataWinTemp, config.dataWinPath, () => {
      storage.atomicWrite(config.langFrPath, serialized, { json: true, expected: expectedRevision });
    });
    fs.rmSync(translationTemp, { force: true });
    return {
      ok: true,
      savedAt: new Date().toISOString(),
      mode: "datawin",
      backupCreated: Boolean(backup),
      revision: storage.revision(config.langFrPath),
    };
  } catch (error) {
    if (config?.langFrPath && expectedProject === storage.projectId(config) && (config.storageMode !== "runedelta-json" || expectedPath === config.langFrPath)) {
      try {
        if (backupsEnabled()) storage.backup(runtimeDirectory("backups"), config.langFrPath, serializeLanguage(langObj), { kind: "draft" });
      } catch {}
    }
    return { ok: false, error: error.message };
  } finally {
    if (translationTemp) fs.rmSync(translationTemp, { force: true });
    if (dataWinTemp) fs.rmSync(dataWinTemp, { force: true });
    saveRunning = false;
  }
});

ipcMain.handle("backup-lang", (_event, langObj, expectedProject, expectedPath) => {
  try {
    if (!backupsEnabled()) {
      return { ok: true, backupCreated: false, disabled: true };
    }
    const config = getConfig();
    if (expectedProject !== storage.projectId(config)) throw new Error("Le chapitre actif a changé.");
    if (config.storageMode === "runedelta-json" && expectedPath !== config.langFrPath) throw new Error("Le catalogue ou la branche a changé. Recharge l’éditeur.");
    const serialized = serializeLanguage(langObj);
    if (!config.langFrPath || !fs.existsSync(config.langFrPath)) {
      throw new Error("Le fichier de langue est introuvable.");
    }
    if (fs.readFileSync(config.langFrPath, "utf8") === serialized) {
      return { ok: true, backupCreated: false };
    }
    const backup = storage.backup(runtimeDirectory("backups"), config.langFrPath, serialized, { kind: "draft", interval: 60_000 });
    return { ok: true, backupCreated: Boolean(backup) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("list-code-files", (_event, query = "") => {
  try {
    const config = getConfig();
    const directory = path.join(config.extractedDir ?? "", "CodeEntries");
    if (!fs.existsSync(directory)) return [];
    const searched = String(query).trim().toLocaleLowerCase("fr");
    return fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".gml") && (!searched || name.toLocaleLowerCase("fr").includes(searched)))
      .sort((a, b) => a.localeCompare(b, "fr", { numeric: true }))
      .slice(0, 200)
      .map((name) => name.slice(0, -4));
  } catch {
    return [];
  }
});

ipcMain.handle("read-code-file", (_event, file) => {
  try {
    const paths = codePaths(file);
    const original = fs.readFileSync(paths.source, "utf8");
    const modified = fs.existsSync(paths.override);
    return {
      ok: true,
      file: paths.name.slice(0, -4),
      content: modified ? fs.readFileSync(paths.override, "utf8") : original,
      original,
      modified,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("save-code-file", (_event, file, content) => {
  let temporary = null;
  let previous = null;
  try {
    const paths = codePaths(file);
    const text = String(content ?? "");
    if (Buffer.byteLength(text, "utf8") > 10 * 1024 * 1024) {
      throw new Error("Ce fichier GML dépasse la limite de sécurité de 10 Mo.");
    }
    const original = fs.readFileSync(paths.source, "utf8");
    if (text === original) {
      if (fs.existsSync(paths.override)) {
        if (backupsEnabled()) backupContent(paths.override, fs.readFileSync(paths.override, "utf8"));
        fs.rmSync(paths.override, { force: true });
      }
      return { ok: true, modified: false, backupCreated: false };
    }
    fs.mkdirSync(paths.overridesDir, { recursive: true });
    const backup =
      backupsEnabled() && fs.existsSync(paths.override)
        ? backupContent(paths.override, fs.readFileSync(paths.override, "utf8"))
        : null;
    temporary = `${paths.override}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, text, "utf8");
    previous = `${paths.override}.previous-${process.pid}`;
    fs.rmSync(previous, { force: true });
    if (fs.existsSync(paths.override)) fs.renameSync(paths.override, previous);
    try {
      fs.renameSync(temporary, paths.override);
      fs.rmSync(previous, { force: true });
    } catch (error) {
      if (!fs.existsSync(paths.override) && fs.existsSync(previous)) {
        fs.renameSync(previous, paths.override);
      }
      throw error;
    }
    return { ok: true, modified: true, backupCreated: Boolean(backup) };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
  }
});

ipcMain.handle("reset-code-file", (_event, file) => {
  try {
    const paths = codePaths(file);
    const backup =
      backupsEnabled() && fs.existsSync(paths.override)
        ? backupContent(paths.override, fs.readFileSync(paths.override, "utf8"))
        : null;
    fs.rmSync(paths.override, { force: true });
    return {
      ok: true,
      content: fs.readFileSync(paths.source, "utf8"),
      backupCreated: Boolean(backup),
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

let codeApplyRunning = false;
async function applyWorkspaceOverrides(event, progressChannel, progressLabel) {
  if (codeApplyRunning || saveRunning || importRunning || runedeltaRunning) {
    return { ok: false, error: "Une recompilation est déjà en cours." };
  }
  codeApplyRunning = true;
  let dataWinTemp = null;
  try {
    // Sous Windows, remplacer le data.win pendant qu'UTMT le lit échouerait.
    if (spritePrefetch) await spritePrefetch;
    let config = ensureImmutableDataWinSource(getConfig());
    const versions = await import("./extraction/source-version.mjs");
    versions.assertActiveVersion(config.dataWinPath, config.extractedDir);
    const utmt = getUtmtStatus();
    if (!utmt.ready) throw new Error("UTMT CLI est requis pour appliquer les modifications au jeu.");
    const required = [config.dataWinPath, config.sourceDataWinPath, config.extractedDir];
    if (required.some((item) => !item)) throw new Error("Configuration data.win incomplète.");

    dataWinTemp = `${config.dataWinPath}.deltatranslate-code-${process.pid}`;
    fs.rmSync(dataWinTemp, { force: true });
    const args = [
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
      "--overrides",
      path.join(config.extractedDir, "CodeOverrides"),
      "--sprites",
      path.join(config.extractedDir, "SpriteOverrides"),
    ];
    if (config.storageMode === "datawin") {
      args.push("--translation", config.langFrPath);
    } else {
      args.push("--overrides-only");
    }
    if (config.multilang) args.push("--workspace", config.extractedDir, "--datawin", config.dataWinPath,
      "--language", config.targetLanguage ?? "fr");
    const lines = [];
    event.sender.send(progressChannel, progressLabel);
    const result = await runNodeScript(
      path.join(ROOT, "extraction", config.multilang ? "build-language.mjs" : "patch-datawin.mjs"),
      args,
      (line) => {
        lines.push(line);
        if (!event.sender.isDestroyed()) event.sender.send(progressChannel, line);
      }
    );
    if (result.code !== 0) {
      throw new Error(`La compilation UTMT a échoué (code ${result.code}).\n${lines.slice(-8).join("\n")}`);
    }
    versions.assertActiveVersion(config.dataWinPath, config.extractedDir);
    if (config.multilang) {
      const { assertGameClosed, installTransaction } = await import("./extraction/install-language.mjs");
      assertGameClosed(config.dataWinPath);
      installTransaction([{ source: dataWinTemp, target: config.dataWinPath }], path.join(path.dirname(config.dataWinPath), "deltatranslate-backups"));
    } else {
      replaceDataWinSafely(dataWinTemp, config.dataWinPath);
    }
    versions.recordGeneratedVersion(config.dataWinPath, config.extractedDir);
    if (config.multilang) {
      const { hashFile } = await import("./extraction/install-language.mjs");
      const manifest = path.join(config.extractedDir, "multilang-install.json");
      const previous = loadJson(manifest, {});
      storage.atomicWrite(manifest, JSON.stringify({ ...previous, outputHash: hashFile(config.dataWinPath) }, null, 2), { json: true });
      const cache = path.resolve(config.extractedDir, "SpriteEditorSourceCache");
      if (path.dirname(cache) !== path.resolve(config.extractedDir)) throw new Error("Cache de sprites invalide.");
      fs.rmSync(cache, { recursive: true, force: true });
    }
    return { ok: true, appliedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (dataWinTemp) fs.rmSync(dataWinTemp, { force: true });
    codeApplyRunning = false;
  }
}

ipcMain.handle("apply-code-overrides", (event) =>
  applyWorkspaceOverrides(event, "code-progress", "Compilation du code GML et des sprites via UTMT…")
);

ipcMain.handle("apply-sprite-overrides", (event) =>
  applyWorkspaceOverrides(event, "sprite-progress", "Application des sprites au jeu via UTMT…")
);

ipcMain.handle("save-prefs", (_event, prefs, projectId) => {
  if (projectId !== storage.projectId(getConfig())) throw new Error("Le chapitre actif a changé. Préférences conservées.");
  const next = storage.mergePreferences(loadJson(prefsPath(), {}), projectId, prefs);
  const serialized = JSON.stringify(next, null, 2);
  if (next.backupsEnabled === true) backupFile(prefsPath(), serialized);
  storage.atomicWrite(prefsPath(), serialized, { json: true });
  return true;
});

ipcMain.handle("list-backups", () => {
  const file = getConfig().langFrPath;
  return file ? storage.listBackups(runtimeDirectory("backups"), file) : [];
});
ipcMain.handle("read-backup", (_event, id) => storage.readBackup(runtimeDirectory("backups"), getConfig().langFrPath, id));

ipcMain.handle("open-backups", () => shell.openPath(runtimeDirectory("backups")));

ipcMain.handle("pick-datawin", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choisir le data.win d'un chapitre de DELTARUNE",
    filters: [{ name: "GameMaker data", extensions: ["win"] }],
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("discover-chapters", () => discoverChapters({ currentDataWin: getConfig().dataWinPath }));
ipcMain.handle("validate-datawin", (_event, file) => validateDataWin(file));
ipcMain.handle("pick-game-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choisir le dossier DELTARUNE ou celui d’un chapitre",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  return findChapters(result.filePaths[0]);
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
let importAbort = null;
let importInstalling = false;
ipcMain.handle("cancel-import", () => {
  if (importInstalling) return false;
  importAbort?.abort();
  return true;
});
ipcMain.handle("import-datawin", async (event, dataWinPath, options = {}) => {
  if (importRunning || saveRunning || codeApplyRunning || runedeltaRunning) return { ok: false, error: "Une écriture est déjà en cours." };
  // Réserver l’import avant toute attente pour empêcher deux extractions concurrentes.
  importRunning = true;
  importAbort = new AbortController();
  let stageDirectory = null;
  try {
    const { normalizeLanguage } = await import("./extraction/languages.mjs");
    const language = normalizeLanguage(options.language ?? "fr");
    const validation = await validateDataWin(dataWinPath);
    if (!validation.ok) return validation;
    const utmt = getUtmtStatus();
    if (!utmt.ready) return { ok: false, error: "Installe ou lie UTMT CLI avant l'import." };
    let imported = null;
    const lines = [];
    const result = await runNodeScript(
      path.join(ROOT, "extraction", "import-datawin.mjs"),
      [
        "--datawin",
        dataWinPath,
        "--cli",
        utmt.cliPath,
        "--outdir",
        runtimeDirectory("extracted-imports"),
        ...(options.force ? ["--force"] : []),
        ...(options.newOriginal ? ["--new-original"] : []),
        "--language", language,
        "--coordinated-install",
        ...(options.fontDonor ? ["--font-donor", String(options.fontDonor)] : []),
      ],
      (line, child) => {
        if (line.startsWith("IMPORT_WORKSPACE ")) {
          stageDirectory = JSON.parse(line.slice("IMPORT_WORKSPACE ".length));
          return;
        }
        if (line === "IMPORT_INSTALLING") {
          if (importAbort.signal.aborted) return;
          importInstalling = true;
          event.sender.send("import-progress", "IMPORT_INSTALLING");
          child.stdin.end("INSTALL\n");
          return;
        }
        if (line.startsWith("IMPORT_DONE ")) {
          try {
            imported = JSON.parse(line.slice("IMPORT_DONE ".length));
          } catch {}
          return;
        }
        lines.push(line);
        if (!event.sender.isDestroyed()) event.sender.send("import-progress", line);
      },
      importAbort.signal
    );
    if (result.code === 0 && imported) {
      const config = updateConfig(imported);
      event.sender.send("import-progress", "Import terminé ✔ — configuration mise à jour.");
      return { ok: true, config };
    }
    return {
      ok: false,
      error: importAbort.signal.aborted ? "Préparation annulée. Le chapitre précédent et ses traductions sont conservés." : `L'import a échoué (code ${result.code}).\n${lines.slice(-8).join("\n")}`,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (stageDirectory) {
      try {
        const { cleanupInterruptedWorkspace } = await import("./extraction/workspace-transaction.mjs");
        cleanupInterruptedWorkspace(runtimeDirectory("extracted-imports"), stageDirectory);
      } catch (error) { console.error(`Nettoyage de l’import : ${error.message}`); }
    }
    importRunning = false;
    importAbort = null;
    importInstalling = false;
  }
});
