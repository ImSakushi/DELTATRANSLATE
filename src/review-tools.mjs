function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

function modal(title) {
  const previous = document.activeElement;
  const dialog = element("dialog");
  dialog.className = "review-dialog";
  const heading = element("h2", title, dialog);
  heading.id = "review-dialog-title";
  dialog.setAttribute("aria-labelledby", heading.id);
  const content = element("div", null, dialog);
  content.className = "review-content";
  const footer = element("div", null, dialog);
  footer.className = "review-actions";
  const close = element("button", "Fermer", footer);
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", () => { dialog.remove(); previous?.focus(); });
  document.body.appendChild(dialog);
  dialog.showModal();
  return { dialog, content, footer, close };
}

function pagedResults(parent, render) {
  const search = element("input", null, parent);
  search.type = "search";
  search.placeholder = "Filtrer les résultats…";
  search.setAttribute("aria-label", "Filtrer les résultats");
  const counter = element("p", "", parent);
  const list = element("div", null, parent);
  const more = element("button", "Afficher 100 résultats de plus", parent);
  let items = [], limit = 100;
  function refresh() {
    const query = search.value.trim().toLowerCase();
    const filtered = query ? items.filter(item => JSON.stringify(item).toLowerCase().includes(query)) : items;
    list.replaceChildren();
    for (const item of filtered.slice(0, limit)) render(item, list);
    counter.textContent = `${Math.min(limit, filtered.length)} / ${filtered.length} résultats affichés`;
    more.hidden = filtered.length <= limit;
  }
  search.oninput = () => { limit = 100; refresh(); };
  more.onclick = () => { limit += 100; refresh(); };
  return { update(next) { items = next; refresh(); } };
}

export async function resolveConflicts(result) {
  const { dialog, content, footer, close } = modal("Résoudre les conflits de traduction");
  close.textContent = "Annuler";
  element("p", "Choisis une version pour chaque ligne, ou saisis une traduction. Aucune publication n’a lieu avant validation.", content);
  const selections = new Map();
  for (const item of result.conflictDetails ?? []) {
    const row = element("section", null, content);
    element("h3", item.key, row);
    const columns = element("div", null, row);
    columns.className = "review-columns";
    for (const [label, value] of [["Base commune", item.base], ["Local", item.local], ["Distant", item.remote]]) {
      const column = element("div", null, columns);
      element("b", label, column);
      element("pre", value ?? "Clé supprimée", column);
    }
    const select = element("select", null, row);
    select.setAttribute("aria-label", `Résolution de ${item.key}`);
    for (const [value, label] of [["", "Choisir…"], ["local", "Version locale"], ["remote", "Version distante"], ["custom", "Modifier la traduction"]]) {
      const option = element("option", label, select); option.value = value;
    }
    const input = element("textarea", null, row);
    input.value = item.local ?? item.remote ?? "";
    input.setAttribute("aria-label", `Traduction de ${item.key}`);
    input.hidden = true;
    selections.set(item.key, { select, input, expected: { base: item.base, local: item.local, remote: item.remote } });
    select.onchange = () => {
      input.hidden = select.value !== "custom";
      apply.disabled = [...selections.values()].some(item => !item.select.value);
    };
  }
  const apply = element("button", "Valider ces résolutions", footer);
  apply.disabled = true;
  return new Promise(resolve => {
    let answer = null;
    apply.onclick = () => {
      answer = Object.fromEntries([...selections].map(([key, { select, input, expected }]) => [key, select.value === "custom" ? { value: input.value, expected } : { choice: select.value, expected }]));
      dialog.close();
    };
    dialog.addEventListener("close", () => resolve(answer), { once: true });
  });
}

export async function showHistory(api, { current, restore }) {
  const { dialog, content, footer } = modal("Historique et restauration");
  element("p", "La restauration remet une ligne dans l’éditeur. Vérifie-la, puis enregistre pour l’appliquer au jeu. Les anciennes copies non attribuées restent accessibles dans le dossier.", content);
  const open = element("button", "Ouvrir le dossier des backups", footer);
  open.onclick = () => api.openBackups();
  const status = element("p", "Chargement…", content);
  try {
    const versions = await api.listBackups();
    if (!dialog.open) return;
    status.textContent = versions.length ? `${versions.length} copies pour ce chapitre` : "Aucune copie pour ce chapitre pour le moment.";
    const select = element("select", null, content);
    select.setAttribute("aria-label", "Copie à comparer");
    for (const version of versions) {
      const option = element("option", `${new Date(version.date).toLocaleString()} — ${version.kind === "draft" ? "Brouillon" : "Avant sauvegarde"}`, select);
      option.value = version.id;
    }
    const results = pagedResults(content, ({ key, value }, list) => {
      const row = element("section", null, list);
      element("h3", key, row);
      element("b", "Actuellement", row);
      element("pre", current()[key] ?? "Clé absente", row);
      element("b", "Dans cette copie", row);
      element("pre", value, row);
      const button = element("button", value === current()[key] ? "Restaurée dans l’éditeur" : "Restaurer cette ligne", row);
      button.disabled = value === current()[key];
      button.onclick = () => { restore(key, value); button.disabled = true; button.textContent = "Restaurée dans l’éditeur"; };
    });
    let generation = 0;
    select.onchange = async () => {
      const ticket = ++generation;
      try {
        const language = await api.readBackup(select.value);
        if (!dialog.open || ticket !== generation) return;
        const differences = [];
        for (const [key, value] of Object.entries(language)) {
          if (key === "date" || typeof value !== "string" || value === current()[key]) continue;
          differences.push({ key, value });
        }
        results.update(differences);
      } catch (error) { status.textContent = error.message; }
    };
    if (versions.length) await select.onchange();
  } catch (error) { status.textContent = error.message; }
}

export async function showQuality(entries, inspect, navigate) {
  const { dialog, content, footer, close } = modal("Contrôle qualité du chapitre");
  close.textContent = "Arrêter et fermer";
  const status = element("p", "Analyse des traductions…", content);
  const stop = element("button", "Arrêter l’analyse", footer);
  let canceled = false;
  stop.onclick = () => { canceled = true; stop.disabled = true; };
  dialog.addEventListener("close", () => { canceled = true; });
  const findings = [];
  const results = pagedResults(content, ({ key, issues }, list) => {
    const row = element("section", null, list);
    const button = element("button", key, row);
    button.onclick = () => { dialog.close(); navigate(key); };
    const messages = element("ul", null, row);
    for (const issue of issues) element("li", issue, messages);
  });
  let checked = 0, warnings = 0;
  for (const entry of entries) {
    if (canceled) break;
    let issues;
    try { issues = await inspect(entry); }
    catch (error) { issues = [`Aperçu impossible : ${error.message}`]; }
    if (!dialog.open) return;
    checked++;
    if (issues.length) {
      warnings++;
      findings.push({ key: entry.key, issues });
    }
    status.textContent = `${checked} / ${entries.length} lignes contrôlées · ${warnings} à vérifier`;
    if (checked % 10 === 0) {
      results.update(findings);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (!dialog.open) return;
  stop.disabled = true;
  results.update(findings);
  close.textContent = "Fermer";
  status.textContent += canceled ? " · Analyse interrompue" : " · Analyse terminée";
}

export function textIssues(english, french) {
  const tokens = text => [...String(text ?? "").replace(/`./g, "").matchAll(/~\d+/g)].map(match => match[0]).sort();
  const issues = [];
  if (english != null && JSON.stringify(tokens(english)) !== JSON.stringify(tokens(french))) issues.push("Les arguments ~1, ~2… diffèrent de l’anglais (nombre ou identité).");
  if (/\\(?:[^\r\n]?$)/.test(french)) issues.push("Une balise semble incomplète en fin de texte.");
  if (english != null) {
    const unescaped = text => String(text).replace(/`./g, "");
    const sourceEnd = unescaped(english).match(/(?<![\d\s])(?:\/%|%%|\/|%)$/)?.[0];
    if (sourceEnd && !unescaped(french).endsWith(sourceEnd)) issues.push(`La terminaison de dialogue ${sourceEnd} diffère de l’anglais : vérifier le passage au message suivant.`);
  }
  return issues;
}
