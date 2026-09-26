const { spawn, spawnSync } = require("child_process");
const { commandEnvironment } = require("./bundled-tools.js");
const fs = require("fs");
const path = require("path");
const { createHash } = require("node:crypto");
const { atomicWrite, revision, assertRevision, identity, projectId, backup } = require("./storage.js");

const DEFAULT_RUNEDDELTA_REMOTE = "https://github.com/Traducteurs-Aurifiques/Runedelta.git";
const MAIN_BRANCH = "main";
const GIT_TIMEOUT_MS = 120_000;
const MISSING = Symbol("missing");

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    let tool;
    try { tool = commandEnvironment(command, { GIT_TERMINAL_PROMPT: "0", ...options.env }); }
    catch (error) { resolve({ code: -1, stdout: "", stderr: error.message, error }); return; }
    const child = spawn(tool.command, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: tool.env,
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
    }, options.timeoutMs ?? GIT_TIMEOUT_MS);

    child.stdin.end();
    child.stdout.on("data", (chunk) => { stdout.push(chunk); options.onOutput?.(chunk.toString("utf8")); });
    child.stderr.on("data", (chunk) => { stderr.push(chunk); options.onOutput?.(chunk.toString("utf8")); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout: "", stderr: error.message, error });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: Number.isInteger(code) ? code : -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function git(args, cwd, options = {}) {
  const result = await runCommand("git", args, { cwd, timeoutMs: options.timeoutMs });
  if (result.code !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || "Erreur Git inconnue").trim();
    throw new Error(`${detail}\n\nCommande : git ${args.join(" ")}`);
  }
  return result;
}

function detectChapter(config) {
  const scopePath = config.extractedDir
    ? path.join(config.extractedDir, "chapter-scope.json")
    : null;
  if (scopePath && fs.existsSync(scopePath)) {
    try {
      const chapter = Number(JSON.parse(fs.readFileSync(scopePath, "utf8")).chapter);
      if (Number.isInteger(chapter) && chapter >= 1 && chapter <= 5) return chapter;
    } catch {}
  }

  for (const candidate of [config.dataWinPath, config.langFrPath, config.extractedDir]) {
    const match = String(candidate ?? "").match(/chapter\s*([1-5])/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function languageRelativePath(chapter) {
  const value = Number(chapter);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("Le chapitre Runedelta est indéterminé (chapitres 1 à 5 uniquement).");
  }
  return `strings/strings_chapitre_${value}.json`;
}

function gameLanguagePath(config) {
  if (!config.dataWinPath) throw new Error("Importe d’abord le data.win du chapitre.");
  return path.join(path.dirname(config.dataWinPath), "lang", "lang_fr.json");
}

function usesGitCatalogue(config) {
  return config.runedelta?.storage !== "game";
}

function workingLanguagePath(config, directory = config.runedelta?.directory) {
  return usesGitCatalogue(config)
    ? path.join(directory, languageRelativePath(detectChapter(config)))
    : gameLanguagePath(config);
}

async function assertRunedeltaWorkingFile(config) {
  if (config.storageMode !== "runedelta-json") return;
  const directory = config.runedelta?.directory;
  if (!directory || identity(config.langFrPath) !== identity(workingLanguagePath(config, directory))) {
    throw new Error("Le catalogue Git ne correspond plus au chapitre actif. Reconnecte Runedelta.");
  }
  if (await currentBranch(directory) !== config.runedelta.branch) {
    throw new Error("La branche Git a changé hors de l’application. Reconnecte la branche choisie avant de sauvegarder.");
  }
}

function copyRunedeltaToGame(config, language, serializeLanguage, backupFile) {
  if (!usesGitCatalogue(config) || config.runedelta?.copyToGame !== true) return {};
  const target = gameLanguagePath(config);
  try {
    const expected = revision(target);
    const serialized = serializeLanguage(language);
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === serialized) return { gameCopyPath: target };
    if (fs.existsSync(target)) {
      const saved = backupFile?.(target, serialized);
      if (!saved) backup(path.join(config.runedelta.directory, ".git", "deltatranslate-backups"), target, fs.readFileSync(target));
    }
    atomicWrite(target, serialized, { json: true, expected });
    return { gameCopyPath: target };
  } catch (error) {
    return { gameCopyError: `Le catalogue Git est sauvegardé, mais sa copie dans le jeu a échoué : ${error.message}` };
  }
}

function validateLanguage(value, label = "fichier de langue") {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} n’est pas un objet JSON valide.`);
  }
  const keys = Object.keys(value);
  if (keys.length < 50 || typeof value.date !== "string") {
    throw new Error(`${label} ne ressemble pas à un catalogue DELTARUNE complet.`);
  }
  const invalid = keys.find((key) => typeof value[key] !== "string");
  if (invalid) throw new Error(`${label} contient une valeur non textuelle : ${invalid}`);
  return value;
}

function parseLanguage(content, label) {
  try {
    return validateLanguage(JSON.parse(content), label);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label} contient un JSON invalide : ${error.message}`);
    }
    throw error;
  }
}

function readLanguage(file, label = file) {
  if (!fs.existsSync(file)) throw new Error(`${label} est introuvable.`);
  return parseLanguage(fs.readFileSync(file, "utf8"), label);
}

function sameValue(left, right) {
  return left === right || (left === MISSING && right === MISSING);
}

function mergeLanguages(base, local, remote, conflictResolution = null) {
  const result = {};
  const conflicts = [];
  const conflictDetails = [];
  const orderedKeys = [...new Set([...Object.keys(base), ...Object.keys(remote), ...Object.keys(local)])];

  for (const key of orderedKeys) {
    const baseValue = Object.hasOwn(base, key) ? base[key] : MISSING;
    const localValue = Object.hasOwn(local, key) ? local[key] : MISSING;
    const remoteValue = Object.hasOwn(remote, key) ? remote[key] : MISSING;
    let chosen;

    if (sameValue(localValue, remoteValue)) chosen = localValue;
    else if (sameValue(localValue, baseValue)) chosen = remoteValue;
    else if (sameValue(remoteValue, baseValue)) chosen = localValue;
    else {
      const resolution = typeof conflictResolution === "object" && conflictResolution !== null
        ? conflictResolution[key] : conflictResolution;
      const observed = { base: baseValue === MISSING ? null : baseValue, local: localValue === MISSING ? null : localValue, remote: remoteValue === MISSING ? null : remoteValue };
      const stale = resolution?.expected && ["base", "local", "remote"].some(side => resolution.expected[side] !== observed[side]);
      const choice = stale ? null : resolution?.choice ?? resolution;
      if (choice === "local") chosen = localValue;
      else if (choice === "remote") chosen = remoteValue;
      else if (!stale && resolution && typeof resolution === "object" && typeof resolution.value === "string") chosen = resolution.value;
      else {
        conflicts.push(key);
        conflictDetails.push({
          key,
          base: baseValue === MISSING ? null : baseValue,
          local: localValue === MISSING ? null : localValue,
          remote: remoteValue === MISSING ? null : remoteValue,
        });
        continue;
      }
    }

    if (chosen !== MISSING) result[key] = chosen;
  }

  return { language: result, conflicts, conflictDetails };
}

function countDifferences(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let count = 0;
  for (const key of keys) {
    const a = Object.hasOwn(left, key) ? left[key] : MISSING;
    const b = Object.hasOwn(right, key) ? right[key] : MISSING;
    if (!sameValue(a, b)) count++;
  }
  return count;
}

function compactDialogue(value, maxLength = 54) {
  const text = String(value ?? "")
    .replace(/\\[A-Za-z*].?/g, "")
    .replace(/\^[0-9]|[|&/%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function buildTranslationCommitMessage(chapter, before, after, reference = {}, custom = null) {
  const title = typeof custom?.title === "string" ? custom.title.replace(/[\r\n]+/g, " ").trim() : "";
  const description = typeof custom?.description === "string" ? custom.description.trim() : "";
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => key !== "date" && before[key] !== after[key]
  );
  const groups = { translated: [], corrected: [], restored: [] };

  for (const key of keys) {
    const english = reference[key]?.en;
    if (typeof english === "string" && before[key] === english && after[key] !== english) {
      groups.translated.push(key);
    } else if (typeof english === "string" && before[key] !== english && after[key] === english) {
      groups.restored.push(key);
    } else {
      groups.corrected.push(key);
    }
  }

  const total = keys.length;
  const onlyKey = total === 1 ? keys[0] : null;
  const excerpt = onlyKey ? compactDialogue(after[onlyKey]) : "";
  let action;
  if (onlyKey && excerpt) {
    if (groups.translated.length) action = `traduire « ${excerpt} »`;
    else if (groups.restored.length) action = `rétablir « ${excerpt} »`;
    else action = `corriger « ${excerpt} »`;
  } else {
    const actions = [];
    if (groups.translated.length) {
      actions.push(
        `traduire ${groups.translated.length} dialogue${groups.translated.length > 1 ? "s" : ""}`
      );
    }
    if (groups.corrected.length) {
      actions.push(
        `corriger ${groups.corrected.length} traduction${groups.corrected.length > 1 ? "s" : ""}`
      );
    }
    if (groups.restored.length) {
      actions.push(
        `rétablir ${groups.restored.length} texte${groups.restored.length > 1 ? "s" : ""}`
      );
    }
    action = actions.join(" et ") || "mettre à jour les traductions";
  }

  const counts = [];
  if (groups.translated.length) counts.push(`Nouvelles traductions : ${groups.translated.length}`);
  if (groups.corrected.length) counts.push(`Corrections : ${groups.corrected.length}`);
  if (groups.restored.length) counts.push(`Textes rétablis : ${groups.restored.length}`);
  const examples = keys.slice(0, 5).map((key) => {
    const english = compactDialogue(reference[key]?.en ?? before[key], 44);
    const french = compactDialogue(after[key], 44);
    return `- ${english || key} → ${french || "<texte supprimé>"}`;
  });
  if (keys.length > examples.length) {
    const remaining = keys.length - examples.length;
    examples.push(`- … et ${remaining} autre${remaining > 1 ? "s" : ""}`);
  }

  return {
    subject: `trad(ch${chapter}): ${title || action}`,
    body: description || [
      ...counts,
      ...(examples.length ? ["", "Dialogues concernés :", ...examples] : []),
    ].join("\n"),
  };
}

function loadTranslationReference(config) {
  const file = config.extractedDir ? path.join(config.extractedDir, "reference.json") : null;
  if (!file || !fs.existsSync(file)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && !Array.isArray(value) && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

async function loadRunedeltaReference(config, extractedReference = loadTranslationReference(config)) {
  if (config.storageMode !== "runedelta-json" || !config.runedelta?.directory) return extractedReference;
  const chapter = detectChapter(config);
  const source = `strings_og/chapter${chapter}.json`;
  const result = await git(["show", `refs/remotes/origin/main:${source}`], config.runedelta.directory, { allowFailure: true });
  if (result.code !== 0) {
    // Le dépôt fournit actuellement la VO du chapitre 5 uniquement.
    if (chapter !== 5) return extractedReference;
    throw new Error(`La référence anglaise main/${source} est indisponible. Récupère la branche main du dépôt Runedelta avant de recharger l’éditeur.`);
  }
  const original = parseLanguage(result.stdout, `VO Runedelta main/${source}`);
  const reference = { ...extractedReference };
  for (const [key, en] of Object.entries(original)) {
    if (key === "date") continue;
    reference[key] = { ...extractedReference[key], en, originalSource: `main/${source}` };
  }
  return reference;
}

function languageKeyFromJsonLine(line) {
  const match = String(line).match(/^\s*("(?:\\.|[^"\\])*")\s*:/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function githubName(author, email) {
  const match = String(email ?? "").match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
  return match?.[1] || author || "Auteur Git inconnu";
}

function parseGitBlamePorcelain(output) {
  const attributions = {};
  let current = null;
  for (const line of String(output).split(/\r?\n/)) {
    const header = line.match(/^([0-9a-f]{40,64})\s+\d+\s+(\d+)(?:\s+\d+)?$/i);
    if (header) {
      current = { commit: header[1], finalLine: Number(header[2]) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("author ")) current.author = line.slice(7);
    else if (line.startsWith("author-mail ")) {
      current.email = line.slice(12).replace(/^<|>$/g, "");
    } else if (line.startsWith("author-time ")) current.authorTime = Number(line.slice(12));
    else if (line.startsWith("summary ")) current.summary = line.slice(8);
    else if (line.startsWith("\t")) {
      const key = languageKeyFromJsonLine(line.slice(1));
      if (key && key !== "date") {
        attributions[key] = {
          name: githubName(current.author, current.email),
          author: current.author || "Auteur Git inconnu",
          commit: current.commit,
          summary: current.summary || "",
          timestamp: Number.isFinite(current.authorTime) ? current.authorTime * 1000 : null,
        };
      }
      current = null;
    }
  }
  return attributions;
}

function parseGitLanguageHistory(output) {
  const commits = [];
  for (const rawChunk of String(output).split("\x1e")) {
    const chunk = rawChunk.replace(/^\r?\n/, "");
    if (!chunk) continue;
    const newline = chunk.search(/\r?\n/);
    const metadata = (newline === -1 ? chunk : chunk.slice(0, newline)).split("\x1f");
    if (metadata.length < 5 || !/^[0-9a-f]{40,64}$/i.test(metadata[0])) continue;
    const addedKeys = new Set();
    const patch = newline === -1 ? "" : chunk.slice(newline).split(/\r?\n/);
    for (const line of patch) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const key = languageKeyFromJsonLine(line.slice(1));
      if (key && key !== "date") addedKeys.add(key);
    }
    commits.push({
      commit: metadata[0],
      author: metadata[1] || "Auteur Git inconnu",
      email: metadata[2] || "",
      authorTime: Number(metadata[3]),
      summary: metadata.slice(4).join("\x1f"),
      addedKeys: [...addedKeys],
    });
  }
  return commits;
}

function attributionsFromHistory(commits) {
  const chronological = [...commits].reverse();
  const initialCommit = chronological.find((commit) => commit.addedKeys.length > 0);
  const attributions = {};
  for (const commit of chronological) {
    if (commit === initialCommit) continue;
    const name = githubName(commit.author, commit.email);
    for (const key of commit.addedKeys) {
      const current = attributions[key] ?? { names: [], identities: new Set() };
      const identity = name.toLocaleLowerCase("fr");
      if (!current.identities.has(identity)) {
        current.identities.add(identity);
        current.names.push(name);
      }
      current.name = name;
      current.author = commit.author;
      current.commit = commit.commit;
      current.summary = commit.summary;
      current.timestamp = Number.isFinite(commit.authorTime) ? commit.authorTime * 1000 : null;
      attributions[key] = current;
    }
  }
  for (const attribution of Object.values(attributions)) delete attribution.identities;
  return attributions;
}

async function gitAvailable() {
  const result = await runCommand("git", ["--version"], { timeoutMs: 10_000 });
  return result.code === 0 ? result.stdout.trim() : null;
}

function repositoryExists(directory) {
  return Boolean(directory && fs.existsSync(path.join(directory, ".git")));
}

function validateRemoteUrl(remoteUrl) {
  const value = String(remoteUrl ?? "").trim();
  if (!value || /[\r\n\0]/.test(value)) throw new Error("L’URL du dépôt Git est invalide.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      throw new Error(
        "N’insère pas de token dans l’URL Git. Configure Git Credential Manager sur la machine."
      );
    }
  }
  return value;
}

async function ensureGitIdentity(directory, configured = null) {
  if (configured) {
    const name = String(configured.name ?? "").trim();
    const email = String(configured.email ?? "").trim();
    if (!name || !email || /[\r\n\0]/.test(name + email) || !email.includes("@")) {
      throw new Error("Renseigne ton nom et ton e-mail Git dans la configuration Runedelta.");
    }
    await git(["config", "--local", "user.name", name], directory);
    await git(["config", "--local", "user.email", email], directory);
  }
  const name = await git(["config", "--get", "user.name"], directory, { allowFailure: true });
  const email = await git(["config", "--get", "user.email"], directory, { allowFailure: true });
  if (!name.stdout.trim() || !email.stdout.trim() || name.stdout.trim() === "Traducteur Runedelta" || email.stdout.trim() === "deltatranslate@users.noreply.github.com") {
    throw new Error("Configure ton identité Git dans Runedelta avant de publier. La récupération seule reste disponible.");
  }
}

function projectBinding(config, remoteUrl, branch = config.runedelta?.branch ?? null) {
  return { chapter: detectChapter(config), remoteUrl, branch, target: identity(gameLanguagePath(config)), storage: usesGitCatalogue(config) ? "git" : "game",
    ...(usesGitCatalogue(config) ? { directory: config.runedelta?.directory ? identity(config.runedelta.directory) : null } : {}) };
}

function isRunedeltaProjectConnected(config) {
  if (config.runedelta?.modeEnabled !== true || !config.runedelta?.enabled || (config.targetLanguage ?? "fr") !== "fr" || !config.dataWinPath) return false;
  if (usesGitCatalogue(config) && (!config.runedelta.directory || config.storageMode !== "runedelta-json" ||
    !config.langFrPath || identity(config.langFrPath) !== identity(workingLanguagePath(config)))) return false;
  const binding = config.runedelta.projects?.[projectId(config)];
  const expected = projectBinding(config, config.runedelta.remoteUrl ?? DEFAULT_RUNEDDELTA_REMOTE);
  return Boolean(binding && Object.keys(expected).every(key => binding[key] === expected[key]));
}

function syncStatePath(config, directory, remoteUrl) {
  const key = createHash("sha256").update(JSON.stringify([projectId(config), projectBinding(config, remoteUrl)])).digest("hex");
  return path.join(directory, ".git", "deltatranslate", `${key}.json`);
}

function readSyncState(config, directory, remoteUrl, allowParked = false) {
  const file = syncStatePath(config, directory, remoteUrl);
  if (!fs.existsSync(file)) throw new Error("Cette installation doit être reconnectée à Runedelta pour établir sa référence de synchronisation. Son fichier actuel sera sauvegardé avant remplacement.");
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (state.version !== 1 || state.pending || (state.parked && !allowParked)) throw new Error("Une synchronisation a été interrompue. Reconnecte cette installation ; son catalogue sera sauvegardé avant remplacement.");
  validateLanguage(state.language, "référence de synchronisation");
  return state;
}

function writeGameAndState({ config, directory, remoteUrl, language, repositoryLanguage, serializeLanguage, backupFile, expected }) {
  const target = workingLanguagePath(config, directory);
  const serialized = serializeLanguage(language);
  assertRevision(target, expected);
  let saved = null;
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") !== serialized) {
    saved = backupFile?.(target, serialized);
    // Même sans callback (ou backups courants désactivés), aucun catalogue remplacé n'est perdu.
    if (!saved) saved = backup(path.join(directory, ".git", "deltatranslate-backups"), target, fs.readFileSync(target));
  }
  const file = syncStatePath(config, directory, remoteUrl);
  const state = { version: 1, language: repositoryLanguage };
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  const recovery = previous?.pending ? previous.recovery : previous && fs.existsSync(target)
    ? { content: fs.readFileSync(target, "utf8"), language: previous.language } : null;
  // Le marqueur interdit toute fusion avec une base ambiguë après une interruption entre les écritures.
  atomicWrite(file, JSON.stringify({ ...state, pending: true, recovery }), { json: true });
  atomicWrite(target, serialized, { json: true, expected });
  atomicWrite(file, JSON.stringify(state), { json: true });
  return saved;
}

async function ensureRepository(directory, remoteUrl = DEFAULT_RUNEDDELTA_REMOTE, branch = null) {
  remoteUrl = validateRemoteUrl(remoteUrl);
  const version = await gitAvailable();
  if (!version) {
    throw new Error("Git est introuvable. Installe Git puis relance DELTATRANSLATE.");
  }

  if (!repositoryExists(directory)) {
    if (fs.existsSync(directory) && fs.readdirSync(directory).length > 0) {
      throw new Error(`Le dossier Runedelta existe déjà mais n’est pas un dépôt Git : ${directory}`);
    }
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    await git(["clone", "--origin", "origin", ...(branch ? ["--branch", branch] : []), "--", remoteUrl, directory], path.dirname(directory), {
      timeoutMs: 300_000,
    });
  }

  const actualRemote = (await git(["remote", "get-url", "origin"], directory)).stdout.trim();
  if (actualRemote !== remoteUrl) {
    throw new Error(
      `Le dépôt local pointe déjà vers ${actualRemote}. Déconnecte-le ou utilise cette même URL.`
    );
  }
  return { directory, remoteUrl, version };
}

async function currentBranch(directory) {
  const branch = (await git(["branch", "--show-current"], directory)).stdout.trim();
  if (!branch) throw new Error("Le dépôt Runedelta n’est pas positionné sur une branche.");
  return branch;
}

function branchConfig(config, branch) {
  return { ...config, runedelta: { ...config.runedelta, branch } };
}

async function validateBranch(branch) {
  if (typeof branch !== "string" || branch.startsWith("-") || branch === "HEAD" || branch.startsWith("refs/") || /[\r\n\0]/.test(branch)) throw new Error("Nom de branche invalide.");
  const result = await git(["check-ref-format", `refs/heads/${branch}`], undefined, { allowFailure: true });
  if (result.code !== 0) throw new Error("Nom de branche invalide.");
}

async function listRunedeltaBranches(remoteUrl = DEFAULT_RUNEDDELTA_REMOTE, { details = false } = {}) {
  const remote = validateRemoteUrl(remoteUrl);
  const output = (await git(["ls-remote", "--symref", "--", remote, "HEAD", "refs/heads/*"], undefined, { timeoutMs: 30_000 })).stdout;
  const branches = [...output.matchAll(/^[0-9a-f]+\trefs\/heads\/(.+)$/gm)].map(match => match[1]).sort((a, b) => a.localeCompare(b));
  const defaultBranch = output.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1] ?? null;
  const result = { ok: true, branches, defaultBranch };
  if (!details || !branches.length) return result;

  // Le dépôt temporaire évite de toucher aux branches et aux brouillons du catalogue ouvert.
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "deltatranslate-branches-"));
  try {
    await git(["init", "--bare", directory]);
    await git(["fetch", "--depth=1", "--filter=tree:0", "--no-tags", "--", remote, "+refs/heads/*:refs/heads/*"], directory, { timeoutMs: 45_000 });
    const records = (await git(["for-each-ref", "--format=%(refname:strip=2)%00%(objectname)%00%(authorname)%00%(authoremail)%00%(committerdate:unix)%00%(subject)", "refs/heads/"], directory)).stdout;
    result.branchDetails = records.trimEnd().split("\n").filter(Boolean).map(record => {
      const [name, commit, author, email, timestamp, subject] = record.split("\0");
      return { name, commit, author, authorName: githubName(author, email.replace(/^<|>$/g, "")), timestamp: Number(timestamp) * 1000, subject };
    });
    result.branches = result.branchDetails.map(branch => branch.name).sort((a, b) => a.localeCompare(b));
    result.checkedAt = Date.now();
  } catch (error) {
    result.detailsError = `Les branches sont disponibles, mais leurs derniers commits n’ont pas pu être chargés : ${error.message}`;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  return result;
}

async function fetchRemote(directory, branch) {
  await validateBranch(branch);
  await git(["fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`], directory, { timeoutMs: 45_000 });
  const remoteRef = `origin/${branch}`;
  await git(["rev-parse", "--verify", remoteRef], directory);
  return remoteRef;
}

async function showLanguage(directory, ref, relativePath) {
  const result = await git(["show", `${ref}:${relativePath}`], directory);
  return parseLanguage(result.stdout, `${relativePath} (${ref})`);
}

async function languageAttributions(directory, relativePath, ref = "HEAD") {
  const result = await git(
    [
      "log",
      "--follow",
      "--format=%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%s",
      "-p",
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      ref,
      "--",
      relativePath,
    ],
    directory,
    { timeoutMs: 60_000 }
  );
  return attributionsFromHistory(parseGitLanguageHistory(result.stdout));
}

async function dirtyFiles(directory) {
  const output = (await git(["status", "--porcelain"], directory)).stdout.trimEnd();
  return output ? output.split(/\r?\n/).map((line) => line.slice(3)) : [];
}

async function aheadBehind(directory, remoteRef) {
  const result = await git(["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`], directory);
  const [ahead = 0, behind = 0] = result.stdout.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}

// Sprites du dépôt : sprites/<nom>.png (une frame) ou sprites/<nom>/<nom>_<N>.png.
const SPRITES_DIRECTORY = "sprites";

function gitBlobHash(content) {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

function spriteFrameFromPath(file) {
  const single = file.match(/^sprites\/([A-Za-z0-9_]+)\.png$/);
  if (single) return { name: single[1], frame: 0 };
  const multi = file.match(/^sprites\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)_(\d+)\.png$/);
  return multi && multi[1] === multi[2] ? { name: multi[1], frame: Number(multi[3]) } : null;
}

function parseSpriteTree(output) {
  const sprites = new Map();
  for (const record of String(output).split("\0")) {
    const match = record.match(/^\d+ blob ([0-9a-f]{40,64})\t(.+)$/);
    const frame = match && spriteFrameFromPath(match[2]);
    if (!frame) continue;
    if (!sprites.has(frame.name)) sprites.set(frame.name, new Map());
    const frames = sprites.get(frame.name);
    // Une frame 0 existe parfois sous les deux formes : le dossier, plus explicite, l'emporte.
    if (!frames.has(frame.frame) || match[2].includes(`/${frame.name}/`)) frames.set(frame.frame, { path: match[2], blob: match[1] });
  }
  return sprites;
}

// Lecture synchrone du commit local de la branche : jamais origin/main, jamais de réseau.
const spriteTreeCache = { key: null, value: null };
function branchSpritesSync(directory) {
  if (!repositoryExists(directory)) return null;
  const run = args => {
    const tool = commandEnvironment("git", { GIT_TERMINAL_PROMPT: "0" });
    const result = spawnSync(tool.command, args, { cwd: directory, env: tool.env, windowsHide: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error((result.stderr || "Lecture Git impossible.").trim());
    return result.stdout;
  };
  const head = run(["rev-parse", "HEAD"]).trim();
  const key = `${directory}|${head}`;
  if (spriteTreeCache.key !== key) {
    spriteTreeCache.value = parseSpriteTree(run(["ls-tree", "-r", "-z", head, "--", SPRITES_DIRECTORY]));
    spriteTreeCache.key = key;
  }
  return { head, sprites: spriteTreeCache.value };
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
    hasText: entry.hasText || frames.size > 0,
    translated: entry.translated || frames.size > 0,
  };
}

function readBranchSpriteSync(directory, file) {
  const tool = commandEnvironment("git", { GIT_TERMINAL_PROMPT: "0" });
  const result = spawnSync(tool.command, ["show", `HEAD:${file}`], { cwd: directory, env: tool.env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Impossible de lire ${file} dans la branche Runedelta.`);
  return result.stdout;
}

function spriteRepositoryPath(name, frame, frameCount, existing) {
  if (existing?.path) return existing.path;
  return frameCount <= 1 ? `${SPRITES_DIRECTORY}/${name}.png` : `${SPRITES_DIRECTORY}/${name}/${name}_${frame}.png`;
}

// Copie les PNG importés dans sprites/ et renvoie les chemins modifiés, pour le commit et une éventuelle annulation.
async function stageSprites(directory, sprites = []) {
  if (!sprites.length) return [];
  const tree = parseSpriteTree((await git(["ls-tree", "-r", "-z", "HEAD", "--", SPRITES_DIRECTORY], directory)).stdout);
  const changed = [];
  for (const sprite of sprites) {
    const content = fs.readFileSync(sprite.file);
    const existing = tree.get(sprite.name)?.get(sprite.frame);
    if (existing?.blob === gitBlobHash(content)) continue;
    const relative = spriteRepositoryPath(sprite.name, sprite.frame, sprite.frames, existing);
    atomicWrite(path.join(directory, ...relative.split("/")), content);
    changed.push({ path: relative, tracked: Boolean(existing) });
  }
  if (changed.length) await git(["add", "--", ...changed.map(item => item.path)], directory);
  return changed;
}

async function unstageSprites(directory, changed) {
  if (!changed.length) return;
  const tracked = changed.filter(item => item.tracked).map(item => item.path);
  const created = changed.filter(item => !item.tracked).map(item => item.path);
  if (tracked.length) await git(["restore", "--staged", "--worktree", "--source=HEAD", "--", ...tracked], directory, { allowFailure: true });
  if (created.length) await git(["rm", "--cached", "--quiet", "--ignore-unmatch", "--", ...created], directory, { allowFailure: true });
  for (const file of created) fs.rmSync(path.join(directory, ...file.split("/")), { force: true });
}

function spriteCommitMessage(message, changed) {
  if (!changed.length) return message;
  const count = changed.length;
  const sprites = `${count} frame${count > 1 ? "s" : ""} de sprite`;
  const files = ["", "Sprites :", ...changed.map(item => `- ${item.path}`)].join("\n");
  return message
    ? { subject: message.subject, body: `${message.body}${message.body ? "\n" : ""}${files}` }
    : { subject: `trad: publier ${sprites}`, body: files.trimStart() };
}

async function refExists(directory, ref) {
  return (await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], directory, { allowFailure: true })).code === 0;
}

async function isAncestor(directory, ancestor, descendant) {
  return (await git(["merge-base", "--is-ancestor", ancestor, descendant], directory, { allowFailure: true })).code === 0;
}

// origin/main n'est intégré que s'il contient le chapitre et n'est pas déjà dans l'historique de la branche.
async function mainIntegrationRef(directory, branch, relativePath, alreadyMerged = []) {
  const ref = `origin/${MAIN_BRANCH}`;
  if (branch === MAIN_BRANCH || !(await refExists(directory, ref))) return null;
  if ((await git(["cat-file", "-e", `${ref}:${relativePath}`], directory, { allowFailure: true })).code !== 0) return null;
  for (const head of ["HEAD", ...alreadyMerged]) if (await isAncestor(directory, ref, head)) return null;
  return ref;
}

function mergeMessage(ref, branch) {
  return ref === `origin/${MAIN_BRANCH}` ? ["-m", `Merge branch '${MAIN_BRANCH}' into ${branch}`] : [];
}

async function newestMergeBase(directory, heads, target) {
  let newest = null;
  for (const head of heads) {
    const result = await git(["merge-base", head, target], directory, { allowFailure: true });
    const base = result.stdout.trim();
    if (result.code !== 0 || !base) continue;
    if (!newest || await isAncestor(directory, newest, base)) newest = base;
  }
  if (!newest) throw new Error(`La branche et ${target} n’ont aucun historique commun.`);
  return newest;
}

function parsePullRequest(subject) {
  const match = String(subject).match(/^Merge pull request #(\d+) from [^/\s]+\/(\S+)/);
  return match ? { pr: Number(match[1]), from: match[2] } : null;
}

async function languageHistory(directory, relativePath, range, firstParent = false) {
  const result = await git([
    "log", ...(firstParent ? ["--first-parent", "--diff-merges=first-parent"] : []),
    "--format=%x1e%H%x1f%an%x1f%ae%x1f%ct%x1f%s", "-p", "--unified=0", "--no-color", "--no-ext-diff",
    range, "--", relativePath,
  ], directory, { timeoutMs: 60_000 });
  return parseGitLanguageHistory(result.stdout);
}

// Du plus récent au plus ancien : le premier commit qui écrit une clé est celui de sa valeur actuelle.
function latestChanges(commits) {
  const latest = new Map();
  for (const commit of commits) {
    for (const key of commit.addedKeys) if (!latest.has(key)) latest.set(key, commit);
  }
  return latest;
}

function publicationEvent(commit) {
  if (!commit) return null;
  return {
    commit: commit.commit,
    at: Number.isFinite(commit.authorTime) ? commit.authorTime * 1000 : null,
    by: githubName(commit.author, commit.email),
    summary: commit.summary,
    ...parsePullRequest(commit.summary),
  };
}

function classifyPublication({ local, main, mainBase, pushed, original = {} }) {
  const keys = {};
  const counts = { published: 0, pushed: 0, local: 0, incoming: 0 };
  for (const key of new Set([...Object.keys(local), ...Object.keys(main)])) {
    if (key === "date") continue;
    const value = Object.hasOwn(local, key) ? local[key] : undefined;
    const mainValue = Object.hasOwn(main, key) ? main[key] : undefined;
    const baseValue = Object.hasOwn(mainBase, key) ? mainBase[key] : undefined;
    const mainChanged = mainValue !== baseValue;
    let state;
    if (value === mainValue) {
      if (!mainChanged && value === original[key]) continue;
      state = "published";
    } else if (value === baseValue && mainChanged) state = "incoming";
    else if (Object.hasOwn(pushed, key) && pushed[key] === value) state = "pushed";
    else state = "local";
    keys[key] = { state, ...(state !== "published" && state !== "incoming" && mainChanged ? { mainChanged: true } : {}) };
    counts[state]++;
  }
  return { keys, counts };
}

async function runedeltaPublication(config, directory, { fetch = false } = {}) {
  const chapter = detectChapter(config);
  const relativePath = languageRelativePath(chapter);
  const branch = await currentBranch(directory);
  const branchRef = `origin/${branch}`;
  const mainRef = `origin/${MAIN_BRANCH}`;
  let fetchError = null;
  if (fetch) {
    try {
      await fetchRemote(directory, branch);
      if (branch !== MAIN_BRANCH) await fetchRemote(directory, MAIN_BRANCH);
    } catch (error) { fetchError = error.message; }
  }
  if (!(await refExists(directory, mainRef))) {
    return { ok: false, branch, fetchError, error: "La branche main de Runedelta n’a pas encore été récupérée." };
  }
  const readRef = async ref => {
    const result = await git(["show", `${ref}:${relativePath}`], directory, { allowFailure: true });
    return result.code === 0 ? parseLanguage(result.stdout, `${relativePath} (${ref})`) : {};
  };
  const local = readLanguage(workingLanguagePath(config, directory), "catalogue de travail");
  const main = await readRef(mainRef);
  const hasBranchRef = await refExists(directory, branchRef);
  const pushed = hasBranchRef ? await readRef(branchRef) : {};
  const mainBase = await readRef(await newestMergeBase(directory, hasBranchRef ? ["HEAD", branchRef] : ["HEAD"], mainRef));
  const originalResult = await git(["show", `${mainRef}:strings_og/chapter${chapter}.json`], directory, { allowFailure: true });
  const original = Object.fromEntries(Object.entries(loadTranslationReference(config)).map(([key, entry]) => [key, entry?.en]));
  if (originalResult.code === 0) Object.assign(original, parseLanguage(originalResult.stdout, "VO Runedelta"));
  const { keys, counts } = classifyPublication({ local, main, mainBase, pushed, original });

  const mainCommits = await languageHistory(directory, relativePath, mainRef, true);
  const mainLatest = latestChanges(mainCommits);
  const branchCommits = hasBranchRef && branch !== MAIN_BRANCH
    ? await languageHistory(directory, relativePath, `${mainRef}..${branchRef}`) : [];
  const branchLatest = latestChanges(branchCommits);
  for (const [key, info] of Object.entries(keys)) {
    const event = info.state === "published" ? mainLatest.get(key)
      : info.state === "pushed" ? branchLatest.get(key)
        : info.state === "incoming" ? mainLatest.get(key) : null;
    if (event) info.event = publicationEvent(event);
  }

  const unpushed = hasBranchRef
    ? Number((await git(["rev-list", "--count", `${branchRef}..HEAD`], directory)).stdout.trim()) : 0;
  return {
    ok: true,
    chapter,
    branch,
    fetchError,
    checkedAt: Date.now(),
    counts,
    keys,
    unpushedCommits: unpushed,
    mainHead: publicationEvent(mainCommits[0]),
    // Journal des publications : chaque entrée du premier parent de main est une PR fusionnée ou un commit direct.
    releases: mainCommits.slice(0, 40).map(commit => ({ ...publicationEvent(commit), lines: commit.addedKeys.length })),
    waiting: branchCommits.slice(0, 40).map(commit => ({ ...publicationEvent(commit), lines: commit.addedKeys.length })),
  };
}

async function installRunedelta(options) {
  if (usesGitCatalogue(options.config)) return installGitCatalogue(options);
  const { config, directory, remoteUrl = DEFAULT_RUNEDDELTA_REMOTE, serializeLanguage, backupFile, branch: requestedBranch = null } = options;
  const targetPath = gameLanguagePath(config);
  const targetRevision = revision(targetPath);
  const chapter = detectChapter(config);
  const relativePath = languageRelativePath(chapter);
  if (requestedBranch) await validateBranch(requestedBranch);
  await ensureRepository(directory, remoteUrl);
  const dirty = await dirtyFiles(directory);
  if (dirty.length) throw new Error(`Le dépôt Runedelta contient des modifications non commitées :\n${dirty.join("\n")}`);
  const previousBranch = await currentBranch(directory);
  const branch = requestedBranch || config.runedelta?.branch || previousBranch;
  const scoped = branchConfig(config, branch);
  const remoteRef = await fetchRemote(directory, branch);
  await showLanguage(directory, remoteRef, relativePath);
  const changing = branch !== previousBranch;
  let previousState = null;
  const previousConfig = branchConfig(config, previousBranch);
  const previousFile = syncStatePath(previousConfig, directory, remoteUrl);
  if (changing && fs.existsSync(previousFile) && (!config.runedelta?.branch || config.runedelta.branch === previousBranch)) {
    previousState = readSyncState(previousConfig, directory, remoteUrl);
    assertRevision(targetPath, targetRevision);
    const parkedLanguage = readLanguage(targetPath);
    atomicWrite(previousFile, JSON.stringify({ ...previousState, parked: true, parkedLanguage }), { json: true });
  }
  try {
    if (changing) {
      const exists = await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], directory, { allowFailure: true });
      if (exists.code === 0) await git(["switch", "--", branch], directory);
      else await git(["switch", "--track", "-c", branch, remoteRef], directory);
    }
    let parked = null;
    const stateFile = syncStatePath(scoped, directory, remoteUrl);
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (state.parked && !state.pending) parked = readSyncState(scoped, directory, remoteUrl, true);
    }
    const ff = await git(["merge", "--ff-only", remoteRef], directory, { allowFailure: true });
    if (ff.code !== 0 && !parked) throw new Error("Cette branche et GitHub ont divergé. Reviens à sa session de traduction pour résoudre la fusion avant de la réinstaller.");
    const sourcePath = path.join(directory, ...relativePath.split("/"));
    const repositoryLanguage = parked?.language ?? readLanguage(sourcePath, `Runedelta chapitre ${chapter}`);
    const language = parked ? validateLanguage(parked.parkedLanguage, "travail de la branche") : repositoryLanguage;
    const saved = writeGameAndState({ config: scoped, directory, remoteUrl, language, repositoryLanguage, serializeLanguage, backupFile, expected: targetRevision });
    let attributions = {}, attributionError = null;
    try { attributions = await languageAttributions(directory, relativePath); }
    catch (error) { attributionError = error.message; }
    return { ok: true, chapter, branch, sourcePath, targetPath, language, attributions, attributionError, restored: Boolean(parked), backupCreated: Boolean(saved) };
  } catch (error) {
    if (changing) await git(["switch", "--", previousBranch], directory, { allowFailure: true });
    if (previousState && revision(targetPath) === targetRevision) atomicWrite(previousFile, JSON.stringify(previousState), { json: true });
    throw error;
  }
}

async function installGitCatalogue(options) {
  const { config, remoteUrl = DEFAULT_RUNEDDELTA_REMOTE, serializeLanguage, backupFile } = options;
  const branch = options.branch || config.runedelta?.branch || (await listRunedeltaBranches(remoteUrl)).defaultBranch;
  await validateBranch(branch);
  const chapter = detectChapter(config);
  const relativePath = languageRelativePath(chapter);
  const baseDirectory = config.runedelta?.baseDirectory ?? options.directory;
  // Un clone par installation, chapitre et branche conserve les brouillons sans stash ni changement de branche destructif.
  const key = createHash("sha256").update(JSON.stringify([projectId(config), chapter, remoteUrl, branch])).digest("hex");
  const directory = path.join(`${baseDirectory}-catalogues`, key);
  const existed = repositoryExists(directory);
  await ensureRepository(directory, remoteUrl, branch);
  const actualBranch = await currentBranch(directory);
  if (actualBranch !== branch) {
    if (existed) throw new Error("La branche de cet espace de travail a été modifiée hors de l’application. Rétablis-la dans Git avant de reconnecter.");
    const remoteRef = await fetchRemote(directory, branch);
    await showLanguage(directory, remoteRef, relativePath);
    await git(["switch", "--track", "-c", branch, remoteRef], directory);
  }
  const scoped = { ...config, runedelta: { ...config.runedelta, storage: "git", directory, baseDirectory, branch } };
  const targetPath = workingLanguagePath(scoped, directory);
  const stateFile = syncStatePath(scoped, directory, remoteUrl);
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state.pending && state.recovery) {
      const content = state.recovery.content;
      parseLanguage(content, "brouillon interrompu");
      validateLanguage(state.recovery.language, "référence du brouillon interrompu");
      if (fs.existsSync(path.join(directory, ".git", "MERGE_HEAD"))) await git(["merge", "--abort"], directory);
      const staged = (await git(["diff", "--cached", "--name-only"], directory)).stdout.trim().split(/\r?\n/).filter(Boolean);
      if (staged.some(file => file !== relativePath)) throw new Error("Une publication a été interrompue et l’index Git contient d’autres fichiers. Conserve-les avant de reprendre le brouillon.");
      const expected = revision(targetPath);
      if (fs.existsSync(targetPath)) backupFile?.(targetPath, content) || backup(path.join(directory, ".git", "deltatranslate-backups"), targetPath, fs.readFileSync(targetPath));
      atomicWrite(targetPath, content, { json: true, expected });
      await git(["restore", "--staged", "--", relativePath], directory);
      atomicWrite(stateFile, JSON.stringify({ version: 1, language: state.recovery.language }), { json: true });
    }
    readSyncState(scoped, directory, remoteUrl);
  }
  else {
    if ((await dirtyFiles(directory)).length) throw new Error("Ce clone contient du travail sans référence de synchronisation. Conserve-le avant de reconnecter.");
    await git(["merge", "--ff-only", await fetchRemote(directory, branch)], directory);
    const language = await showLanguage(directory, "HEAD", relativePath);
    atomicWrite(stateFile, JSON.stringify({ version: 1, language }), { json: true });
  }
  const language = readLanguage(targetPath);
  let attributions = {}, attributionError = null;
  try { attributions = await languageAttributions(directory, relativePath); }
  catch (error) { attributionError = error.message; }
  return { ok: true, chapter, branch, directory, baseDirectory, sourcePath: targetPath, targetPath, language,
    attributions, attributionError, restored: existed, backupCreated: false,
    ...copyRunedeltaToGame(scoped, language, serializeLanguage, backupFile) };
}

async function resolveMergeConflict(directory, relativePath, mergedContent, mergeResult = null, message = null) {
  const unmergedResult = await git(["ls-files", "--unmerged", "--full-name", "-z"], directory, { allowFailure: true });
  const unmerged = [...new Set(unmergedResult.stdout.split("\0").filter(Boolean)
    .map((line) => line.slice(line.indexOf("\t") + 1)).filter(Boolean))];
  if (!unmerged.length) {
    const fallback = await git(["diff", "--name-only", "--diff-filter=U"], directory, { allowFailure: true });
    unmerged.push(...fallback.stdout.trim().split(/\r?\n/).filter(Boolean));
  }
  if (unmerged.length !== 1 || unmerged[0].replace(/\\/g, "/") !== relativePath) {
    await git(["merge", "--abort"], directory, { allowFailure: true });
    const detail = (mergeResult?.stderr || mergeResult?.stdout || "").trim();
    throw new Error(
      `Git a détecté des conflits hors du fichier de traduction :\n${unmerged.join("\n") || "conflit inconnu"}${detail ? `\n${detail}` : ""}`
    );
  }

  const sourcePath = path.join(directory, ...relativePath.split("/"));
  atomicWrite(sourcePath, mergedContent, { json: true });
  await git(["add", "--", relativePath], directory);
  await git(message ? ["commit", "-m", message.subject, "-m", message.body] : ["commit", "--no-edit"], directory);
}

async function synchronizeRunedelta(options) {
  const {
    config,
    directory,
    remoteUrl = DEFAULT_RUNEDDELTA_REMOTE,
    serializeLanguage,
    backupFile,
    language: suppliedLanguage = null,
    push = false,
    receiveOnly = false,
    conflictResolution = null,
    commitMessage = null,
  } = options;
  const targetPath = workingLanguagePath(config, directory);
  const targetRevision = revision(targetPath);
  const chapter = detectChapter(config);
  const relativePath = languageRelativePath(chapter);
  await ensureRepository(directory, remoteUrl);
  const dirty = await dirtyFiles(directory);
  if (dirty.some(file => !usesGitCatalogue(config) || file !== relativePath)) {
    throw new Error(`Le dépôt Runedelta contient des modifications non commitées :\n${dirty.join("\n")}`);
  }

  const branch = await currentBranch(directory);
  if (config.runedelta?.branch && branch !== config.runedelta.branch) throw new Error("La branche Git a changé hors de l’application. Reconnecte la branche choisie avant de synchroniser.");
  const scoped = branchConfig(config, branch);
  const state = readSyncState(scoped, directory, remoteUrl);
  if (usesGitCatalogue(config)) {
    const staged = await git(["diff", "--cached", "--quiet"], directory, { allowFailure: true });
    if (staged.code !== 0) throw new Error("Le dépôt contient des changements préparés dans Git. Termine ou annule leur préparation avant de synchroniser.");
  }
  let remoteRef;
  let networkError = null;
  try {
    remoteRef = await fetchRemote(directory, branch);
    if (branch !== MAIN_BRANCH) await fetchRemote(directory, MAIN_BRANCH).catch(() => {});
  } catch (error) {
    if (receiveOnly) throw new Error(`Récupération impossible : ${error.message}`);
    networkError = error.message;
    remoteRef = `origin/${branch}`;
    const cachedRemote = await git(["rev-parse", "--verify", remoteRef], directory, {
      allowFailure: true,
    });
    if (cachedRemote.code !== 0) remoteRef = "HEAD";
  }
  const translationReference = await loadRunedeltaReference(config);
  const mergeBase = (await git(["merge-base", "HEAD", remoteRef], directory)).stdout.trim();
  const baseLanguage = await showLanguage(directory, mergeBase, relativePath);
  const headLanguage = await showLanguage(directory, "HEAD", relativePath);
  const remoteLanguage = await showLanguage(directory, remoteRef, relativePath);
  const gameLanguage = suppliedLanguage
    ? validateLanguage(suppliedLanguage, "traductions de l’éditeur")
    : fs.existsSync(targetPath)
      ? readLanguage(targetPath, "lang_fr.json du jeu")
      : headLanguage;

  const resolutionFor = phase => conflictResolution && typeof conflictResolution === "object" &&
    ["repository", "main", "workspace"].some(key => Object.hasOwn(conflictResolution, key))
    ? conflictResolution[phase] : conflictResolution;
  const repositoryMerge = mergeLanguages(baseLanguage, headLanguage, remoteLanguage, resolutionFor("repository"));
  if (repositoryMerge.conflicts.length) {
    return { ok: false, conflict: true, ...repositoryMerge, phase: "repository" };
  }
  // Les PR fusionnées dans main sont intégrées à la branche, comme « Merge branch 'main' » sur GitHub.
  const mainRef = await mainIntegrationRef(directory, branch, relativePath, [remoteRef]);
  if (mainRef) {
    const mainBase = await newestMergeBase(directory, ["HEAD", remoteRef], mainRef);
    const mainMerge = mergeLanguages(await showLanguage(directory, mainBase, relativePath), repositoryMerge.language,
      await showLanguage(directory, mainRef, relativePath), resolutionFor("main"));
    if (mainMerge.conflicts.length) return { ok: false, conflict: true, ...mainMerge, phase: "main" };
    repositoryMerge.language = mainMerge.language;
  }
  const finalMerge = mergeLanguages(state.language, gameLanguage, repositoryMerge.language, resolutionFor("workspace"));
  if (finalMerge.conflicts.length) {
    return { ok: false, conflict: true, ...finalMerge, phase: "workspace" };
  }

  const language = validateLanguage(finalMerge.language, "fusion Runedelta");
  const serialized = serializeLanguage(language);
  assertRevision(targetPath, targetRevision);
  if (receiveOnly) {
    const backup = writeGameAndState({ config: scoped, directory, remoteUrl, language, repositoryLanguage: repositoryMerge.language, serializeLanguage, backupFile, expected: targetRevision });
    let attributions = {};
    try { attributions = await languageAttributions(directory, relativePath, remoteRef); } catch {}
    return { ok: true, chapter, branch, targetPath, language, attributions, committed: false, pushed: false,
      received: true, backupCreated: Boolean(backup), remoteChanges: countDifferences(gameLanguage, language),
      ...copyRunedeltaToGame(scoped, language, serializeLanguage, backupFile) };
  }
  await ensureGitIdentity(directory, config.runedelta?.identity);
  if (usesGitCatalogue(config)) {
    return publishGitCatalogue({ ...options, config: scoped, remoteUrl, targetPath, targetRevision, relativePath,
      chapter, branch, state, headLanguage, remoteLanguage, gameLanguage, language, serialized, remoteRef, mainRef, networkError, translationReference });
  }
  for (const ref of [remoteRef, mainRef].filter(Boolean)) {
    const mergeResult = await git(["merge", "--no-edit", ...mergeMessage(ref, branch), ref], directory, {
      allowFailure: true,
    });
    if (mergeResult.code !== 0) {
      await resolveMergeConflict(directory, relativePath, serialized, mergeResult,
        commitMessage ? buildTranslationCommitMessage(chapter, headLanguage, language, translationReference, commitMessage) : null);
    }
  }

  const sourcePath = path.join(directory, ...relativePath.split("/"));
  const repositoryLanguage = readLanguage(sourcePath, `Runedelta chapitre ${chapter}`);
  atomicWrite(sourcePath, serialized, { json: true });
  await git(["add", "--", relativePath], directory);
  const staged = await git(["diff", "--cached", "--quiet", "--", relativePath], directory, {
    allowFailure: true,
  });
  let committed = false;
  if (staged.code === 1) {
    const message = buildTranslationCommitMessage(
      chapter,
      repositoryLanguage,
      language,
      translationReference,
      commitMessage
    );
    const commit = await git(
      ["commit", "-m", message.subject, "-m", message.body, "--", relativePath],
      directory,
      { allowFailure: true }
    );
    if (commit.code !== 0) {
      atomicWrite(sourcePath, serializeLanguage(repositoryLanguage), { json: true });
      await git(["add", "--", relativePath], directory, { allowFailure: true });
      throw new Error((commit.stderr || commit.stdout || "Le commit Git a échoué.").trim());
    }
    committed = true;
  } else if (staged.code !== 0) {
    throw new Error((staged.stderr || "Impossible de vérifier les changements Git.").trim());
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const backup = writeGameAndState({ config: scoped, directory, remoteUrl, language, repositoryLanguage: language, serializeLanguage, backupFile, expected: targetRevision });

  let pushError = networkError;
  if (push && !networkError) {
    const pushed = await git(["push", "origin", branch], directory, {
      allowFailure: true,
      timeoutMs: 60_000,
    });
    if (pushed.code !== 0) {
      pushError = (pushed.stderr || pushed.stdout || "Publication refusée.").trim();
    }
  }
  const remoteChanges = countDifferences(gameLanguage, language);
  const localChanges = countDifferences(remoteLanguage, language);
  const relation = await aheadBehind(directory, remoteRef);
  let attributions = {};
  let attributionError = null;
  try {
    attributions = await languageAttributions(directory, relativePath);
  } catch (error) {
    attributionError = error.message;
  }

  return {
    ok: true,
    chapter,
    branch,
    sourcePath,
    targetPath,
    language,
    attributions,
    attributionError,
    committed,
    pushed: push && !pushError,
    pushError,
    backupCreated: Boolean(backup),
    remoteChanges,
    localChanges,
    ...relation,
  };
}

async function publishGitCatalogue(options) {
  const { config, directory, remoteUrl, targetPath, targetRevision, relativePath, chapter, branch, state,
    headLanguage, remoteLanguage, gameLanguage, language, serialized, remoteRef, networkError,
    serializeLanguage, backupFile, translationReference, push = false, commitMessage = null, mainRef = null, sprites = [] } = options;
  assertRevision(targetPath, targetRevision);
  const original = fs.readFileSync(targetPath);
  const saved = backupFile?.(targetPath, serializeLanguage(headLanguage)) ||
    backup(path.join(directory, ".git", "deltatranslate-backups"), targetPath, original);
  const stateFile = syncStatePath(config, directory, remoteUrl);
  let committed = false;
  let spriteChanges = [];
  // La copie obligatoire et le marqueur restent disponibles même si le processus s'arrête pendant Git.
  atomicWrite(stateFile, JSON.stringify({ ...state, pending: true, recovery: { content: original.toString("utf8"), language: state.language } }), { json: true });
  try {
    // Le catalogue est le seul fichier suivi autorisé à être brouillonné ; reset le réécrit avec les filtres Git, notamment CRLF sous Windows.
    await git(["reset", "--hard", "HEAD"], directory);
    for (const ref of [remoteRef, mainRef].filter(Boolean)) {
      const merge = await git(["merge", "--no-edit", ...mergeMessage(ref, branch), ref], directory, { allowFailure: true });
      if (merge.code !== 0) await resolveMergeConflict(directory, relativePath, serialized, merge,
        commitMessage ? buildTranslationCommitMessage(chapter, headLanguage, language, translationReference, commitMessage) : null);
    }
    const before = readLanguage(targetPath);
    atomicWrite(targetPath, serialized, { json: true });
    await git(["add", "--", relativePath], directory);
    spriteChanges = await stageSprites(directory, sprites);
    const paths = [relativePath, ...spriteChanges.map(item => item.path)];
    const staged = await git(["diff", "--cached", "--quiet", "--", relativePath], directory, { allowFailure: true });
    if (staged.code === 1 || spriteChanges.length) {
      const text = staged.code === 1 ? buildTranslationCommitMessage(chapter, before, language, translationReference, commitMessage) : null;
      const custom = !text && (commitMessage?.title || commitMessage?.description)
        ? { subject: `trad(ch${chapter}): ${commitMessage.title || "publier des sprites"}`, body: commitMessage.description || "" } : text;
      const message = spriteCommitMessage(custom, spriteChanges);
      await git(["commit", "-m", message.subject, ...(message.body ? ["-m", message.body] : []), "--", ...paths], directory);
      committed = true;
    } else if (staged.code !== 0) throw new Error("Impossible de vérifier les changements préparés pour la publication.");
    writeGameAndState({ config, directory, remoteUrl, language, repositoryLanguage: language,
      serializeLanguage, backupFile, expected: revision(targetPath) });
  } catch (error) {
    await git(["merge", "--abort"], directory, { allowFailure: true });
    atomicWrite(targetPath, original, { json: true });
    await git(["restore", "--staged", "--", relativePath], directory, { allowFailure: true });
    await unstageSprites(directory, spriteChanges);
    atomicWrite(stateFile, JSON.stringify(state), { json: true });
    throw error;
  }
  let pushError = networkError;
  if (push && !networkError) {
    const result = await git(["push", "origin", branch], directory, { allowFailure: true, timeoutMs: 60_000 });
    if (result.code !== 0) pushError = (result.stderr || result.stdout || "Publication refusée.").trim();
  }
  let attributions = {}, attributionError = null;
  try { attributions = await languageAttributions(directory, relativePath); }
  catch (error) { attributionError = error.message; }
  return { ok: true, chapter, branch, sourcePath: targetPath, targetPath, language, attributions, attributionError,
    committed, spritesPublished: spriteChanges.length, pushed: push && !pushError, pushError, backupCreated: Boolean(saved),
    remoteChanges: countDifferences(gameLanguage, language), localChanges: countDifferences(remoteLanguage, language),
    ...await aheadBehind(directory, remoteRef), ...copyRunedeltaToGame(config, language, serializeLanguage, backupFile) };
}

async function runedeltaStatus(config, directory, remoteUrl = DEFAULT_RUNEDDELTA_REMOTE) {
  if (config.runedelta?.modeEnabled !== true) return { enabled: false, configured: false };
  const version = await gitAvailable();
  const chapter = detectChapter(config);
  const configured = Boolean(config.runedelta?.enabled);
  const enabled = isRunedeltaProjectConnected(config);
  const status = {
    enabled,
    configured,
    available: Boolean(version),
    version,
    chapter,
    directory,
    remoteUrl,
    connected: repositoryExists(directory),
  };
  if (!status.connected) return status;

  try {
    let state = null;
    status.branch = await currentBranch(directory);
    if (config.runedelta?.branch && status.branch !== config.runedelta.branch) { status.enabled = false; throw new Error("La branche du clone a changé. Reconnecte la branche choisie."); }
    if (enabled) {
      try { state = readSyncState(branchConfig(config, status.branch), directory, remoteUrl); }
      catch (error) { status.enabled = false; throw error; }
    }
    status.branch = await currentBranch(directory);
    status.dirtyFiles = (await dirtyFiles(directory)).filter(file => !usesGitCatalogue(config) || file !== languageRelativePath(chapter));
    const remoteRef = `origin/${status.branch}`;
    const verified = await git(["rev-parse", "--verify", remoteRef], directory, {
      allowFailure: true,
    });
    if (verified.code === 0) Object.assign(status, await aheadBehind(directory, remoteRef));
    status.sourcePath = chapter
      ? path.join(directory, ...languageRelativePath(chapter).split("/"))
      : null;
    const targetPath = config.dataWinPath ? workingLanguagePath(config, directory) : null;
    status.targetPath = targetPath;
    if (
      enabled &&
      status.sourcePath &&
      fs.existsSync(status.sourcePath) &&
      targetPath &&
      fs.existsSync(targetPath)
    ) {
      status.unpublishedChanges = countDifferences(
        state.language,
        readLanguage(targetPath, "lang_fr.json du jeu")
      );
      if (verified.code === 0) {
        const relative = languageRelativePath(chapter);
        const base = (await git(["merge-base", "HEAD", remoteRef], directory)).stdout.trim();
        const known = mergeLanguages(await showLanguage(directory, base, relative),
          await showLanguage(directory, "HEAD", relative), await showLanguage(directory, remoteRef, relative));
        let conflicts = known.conflicts.length;
        const mainRef = conflicts ? null : await mainIntegrationRef(directory, status.branch, relative, [remoteRef]);
        if (mainRef) {
          const mainBase = await newestMergeBase(directory, ["HEAD", remoteRef], mainRef);
          const withMain = mergeLanguages(await showLanguage(directory, mainBase, relative), known.language, await showLanguage(directory, mainRef, relative));
          conflicts = withMain.conflicts.length;
          known.language = withMain.language;
        }
        status.incomingChanges = conflicts || countDifferences(state.language, known.language);
      }
    }
  } catch (error) {
    status.error = error.message;
  }
  return status;
}

module.exports = {
  DEFAULT_RUNEDDELTA_REMOTE,
  runCommand,
  loadRunedeltaReference,
  assertRunedeltaWorkingFile,
  copyRunedeltaToGame,
  workingLanguagePath,
  listRunedeltaBranches,
  projectBinding,
  isRunedeltaProjectConnected,
  buildTranslationCommitMessage,
  countDifferences,
  detectChapter,
  gameLanguagePath,
  gitAvailable,
  installRunedelta,
  languageRelativePath,
  languageAttributions,
  mergeLanguages,
  attributionsFromHistory,
  parseGitBlamePorcelain,
  parseGitLanguageHistory,
  runedeltaStatus,
  runedeltaPublication,
  classifyPublication,
  branchSpritesSync,
  annotateRunedeltaSprite,
  readBranchSpriteSync,
  gitBlobHash,
  parseSpriteTree,
  parsePullRequest,
  synchronizeRunedelta,
  validateLanguage,
};
