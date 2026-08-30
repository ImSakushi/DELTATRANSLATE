const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_RUNEDDELTA_REMOTE = "https://github.com/Traducteurs-Aurifiques/Runedelta.git";
const GIT_TIMEOUT_MS = 120_000;
const MISSING = Symbol("missing");

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
    }, options.timeoutMs ?? GIT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
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
      if (conflictResolution === "local") chosen = localValue;
      else if (conflictResolution === "remote") chosen = remoteValue;
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

async function ensureGitIdentity(directory) {
  const name = await git(["config", "--get", "user.name"], directory, { allowFailure: true });
  const email = await git(["config", "--get", "user.email"], directory, { allowFailure: true });
  if (!name.stdout.trim()) {
    await git(["config", "user.name", "Traducteur Runedelta"], directory);
  }
  if (!email.stdout.trim()) {
    await git(["config", "user.email", "deltatranslate@users.noreply.github.com"], directory);
  }
}

async function ensureRepository(directory, remoteUrl = DEFAULT_RUNEDDELTA_REMOTE) {
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
    await git(["clone", "--origin", "origin", "--", remoteUrl, directory], path.dirname(directory), {
      timeoutMs: 300_000,
    });
  }

  const actualRemote = (await git(["remote", "get-url", "origin"], directory)).stdout.trim();
  if (actualRemote !== remoteUrl) {
    throw new Error(
      `Le dépôt local pointe déjà vers ${actualRemote}. Déconnecte-le ou utilise cette même URL.`
    );
  }
  await ensureGitIdentity(directory);
  return { directory, remoteUrl, version };
}

async function currentBranch(directory) {
  const branch = (await git(["branch", "--show-current"], directory)).stdout.trim();
  if (!branch) throw new Error("Le dépôt Runedelta n’est pas positionné sur une branche.");
  return branch;
}

async function fetchRemote(directory, branch) {
  await git(["fetch", "origin", branch], directory, { timeoutMs: 45_000 });
  const remoteRef = `origin/${branch}`;
  await git(["rev-parse", "--verify", remoteRef], directory);
  return remoteRef;
}

async function showLanguage(directory, ref, relativePath) {
  const result = await git(["show", `${ref}:${relativePath}`], directory);
  return parseLanguage(result.stdout, `${relativePath} (${ref})`);
}

async function languageAttributions(directory, relativePath, ref = "HEAD") {
  const result = await git(["blame", "--line-porcelain", ref, "--", relativePath], directory);
  return parseGitBlamePorcelain(result.stdout);
}

async function dirtyFiles(directory) {
  const output = (await git(["status", "--porcelain"], directory)).stdout.trim();
  return output ? output.split(/\r?\n/).map((line) => line.slice(3)) : [];
}

async function aheadBehind(directory, remoteRef) {
  const result = await git(["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`], directory);
  const [ahead = 0, behind = 0] = result.stdout.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}

async function installRunedelta(options) {
  const {
    config,
    directory,
    remoteUrl = DEFAULT_RUNEDDELTA_REMOTE,
    serializeLanguage,
    backupFile,
  } = options;
  const chapter = detectChapter(config);
  const relativePath = languageRelativePath(chapter);
  await ensureRepository(directory, remoteUrl);
  const dirty = await dirtyFiles(directory);
  if (dirty.length) {
    throw new Error(`Le dépôt Runedelta contient des modifications non commitées :\n${dirty.join("\n")}`);
  }

  const branch = await currentBranch(directory);
  const remoteRef = await fetchRemote(directory, branch);
  const ff = await git(["merge", "--ff-only", remoteRef], directory, { allowFailure: true });
  if (ff.code !== 0) {
    throw new Error(
      "Le dépôt Runedelta local et GitHub ont divergé. Termine d’abord la synchronisation avec Git, puis réessaie."
    );
  }

  const sourcePath = path.join(directory, ...relativePath.split("/"));
  const language = readLanguage(sourcePath, `Runedelta chapitre ${chapter}`);
  const targetPath = gameLanguagePath(config);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const serialized = serializeLanguage(language);
  const backup = backupFile(targetPath, serialized);
  fs.writeFileSync(targetPath, serialized, "utf8");
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
    backupCreated: Boolean(backup),
  };
}

async function resolveMergeConflict(directory, relativePath, mergedContent) {
  const unmergedResult = await git(
    ["diff", "--name-only", "--diff-filter=U"],
    directory,
    { allowFailure: true }
  );
  const unmerged = unmergedResult.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (unmerged.length !== 1 || unmerged[0].replace(/\\/g, "/") !== relativePath) {
    await git(["merge", "--abort"], directory, { allowFailure: true });
    throw new Error(
      `Git a détecté des conflits hors du fichier de traduction :\n${unmerged.join("\n") || "conflit inconnu"}`
    );
  }

  const sourcePath = path.join(directory, ...relativePath.split("/"));
  fs.writeFileSync(sourcePath, mergedContent, "utf8");
  await git(["add", "--", relativePath], directory);
  await git(["commit", "--no-edit"], directory);
}

async function synchronizeRunedelta(options) {
  const {
    config,
    directory,
    remoteUrl = DEFAULT_RUNEDDELTA_REMOTE,
    serializeLanguage,
    backupFile,
    language: suppliedLanguage = null,
    push = true,
    conflictResolution = null,
  } = options;
  const chapter = detectChapter(config);
  const relativePath = languageRelativePath(chapter);
  await ensureRepository(directory, remoteUrl);
  const dirty = await dirtyFiles(directory);
  if (dirty.length) {
    throw new Error(`Le dépôt Runedelta contient des modifications non commitées :\n${dirty.join("\n")}`);
  }

  const branch = await currentBranch(directory);
  let remoteRef;
  let networkError = null;
  try {
    remoteRef = await fetchRemote(directory, branch);
  } catch (error) {
    networkError = error.message;
    remoteRef = `origin/${branch}`;
    const cachedRemote = await git(["rev-parse", "--verify", remoteRef], directory, {
      allowFailure: true,
    });
    if (cachedRemote.code !== 0) remoteRef = "HEAD";
  }
  const mergeBase = (await git(["merge-base", "HEAD", remoteRef], directory)).stdout.trim();
  const baseLanguage = await showLanguage(directory, mergeBase, relativePath);
  const headLanguage = await showLanguage(directory, "HEAD", relativePath);
  const remoteLanguage = await showLanguage(directory, remoteRef, relativePath);
  const targetPath = gameLanguagePath(config);
  const gameLanguage = suppliedLanguage
    ? validateLanguage(suppliedLanguage, "traductions de l’éditeur")
    : fs.existsSync(targetPath)
      ? readLanguage(targetPath, "lang_fr.json du jeu")
      : headLanguage;

  const localMerge = mergeLanguages(
    baseLanguage,
    headLanguage,
    gameLanguage,
    conflictResolution
  );
  if (localMerge.conflicts.length) {
    return {
      ok: false,
      conflict: true,
      conflicts: localMerge.conflicts,
      conflictDetails: localMerge.conflictDetails,
      phase: "local",
    };
  }
  const finalMerge = mergeLanguages(
    baseLanguage,
    localMerge.language,
    remoteLanguage,
    conflictResolution
  );
  if (finalMerge.conflicts.length) {
    return {
      ok: false,
      conflict: true,
      conflicts: finalMerge.conflicts,
      conflictDetails: finalMerge.conflictDetails,
      phase: "remote",
    };
  }

  const language = validateLanguage(finalMerge.language, "fusion Runedelta");
  const serialized = serializeLanguage(language);
  const mergeResult = await git(["merge", "--no-edit", remoteRef], directory, {
    allowFailure: true,
  });
  if (mergeResult.code !== 0) {
    await resolveMergeConflict(directory, relativePath, serialized);
  }

  const sourcePath = path.join(directory, ...relativePath.split("/"));
  const repositoryLanguage = readLanguage(sourcePath, `Runedelta chapitre ${chapter}`);
  fs.writeFileSync(sourcePath, serialized, "utf8");
  await git(["add", "--", relativePath], directory);
  const staged = await git(["diff", "--cached", "--quiet", "--", relativePath], directory, {
    allowFailure: true,
  });
  let committed = false;
  if (staged.code === 1) {
    const commit = await git(
      ["commit", "-m", `trad: synchroniser le chapitre ${chapter}`, "--", relativePath],
      directory,
      { allowFailure: true }
    );
    if (commit.code !== 0) {
      fs.writeFileSync(sourcePath, serializeLanguage(repositoryLanguage), "utf8");
      await git(["add", "--", relativePath], directory, { allowFailure: true });
      throw new Error((commit.stderr || commit.stdout || "Le commit Git a échoué.").trim());
    }
    committed = true;
  } else if (staged.code !== 0) {
    throw new Error((staged.stderr || "Impossible de vérifier les changements Git.").trim());
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const backup = backupFile(targetPath, serialized);
  fs.writeFileSync(targetPath, serialized, "utf8");

  let pushError = networkError;
  if (push && !networkError) {
    const pushed = await git(["push", "origin", branch], directory, {
      allowFailure: true,
      timeoutMs: 60_000,
    });
    if (pushed.code !== 0) pushError = (pushed.stderr || pushed.stdout || "Push refusé.").trim();
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

async function runedeltaStatus(config, directory, remoteUrl = DEFAULT_RUNEDDELTA_REMOTE) {
  const version = await gitAvailable();
  const chapter = detectChapter(config);
  const configured = Boolean(config.runedelta?.enabled);
  const installed = config.runedelta?.installedChapters;
  const enabled = configured && (!installed || Boolean(chapter && installed[String(chapter)]));
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
    status.branch = await currentBranch(directory);
    status.dirtyFiles = await dirtyFiles(directory);
    const remoteRef = `origin/${status.branch}`;
    const verified = await git(["rev-parse", "--verify", remoteRef], directory, {
      allowFailure: true,
    });
    if (verified.code === 0) Object.assign(status, await aheadBehind(directory, remoteRef));
    status.sourcePath = chapter
      ? path.join(directory, ...languageRelativePath(chapter).split("/"))
      : null;
  } catch (error) {
    status.error = error.message;
  }
  return status;
}

module.exports = {
  DEFAULT_RUNEDDELTA_REMOTE,
  countDifferences,
  detectChapter,
  gameLanguagePath,
  gitAvailable,
  installRunedelta,
  languageRelativePath,
  languageAttributions,
  mergeLanguages,
  parseGitBlamePorcelain,
  runedeltaStatus,
  synchronizeRunedelta,
  validateLanguage,
};
