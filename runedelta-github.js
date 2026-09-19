const { runCommand } = require("./runedelta-sync.js");

function githubRepository(remoteUrl) {
  const match = String(remoteUrl ?? "").trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)\/?$/i);
  if (!match) throw new Error("Utilise une URL GitHub HTTPS sans identifiant ni token, ou git@github.com:équipe/dépôt.git.");
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

function createGithubSetup(run = runCommand) {
  async function profile() {
    const result = await run("gh", ["api", "--hostname", "github.com", "user", "--jq", "{login,id}"], { timeoutMs: 20_000 });
    if (result.code !== 0) return null;
    try {
      const user = JSON.parse(result.stdout);
      return /^[\w-]+$/.test(user.login) && Number.isSafeInteger(user.id) ? user : null;
    } catch { return null; }
  }

  async function check(remoteUrl) {
    const repository = githubRepository(remoteUrl);
    const [git, gh] = await Promise.all([
      run("git", ["--version"], { timeoutMs: 10_000 }),
      run("gh", ["--version"], { timeoutMs: 10_000 }),
    ]);
    const user = gh.code === 0 ? await profile() : null;
    const access = git.code === 0 ? await run("git", ["ls-remote", "--exit-code", "--", remoteUrl, "HEAD"], {
      timeoutMs: 30_000, env: { GCM_INTERACTIVE: "never" },
    }) : null;
    let githubPermission = null;
    if (user) {
      const result = await run("gh", ["api", "--hostname", "github.com", `repos/${repository}`, "--jq", ".permissions.push"], { timeoutMs: 20_000 });
      if (result.code === 0 && /^(true|false)$/.test(result.stdout.trim())) githubPermission = result.stdout.trim() === "true";
    }
    return { ok: true, gitAvailable: git.code === 0, ghAvailable: gh.code === 0, login: user?.login ?? null,
      readAccess: access?.code === 0, githubPermission,
      message: access?.code === 0 ? "Accès Git en lecture vérifié." : "Accès Git refusé ou réseau indisponible. Accepte l’invitation au dépôt privé, puis connecte GitHub ou configure tes identifiants Git." };
  }

  async function login(onOutput) {
    const available = await run("gh", ["--version"], { timeoutMs: 10_000 });
    if (available.code !== 0) throw new Error("Installe GitHub CLI via le lien ci-dessous, puis relance DELTATRANSLATE. Tu peux aussi utiliser tes identifiants Git existants.");
    const result = await run("gh", ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--skip-ssh-key"], {
      timeoutMs: 180_000, onOutput, env: { GH_PROMPT_DISABLED: "1" },
    });
    if (result.code !== 0) throw new Error("Connexion GitHub annulée, expirée ou refusée. Consulte les indications de connexion puis réessaie.");
    const user = await profile();
    if (!user) throw new Error("Impossible de vérifier le compte GitHub après connexion.");
    const configured = await run("gh", ["auth", "setup-git", "--hostname", "github.com"], { timeoutMs: 20_000 });
    if (configured.code !== 0) throw new Error("Compte connecté, mais configuration Git impossible. Exécute gh auth setup-git --hostname github.com dans un terminal.");
    return { ok: true, login: user.login, identity: { name: user.login, email: `${user.id}+${user.login}@users.noreply.github.com` } };
  }
  return { check, login };
}

module.exports = { createGithubSetup, githubRepository };
