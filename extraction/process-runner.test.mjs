import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { icuFallbackEnvironment, runTool, runToolSync } from "./process-runner.mjs";

const failure = { status: null, stderr: "Process terminated. Couldn't find a valid ICU package installed on the system." };

test("seul le démarrage Linux sans ICU bénéficie d'un repli .NET local", () => {
  const env = { PATH: "/usr/bin", CUSTOM: "conservé" };
  const fallback = icuFallbackEnvironment(failure, env, "linux");
  assert.equal(fallback.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT, "1");
  assert.equal(fallback.DOTNET_SYSTEM_GLOBALIZATION_PREDEFINED_CULTURES_ONLY, "0");
  assert.equal(fallback.CUSTOM, "conservé");
  assert.equal(env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT, undefined);
  for (const platform of ["win32", "darwin"]) assert.equal(icuFallbackEnvironment(failure, env, platform), null);
  assert.equal(icuFallbackEnvironment({ status: 1, stderr: "Compilation échouée" }, env, "linux"), null);
  assert.equal(icuFallbackEnvironment({ ...failure, status: 0 }, env, "linux"), null);
  assert.equal(icuFallbackEnvironment(failure, { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "0" }, "linux"), null);
});

test("les lanceurs attendent EOF et conservent les sorties et le code d'erreur", async () => {
  const args = ["-e", "process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('terminé'); process.stderr.write('erreur test'); process.exitCode = 7; });"];
  for (const result of [await runTool(process.execPath, args), runToolSync(process.execPath, args, { encoding: "utf8" })]) {
    assert.equal(result.status, 7);
    assert.equal(result.stdout, "terminé");
    assert.equal(result.stderr, "erreur test");
  }
});

test("les deux lanceurs relancent réellement une fois après le diagnostic ICU simulé", () => {
  const moduleUrl = new URL("./process-runner.mjs", import.meta.url).href;
  const child = `if (!process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT) { process.stderr.write("Couldn't find a valid ICU package installed on the system."); process.exit(1); } process.stdout.write('accents éàç');`;
  const program = `
    import assert from 'node:assert/strict';
    import { runTool, runToolSync } from ${JSON.stringify(moduleUrl)};
    Object.defineProperty(process, 'platform', { value: 'linux' });
    delete process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT;
    const child = ${JSON.stringify(child)};
    for (const result of [await runTool(process.execPath, ['-e', child]), runToolSync(process.execPath, ['-e', child], { encoding: 'utf8' })]) {
      assert.equal(result.status, 0);
      assert.equal(result.stdout, 'accents éàç');
    }
    assert.equal(process.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT, undefined);
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", program], { stdio: "pipe" });
});
