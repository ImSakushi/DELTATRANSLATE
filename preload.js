const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (patch) => ipcRenderer.invoke("set-config", patch),
  getUtmtStatus: () => ipcRenderer.invoke("get-utmt-status"),
  setTitleBarTheme: (theme) => ipcRenderer.invoke("set-title-bar-theme", theme),
  loadData: () => ipcRenderer.invoke("load-data"),
  saveLang: (langObj) => ipcRenderer.invoke("save-lang", langObj),
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
});
