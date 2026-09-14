import { loadFonts } from "./engine/bitmapfont.js";
import { Preview } from "./engine/preview.js";
import { C_TAG, FC_NAMES, F_TAG, encodeFe } from "./engine/typers.js";
import { extractTags, substituteArgs } from "./engine/writer.js";
import { SpriteEditor } from "./sprites.js";
import { prepareChapter } from "./setup-flow.mjs";
import { mergeSavedEdits, catalogKeys } from "./editor-state.mjs";
import { resolveConflicts, showHistory } from "./review-tools.mjs";
import { prepareUpdateInstall, runUpdateAction, updateAction } from "./update-flow.mjs";

// ---------------------------------------------------------------------------
// État global
// ---------------------------------------------------------------------------
let lang = {}; // objet complet du lang_fr.json (ordre des clés préservé)
let languageRevision = null;
let migrationReview = new Set();
let japanese = {}; // lang_ja.json du chapitre, utilisé comme référence de balises
let reference = {}; // id -> {en, call, channel, file, line, speaker, face, substitutions, smallFace, speakerOverlay}
let runedeltaAttributions = {}; // id -> dernier auteur Git de la ligne Runedelta
let prefs = {}; // { modeOverrides, bubbleSides, platformSides, validated, faceOverrides, theme, backupsEnabled, listSort, speakerFilter }
let prefsSavePromise = Promise.resolve(true);
let prefsSaveFailed = false;
function savePreferences() {
  const snapshot = structuredClone(prefs);
  prefsSavePromise = prefsSavePromise.then(() => window.api.savePrefs(snapshot)).then(() => {
    prefsSaveFailed = false;
    return true;
  }).catch(error => {
    prefsSaveFailed = true;
    alert(`Les préférences n’ont pas été enregistrées. Les copies précédentes sont conservées.\n\n${error.message}`);
    return false;
  });
  return prefsSavePromise;
}
let entries = []; // index pour la liste
let entriesByKey = new Map();
let filtered = [];
let selectedKey = null;
let dirty = false;
let savedTranslations = new Map();
const unsavedKeys = new Set();
let savePromise = null;
let saveAndNextRunning = false;
let closePromptOpen = false;
let preview = null;
let targetFonts = {};
let englishFonts = {};
let sequences = new Map(); // key -> [keys de la même séquence]
const editHistories = new Map(); // historique indépendant pour chaque clé
let pendingEdit = null;
let applyingHistory = false;
let backupPromise = null;
let codeModalBound = false;
let codeApplyRunning = false;
const codeState = {
  file: null,
  content: "",
  original: "",
  saved: "",
  modified: false,
  editing: false,
  dirty: false,
  needsApply: false,
  targetLine: null,
  findIndex: -1,
};

const $ = (id) => document.getElementById(id);
const spriteEditor = new SpriteEditor($);

const ROW_H = 65;
const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const BACKUP_CHECK_MS = 60 * 1000;
const LIST_SORTS = new Set(["source", "speaker", "type"]);
const SORT_COLLATOR = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
const DIALOGUE_TYPE_NAMES = {
  darkbox: "Textbox (monde sombre)",
  lightbox: "Textbox (monde clair)",
  platform: "Dialogue plateformer",
  bubble: "Bulle de combat",
  battletext: "Texte de combat",
  trial: "Dossier du procès",
  shop: "Dialogue de boutique",
  device: "Appareil",
  plain: "Menu / texte libre",
};
const SPEAKER_NAMES = {
  susie: "Susie",
  ralsei: "Ralsei",
  noelle: "Noelle",
  toriel: "Toriel",
  lancer: "Lancer",
  sans: "Sans",
  undyne: "Undyne",
  asgore: "Asgore",
  alphys: "Alphys",
  berdly: "Berdly",
  catti: "Catti",
  jockington: "Jockington",
  rudy: "Rudy",
  catty: "Catty",
  bratty: "Bratty",
  rouxls: "Rouxls",
  burgerpants: "Burgerpants",
  king: "King",
  queen: "Queen",
  carol: "Carol",
  flowery: "Flowery",
  bluef: "Blue (papillon)",
  tenna: "Tenna",
  jackenstein: "Jackenstein",
  spamton: "Spamton",
  napstablook: "Napstablook",
  starwalker: "Starwalker",
  k_k: "K_K",
  floradinn: "Floradinn",
  aqua: "Aqua",
  seth: "Seth",
  yellow: "Yellow",
  orange: "Orange",
  blue: "Blue",
  green: "Green",
  pink: "Pink",
  opuppet: "Opuppet",
  temmie: "Temmie",
  jevil: "Jevil",
};
const FC_SPEAKER_KEYS = {
  1: "susie", 2: "ralsei", 3: "noelle", 4: "toriel", 5: "lancer", 6: "sans",
  9: "undyne", 10: "asgore", 11: "alphys", 12: "berdly", 13: "catti",
  14: "jockington", 15: "rudy", 16: "catty", 17: "bratty", 18: "rouxls",
  19: "burgerpants", 20: "king", 21: "queen", 22: "carol", 23: "flowery",
  24: "flowery", 25: "bluef",
};
const UNIDENTIFIED_SPEAKER = "__unidentified__";

// ---------------------------------------------------------------------------
// Infobulles
// ---------------------------------------------------------------------------
function setupTooltips() {
  const tooltip = document.createElement("div");
  tooltip.id = "app-tooltip";
  tooltip.setAttribute("role", "tooltip");
  document.body.appendChild(tooltip);

  let target = null;
  let showTimer = null;

  function hideTooltip() {
    clearTimeout(showTimer);
    showTimer = null;
    target?.removeAttribute("aria-describedby");
    target = null;
    tooltip.classList.remove("visible");
  }

  function positionTooltip(element) {
    const rect = element.getBoundingClientRect();
    const margin = 8;
    let left = rect.left + rect.width / 2 - tooltip.offsetWidth / 2;
    left = Math.max(margin, Math.min(left, innerWidth - tooltip.offsetWidth - margin));

    let top = rect.bottom + margin;
    if (top + tooltip.offsetHeight > innerHeight - margin) {
      top = rect.top - tooltip.offsetHeight - margin;
    }
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.max(margin, Math.round(top))}px`;
  }

  function showTooltip(element, delay = 350) {
    if (!element?.dataset.tooltip) {
      hideTooltip();
      return;
    }
    if (element === target) return;
    hideTooltip();
    target = element;
    showTimer = setTimeout(() => {
      if (!target) return;
      tooltip.textContent = target.dataset.tooltip;
      tooltip.classList.add("visible");
      target.setAttribute("aria-describedby", tooltip.id);
      positionTooltip(target);
    }, delay);
  }

  // pointermove couvre aussi les boutons disabled, qui n'émettent pas toujours mouseenter.
  document.addEventListener("pointermove", (event) => {
    const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-tooltip]");
    if (hovered !== target) showTooltip(hovered);
  });
  document.addEventListener("pointerleave", hideTooltip);
  document.addEventListener("pointerdown", hideTooltip, true);
  document.addEventListener("focusin", (event) => showTooltip(event.target.closest?.("[data-tooltip]"), 0));
  document.addEventListener("focusout", hideTooltip);
  document.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("resize", hideTooltip);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideTooltip();
  });
}

// ---------------------------------------------------------------------------
// Mise à jour de DELTATRANSLATE
// ---------------------------------------------------------------------------
let updateInstallRunning = false;

function renderUpdateStatus(status) {
  const button = $("btn-update");
  const action = updateAction(status);
  button.classList.toggle("hidden", action === "disabled");
  button.disabled = action === "busy" || action === "disabled";
  if (status?.phase === "error" && updateInstallRunning) {
    updateInstallRunning = false;
    document.body.inert = false;
  }
  if (action === "disabled") return;
  if (status.phase === "checking") {
    button.textContent = "Recherche…";
    button.dataset.tooltip = "Vérification des releases GitHub";
  } else if (status.phase === "installing") {
    button.textContent = "Installation…";
    button.dataset.tooltip = "Installation de la mise à jour et redémarrage";
  } else if (status.phase === "downloading") {
    button.textContent = `↓ Mise à jour ${status.percent ?? 0} %`;
    button.dataset.tooltip = `Téléchargement de DELTATRANSLATE ${status.version ?? ""}`.trim();
  } else if (action === "install") {
    button.textContent = `↻ Installer ${status.version}`;
    button.dataset.tooltip = "Sauvegarder le travail, installer la mise à jour et redémarrer";
  } else if (action === "download") {
    button.textContent = `↓ Mettre à jour · ${status.version}`;
    button.dataset.tooltip = "Télécharger la nouvelle version depuis GitHub";
  } else {
    button.textContent = status.phase === "error" ? "↻ Réessayer la mise à jour" : "↻ Mises à jour";
    button.dataset.tooltip = `Version ${status.currentVersion} · Vérifier les releases GitHub`;
  }
  if (status.error) button.dataset.tooltip = `${status.error}\nCliquez pour réessayer.`;
}

async function installDownloadedUpdate() {
  if (updateInstallRunning) return;
  updateInstallRunning = true;
  document.body.inert = true;
  let installed = false;
  try {
    const result = await prepareUpdateInstall({
      isBusy: () => importing || installingUtmt || pickingChapter || runedeltaBusy || codeApplyRunning || spriteEditor.applyRunning,
      isDirty: () => dirty || codeState.dirty,
      savePreferences: async () => {
        await prefsSavePromise;
        return !prefsSaveFailed || savePreferences();
      },
      saveCode: async () => !codeState.dirty || saveCodeOverride(),
      saveLanguage: async () => {
        if (savePromise && !(await savePromise)) return false;
        return !dirty || save();
      },
      install: () => window.api.installUpdate(),
    });
    installed = result.ok;
    if (!result.ok) alert(`Impossible d’installer la mise à jour.\n\n${result.error}`);
  } catch (error) {
    alert(`Impossible d’installer la mise à jour.\n\n${error.message}`);
  } finally {
    if (!installed) {
      updateInstallRunning = false;
      document.body.inert = false;
    }
  }
}

async function setupUpdates() {
  $("btn-update").addEventListener("click", async () => {
    try {
      const result = await runUpdateAction(window.api, installDownloadedUpdate);
      if (result && !result.ok) alert(`Mise à jour impossible.\n\n${result.error}`);
    } catch (error) {
      alert(`Mise à jour impossible.\n\n${error.message}`);
    }
  });
  window.api.onUpdateStatus(renderUpdateStatus);
  window.api.onUpdateInstallRequested(installDownloadedUpdate);
  renderUpdateStatus(await window.api.getUpdateStatus());
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
let appConfig = {};
let appReady = false;

async function init() {
  bindImportModal();
  bindCodeModal();
  spriteEditor.bind();
  const data = await window.api.loadData();
  appConfig = data.config ?? {};
  renderRunedeltaStatus();
  utmtReady = Boolean(data.utmt?.ready);
  prefs = Object.assign(
    {
      modeOverrides: {},
      bubbleSides: {},
      platformSides: {},
      validated: {},
      faceOverrides: {},
      sceneOverrides: {},
      backupsEnabled: false,
    },
    data.prefs
  );
  if (!prefs.validated) prefs.validated = {};
  if (!prefs.faceOverrides) prefs.faceOverrides = {};
  if (!prefs.platformSides) prefs.platformSides = {};
  if (!prefs.sceneOverrides) prefs.sceneOverrides = {};
  prefs.listSort = LIST_SORTS.has(prefs.listSort) ? prefs.listSort : "source";
  prefs.speakerFilter = typeof prefs.speakerFilter === "string" ? prefs.speakerFilter : "all";
  $("sel-list-sort").value = prefs.listSort;
  const backupsToggle = $("chk-backups");
  backupsToggle.checked = prefs.backupsEnabled === true;
  backupsToggle.addEventListener("change", () => {
    prefs.backupsEnabled = backupsToggle.checked;
    savePreferences();
  });
  applyTheme(prefs.theme === "classic" ? "classic" : "deltarune");
  $("btn-theme").onclick = toggleTheme;
  if (!data.ready) {
    openImportModal(true);
    return;
  }

  appReady = true;
  const languageCode = (appConfig.targetLanguage ?? "fr").replaceAll("_", "-");
  let languageLabel = languageCode.toUpperCase();
  try { languageLabel = new Intl.DisplayNames(["fr"], { type: "language" }).of(languageCode); } catch {}
  $("translation-language-label").textContent = `Traduction — ${languageLabel}`;
  $("fr-input").placeholder = `Traduction (${languageLabel})…`;
  await refreshRunedeltaStatus(null, data.runedeltaSync);
  lang = data.lang;
  languageRevision = data.revision;
  japanese = data.japanese ?? {};
  reference = data.reference;
  migrationReview = new Set(data.migration?.review ?? []);
  runedeltaAttributions = data.runedeltaSync?.attributions ?? {};
  if (appConfig.runedelta?.modeEnabled === true && appConfig.runedelta?.enabled && Object.keys(runedeltaAttributions).length === 0) {
    const attributionData = await window.api.getRunedeltaAttributions();
    if (attributionData.ok) runedeltaAttributions = attributionData.attributions;
    else console.warn(`Attributions Runedelta indisponibles : ${attributionData.error}`);
  }
  spriteEditor.init(data.spriteCatalog);

  [targetFonts, englishFonts] = await Promise.all([
    loadFonts(data.extractedDir, parseFontCsvs(data.fonts), appConfig.targetLanguage ?? "fr"),
    loadFonts(data.extractedDir, parseFontCsvs(data.fonts), "en"),
  ]);
  preview = new Preview(
    $("preview-canvas"),
    data.extractedDir,
    targetFonts,
    data.spriteFiles,
    data.spriteMeta
  );

  buildIndex();
  buildSpeakerFilterOptions();
  savedTranslations = new Map(entries.map((entry) => [entry.key, entry.fr]));
  for (const [key, suggestion] of Object.entries(data.migration?.suggestions ?? {})) {
    if (!entriesByKey.has(key) || (Object.hasOwn(lang, key) && lang[key] !== reference[key]?.en)) continue;
    lang[key] = suggestion.value;
    const entry = entriesByKey.get(key);
    entry.fr = suggestion.value;
    entry.todo = computeTodo(entry);
    entry.searchable = buildSearchable(entry);
    unsavedKeys.add(key);
  }
  setDirty(unsavedKeys.size > 0);
  buildSequences();
  buildFaceSelectors();
  buildColorSwatches();
  bindEvents();
  applyFilter();
  updateProgress();

  // sélectionne la clé demandée en query (?key=…) sinon la première à traduire
  const urlKey = new URLSearchParams(location.search).get("key");
  const firstTodo = entries.find((e) => e.todo);
  selectKey(
    urlKey && entriesByKey.has(urlKey) ? urlKey : firstTodo ? firstTodo.key : entries[0]?.key
  );
  scrollToSelected();
}

function parseFontCsvs(fonts) {
  // load-data renvoie { fnt_main: csvText, ... }
  return fonts;
}

// Deux designs : "deltarune" (défaut) et "classic" (ancien look).
// Chaque design est une feuille de style complète dans src/themes/.
function applyTheme(theme) {
  const isClassic = theme === "classic";
  const name = isClassic ? "classic" : "deltarune";
  document.documentElement.dataset.theme = name;
  $("theme-css").setAttribute("href", `themes/${name}.css`);
  window.api.setTitleBarTheme(name);
  const button = $("btn-theme");
  const label = isClassic ? "Passer au design DELTARUNE" : "Passer au design classique";
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
}

function toggleTheme() {
  prefs.theme = document.documentElement.dataset.theme === "classic" ? "deltarune" : "classic";
  applyTheme(prefs.theme);
  savePreferences();
}

// Version « lisible » d'un texte pour la recherche : tags retirés, de sorte
// que « And BOMBS! » retrouve « And BOMBS^1! »
function stripForSearch(text) {
  return text
    .replace(/`(.)/g, "$1")
    .replace(/\\../g, "")
    .replace(/\^[0-9]/g, "")
    .replace(/~[0-9]+/g, " ")
    .replace(/[&|#]/g, " ")
    .replace(/[/%]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function buildSearchable(e) {
  return (
    e.key +
    "\n" +
    shortKey(e.key) +
    "\n" +
    (e.en || "") +
    "\n" +
    e.fr +
    "\n" +
    stripForSearch(e.en || "") +
    "\n" +
    stripForSearch(e.fr)
  ).toLowerCase();
}

// Un texte « demande » une traduction s'il contient des mots une fois les
// tags retirés (les lignes purement techniques comme "\M0 %" sont exclues)
function hasWords(text) {
  const stripped = text
    .replace(/`./g, "")
    .replace(/\\../g, "")
    .replace(/\^[0-9]/g, "")
    .replace(/[&|/%*#~0-9\s.,!?'"()\-:;]/g, "");
  return /[A-Za-zÀ-ÿ]/.test(stripped);
}

function computeTodo(e) {
  return (
    e.en != null &&
    e.fr === e.en &&
    hasWords(e.en) &&
    !prefs.validated[e.key]
  );
}

function buildIndex() {
  entries = [];
  entriesByKey = new Map();
  const orderedKeys = catalogKeys(lang, reference);
  for (const key of orderedKeys) {
    const ref = reference[key] ?? {};
    const fr = lang[key] ?? ref.en;
    const en = ref.en;
    const e = {
      key,
      fr,
      en,
      ja: japanese[key] ?? null,
      channel: ref.channel,
      file: ref.file,
      line: ref.line,
      noref: !Object.hasOwn(reference, key),
      sourceIndex: entries.length,
      todo: false,
      searchable: "",
    };
    e.searchable = buildSearchable(e);
    e.todo = computeTodo(e);
    entries.push(e);
    entriesByKey.set(key, e);
  }
}

// Séquences de dialogue : entrées du même fichier à lignes proches
function buildSequences() {
  sequences = new Map();
  const byFile = new Map();
  for (const e of entries) {
    if (!e.file) continue;
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  for (const [, list] of byFile) {
    list.sort((a, b) => a.line - b.line);
    let seq = [];
    let prevLine = null;
    for (const e of list) {
      if (prevLine !== null && e.line - prevLine > 6) {
        for (const s of seq) sequences.set(s.key, seq);
        seq = [];
      }
      seq.push(e);
      prevLine = e.line;
    }
    for (const s of seq) sequences.set(s.key, seq);
  }
}

// ---------------------------------------------------------------------------
// Liste virtuelle
// ---------------------------------------------------------------------------
function speakerLabel(key) {
  if (key === UNIDENTIFIED_SPEAKER) return "Sans personnage identifié";
  if (SPEAKER_NAMES[key]) return SPEAKER_NAMES[key];
  return key
    .split(/[_ ]+/)
    .filter(Boolean)
    .map((part) => part[0].toLocaleUpperCase("fr") + part.slice(1))
    .join(" ");
}

function speakerIdentity(e) {
  const ref = reference[e.key];
  const overrideFc = prefs.faceOverrides[e.key]?.fc;
  if (overrideFc && FC_SPEAKER_KEYS[overrideFc]) {
    const key = FC_SPEAKER_KEYS[overrideFc];
    return { key, label: speakerLabel(key) };
  }
  const detected = String(ref?.speaker ?? "").toLowerCase();
  if (detected) return { key: detected, label: speakerLabel(detected) };
  const fc = ref?.face?.fc;
  if (fc && FC_SPEAKER_KEYS[fc]) {
    const key = FC_SPEAKER_KEYS[fc];
    return { key, label: speakerLabel(key) };
  }
  const smallFaceSpeaker = String(ref?.smallFace?.speaker ?? "").toLowerCase();
  if (SPEAKER_NAMES[smallFaceSpeaker]) {
    return { key: smallFaceSpeaker, label: speakerLabel(smallFaceSpeaker) };
  }
  return { key: UNIDENTIFIED_SPEAKER, label: speakerLabel(UNIDENTIFIED_SPEAKER) };
}

function speakerName(e) {
  return speakerIdentity(e).label;
}

function buildSpeakerFilterOptions() {
  const select = $("sel-speaker-filter");
  const counts = new Map();
  for (const entry of entries) {
    const identity = speakerIdentity(entry);
    const current = counts.get(identity.key) ?? { label: identity.label, count: 0 };
    current.count++;
    counts.set(identity.key, current);
  }

  const options = [...counts.entries()].sort(([keyA, a], [keyB, b]) => {
    if (keyA === UNIDENTIFIED_SPEAKER) return 1;
    if (keyB === UNIDENTIFIED_SPEAKER) return -1;
    return SORT_COLLATOR.compare(a.label, b.label);
  });
  select.replaceChildren();
  select.add(new Option("Tous les personnages", "all"));
  for (const [key, { label, count }] of options) {
    select.add(new Option(`${label} (${count.toLocaleString("fr-FR")})`, key));
  }
  if (!counts.has(prefs.speakerFilter)) prefs.speakerFilter = "all";
  select.value = prefs.speakerFilter;
  $("speaker-filter-row").classList.toggle("hidden", prefs.listSort !== "speaker");
}

function dialogueTypeName(e) {
  if (e.noref) return "Sans référence";
  const mode = prefs.modeOverrides[e.key] ?? autoMode(e);
  return DIALOGUE_TYPE_NAMES[mode] ?? "Autre";
}

function activeSortLabel(e) {
  if (prefs.listSort === "speaker") return speakerName(e);
  if (prefs.listSort === "type") return dialogueTypeName(e);
  return "";
}

function translatedAttribution(e) {
  if (!e || e.en == null || e.fr === e.en) return null;
  return runedeltaAttributions[e.key] ?? null;
}

function attributionNames(attribution) {
  if (!attribution) return [];
  if (Array.isArray(attribution.names) && attribution.names.length) return attribution.names;
  return attribution.name ? [attribution.name] : [];
}

function attributionTooltip(attribution) {
  if (!attribution) return "";
  const details = [`Traduit par ${attributionNames(attribution).join(", ")}`];
  if (attribution.timestamp) {
    details.push(`Dernière modification : ${new Date(attribution.timestamp).toLocaleString("fr-FR")}`);
  }
  if (attribution.summary) details.push(attribution.summary);
  if (attribution.commit) details.push(`Commit ${attribution.commit.slice(0, 10)}`);
  return details.join("\n");
}

function compareEntries(a, b) {
  let groupComparison = 0;
  if (prefs.listSort === "speaker") {
    const speakerA = speakerName(a);
    const speakerB = speakerName(b);
    const unidentifiedA = speakerA === "Sans personnage identifié";
    const unidentifiedB = speakerB === "Sans personnage identifié";
    if (unidentifiedA !== unidentifiedB) return unidentifiedA ? 1 : -1;
    groupComparison = SORT_COLLATOR.compare(speakerA, speakerB);
  } else if (prefs.listSort === "type") {
    groupComparison = SORT_COLLATOR.compare(dialogueTypeName(a), dialogueTypeName(b));
  }
  return groupComparison || a.sourceIndex - b.sourceIndex;
}

function applyFilter({ restoreSelected = false } = {}) {
  const q = $("search").value.trim().toLowerCase();
  const f = document.querySelector(".filter.active").dataset.filter;
  filtered = entries.filter((e) => {
    if (f === "todo" && !e.todo) return false;
    if (f === "noref" && !e.noref) return false;
    if (f === "dialogue" && !(e.channel && e.channel !== "string")) return false;
    if (f === "string" && e.channel !== "string") return false;
    if (
      prefs.listSort === "speaker" &&
      prefs.speakerFilter !== "all" &&
      speakerIdentity(e).key !== prefs.speakerFilter
    ) return false;
    if (q && !e.searchable.includes(q)) return false;
    return true;
  });
  if (prefs.listSort !== "source") filtered.sort(compareEntries);
  $("list-spacer").style.height = filtered.length * ROW_H + "px";
  let sortSuffix =
    prefs.listSort === "speaker"
      ? " · triées par personnage"
      : prefs.listSort === "type"
        ? " · triées par type"
        : "";
  if (prefs.listSort === "speaker" && prefs.speakerFilter !== "all") {
    sortSuffix += ` · ${speakerLabel(prefs.speakerFilter)} uniquement`;
  }
  $("list-status").textContent = `${filtered.length} lignes affichées${sortSuffix}`;
  renderList();
  if (restoreSelected) scrollToSelected(true);
}

let listRafPending = false;
function renderListRaf() {
  if (listRafPending) return;
  listRafPending = true;
  requestAnimationFrame(() => {
    listRafPending = false;
    renderList();
  });
}

function renderList() {
  const container = $("list-container");
  const scrollTop = container.scrollTop;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const count = Math.ceil(container.clientHeight / ROW_H) + 10;
  const slice = filtered.slice(first, first + count);
  const itemsEl = $("list-items");
  itemsEl.style.transform = `translateY(${first * ROW_H}px)`;
  const frag = document.createDocumentFragment();
  for (const e of slice) {
    const div = document.createElement("div");
    div.className =
      "list-item" +
      (e.todo ? " todo" : "") +
      (e.key === selectedKey ? " selected" : "");
    const dot = e.noref ? "noref" : e.todo ? "todo" : "ok";
    const sortLabel = activeSortLabel(e);
    const attribution = translatedAttribution(e);
    const listMeta =
      sortLabel || attribution
        ? `<span class="li-meta">` +
          (sortLabel ? `<span class="li-sort-label">${escapeHtml(sortLabel)}</span>` : "") +
          (attribution
            ? `<span class="li-author" data-tooltip="${escapeHtml(attributionTooltip(attribution))}">✎ ${escapeHtml(attributionNames(attribution).join(", "))}</span>`
            : "") +
          `</span>`
        : "";
    div.innerHTML =
      `<div class="li-key"><span class="li-key-main"><span class="li-dot ${dot}"></span>${escapeHtml(shortKey(e.key))}</span>` +
      listMeta +
      `</div>` +
      `<div class="li-en">${escapeHtml(e.en ?? "(pas de référence)")}</div>` +
      `<div class="li-fr">${escapeHtml(e.fr)}</div>`;
    div.onclick = () => selectKey(e.key);
    frag.appendChild(div);
  }
  itemsEl.replaceChildren(frag);
}

function shortKey(k) {
  return k.replace(/_slash_/g, "/").replace(/_gml_/g, " :");
}

function renderKeyMeta(e) {
  if (e.noref) {
    $("key-meta").textContent =
      "Aucune référence dans ce chapitre. Cette traduction reste conservée et modifiable.";
    return;
  }
  const identity = speakerIdentity(e);
  const speakerMeta =
    identity.key !== UNIDENTIFIED_SPEAKER ? ` · 👤 ${identity.label}` : "";
  $("key-meta").textContent =
    `${e.file}:${e.line} · ${e.channel} · ${reference[e.key].call}${speakerMeta}`;
}

// ---------------------------------------------------------------------------
// Sélection et éditeur
// ---------------------------------------------------------------------------
function selectKey(key) {
  if (!key) return;
  selectedKey = key;
  const e = entriesByKey.get(key);
  if (!e) return;
  $("key-name").textContent = shortKey(key);
  renderKeyMeta(e);
  renderKeyAttribution(e);
  $("en-display").innerHTML = e.en != null ? highlight(e.en) : "<i>—</i>";
  $("fr-input").value = e.fr;
  refreshHighlight();
  renderSequenceBar(e);
  renderListRaf();
  updateModeSelect();
  updateValidateButton();
  updateFaceOverrideControls();
  updateSceneContextControls();
  schedulePreview();
}

function renderKeyAttribution(e) {
  const attribution = translatedAttribution(e);
  const author = $("key-author");
  author.classList.toggle("hidden", !attribution);
  author.textContent = attribution
    ? `✎ Traduit par ${attributionNames(attribution).join(", ")}`
    : "";
  author.dataset.tooltip = attribution ? attributionTooltip(attribution) : "";
}

function updateValidateButton() {
  const e = entriesByKey.get(selectedKey);
  const btn = $("btn-validate");
  // visible seulement quand FR est identique à EN (là où le marquage a un sens)
  const applicable = e && e.en != null && e.fr === e.en;
  btn.style.display = applicable ? "" : "none";
  if (!applicable) return;
  const validated = !!prefs.validated[selectedKey];
  btn.classList.toggle("validated", validated);
  $("validate-label").textContent = validated
    ? "✔ Marquée OK (identique voulu)"
    : "✓ OK tel quel";
}

function toggleValidated() {
  const e = entriesByKey.get(selectedKey);
  if (!e || e.en == null || e.fr !== e.en) return;
  const wasValidated = !!prefs.validated[selectedKey];
  if (wasValidated) delete prefs.validated[selectedKey];
  else prefs.validated[selectedKey] = true;
  savePreferences();
  e.todo = computeTodo(e);
  updateValidateButton();
  updateProgress();
  if (!wasValidated) gotoTodo(1);
  applyFilter();
}

function renderSequenceBar(e) {
  const bar = $("sequence-bar");
  bar.innerHTML = "";
  const seq = sequences.get(e.key);
  if (!seq || seq.length < 2) return;
  for (const s of seq) {
    const chip = document.createElement("div");
    chip.className =
      "seq-chip" +
      (s.key === e.key ? " current" : "") +
      (s.todo ? " todo" : "");
    chip.textContent = stripTags(s.fr || s.en || s.key).slice(0, 40) || "∅";
    chip.dataset.tooltip = (s.en ?? "") + "\n→ " + s.fr;
    chip.onclick = () => selectKey(s.key);
    bar.appendChild(chip);
  }
  const cur = bar.querySelector(".current");
  if (cur) cur.scrollIntoView({ inline: "center", block: "nearest" });
}

function stripTags(t) {
  return t
    .replace(/\\[A-Za-z*+\-_].?/g, "")
    .replace(/\^[0-9]/g, "")
    .replace(/~[0-9]+/g, "")
    .replace(/[&|]/g, " ")
    .replace(/[/%]/g, "");
}

// Coloration syntaxique des tags
function highlight(text, renderGameLineBreaks = true) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      const tag = text.slice(i, i + 3);
      const t2 = text[i + 1];
      let cls = "tg-misc";
      if (t2 === "E" || t2 === "F" || t2 === "M" || t2 === "m") cls = "tg-face";
      else if (t2 === "c") cls = "tg-color";
      else if (t2 === "T" || t2 === "v" || t2 === "V" || t2 === "S") cls = "tg-misc";
      let style = "";
      if (t2 === "c" && C_TAG[text[i + 2]] && !["RAINBOW", "RESET"].includes(C_TAG[text[i + 2]])) {
        style = ` style="text-decoration: underline 2px ${C_TAG[text[i + 2]]}"`;
      }
      out += `<span class="tg ${cls}"${style}>${escapeHtml(tag)}</span>`;
      i += 3;
    } else if (c === "^" && /[0-9]/.test(text[i + 1] || "")) {
      out += `<span class="tg tg-pause">${escapeHtml(text.slice(i, i + 2))}</span>`;
      i += 2;
    } else if (c === "~" && /[0-9]/.test(text[i + 1] || "")) {
      const tag = text.slice(i).match(/^~[0-9]+/)[0];
      out += `<span class="tg tg-misc">${tag}</span>`;
      i += tag.length;
    } else if (c === "&" || c === "%" || c === "/" || c === "|") {
      out += `<span class="tg tg-flow">${escapeHtml(c)}</span>`;
      if (c === "&" && renderGameLineBreaks) out += "\n";
      i += 1;
    } else if (c === "`") {
      out += `<span class="tg tg-misc">\`${escapeHtml(text[i + 1] ?? "")}</span>`;
      i += 2;
    } else {
      out += escapeHtml(c);
      i += 1;
    }
  }
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function refreshHighlight() {
  const v = $("fr-input").value;
  // Dans l'éditeur, la couche colorée doit conserver exactement la géométrie
  // du textarea : le & est un caractère source, pas un vrai saut de ligne.
  $("fr-highlight").innerHTML = highlight(v, false) + "\n";
  updateLineLens(v);
}

// Longueur des lignes vs limite de la boîte
function updateLineLens(text) {
  const mode = effectiveMode();
  const state = inheritedState();
  const hasFace = /\\F[^0]/.test(text) || state.fc !== 0;
  let charline = 33;
  if (mode === "battletext") charline = hasFace ? 29 : 37;
  else if ((mode === "darkbox" || mode === "lightbox") && state.typer === 97)
    charline = 23;
  else if (mode === "platform") charline = hasFace ? 31 : 38;
  else if (mode === "darkbox" || mode === "lightbox" || mode === "shop" || mode === "device")
    charline = hasFace ? 26 : 33;
  else charline = 999;

  const lines = visualLines(text, mode === "trial" || Boolean(reference[selectedKey]?.choice));
  const parts = lines.map((len) => {
    const cls = len > charline ? "over" : "";
    return `<span class="${cls}">${len}</span>`;
  });
  $("line-lens").innerHTML = parts.join(" · ");
}

// Longueur visible de chaque ligne (règles de comptage d'Other_15)
function visualLines(text, hashBreak = false) {
  const lens = [];
  let cur = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "`") { cur++; i += 2; continue; }
    if (c === "\\") { i += 3; continue; }
    if (c === "^") { i += 2; continue; }
    if (c === "/" || c === "%") { i += 1; continue; }
    if (c === "&" || c === "\n" || (hashBreak && c === "#")) {
      lens.push(cur); cur = 0; i += 1; continue;
    }
    cur++;
    i += 1;
  }
  lens.push(cur);
  return lens;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------
let previewTimer = null;
let previewQueue = Promise.resolve();
let previewGeneration = 0;
function schedulePreview() {
  const generation = ++previewGeneration;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewQueue = previewQueue.then(() => generation === previewGeneration ? runPreview() : undefined)
      .catch(error => { $("preview-info").textContent = `Aperçu impossible : ${error.message}`; });
  }, 120);
}

// Compatibilité avec une référence générée par une ancienne version : les
// dialogues étoilés d'un objet shop passent par son obj_writer même lorsqu'ils
// sont stockés sans code final / ou % (obj_shop_ch5._intro_text). Le nouveau
// catalogue suit directement les affectations à global.msg.
function isShopDialogueFallback(e) {
  const file = (e?.file || "").toLowerCase();
  if (!/gml_object_obj_shop\w*_(?:create|draw|other)_0/.test(file)) return false;
  const source = e.en ?? e.fr ?? "";
  const visibleStart = source.replace(/^(?:\\..|\^[0-9]|[|&]|\s)*/, "");
  return visibleStart.startsWith("*");
}

// `/` (attend) et `%` (fin) sont des codes de flux du writer : une chaîne qui
// se termine ainsi est un message de textbox, pas un libellé de menu. Un code
// de flux est collé au texte : précédé d'un espace c'est un caractère littéral
// (« Numpad / ») ; précédé d'un chiffre, `%` est un vrai pourcentage.
function endsWithWriterClose(text) {
  const s = String(text ?? "").trimEnd();
  const m = s.match(/(\/%|%%|\/|%)$/);
  if (!m) return false;
  const before = s[s.length - m[1].length - 1];
  if (before === " ") return false;
  if (m[1] === "%" && /\d/.test(before ?? "")) return false;
  return true;
}

// Le jeu choisit la boîte selon global.darkzone (état runtime, scr_become_dark
// / scr_become_light). Statiquement, la room du décor détecté est le meilleur
// indice : on ne passe en monde clair que sur un préfixe sans ambiguïté.
const LIGHT_WORLD_ROOM_RE =
  /^room_(?:town|lw_|hospital|school|kris|tor|diner|library|flowershop|graveyard|townhall|beach|insidecloset|alphys|church|icehouse|man$)/;

function lightWorldAdjust(e, mode) {
  if (mode !== "darkbox") return mode;
  const contexts = reference[e.key]?.sceneContexts;
  if (!contexts?.length) return mode;
  const override = prefs.sceneOverrides[e.key];
  const context = contexts.find((c) => sceneContextKey(c) === override) ?? contexts[0];
  return LIGHT_WORLD_ROOM_RE.test(context.room ?? "") ? "lightbox" : mode;
}

function autoMode(e) {
  if (!e || e.noref) return "darkbox";
  const smallFaceDialogueKey = reference[e.key]?.smallFace?.dialogueKey;
  if (smallFaceDialogueKey) {
    const linkedMode = reference[smallFaceDialogueKey]?.previewMode;
    return linkedMode ? lightWorldAdjust(e, linkedMode) : "darkbox";
  }
  if (isShopDialogueFallback(e)) return "shop";
  const detectedMode = reference[e.key]?.previewMode;
  if (detectedMode) return lightWorldAdjust(e, detectedMode);
  // Les wrappers c_msg* créent une textbox de cinématique via obj_dialoguer.
  // Leur catalogue peut toutefois préciser "platform" : la commande `talk`
  // choisit obj_dialoguer_plat lorsqu'un obj_plat_player existe.
  if (String(e.channel ?? "").startsWith("cutscene-"))
    return lightWorldAdjust(e, "darkbox");
  const f = (e.file || "").toLowerCase();
  if (/enemy|battle|blcon|_attack|encounter|boss|trashy_trio/.test(f)) {
    // texte à astérisque = boîte de combat en bas ; sinon = bulle de l'ennemi
    const t = (e.en ?? e.fr ?? "").replace(/^(\\..|\^[0-9]|[|&/%])*/, "");
    return t.startsWith("*") ? "battletext" : "bubble";
  }
  if (e.channel === "string") {
    // Référence pas encore régénérée : la terminaison writer signe un dialogue.
    if (endsWithWriterClose(e.en ?? e.fr)) return lightWorldAdjust(e, "darkbox");
    return "plain";
  }
  return lightWorldAdjust(e, "darkbox");
}

function effectiveMode() {
  const sel = $("sel-mode").value;
  if (sel !== "auto") return sel;
  const override = prefs.modeOverrides[selectedKey];
  if (override) return override;
  return autoMode(entriesByKey.get(selectedKey));
}

// Hérite fc/fe du contexte GML (précalculé) puis des lignes précédentes de la séquence
function inheritedState(key = selectedKey) {
  const state = {
    fc: 0,
    fe: 0,
    faceVariant: null,
    typer: null,
    miniFaceBank: null,
    speakerOverlay: null,
    deviceStyle: null,
  };
  const ref = reference[key];
  state.typer = ref?.typer ?? null;
  state.miniFaceBank = ref?.miniFaceBank ?? null;
  state.speakerOverlay = ref?.speakerOverlay ?? null;
  state.deviceStyle = ref?.deviceStyle ?? null;
  if (ref?.face) {
    state.fc = ref.face.fc;
    state.fe = ref.face.fe ?? 0;
    state.faceVariant = ref.face.variant ?? null;
  }
  const seq = sequences.get(key);
  if (!seq) return state;
  for (const s of seq) {
    if (s.key === key) break;
    const t = s.fr || s.en || "";
    scanStateTags(t, state);
  }
  return state;
}

function scanStateTags(text, state) {
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "`") { i++; continue; }
    if (text[i] !== "\\") continue;
    const t = text[i + 1];
    const a = text[i + 2];
    if (t === "F" && a in F_TAG) state.fc = F_TAG[a];
    if (t === "E" && a) {
      const c = a.charCodeAt(0);
      state.fe = c >= 97 ? c - 61 : c >= 65 ? c - 55 : c - 48;
    }
    i += 2;
  }
}

function sceneContextKey(context) {
  return `${context.image}|${context.focusX ?? ""}|${context.focusY ?? ""}`;
}

function selectedSceneContext(key = selectedKey, mode = effectiveMode()) {
  if (!["darkbox", "lightbox", "platform"].includes(mode)) return null;
  const contexts = reference[key]?.sceneContexts ?? [];
  if (!contexts.length) return null;
  const override = prefs.sceneOverrides[key];
  return contexts.find((context) => sceneContextKey(context) === override) ?? contexts[0];
}

function roomSceneApplies() {
  return ["darkbox", "lightbox", "platform"].includes(effectiveMode());
}

function contextConfidenceLabel(confidence) {
  if (confidence === "camera-exact") return "caméra exacte";
  if (confidence === "exact") return "room certaine";
  if (confidence === "high") return "héritage d’objet";
  return "contexte déduit";
}

function updateSceneContextControls() {
  const wrap = $("preview-context-controls");
  const select = $("sel-scene-context");
  const info = $("preview-context-info");
  const contexts = reference[selectedKey]?.sceneContexts ?? [];
  select.replaceChildren();
  if (!roomSceneApplies()) {
    wrap.classList.add("no-context");
    info.textContent = "Ce mode utilise son propre décor (combat, shop ou texte libre).";
    return;
  }
  if (!contexts.length) {
    wrap.classList.add("no-context");
    info.textContent = "Décor non localisable automatiquement (texte partagé ou objet dynamique).";
    return;
  }

  wrap.classList.remove("no-context");
  contexts.forEach((context, index) => {
    const option = document.createElement("option");
    option.value = sceneContextKey(context);
    option.textContent =
      `${context.room} · ${contextConfidenceLabel(context.confidence)}` +
      (contexts.length > 1 ? ` · vue ${index + 1}/${contexts.length}` : "");
    select.appendChild(option);
  });
  const selected = selectedSceneContext();
  select.value = sceneContextKey(selected);
  select.style.display = contexts.length > 1 ? "" : "none";
  info.textContent =
    `${selected.room} — ${contextConfidenceLabel(selected.confidence)}` +
    (selected.reason ? ` (${selected.reason})` : "") +
    ` · ancre ${selected.focusX}, ${selected.focusY}`;
}

async function runPreview({ key = selectedKey, target = preview, quality = false } = {}) {
  if (!target || !key) return;
  const e = entriesByKey.get(key);
  const showEn = quality ? false : $("chk-en-preview").checked;
  if (target === preview) target.fonts = showEn ? englishFonts : targetFonts;
  const sourceText = showEn ? (e.en ?? "") : quality ? e.fr : $("fr-input").value;
  const substitution = substituteArgs(
    sourceText,
    reference[key]?.substitutions,
    reference[key]?.substitutionSamples
  );
  const mode = quality ? prefs.modeOverrides[key] ?? autoMode(e) : effectiveMode();
  const state = inheritedState(key);
  const choiceWarnings = [];
  state.language = showEn ? "en" : appConfig.targetLanguage ?? "fr";
  state.sceneContext = selectedSceneContext(key, mode);
  state.platformSide =
    prefs.platformSides[key] ??
    reference[key]?.platformSide ??
    state.sceneContext?.platformSide ??
    0;
  state.trialCase = reference[key]?.trialCase ?? 0;
  const trialPromptKey = "obj_yellow_trial_manager_slash_Draw_0_gml_33_0";
  state.trialPrompt = showEn
    ? reference[trialPromptKey]?.en
    : lang[trialPromptKey] ?? reference[trialPromptKey]?.en;
  const sourceFile = reference[key]?.file ?? e.file ?? "";
  if (/obj_shop1(?:_|$)/i.test(sourceFile)) state.scene = "shop-seam";
  if (/obj_trashy_trio(?:_|$)/i.test(sourceFile)) state.scene = "trashy-trio";
  if (/obj_shop_music(?:_|$)/i.test(sourceFile)) {
    state.typer = 78;
    state.shopCharline = 36;
  }
  // Acteur de la bulle (détection statique, reference.json). Un héros parle
  // via scr_heroblcon → side -1 (bulle à droite, queue vers la gauche).
  state.bubbleActor = reference[key]?.bubbleActor ?? null;
  state.bubbleSide =
    prefs.bubbleSides[key] ?? (state.bubbleActor?.kind === "hero" ? -1 : 1);
  const choice = reference[key]?.choice;
  if (choice?.options?.length) {
    state.choiceOptions = choice.options.map((option) => {
      const optionRef = option.key ? reference[option.key] : null;
      const optionSource = option.key
        ? showEn
          ? optionRef?.en ?? option.text ?? ""
          : lang[option.key] ?? optionRef?.en ?? option.text ?? ""
        : option.text ?? "";
      const resolved = substituteArgs(
        optionSource,
        optionRef?.substitutions,
        optionRef?.substitutionSamples
      );
      choiceWarnings.push(
        ...resolved.sampled.map(
          ({ index, value }) =>
            `Choix ~${index} → « ${value} » (exemple — valeur dynamique en jeu)`
        ),
        ...resolved.unresolved.map(
          (id) => `Choix ~${id} : valeur dynamique inconnue hors du jeu`
        )
      );
      return resolved.text;
    });
    state.choiceSelected = choice.index;
    state.choiceSide = choice.side;
    state.fc = 0;
    state.fe = 0;
    state.faceVariant = null;
    state.speakerOverlay = null;
    if (mode === "platform") state.platformSide = 1;
  }
  const smallFace = reference[key]?.smallFace;
  if (smallFace?.dialogueKey) {
    const dialogueKey = smallFace.dialogueKey;
    const dialogueRef = dialogueKey ? reference[dialogueKey] : null;
    const dialogueSource = showEn
      ? dialogueRef?.en ?? ""
      : dialogueKey && lang[dialogueKey] != null
        ? lang[dialogueKey]
        : dialogueRef?.en ?? "";
    const dialogueSubstitution = substituteArgs(
      dialogueSource,
      dialogueRef?.substitutions,
      dialogueRef?.substitutionSamples
    );
    state.fc = dialogueRef?.face?.fc ?? 0;
    state.fe = dialogueRef?.face?.fe ?? 0;
    state.faceVariant = dialogueRef?.face?.variant ?? null;
    state.typer = dialogueRef?.typer ?? state.typer;
    state.miniFaceBank = dialogueRef?.miniFaceBank ?? state.miniFaceBank;
    state.speakerOverlay = dialogueRef?.speakerOverlay ?? state.speakerOverlay;
    if (prefs.platformSides[key] == null && dialogueRef?.platformSide != null)
      state.platformSide = dialogueRef.platformSide;
    state.smallFace = {
      ...smallFace,
      text: substitution.text,
      dialogueText: dialogueSubstitution.text,
    };
  }
  // forçage manuel du visage pour la preview
  const fo = prefs.faceOverrides[key];
  if (fo) {
    state.fc = fo.fc;
    state.fe = fo.fe;
  }

  const res = await target.render(substitution.text, mode, state);

  const substitutionWarnings = [
    ...substitution.sampled.map(
      ({ index, value }) => `~${index} → « ${value} » (exemple — valeur dynamique en jeu)`
    ),
    ...substitution.unresolved.map(
      (id) => `~${id} : valeur dynamique inconnue hors du jeu`
    ),
  ];
  res.warnings = [...substitutionWarnings, ...choiceWarnings, ...(res.warnings ?? [])];
  if (quality) return res;
  if (key !== selectedKey) return;
  const warnEl = $("preview-warnings");
  warnEl.innerHTML = "";
  for (const w of res.warnings) {
    const d = document.createElement("div");
    d.className = "warn";
    d.textContent = w;
    warnEl.appendChild(d);
  }
  const fcName = FC_NAMES[res.fc] ?? res.fc;
  $("preview-info").textContent =
    `${res.lines} ligne(s) · visage : ${fcName}` +
    (res.fc ? ` (expr. ${res.fe})` : "") +
    ` · mode : ${res.mode}` +
    (state.sceneContext ? ` · room : ${state.sceneContext.room}` : "");
}

function updateModeSelect() {
  const override = prefs.modeOverrides[selectedKey];
  $("sel-mode").value = override ?? "auto";
  updateSideControl();
}

function updateSideControl() {
  const mode = effectiveMode();
  const button = $("btn-side");
  button.style.display = mode === "bubble" || mode === "platform" ? "" : "none";
  button.dataset.tooltip =
    mode === "platform" ? "Basculer la bande en haut ou en bas" : "Côté de la bulle";
}

// Contrôles « Visage » de la preview : reflètent l'override de la clé courante
function updateFaceOverrideControls() {
  const fo = prefs.faceOverrides[selectedKey];
  $("sel-preview-face").value = fo ? String(fo.fc) : "auto";
  $("inp-preview-fe").value = fo ? fo.fe : 0;
}

function applyFaceOverride() {
  const v = $("sel-preview-face").value;
  if (v === "auto") delete prefs.faceOverrides[selectedKey];
  else
    prefs.faceOverrides[selectedKey] = {
      fc: Number(v),
      fe: Math.max(0, Number($("inp-preview-fe").value) || 0),
    };
  savePreferences();
  const e = entriesByKey.get(selectedKey);
  if (e) renderKeyMeta(e);
  if (prefs.listSort === "speaker") {
    buildSpeakerFilterOptions();
    applyFilter();
    scrollToSelected();
  }
  schedulePreview();
}

// ---------------------------------------------------------------------------
// Barre de tags
// ---------------------------------------------------------------------------
function buildFaceSelectors() {
  const selFace = $("sel-face");
  selFace.innerHTML = "";
  for (const [ch, fc] of Object.entries(F_TAG)) {
    const opt = document.createElement("option");
    opt.value = ch;
    opt.textContent = `\\F${ch} — ${FC_NAMES[fc] ?? fc}`;
    selFace.appendChild(opt);
  }
  const selExpr = $("sel-expr");
  selExpr.innerHTML = "";
  for (let fe = 0; fe <= 30; fe++) {
    const opt = document.createElement("option");
    opt.value = encodeFe(fe);
    opt.textContent = `\\E${encodeFe(fe)} — expr. ${fe}`;
    selExpr.appendChild(opt);
  }
  // sélecteur de visage de la preview (auto + tous les personnages)
  const selPrev = $("sel-preview-face");
  selPrev.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = "Auto (détecté)";
  selPrev.appendChild(auto);
  for (const [fc, name] of Object.entries(FC_NAMES)) {
    if (fc === "0") continue;
    const opt = document.createElement("option");
    opt.value = fc;
    opt.textContent = name;
    selPrev.appendChild(opt);
  }
}

function buildColorSwatches() {
  const wrap = $("color-swatches");
  wrap.innerHTML = "";
  for (const [ch, color] of Object.entries(C_TAG)) {
    if (color === "RESET") continue;
    const s = document.createElement("span");
    s.className = "swatch";
    s.style.background = color === "RAINBOW"
      ? "linear-gradient(45deg,red,orange,yellow,green,blue,violet)"
      : color;
    s.dataset.tooltip = `\\c${ch}`;
    s.onclick = () => insertAtCursor(`\\c${ch}`);
    wrap.appendChild(s);
  }
}

function editorState() {
  const ta = $("fr-input");
  return {
    value: ta.value,
    selectionStart: ta.selectionStart,
    selectionEnd: ta.selectionEnd,
  };
}

function editHistory() {
  if (!editHistories.has(selectedKey)) {
    editHistories.set(selectedKey, {
      undo: [], redo: [], lastInputType: null, lastInputAt: 0,
    });
  }
  return editHistories.get(selectedKey);
}

function recordUndo(state, inputType) {
  const history = editHistory();
  const now = performance.now();
  const groupable = ["insertText", "deleteContentBackward", "deleteContentForward"].includes(inputType);
  const continuesGroup = groupable &&
    history.lastInputType === inputType &&
    now - history.lastInputAt < 750;
  if (!continuesGroup) {
    history.undo.push(state);
    if (history.undo.length > 100) history.undo.shift();
  }
  history.redo.length = 0;
  history.lastInputType = inputType;
  history.lastInputAt = now;
}

function applyEditHistory(direction) {
  const history = editHistory();
  const source = direction === "undo" ? history.undo : history.redo;
  const target = direction === "undo" ? history.redo : history.undo;
  const state = source.pop();
  if (!state) return;

  target.push(editorState());
  history.lastInputType = null;
  pendingEdit = null;
  applyingHistory = true;
  const ta = $("fr-input");
  ta.value = state.value;
  ta.setSelectionRange(state.selectionStart, state.selectionEnd);
  onEdit();
  applyingHistory = false;
}

function insertAtCursor(text, inputType = "insertReplacementText") {
  const ta = $("fr-input");
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const before = editorState();
  ta.setRangeText(text, start, end, "end");
  ta.focus();
  onEdit({ state: before, inputType });
}

function setupTagWheel() {
  const wheel = $("tag-wheel");
  const ring = $("tag-wheel-ring");
  const value = $("tag-wheel-value");
  const label = $("tag-wheel-label");
  const quickTools = [
    { tag: "^1", label: "pause courte", kind: "pause" },
    { tag: "^3", label: "pause légère", kind: "pause" },
    { tag: "^6", label: "pause longue", kind: "pause" },
    { tag: "^9", label: "pause max", kind: "pause" },
    { tag: "~1", label: "substitution 1", kind: "flow" },
    { tag: "~2", label: "substitution 2", kind: "flow" },
    { tag: "/", label: "attendre", kind: "flow" },
    { tag: "%", label: "message suivant", kind: "flow" },
    { tag: "/%", label: "fin de séquence", kind: "flow" },
  ];
  let tools = [];
  let buttons = [];
  let pointerX = innerWidth / 2;
  let pointerY = innerHeight / 2;
  let open = false;
  let wheelMode = "quick";
  let triggerCode = null;
  let activeIndex = -1;
  let centerX = 0;
  let centerY = 0;
  let savedSelection = null;
  let wheelRadius = 110;

  function describeTag(tag) {
    if (tag.startsWith("^")) return { label: `pause ${tag.slice(1)}`, kind: "pause" };
    if (tag.startsWith("~")) return { label: "substitution", kind: "misc" };
    if (/^\{[0-9]+\}$/.test(tag)) return { label: "variable", kind: "misc" };
    if (tag.startsWith("`")) return { label: "caractère échappé", kind: "misc" };
    const flowLabels = {
      "&": "saut de ligne",
      "|": "espace d’alignement",
      "#": "saut de ligne menu",
      "/": "attendre",
      "%": "message suivant",
      "/%": "fin de séquence",
      "%%": "double fin de message",
    };
    if (flowLabels[tag]) return { label: flowLabels[tag], kind: "flow" };
    if (tag.startsWith("\\")) {
      const type = tag[1];
      const descriptions = {
        E: "expression",
        F: "portrait",
        M: "visage",
        m: "mini-visage",
        c: "couleur",
        T: "voix / style",
        C: "choix",
        I: "icône",
        O: "objet animé",
        "*": "touche manette",
      };
      const kind = ["E", "F", "M", "m"].includes(type)
        ? "face"
        : type === "c"
          ? "color"
          : "misc";
      return { label: descriptions[type] ?? "balise spéciale", kind };
    }
    return { label: "balise spéciale", kind: "misc" };
  }

  function sourceTools() {
    const entry = entriesByKey.get(selectedKey);
    if (!entry) return [];
    const found = new Map();
    for (const [source, text] of [["EN", entry.en], ["JP", entry.ja]]) {
      for (const { tag } of extractTags(text)) {
        if (!found.has(tag)) found.set(tag, new Set());
        found.get(tag).add(source);
      }
    }
    return [...found].map(([tag, sources]) => {
      const description = describeTag(tag);
      return {
        tag,
        kind: description.kind,
        label: `${description.label} · ${[...sources].join("+")}`,
      };
    });
  }

  function renderTools(nextTools) {
    tools = nextTools;
    // Force le rafraîchissement du centre même si la roue précédente avait
    // déjà été refermée sans secteur actif.
    activeIndex = -2;
    ring.replaceChildren();
    const count = tools.length;
    const distance = count > 9
      ? Math.ceil(42 / (2 * Math.sin(Math.PI / count)) + 8)
      : 74;
    wheelRadius = Math.max(110, distance + 42);
    wheel.style.setProperty("--wheel-size", `${wheelRadius * 2}px`);
    buttons = tools.map((tool, index) => {
      const button = document.createElement("button");
      const angle = index * (360 / count);
      button.type = "button";
      button.className = `tag-wheel-item ${tool.kind}`;
      button.style.setProperty("--angle", `${angle}deg`);
      button.style.setProperty("--distance", `${distance}px`);
      button.dataset.index = index;
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", `${tool.tag}, ${tool.label}`);
      const tag = document.createElement("span");
      tag.textContent = tool.tag;
      const detail = document.createElement("small");
      detail.textContent = tool.label;
      button.append(tag, detail);
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        setActive(index);
        commit();
      });
      ring.appendChild(button);
      return button;
    });
  }

  function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    buttons.forEach((button, i) => button.classList.toggle("active", i === index));
    if (index < 0) {
      value.textContent = wheelMode === "source" ? "ALT G" : "ALT D";
      label.textContent = wheelMode === "source"
        ? tools.length > 0
          ? `${tools.length} balise${tools.length > 1 ? "s" : ""} EN/JP`
          : "aucune balise EN/JP"
        : "Glisser";
    } else {
      value.textContent = tools[index].tag;
      label.textContent = tools[index].label;
    }
  }

  function updateActiveFromPointer(x, y) {
    const dx = x - centerX;
    const dy = y - centerY;
    if (Math.hypot(dx, dy) < 38) {
      setActive(-1);
      return;
    }
    const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    if (tools.length > 0) {
      setActive(Math.round(angle / (360 / tools.length)) % tools.length);
    }
  }

  function show(mode, code) {
    const ta = $("fr-input");
    if (open || document.activeElement !== ta || !selectedKey) return;
    wheelMode = mode;
    triggerCode = code;
    renderTools(mode === "source" ? sourceTools() : quickTools);
    ring.setAttribute(
      "aria-label",
      mode === "source" ? "Balises du dialogue anglais et japonais" : "Insertion rapide d’un tag"
    );
    savedSelection = { start: ta.selectionStart, end: ta.selectionEnd };
    const margin = wheelRadius + 2;
    centerX = Math.max(margin, Math.min(pointerX, innerWidth - margin));
    centerY = Math.max(margin, Math.min(pointerY, innerHeight - margin));
    wheel.style.left = `${centerX}px`;
    wheel.style.top = `${centerY}px`;
    wheel.classList.add("open");
    wheel.setAttribute("aria-hidden", "false");
    open = true;
    setActive(-1);
  }

  function hide() {
    if (!open) return;
    wheel.classList.remove("open");
    wheel.setAttribute("aria-hidden", "true");
    open = false;
    triggerCode = null;
    setActive(-1);
  }

  function commit() {
    if (!open || activeIndex < 0) {
      hide();
      return;
    }
    const tag = tools[activeIndex].tag;
    const ta = $("fr-input");
    hide();
    if (savedSelection) ta.setSelectionRange(savedSelection.start, savedSelection.end);
    insertAtCursor(tag, "insertReplacementText");
  }

  document.addEventListener("pointermove", (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (open) updateActiveFromPointer(pointerX, pointerY);
  }, { passive: true });
  window.addEventListener("keydown", (event) => {
    const isLeftAlt = event.code === "AltLeft" ||
      (event.key === "Alt" && event.location === KeyboardEvent.DOM_KEY_LOCATION_LEFT);
    const isRightAlt = event.code === "AltRight" || event.key === "AltGraph" ||
      (event.key === "Alt" && event.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT);
    if ((isLeftAlt || isRightAlt) && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat) show(isRightAlt ? "quick" : "source", event.code || event.key);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      hide();
    }
  }, true);
  window.addEventListener("keyup", (event) => {
    if (!open || (event.code || event.key) !== triggerCode) return;
    event.preventDefault();
    commit();
  }, true);
  window.addEventListener("blur", hide);
}

// ---------------------------------------------------------------------------
// Lecteur / éditeur de code GML
// ---------------------------------------------------------------------------
function codeText() {
  return codeState.editing ? $("code-input").value : codeState.content;
}

function setCodeStatus(message, modified = false) {
  const status = $("code-status");
  status.textContent = message;
  status.classList.toggle("modified", modified);
}

function updateCodeButtons() {
  $("btn-code-save").disabled = !codeState.dirty || codeApplyRunning;
  $("btn-code-reset").disabled =
    (!codeState.modified && !codeState.dirty) || codeApplyRunning;
  $("btn-code-apply").disabled = !codeState.file || codeApplyRunning;
  $("btn-code-edit").disabled = !codeState.file || codeApplyRunning;
  $("btn-code-edit").textContent = codeState.editing
    ? "▣ Revenir en lecture"
    : "✎ Activer l’édition";

  if (codeApplyRunning) return;
  if (codeState.dirty) {
    setCodeStatus("Override modifié mais pas encore enregistré.", true);
  } else if (codeState.needsApply) {
    setCodeStatus("Override enregistré — il reste à l’appliquer au data.win.", true);
  } else if (codeState.modified) {
    setCodeStatus("Override local enregistré. Le GML extrait original est intact.", true);
  } else {
    setCodeStatus("Lecture seule — le GML extrait reste intact.");
  }
}

function renderCodeSource(targetLine = codeState.targetLine) {
  codeState.targetLine = Number(targetLine) || null;
  const container = $("code-readonly");
  const fragment = document.createDocumentFragment();
  const lines = codeState.content.split("\n");
  lines.forEach((line, index) => {
    const number = index + 1;
    const row = document.createElement("div");
    row.className = `code-line${number === codeState.targetLine ? " target" : ""}`;
    row.dataset.line = String(number);
    const gutter = document.createElement("span");
    gutter.className = "code-line-number";
    gutter.textContent = String(number);
    const source = document.createElement("span");
    source.className = "code-line-text";
    source.textContent = line || " ";
    row.append(gutter, source);
    fragment.appendChild(row);
  });
  container.replaceChildren(fragment);
  requestAnimationFrame(() => {
    container.querySelector(".code-line.target")?.scrollIntoView({ block: "center" });
  });
}

function jumpToCodeLine(line) {
  const wanted = Math.max(1, Number(line) || 1);
  codeState.targetLine = wanted;
  if (!codeState.editing) {
    renderCodeSource(wanted);
    return;
  }
  const input = $("code-input");
  const lines = input.value.split("\n");
  const offset = lines.slice(0, wanted - 1).reduce((total, value) => total + value.length + 1, 0);
  input.focus();
  input.setSelectionRange(offset, Math.min(input.value.length, offset + (lines[wanted - 1]?.length ?? 0)));
  input.scrollTop = Math.max(0, (wanted - 4) * 18.6);
}

function codeFamily(file) {
  const match = String(file ?? "").match(
    /^(gml_Object_.+)_(Create|Destroy|CleanUp|Step|Draw|Alarm|Other|Collision|Keyboard|KeyPress|KeyRelease|Mouse|Gesture|PreCreate|RoomStart|RoomEnd|AnimationEnd|Async|UserEvent)_\d+$/
  );
  return match?.[1] ?? file;
}

function renderRelatedCodeEntries() {
  const list = $("code-related-list");
  const family = codeFamily(codeState.file);
  const related = entries
    .filter((entry) => codeFamily(entry.file) === family)
    .sort((a, b) => entryFileOrder(a, b));
  if (!related.length) {
    const empty = document.createElement("p");
    empty.textContent = "Aucun texte localisé référencé dans ce fichier.";
    list.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of related) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `code-related-item${entry.key === selectedKey ? " current" : ""}`;
    const meta = document.createElement("small");
    const eventName = entry.file === codeState.file
      ? "ce fichier"
      : entry.file.slice(family.length + 1).replaceAll("_", " ");
    meta.textContent = `${eventName} · ligne ${entry.line} · ${entry.channel ?? "code"}`;
    const text = document.createElement("span");
    text.textContent = stripTags(entry.fr || entry.en || entry.key).slice(0, 80) || "∅";
    button.append(meta, text);
    button.dataset.tooltip = `${entry.en ?? ""}\n→ ${entry.fr}`;
    button.onclick = async () => {
      if (entry.file !== codeState.file && !(await loadCodeFile(entry.file, entry.line))) return;
      selectKey(entry.key);
      renderRelatedCodeEntries();
      jumpToCodeLine(entry.line);
    };
    fragment.appendChild(button);
  }
  list.replaceChildren(fragment);
}

function entryFileOrder(a, b) {
  return a.file.localeCompare(b.file, "fr", { numeric: true }) || a.line - b.line;
}

async function refreshCodeFileResults(query, selected = null) {
  const files = await window.api.listCodeFiles(query);
  const select = $("code-file-results");
  select.replaceChildren();
  const values = selected && !files.includes(selected) ? [selected, ...files] : files;
  for (const file of values) {
    const option = document.createElement("option");
    option.value = file;
    option.textContent = file;
    select.appendChild(option);
  }
  if (selected) select.value = selected;
}

async function loadCodeFile(file, targetLine = null) {
  if (!file) return false;
  if (codeState.dirty && !confirm("Abandonner les modifications GML non enregistrées ?")) return false;
  const result = await window.api.readCodeFile(file);
  if (!result.ok) {
    alert(`Impossible de lire ce code.\n\n${result.error}`);
    return false;
  }
  Object.assign(codeState, {
    file: result.file,
    content: result.content,
    original: result.original,
    saved: result.content,
    modified: result.modified,
    editing: false,
    dirty: false,
    needsApply: false,
    targetLine: Number(targetLine) || null,
    findIndex: -1,
  });
  $("code-file-name").textContent = `${result.file}.gml${result.modified ? " · override local" : " · original extrait"}`;
  $("code-file-query").value = result.file;
  $("code-input").classList.add("hidden");
  $("code-readonly").classList.remove("hidden");
  renderCodeSource();
  renderRelatedCodeEntries();
  await refreshCodeFileResults(result.file, result.file);
  updateCodeButtons();
  return true;
}

async function openCodeModal() {
  if (!appReady) {
    alert("Importe d’abord le data.win d’un chapitre.");
    return;
  }
  $("code-modal").classList.remove("hidden");
  const ref = reference[selectedKey];
  if (ref?.file) {
    await loadCodeFile(ref.file, ref.line);
    return;
  }
  const files = await window.api.listCodeFiles("");
  await refreshCodeFileResults("");
  if (files[0]) await loadCodeFile(files[0]);
}

function closeCodeModal() {
  if (codeState.dirty && !confirm("Fermer sans enregistrer les modifications GML ?")) return false;
  if (codeState.dirty) {
    codeState.content = codeState.saved;
    codeState.dirty = false;
    codeState.editing = false;
  }
  $("code-modal").classList.add("hidden");
  return true;
}

function toggleCodeEditing() {
  if (!codeState.file) return;
  if (codeState.editing) {
    codeState.content = $("code-input").value;
    codeState.editing = false;
    $("code-input").classList.add("hidden");
    $("code-readonly").classList.remove("hidden");
    renderCodeSource();
  } else {
    codeState.editing = true;
    $("code-input").value = codeState.content;
    $("code-readonly").classList.add("hidden");
    $("code-input").classList.remove("hidden");
    jumpToCodeLine(codeState.targetLine || 1);
  }
  updateCodeButtons();
}

async function saveCodeOverride() {
  if (!codeState.file) return false;
  const content = codeText();
  const result = await window.api.saveCodeFile(codeState.file, content);
  if (!result.ok) {
    alert(`Impossible d’enregistrer l’override GML.\n\n${result.error}`);
    return false;
  }
  codeState.content = content;
  codeState.saved = content;
  codeState.modified = result.modified;
  codeState.dirty = false;
  codeState.needsApply = true;
  $("code-file-name").textContent = `${codeState.file}.gml${result.modified ? " · override local" : " · original extrait"}`;
  updateCodeButtons();
  return true;
}

async function resetCodeOverride() {
  if (!codeState.file) return;
  if (!confirm("Supprimer l’override de ce fichier et revenir au code extrait original ?")) return;
  const result = await window.api.resetCodeFile(codeState.file);
  if (!result.ok) {
    alert(`Impossible de restaurer le code original.\n\n${result.error}`);
    return;
  }
  Object.assign(codeState, {
    content: result.content,
    saved: result.content,
    original: result.content,
    modified: false,
    dirty: false,
    needsApply: true,
    editing: false,
  });
  $("code-file-name").textContent = `${codeState.file}.gml · original extrait`;
  $("code-input").classList.add("hidden");
  $("code-readonly").classList.remove("hidden");
  renderCodeSource();
  updateCodeButtons();
}

function findInCode(direction) {
  const query = $("code-find").value;
  if (!query) return;
  const text = codeText();
  const haystack = text.toLocaleLowerCase("fr");
  const needle = query.toLocaleLowerCase("fr");
  let start;
  if (codeState.editing) {
    start = direction > 0 ? $("code-input").selectionEnd : $("code-input").selectionStart - 1;
  } else {
    start = codeState.findIndex + direction;
  }
  let index = direction > 0 ? haystack.indexOf(needle, Math.max(0, start)) : haystack.lastIndexOf(needle, start);
  if (index < 0) index = direction > 0 ? haystack.indexOf(needle) : haystack.lastIndexOf(needle);
  if (index < 0) {
    setCodeStatus(`« ${query} » est introuvable dans ce fichier.`, true);
    return;
  }
  codeState.findIndex = index;
  if (codeState.editing) {
    const input = $("code-input");
    input.focus();
    input.setSelectionRange(index, index + query.length);
    const line = text.slice(0, index).split("\n").length;
    input.scrollTop = Math.max(0, (line - 4) * 18.6);
  } else {
    jumpToCodeLine(text.slice(0, index).split("\n").length);
  }
}

async function applyCodeToGame() {
  if (!codeState.file || codeApplyRunning) return;
  if (codeState.dirty && !(await saveCodeOverride())) return;
  if (!confirm("Recompiler le data.win actif avec tous les overrides GML enregistrés ?\n\nLe jeu doit être fermé pendant l’opération.")) return;

  codeApplyRunning = true;
  const progress = $("code-progress");
  progress.textContent = "";
  progress.classList.remove("hidden");
  setCodeStatus("Recompilation UTMT en cours…", true);
  updateCodeButtons();
  let appliedAt = null;
  try {
    if (dirty && !(await save())) return;
    const result = await window.api.applyCodeOverrides();
    if (!result.ok) {
      alert(`Le code n’a pas été appliqué. Le data.win actif est resté intact.\n\n${result.error}`);
      return;
    }
    codeState.needsApply = false;
    appliedAt = result.appliedAt;
  } catch (error) {
    alert(`Le code n’a pas été appliqué.\n\n${error.message ?? error}`);
  } finally {
    codeApplyRunning = false;
    updateCodeButtons();
    if (appliedAt) {
      setCodeStatus(`Code appliqué au jeu à ${new Date(appliedAt).toLocaleTimeString()}.`);
    }
  }
}

function bindCodeModal() {
  if (codeModalBound) return;
  codeModalBound = true;
  $("btn-code").onclick = openCodeModal;
  $("btn-close-code").onclick = closeCodeModal;
  $("btn-code-edit").onclick = toggleCodeEditing;
  $("btn-code-save").onclick = saveCodeOverride;
  $("btn-code-reset").onclick = resetCodeOverride;
  $("btn-code-apply").onclick = applyCodeToGame;
  $("btn-code-find-prev").onclick = () => findInCode(-1);
  $("btn-code-find-next").onclick = () => findInCode(1);
  $("code-file-query").addEventListener(
    "input",
    debounce(() => refreshCodeFileResults($("code-file-query").value), 180)
  );
  $("code-file-results").addEventListener("change", () => loadCodeFile($("code-file-results").value));
  $("code-find").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    findInCode(event.shiftKey ? -1 : 1);
  });
  $("code-input").addEventListener("input", () => {
    codeState.dirty = $("code-input").value !== codeState.saved;
    codeState.findIndex = -1;
    updateCodeButtons();
  });
  $("code-modal").addEventListener("mousedown", (event) => {
    if (event.target === $("code-modal")) closeCodeModal();
  });
  window.addEventListener("keydown", (event) => {
    if ($("code-modal").classList.contains("hidden")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeCodeModal();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      $("code-find").focus();
      $("code-find").select();
    }
  });
  window.api.onCodeProgress((line) => {
    const progress = $("code-progress");
    progress.classList.remove("hidden");
    progress.textContent += `${line}\n`;
    progress.scrollTop = progress.scrollHeight;
  });
}

// ---------------------------------------------------------------------------
// Édition / sauvegarde
// ---------------------------------------------------------------------------
function onEdit(historyEntry = null) {
  const e = entriesByKey.get(selectedKey);
  if (!e) return;
  if ($("fr-input").readOnly) { $("fr-input").value = e.fr; return; }
  const v = $("fr-input").value;
  if (v !== e.fr) {
    if (!applyingHistory) {
      const entry = historyEntry ?? pendingEdit ?? {
        state: { value: e.fr, selectionStart: 0, selectionEnd: 0 },
        inputType: "insertReplacementText",
      };
      recordUndo(entry.state, entry.inputType);
    }
    pendingEdit = null;
    e.fr = v;
    lang[selectedKey] = v;
    if (v === savedTranslations.get(selectedKey)) unsavedKeys.delete(selectedKey);
    else unsavedKeys.add(selectedKey);
    e.todo = computeTodo(e);
    e.searchable = buildSearchable(e);
    setDirty(unsavedKeys.size > 0);
    updateValidateButton();
  }
  refreshHighlight();
  schedulePreview();
}

function setSaveButtonLoading(loading) {
  const saveButton = $("btn-save");
  saveButton.classList.toggle("action-loading", loading);
  saveButton.setAttribute("aria-busy", String(loading));
  saveButton.disabled = loading || !dirty;
  saveButton.textContent = loading
    ? "Sauvegarde…"
    : dirty
      ? "💾 Sauvegarder"
      : "✓ Sauvegardé";
  saveButton.dataset.tooltip = loading
    ? "Sauvegarde en cours…"
    : dirty
      ? "Sauvegarder dans le jeu (Ctrl+S)"
      : "Toutes les modifications sont sauvegardées";
}

function setDirty(d) {
  dirty = d;
  $("btn-save").classList.toggle("dirty", d);
  setSaveButtonLoading(Boolean(savePromise));
  const st = $("save-state");
  st.className = d ? "dirty" : "";
  st.textContent = d
    ? `● ${unsavedKeys.size} traduction${unsavedKeys.size > 1 ? "s" : ""} non sauvegardée${unsavedKeys.size > 1 ? "s" : ""}`
    : "Aucune modification";
  if (!d) updateProgress();
}

function save({ allowPublish = false } = {}) {
  if (importing || setupDone || (runedeltaBusy && !allowPublish)) return Promise.resolve(false);
  if (!dirty) return Promise.resolve(true);
  if (savePromise) return savePromise;

  savePromise = (async () => {
    try {
      const langSnapshot = { ...lang };
      const r = await window.api.saveLang(langSnapshot, languageRevision);
      if (!r.ok) {
        alert(`La sauvegarde a échoué.\n\n${r.error ?? "Erreur inconnue"}`);
        return false;
      }
      const savedLanguage = r.language ?? langSnapshot;
      languageRevision = r.revision;
      lang = mergeSavedEdits(lang, langSnapshot, savedLanguage);
      if (r.attributions) runedeltaAttributions = r.attributions;
      for (const entry of entries) {
        if (Object.hasOwn(lang, entry.key)) {
          entry.fr = lang[entry.key];
          entry.todo = computeTodo(entry);
          entry.searchable = buildSearchable(entry);
        }
      }
      savedTranslations = new Map(entries.map((entry) => [entry.key, savedLanguage[entry.key] ?? reference[entry.key]?.en]));
      unsavedKeys.clear();
      for (const entry of entries) {
        if (entry.fr !== savedTranslations.get(entry.key)) unsavedKeys.add(entry.key);
      }
      setDirty(unsavedKeys.size > 0);
      if (!dirty) {
        const st = $("save-state");
        st.className = "saved";
        st.textContent =
          `✔ Sauvegardé localement à ${new Date(r.savedAt).toLocaleTimeString()}` +
          (r.backupCreated ? " (backup créé)" : "");
      }
      if (appConfig.runedelta?.modeEnabled === true && appConfig.runedelta?.enabled) await refreshRunedeltaStatus();
      updateProgress();
      renderList();
      refreshHighlight();
      schedulePreview();
      return true;
    } catch (error) {
      alert(`La sauvegarde a échoué.\n\n${error.message ?? error}`);
      return false;
    } finally {
      savePromise = null;
      setSaveButtonLoading(false);
    }
  })();
  setSaveButtonLoading(true);
  return savePromise;
}

async function saveAndGotoNext() {
  if (saveAndNextRunning) return;
  saveAndNextRunning = true;
  const keyToLeave = selectedKey;
  try {
    onEdit();
    if ((await save()) && selectedKey === keyToLeave && !gotoNextDialogue()) gotoTodo(1);
  } finally {
    saveAndNextRunning = false;
  }
}

function gotoNextDialogue() {
  const seq = sequences.get(selectedKey);
  const index = seq?.findIndex((entry) => entry.key === selectedKey) ?? -1;
  const next = index >= 0 ? seq[index + 1] : null;
  if (!next) return false;
  selectKey(next.key);
  scrollToSelected();
  return true;
}

function backupIfModified() {
  if (importing || setupDone || prefs.backupsEnabled !== true || !dirty || backupPromise) return;
  backupPromise = window.api
    .backupLang({ ...lang })
    .then((result) => {
      if (!result.ok) console.error(`Backup automatique impossible : ${result.error}`);
    })
    .catch((error) => console.error("Backup automatique impossible :", error))
    .finally(() => {
      backupPromise = null;
    });
}

setTimeout(() => {
  backupIfModified();
  setInterval(backupIfModified, BACKUP_CHECK_MS);
}, BACKUP_CHECK_MS);

async function handleCloseRequest() {
  if (closePromptOpen) return;
  if (importing || installingUtmt || codeApplyRunning || runedeltaBusy) {
    showSetupError("La préparation est en cours. Attends sa fin avant de fermer DELTATRANSLATE.");
    return;
  }
  closePromptOpen = true;
  try {
    await prefsSavePromise;
    if (prefsSaveFailed && !(await savePreferences())) return;
    if (savePromise) await savePromise;
    if (codeState.dirty && !confirm("Quitter sans enregistrer les modifications GML ?")) return;
    const choice = await window.api.confirmClose(unsavedKeys.size);
    if (choice === "cancel") return;
    if (choice === "save" && !(await save())) return;
    if (choice === "save" && dirty) return;
    await window.api.closeWindow();
  } finally {
    closePromptOpen = false;
  }
}

function updateProgress() {
  const withRef = entries.filter((e) => !e.noref);
  const done = withRef.filter((e) => !e.todo).length;
  const pct = withRef.length ? Math.round((done / withRef.length) * 1000) / 10 : 0;
  $("progress-fill").style.width = pct + "%";
  $("progress-label").textContent =
    `${done} / ${withRef.length} traduites (${pct} %) · ${withRef.length - done} restantes`;
}

function gotoTodo(dir) {
  if (!filtered.length) return;
  let idx = filtered.findIndex((e) => e.key === selectedKey);
  for (let n = 0; n < filtered.length; n++) {
    idx = (idx + dir + filtered.length) % filtered.length;
    if (filtered[idx].todo) {
      selectKey(filtered[idx].key);
      scrollToSelected();
      return;
    }
  }
}

function scrollToSelected(center = false) {
  const idx = filtered.findIndex((e) => e.key === selectedKey);
  if (idx < 0) return;
  const container = $("list-container");
  const y = idx * ROW_H;
  if (
    center ||
    y < container.scrollTop ||
    y > container.scrollTop + container.clientHeight - ROW_H
  ) {
    container.scrollTop = Math.max(0, y - (container.clientHeight - ROW_H) / 2);
  }
  renderList();
}

function openDialogueSearch() {
  const bar = $("dialogue-search-bar");
  const button = $("btn-toggle-search");
  bar.classList.remove("hidden");
  button.classList.add("active");
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-pressed", "true");
  button.setAttribute("aria-label", "Fermer la recherche");
  button.dataset.tooltip = "Fermer la recherche (Échap)";
  $("search").focus();
  $("search").select();
}

function closeDialogueSearch() {
  const search = $("search");
  const button = $("btn-toggle-search");
  search.value = "";
  $("dialogue-search-bar").classList.add("hidden");
  button.classList.remove("active");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", "Rechercher un dialogue");
  button.dataset.tooltip = "Rechercher un dialogue (Ctrl+F)";
  applyFilter({ restoreSelected: true });
}

function toggleDialogueSearch() {
  if ($("dialogue-search-bar").classList.contains("hidden")) openDialogueSearch();
  else closeDialogueSearch();
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------
function bindEvents() {
  setupTagWheel();
  $("btn-theme").onclick = toggleTheme;
  $("list-container").addEventListener("scroll", renderListRaf, { passive: true });
  $("search").addEventListener(
    "input",
    debounce(() => applyFilter({ restoreSelected: $("search").value.trim() === "" }), 200)
  );
  $("btn-toggle-search").addEventListener("click", toggleDialogueSearch);
  $("btn-close-search").addEventListener("click", closeDialogueSearch);
  $("sel-list-sort").addEventListener("change", () => {
    prefs.listSort = $("sel-list-sort").value;
    savePreferences();
    $("speaker-filter-row").classList.toggle("hidden", prefs.listSort !== "speaker");
    $("list-container").scrollTop = 0;
    applyFilter();
  });
  $("sel-speaker-filter").addEventListener("change", () => {
    prefs.speakerFilter = $("sel-speaker-filter").value;
    savePreferences();
    $("list-container").scrollTop = 0;
    applyFilter();
  });
  document.querySelectorAll(".filter").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelector(".filter.active").classList.remove("active");
      b.classList.add("active");
      applyFilter();
    })
  );

  const ta = $("fr-input");
  ta.addEventListener("beforeinput", (ev) => {
    if (ev.inputType === "historyUndo" || ev.inputType === "historyRedo") return;
    pendingEdit = { state: editorState(), inputType: ev.inputType };
  });
  ta.addEventListener("input", () => onEdit());
  ta.addEventListener("keydown", (ev) => {
    const shortcut = ev.ctrlKey || ev.metaKey;
    if (ev.ctrlKey && ev.key === "Enter") {
      ev.preventDefault();
      void saveAndGotoNext();
    } else if (shortcut && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      applyEditHistory(ev.shiftKey ? "redo" : "undo");
    } else if (shortcut && ev.key.toLowerCase() === "y") {
      ev.preventDefault();
      applyEditHistory("redo");
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      insertAtCursor(ev.shiftKey ? "\n" : "&", ev.shiftKey ? "insertLineBreak" : "insertGameLineBreak");
    }
  });
  ta.addEventListener("scroll", () => {
    $("fr-highlight").scrollTop = ta.scrollTop;
    $("fr-highlight").scrollLeft = ta.scrollLeft;
  });

  $("btn-save").onclick = save;
  $("btn-backups").onclick = () => showHistory(window.api, { current: () => lang, restore: (key, value) => {
    if (!entriesByKey.has(key)) { lang[key] = ""; buildIndex(); buildSequences(); applyFilter(); }
    selectKey(key);
    const before = editorState();
    $("fr-input").value = value;
    onEdit({ state: before, inputType: "insertReplacementText" });
    scrollToSelected();
  } });
  $("btn-reload").onclick = async () => {
    if (
      (dirty || codeState.dirty) &&
      !confirm("Des modifications non sauvegardées seront perdues. Recharger ?")
    )
      return;
    location.reload();
  };

  $("sel-mode").addEventListener("change", () => {
    const v = $("sel-mode").value;
    if (v === "auto") delete prefs.modeOverrides[selectedKey];
    else prefs.modeOverrides[selectedKey] = v;
    savePreferences();
    if (prefs.listSort === "type") {
      applyFilter();
      scrollToSelected();
    }
    updateSceneContextControls();
    updateSideControl();
    schedulePreview();
  });
  $("btn-side").onclick = () => {
    if (effectiveMode() === "platform") {
      const current =
        prefs.platformSides[selectedKey] ?? selectedSceneContext()?.platformSide ?? 0;
      prefs.platformSides[selectedKey] = current === 1 ? 0 : 1;
    } else {
      // même défaut que runPreview : un héros (scr_heroblcon) parle side -1
      const fallback = reference[selectedKey]?.bubbleActor?.kind === "hero" ? -1 : 1;
      prefs.bubbleSides[selectedKey] = (prefs.bubbleSides[selectedKey] ?? fallback) * -1;
    }
    savePreferences();
    schedulePreview();
  };
  $("chk-en-preview").addEventListener("change", schedulePreview);
  $("btn-validate").onclick = toggleValidated;
  $("sel-preview-face").addEventListener("change", applyFaceOverride);
  $("inp-preview-fe").addEventListener("input", debounce(applyFaceOverride, 150));
  $("sel-scene-context").addEventListener("change", () => {
    prefs.sceneOverrides[selectedKey] = $("sel-scene-context").value;
    savePreferences();
    if (prefs.listSort === "type") {
      applyFilter();
      scrollToSelected();
    }
    updateSceneContextControls();
    schedulePreview();
  });

  document.querySelectorAll(".ins").forEach((b) =>
    b.addEventListener("click", () => insertAtCursor(b.dataset.ins))
  );
  $("btn-insert-face").onclick = () =>
    insertAtCursor(`\\F${$("sel-face").value}\\E${$("sel-expr").value}`);
  $("btn-copy-en").onclick = () => {
    const e = entriesByKey.get(selectedKey);
    if (e?.en != null) {
      const before = editorState();
      $("fr-input").value = e.en;
      onEdit({ state: before, inputType: "insertReplacementText" });
    }
  };
  $("btn-copy-tags").onclick = () => {
    const e = entriesByKey.get(selectedKey);
    if (e?.en == null) return;
    // tags de tête et de queue du texte EN
    const head = e.en.match(/^(?:(?:\\..)|(?:\^[0-9])|[|])+/)?.[0] ?? "";
    const tail = e.en.match(/(?:(?:\^[0-9])|[/%]|(?:\\..))+$/)?.[0] ?? "";
    const cur = $("fr-input").value.replace(/^(?:(?:\\..)|(?:\^[0-9])|[|])+/, "").replace(/(?:(?:\^[0-9])|[/%]|(?:\\..))+$/, "");
    const before = editorState();
    $("fr-input").value = head + cur + tail;
    onEdit({ state: before, inputType: "insertReplacementText" });
  };

  window.addEventListener("keydown", (ev) => {
    if (document.querySelector("dialog[open]")) return;
    if (!$("code-modal").classList.contains("hidden") || !$("import-modal").classList.contains("hidden")) return;
    const shortcut = ev.ctrlKey || ev.metaKey;
    if (
      shortcut &&
      ev.key.toLowerCase() === "f" &&
      !$("layout").classList.contains("hidden") &&
      $("import-modal").classList.contains("hidden")
    ) {
      ev.preventDefault();
      openDialogueSearch();
    } else if (
      ev.key === "Escape" &&
      !$("dialogue-search-bar").classList.contains("hidden")
    ) {
      ev.preventDefault();
      closeDialogueSearch();
    } else if (ev.ctrlKey && ev.key === "Enter") {
      if (!ev.defaultPrevented) {
        ev.preventDefault();
        void saveAndGotoNext();
      }
    } else if (ev.ctrlKey && (ev.key === "d" || ev.key === "D")) {
      ev.preventDefault();
      toggleValidated();
    } else if (ev.ctrlKey && ev.key === "ArrowDown") {
      ev.preventDefault();
      gotoTodo(1);
    } else if (ev.ctrlKey && ev.key === "ArrowUp") {
      ev.preventDefault();
      gotoTodo(-1);
    }
  });

  window.api.onSaveRequested(() => {
    if (!$("code-modal").classList.contains("hidden") && codeState.dirty) {
      void saveCodeOverride();
    } else {
      void save();
    }
  });
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// ---------------------------------------------------------------------------
// Import d'un data.win
// ---------------------------------------------------------------------------
let importing = false;
let installingUtmt = false;
let utmtReady = false;
let importModalBound = false;
let runedeltaBusy = false;
let selectedChapter = null;
let setupDone = false;
let setupFontDonor = null;
let discoveryGeneration = 0;
let pickingChapter = false;
let setupReturnFocus = null;


function renderRunedeltaStatus(status = {}, sync = null) {
  const label = $("runedelta-status");
  const topButton = $("btn-runedelta");
  const publishButton = $("btn-publish");
  const modalPublishButton = $("btn-publish-runedelta");
  const modeEnabled = appConfig.runedelta?.modeEnabled === true;
  const publishEnabled = modeEnabled && appConfig.runedelta?.publishEnabled === true;
  const enabled = modeEnabled && Boolean(status.enabled ?? appConfig.runedelta?.enabled);
  const remote = String(status.remoteUrl ?? appConfig.runedelta?.remoteUrl ?? "").trim();
  const githubLinked = enabled && /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)[^/\s]+\/[^/\s]+\/?$/i.test(remote);
  const warning = sync?.error || sync?.pushError || status.error || status.dirtyFiles?.length;
  topButton.classList.toggle("hidden", !modeEnabled);
  $("chk-runedelta-mode").checked = modeEnabled;
  $("chk-runedelta-mode").disabled = runedeltaBusy;
  $("chk-runedelta-publish").checked = publishEnabled;
  $("chk-runedelta-publish").disabled = !modeEnabled || runedeltaBusy;
  topButton.classList.toggle("sync-ready", enabled && !warning);
  topButton.classList.toggle("sync-warning", Boolean(warning));
  for (const button of [publishButton, modalPublishButton]) {
    button.classList.toggle("hidden", !githubLinked || !publishEnabled);
    button.classList.toggle("action-loading", runedeltaBusy);
    button.setAttribute("aria-busy", String(runedeltaBusy));
    button.disabled = !githubLinked || !publishEnabled || runedeltaBusy;
    button.textContent = runedeltaBusy ? "Publication…" : "↑ Publier";
  }

  if (!modeEnabled) {
    label.className = "setup-status";
    label.textContent = "Mode local — Runedelta est désactivé.";
  } else if (!status.available) {
    label.className = "setup-status missing";
    label.textContent = "Git est introuvable. Installe Git pour connecter Runedelta.";
  } else if (warning) {
    label.className = "setup-status missing";
    label.textContent = `⚠ ${sync?.error || sync?.pushError || status.error || `Modifications Git non commitées : ${status.dirtyFiles.join(", ")}`}`;
  } else if (enabled) {
    const pending = Number(status.ahead ?? sync?.ahead ?? 0);
    const unpublished = Number(status.unpublishedChanges ?? 0);
    const behind = Number(status.behind ?? sync?.behind ?? 0);
    let publicationState = " — publié";
    if (unpublished > 0) {
      publicationState = ` — ${unpublished} traduction${unpublished > 1 ? "s" : ""} à publier`;
    } else if (pending > 0) {
      publicationState = ` — ${pending} commit${pending > 1 ? "s" : ""} à publier`;
    } else if (behind > 0) {
      publicationState = ` — ${behind} commit${behind > 1 ? "s" : ""} distant${behind > 1 ? "s" : ""} à récupérer`;
    }
    if (!publishEnabled) publicationState = " — sauvegardes locales, publication GitHub désactivée";
    if (!runedeltaBusy) {
      const needsPublication = unpublished > 0 || pending > 0 || behind > 0;
      publishButton.textContent = needsPublication ? "↑ Publier" : "✓ Publié";
      publishButton.dataset.tooltip = needsPublication
        ? "Publier les traductions sauvegardées sur GitHub"
        : "Tout est publié — cliquer pour vérifier les changements distants";
    }
    label.className = "setup-status ready";
    label.textContent =
      `✓ Runedelta connecté — chapitre ${status.chapter ?? sync?.chapter ?? "?"}, branche ${status.branch ?? sync?.branch ?? "?"}` +
      publicationState;
  } else if (status.configured && status.connected) {
    label.className = "setup-status";
    label.textContent = `Dépôt connecté — le chapitre ${status.chapter ?? "courant"} doit encore être installé.`;
  } else if (status.connected) {
    label.className = "setup-status";
    label.textContent = "Dépôt Runedelta présent localement, mais déconnecté de ce chapitre.";
  } else {
    label.className = "setup-status";
    label.textContent = `Git détecté (${status.version}). Runedelta n’est pas encore connecté.`;
  }

  const remoteInput = $("runedelta-remote");
  remoteInput.value = status.remoteUrl ?? appConfig.runedelta?.remoteUrl ?? remoteInput.value;
  remoteInput.disabled = enabled || runedeltaBusy;
  const connectButton = $("btn-connect-runedelta");
  connectButton.classList.toggle("hidden", enabled);
  connectButton.disabled = !modeEnabled || !status.available || !appConfig.dataWinPath || runedeltaBusy || (appConfig.targetLanguage ?? "fr") !== "fr";
  $("btn-open-runedelta").disabled = !modeEnabled || !status.connected || runedeltaBusy;
  $("btn-disconnect-runedelta").disabled = !modeEnabled || !(status.configured || enabled) || runedeltaBusy;
}

async function refreshRunedeltaStatus(sync = null, startupSync = null) {
  if (appConfig.runedelta?.modeEnabled !== true) {
    renderRunedeltaStatus();
    return { enabled: false };
  }
  try {
    const status = await window.api.getRunedeltaStatus();
    renderRunedeltaStatus(status, sync ?? startupSync);
    return status;
  } catch (error) {
    renderRunedeltaStatus(
      { available: true, enabled: appConfig.runedelta?.enabled },
      { error: error.message ?? String(error) }
    );
    return null;
  }
}

async function connectRunedelta() {
  if (appConfig.runedelta?.modeEnabled !== true) return;
  if (runedeltaBusy || savePromise || importing || codeApplyRunning) return;
  if (dirty && !(await save())) return;
  if (dirty) return;
  if (!appConfig.dataWinPath) {
    alert("Importe d’abord le data.win du chapitre à traduire.");
    return;
  }
  if (
    !confirm(
      "Le catalogue Runedelta du chapitre va être installé sous lang/lang_fr.json. " +
        "Le fichier existant sera sauvegardé avant remplacement. Continuer ?"
    )
  ) {
    return;
  }

  runedeltaBusy = true;
  renderRunedeltaStatus({ available: true, enabled: false });
  const button = $("btn-connect-runedelta");
  button.disabled = true;
  button.textContent = "⏳ Clone et installation…";
  $("fr-input").readOnly = true;
  const result = await window.api.connectRunedelta($("runedelta-remote").value).catch(error => ({ ok: false, error: error.message }));
  $("fr-input").readOnly = false;
  runedeltaBusy = false;
  button.disabled = false;
  button.textContent = "Connecter et installer";
  if (!result.ok) {
    renderRunedeltaStatus({ available: true, enabled: false }, result);
    alert(`Connexion à Runedelta impossible.\n\n${result.error}`);
    return;
  }
  appConfig = result.config;
  location.reload();
}

async function publishRunedeltaNow() {
  if (runedeltaBusy || appConfig.runedelta?.modeEnabled !== true || appConfig.runedelta?.publishEnabled !== true) return;
  runedeltaBusy = true;
  renderRunedeltaStatus({ available: true, enabled: true });
  if (dirty && !(await save({ allowPublish: true }))) {
    runedeltaBusy = false;
    await refreshRunedeltaStatus();
    return;
  }
  let result;
  const snapshot = { ...lang };
  const resolutions = {};
  try {
    result = await window.api.syncRunedelta(snapshot, null, languageRevision);
    while (!result.ok && result.conflict) {
      const resolution = await resolveConflicts(result);
      if (!resolution) { await refreshRunedeltaStatus(result); return; }
      resolutions[result.phase] = resolution;
      result = await window.api.syncRunedelta(snapshot, resolutions, languageRevision);
    }
  } catch (error) {
    result = { ok: false, error: error.message ?? String(error) };
  } finally {
    runedeltaBusy = false;
  }
  if (!result.ok) {
    await refreshRunedeltaStatus(result);
    alert(`Publication Runedelta impossible.\n\n${result.error}`);
    return;
  }
  await refreshRunedeltaStatus(result);
  if (result.pushError) {
    alert(
      "Les fichiers sont sauvegardés et commités localement, mais GitHub a refusé la publication. " +
        `Le prochain clic sur Publier reprendra ce commit.\n\n${result.pushError}`
    );
  } else {
    const state = $("save-state");
    state.className = "saved";
    state.textContent = `✔ Sauvegardé et publié à ${new Date().toLocaleTimeString()}`;
  }
  lang = mergeSavedEdits(lang, snapshot, result.language);
  languageRevision = result.revision;
  const active = selectedKey;
  buildIndex(); buildSequences();
  savedTranslations = new Map(entries.map(entry => [entry.key, result.language[entry.key] ?? reference[entry.key]?.en]));
  unsavedKeys.clear();
  for (const entry of entries) if (entry.fr !== savedTranslations.get(entry.key)) unsavedKeys.add(entry.key);
  setDirty(unsavedKeys.size > 0);
  applyFilter();
  if (active) selectKey(active);
}

function appendImportLog(line) {
  const log = $("import-log");
  $("setup-log-details").classList.remove("hidden");
  log.textContent += `${line}\n`;
  log.scrollTop = log.scrollHeight;
}

function updateCurrentChapter() {
  const available = Boolean(appConfig.dataWinPath || appConfig.langFrPath || appConfig.extractedDir);
  $("current-chapter").classList.toggle("hidden", !available);
  $("cur-datawin").textContent = appConfig.dataWinPath ?? "—";
  $("cur-langfr").textContent = appConfig.langFrPath ?? "—";
  $("cur-extracted").textContent = appConfig.extractedDir ?? "—";
}

async function refreshUtmtStatus(status = null) {
  const value = status ?? (await window.api.getUtmtStatus());
  utmtReady = Boolean(value?.ready);
  const label = $("utmt-status");
  label.className = `setup-status ${utmtReady ? "ready" : "missing"}`;
  label.textContent = utmtReady
    ? `✓ UTMT CLI détecté : ${value.cliPath}`
    : "Installation automatique lors de la préparation du chapitre.";
  $("setup-download-note").textContent = utmtReady
    ? "L’outil de lecture du jeu est déjà installé. Aucun téléchargement n’est nécessaire."
    : "L’outil de lecture du jeu (UTMT) sera téléchargé automatiquement. Une connexion Internet est requise pour cette première préparation.";
  return value;
}

function showSetupError(message) {
  const error = $("setup-error");
  error.textContent = message;
  error.classList.remove("hidden");
}

function setSetupStep(step) {
  const order = ["choose", "prepare", "done"];
  document.querySelectorAll("[data-setup-step]").forEach((item) => {
    const active = item.dataset.setupStep === step;
    if (active) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
    item.classList.toggle("complete", order.indexOf(item.dataset.setupStep) < order.indexOf(step));
  });
}

function updateSetupControls() {
  const busy = importing || installingUtmt || pickingChapter;
  for (const id of ["btn-pick-datawin", "btn-pick-game-folder", "btn-pick-utmt", "btn-install-utmt", "btn-close-import", "setup-language", "setup-language-custom", "btn-font-donor", "btn-clear-font-donor"]) {
    $(id).disabled = busy;
  }
  $("btn-prepare-chapter").disabled = busy || !selectedChapter;
  $("datawin-dropzone").classList.toggle("disabled", busy);
  $("datawin-dropzone").setAttribute("aria-disabled", String(busy));
  document.querySelectorAll(".chapter-option").forEach((button) => { button.disabled = busy; });
}

async function selectChapter(file, label = null) {
  if (importing || installingUtmt || pickingChapter || setupDone) return;
  pickingChapter = true;
  discoveryGeneration++;
  updateSetupControls();
  try {
    const validation = await window.api.validateDataWin(file);
    if (!validation.ok) throw new Error(validation.error);
    selectedChapter = { path: file, label: label ?? `Chapitre ${file.match(/chapter[ _-]?(\d+)/i)?.[1] ?? "DELTARUNE"}` };
    $("setup-selected-label").textContent = selectedChapter.label;
    $("setup-selected-path").textContent = file;
    $("setup-selected").classList.remove("hidden");
    $("chapter-discovery-status").textContent = "Chapitre sélectionné. Tu peux lancer sa préparation.";
    $("setup-error").classList.add("hidden");
    $("btn-prepare-chapter").textContent = "Préparer ce chapitre";
    document.querySelectorAll(".chapter-option").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.path === file));
    });
  } catch (error) {
    showSetupError(error.message);
  } finally {
    pickingChapter = false;
    updateSetupControls();
  }
}

function renderChapters(chapters) {
  const container = $("detected-chapters");
  container.replaceChildren();
  $("chapter-discovery-status").textContent = chapters.length
    ? `${chapters.length} chapitre${chapters.length > 1 ? "s" : ""} trouvé${chapters.length > 1 ? "s" : ""}. Choisis celui que tu veux traduire.`
    : "Aucun chapitre trouvé ici. Choisis le dossier de ton jeu ou son fichier data.win.";
  for (const chapter of chapters) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chapter-option";
    button.dataset.path = chapter.path;
    button.setAttribute("aria-pressed", String(selectedChapter?.path === chapter.path));
    const label = document.createElement("strong");
    label.textContent = chapter.label;
    const detail = document.createElement("small");
    detail.textContent = chapter.path;
    button.append(label, detail);
    button.onclick = () => selectChapter(chapter.path, chapter.label);
    container.append(button);
  }
  updateSetupControls();
}

async function discoverSetupChapters() {
  const generation = ++discoveryGeneration;
  try {
    const chapters = await window.api.discoverChapters();
    if (generation === discoveryGeneration) renderChapters(chapters);
  } catch {
    if (generation === discoveryGeneration) renderChapters([]);
  }
}

function closeImportModal() {
  if (importing || installingUtmt || pickingChapter || $("import-modal").dataset.required === "true") return;
  if (setupDone) { location.reload(); return; }
  discoveryGeneration++;
  $("import-modal").classList.add("hidden");
  setupReturnFocus?.focus();
}

function openImportModal(required = false, runedelta = false) {
  if (importing || installingUtmt) return;
  setupReturnFocus = document.activeElement;
  updateCurrentChapter();
  required = required || !appReady;
  runedelta = runedelta && !required && appConfig.runedelta?.modeEnabled === true;
  $("import-modal").dataset.required = required ? "true" : "false";
  $("import-title").textContent = runedelta ? "Projet Runedelta" : required ? "Bienvenue !" : "Choisir un chapitre";
  $("chapter-setup").classList.toggle("hidden", runedelta);
  $("runedelta-section").classList.toggle("hidden", !runedelta);
  $("setup-primary-actions").classList.toggle("hidden", runedelta);
  $("current-chapter").classList.toggle("hidden", required || !appConfig.dataWinPath);
  $("btn-close-import").classList.toggle("hidden", required);
  $("import-modal").classList.remove("hidden");
  $("import-title").focus();
  if (runedelta) refreshRunedeltaStatus();
  else {
    refreshUtmtStatus().catch((error) => showSetupError(error.message));
    discoverSetupChapters();
  }
}

function bindImportModal() {
  if (importModalBound) return;
  importModalBound = true;
  const saveRunedeltaOptions = async () => {
    if (runedeltaBusy) return;
    const options = {
      modeEnabled: $("chk-runedelta-mode").checked,
      publishEnabled: $("chk-runedelta-publish").checked,
    };
    runedeltaBusy = true;
    renderRunedeltaStatus();
    try {
      appConfig = await window.api.setRunedeltaOptions(options);
      runedeltaAttributions = {};
      if (appReady && appConfig.runedelta?.modeEnabled === true && appConfig.runedelta?.enabled) {
        const result = await window.api.getRunedeltaAttributions();
        if (result.ok) runedeltaAttributions = result.attributions;
      }
      if (appReady) {
        renderListRaf();
        if (selectedKey) renderKeyAttribution(entriesByKey.get(selectedKey));
      }
    } catch (error) {
      alert(`Modification des options Runedelta impossible.\n\n${error.message}`);
    } finally {
      runedeltaBusy = false;
      await refreshRunedeltaStatus();
    }
  };
  $("chk-runedelta-mode").onchange = saveRunedeltaOptions;
  $("chk-runedelta-publish").onchange = saveRunedeltaOptions;
  $("btn-import").onclick = () => openImportModal(false);
  $("btn-runedelta").onclick = () => {
    openImportModal(false, true);
  };
  $("btn-connect-runedelta").onclick = connectRunedelta;
  $("btn-publish").onclick = publishRunedeltaNow;
  $("btn-publish-runedelta").onclick = publishRunedeltaNow;
  $("btn-open-runedelta").onclick = () => window.api.openRunedelta();
  $("btn-disconnect-runedelta").onclick = async () => {
    if (runedeltaBusy) return;
    if (
      !confirm(
        "Déconnecter Runedelta ? Le dépôt local et lang_fr.json seront conservés, mais les traductions ne pourront plus être publiées depuis l’application."
      )
    ) {
      return;
    }
    appConfig = await window.api.disconnectRunedelta();
    await refreshRunedeltaStatus();
  };
  $("btn-close-import").onclick = closeImportModal;
  $("btn-prepare-chapter").onclick = startImport;
  $("btn-cancel-import").onclick = async () => {
    $("btn-cancel-import").disabled = true;
    await window.api.cancelImport();
  };
  $("btn-open-editor").onclick = () => location.reload();
  const pickFile = async () => {
    if (importing || installingUtmt || pickingChapter) return;
    pickingChapter = true;
    updateSetupControls();
    let file;
    try {
      file = await window.api.pickDataWin();
    } catch (error) { showSetupError(error.message); }
    finally { pickingChapter = false; updateSetupControls(); }
    if (file) await selectChapter(file);
  };
  $("btn-pick-datawin").onclick = pickFile;
  $("datawin-dropzone").onclick = pickFile;
  $("btn-pick-game-folder").onclick = async () => {
    if (importing || installingUtmt || pickingChapter) return;
    const generation = ++discoveryGeneration;
    pickingChapter = true;
    updateSetupControls();
    try {
      const chapters = await window.api.pickGameFolder();
      if (chapters && generation === discoveryGeneration) {
        selectedChapter = null;
        $("setup-selected").classList.add("hidden");
        $("setup-error").classList.add("hidden");
        renderChapters(chapters);
      }
    } catch (error) { showSetupError(error.message); }
    finally { pickingChapter = false; updateSetupControls(); }
  };
  $("datawin-dropzone").onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pickFile();
    }
  };

  $("btn-pick-utmt").onclick = async () => {
    if (importing || installingUtmt) return;
    try {
      const result = await window.api.pickUtmtFolder();
      if (!result) return;
      if (!result.ok) throw new Error(result.error);
      $("setup-error").classList.add("hidden");
      await refreshUtmtStatus(result);
    } catch (error) { showSetupError(error.message); }
  };
  $("btn-install-utmt").onclick = async () => {
    if (installingUtmt || importing) return;
    installingUtmt = true;
    updateSetupControls();
    $("utmt-progress").classList.remove("hidden");
    $("utmt-progress-label").textContent = "Préparation…";
    $("setup-error").classList.add("hidden");
    try {
      const result = await window.api.installUtmt();
      if (!result.ok) throw new Error(result.error);
      await refreshUtmtStatus();
    } catch (error) { showSetupError(error.message); }
    finally {
      installingUtmt = false;
      $("utmt-progress").classList.add("hidden");
      updateSetupControls();
    }
  };

  window.api.onImportProgress((line) => {
    if (line === "IMPORT_INSTALLING") {
      $("btn-cancel-import").disabled = true;
      $("setup-progress-title").textContent = "Installation et sauvegardes de sécurité…";
      return;
    }
    appendImportLog(line);
    if (!importing) return;
    if (line.includes("Étape 1/3")) $("setup-progress-title").textContent = "Extraction des textes et des images…";
    if (line.includes("Étape 2/3")) $("setup-progress-title").textContent = "Préparation des dialogues et des portraits…";
    if (line.includes("décors et placements")) $("setup-progress-title").textContent = "Préparation des décors de l’aperçu…";
    if (line.includes("Étape 3/3")) $("setup-progress-title").textContent = "Dernière étape : préparation de l’éditeur…";
  });
  window.api.onUtmtProgress((progress) => {
    $("utmt-progress").classList.remove("hidden");
    if (Number.isFinite(progress.percent)) {
      $("utmt-progress-fill").style.width = `${progress.percent}%`;
    }
    $("utmt-progress-label").textContent =
      progress.message ??
      (progress.phase === "download" ? `Téléchargement… ${progress.percent ?? 0} %` : "Installation…");
  });
  window.api.onSaveProgress((line) => {
    const state = $("save-state");
    state.className = "dirty";
    state.textContent = `⏳ ${line}`;
  });

  const dropzone = $("datawin-dropzone");
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());
  dropzone.addEventListener("dragenter", () => dropzone.classList.add("dragging"));
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", (event) => {
    dropzone.classList.remove("dragging");
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const filePath = window.api.getPathForFile(file);
    selectChapter(filePath);
  });
  $("import-modal").addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeImportModal(); }
    if (event.key !== "Tab") return;
    const controls = [...$("import-modal").querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')]
      .filter((element) => element.getClientRects().length && element.getAttribute("aria-disabled") !== "true");
    const index = controls.indexOf(document.activeElement);
    if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === controls.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  });
}

async function startImport() {
  if (importing || installingUtmt || pickingChapter || !selectedChapter || setupDone) return;
  if (savePromise || codeApplyRunning || runedeltaBusy || updateInstallRunning) {
    showSetupError("Attends la fin de l’opération en cours avant de changer de chapitre.");
    return;
  }
  if (dirty && !confirm("Des modifications non sauvegardées seront perdues. Continuer ?"))
    return;
  if (codeState.dirty && !confirm("Changer de chapitre sans enregistrer les modifications GML ?")) return;
  const language = $("setup-language").value === "custom"
    ? $("setup-language-custom").value.trim().toLowerCase().replaceAll("-", "_")
    : $("setup-language").value;
  if (!/^[a-z]{2,3}(?:_[a-z0-9]{2,8}){0,2}$/.test(language) || ["en", "ja"].includes(language)) {
    showSetupError("Indique le code d’une nouvelle langue : fr, es, de, pt-BR…");
    return;
  }
  importing = true;
  discoveryGeneration++;
  updateSetupControls();
  setSetupStep("prepare");
  $("setup-error").classList.add("hidden");
  $("setup-selection").classList.add("hidden");
  $("setup-advanced").classList.add("hidden");
  $("setup-progress").classList.remove("hidden");
  $("setup-log-details").classList.add("hidden");
  $("setup-log-details").open = false;
  $("import-log").textContent = "";
  $("btn-prepare-chapter").textContent = "Préparation en cours…";
  $("setup-progress-title").textContent = "Vérification du chapitre…";
  $("setup-progress-description").textContent = "Cette première préparation peut prendre plusieurs minutes. Garde cette fenêtre ouverte.";
  const startedAt = Date.now();
  $("setup-elapsed").textContent = "";
  const elapsedTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    $("setup-elapsed").textContent = `Temps écoulé : ${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s · La préparation continue…`;
  }, 1000);
  try {
    const result = await prepareChapter(window.api, selectedChapter.path, (stage) => {
      if (stage === "tools") $("setup-progress-title").textContent = "Préparation de l’outil de lecture…";
      if (stage === "import") {
        $("btn-cancel-import").classList.remove("hidden");
        $("btn-cancel-import").disabled = false;
        $("utmt-progress").classList.add("hidden");
        $("setup-progress-title").textContent = "Lecture de ton chapitre…";
      }
    }, { language, fontDonor: setupFontDonor, force: $("setup-force").checked, newOriginal: $("setup-new-original").checked });
    appConfig = result.config;
    setupDone = true;
    unsavedKeys.clear();
    dirty = false;
    codeState.dirty = false;
    setSetupStep("done");
    $("setup-success").classList.remove("hidden");
    $("setup-download-note").classList.add("hidden");
    $("setup-save-target").textContent = appConfig.storageMode === "datawin"
      ? "À chaque sauvegarde, les traductions seront appliquées au data.win sélectionné. Une copie originale est conservée."
      : `Tes traductions seront enregistrées dans : ${appConfig.langFrPath}`;
    if (appConfig.fontWarnings?.length) {
      $("setup-save-target").textContent += ` Polices conservées faute de donneur compatible : ${appConfig.fontWarnings.join(" ; ")}. Le contrôle qualité signale les glyphes manquants.`;
    }
    $("btn-prepare-chapter").classList.add("hidden");
    $("btn-open-editor").classList.remove("hidden");
    $("btn-close-import").classList.add("hidden");
    $("btn-open-editor").focus();
  } catch (error) {
    setSetupStep("choose");
    showSetupError(`La préparation n’a pas abouti. Tu peux réessayer ou choisir un autre chapitre.\n\n${error.message}`);
    appendImportLog(`✖ ${error.message}`);
    $("setup-selection").classList.remove("hidden");
    $("setup-advanced").classList.remove("hidden");
    $("btn-prepare-chapter").textContent = "Réessayer la préparation";
  } finally {
    clearInterval(elapsedTimer);
    $("btn-cancel-import").classList.add("hidden");
    importing = false;
    $("setup-progress").classList.add("hidden");
    $("utmt-progress").classList.add("hidden");
    updateSetupControls();
  }
}

setupTooltips();
$("setup-language").addEventListener("change", () => {
  const custom = $("setup-language").value === "custom";
  $("setup-language-custom").classList.toggle("hidden", !custom);
  $("setup-language-custom-label").classList.toggle("hidden", !custom);
});
$("btn-font-donor").addEventListener("click", async () => {
  if (importing || installingUtmt || pickingChapter) return;
  pickingChapter = true;
  updateSetupControls();
  try {
    const donor = await window.api.pickDataWin();
    if (donor) {
      setupFontDonor = donor;
      $("setup-font-donor").textContent = `Polices du mod : ${donor}`;
      $("btn-clear-font-donor").classList.remove("hidden");
    }
  } catch (error) { showSetupError(error.message); }
  finally { pickingChapter = false; updateSetupControls(); }
});
$("btn-clear-font-donor").addEventListener("click", () => {
  setupFontDonor = null;
  $("setup-font-donor").textContent = "Les polices du chapitre seront utilisées. Les caractères absents nécessitent un mod donneur adapté.";
  $("btn-clear-font-donor").classList.add("hidden");
});
setupUpdates().catch((error) => console.error("Initialisation des mises à jour impossible :", error));
window.api.onCloseRequested(handleCloseRequest);
init().catch(error => {
  openImportModal(true);
  showSetupError(`Impossible de charger le projet : ${error.message}`);
});
