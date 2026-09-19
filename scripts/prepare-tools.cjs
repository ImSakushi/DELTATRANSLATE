const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const extractZip = require("extract-zip");
const gitVersions = require("dugite/script/embedded-git.json");

const ghVersion = "2.101.0";
const ghAssets = {
  "win32-x64": ["windows_amd64.zip", "bc6c814367b193cd8e713611d61e36013c0ef843b8f516458fe3eda039192794"],
  "darwin-x64": ["macOS_amd64.zip", "a6fd66c88e2f07d6e4e058173db341d07dd74d58cf8f19ae668293d2bb614ca3"],
  "darwin-arm64": ["macOS_arm64.zip", "e4303e39d8f07141c4bad4b99b01079f05029c59b27076e8fbc825c985ecdd8b"],
  "linux-x64": ["linux_amd64.tar.gz", "9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8"],
};

async function unpack(url, checksum, destination, strip = false) {
  const marker = path.join(destination, ".sha256");
  if (await fs.readFile(marker, "utf8").catch(() => "") === checksum) return;
  console.log(`Préparation de ${path.basename(url)}…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Téléchargement refusé : HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== checksum) throw new Error(`Somme SHA-256 incorrecte : ${url}`);
  await fs.mkdir(destination, { recursive: true });
  const archive = path.join(path.dirname(destination), path.basename(url));
  await fs.writeFile(archive, data);
  if (url.endsWith(".zip") && !strip) await extractZip(archive, { dir: destination });
  else execFileSync("tar", ["-xf", archive, "-C", destination, ...(strip ? ["--strip-components=1"] : [])], { windowsHide: true });
  await fs.unlink(archive);
  await fs.writeFile(marker, checksum);
}

async function main() {
  const arches = process.platform === "darwin" ? ["x64", "arm64"] : ["x64"];
  for (const arch of arches) {
    const key = `${process.platform}-${arch}`;
    const git = gitVersions[key], gh = ghAssets[key];
    if (!git || !gh) throw new Error(`Plateforme non prise en charge : ${key}`);
    const root = path.resolve(__dirname, "../vendor/tools", key);
    await unpack(git.url, git.checksum, path.join(root, "git"));
    await unpack(`https://github.com/cli/cli/releases/download/v${ghVersion}/gh_${ghVersion}_${gh[0]}`, gh[1], path.join(root, "gh"), process.platform !== "win32");
    if (process.platform !== "win32") await fs.chmod(path.join(root, "gh/bin/gh"), 0o755);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
