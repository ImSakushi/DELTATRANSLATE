import { element, modal } from "./review-tools.mjs";

export const PUBLICATION_STATES = {
  local: { symbol: "●", label: "Non publiée" },
  pushed: { symbol: "↑", label: "Sur ta branche" },
  published: { symbol: "✓", label: "Publiée dans main" },
  incoming: { symbol: "⇣", label: "Nouveauté de main à récupérer" },
};

// Une ligne modifiée dans l'éditeur n'est plus celle que Git connaît : elle redevient « non publiée ».
export function effectiveState(publication, key, unsaved = false) {
  if (unsaved) return "local";
  return publication?.keys?.[key]?.state ?? null;
}

export function formatDate(timestamp) {
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function eventSource(event) {
  if (!event) return "";
  return event.pr ? `PR #${event.pr} (${event.from})` : `commit ${event.commit.slice(0, 7)}`;
}

export function describePublication(publication, key, unsaved = false) {
  const state = effectiveState(publication, key, unsaved);
  if (!state) return null;
  const info = publication?.keys?.[key] ?? {};
  const event = unsaved ? null : info.event;
  const branch = publication?.branch ?? "ta branche";
  const lines = [];
  let text;
  if (state === "local") {
    text = unsaved ? "● Non enregistrée — pas encore publiée" : "● Pas encore publiée sur GitHub";
    lines.push(unsaved ? "Enregistre puis publie pour l’envoyer sur ta branche." : `Publie pour l’envoyer sur la branche ${branch}.`);
  } else if (state === "pushed") {
    text = `↑ Publiée sur ${branch}${event?.at ? ` le ${formatDate(event.at)}` : ""} — en attente de fusion dans main`;
    lines.push("Elle rejoindra la traduction officielle quand une PR de ta branche sera fusionnée dans main.");
  } else if (state === "published") {
    text = `✓ Publiée dans main${event?.at ? ` le ${formatDate(event.at)}` : ""}${event ? ` via ${eventSource(event)}` : ""}`;
    if (event?.pr) lines.push(`PR fusionnée par ${event.by}.`);
  } else {
    text = `⇣ main contient une nouvelle version${event?.at ? ` depuis le ${formatDate(event.at)}` : ""}${event ? ` via ${eventSource(event)}` : ""}`;
    lines.push("Clique sur Récupérer pour l’intégrer à ta branche.");
  }
  if (info.mainChanged && state !== "incoming" && !unsaved) {
    lines.push("Attention : main contient une autre version de cette ligne. Un conflit te sera proposé à la prochaine synchronisation.");
  }
  if (event?.summary && !event.pr) lines.push(event.summary);
  return { state, text, tooltip: [text, ...lines].join("\n") };
}

export function summarizePublication(publication, unsavedCount = 0) {
  if (!publication?.ok) return "";
  const counts = publication.counts ?? {};
  const parts = [];
  const local = (counts.local ?? 0) + unsavedCount;
  if (local) parts.push(`${local} non publiée${local > 1 ? "s" : ""}`);
  if (counts.pushed) parts.push(`${counts.pushed} sur ${publication.branch}, pas encore dans main`);
  if (counts.incoming) parts.push(`${counts.incoming} nouveauté${counts.incoming > 1 ? "s" : ""} de main à récupérer`);
  parts.push(`${counts.published ?? 0} publiée${counts.published > 1 ? "s" : ""} dans main`);
  return parts.join(" · ");
}

function eventRow(parent, event, { openPullRequest }) {
  const row = element("li", null, parent);
  row.className = "publication-event";
  const title = element("div", null, row);
  title.className = "publication-event-title";
  if (event.pr) {
    const link = element("button", `PR #${event.pr}`, title);
    link.type = "button";
    link.className = "publication-pr";
    link.dataset.tooltip = "Ouvrir la PR sur GitHub";
    link.onclick = () => openPullRequest(event.pr);
    element("span", ` ${event.from}`, title);
  } else {
    element("span", event.summary || event.commit.slice(0, 7), title);
  }
  const meta = element("div", null, row);
  meta.className = "publication-event-meta";
  meta.textContent = [
    formatDate(event.at),
    event.pr ? `fusionnée par ${event.by}` : event.by,
    `${event.lines} ligne${event.lines > 1 ? "s" : ""}`,
  ].filter(Boolean).join(" · ");
}

export function showPublicationJournal({ load, openPullRequest }) {
  const { dialog, content, footer } = modal("Journal des publications Runedelta");
  dialog.classList.add("publication-journal");
  const status = element("p", "Récupération de GitHub…", content);
  status.setAttribute("role", "status");
  const body = element("div", null, content);
  const refresh = element("button", "↻ Actualiser depuis GitHub", footer);
  refresh.type = "button";

  async function render(fetch) {
    refresh.disabled = true;
    status.textContent = "Récupération de GitHub…";
    const publication = await load(fetch);
    if (!dialog.open) return;
    refresh.disabled = false;
    body.replaceChildren();
    if (!publication?.ok) {
      status.textContent = publication?.busy ? "Une synchronisation est en cours. Réessaie dans un instant."
        : publication?.error ?? "Le suivi de publication est indisponible.";
      return;
    }
    status.textContent = `${summarizePublication(publication)}\nVérifié à ${new Date(publication.checkedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` +
      (publication.fetchError ? ` — GitHub injoignable, état du dernier téléchargement : ${publication.fetchError}` : "") +
      (publication.unpushedCommits ? `\n${publication.unpushedCommits} commit${publication.unpushedCommits > 1 ? "s" : ""} enregistré${publication.unpushedCommits > 1 ? "s" : ""} localement, pas encore envoyé${publication.unpushedCommits > 1 ? "s" : ""} sur GitHub.` : "");

    if (publication.branch !== "main") {
      element("h3", `En attente sur ${publication.branch} (${publication.waiting.length}${publication.waiting.length >= 40 ? "+" : ""})`, body);
      element("p", "Commits de ta branche déjà sur GitHub, mais pas encore fusionnés dans main par une PR.", body).className = "modal-hint";
      const waiting = element("ul", null, body);
      waiting.className = "publication-events";
      if (!publication.waiting.length) element("li", "Rien en attente : tout ce que tu as publié est dans main.", waiting).className = "publication-empty";
      for (const event of publication.waiting) eventRow(waiting, event, { openPullRequest });
    }

    element("h3", "Publiées dans main", body);
    element("p", "Chaque PR fusionnée dans main met à jour la traduction officielle du chapitre.", body).className = "modal-hint";
    const releases = element("ul", null, body);
    releases.className = "publication-events";
    for (const event of publication.releases) eventRow(releases, event, { openPullRequest });
  }

  refresh.onclick = () => render(true);
  render(true);
  return dialog;
}
