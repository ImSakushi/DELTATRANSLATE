const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

function identity(file) {
  const absolute = path.resolve(file);
  return createHash("sha256").update(process.platform === "win32" ? absolute.toLowerCase() : absolute).digest("hex").slice(0, 20);
}

function revision(file) {
  return fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
}

function assertRevision(file, expected) {
  if (expected === undefined || revision(file) !== expected) {
    throw new Error("Le fichier a changé depuis son chargement. Recharge-le après avoir conservé tes modifications dans l’historique ; aucune version n’a été écrasée.");
  }
}

function atomicWrite(file, content, { json = false, expected } = {}) {
  if (json) JSON.parse(Buffer.isBuffer(content) ? content.toString("utf8") : content);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    const descriptor = fs.openSync(temporary, "wx", fs.existsSync(file) ? fs.statSync(file).mode : 0o600);
    try {
      fs.writeFileSync(descriptor, content);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    if (expected !== undefined) assertRevision(file, expected);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error(`Le fichier ${file} est illisible. Il a été conservé ; restaure une copie avant de continuer.`); }
}

function backupDirectory(root, file, kind = "saved") {
  return path.join(root, identity(file), kind);
}

function listBackups(root, file) {
  const results = [];
  for (const kind of ["saved", "draft"]) {
    const directory = backupDirectory(root, file, kind);
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".bak"))) {
      results.push({ id: `${kind}/${name}`, kind, date: fs.statSync(path.join(directory, name)).mtimeMs });
    }
  }
  return results.sort((a, b) => b.date - a.date);
}

function readBackup(root, file, id) {
  if (!/^(saved|draft)\/[\w.-]+\.bak$/.test(id)) throw new Error("Copie de sauvegarde invalide.");
  return readJson(path.join(root, identity(file), ...id.split("/")));
}

function backup(root, file, content, { kind = "saved", interval = 0 } = {}) {
  const directory = backupDirectory(root, file, kind);
  fs.mkdirSync(directory, { recursive: true });
  const versions = listBackups(root, file).filter(item => item.kind === kind);
  const latest = versions[0];
  if (latest) {
    const previous = fs.readFileSync(path.join(root, identity(file), ...latest.id.split("/")));
    if (previous.equals(Buffer.from(content)) || Date.now() - latest.date < interval) return null;
  }
  const destination = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.bak`);
  atomicWrite(destination, content);
  for (const item of versions.slice(39)) fs.unlinkSync(path.join(root, identity(file), ...item.id.split("/")));
  return destination;
}

const PROJECT_PREFS = ["modeOverrides", "bubbleSides", "platformSides", "validated", "faceOverrides", "sceneOverrides", "listSort", "speakerFilter"];
function projectId(config) {
  return identity(config.dataWinPath || config.langFrPath || "unconfigured") + ":" + (config.targetLanguage ?? "fr");
}
function scopedPreferences(document, id) {
  const result = { ...document };
  delete result.projects;
  delete result.legacyProject;
  for (const key of PROJECT_PREFS) delete result[key];
  const local = document.projects?.[id] ?? {};
  return { ...result, ...local };
}
function migratePreferences(document, id) {
  if (document.legacyProject) return document;
  const legacy = Object.fromEntries(PROJECT_PREFS.filter(key => Object.hasOwn(document, key)).map(key => [key, document[key]]));
  return { ...document, legacyProject: id, projects: { ...document.projects, [id]: { ...legacy, ...document.projects?.[id] } } };
}
function mergePreferences(document, id, prefs) {
  const next = migratePreferences(document, id);
  const local = {};
  for (const [key, value] of Object.entries(prefs)) {
    if (["projects", "legacyProject"].includes(key)) continue;
    if (PROJECT_PREFS.includes(key)) local[key] = value;
    else next[key] = value;
  }
  next.projects = { ...next.projects, [id]: { ...next.projects[id], ...local } };
  return next;
}

module.exports = { identity, revision, assertRevision, atomicWrite, readJson, backup, listBackups, readBackup, projectId, scopedPreferences, migratePreferences, mergePreferences };
