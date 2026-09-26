import { spawn, spawnSync } from "node:child_process";

export function icuFallbackEnvironment(result, env = process.env, platform = process.platform) {
  if (platform !== "linux" || result.status === 0 || env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT != null) return null;
  // .NET abandonne au démarrage, avant le chargement du jeu et des scripts.
  // Ne jamais relancer une erreur de compilation ou d’écriture UTMT.
  if (!/Couldn't find a valid ICU package installed on the system/i.test(String(result.stderr) + String(result.stdout))) return null;
  return { ...env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1", DOTNET_SYSTEM_GLOBALIZATION_PREDEFINED_CULTURES_ONLY: "0" };
}

const icuNotice = "ICU introuvable : relance d’UTMT avec la globalisation .NET invariante pour ce processus uniquement.\n";

export function runToolSync(executable, args, options = {}) {
  const settings = { windowsHide: true, ...options };
  const result = spawnSync(executable, args, settings);
  const env = icuFallbackEnvironment(result, options.env);
  if (!env) return result;
  process.stderr.write(icuNotice);
  return spawnSync(executable, args, { ...settings, env });
}

export async function runTool(executable, args) {
  const result = await runOnce(executable, args);
  const env = icuFallbackEnvironment(result);
  if (!env) return result;
  process.stdout.write(icuNotice);
  return runOnce(executable, args, env);
}

function runOnce(executable, args, env = process.env) {
  return new Promise(resolve => {
    const child = spawn(executable, args, { windowsHide: true, env });
    // UTMT lit l’entrée redirigée avant de charger l’archive. Les scripts
    // non interactifs doivent recevoir EOF pour ne pas rester bloqués.
    child.stdin.end();
    let stdout = "", stderr = "";
    for (const [stream, error] of [[child.stdout, false], [child.stderr, true]]) {
      stream.on("data", chunk => {
        const text = chunk.toString();
        process.stdout.write(text);
        if (error) stderr = (stderr + text).slice(-64000);
        else stdout = (stdout + text).slice(-64000);
      });
    }
    child.on("error", error => resolve({ status: -1, error, stdout, stderr }));
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}
