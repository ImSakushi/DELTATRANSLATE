export function updateAction(status) {
  if (!status?.enabled) return "disabled";
  if (["checking", "downloading", "installing"].includes(status.phase)) return "busy";
  if (status.downloaded) return "install";
  if (status.version) return "download";
  return "check";
}

export async function runUpdateAction(api, install) {
  // Relire l’état principal évite de lancer l’installation depuis un bouton périmé.
  const action = updateAction(await api.getUpdateStatus());
  if (action === "install") return install();
  if (action === "download") return api.downloadUpdate();
  if (action === "check") return api.checkForUpdates();
  return { ok: true };
}

export async function prepareUpdateInstall({ savePreferences, saveCode, saveLanguage, isBusy, isDirty, install }) {
  if (isBusy()) return { ok: false, error: "Une opération est en cours. Attendez sa fin, puis cliquez à nouveau sur Installer." };
  if (!(await savePreferences()) || !(await saveCode()) || !(await saveLanguage())) {
    return { ok: false, error: "L’installation est suspendue : le travail n’a pas pu être sauvegardé." };
  }
  if (isBusy() || isDirty()) return { ok: false, error: "Le travail a changé pendant la sauvegarde. Réessayez l’installation." };
  return install();
}
