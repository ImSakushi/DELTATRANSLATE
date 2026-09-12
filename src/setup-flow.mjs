export async function prepareChapter(api, dataWinPath, onStage, options = {}) {
  const validation = await api.validateDataWin(dataWinPath);
  if (!validation.ok) throw new Error(validation.error);
  onStage("tools");
  const status = await api.getUtmtStatus();
  if (!status.ready) {
    const installation = await api.installUtmt();
    if (!installation.ok) throw new Error(installation.error);
  }
  onStage("import");
  const result = await api.importDataWin(dataWinPath, options);
  if (!result.ok) throw new Error(result.error);
  onStage("done");
  return result;
}
