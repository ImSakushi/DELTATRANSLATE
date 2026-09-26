// Retrouve la frame visée par un PNG d'après son nom :
// « spr_x_3.png » (export de l'outil), « spr_x_fr_3.png » (variante) ou « 3.png »
// (dossier d'imports, pour le sprite sélectionné).
export function frameFromFileName(fileName, lookup, currentName = null) {
  const stem = String(fileName ?? "").replace(/\.png$/i, "");
  if (/^\d+$/.test(stem)) return currentName ? { name: currentName, frame: Number(stem) } : null;
  const match = stem.match(/^([A-Za-z0-9_]+)_(\d+)$/);
  if (!match) return null;
  const [, name, digits] = match;
  const frame = Number(digits);
  if (lookup(name)) return { name, frame };
  const variant = name.match(/^(.+)_[a-z]{2,3}$/);
  if (variant && lookup(variant[1])?.targetName === name) return { name: variant[1], frame };
  return null;
}

export function spriteState(entry) {
  if (entry.pendingFrames?.length) return { key: "pending", label: "À appliquer" };
  // Mode Runedelta : l'état vient du dernier commit de ta branche, mis à jour à chaque publication.
  if (entry.runedelta?.unpublishedFrames?.length) return { key: "unpublished", label: "À publier" };
  if (entry.overrideFrames?.length) return { key: "imported", label: entry.runedelta ? "✓ Publié" : "✓ Importé" };
  if (entry.runedelta?.frames?.length) return { key: "published", label: "✓ Sur Runedelta" };
  if (entry.variant && !entry.variantGenerated) return { key: "done", label: "✓ Traduit" };
  if (entry.hasText) return { key: "todo", label: "À traduire" };
  return { key: "none", label: "" };
}
