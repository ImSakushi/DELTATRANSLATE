const fs = require("node:fs");
const path = require("node:path");
const { setupEnvironment } = require("dugite/build/lib/git-environment.js");

function commandEnvironment(command, overrides = {}, resourcesPath = /[\\/]app\.asar(?:[\\/]|$)/.test(__dirname) ? process.resourcesPath : undefined) {
  const root = resourcesPath
    ? path.join(resourcesPath, "tools", `${process.platform}-${process.arch}`)
    : path.join(__dirname, "vendor", "tools", `${process.platform}-${process.arch}`);
  const gitDir = path.join(root, "git");
  const gitPath = path.join(gitDir, process.platform === "win32" ? "cmd/git.exe" : "bin/git");
  const ghPath = path.join(root, "gh", "bin", process.platform === "win32" ? "gh.exe" : "gh");
  let env = { ...process.env, ...overrides };
  // Windows n'accepte qu'une variante de PATH ; Node choisit sinon la première.
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH");
  const inheritedPath = env[pathKey] ?? "";
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = inheritedPath;
  const hasGit = fs.existsSync(gitPath), hasGh = fs.existsSync(ghPath);
  if (resourcesPath && ((command === "git" && !hasGit) || (command === "gh" && !hasGh))) {
    throw new Error("Les outils Git intégrés sont incomplets. Réinstalle cette édition de DELTATRANSLATE.");
  }
  if (hasGit) {
    delete env.GIT_EXEC_PATH;
    env = setupEnvironment({ LOCAL_GIT_DIRECTORY: gitDir }, env).env;
    if (process.platform === "linux" && !env.GIT_SSL_CAINFO) env.GIT_SSL_CAINFO = path.join(gitDir, "ssl/cacert.pem");
  }
  env.PATH = [hasGit && path.dirname(gitPath), hasGh && path.dirname(ghPath), env.PATH,
    process.platform === "darwin" && "/opt/homebrew/bin:/usr/local/bin"].filter(Boolean).join(path.delimiter);
  if (hasGh && command === "git") {
    // Le helper reste propre aux processus de l'application, même en version portable.
    const count = Number(env.GIT_CONFIG_COUNT || 0);
    env[`GIT_CONFIG_KEY_${count}`] = "credential.https://github.com.helper";
    env[`GIT_CONFIG_VALUE_${count}`] = "!gh auth git-credential";
    env.GIT_CONFIG_COUNT = String(count + 1);
  }
  return { command: command === "git" && hasGit ? gitPath : command === "gh" && hasGh ? ghPath : command, env };
}

module.exports = { commandEnvironment };
