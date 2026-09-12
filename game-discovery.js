const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

function steamLibraryPaths(source) {
  return [...source.matchAll(/"path"\s*"((?:\\.|[^"\\])*)"/gi)]
    .map((match) => match[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"'));
}

async function readText(file) {
  try { return await fs.readFile(file, "utf8"); } catch { return ""; }
}

async function directoryEntries(directory) {
  try { return await fs.readdir(directory, { withFileTypes: true }); } catch { return []; }
}

async function validateDataWin(file) {
  if (typeof file !== "string" || path.basename(file).toLowerCase() !== "data.win") {
    return { ok: false, error: "Choisis le fichier data.win du chapitre, dans le dossier de DELTARUNE." };
  }
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, 8, 0);
    if (!stat.isFile() || bytesRead !== 8 || header.toString("ascii", 0, 4) !== "FORM" || stat.size <= 8) {
      return { ok: false, error: "Ce fichier n’est pas un data.win GameMaker valide. Sélectionne celui de ton installation de DELTARUNE." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Ce fichier est introuvable ou illisible. Vérifie que le jeu est installé et que son dossier est accessible." };
  } finally {
    await handle?.close();
  }
}

async function findChapters(root) {
  const found = [];
  const queue = [{ directory: root, depth: 0 }];
  // Recherche bornée aux dossiers du jeu, sans suivre les liens ni parcourir le disque.
  while (queue.length) {
    const { directory, depth } = queue.shift();
    const entries = await directoryEntries(directory);
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === "data.win") {
        if (!(await validateDataWin(file)).ok) continue;
        const chapter = file.match(/chapter[ _-]?(\d+)/i)?.[1];
        found.push({ path: file, label: chapter ? `Chapitre ${chapter}` : "DELTARUNE", installation: root, chapter: chapter ? Number(chapter) : null });
      } else if (entry.isDirectory() && depth < 4 &&
        /^(chapter[ _-]?\d+.*|DELTARUNE.*\.app|Contents|Resources)$/i.test(entry.name)) {
        queue.push({ directory: file, depth: depth + 1 });
      }
    }
  }
  // Le data.win à la racine sert au lanceur quand des chapitres sont présents.
  const chapters = found.some((item) => item.chapter) ? found.filter((item) => item.chapter) : found;
  return chapters.sort((a, b) => a.path.localeCompare(b.path, "fr", { numeric: true }));
}

async function defaultSteamRoots() {
  const home = os.homedir();
  if (process.platform === "win32") {
    let registered = "";
    try {
      const { stdout } = await promisify(execFile)("reg.exe", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { windowsHide: true, timeout: 3000 });
      registered = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)?.[1]?.trim() ?? "";
    } catch {}
    return [registered, ...[process.env["ProgramFiles(x86)"], process.env.ProgramFiles]
      .filter(Boolean).map((directory) => path.join(directory, "Steam"))].filter(Boolean);
  }
  if (process.platform === "darwin") return [path.join(home, "Library", "Application Support", "Steam")];
  return [path.join(home, ".steam", "steam"), path.join(home, ".local", "share", "Steam"),
    path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam")];
}

async function discoverChapters({ steamRoots, currentDataWin } = {}) {
  const roots = steamRoots ?? await defaultSteamRoots();
  const libraries = new Set(roots);
  for (const root of roots) {
    for (const library of steamLibraryPaths(await readText(path.join(root, "steamapps", "libraryfolders.vdf")))) {
      libraries.add(library);
    }
  }
  const installations = new Set();
  if (currentDataWin) {
    installations.add(path.dirname(currentDataWin));
    installations.add(path.dirname(path.dirname(currentDataWin)));
  }
  for (const library of libraries) {
    const common = path.join(library, "steamapps", "common");
    for (const entry of await directoryEntries(common)) {
      if (entry.isDirectory() && /^DELTARUNE(?:$|[ _-])/i.test(entry.name)) {
        installations.add(path.join(common, entry.name));
      }
    }
  }
  const chapters = new Map();
  for (const installation of installations) {
    for (const chapter of await findChapters(installation)) {
      const real = await fs.realpath(chapter.path).catch(() => chapter.path);
      const key = process.platform === "win32" ? real.toLowerCase() : real;
      if (!chapters.has(key)) chapters.set(key, chapter);
    }
  }
  return [...chapters.values()];
}

module.exports = { discoverChapters, findChapters, steamLibraryPaths, validateDataWin };
