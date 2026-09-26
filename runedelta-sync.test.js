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
  const config = { dataWinPath: dataWin, extractedDir: extracted, runedelta: { storage: "game" } };

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

async function syncFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate-sync-regression-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git"), seed = path.join(root, "seed"), managed = path.join(root, "managed");
  runGit(root, "init", "--bare", remote);
  runGit(root, "clone", remote, seed);
  runGit(seed, "config", "user.name", "Équipe test");
  runGit(seed, "config", "user.email", "team@example.invalid");
  const relative = chapter => `strings/strings_chapitre_${chapter}.json`;
  for (const chapter of [4, 5]) writeLanguage(path.join(seed, relative(chapter)), language());
  writeLanguage(path.join(seed, "strings_og", "chapter5.json"), language());
  runGit(seed, "add", "."); runGit(seed, "commit", "-m", "test: initial catalogues");
  runGit(seed, "branch", "-M", "main"); runGit(seed, "push", "-u", "origin", "main");
  runGit(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  const config = (chapter, installation = "jeu") => ({ dataWinPath: path.join(root, installation, `chapter${chapter}_windows`, "data.win"), runedelta: { storage: "game" } });
  const options = (chapter, installation) => ({ config: config(chapter, installation), directory: managed, remoteUrl: remote, serializeLanguage, backupFile: () => null });
  await installRunedelta(options(4)); await installRunedelta(options(5));
  runGit(managed, "config", "user.name", "Traducteur test");
  runGit(managed, "config", "user.email", "translator@example.invalid");
  const target = (chapter, installation) => path.join(path.dirname(config(chapter, installation).dataWinPath), "lang", "lang_fr.json");
  const read = (chapter, installation) => JSON.parse(fs.readFileSync(target(chapter, installation), "utf8"));
  const published = chapter => JSON.parse(runGit(remote, "show", `main:${relative(chapter)}`));
  const contribute = (chapter, changes) => {
    runGit(seed, "pull", "--ff-only");
    writeLanguage(path.join(seed, relative(chapter)), { ...published(chapter), ...changes });
    runGit(seed, "add", "."); runGit(seed, "commit", "-m", "test: contribution distante"); runGit(seed, "push");
  };
  return { root, remote, seed, managed, relative, options, target, read, published, contribute };
}

test("changer de chapitre ne republie jamais son ancien catalogue", async t => {
  const f = await syncFixture(t);
  f.contribute(5, { key_1: "Traduction de l’équipe" });
  await synchronizeRunedelta({ ...f.options(4), push: true });
  const result = await synchronizeRunedelta({ ...f.options(5), push: true });
  assert.equal(result.ok, true);
  assert.equal(f.read(5).key_1, "Traduction de l’équipe");
  assert.equal(f.published(5).key_1, "Traduction de l’équipe");
});

test("deux installations du même chapitre conservent leurs bases et leurs conflits", async t => {
  const f = await syncFixture(t);
  await installRunedelta(f.options(5, "autre"));
  await synchronizeRunedelta({ ...f.options(5), push: true, language: language({ key_1: "Première installation" }) });
  const result = await synchronizeRunedelta({ ...f.options(5, "autre"), push: true, language: language({ key_1: "Autre installation" }) });
  assert.equal(result.conflict, true);
  assert.equal(result.phase, "workspace");
  assert.equal(result.conflictDetails[0].local, "Autre installation");
  assert.equal(result.conflictDetails[0].remote, "Première installation");
  assert.equal(f.published(5).key_1, "Première installation");
});

test("l’ancienne connexion et une autre installation ne donnent pas accès à publier", async t => {
  const f = await syncFixture(t);
  const { isRunedeltaProjectConnected, projectBinding } = require("./runedelta-sync.js");
  const { projectId } = require("./storage.js");
  const config = f.options(5).config;
  config.runedelta = { ...config.runedelta, modeEnabled: true, enabled: true, remoteUrl: f.remote, installedChapters: { 5: true } };
  assert.equal(isRunedeltaProjectConnected(config), false);
  config.runedelta.projects = { [projectId(config)]: projectBinding(config, f.remote) };
  assert.equal(isRunedeltaProjectConnected(config), true);
  assert.equal(isRunedeltaProjectConnected({ ...f.options(5, "autre").config, runedelta: config.runedelta }), false);
  assert.equal(isRunedeltaProjectConnected({ ...config, targetLanguage: "es" }), false);
  assert.equal(isRunedeltaProjectConnected({ ...config, runedelta: { ...config.runedelta, remoteUrl: "autre" } }), false);
  await assert.rejects(synchronizeRunedelta(f.options(5, "autre")), /reconnectée/);
});

test("la connexion sauvegarde toujours le fichier remplacé, même sans callback de backup", async t => {
  const f = await syncFixture(t);
  const original = language({ key_8: "Travail local précieux" });
  writeLanguage(f.target(5, "nouveau"), original);
  const result = await installRunedelta(f.options(5, "nouveau"));
  assert.equal(result.backupCreated, true);
  const { listBackups, readBackup } = require("./storage.js");
  const root = path.join(f.managed, ".git", "deltatranslate-backups");
  const saved = listBackups(root, f.target(5, "nouveau"));
  assert.deepEqual(readBackup(root, f.target(5, "nouveau"), saved[0].id), original);
  writeLanguage(f.target(5, "nouveau"), original);
  const before = fs.readFileSync(f.target(5, "nouveau"), "utf8");
  await assert.rejects(installRunedelta({ ...f.options(5, "nouveau"), backupFile: () => { throw new Error("Disque backup indisponible"); } }), /Disque backup indisponible/);
  assert.equal(fs.readFileSync(f.target(5, "nouveau"), "utf8"), before);
});

test("récupérer préserve les modifications locales sans commit, même en changeant ensuite de chapitre", async t => {
  const f = await syncFixture(t);
  const head = runGit(f.managed, "rev-parse", "HEAD");
  writeLanguage(f.target(5), language({ key_1: "Brouillon local" }));
  f.contribute(5, { key_2: "Distant" });
  const remoteHead = runGit(f.remote, "rev-parse", "main");
  const received = await synchronizeRunedelta({ ...f.options(5), receiveOnly: true });
  assert.equal(received.ok, true); assert.equal(received.pushed, false); assert.equal(received.committed, false);
  assert.equal(f.read(5).key_1, "Brouillon local"); assert.equal(f.read(5).key_2, "Distant");
  assert.equal(runGit(f.managed, "rev-parse", "HEAD"), head);
  assert.equal(runGit(f.managed, "status", "--porcelain"), "");
  assert.equal(runGit(f.remote, "rev-parse", "main"), remoteHead);
  await synchronizeRunedelta({ ...f.options(4), push: true });
  assert.equal(f.published(5).key_1, "English 1");
  const repeat = await synchronizeRunedelta({ ...f.options(5), receiveOnly: true });
  assert.equal(repeat.ok, true); assert.equal(repeat.language.key_1, "Brouillon local");
  const result = await synchronizeRunedelta({ ...f.options(5), push: true });
  assert.equal(result.ok, true); assert.equal(f.published(5).key_1, "Brouillon local");
  assert.equal(f.published(5).key_2, "Distant");
});

test("un push refusé permet de corriger la même ligne et de reprendre sans faux conflit", async t => {
  const f = await syncFixture(t);
  const hook = path.join(f.remote, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const first = await synchronizeRunedelta({ ...f.options(5), push: true, language: language({ key_1: "Version 1" }) });
  assert.equal(first.ok, true); assert.ok(first.pushError);
  const second = await synchronizeRunedelta({ ...f.options(5), push: true, language: language({ key_1: "Version 2" }) });
  assert.equal(second.ok, true); assert.ok(second.pushError);
  fs.rmSync(hook);
  const third = await synchronizeRunedelta({ ...f.options(5), push: true });
  assert.equal(third.ok, true); assert.equal(third.pushed, true);
  assert.equal(f.published(5).key_1, "Version 2");
});

test("la récupération refuse un réseau indisponible sans modifier le catalogue ni sa base", async t => {
  const f = await syncFixture(t);
  const before = fs.readFileSync(f.target(5), "utf8");
  const stateDir = path.join(f.managed, ".git", "deltatranslate");
  const states = fs.readdirSync(stateDir).map(file => fs.readFileSync(path.join(stateDir, file), "utf8"));
  fs.renameSync(f.remote, `${f.remote}.offline`);
  await assert.rejects(synchronizeRunedelta({ ...f.options(5), receiveOnly: true }), /Récupération impossible/);
  assert.equal(fs.readFileSync(f.target(5), "utf8"), before);
  assert.deepEqual(fs.readdirSync(stateDir).map(file => fs.readFileSync(path.join(stateDir, file), "utf8")), states);
});

test("une écriture externe pendant le backup bloque la synchronisation suivante plutôt que deviner une base", async t => {
  const f = await syncFixture(t);
  f.contribute(5, { key_2: "Distant" });
  const external = language({ key_3: "Modification externe" });
  await assert.rejects(synchronizeRunedelta({ ...f.options(5), receiveOnly: true, backupFile: target => {
    writeLanguage(target, external); return "backup";
  } }), /fichier a changé/);
  assert.deepEqual(f.read(5), external);
  await assert.rejects(synchronizeRunedelta({ ...f.options(5), push: true }), /interrompue/);
});

test("récupérer détecte un conflit réel, vérifie la résolution et conserve date et ordre", async t => {
  const f = await syncFixture(t);
  const { projectBinding } = require("./runedelta-sync.js");
  const { projectId } = require("./storage.js");
  writeLanguage(f.target(5), language({ key_1: "Locale" }));
  f.contribute(5, { key_1: "Distante" });
  const conflict = await synchronizeRunedelta({ ...f.options(5), receiveOnly: true });
  assert.equal(conflict.conflict, true);
  assert.equal(f.read(5).key_1, "Locale");
  const expected = conflict.conflictDetails[0];
  f.contribute(5, { key_1: "Distante corrigée" });
  const stale = await synchronizeRunedelta({ ...f.options(5), receiveOnly: true, conflictResolution: {
    workspace: { key_1: { choice: "remote", expected } },
  } });
  assert.equal(stale.conflict, true);
  const resolved = await synchronizeRunedelta({ ...f.options(5), receiveOnly: true, conflictResolution: {
    workspace: { key_1: { choice: "remote", expected: stale.conflictDetails[0] } },
  } });
  assert.equal(resolved.ok, true); assert.equal(resolved.language.key_1, "Distante corrigée");
  assert.deepEqual(Object.keys(f.read(5)), Object.keys(language()));
  assert.equal(f.read(5).date, "123");
  const config = f.options(5).config;
  config.runedelta = { ...config.runedelta, modeEnabled: true, enabled: true, remoteUrl: f.remote,
    projects: { [projectId(config)]: projectBinding(config, f.remote) } };
  const status = await runedeltaStatus(config, f.managed, f.remote);
  assert.equal(status.unpublishedChanges, 0);
  assert.equal(status.incomingChanges, 0);
});

test("une identité générique bloque la publication mais pas la récupération", async t => {
  const f = await syncFixture(t);
  runGit(f.managed, "config", "user.name", "Traducteur Runedelta");
  runGit(f.managed, "config", "user.email", "deltatranslate@users.noreply.github.com");
  const received = await synchronizeRunedelta({ ...f.options(5), receiveOnly: true });
  assert.equal(received.ok, true);
  await assert.rejects(synchronizeRunedelta({ ...f.options(5), push: true }), /Configure ton identité Git/);
  const options = f.options(5);
  options.config.runedelta = { ...options.config.runedelta, identity: { name: "Alice", email: "123+alice@users.noreply.github.com" } };
  const result = await synchronizeRunedelta({ ...options, push: true, language: language({ key_1: "Bonjour" }) });
  assert.equal(result.ok, true);
  assert.equal(runGit(f.managed, "log", "-1", "--format=%an <%ae>").trim(), "Alice <123+alice@users.noreply.github.com>");
});

test("les fiches récupèrent les derniers commits distants sans modifier le catalogue ouvert", async t => {
  const f = await syncFixture(t);
  const { listRunedeltaBranches } = require("./runedelta-sync.js");
  runGit(f.seed, "switch", "-c", "equipe/accents");
  runGit(f.seed, "config", "user.name", "Élodie");
  runGit(f.seed, "config", "user.email", "123+elodie@users.noreply.github.com");
  writeLanguage(path.join(f.seed, f.relative(5)), language({ key_2: "Réplique corrigée" }));
  runGit(f.seed, "add", ".");
  runGit(f.seed, "commit", "-m", "test: contribution distante");
  runGit(f.seed, "push", "origin", "equipe/accents");
  const expectedCommit = runGit(f.seed, "rev-parse", "HEAD").trim();
  const expectedTime = Number(runGit(f.seed, "log", "-1", "--format=%ct").trim()) * 1000;
  const beforeHead = runGit(f.managed, "rev-parse", "HEAD");
  writeLanguage(f.target(5), language({ key_1: "Brouillon précieux" }));
  const beforeStatus = runGit(f.managed, "status", "--porcelain");
  const result = await listRunedeltaBranches(f.remote, { details: true });
  assert.equal(result.detailsError, undefined);
  assert.deepEqual(result.branches, ["equipe/accents", "main"]);
  assert.equal(result.defaultBranch, "main");
  assert.deepEqual(result.branchDetails.find(branch => branch.name === "equipe/accents"), {
    name: "equipe/accents", commit: expectedCommit, author: "Élodie", authorName: "elodie",
    timestamp: expectedTime, subject: "test: contribution distante",
  });
  assert.equal(result.branchDetails.find(branch => branch.name === "main").authorName, "Équipe test");
  assert.equal(runGit(f.managed, "rev-parse", "HEAD"), beforeHead);
  assert.equal(runGit(f.managed, "branch", "--show-current").trim(), "main");
  assert.equal(runGit(f.managed, "status", "--porcelain"), beforeStatus);
  assert.equal(f.read(5).key_1, "Brouillon précieux");
});

test("choisir une branche conserve les brouillons de chaque branche et publie uniquement sur celle choisie", async t => {
  const f = await syncFixture(t);
  const { listRunedeltaBranches } = require("./runedelta-sync.js");
  runGit(f.seed, "switch", "-c", "ImSakushi/traduction");
  writeLanguage(path.join(f.seed, f.relative(5)), language({ key_2: "Texte de la branche" }));
  runGit(f.seed, "add", "."); runGit(f.seed, "commit", "-m", "test: alternate branch");
  runGit(f.seed, "push", "-u", "origin", "ImSakushi/traduction");
  const branches = await listRunedeltaBranches(f.remote);
  assert.deepEqual(branches.branches, ["ImSakushi/traduction", "main"]);
  assert.equal(branches.defaultBranch, "main");
  writeLanguage(f.target(5), language({ key_1: "Brouillon main" }));
  const mainHead = runGit(f.remote, "rev-parse", "main");
  const changed = await installRunedelta({ ...f.options(5), branch: "ImSakushi/traduction" });
  assert.equal(changed.branch, "ImSakushi/traduction");
  assert.equal(f.read(5).key_2, "Texte de la branche");
  assert.equal(f.read(5).key_1, "English 1");
  writeLanguage(f.target(5), { ...f.read(5), key_3: "Brouillon branche" });
  const restored = await installRunedelta({ ...f.options(5), branch: "main" });
  assert.equal(restored.restored, true);
  assert.equal(f.read(5).key_1, "Brouillon main");
  assert.equal(f.read(5).key_3, "English 3");
  await installRunedelta({ ...f.options(5), branch: "ImSakushi/traduction" });
  assert.equal(f.read(5).key_3, "Brouillon branche");
  const options = f.options(5);
  options.config.runedelta = { ...options.config.runedelta, branch: "main" };
  await assert.rejects(synchronizeRunedelta({ ...options, push: true }), /branche Git a changé/);
  options.config.runedelta.branch = "ImSakushi/traduction";
  const published = await synchronizeRunedelta({ ...options, push: true });
  assert.equal(published.pushed, true);
  assert.equal(runGit(f.remote, "rev-parse", "main"), mainHead);
  const branchLanguage = JSON.parse(runGit(f.remote, "show", `ImSakushi/traduction:${f.relative(5)}`));
  assert.equal(branchLanguage.key_3, "Brouillon branche");
  assert.equal(branchLanguage.key_1, "English 1");
});

test("une branche absente, invalide ou sans catalogue laisse le projet intact", async t => {
  const f = await syncFixture(t);
  const original = fs.readFileSync(f.target(5), "utf8");
  for (const branch of ["inexistante", "-option", "HEAD", "main:autre", "refs/heads/main"]) {
    await assert.rejects(installRunedelta({ ...f.options(5), branch }));
    assert.equal(runGit(f.managed, "branch", "--show-current").trim(), "main");
    assert.equal(fs.readFileSync(f.target(5), "utf8"), original);
  }
  runGit(f.seed, "switch", "-c", "ImSakushi/incomplet");
  runGit(f.seed, "rm", f.relative(5)); runGit(f.seed, "commit", "-m", "test: missing catalogue");
  runGit(f.seed, "push", "-u", "origin", "ImSakushi/incomplet");
  await assert.rejects(installRunedelta({ ...f.options(5), branch: "ImSakushi/incomplet" }));
  assert.equal(runGit(f.managed, "branch", "--show-current").trim(), "main");
  assert.equal(fs.readFileSync(f.target(5), "utf8"), original);
});

async function openGitCatalogue(f, chapter = 5, branch = 'main', installation = 'jeu') {
  const options = f.options(chapter, installation);
  options.config.runedelta = { identity: { name: 'Traducteur test', email: 'translator@example.invalid' } };
  const result = await installRunedelta({ ...options, branch });
  options.directory = result.directory;
  options.config.langFrPath = result.targetPath;
  options.config.storageMode = 'runedelta-json';
  options.config.runedelta = { ...options.config.runedelta, storage: 'git', modeEnabled: true, enabled: true,
    directory: result.directory, baseDirectory: result.baseDirectory, branch, remoteUrl: f.remote };
  const { projectBinding } = require('./runedelta-sync.js');
  const { projectId } = require('./storage.js');
  options.config.runedelta.projects = { [projectId(options.config)]: projectBinding(options.config, f.remote) };
  return { ...options, target: result.targetPath, installed: result,
    read: () => JSON.parse(fs.readFileSync(result.targetPath, 'utf8')) };
}

test('par défaut l’éditeur travaille sur le JSON Git et publie ce fichier sans toucher au jeu', async t => {
  const f = await syncFixture(t);
  const gameBefore = fs.readFileSync(f.target(5));
  const s = await openGitCatalogue(f);
  assert.equal(s.target, path.join(s.directory, f.relative(5)));
  assert.deepEqual(fs.readFileSync(f.target(5)), gameBefore);
  writeLanguage(s.target, { ...s.read(), key_1: 'Brouillon Git' });
  const status = await runedeltaStatus(s.config, s.directory, f.remote);
  assert.equal(status.enabled, true);
  assert.equal(status.unpublishedChanges, 1);
  assert.deepEqual(status.dirtyFiles, []);
  assert.equal(f.published(5).key_1, 'English 1');
  f.contribute(5, { key_2: 'Traduction distante' });
  const head = runGit(s.directory, 'rev-parse', 'HEAD');
  const remoteHead = runGit(f.remote, 'rev-parse', 'main');
  const received = await synchronizeRunedelta({ ...s, receiveOnly: true });
  assert.equal(received.ok, true);
  assert.equal(received.committed, false);
  assert.equal(received.pushed, false);
  assert.equal(runGit(s.directory, 'rev-parse', 'HEAD'), head);
  assert.equal(runGit(f.remote, 'rev-parse', 'main'), remoteHead);
  assert.equal(s.read().key_1, 'Brouillon Git');
  assert.equal(s.read().key_2, 'Traduction distante');
  const published = await synchronizeRunedelta({ ...s, push: true });
  assert.equal(published.pushed, true);
  assert.equal(f.published(5).key_1, 'Brouillon Git');
  assert.equal(f.published(5).key_2, 'Traduction distante');
  assert.deepEqual(fs.readFileSync(f.target(5)), gameBefore);
  assert.equal(runGit(s.directory, 'status', '--porcelain'), '');
  assert.deepEqual(Object.keys(s.read()), Object.keys(language()));
  assert.equal(s.read().date, '123');
});

test('les JSON Git de deux chapitres et de deux installations restent isolés', async t => {
  const f = await syncFixture(t);
  const a = await openGitCatalogue(f, 4), b = await openGitCatalogue(f, 5), c = await openGitCatalogue(f, 5, 'main', 'autre');
  assert.notEqual(b.directory, c.directory);
  writeLanguage(a.target, { ...a.read(), key_1: 'Chapitre 4 local' });
  writeLanguage(b.target, { ...b.read(), key_2: 'Chapitre 5 local' });
  f.contribute(5, { key_3: 'Chapitre 5 équipe' });
  await synchronizeRunedelta({ ...a, push: true });
  const result = await synchronizeRunedelta({ ...b, push: true });
  assert.equal(result.pushed, true);
  assert.equal(f.published(5).key_2, 'Chapitre 5 local');
  assert.equal(f.published(5).key_3, 'Chapitre 5 équipe');
  await synchronizeRunedelta({ ...c, push: true });
  assert.equal(f.published(5).key_2, 'Chapitre 5 local');
  assert.equal(f.published(5).key_3, 'Chapitre 5 équipe');
  assert.equal(f.published(4).key_1, 'Chapitre 4 local');
});

test('changer de branche Git conserve les fichiers et pousse uniquement la branche choisie', async t => {
  const f = await syncFixture(t);
  runGit(f.seed, 'switch', '-c', 'ImSakushi/catalogue');
  writeLanguage(path.join(f.seed, f.relative(5)), language({ key_1: 'Branche alternative' }));
  runGit(f.seed, 'add', '.'); runGit(f.seed, 'commit', '-m', 'test: branch catalogue');
  runGit(f.seed, 'push', '-u', 'origin', 'ImSakushi/catalogue');
  const main = await openGitCatalogue(f);
  writeLanguage(main.target, { ...main.read(), key_2: 'Brouillon main' });
  const other = await installRunedelta({ ...main, branch: 'ImSakushi/catalogue' });
  assert.notEqual(other.directory, main.directory);
  assert.equal(other.language.key_1, 'Branche alternative');
  writeLanguage(other.targetPath, { ...other.language, key_3: 'Brouillon branche' });
  const back = await installRunedelta({ ...main, branch: 'main' });
  assert.equal(back.targetPath, main.target);
  assert.equal(back.language.key_2, 'Brouillon main');
  const alt = await openGitCatalogue(f, 5, 'ImSakushi/catalogue');
  assert.equal(alt.read().key_3, 'Brouillon branche');
  const before = runGit(f.remote, 'rev-parse', 'main');
  const result = await synchronizeRunedelta({ ...alt, push: true });
  assert.equal(result.pushed, true);
  assert.equal(runGit(f.remote, 'rev-parse', 'main'), before);
  const published = JSON.parse(runGit(f.remote, 'show', `ImSakushi/catalogue:${f.relative(5)}`));
  assert.equal(published.key_3, 'Brouillon branche');
  assert.equal(published.key_2, 'English 2');
  assert.equal(main.read().key_2, 'Brouillon main');
});

test('un conflit dans le JSON Git ne modifie rien avant résolution', async t => {
  const f = await syncFixture(t), s = await openGitCatalogue(f);
  writeLanguage(s.target, { ...s.read(), key_1: 'Locale' });
  const original = fs.readFileSync(s.target);
  f.contribute(5, { key_1: 'Distante' });
  const first = await synchronizeRunedelta({ ...s, push: true });
  assert.equal(first.conflict, true);
  assert.deepEqual(fs.readFileSync(s.target), original);
  const result = await synchronizeRunedelta({ ...s, push: true, conflictResolution: {
    workspace: { key_1: { choice: 'local', expected: first.conflictDetails[0] } },
  } });
  assert.equal(result.pushed, true);
  assert.equal(f.published(5).key_1, 'Locale');
});

test('un commit refusé conserve le brouillon Git et permet une nouvelle tentative', async t => {
  const f = await syncFixture(t), s = await openGitCatalogue(f);
  writeLanguage(s.target, { ...s.read(), key_1: 'À conserver' });
  const original = fs.readFileSync(s.target);
  const hook = path.join(s.directory, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(synchronizeRunedelta({ ...s, push: true }));
  assert.deepEqual(fs.readFileSync(s.target), original);
  assert.equal(runGit(s.directory, 'diff', '--cached', '--name-only'), '');
  fs.rmSync(hook);
  assert.equal((await synchronizeRunedelta({ ...s, push: true })).pushed, true);
  assert.equal(f.published(5).key_1, 'À conserver');
});

test('un push refusé puis une correction du JSON Git se reprennent sans faux conflit', async t => {
  const f = await syncFixture(t), s = await openGitCatalogue(f);
  const hook = path.join(f.remote, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeLanguage(s.target, { ...s.read(), key_1: 'Première version' });
  const refused = await synchronizeRunedelta({ ...s, push: true });
  assert.equal(refused.pushed, false);
  assert.ok(refused.pushError);
  writeLanguage(s.target, { ...s.read(), key_1: 'Version corrigée' });
  fs.rmSync(hook);
  f.contribute(5, { key_2: 'Équipe' });
  const retry = await synchronizeRunedelta({ ...s, push: true });
  assert.equal(retry.pushed, true);
  assert.equal(f.published(5).key_1, 'Version corrigée');
  assert.equal(f.published(5).key_2, 'Équipe');
});

test('la copie facultative dans le jeu sauvegarde son contenu précédent', async t => {
  const f = await syncFixture(t), s = await openGitCatalogue(f);
  const { copyRunedeltaToGame } = require('./runedelta-sync.js');
  const old = fs.readFileSync(f.target(5));
  const updated = { ...s.read(), key_1: 'Copie pour jouer' };
  assert.deepEqual(copyRunedeltaToGame(s.config, updated, serializeLanguage, () => null), {});
  assert.deepEqual(fs.readFileSync(f.target(5)), old);
  s.config.runedelta.copyToGame = true;
  const copied = copyRunedeltaToGame(s.config, updated, serializeLanguage, () => null);
  assert.equal(copied.gameCopyPath, f.target(5));
  assert.equal(f.read(5).key_1, 'Copie pour jouer');
  const storage = require('./storage.js');
  const root = path.join(s.directory, '.git', 'deltatranslate-backups');
  const versions = storage.listBackups(root, f.target(5));
  assert.equal(versions.length, 1);
  assert.deepEqual(storage.readBackup(root, f.target(5), versions[0].id), JSON.parse(old));
});

test('une branche changée hors de l’app bloque la sauvegarde et un index préparé bloque la synchro', async t => {
  const f = await syncFixture(t), s = await openGitCatalogue(f);
  const { assertRunedeltaWorkingFile } = require('./runedelta-sync.js');
  await assertRunedeltaWorkingFile(s.config);
  writeLanguage(s.target, { ...s.read(), key_1: 'Brouillon protégé' });
  runGit(s.directory, 'add', f.relative(5));
  await assert.rejects(synchronizeRunedelta({ ...s, push: true }), /préparés dans Git/);
  runGit(s.directory, 'restore', '--staged', f.relative(5));
  runGit(s.directory, 'switch', '-c', 'ImSakushi/externe');
  await assert.rejects(assertRunedeltaWorkingFile(s.config), /branche Git a changé/);
  await assert.rejects(synchronizeRunedelta({ ...s, push: true }), /branche Git a changé/);
  assert.equal(s.read().key_1, 'Brouillon protégé');
});

test('reconnecter restaure le brouillon Git après une publication interrompue', async t => {
  const f = await syncFixture(t), s = await openGitCatalogue(f);
  const directory = path.join(s.directory, '.git', 'deltatranslate');
  const stateFile = path.join(directory, fs.readdirSync(directory)[0]);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const draft = language({ key_1: 'Brouillon avant interruption' });
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, pending: true, recovery: { content: serializeLanguage(draft), language: state.language } }));
  await assert.rejects(synchronizeRunedelta({ ...s, push: true }), /interrompue/);
  const recovered = await installRunedelta(s);
  assert.equal(recovered.language.key_1, 'Brouillon avant interruption');
  assert.equal((await synchronizeRunedelta({ ...s, push: true })).pushed, true);
  assert.equal(f.published(5).key_1, 'Brouillon avant interruption');
});

test('réimporter un chapitre déjà connecté ne réutilise ni le fichier du jeu ni le clone du chapitre précédent', async t => {
  const f = await syncFixture(t), a = await openGitCatalogue(f, 4), b = await openGitCatalogue(f, 5);
  const { isRunedeltaProjectConnected } = require('./runedelta-sync.js');
  assert.equal(isRunedeltaProjectConnected(b.config), true);
  assert.equal(isRunedeltaProjectConnected({ ...b.config, storageMode: 'lang-json', langFrPath: f.target(5) }), false);
  assert.equal(isRunedeltaProjectConnected({ ...b.config, runedelta: { ...b.config.runedelta, directory: a.directory } }), false);
  const restored = await installRunedelta({ ...b, directory: a.directory });
  assert.equal(restored.directory, b.directory);
  assert.equal(restored.targetPath, b.target);
});

test('la VO Runedelta vient de main, complète les entrées absentes et conserve les métadonnées GML', async t => {
  const f = await syncFixture(t);
  const originalPath = path.join(f.seed, 'strings_og', 'chapter5.json');
  const original = language({ key_1: 'Original English', vo_only: 'Still English' });
  writeLanguage(originalPath, original);
  runGit(f.seed, 'add', '.'); runGit(f.seed, 'commit', '-m', 'test: original catalogue'); runGit(f.seed, 'push');
  runGit(f.seed, 'switch', '-c', 'ImSakushi/vo-test');
  writeLanguage(originalPath, language({ key_1: 'Texte sur une autre branche', vo_only: 'Autre texte' }));
  runGit(f.seed, 'add', '.'); runGit(f.seed, 'commit', '-m', 'test: alternate originals');
  runGit(f.seed, 'push', '-u', 'origin', 'ImSakushi/vo-test');
  const s = await openGitCatalogue(f, 5, 'ImSakushi/vo-test');
  const { loadRunedeltaReference } = require('./runedelta-sync.js');
  const extracted = { key_1: { en: 'Ancienne référence', file: 'gml_Object_test_Step_0', line: 12, channel: 'msg', face: { fc: 1, fe: 2 } },
    extracted_only: { en: 'Local English', channel: 'string' } };
  const before = structuredClone(extracted);
  const bytes = fs.readFileSync(s.target);
  writeLanguage(path.join(s.directory, 'strings_og', 'chapter5.json'), language({ key_1: 'Modification locale à ignorer' }));
  const reference = await loadRunedeltaReference(s.config, extracted);
  assert.equal(reference.key_1.en, 'Original English');
  assert.deepEqual(reference.key_1.face, before.key_1.face);
  assert.equal(reference.key_1.file, before.key_1.file);
  assert.equal(reference.key_1.line, 12);
  assert.equal(reference.vo_only.en, 'Still English');
  assert.equal(reference.vo_only.file, undefined);
  assert.equal(reference.vo_only.originalSource, 'main/strings_og/chapter5.json');
  assert.equal(reference.extracted_only.en, 'Local English');
  assert.equal(Object.hasOwn(reference, 'date'), false);
  assert.deepEqual(extracted, before);
  assert.deepEqual(fs.readFileSync(s.target), bytes);
  assert.equal(runGit(s.directory, 'branch', '--show-current').trim(), 'ImSakushi/vo-test');
  const { catalogKeys } = await import('./src/editor-state.mjs');
  const vm = require('node:vm');
  const app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
  const context = vm.createContext({ reference, lang: { date: '123', vo_only: 'Still English', key_1: 'Traduit' },
    prefs: { validated: {} }, japanese: {}, catalogKeys, buildSearchable: () => '', entries: [], entriesByKey: new Map() });
  vm.runInContext(app.slice(app.indexOf('function hasWords('), app.indexOf('// Séquences de dialogue')), context);
  vm.runInContext('buildIndex()', context);
  assert.equal(context.entriesByKey.get('vo_only').todo, true);
  assert.equal(context.entriesByKey.get('vo_only').noref, false);
  assert.equal(context.entriesByKey.get('key_1').todo, false);
  context.prefs.validated.vo_only = true;
  vm.runInContext('buildIndex()', context);
  assert.equal(context.entriesByKey.get('vo_only').todo, false);
});

test('récupérer sur une autre branche actualise aussi la VO de main sans changer la branche de travail', async t => {
  const f = await syncFixture(t);
  runGit(f.seed, 'switch', '-c', 'ImSakushi/vo-refresh');
  runGit(f.seed, 'push', '-u', 'origin', 'ImSakushi/vo-refresh');
  const s = await openGitCatalogue(f, 5, 'ImSakushi/vo-refresh');
  runGit(f.seed, 'switch', 'main');
  writeLanguage(path.join(f.seed, 'strings_og', 'chapter5.json'), language({ key_1: 'Updated original' }));
  runGit(f.seed, 'add', '.'); runGit(f.seed, 'commit', '-m', 'test: update originals'); runGit(f.seed, 'push');
  const { loadRunedeltaReference } = require('./runedelta-sync.js');
  assert.equal((await loadRunedeltaReference(s.config)).key_1.en, 'English 1');
  const result = await synchronizeRunedelta({ ...s, receiveOnly: true });
  assert.equal(result.ok, true);
  assert.equal(result.pushed, false);
  assert.equal((await loadRunedeltaReference(s.config)).key_1.en, 'Updated original');
  assert.equal(runGit(s.directory, 'branch', '--show-current').trim(), 'ImSakushi/vo-refresh');
});

test('la référence locale reste utilisée hors du mode catalogue Git et sans VO pour les autres chapitres', async t => {
  const f = await syncFixture(t);
  const { loadRunedeltaReference } = require('./runedelta-sync.js');
  const reference = { key: { en: 'Local original' } };
  assert.equal(await loadRunedeltaReference(f.options(5).config, reference), reference);
  const s = await openGitCatalogue(f, 4);
  assert.equal(await loadRunedeltaReference(s.config, reference), reference);
  const chapter5 = await openGitCatalogue(f, 5);
  runGit(chapter5.directory, 'update-ref', '-d', 'refs/remotes/origin/main');
  await assert.rejects(loadRunedeltaReference(chapter5.config, reference), /référence anglaise.*indisponible/);
});

test('les champs facultatifs remplacent indépendamment le message automatique', () => {
  const before = language(), after = language({ key_1: 'Bonjour' });
  const automatic = buildTranslationCommitMessage(5, before, after);
  for (const custom of [null, {}, { title: '  ', description: '\n ' }]) {
    assert.deepEqual(buildTranslationCommitMessage(5, before, after, {}, custom), automatic);
  }
  const titleOnly = buildTranslationCommitMessage(5, before, after, {}, { title: ' Répliques\r\ncorrigées ' });
  assert.equal(titleOnly.subject, 'trad(ch5): Répliques corrigées');
  assert.equal(titleOnly.body, automatic.body);
  const descriptionOnly = buildTranslationCommitMessage(5, before, after, {}, { description: ' Accents\n\nPonctuation ' });
  assert.equal(descriptionOnly.subject, automatic.subject);
  assert.equal(descriptionOnly.body, 'Accents\n\nPonctuation');
});

test('publie le nom et la description dans Git et conserve le message lors d’un nouvel envoi', async t => {
  const f = await syncFixture(t), s = await openGitCatalogue(f);
  writeLanguage(s.target, { ...s.read(), key_1: 'Bonjour' });
  const result = await synchronizeRunedelta({ ...s, push: true,
    commitMessage: { title: 'Répliques de Susie', description: 'Accents corrigés.\n\nPonctuation harmonisée.' } });
  assert.equal(result.pushed, true);
  assert.equal(runGit(f.remote, 'log', '-1', '--pretty=%B').trim(),
    'trad(ch5): Répliques de Susie\n\nAccents corrigés.\n\nPonctuation harmonisée.');
  const head = runGit(f.remote, 'rev-parse', 'main');
  await synchronizeRunedelta({ ...s, push: true, commitMessage: { title: 'Autre nom' } });
  assert.equal(runGit(f.remote, 'rev-parse', 'main'), head);
});

test('classe chaque ligne selon ta branche et main, et lit les PR fusionnées', () => {
  const { classifyPublication, parsePullRequest } = require('./runedelta-sync.js');
  assert.deepEqual(parsePullRequest('Merge pull request #83 from Traducteurs-Aurifiques/EvilChap5-2'), { pr: 83, from: 'EvilChap5-2' });
  assert.equal(parsePullRequest('trad(ch5): traduire 4 dialogues'), null);
  const original = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F' };
  const mainBase = { ...original, e: 'E publié' };
  const main = { ...mainBase, c: 'C main', f: 'F main' };
  const pushed = { ...mainBase, b: 'B branche', f: 'F branche' };
  const local = { ...pushed, d: 'D local' };
  const { keys, counts } = classifyPublication({ local, main, mainBase, pushed, original });
  assert.equal(keys.a, undefined);
  assert.equal(keys.b.state, 'pushed');
  assert.equal(keys.c.state, 'incoming');
  assert.equal(keys.d.state, 'local');
  assert.equal(keys.e.state, 'published');
  assert.deepEqual(keys.f, { state: 'pushed', mainChanged: true });
  assert.deepEqual(counts, { published: 1, pushed: 2, local: 1, incoming: 1 });
});

test('les PR fusionnées dans main arrivent sur la branche de travail et leur publication est datée', async t => {
  const { runedeltaPublication } = require('./runedelta-sync.js');
  const f = await syncFixture(t);
  runGit(f.seed, 'switch', '-c', 'Alex'); runGit(f.seed, 'push', '-u', 'origin', 'Alex');
  const s = await openGitCatalogue(f, 5, 'Alex');
  writeLanguage(s.target, { ...s.read(), key_2: 'Sur ma branche' });
  await synchronizeRunedelta({ ...s, push: true });
  writeLanguage(s.target, { ...s.read(), key_1: 'Brouillon local' });

  runGit(f.seed, 'switch', 'main'); runGit(f.seed, 'pull', '--ff-only');
  runGit(f.seed, 'switch', '-c', 'Autre');
  writeLanguage(path.join(f.seed, f.relative(5)), { ...f.published(5), key_3: 'Traduction fusionnée' });
  runGit(f.seed, 'commit', '-am', 'trad(ch5): traduire 1 dialogue');
  runGit(f.seed, 'switch', 'main');
  runGit(f.seed, 'merge', '--no-ff', '-m', 'Merge pull request #7 from Equipe/Autre', 'Autre'); runGit(f.seed, 'push');

  const before = await runedeltaPublication(s.config, s.directory, { fetch: true });
  assert.equal(before.ok, true);
  assert.equal(before.keys.key_1.state, 'local');
  assert.equal(before.keys.key_2.state, 'pushed');
  assert.equal(before.keys.key_3.state, 'incoming');
  assert.equal(before.keys.key_3.event.pr, 7);
  assert.deepEqual(before.waiting.map(event => event.lines), [1]);
  assert.equal(before.releases[0].from, 'Autre');

  const received = await synchronizeRunedelta({ ...s, receiveOnly: true });
  assert.equal(received.ok, true);
  assert.equal(s.read().key_3, 'Traduction fusionnée');
  assert.equal(s.read().key_1, 'Brouillon local');

  const published = await synchronizeRunedelta({ ...s, push: true });
  assert.equal(published.pushed, true);
  runGit(f.remote, 'merge-base', '--is-ancestor', 'main', 'Alex');
  assert.match(runGit(s.directory, 'log', '--format=%s', '-3'), /Merge branch 'main' into Alex/);
  const after = await runedeltaPublication(s.config, s.directory);
  assert.equal(after.keys.key_3.state, 'published');
  assert.equal(after.keys.key_3.event.pr, 7);
  assert.equal(after.keys.key_1.state, 'pushed');
  assert.equal(after.counts.incoming, 0);
  assert.equal(after.unpushedCommits, 0);
});

test('une ligne modifiée à la fois sur la branche et dans main demande une résolution explicite', async t => {
  const f = await syncFixture(t);
  runGit(f.seed, 'switch', '-c', 'Alex'); runGit(f.seed, 'push', '-u', 'origin', 'Alex');
  const s = await openGitCatalogue(f, 5, 'Alex');
  writeLanguage(s.target, { ...s.read(), key_4: 'Version de la branche' });
  await synchronizeRunedelta({ ...s, push: true });
  runGit(f.seed, 'switch', 'main');
  f.contribute(5, { key_4: 'Version de main' });
  const branchHead = runGit(f.remote, 'rev-parse', 'Alex');
  const first = await synchronizeRunedelta({ ...s, push: true });
  assert.equal(first.conflict, true);
  assert.equal(first.phase, 'main');
  assert.equal(runGit(f.remote, 'rev-parse', 'Alex'), branchHead);
  assert.equal(s.read().key_4, 'Version de la branche');
  const resolved = await synchronizeRunedelta({ ...s, push: true, conflictResolution: {
    main: { key_4: { choice: 'remote', expected: first.conflictDetails[0] } },
  } });
  assert.equal(resolved.pushed, true);
  assert.equal(s.read().key_4, 'Version de main');
  assert.equal(JSON.parse(runGit(f.remote, 'show', `Alex:${f.relative(5)}`)).key_4, 'Version de main');
});

test('les sprites importés partent sur la branche seulement à la publication, au format du dépôt', async t => {
  const { branchSpritesSync, gitBlobHash, parseSpriteTree } = require('./runedelta-sync.js');
  const f = await syncFixture(t);
  runGit(f.seed, 'switch', '-c', 'Alex');
  fs.mkdirSync(path.join(f.seed, 'sprites', 'spr_multi'), { recursive: true });
  fs.writeFileSync(path.join(f.seed, 'sprites', 'spr_multi', 'spr_multi_1.png'), 'ancienne frame 1');
  runGit(f.seed, 'add', '.'); runGit(f.seed, 'commit', '-m', 'sprites'); runGit(f.seed, 'push', '-u', 'origin', 'Alex');
  const s = await openGitCatalogue(f, 5, 'Alex');
  assert.deepEqual([...branchSpritesSync(s.directory).sprites.get('spr_multi').keys()], [1]);

  const imports = path.join(f.root, 'imports');
  fs.mkdirSync(imports);
  const png = (name, content) => { const file = path.join(imports, name); fs.writeFileSync(file, content); return file; };
  const sprites = [
    { name: 'spr_single', frame: 0, frames: 1, file: png('single.png', 'logo traduit') },
    { name: 'spr_multi', frame: 0, frames: 3, file: png('multi0.png', 'frame 0') },
    { name: 'spr_multi', frame: 1, frames: 3, file: png('multi1.png', 'frame 1 corrigée') },
  ];
  const received = await synchronizeRunedelta({ ...s, receiveOnly: true, sprites });
  assert.equal(received.ok, true);
  assert.equal(branchSpritesSync(s.directory).sprites.has('spr_single'), false);

  const published = await synchronizeRunedelta({ ...s, push: true, sprites });
  assert.equal(published.pushed, true);
  assert.equal(published.spritesPublished, 3);
  assert.equal(runGit(f.remote, 'show', 'Alex:sprites/spr_single.png'), 'logo traduit');
  assert.equal(runGit(f.remote, 'show', 'Alex:sprites/spr_multi/spr_multi_0.png'), 'frame 0');
  assert.equal(runGit(f.remote, 'show', 'Alex:sprites/spr_multi/spr_multi_1.png'), 'frame 1 corrigée');
  assert.match(runGit(s.directory, 'log', '-1', '--format=%s%n%b'), /sprites\/spr_single\.png/);
  const tree = branchSpritesSync(s.directory).sprites;
  assert.equal(tree.get('spr_single').get(0).blob, gitBlobHash(Buffer.from('logo traduit')));
  assert.equal(runGit(s.directory, 'status', '--porcelain'), '');

  const head = runGit(f.remote, 'rev-parse', 'Alex');
  const again = await synchronizeRunedelta({ ...s, push: true, sprites });
  assert.equal(again.spritesPublished, 0);
  assert.equal(runGit(f.remote, 'rev-parse', 'Alex'), head);
  assert.equal(parseSpriteTree('100644 blob ' + 'a'.repeat(40) + '\tsprites/WARNING NE PAS TRADspr_x.png\0').size, 0);
});

test("les sprites RUNEDELTA rejoignent le filtre à texte, y compris les variantes japonaises traduites", () => {
  const vm = require("node:vm");
  const { annotateRunedeltaSprite } = require("./runedelta-sync.js");
  const names = ["bg_building_diner", "spr_sign", "spr_sign_ja", "spr_other", "spr_other_ja"];
  const metadata = new Map(names.map(name => [name, { name }]));
  const text = require("./sprite-text.js").spriteTextSources(names, "");
  const repository = { branch: "Alex", sprites: new Map([
    ["bg_building_diner", new Map([[0, { blob: "a" }]])],
    ["spr_sign_ja", new Map([[0, { blob: "b" }]])],
  ]) };
  const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const catalogSource = source.slice(source.indexOf("function spriteCatalog("), source.indexOf("function spriteEntry("));
  const catalog = vm.runInNewContext(`(${catalogSource})`, {
    readSpriteMetadata: () => metadata,
    spriteOverrideRoot: () => "unused",
    readSpriteTextSources: () => text,
    dataWinAppliedAt: () => 0,
    runedeltaSprites: () => repository,
    buildSpriteEntry: item => ({ ...item, hasText: text.sources.has(item.name), translated: false, overrideFrames: [] }),
    annotateRunedeltaSprite,
  })({ languages: ["fr"] });
  for (const name of ["bg_building_diner", "spr_sign_ja"]) {
    const entry = catalog.find(entry => entry.name === name);
    assert.equal(entry?.hasText, true, name);
    assert.equal(entry.translated, true, name);
    assert.deepEqual(entry.runedelta.frames, [0]);
  }
  assert.equal(catalog.some(entry => entry.name === "spr_other_ja"), false);
  assert.equal(catalog.find(entry => entry.name === "spr_other").translated, false);
  const standalone = { name: "bg_building_diner", hasText: false, translated: false, overrideFrames: [] };
  assert.equal(annotateRunedeltaSprite(standalone, null, "unused"), standalone);
});
