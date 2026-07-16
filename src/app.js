import { loadFonts } from "./engine/bitmapfont.js";
import { Preview } from "./engine/preview.js";
import { C_TAG, FC_NAMES, F_TAG, encodeFe } from "./engine/typers.js";
import { substituteArgs } from "./engine/writer.js";
import { SpriteEditor } from "./sprites.js";

// ---------------------------------------------------------------------------
// État global
// ---------------------------------------------------------------------------
let lang = {}; // objet complet du lang_fr.json (ordre des clés préservé)
let reference = {}; // id -> {en, call, channel, file, line, face, substitutions, smallFace, speakerOverlay}
let prefs = {}; // { modeOverrides, bubbleSides, validated, faceOverrides, theme, backupsEnabled, listSort }
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
  bubble: "Bulle de combat",
  battletext: "Texte de combat",
  shop: "Dialogue de boutique",
  device: "Appareil",
  plain: "Menu / texte libre",
};
const SMALL_FACE_SPEAKER_NAMES = {
  susie: "Susie",
  ralsei: "Ralsei",
  noelle: "Noelle",
  lancer: "Lancer",
  queen: "Queen",
  rouxls: "Rouxls",
  flowery: "Flowery",
};

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
  const visible = status?.phase === "downloading" || status?.phase === "downloaded";
  button.classList.toggle("hidden", !visible);
  if (!visible) return;

  if (status.phase === "downloading") {
    button.disabled = true;
    button.textContent = `↓ Mise à jour ${status.percent ?? 0} %`;
    button.dataset.tooltip = `Téléchargement de DELTATRANSLATE ${status.version ?? ""}`.trim();
  } else {
    button.disabled = false;
    button.textContent = `↻ Installer ${status.version}`;
    button.dataset.tooltip = "Sauvegarder le travail, installer la mise à jour et redémarrer";
  }
}

async function installDownloadedUpdate() {
  if (updateInstallRunning) return;
  updateInstallRunning = true;
  try {
    if (codeState.dirty && !(await saveCodeOverride())) return;
    if (dirty && !(await save())) return;
    const result = await window.api.installUpdate();
    if (!result.ok) alert(`Impossible d’installer la mise à jour.\n\n${result.error}`);
  } finally {
    updateInstallRunning = false;
  }
}

async function setupUpdates() {
  $("btn-update").addEventListener("click", installDownloadedUpdate);
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
  utmtReady = Boolean(data.utmt?.ready);
  prefs = Object.assign(
    {
      modeOverrides: {},
      bubbleSides: {},
      validated: {},
      faceOverrides: {},
      sceneOverrides: {},
    },
    data.prefs
  );
  if (!prefs.validated) prefs.validated = {};
  if (!prefs.faceOverrides) prefs.faceOverrides = {};
  if (!prefs.sceneOverrides) prefs.sceneOverrides = {};
  prefs.listSort = LIST_SORTS.has(prefs.listSort) ? prefs.listSort : "source";
  $("sel-list-sort").value = prefs.listSort;
  const backupsToggle = $("chk-backups");
  backupsToggle.checked = prefs.backupsEnabled !== false;
  backupsToggle.addEventListener("change", () => {
    prefs.backupsEnabled = backupsToggle.checked;
    window.api.savePrefs(prefs);
  });
  applyTheme(prefs.theme === "classic" ? "classic" : "deltarune");
  $("btn-theme").onclick = toggleTheme;

  if (!data.ready) {
    openImportModal(true);
    return;
  }

  appReady = true;
  lang = data.lang;
  reference = data.reference;
  spriteEditor.init(data.spriteCatalog);

  const fonts = await loadFonts(data.extractedDir, parseFontCsvs(data.fonts));
  preview = new Preview(
    $("preview-canvas"),
    data.extractedDir,
    fonts,
    data.spriteFiles,
    data.spriteMeta
  );

  buildIndex();
  savedTranslations = new Map(entries.map((entry) => [entry.key, entry.fr]));
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
  window.api.savePrefs(prefs);
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
  const referencedKeys = new Set(Object.keys(reference));
  const orderedKeys = Object.keys(lang).filter(
    (key) => key !== "date" && referencedKeys.has(key)
  );
  for (const key of referencedKeys) {
    if (!Object.prototype.hasOwnProperty.call(lang, key)) orderedKeys.push(key);
  }
  for (const key of orderedKeys) {
    const ref = reference[key];
    const fr = lang[key] ?? ref.en;
    const en = ref.en;
    const e = {
      key,
      fr,
      en,
      channel: ref.channel,
      file: ref.file,
      line: ref.line,
      noref: false,
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
function speakerName(e) {
  const ref = reference[e.key];
  const fc = prefs.faceOverrides[e.key]?.fc ?? ref?.face?.fc;
  if (fc && FC_NAMES[fc]) return FC_NAMES[fc];
  const smallFaceSpeaker = String(ref?.smallFace?.speaker ?? "").toLowerCase();
  if (SMALL_FACE_SPEAKER_NAMES[smallFaceSpeaker]) {
    return SMALL_FACE_SPEAKER_NAMES[smallFaceSpeaker];
  }
  return "Sans personnage identifié";
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

function applyFilter() {
  const q = $("search").value.trim().toLowerCase();
  const f = document.querySelector(".filter.active").dataset.filter;
  filtered = entries.filter((e) => {
    if (f === "todo" && !e.todo) return false;
    if (f === "noref" && !e.noref) return false;
    if (f === "dialogue" && !(e.channel && e.channel !== "string")) return false;
    if (f === "string" && e.channel !== "string") return false;
    if (q && !e.searchable.includes(q)) return false;
    return true;
  });
  if (prefs.listSort !== "source") filtered.sort(compareEntries);
  $("list-spacer").style.height = filtered.length * ROW_H + "px";
  const sortSuffix =
    prefs.listSort === "speaker"
      ? " · triées par personnage"
      : prefs.listSort === "type"
        ? " · triées par type"
        : "";
  $("list-status").textContent = `${filtered.length} lignes affichées${sortSuffix}`;
  renderList();
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
    div.innerHTML =
      `<div class="li-key"><span class="li-key-main"><span class="li-dot ${dot}"></span>${escapeHtml(shortKey(e.key))}</span>` +
      (sortLabel ? `<span class="li-sort-label">${escapeHtml(sortLabel)}</span>` : "") +
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

// ---------------------------------------------------------------------------
// Sélection et éditeur
// ---------------------------------------------------------------------------
function selectKey(key) {
  if (!key) return;
  selectedKey = key;
  const e = entriesByKey.get(key);
  if (!e) return;
  $("key-name").textContent = shortKey(key);
  $("key-meta").textContent = e.noref
    ? "aucune référence trouvée dans le code du chapitre 5 (clé d'un autre chapitre ?)"
    : `${e.file}:${e.line} · ${e.channel} · ${reference[key].call}`;
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
  window.api.savePrefs(prefs);
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
    .replaceAll(">", "&gt;");
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
  else if (mode === "darkbox" || mode === "lightbox" || mode === "shop" || mode === "device")
    charline = hasFace ? 26 : 33;
  else charline = 999;

  const lines = visualLines(text);
  const parts = lines.map((len) => {
    const cls = len > charline ? "over" : "";
    return `<span class="${cls}">${len}</span>`;
  });
  $("line-lens").innerHTML = parts.join(" · ");
}

// Longueur visible de chaque ligne (règles de comptage d'Other_15)
function visualLines(text) {
  const lens = [];
  let cur = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "`") { cur++; i += 2; continue; }
    if (c === "\\") { i += 3; continue; }
    if (c === "^") { i += 2; continue; }
    if (c === "/" || c === "%") { i += 1; continue; }
    if (c === "&" || c === "\n") { lens.push(cur); cur = 0; i += 1; continue; }
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
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 120);
}

// Les écrans de shop alternent entre deux petites colonnes (menus) et une
// grande boîte plein écran (menu == 4). Les dialogues de cette dernière sont
// les messages étoilés terminés par / ou %, y compris dans les vieux shops où
// ils sont stockés avec stringsetloc avant d'être copiés dans global.msg.
function isLargeShopDialogue(e) {
  const file = (e?.file || "").toLowerCase();
  if (!/gml_object_obj_shop\w*_(?:create|draw|other)_0/.test(file)) return false;
  const source = e.en ?? e.fr ?? "";
  if (!/(?:\/%|[/%])$/.test(source)) return false;
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
  if (reference[e.key]?.smallFace?.dialogueKey) return "darkbox";
  if (isLargeShopDialogue(e)) return "shop";
  // Les wrappers c_msg* créent une textbox de cinématique via obj_dialoguer.
  // Le nom de l'objet peut contenir "encounter" tout en alternant cinématique
  // et combat : le canal est donc plus fiable que le nom du propriétaire.
  if (String(e.channel ?? "").startsWith("cutscene-"))
    return lightWorldAdjust(e, "darkbox");
  const detectedMode = reference[e.key]?.previewMode;
  if (detectedMode) return lightWorldAdjust(e, detectedMode);
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
function inheritedState() {
  const state = {
    fc: 0,
    fe: 0,
    faceVariant: null,
    typer: null,
    miniFaceBank: null,
    speakerOverlay: null,
    deviceStyle: null,
  };
  const ref = reference[selectedKey];
  state.typer = ref?.typer ?? null;
  state.miniFaceBank = ref?.miniFaceBank ?? null;
  state.speakerOverlay = ref?.speakerOverlay ?? null;
  state.deviceStyle = ref?.deviceStyle ?? null;
  if (ref?.face) {
    state.fc = ref.face.fc;
    state.fe = ref.face.fe ?? 0;
    state.faceVariant = ref.face.variant ?? null;
  }
  const seq = sequences.get(selectedKey);
  if (!seq) return state;
  for (const s of seq) {
    if (s.key === selectedKey) break;
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

function selectedSceneContext() {
  if (!roomSceneApplies()) return null;
  const contexts = reference[selectedKey]?.sceneContexts ?? [];
  if (!contexts.length) return null;
  const override = prefs.sceneOverrides[selectedKey];
  return contexts.find((context) => sceneContextKey(context) === override) ?? contexts[0];
}

function roomSceneApplies() {
  return ["darkbox", "lightbox"].includes(effectiveMode());
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

async function runPreview() {
  if (!preview || !selectedKey) return;
  const e = entriesByKey.get(selectedKey);
  const showEn = $("chk-en-preview").checked;
  const sourceText = showEn ? (e.en ?? "") : $("fr-input").value;
  const substitution = substituteArgs(
    sourceText,
    reference[selectedKey]?.substitutions,
    reference[selectedKey]?.substitutionSamples
  );
  const mode = effectiveMode();
  const state = inheritedState();
  state.sceneContext = selectedSceneContext();
  const sourceFile = reference[selectedKey]?.file ?? e.file ?? "";
  if (/obj_shop1(?:_|$)/i.test(sourceFile)) state.scene = "shop-seam";
  if (/obj_trashy_trio(?:_|$)/i.test(sourceFile)) state.scene = "trashy-trio";
  if (/obj_shop_music(?:_|$)/i.test(sourceFile)) {
    state.typer = 78;
    state.shopCharline = 36;
  }
  state.bubbleSide = prefs.bubbleSides[selectedKey] ?? 1;
  const smallFace = reference[selectedKey]?.smallFace;
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
    state.smallFace = {
      ...smallFace,
      text: substitution.text,
      dialogueText: dialogueSubstitution.text,
    };
  }
  // forçage manuel du visage pour la preview
  const fo = prefs.faceOverrides[selectedKey];
  if (fo) {
    state.fc = fo.fc;
    state.fe = fo.fe;
  }

  const res = await preview.render(substitution.text, mode, state);

  const warnEl = $("preview-warnings");
  warnEl.innerHTML = "";
  const substitutionWarnings = [
    ...substitution.sampled.map(
      ({ index, value }) => `~${index} → « ${value} » (exemple — valeur dynamique en jeu)`
    ),
    ...substitution.unresolved.map(
      (id) => `~${id} : valeur dynamique inconnue hors du jeu`
    ),
  ];
  for (const w of [...substitutionWarnings, ...(res.warnings ?? [])]) {
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
  window.api.savePrefs(prefs);
  if (prefs.listSort === "speaker") {
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
  const tools = [
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
  let pointerX = innerWidth / 2;
  let pointerY = innerHeight / 2;
  let open = false;
  let activeIndex = -1;
  let centerX = 0;
  let centerY = 0;
  let savedSelection = null;

  const buttons = tools.map((tool, index) => {
    const button = document.createElement("button");
    const angle = index * (360 / tools.length);
    button.type = "button";
    button.className = `tag-wheel-item ${tool.kind}`;
    button.style.setProperty("--angle", `${angle}deg`);
    button.dataset.index = index;
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-label", `${tool.tag}, ${tool.label}`);
    button.innerHTML = `<span>${tool.tag === "&" ? "&amp;" : tool.tag}</span><small>${tool.kind === "pause" ? "pause" : "flux"}</small>`;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setActive(index);
      commit();
    });
    ring.appendChild(button);
    return button;
  });

  function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    buttons.forEach((button, i) => button.classList.toggle("active", i === index));
    if (index < 0) {
      value.textContent = "ALT";
      label.textContent = "Glisser";
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
    setActive(Math.round(angle / (360 / tools.length)) % tools.length);
  }

  function show() {
    const ta = $("fr-input");
    if (open || document.activeElement !== ta || !selectedKey) return;
    savedSelection = { start: ta.selectionStart, end: ta.selectionEnd };
    const margin = 112;
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
    if (event.key === "Alt" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat) show();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      hide();
    }
  }, true);
  window.addEventListener("keyup", (event) => {
    if (event.key !== "Alt" || !open) return;
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

function setDirty(d) {
  dirty = d;
  const saveButton = $("btn-save");
  saveButton.classList.toggle("dirty", d);
  saveButton.disabled = !d;
  saveButton.textContent = d ? "💾 Sauvegarder" : "✓ Sauvegardé";
  saveButton.dataset.tooltip = d
    ? "Sauvegarder dans le jeu (Ctrl+S)"
    : "Toutes les modifications sont sauvegardées";
  const st = $("save-state");
  st.className = d ? "dirty" : "";
  st.textContent = d
    ? `● ${unsavedKeys.size} traduction${unsavedKeys.size > 1 ? "s" : ""} non sauvegardée${unsavedKeys.size > 1 ? "s" : ""}`
    : "Aucune modification";
  if (!d) updateProgress();
}

function save() {
  if (!dirty) return Promise.resolve(true);
  if (savePromise) return savePromise;

  savePromise = (async () => {
    try {
      const langSnapshot = { ...lang };
      const r = await window.api.saveLang(langSnapshot);
      if (!r.ok) {
        alert(`La sauvegarde a échoué.\n\n${r.error ?? "Erreur inconnue"}`);
        return false;
      }
      savedTranslations = new Map(
        entries.map((entry) => [entry.key, langSnapshot[entry.key]])
      );
      unsavedKeys.clear();
      for (const entry of entries) {
        if (entry.fr !== savedTranslations.get(entry.key)) unsavedKeys.add(entry.key);
      }
      setDirty(unsavedKeys.size > 0);
      if (!dirty) {
        const st = $("save-state");
        st.className = "saved";
        st.textContent =
          `✔ Sauvegardé à ${new Date(r.savedAt).toLocaleTimeString()}` +
          (r.backupCreated ? " (backup créé)" : "");
      }
      updateProgress();
      renderList();
      return true;
    } catch (error) {
      alert(`La sauvegarde a échoué.\n\n${error.message ?? error}`);
      return false;
    } finally {
      savePromise = null;
    }
  })();
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
  if (prefs.backupsEnabled === false || !dirty || backupPromise) return;
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
}, BACKUP_INTERVAL_MS);

async function handleCloseRequest() {
  if (closePromptOpen) return;
  closePromptOpen = true;
  try {
    if (codeState.dirty && !confirm("Quitter sans enregistrer les modifications GML ?")) return;
    const choice = await window.api.confirmClose(unsavedKeys.size);
    if (choice === "cancel") return;
    if (choice === "save" && !(await save())) return;
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

function scrollToSelected() {
  const idx = filtered.findIndex((e) => e.key === selectedKey);
  if (idx < 0) return;
  const container = $("list-container");
  const y = idx * ROW_H;
  if (y < container.scrollTop || y > container.scrollTop + container.clientHeight - ROW_H)
    container.scrollTop = y - container.clientHeight / 2;
  renderList();
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------
function bindEvents() {
  setupTagWheel();
  $("btn-theme").onclick = toggleTheme;
  $("list-container").addEventListener("scroll", renderListRaf, { passive: true });
  $("search").addEventListener("input", debounce(applyFilter, 200));
  $("sel-list-sort").addEventListener("change", () => {
    prefs.listSort = $("sel-list-sort").value;
    window.api.savePrefs(prefs);
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
  $("btn-backups").onclick = () => window.api.openBackups();
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
    window.api.savePrefs(prefs);
    if (prefs.listSort === "type") {
      applyFilter();
      scrollToSelected();
    }
    updateSceneContextControls();
    schedulePreview();
  });
  $("btn-side").onclick = () => {
    prefs.bubbleSides[selectedKey] = (prefs.bubbleSides[selectedKey] ?? 1) * -1;
    window.api.savePrefs(prefs);
    schedulePreview();
  };
  $("chk-en-preview").addEventListener("change", schedulePreview);
  $("btn-validate").onclick = toggleValidated;
  $("sel-preview-face").addEventListener("change", applyFaceOverride);
  $("inp-preview-fe").addEventListener("input", debounce(applyFaceOverride, 150));
  $("sel-scene-context").addEventListener("change", () => {
    prefs.sceneOverrides[selectedKey] = $("sel-scene-context").value;
    window.api.savePrefs(prefs);
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
    if (!$("code-modal").classList.contains("hidden")) return;
    if (ev.ctrlKey && ev.key === "Enter") {
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

function appendImportLog(line) {
  const log = $("import-log");
  log.classList.remove("hidden");
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
    : "UTMT CLI n'est pas encore configuré.";
  $("datawin-dropzone").classList.toggle("disabled", !utmtReady);
  $("btn-pick-datawin").disabled = !utmtReady || importing;
  if (appReady && $("import-modal").dataset.required === "false") {
    $("utmt-setup-section").classList.toggle("hidden", utmtReady);
  }
  return value;
}

function openImportModal(required = false) {
  updateCurrentChapter();
  $("import-modal").dataset.required = required ? "true" : "false";
  $("import-title").textContent = required
    ? "Configurer DELTATRANSLATE"
    : "Importer un autre chapitre";
  $("datawin-step-title").textContent = required
    ? "2. Importer un chapitre"
    : "Choisir le data.win";
  $("current-chapter").classList.toggle("hidden", required || !appConfig.dataWinPath);
  $("utmt-setup-section").classList.toggle("hidden", !required && utmtReady);
  $("btn-close-import").classList.toggle("hidden", required);
  $("import-modal").classList.remove("hidden");
  refreshUtmtStatus();
}

function bindImportModal() {
  if (importModalBound) return;
  importModalBound = true;
  $("btn-import").onclick = () => openImportModal(false);
  $("btn-close-import").onclick = () => {
    if (!importing) $("import-modal").classList.add("hidden");
  };
  $("btn-pick-datawin").onclick = startImport;
  $("datawin-dropzone").onclick = startImport;
  $("datawin-dropzone").onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startImport();
    }
  };

  $("btn-pick-utmt").onclick = async () => {
    const result = await window.api.pickUtmtFolder();
    if (!result) return;
    if (!result.ok) {
      appendImportLog(`✖ ${result.error}`);
      return;
    }
    appendImportLog(`✓ UTMT lié : ${result.cliPath}`);
    await refreshUtmtStatus(result);
  };
  $("btn-install-utmt").onclick = async () => {
    if (installingUtmt) return;
    installingUtmt = true;
    $("btn-install-utmt").disabled = true;
    $("btn-pick-utmt").disabled = true;
    $("utmt-progress").classList.remove("hidden");
    $("utmt-progress-label").textContent = "Préparation…";
    const result = await window.api.installUtmt();
    installingUtmt = false;
    $("btn-install-utmt").disabled = false;
    $("btn-pick-utmt").disabled = false;
    if (!result.ok) {
      appendImportLog(`✖ Installation UTMT : ${result.error}`);
      return;
    }
    appendImportLog(`✓ UTMT CLI ${result.version} installé.`);
    await refreshUtmtStatus();
  };

  window.api.onImportProgress((line) => {
    appendImportLog(line);
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
    if (!/data\.win$/i.test(filePath)) {
      appendImportLog("✖ Le fichier déposé doit être un data.win.");
      return;
    }
    startImport(filePath);
  });
}

async function startImport(selectedPath = null) {
  if (importing || !utmtReady) return;
  const dataWinPath =
    typeof selectedPath === "string" ? selectedPath : await window.api.pickDataWin();
  if (!dataWinPath) return;
  if (dirty && !confirm("Des modifications non sauvegardées seront perdues. Continuer ?"))
    return;
  importing = true;
  const log = $("import-log");
  log.classList.remove("hidden");
  log.textContent = "";
  $("btn-pick-datawin").disabled = true;
  $("btn-pick-datawin").textContent = "⏳ Import en cours…";
  $("datawin-dropzone").classList.add("disabled");
  const r = await window.api.importDataWin(dataWinPath);
  importing = false;
  if (r.ok) {
    log.textContent += "\nRechargement de l'éditeur…\n";
    setTimeout(() => location.reload(), 900);
  } else {
    $("btn-pick-datawin").disabled = false;
    $("btn-pick-datawin").textContent = "📂 Choisir un data.win…";
    $("datawin-dropzone").classList.remove("disabled");
    log.textContent += "\n✖ " + r.error + "\n";
  }
}

setupTooltips();
setupUpdates().catch((error) => console.error("Initialisation des mises à jour impossible :", error));
window.api.onCloseRequested(handleCloseRequest);
init();
