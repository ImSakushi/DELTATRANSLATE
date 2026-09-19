const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

test("les deux éditions publient des fichiers et des canaux distincts sous la même version", () => {
  for (const edition of ["standard", "bundled"]) {
    const config = JSON.parse(execFileSync(process.execPath, ["-e", "console.log(JSON.stringify(require('./electron-builder.config.cjs')))"], {
      cwd: __dirname, env: { ...process.env, DELTATRANSLATE_EDITION: edition }, encoding: "utf8", windowsHide: true,
    }));
    const bundled = edition === "bundled";
    assert.equal(config.extraMetadata.bundledGit, bundled);
    assert.equal(config.extraResources.some(resource => resource.to === "tools"), bundled);
    assert.equal(config.publish[0].channel, bundled ? "bundled" : "latest");
    for (const target of ["nsis", "portable", "mac", "linux"]) assert.equal(config[target].artifactName.includes("Avec-Git"), bundled);
    assert.ok(config.files.includes("release-check.js"));
    assert.ok(config.files.includes("!node_modules/dugite/git/**/*"));
  }
});
