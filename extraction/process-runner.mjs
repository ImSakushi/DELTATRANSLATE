import { spawn } from "node:child_process";

export function runTool(executable, args) {
  return new Promise(resolve => {
    const child = spawn(executable, args, { windowsHide: true });
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
