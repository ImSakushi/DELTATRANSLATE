const assert = require("node:assert/strict");
const test = require("node:test");
const { createGithubSetup, githubRepository } = require("./runedelta-github.js");

const remote = "https://github.com/equipe/projet.git";
const success = stdout => ({ code: 0, stdout, stderr: "" });

test("la configuration GitHub refuse les URL contenant des secrets et les autres hôtes", () => {
  assert.equal(githubRepository(remote), "equipe/projet");
  assert.equal(githubRepository("git@github.com:equipe/projet.git"), "equipe/projet");
  for (const url of ["https://token@github.com/equipe/projet", "https://github.com.evil/equipe/projet", "-commande", "file:///tmp/repo", "https://github.com/equipe/projet?token=secret"]) assert.throws(() => githubRepository(url));
});

test("la connexion guidée vérifie le compte, configure Git et ne demande jamais de token", async () => {
  const calls = [], messages = [];
  const api = createGithubSetup(async (command, args, options) => {
    calls.push([command, ...args]);
    if (args.includes("login")) options.onOutput("Code à usage unique : ABCD-EFGH");
    return success(args[0] === "api" ? '{"login":"alice","id":123}' : "ok");
  });
  const result = await api.login(text => messages.push(text));
  assert.equal(result.login, "alice");
  assert.deepEqual(result.identity, { name: "alice", email: "123+alice@users.noreply.github.com" });
  assert.deepEqual(calls.map(call => call.slice(1, 3)), [["--version"], ["auth", "login"], ["api", "--hostname"]]);
  assert.equal(calls.flat().includes("token"), false);
  assert.equal(messages.length, 1);
});

test("GitHub CLI manquant ou une connexion refusée n’enregistre aucune identité", async () => {
  for (const failure of ["--version", "auth"]) {
    const calls = [];
    const api = createGithubSetup(async (command, args) => {
      calls.push(args);
      return args[0] === failure ? { code: 1, stdout: "", stderr: "refusé" } : success("ok");
    });
    await assert.rejects(api.login(() => {}), failure === "--version" ? /Installe GitHub CLI/ : /annulée/);
    assert.equal(calls.some(args => args.includes("setup-git")), false);
  }
});

test("la connexion ouvre la page officielle une seule fois, même si son URL arrive en plusieurs morceaux", async () => {
  let opened = 0;
  const api = createGithubSetup(async (_command, args, options) => {
    if (args.includes("login")) {
      for (const text of ["Code : ABCD-EFGH\nhttps://github.com/", "login/device\n", "https://github.com/login/device\n"]) options.onOutput(text);
    }
    return success(args[0] === "api" ? '{"login":"alice","id":123}' : "ok");
  });
  await api.login(() => {}, () => opened++);
  assert.equal(opened, 1);
});

test("la vérification distingue les droits Git réels et les droits du compte GitHub CLI", async () => {
  const calls = [];
  const api = createGithubSetup(async (command, args, options) => {
    calls.push([command, args]);
    if (command === "git" && args[0] === "ls-remote") {
      assert.equal(options.env.GCM_INTERACTIVE, "never");
      return { code: 128, stdout: "", stderr: "Accès refusé" };
    }
    if (args.includes("user")) return success('{"login":"alice","id":123}');
    return success(args.includes(".permissions.push") ? "true" : "ok");
  });
  const result = await api.check(remote);
  assert.equal(result.readAccess, false);
  assert.equal(result.githubPermission, true);
  assert.equal(result.login, "alice");
  assert.equal(calls.some(([, args]) => args.includes("push") || args.includes("setup-git")), false);
});

test("les identifiants Git existants fonctionnent sans GitHub CLI", async () => {
  const api = createGithubSetup(async command => command === "gh" ? { code: -1, stdout: "", stderr: "ENOENT" } : success("ok"));
  const result = await api.check(remote);
  assert.equal(result.readAccess, true);
  assert.equal(result.ghAvailable, false);
  assert.equal(result.login, null);
  assert.equal(result.githubPermission, null);
});
