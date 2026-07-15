import { loadFonts } from "./engine/bitmapfont.js";
import { Preview } from "./engine/preview.js";
import { C_TAG, FC_NAMES, F_TAG, encodeFe } from "./engine/typers.js";
import { substituteArgs } from "./engine/writer.js";

// ---------------------------------------------------------------------------
// État global
// ---------------------------------------------------------------------------
let lang = {}; // objet complet du lang_fr.json (ordre des clés préservé)
let reference = {}; // id -> {en, call, channel, file, line, face, substitutions, smallFace}
let prefs = {}; // { modeOverrides, bubbleSides, validated, faceOverrides, theme }
let entries = []; // index pour la liste
let entriesByKey = new Map();
let filtered = [];
let selectedKey = null;
let dirty = false;
let savedTranslations = new Map();
const unsavedKeys = new Set();
let savePromise = null;
let closePromptOpen = false;
let preview = null;
let sequences = new Map(); // key -> [keys de la même séquence]
const editHistories = new Map(); // historique indépendant pour chaque clé
let pendingEdit = null;
let applyingHistory = false;
let backupPromise = null;

const $ = (id) => document.getElementById(id);

const ROW_H = 65;
const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const BACKUP_CHECK_MS = 60 * 1000;

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
// Initialisation
// ---------------------------------------------------------------------------
let appConfig = {};
let appReady = false;

async function init() {
  bindImportModal();
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
  applyTheme(prefs.theme === "classic" ? "classic" : "deltarune");
  $("btn-theme").onclick = toggleTheme;

  if (!data.ready) {
    openImportModal(true);
    return;
  }

  appReady = true;
  lang = data.lang;
  reference = data.reference;

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
    urlKey && lang[urlKey] != null ? urlKey : firstTodo ? firstTodo.key : entries[0]?.key
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
  for (const key of Object.keys(lang)) {
    if (key === "date") continue;
    const ref = reference[key];
    const fr = lang[key];
    const en = ref ? ref.en : null;
    const e = {
      key,
      fr,
      en,
      channel: ref ? ref.channel : null,
      file: ref ? ref.file : null,
      line: ref ? ref.line : 0,
      noref: !ref,
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
  $("list-spacer").style.height = filtered.length * ROW_H + "px";
  $("list-status").textContent = `${filtered.length} lignes affichées`;
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
    div.innerHTML =
      `<div class="li-key"><span class="li-dot ${dot}"></span>${escapeHtml(shortKey(e.key))}</div>` +
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
  const hasFace = /\\F[^0]/.test(text) || inheritedState().fc !== 0;
  let charline = 33;
  if (mode === "battletext") charline = hasFace ? 29 : 37;
  else if (mode === "darkbox" || mode === "lightbox" || mode === "shop")
    charline = hasFace ? 26 : 33;
  else charline = 999;

  const lines = visualLines(text);
  const parts = lines.map((len) => {
    const cls = len > charline ? "over" : "";
    return `<span class="${cls}">${len}</span>`;
  });
  $("line-lens").innerHTML =
    parts.join(" · ") + (charline < 999 ? ` <span style="opacity:.5">/ ${charline}</span>` : "");
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

function autoMode(e) {
  if (!e || e.noref) return "darkbox";
  if (reference[e.key]?.smallFace?.dialogueKey) return "darkbox";
  const detectedMode = reference[e.key]?.previewMode;
  if (detectedMode) return detectedMode;
  const f = (e.file || "").toLowerCase();
  if (isLargeShopDialogue(e)) return "shop";
  if (/enemy|battle|blcon|_attack|encounter|boss|trashy_trio/.test(f)) {
    // texte à astérisque = boîte de combat en bas ; sinon = bulle de l'ennemi
    const t = (e.en ?? e.fr ?? "").replace(/^(\\..|\^[0-9]|[|&/%])*/, "");
    return t.startsWith("*") ? "battletext" : "bubble";
  }
  if (e.channel === "string") return "plain";
  return "darkbox";
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
  };
  const ref = reference[selectedKey];
  state.typer = ref?.typer ?? null;
  state.miniFaceBank = ref?.miniFaceBank ?? null;
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
  const substitution = substituteArgs(sourceText, reference[selectedKey]?.substitutions);
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
    const dialogueSubstitution = substituteArgs(dialogueSource, dialogueRef?.substitutions);
    state.fc = dialogueRef?.face?.fc ?? 0;
    state.fe = dialogueRef?.face?.fe ?? 0;
    state.faceVariant = dialogueRef?.face?.variant ?? null;
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
  const substitutionWarnings = substitution.unresolved.map(
    (id) => `~${id} : valeur dynamique inconnue hors du jeu`
  );
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
    { tag: "&", label: "nouvelle ligne", kind: "flow" },
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

function backupIfModified() {
  if (!dirty || backupPromise) return;
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
      toggleValidated();
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
    if (dirty && !confirm("Des modifications non sauvegardées seront perdues. Recharger ?"))
      return;
    location.reload();
  };

  $("sel-mode").addEventListener("change", () => {
    const v = $("sel-mode").value;
    if (v === "auto") delete prefs.modeOverrides[selectedKey];
    else prefs.modeOverrides[selectedKey] = v;
    window.api.savePrefs(prefs);
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
    if (ev.ctrlKey && ev.key === "Enter") {
      if (!ev.defaultPrevented) {
        ev.preventDefault();
        toggleValidated();
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

  window.api.onSaveRequested(() => save());
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
window.api.onCloseRequested(handleCloseRequest);
init();
