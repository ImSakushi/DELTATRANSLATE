const relativeTime = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
const exactTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function branchAge(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Date inconnue";
  const seconds = (timestamp - now) / 1000;
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.trunc(seconds / size), unit);
  }
  return "À l’instant";
}

export function renderBranchPicker(container, result, selected, active, onSelect) {
  const details = new Map((result.branchDetails ?? []).map(branch => [branch.name, branch]));
  const names = [...result.branches].sort((a, b) =>
    Number(b === active) - Number(a === active) ||
    (details.get(b)?.timestamp ?? 0) - (details.get(a)?.timestamp ?? 0) || a.localeCompare(b, "fr"));
  const fragment = document.createDocumentFragment();
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  for (const name of names) {
    const branch = details.get(name);
    const card = element("label", "branch-card");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "runedelta-work-branch";
    radio.value = name;
    radio.checked = name === selected;
    radio.addEventListener("change", () => { if (radio.checked) onSelect(name); });
    const content = element("span", "branch-content");
    const heading = element("span", "branch-card-heading");
    heading.append(element("strong", "branch-name", name));
    if (name === active) heading.append(element("span", "branch-badge active", "En cours"));
    if (name === result.defaultBranch) heading.append(element("span", "branch-badge", "Par défaut"));
    content.append(heading);
    if (branch) {
      content.append(element("span", "branch-author", `Dernier commit · ${branch.authorName || branch.author || "Auteur inconnu"}`));
      const date = element("span", "branch-date", branchAge(branch.timestamp));
      if (Number.isFinite(branch.timestamp) && branch.timestamp > 0) {
        const time = element("time", "", exactTime.format(branch.timestamp));
        time.dateTime = new Date(branch.timestamp).toISOString();
        date.append(document.createTextNode(" · "), time);
      }
      content.append(date);
      content.append(element("span", "branch-subject", branch.subject || "Sans message"));
      content.append(element("span", "branch-commit", `Commit ${branch.commit.slice(0, 7)}`));
    } else {
      content.append(element("span", "branch-date", "Détails du dernier commit indisponibles"));
    }
    card.append(radio, content);
    fragment.append(card);
  }
  container.replaceChildren(fragment);
}
