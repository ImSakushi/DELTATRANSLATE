const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildTranslationCommitMessage,
  attributionsFromHistory,
  detectChapter,
  installRunedelta,
  mergeLanguages,
  parseGitBlamePorcelain,
  parseGitLanguageHistory,
  runedeltaStatus,
  synchronizeRunedelta,
} = require("./runedelta-sync.js");

function language(overrides = {}) {
  const value = { date: "123" };
  for (let index = 0; index < 60; index++) value[`key_${index}`] = `English ${index}`;
  return Object.assign(value, overrides);
}

function serializeLanguage(value) {
  const lines = ["{"];
  const keys = Object.keys(value);
  keys.forEach((key, index) => {
    lines.push(
      `  ${JSON.stringify(key)}: ${JSON.stringify(value[key])}${index < keys.length - 1 ? "," : ""}`
    );
  });
  lines.push("}");
  return lines.join("\n");
}

function runGit(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

function writeLanguage(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeLanguage(value), "utf8");
}

test("le statut désactivé ne dépend ni de Git ni du dépôt local", async () => {
  for (const runedelta of [undefined, { enabled: true }, { modeEnabled: false }]) {
    assert.deepEqual(await runedeltaStatus({ runedelta }, null), { enabled: false, configured: false });
  }
});

test("fusionne les modifications Git et locales portant sur des clés différentes", () => {
  const base = language();
  const local = language({ key_1: "Local" });
  const remote = language({ key_2: "Distant" });
  const result = mergeLanguages(base, local, remote);

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.language.key_1, "Local");
  assert.equal(result.language.key_2, "Distant");
});

test("signale une clé modifiée différemment des deux côtés", () => {
  const base = language();
  const local = language({ key_3: "Version locale" });
  const remote = language({ key_3: "Version distante" });
  const result = mergeLanguages(base, local, remote);

  assert.deepEqual(result.conflicts, ["key_3"]);
  assert.equal(Object.hasOwn(result.language, "key_3"), false);
  assert.equal(mergeLanguages(base, local, remote, "local").language.key_3, "Version locale");
  assert.equal(mergeLanguages(base, local, remote, "remote").language.key_3, "Version distante");
});

test("détecte le chapitre depuis le manifeste d’extraction puis depuis le chemin", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-chapter-"));
  fs.writeFileSync(path.join(root, "chapter-scope.json"), JSON.stringify({ chapter: 4 }), "utf8");
  assert.equal(detectChapter({ extractedDir: root, dataWinPath: "C:/game/chapter5_windows/data.win" }), 4);
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(detectChapter({ dataWinPath: "C:/game/chapter5_windows/data.win" }), 5);
});

test("associe chaque clé JSON à l’auteur de sa dernière ligne Git", () => {
  const blame = [
    `${"a".repeat(40)} 3 3 1`,
    "author Alice Example",
    "author-mail <123+alice@users.noreply.github.com>",
    "author-time 1700000000",
    "summary Traduit la ligne",
    '\t  "obj_test_slash_Step_0_gml_1_0": "Déjà traduit",',
  ].join("\n");
  assert.deepEqual(parseGitBlamePorcelain(blame), {
    obj_test_slash_Step_0_gml_1_0: {
      name: "alice",
      author: "Alice Example",
      commit: "a".repeat(40),
      summary: "Traduit la ligne",
      timestamp: 1700000000000,
    },
  });
});

test("liste tous les contributeurs d’une clé sauf ceux du commit initial", () => {
  const commit = (hash, author, email, time, summary, key, value) =>
    `\x1e${hash}\x1f${author}\x1f${email}\x1f${time}\x1f${summary}\n` +
    `diff --git a/file b/file\n--- a/file\n+++ b/file\n` +
    `+  ${JSON.stringify(key)}: ${JSON.stringify(value)},\n`;
  const output = [
    commit("c".repeat(40), "Bob", "bob@example.invalid", 300, "Deuxième correction", "key_1", "Trois"),
    commit("b".repeat(40), "Alice", "123+alice@users.noreply.github.com", 200, "Traduction", "key_1", "Deux"),
    commit("a".repeat(40), "Import", "import@example.invalid", 100, "Initial", "key_1", "Un"),
  ].join("");

  const result = attributionsFromHistory(parseGitLanguageHistory(output));
  assert.deepEqual(result.key_1.names, ["alice", "Bob"]);
  assert.equal(result.key_1.name, "Bob");
  assert.equal(result.key_1.summary, "Deuxième correction");
  assert.equal(result.key_1.timestamp, 300000);
});

test("génère un commit représentatif des traductions et corrections", () => {
  const before = language({ key_1: "Hello", key_2: "Déjà traduit" });
  const after = language({ key_1: "Bonjour", key_2: "Traduction corrigée" });
  const reference = {
    key_1: { en: "Hello" },
    key_2: { en: "English 2" },
  };
  const message = buildTranslationCommitMessage(5, before, after, reference);

  assert.equal(message.subject, "trad(ch5): traduire 1 dialogue et corriger 1 traduction");
  assert.match(message.body, /Nouvelles traductions : 1/);
  assert.match(message.body, /Corrections : 1/);
  assert.match(message.body, /Hello → Bonjour/);
});

test("nomme directement le dialogue quand un seul texte change", () => {
  const before = language();
  const after = language({ key_3: "Une bien meilleure réplique" });
  const message = buildTranslationCommitMessage(4, before, after, {
    key_3: { en: "English 3" },
  });

  assert.equal(message.subject, "trad(ch4): traduire « Une bien meilleure réplique »");
});

test("installe puis synchronise Runedelta avec un dépôt Git distant", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-runedelta-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const collaborator = path.join(root, "collaborator");
  const managed = path.join(root, "managed");
  const game = path.join(root, "chapter5_windows");
  const dataWin = path.join(game, "data.win");
  const gameLanguage = path.join(game, "lang", "lang_fr.json");
  const relative = path.join("strings", "strings_chapitre_5.json");
  const extracted = path.join(root, "extracted");
  const config = { dataWinPath: dataWin, extractedDir: extracted };

  fs.mkdirSync(game, { recursive: true });
  fs.mkdirSync(extracted, { recursive: true });
  fs.writeFileSync(dataWin, "", "utf8");
  fs.writeFileSync(
    path.join(extracted, "reference.json"),
    JSON.stringify({ key_1: { en: "English 1" } }),
    "utf8"
  );
  runGit(root, "init", "--bare", remote);
  runGit(root, "clone", remote, seed);
  runGit(seed, "config", "user.name", "Test");
  runGit(seed, "config", "user.email", "test@example.invalid");
  writeLanguage(path.join(seed, relative), language());
  runGit(seed, "add", ".");
  runGit(seed, "commit", "-m", "Initial");
  runGit(seed, "branch", "-M", "main");
  runGit(seed, "push", "-u", "origin", "main");
  runGit(remote, "symbolic-ref", "HEAD", "refs/heads/main");

  const installed = await installRunedelta({
    config,
    directory: managed,
    remoteUrl: remote,
    serializeLanguage,
    backupFile: () => null,
  });
  assert.equal(installed.chapter, 5);
  assert.deepEqual(JSON.parse(fs.readFileSync(gameLanguage, "utf8")), language());
  assert.equal(Object.hasOwn(installed.attributions, "key_0"), false);
  runGit(managed, "config", "user.name", "Test");
  runGit(managed, "config", "user.email", "test@example.invalid");

  runGit(root, "clone", remote, collaborator);
  runGit(collaborator, "config", "user.name", "Test distant");
  runGit(collaborator, "config", "user.email", "remote@example.invalid");
  const distant = language({ key_2: "Modification distante" });
  writeLanguage(path.join(collaborator, relative), distant);
  runGit(collaborator, "add", relative);
  runGit(collaborator, "commit", "-m", "Distant");
  runGit(collaborator, "push");

  const local = language({ key_1: "Modification locale" });
  const remoteHead = runGit(remote, "rev-parse", "main").trim();
  const localOnly = await synchronizeRunedelta({
    config,
    directory: managed,
    remoteUrl: remote,
    serializeLanguage,
    backupFile: () => null,
    language: local,
  });
  assert.equal(localOnly.ok, true);
  assert.equal(localOnly.pushed, false);
  assert.equal(runGit(remote, "rev-parse", "main").trim(), remoteHead);
  assert.equal(JSON.parse(fs.readFileSync(gameLanguage, "utf8")).key_1, "Modification locale");
  const synced = await synchronizeRunedelta({
    push: true,
    config,
    directory: managed,
    remoteUrl: remote,
    serializeLanguage,
    backupFile: () => null,
    language: localOnly.language,
  });
  assert.equal(synced.ok, true);
  assert.equal(synced.pushed, true);
  assert.equal(synced.language.key_1, "Modification locale");
  assert.equal(synced.language.key_2, "Modification distante");
  assert.equal(synced.attributions.key_1.name, "Test");
  assert.deepEqual(synced.attributions.key_1.names, ["Test"]);
  assert.equal(synced.attributions.key_2.name, "Test distant");
  assert.deepEqual(synced.attributions.key_2.names, ["Test distant"]);
  assert.equal(
    runGit(managed, "log", "-1", "--pretty=%s").trim(),
    "trad(ch5): traduire « Modification locale »"
  );

  runGit(collaborator, "pull", "--ff-only");
  const published = JSON.parse(fs.readFileSync(path.join(collaborator, relative), "utf8"));
  assert.equal(published.key_1, "Modification locale");
  assert.equal(published.key_2, "Modification distante");

  writeLanguage(path.join(collaborator, relative), {
    ...published,
    key_4: "Version distante en conflit",
  });
  runGit(collaborator, "add", relative);
  runGit(collaborator, "commit", "-m", "Conflit distant");
  runGit(collaborator, "push");
  const conflict = await synchronizeRunedelta({
    config,
    directory: managed,
    remoteUrl: remote,
    serializeLanguage,
    backupFile: () => null,
    language: { ...synced.language, key_4: "Version locale en conflit" },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.deepEqual(conflict.conflicts, ["key_4"]);
  assert.equal(JSON.parse(fs.readFileSync(gameLanguage, "utf8")).key_4, "English 4");

  const resolved = await synchronizeRunedelta({
    push: true,
    config,
    directory: managed,
    remoteUrl: remote,
    serializeLanguage,
    backupFile: () => null,
    language: { ...synced.language, key_4: "Version locale en conflit" },
    conflictResolution: "remote",
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.language.key_4, "Version distante en conflit");

  fs.rmSync(remote, { recursive: true, force: true });
  const offline = { ...resolved.language, key_3: "Modification hors ligne" };
  const offlineSync = await synchronizeRunedelta({
    config,
    directory: managed,
    remoteUrl: remote,
    serializeLanguage,
    backupFile: () => null,
    language: offline,
  });
  assert.equal(offlineSync.ok, true);
  assert.match(offlineSync.pushError, /repository|dépôt|read|lire|exist|introuvable/i);
  assert.equal(JSON.parse(fs.readFileSync(gameLanguage, "utf8")).key_3, "Modification hors ligne");
});
