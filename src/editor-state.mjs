export function mergeSavedEdits(current, snapshot, saved) {
  const language = { ...saved };
  for (const key of new Set([...Object.keys(snapshot), ...Object.keys(current)])) {
    if (Object.hasOwn(current, key) === Object.hasOwn(snapshot, key) && current[key] === snapshot[key]) continue;
    if (Object.hasOwn(current, key)) language[key] = current[key];
    else delete language[key];
  }
  return language;
}

export function catalogKeys(language, reference) {
  return [...new Set([...Object.keys(language), ...Object.keys(reference)])].filter(key => key !== "date");
}
