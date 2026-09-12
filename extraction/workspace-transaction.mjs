import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function beginWorkspace(target, onStage = () => {}) {
  const root = path.dirname(path.resolve(target));
  const stage = path.join(root, `${path.basename(target)}.preparing-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  onStage(stage);
  if (fs.existsSync(target)) fs.cpSync(target, stage, { recursive: true });
  else fs.mkdirSync(stage);
  return { target: path.resolve(target), stage, root };
}

export function cleanupInterruptedWorkspace(root, stage) {
  const directory = path.resolve(stage);
  if (path.dirname(directory) !== path.resolve(root) || !/\.preparing-[0-9a-f-]{36}$/.test(path.basename(directory))) {
    throw new Error("Dossier de préparation invalide.");
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

function removeOwned(transaction, directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== transaction.root || !path.basename(resolved).startsWith(`${path.basename(transaction.target)}.`)) {
    throw new Error("Dossier temporaire hors de l’espace de traduction.");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

export function abandonWorkspace(transaction) {
  removeOwned(transaction, transaction.stage);
}

export function commitWorkspace(transaction) {
  const { target, stage } = transaction;
  const previous = `${target}.previous-${randomUUID()}`;
  const existed = fs.existsSync(target);
  if (existed) fs.renameSync(target, previous);
  try { fs.renameSync(stage, target); }
  catch (error) {
    if (existed) fs.renameSync(previous, target);
    throw error;
  }
  // La version précédente reste récupérable si le nettoyage échoue.
  if (existed) { try { removeOwned(transaction, previous); } catch {} }
}
