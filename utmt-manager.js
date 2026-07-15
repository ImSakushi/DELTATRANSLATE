const fs = require("fs");
const path = require("path");
const https = require("https");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const extract = require("extract-zip");

const RELEASE_API =
  "https://api.github.com/repos/UnderminersTeam/UndertaleModTool/releases/latest";

function executableNames() {
  return process.platform === "win32"
    ? ["UndertaleModCli.exe"]
    : ["UndertaleModCli"];
}

function findUtmtCli(candidate, maxDepth = 2) {
  if (!candidate || !fs.existsSync(candidate)) return null;
  const stat = fs.statSync(candidate);
  if (stat.isFile()) {
    return executableNames().includes(path.basename(candidate)) ? candidate : null;
  }

  const queue = [{ dir: candidate, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    for (const name of executableNames()) {
      const cli = path.join(dir, name);
      if (fs.existsSync(cli) && fs.statSync(cli).isFile()) return cli;
    }
    if (depth >= maxDepth) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "DELTATRANSLATE",
          Accept: "application/vnd.github+json",
          ...options.headers,
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          resolve(request(new URL(res.headers.location, url).toString(), options));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => reject(new Error(`GitHub a répondu ${res.statusCode}: ${body.slice(0, 300)}`)));
          return;
        }
        resolve(res);
      }
    );
    req.on("error", reject);
  });
}

async function getLatestRelease() {
  const res = await request(RELEASE_API);
  let body = "";
  res.setEncoding("utf8");
  for await (const chunk of res) body += chunk;
  return JSON.parse(body);
}

function platformAssetSuffix() {
  if (process.platform === "win32") return "Windows";
  if (process.platform === "darwin") return "macOS";
  if (process.platform === "linux") return "Ubuntu";
  throw new Error(`Système non pris en charge par UTMT CLI : ${process.platform}`);
}

async function download(url, destination, expectedBytes, onProgress) {
  const res = await request(url, { headers: { Accept: "application/octet-stream" } });
  const total = Number(res.headers["content-length"]) || expectedBytes || 0;
  let received = 0;
  let lastPercent = -1;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      const percent = total ? Math.floor((received / total) * 100) : 0;
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress?.({ phase: "download", percent, received, total });
      }
      callback(null, chunk);
    },
  });
  await pipeline(res, progress, fs.createWriteStream(destination));
}

async function installLatestUtmt(installRoot, onProgress = () => {}) {
  onProgress({ phase: "release", message: "Recherche de la dernière version d’UTMT…" });
  const release = await getLatestRelease();
  const suffix = platformAssetSuffix();
  const pattern = new RegExp(`^UTMT_CLI_v.+-${suffix}\\.zip$`, "i");
  const asset = release.assets.find((item) => pattern.test(item.name));
  if (!asset) throw new Error(`Aucune archive UTMT CLI ${suffix} dans la release ${release.tag_name}.`);

  const version = String(release.tag_name || release.name).replace(/^v/i, "");
  const destination = path.join(installRoot, version);
  const existing = findUtmtCli(destination);
  if (existing) return { version, directory: path.dirname(existing), cliPath: existing, asset: asset.name };

  fs.mkdirSync(installRoot, { recursive: true });
  const archive = path.join(installRoot, `${asset.name}.part`);
  fs.rmSync(archive, { force: true });
  onProgress({ phase: "download", percent: 0, message: `Téléchargement de ${asset.name}…` });
  await download(asset.browser_download_url, archive, asset.size, onProgress);

  const temporary = `${destination}.tmp-${process.pid}`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true });
  onProgress({ phase: "extract", message: "Extraction de l’archive UTMT…" });
  try {
    await extract(archive, { dir: temporary });
    const cli = findUtmtCli(temporary, 3);
    if (!cli) throw new Error("L’archive ne contient pas l’exécutable UndertaleModCli attendu.");
    if (process.platform !== "win32") fs.chmodSync(cli, 0o755);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  const cliPath = findUtmtCli(destination, 3);
  if (!cliPath) throw new Error("UTMT a été extrait, mais son exécutable reste introuvable.");
  onProgress({ phase: "done", percent: 100, message: `UTMT CLI ${version} est installé.` });
  return { version, directory: path.dirname(cliPath), cliPath, asset: asset.name };
}

module.exports = { findUtmtCli, getLatestRelease, installLatestUtmt };
