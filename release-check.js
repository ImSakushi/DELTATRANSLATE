const RELEASE_URL = "https://github.com/ImSakushi/DELTATRANSLATE/releases/latest";

function newerVersion(candidate, installed) {
  const parse = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  const next = parse(candidate), current = parse(installed);
  if (!next || !current) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(next[i]) !== Number(current[i])) return Number(next[i]) > Number(current[i]);
  }
  return false;
}

async function checkRelease(version, request = fetch) {
  const response = await request("https://api.github.com/repos/ImSakushi/DELTATRANSLATE/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "DELTATRANSLATE" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Vérification GitHub impossible (HTTP ${response.status}).`);
  const release = await response.json();
  if (release.draft || release.prerelease || !newerVersion(release.tag_name, version)) return null;
  return { version: release.tag_name.replace(/^v/, ""), releaseNotes: release.body, manual: true };
}

module.exports = { RELEASE_URL, newerVersion, checkRelease };
