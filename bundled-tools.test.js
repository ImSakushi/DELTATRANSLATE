const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { commandEnvironment } = require("./bundled-tools.js");

test("Git et GitHub CLI fonctionnent sans installation système, depuis un chemin avec espaces", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deltatranslate outils "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(__dirname, "vendor/tools");
  assert.ok(fs.existsSync(source), "Lancer npm run prepare:tools avant ces tests");
  fs.symlinkSync(source, path.join(root, "tools"), process.platform === "win32" ? "junction" : "dir");
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const overrides = { PATH: "", HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: path.join(home, "gitconfig"), GIT_TERMINAL_PROMPT: "0" };
  const git = commandEnvironment("git", overrides, root);
  const gh = commandEnvironment("gh", overrides, root);
  const run = args => execFileSync(git.command, args, { env: git.env, cwd: root, encoding: "utf8", windowsHide: true });
  assert.match(run(["--version"]), /git version/);
  assert.match(execFileSync(gh.command, ["--version"], { env: gh.env, encoding: "utf8", windowsHide: true }), /gh version/);
  run(["init", "-b", "main", "source"]);
  fs.writeFileSync(path.join(root, "source", "traduction.txt"), "Bonjour éàç\n");
  run(["-C", "source", "add", "."]);
  run(["-C", "source", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "test: traduction"]);
  run(["clone", "source", "copie"]);
  assert.match(fs.readFileSync(path.join(root, "copie/traduction.txt"), "utf8"), /Bonjour éàç/);
  // Exécute réellement gh depuis le shell de Git sans accéder à un compte.
  assert.match(run(["-c", "alias.ghversion=!gh --version", "ghversion"]), /gh version/);
  assert.equal(fs.existsSync(path.join(home, "gitconfig")), false);
  assert.equal(Object.keys(git.env).filter(key => key.toUpperCase() === "PATH").length, 1);
});

test("une distribution incomplète échoue explicitement au lieu d'utiliser le Git du système", () => {
  assert.throws(() => commandEnvironment("git", {}, path.join(os.tmpdir(), "outils-absents")), /incomplets/);
  assert.throws(() => commandEnvironment("gh", {}, path.join(os.tmpdir(), "outils-absents")), /incomplets/);
});
