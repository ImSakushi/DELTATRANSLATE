const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const yaml = require("js-yaml");
const root = path.resolve(process.argv[2] || "release-assets");
const version = require("../package.json").version;

for (const channel of ["latest", "bundled"]) {
  for (const suffix of ["", "-mac", "-linux"]) {
    const name = `${channel}${suffix}.yml`;
    const info = yaml.load(fs.readFileSync(path.join(root, name), "utf8"));
    if (info.version !== version || !info.files?.length) throw new Error(`Métadonnées invalides : ${name}`);
    for (const file of info.files) {
      if (path.basename(file.url) !== file.url || file.url.includes("Avec-Git") !== (channel === "bundled")) throw new Error(`Mauvaise édition : ${file.url}`);
      const bytes = fs.readFileSync(path.join(root, file.url));
      if (createHash("sha512").update(bytes).digest("base64") !== file.sha512 || bytes.length !== file.size) throw new Error(`Fichier incohérent : ${file.url}`);
    }
    if (!info.files.some(file => file.url === info.path && file.sha512 === info.sha512)) throw new Error(`Chemin principal incohérent : ${name}`);
    console.log(`Canal vérifié : ${name}`);
  }
}

for (const edition of ["", "-Avec-Git"]) {
  for (const filename of [
    `DELTATRANSLATE${edition}-Setup-${version}-Windows-x64.exe`,
    `DELTATRANSLATE${edition}-${version}-Windows-Portable-x64.exe`,
    `DELTATRANSLATE${edition}-${version}-macOS-universal.dmg`,
    `DELTATRANSLATE${edition}-${version}-macOS-universal.zip`,
    `DELTATRANSLATE${edition}-${version}-Linux-x86_64.AppImage`,
    `DELTATRANSLATE${edition}-${version}-Linux-amd64.deb`,
  ]) {
    if (fs.statSync(path.join(root, filename)).size < 1_000_000) throw new Error(`Livrable incomplet : ${filename}`);
  }
}
console.log("Les deux éditions sont complètes et leurs métadonnées correspondent aux fichiers.");
