export function planMigration(previousReference, reference, language) {
  const sources = new Map();
  for (const [key, entry] of Object.entries(previousReference)) {
    if (typeof language[key] !== "string" || language[key] === entry.en) continue;
    const signature = JSON.stringify([entry.file, entry.en]);
    sources.set(signature, [...(sources.get(signature) ?? []), key]);
  }
  const suggestions = {};
  const review = [];
  for (const [key, entry] of Object.entries(reference)) {
    if (Object.hasOwn(language, key)) {
      if (previousReference[key] && previousReference[key].en !== entry.en) review.push(key);
      continue;
    }
    const candidates = sources.get(JSON.stringify([entry.file, entry.en])) ?? [];
    if (candidates.length === 1) suggestions[key] = { from: candidates[0], value: language[candidates[0]] };
  }
  return { suggestions, review, orphaned: Object.keys(language).filter(key => key !== "date" && !Object.hasOwn(reference, key)) };
}
