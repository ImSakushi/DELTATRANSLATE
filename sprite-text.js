// Détection des sprites contenant du texte, d'après la localisation japonaise
// du jeu : scr_84_init_localization remplace chaque sprite à texte par
// ds_map_add(sm, "<sprite>", <sprite japonais>) quand global.lang == "ja".
const MAP_ADD = /ds_map_add\(\s*sm\s*,\s*"([A-Za-z0-9_]+)"\s*,\s*([A-Za-z0-9_]+)\s*\)/g;

function parseLocalizedSpriteMap(gml) {
  const map = new Map();
  for (const [, base, localized] of String(gml ?? "").matchAll(MAP_ADD)) {
    if (base !== localized) map.set(base, localized);
  }
  return map;
}

// Renvoie les sprites à texte (base → sprite japonais) et l'ensemble des
// sprites japonais eux-mêmes, inutiles pour une traduction.
function spriteTextSources(names, gml) {
  const known = names instanceof Set ? names : new Set(names);
  const sources = new Map();
  for (const [base, localized] of parseLocalizedSpriteMap(gml)) {
    if (known.has(base)) sources.set(base, localized);
  }
  for (const name of known) {
    let base = null;
    if (name.endsWith("_ja")) base = name.slice(0, -3);
    else if (name.startsWith("spr_ja_")) base = `spr_${name.slice(7)}`;
    if (base && known.has(base) && !sources.has(base)) sources.set(base, name);
  }
  const japanese = new Set([...sources.values()].filter((name) => known.has(name)));
  return { sources, japanese };
}

module.exports = { parseLocalizedSpriteMap, spriteTextSources };
