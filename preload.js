const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (patch) => ipcRenderer.invoke("set-config", patch),
  getUtmtStatus: () => ipcRenderer.invoke("get-utmt-status"),
  setTitleBarTheme: (theme) => ipcRenderer.invoke("set-title-bar-theme", theme),
  loadData: () => ipcRenderer.invoke("load-data"),
  saveLang: (langObj) => ipcRenderer.invoke("save-lang", langObj),
  backupLang: (langObj) => ipcRenderer.invoke("backup-lang", langObj),
  getSpriteFrame: (name, role, frame) => ipcRenderer.invoke("get-sprite-frame", name, role, frame),
  exportSpriteFrame: (name, frame) => ipcRenderer.invoke("export-sprite-frame", name, frame),
  importSpriteFrame: (name, frame, file) =>
    ipcRenderer.invoke("import-sprite-frame", name, frame, webUtils.getPathForFile(file)),
  resetSpriteFrame: (name, frame) => ipcRenderer.invoke("reset-sprite-frame", name, frame),
  openSpriteOverrides: () => ipcRenderer.invoke("open-sprite-overrides"),
  applySpriteOverrides: () => ipcRenderer.invoke("apply-sprite-overrides"),
  listCodeFiles: (query) => ipcRenderer.invoke("list-code-files", query),
  readCodeFile: (file) => ipcRenderer.invoke("read-code-file", file),
  saveCodeFile: (file, content) => ipcRenderer.invoke("save-code-file", file, content),
  resetCodeFile: (file) => ipcRenderer.invoke("reset-code-file", file),
  applyCodeOverrides: () => ipcRenderer.invoke("apply-code-overrides"),
  savePrefs: (prefs) => ipcRenderer.invoke("save-prefs", prefs),
  confirmClose: (unsavedCount) => ipcRenderer.invoke("confirm-close", unsavedCount),
  closeWindow: () => ipcRenderer.invoke("close-window"),
  onCloseRequested: (cb) => ipcRenderer.on("close-requested", cb),
  onSaveRequested: (cb) => ipcRenderer.on("save-requested", cb),
  openBackups: () => ipcRenderer.invoke("open-backups"),
  pickDataWin: () => ipcRenderer.invoke("pick-datawin"),
  pickUtmtFolder: () => ipcRenderer.invoke("pick-utmt-folder"),
  installUtmt: () => ipcRenderer.invoke("install-utmt"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  importDataWin: (p) => ipcRenderer.invoke("import-datawin", p),
  onImportProgress: (cb) =>
    ipcRenderer.on("import-progress", (_e, line) => cb(line)),
  onUtmtProgress: (cb) =>
    ipcRenderer.on("utmt-progress", (_e, progress) => cb(progress)),
  onSaveProgress: (cb) =>
    ipcRenderer.on("save-progress", (_e, line) => cb(line)),
  onCodeProgress: (cb) =>
    ipcRenderer.on("code-progress", (_e, line) => cb(line)),
  onSpriteProgress: (cb) =>
    ipcRenderer.on("sprite-progress", (_e, line) => cb(line)),
});
