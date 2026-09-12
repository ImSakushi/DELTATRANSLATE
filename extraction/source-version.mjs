import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import storage from "../storage.js";

export function fileHash(file) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

export function chooseSource(dataWin, workspace, { originalConfirmed = false, hasLangFr = false } = {}) {
  const manifestPath = path.join(workspace, "source-version.json");
  const manifest = storage.readJson(manifestPath, {});
  const activeHash = fileHash(dataWin);
  const historical = [manifest.source, path.join(path.dirname(dataWin), "data-original.win"), path.join(path.dirname(dataWin), "data-deltatranslate-original.win")]
    .find(file => file && fs.existsSync(file));
  const knownSourceHash = historical ? fileHash(historical) : null;
  if (manifest.sourceHash && knownSourceHash !== manifest.sourceHash && !originalConfirmed) throw new Error("La copie originale a été modifiée. Sélectionne un original vérifié avant de continuer.");
  const knownActive = activeHash === manifest.generatedHash || activeHash === manifest.previousGeneratedHash || activeHash === knownSourceHash;
  if (historical && !knownActive && !originalConfirmed) {
    throw new Error("Le data.win diffère de la source originale conservée. S’il vient d’une mise à jour officielle, coche « Le fichier sélectionné est un nouvel original » dans les options avancées. Les traductions et l’ancienne source sont conservées.");
  }
  let source = historical && knownActive && !originalConfirmed ? historical : dataWin;
  if (source === dataWin && (!hasLangFr || originalConfirmed)) {
    source = path.join(path.dirname(dataWin), `data-original-${activeHash.slice(0, 16)}.win`);
    if (!fs.existsSync(source)) fs.copyFileSync(dataWin, source, fs.constants.COPYFILE_EXCL);
  }
  const sourceHash = fileHash(source);
  storage.atomicWrite(manifestPath, JSON.stringify({ source, sourceHash, importedHash: activeHash, generatedHash: knownActive ? manifest.generatedHash : null, previousGeneratedHash: knownActive ? manifest.previousGeneratedHash : null }), { json: true });
  return { source, changed: Boolean(manifest.sourceHash && manifest.sourceHash !== sourceHash), activeHash };
}

export function assertActiveVersion(dataWin, workspace) {
  const manifest = storage.readJson(path.join(workspace, "source-version.json"), {});
  if (!manifest.importedHash) throw new Error("Réimporte ce chapitre pour identifier la version du jeu avant de recompiler.");
  const hash = fileHash(dataWin);
  if (hash !== manifest.generatedHash && hash !== manifest.previousGeneratedHash && hash !== manifest.importedHash) {
    throw new Error("Le jeu a changé depuis l’import. Réimporte sa nouvelle version avant de recompiler ; aucune donnée du jeu n’a été remplacée.");
  }
  if (!manifest.source || !fs.existsSync(manifest.source) || fileHash(manifest.source) !== manifest.sourceHash) throw new Error("La source originale a changé. Réimporte un original vérifié avant de recompiler.");
  return hash;
}

export function recordGeneratedVersion(generated, workspace) {
  const file = path.join(workspace, "source-version.json");
  const manifest = storage.readJson(file, {});
  storage.atomicWrite(file, JSON.stringify({ ...manifest, previousGeneratedHash: manifest.generatedHash, generatedHash: fileHash(generated) }), { json: true });
}
