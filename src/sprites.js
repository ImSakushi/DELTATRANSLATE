import { SpritePlacement } from "./sprite-placement.js";
import { frameFromFileName, spriteState } from "./sprite-workflow.mjs";

const SPRITE_ROW_HEIGHT = 62;
const MAX_STRIP_FRAMES = 64;

export class SpriteEditor {
  constructor(getElement) {
    this.$ = getElement;
    this.catalog = [];
    this.byName = new Map();
    this.filtered = [];
    this.selectedName = null;
    this.frame = 0;
    this.filter = null;
    this.loadToken = 0;
    this.stripToken = 0;
    this.bound = false;
    this.applyRunning = false;
    this.translationHint = "";
    this.operationRunning = false;
    this.thumbnails = new Map();
    this.thumbnailQueue = new Set();
    this.prefetched = false;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    this.placement = new SpritePlacement(this.$, () => { this.updateCounts(); this.renderSteps(); });
    this.$("sprite-save-placement").onclick = () => void this.savePlacement();
    this.translationHint = this.$("hint").textContent;

    document.querySelectorAll(".workspace-tab").forEach((button) => {
      button.addEventListener("click", () => this.showView(button.dataset.view));
    });
    this.$("sprite-search").addEventListener("input", () => this.applyFilter());
    this.$("sprite-search").addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") this.onListKeydown(event);
    });
    document.querySelectorAll(".sprite-filter").forEach((button) => {
      button.addEventListener("click", () => this.setFilter(button.dataset.filter));
    });
    this.$("sprite-list").addEventListener("scroll", () => this.renderList(), { passive: true });
    this.$("sprite-list").addEventListener("keydown", (event) => this.onListKeydown(event));
    this.$("sprite-list-items").addEventListener("click", (event) => {
      const item = event.target.closest(".sprite-list-item");
      if (item) void this.select(item.dataset.name);
    });
    this.$("sprite-frame-strip").addEventListener("click", (event) => {
      const button = event.target.closest("[data-frame]");
      if (button) void this.goToFrame(Number(button.dataset.frame));
    });
    this.$("sprite-prev-frame").addEventListener("click", () => this.moveFrame(-1));
    this.$("sprite-next-frame").addEventListener("click", () => this.moveFrame(1));
    this.$("sprites-view").addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.target.closest("input, select, textarea, canvas, summary")) return;
      event.preventDefault();
      void this.moveFrame(event.key === "ArrowLeft" ? -1 : 1);
    });

    const pickFiles = () => this.$("sprite-file-input").click();
    this.$("sprite-import-button").addEventListener("click", pickFiles);
    this.$("sprite-step-import").addEventListener("click", pickFiles);
    this.$("sprite-step-export").addEventListener("click", () => void this.exportFrame());
    this.$("sprite-step-place").addEventListener("click", () => this.openPlacement(true));
    this.$("sprite-step-apply").addEventListener("click", () => void this.applyToGame());
    this.$("sprite-file-input").addEventListener("change", (event) => {
      const files = [...(event.target.files ?? [])];
      event.target.value = "";
      if (files.length) void this.importFiles(files);
    });

    // Le PNG peut être déposé n'importe où dans l'éditeur.
    const editor = this.$("sprite-editor");
    const dropzone = this.$("sprite-dropzone");
    let depth = 0;
    const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
    editor.addEventListener("dragenter", (event) => {
      if (!hasFiles(event)) return;
      depth++;
      dropzone.classList.add("dragging");
    });
    editor.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) dropzone.classList.remove("dragging");
    });
    editor.addEventListener("dragover", (event) => {
      if (hasFiles(event)) event.preventDefault();
    });
    editor.addEventListener("drop", (event) => {
      event.preventDefault();
      depth = 0;
      dropzone.classList.remove("dragging");
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length) void this.importFiles(files);
    });

    this.$("sprite-placement-panel").addEventListener("toggle", () => {
      if (this.$("sprite-placement-panel").open) requestAnimationFrame(() => this.placement.fit());
    });
    this.$("sprite-reset-frame").addEventListener("click", () => void this.resetFrame());
    this.$("sprite-export-frame").addEventListener("click", () => void this.exportFrame());
    this.$("sprite-export-all").addEventListener("click", () => void this.exportAllFrames());
    this.$("sprite-open-folder").addEventListener("click", () => window.api.openSpriteOverrides());
    this.$("sprite-runedelta-adopt").addEventListener("click", () => void this.adoptFromRunedelta());
    this.$("sprite-apply").addEventListener("click", () => void this.applyToGame());
    window.api.onSpriteProgress((line) => this.appendProgress(line));
  }

  init(catalog) {
    this.bind();
    ++this.loadToken;
    this.selectedName = null;
    this.frame = 0;
    this.placement.clear();
    this.thumbnails.clear();
    this.prefetched = false;
    this.setCatalog(catalog);
    // Par défaut, on montre ce qui concerne la traduction : les sprites à texte.
    this.setFilter(this.catalog.some((entry) => entry.hasText) ? "text" : "all", { keepSelection: false });
    if (!this.$("sprites-view").classList.contains("hidden")) this.prefetchPreviews();
  }

  setCatalog(catalog) {
    this.catalog = Array.isArray(catalog) ? catalog : [];
    this.byName = new Map(this.catalog.map((entry) => [entry.name, entry]));
    this.updateCounts();
  }

  setFilter(filter, { keepSelection = true } = {}) {
    this.filter = filter;
    document.querySelectorAll(".sprite-filter").forEach((button) => {
      const active = button.dataset.filter === filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    this.applyFilter();
    const stillVisible = keepSelection && this.filtered.some((entry) => entry.name === this.selectedName);
    if (!stillVisible && this.filtered.length) void this.select(this.filtered[0].name);
  }

  showView(view) {
    const sprites = view === "sprites";
    this.$("layout").classList.toggle("hidden", sprites);
    this.$("sprites-view").classList.toggle("hidden", !sprites);
    document.querySelectorAll(".workspace-tab").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (sprites) {
      if (this.$("sprite-placement-panel").open) this.placement.fit();
      this.renderList();
      this.$("sprite-search").focus();
      this.prefetchPreviews();
    }
    this.$("hint").textContent = sprites
      ? "Dépose un PNG n’importe où pour l’importer · nom_du_sprite_N.png → frame N · ←/→ : frames · ↑/↓ : sprites"
      : this.translationHint;
  }

  // Extrait en arrière-plan, en un seul passage UTMT, les aperçus des sprites à texte.
  async prefetchPreviews() {
    if (this.prefetched || !window.api.prefetchSpritePreviews) return;
    const names = this.catalog.filter((entry) => entry.hasText)
      .flatMap((entry) => [entry.name, entry.variant && !entry.variantGenerated ? entry.variant.name : null])
      .filter(Boolean);
    if (!names.length) return;
    this.prefetched = true;
    const result = await window.api.prefetchSpritePreviews(names);
    if (result?.busy) this.prefetched = false;
    if (result && !result.ok && !result.busy && result.error) this.message(result.error, "error");
    if (!result?.ok || !result.extracted) return;
    for (const [name, url] of this.thumbnails) if (!url) this.thumbnails.delete(name);
    this.renderList();
  }

  updateCounts() {
    const text = this.catalog.filter((entry) => entry.hasText);
    const textDone = text.filter((entry) => entry.translated).length;
    const modified = this.catalog.filter((entry) => entry.overrideFrames.length);
    const pendingSprites = modified.filter((entry) => entry.pendingFrames?.length);
    const pendingFrames = pendingSprites.reduce((sum, entry) => sum + entry.pendingFrames.length, 0);
    const translated = this.catalog.filter((entry) => entry.translated).length;
    const unpublishedFrames = this.catalog.reduce((sum, entry) => sum + (entry.runedelta?.unpublishedFrames?.length ?? 0), 0);

    this.$("sprite-tab-count").textContent = String(translated);
    this.$("sprite-tab-count").classList.toggle("pending", pendingFrames > 0);
    this.$("sprite-tab-count").dataset.tooltip = pendingFrames
      ? `${translated} sprites traduits · ${pendingFrames} frame${plural(pendingFrames)} à appliquer au jeu`
      : `${translated} sprites traduits, dont ${modified.length} modifiés dans DELTATRANSLATE`;

    this.$("sprite-progress-count").textContent = `${textDone} / ${text.length}`;
    this.$("sprite-progress-fill").style.width = text.length ? `${(textDone / text.length) * 100}%` : "0%";
    const counts = {
      text: text.length,
      todo: text.length - textDone,
      modified: modified.length,
      all: this.catalog.length,
    };
    for (const [key, value] of Object.entries(counts)) {
      const target = document.querySelector(`#sprite-filters [data-count="${key}"]`);
      if (target) target.textContent = value.toLocaleString("fr-FR");
    }

    const bar = this.$("sprite-apply-bar");
    bar.classList.toggle("pending", pendingFrames > 0);
    bar.classList.toggle("applied", modified.length > 0 && pendingFrames === 0);
    if (this.applyRunning) {
      this.$("sprite-pending-count").textContent = "Application au jeu en cours…";
      this.$("sprite-apply-detail").textContent = "Recompilation sûre du data.win via UTMT.";
    } else if (unpublishedFrames && !pendingFrames) {
      this.$("sprite-pending-count").textContent =
        `${unpublishedFrames} frame${plural(unpublishedFrames)} à publier sur ${this.catalog.find((entry) => entry.runedelta)?.runedelta.branch}`;
      this.$("sprite-apply-detail").textContent = "Déjà dans ton jeu. Clique sur « ↑ Publier » pour les envoyer sur ta branche Runedelta.";
    } else if (pendingFrames) {
      this.$("sprite-pending-count").textContent =
        `${pendingFrames} frame${plural(pendingFrames)} en attente · ${pendingSprites.length} sprite${plural(pendingSprites.length)}`;
      this.$("sprite-apply-detail").textContent = "Pas encore dans le jeu : clique sur « Appliquer au jeu ».";
    } else if (modified.length) {
      this.$("sprite-pending-count").textContent = `✓ ${modified.length} sprite${plural(modified.length)} modifié${plural(modified.length)}, tout est dans le jeu`;
      this.$("sprite-apply-detail").textContent = "Relance le chapitre pour voir le résultat.";
    } else {
      this.$("sprite-pending-count").textContent = "Aucun sprite modifié";
      this.$("sprite-apply-detail").textContent = "Exporte une frame, retouche-la, puis redépose le PNG.";
    }
    const apply = this.$("sprite-apply");
    apply.disabled = modified.length === 0 || this.applyRunning || this.operationRunning;
    apply.classList.toggle("action-loading", this.applyRunning);
    apply.textContent = this.applyRunning ? "Application…" : "▶ Appliquer au jeu";
  }

  applyFilter() {
    const query = this.$("sprite-search").value.trim().toLocaleLowerCase("fr");
    this.filtered = this.catalog.filter((entry) => {
      if (query && !entry.name.toLocaleLowerCase("fr").includes(query)) return false;
      if (this.filter === "text") return entry.hasText;
      if (this.filter === "todo") return entry.hasText && !entry.translated;
      if (this.filter === "modified") return entry.overrideFrames.length > 0;
      return true;
    });
    // Les modifications en attente puis les sprites à traduire remontent en tête.
    if (this.filter !== "all") {
      const rank = (entry) => (entry.pendingFrames?.length ? 0 : !entry.translated ? 1 : 2);
      this.filtered.sort((a, b) => rank(a) - rank(b));
    }
    this.$("sprite-list").scrollTop = 0;
    this.$("sprite-list-spacer").style.height = `${this.filtered.length * SPRITE_ROW_HEIGHT}px`;
    const count = this.filtered.length.toLocaleString("fr-FR");
    this.$("sprite-list-status").textContent = this.filtered.length
      ? `${count} sprite${plural(this.filtered.length)}`
      : query ? "Aucun sprite ne correspond à la recherche." : this.emptyMessage();
    this.renderList();
  }

  emptyMessage() {
    if (this.filter === "todo") return "Tous les sprites à texte sont traduits !";
    if (this.filter === "modified") return "Aucun sprite importé pour l’instant.";
    return "Aucun sprite.";
  }

  renderList() {
    const container = this.$("sprite-list");
    const output = this.$("sprite-list-items");
    const first = Math.max(0, Math.floor(container.scrollTop / SPRITE_ROW_HEIGHT) - 4);
    const count = Math.ceil(container.clientHeight / SPRITE_ROW_HEIGHT) + 8;
    const visible = this.filtered.slice(first, first + count);
    output.replaceChildren(
      ...visible.map((entry, offset) => {
        const state = spriteState(entry);
        const selected = entry.name === this.selectedName;
        const item = document.createElement("div");
        item.className = `sprite-list-item state-${state.key}${selected ? " selected" : ""}`;
        item.style.top = `${(first + offset) * SPRITE_ROW_HEIGHT}px`;
        item.dataset.name = entry.name;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(selected));
        const thumb = this.thumbnails.get(entry.name);
        item.innerHTML = `
          <div class="sprite-thumb">${thumb ? `<img src="${thumb}" alt="" />` : "<span>▧</span>"}</div>
          <div class="sprite-li-body">
            <div class="sprite-li-name">${escapeHtml(entry.name)}</div>
            <div class="sprite-li-meta">
              <span>${entry.width}×${entry.height}</span>
              ${entry.frames > 1 ? `<span>${entry.frames} frames</span>` : ""}
              ${state.label ? `<span class="sprite-li-state">${escapeHtml(state.label)}</span>` : ""}
            </div>
          </div>`;
        if (!this.thumbnails.has(entry.name)) this.thumbnailQueue.add(entry.name);
        return item;
      })
    );
    this.flushThumbnails();
  }

  flushThumbnails() {
    if (this.thumbnailTimer || !this.thumbnailQueue.size) return;
    this.thumbnailTimer = setTimeout(async () => {
      const names = [...this.thumbnailQueue].slice(0, 80);
      names.forEach((name) => this.thumbnailQueue.delete(name));
      try {
        const result = await window.api.getSpriteThumbnails(names);
        for (const name of names) this.thumbnails.set(name, result?.[name] ?? null);
        this.renderList();
      } finally {
        this.thumbnailTimer = null;
        if (this.thumbnailQueue.size) this.flushThumbnails();
      }
    }, 60);
  }

  selected() {
    return this.byName.get(this.selectedName) ?? null;
  }

  async select(name) {
    if (name === this.selectedName) return;
    if (this.operationRunning || this.applyRunning || !(await this.savePlacement())) return;
    const entry = this.byName.get(name);
    if (!entry) return;
    this.selectedName = name;
    this.frame = 0;
    this.renderList();
    this.renderDetails();
    this.$("sprite-message").textContent = "";
    void this.loadImages();
  }

  renderDetails() {
    const entry = this.selected();
    if (!entry) return;
    const frameCount = this.frameCount(entry);
    const language = (entry.language ?? "fr").toUpperCase();
    this.frame = Math.min(this.frame, Math.max(0, frameCount - 1));
    this.$("sprite-name").textContent = entry.name;
    this.$("sprite-meta").textContent =
      `${entry.width} × ${entry.height} px · ${entry.frames} frame${plural(entry.frames)} · origine (${entry.originX}, ${entry.originY})`;
    this.$("sprite-original-name").textContent = `${entry.name}_${Math.min(this.frame, entry.frames - 1)}.png`;
    this.$("sprite-translated-title").textContent = `Traduction ${language}`;
    this.$("sprite-translated-name").textContent = entry.targetName;
    this.$("sprite-frame-label").textContent = `Frame ${this.frame + 1} / ${frameCount}`;
    this.$("sprite-prev-frame").disabled = frameCount <= 1;
    this.$("sprite-next-frame").disabled = frameCount <= 1;
    this.$("sprite-frames").classList.toggle("single", frameCount <= 1);
    const overridden = entry.overrideFrames.includes(this.frame);
    this.$("sprite-reset-frame").disabled = !overridden || this.operationRunning || this.applyRunning;
    this.$("sprite-import-button").textContent = overridden ? "↑ Remplacer le PNG…" : "↑ Importer un PNG…";
    this.$("sprite-dropzone").classList.toggle("has-import", overridden);

    const badges = [];
    if (entry.hasText) badges.push('<span class="sprite-badge text">TEXTE</span>');
    if (entry.variant && !entry.variantGenerated) badges.push(`<span class="sprite-badge ok">✓ VERSION ${escapeHtml(language)} DANS LE JEU</span>`);
    if (entry.overrideFrames.length) {
      const pending = entry.pendingFrames?.length ?? 0;
      badges.push(pending
        ? `<span class="sprite-badge pending">${pending} FRAME${pending > 1 ? "S" : ""} À APPLIQUER</span>`
        : `<span class="sprite-badge ok">✓ IMPORT APPLIQUÉ</span>`);
    }
    const unpublished = entry.runedelta?.unpublishedFrames?.length ?? 0;
    if (unpublished) badges.push(`<span class="sprite-badge unpublished">${unpublished} FRAME${unpublished > 1 ? "S" : ""} À PUBLIER</span>`);
    else if (entry.runedelta?.frames?.length) badges.push(`<span class="sprite-badge ok">✓ SUR ${escapeHtml(entry.runedelta.branch.toUpperCase())}</span>`);
    this.$("sprite-badges").innerHTML = badges.join("");
    this.renderRunedelta(entry);

    const hint = this.$("sprite-text-hint");
    if (entry.textSource) {
      hint.innerHTML = `Le jeu japonais remplace ce sprite par <code>${escapeHtml(entry.textSource)}</code> : il contient du texte à traduire.`;
    } else if (entry.hasText) {
      hint.innerHTML = `Ce sprite possède déjà une variante <code>${escapeHtml(entry.targetName)}</code> dans le data.win : importe un PNG pour la remplacer.`;
    } else {
      hint.textContent = "Le jeu ne localise pas ce sprite : il ne contient probablement pas de texte. Tu peux quand même le modifier.";
    }
    hint.classList.remove("hidden");
    hint.classList.toggle("neutral", !entry.hasText);

    this.$("sprite-placement-panel").open = overridden;
    this.renderSteps();
    this.renderStripSelection();
  }

  renderRunedelta(entry) {
    const note = this.$("sprite-runedelta-hint");
    const repository = entry.runedelta;
    note.classList.toggle("hidden", !repository);
    if (!repository) return;
    const onBranch = repository.frames.length;
    const unpublished = repository.unpublishedFrames.length;
    const missing = repository.frames.filter((frame) => !entry.overrideFrames.includes(frame)).length;
    const parts = [];
    if (onBranch) parts.push(`${onBranch} frame${plural(onBranch)} sur la branche <code>${escapeHtml(repository.branch)}</code>`);
    else parts.push(`Pas encore sur la branche <code>${escapeHtml(repository.branch)}</code>`);
    if (unpublished) parts.push(`${unpublished} frame${plural(unpublished)} importée${plural(unpublished)} à publier : clique sur <b>↑ Publier</b> pour les envoyer avec tes textes`);
    else if (entry.overrideFrames.length) parts.push("tes imports sont identiques à ceux de la branche");
    this.$("sprite-runedelta-text").innerHTML = `Runedelta — ${parts.join(" · ")}.`;
    const adopt = this.$("sprite-runedelta-adopt");
    adopt.classList.toggle("hidden", missing === 0);
    adopt.disabled = this.operationRunning || this.applyRunning;
    adopt.textContent = `↓ Reprendre ${missing} frame${plural(missing)} de la branche`;
  }

  async adoptFromRunedelta() {
    const entry = this.selected();
    if (!entry || this.operationRunning || this.applyRunning) return;
    this.operationRunning = true;
    try {
      const result = await window.api.adoptRunedeltaSprite(entry.name);
      if (!result.ok) return this.message(result.error, "error");
      this.message(`${result.adopted} frame${plural(result.adopted)} reprise${plural(result.adopted)} de Runedelta. Applique au jeu pour les voir en jeu.`, "success");
    } finally {
      this.operationRunning = false;
      await this.refreshCatalog();
      void this.loadImages();
    }
  }

  renderSteps() {
    const entry = this.selected();
    const steps = document.querySelectorAll("#sprite-steps li");
    if (!entry) return steps.forEach((step) => step.removeAttribute("data-state"));
    const overridden = entry.overrideFrames.includes(this.frame);
    const dirty = Boolean(this.placement?.dirty);
    const pending = entry.pendingFrames?.includes(this.frame) ?? false;
    const done = {
      export: overridden,
      import: overridden,
      place: overridden && !dirty,
      apply: overridden && !dirty && !pending,
    };
    const current = ["export", "import", "place", "apply"].find((key) => !done[key]);
    steps.forEach((step) => {
      const key = step.dataset.step;
      step.dataset.state = done[key] ? "done" : key === current ? "current" : "todo";
      if (key === current) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    const busy = this.operationRunning || this.applyRunning;
    this.$("sprite-step-export").disabled = busy;
    this.$("sprite-step-import").disabled = busy;
    this.$("sprite-step-place").disabled = !overridden;
    this.$("sprite-step-apply").disabled = busy || !this.catalog.some((item) => item.overrideFrames.length);
  }

  frameCount(entry = this.selected()) {
    return Math.max(1, entry?.frames ?? 1, entry?.variant?.frames ?? 0);
  }

  async goToFrame(frame) {
    const count = this.frameCount();
    if (frame === this.frame || frame < 0 || frame >= count) return;
    if (this.operationRunning || this.applyRunning || !(await this.savePlacement())) return;
    this.frame = frame;
    this.renderDetails();
    void this.loadImages({ strip: false });
  }

  async moveFrame(direction) {
    const count = this.frameCount();
    if (count <= 1) return;
    await this.goToFrame((this.frame + direction + count) % count);
  }

  async loadImages({ strip = true } = {}) {
    const entry = this.selected();
    if (!entry) return;
    const token = ++this.loadToken;
    this.placement.clear();
    this.setImageLoading("original", `Extraction de ${entry.name}…`);
    this.setImageLoading("translated", entry.variant ? `Chargement de ${entry.targetName}…` : "Chargement…");
    if (strip) this.renderStrip(entry);
    const [original, translated] = await Promise.all([
      window.api.getSpriteFrame(entry.name, "original", Math.min(this.frame, entry.frames - 1)),
      window.api.getSpriteFrame(entry.name, "translated", Math.min(this.frame, (entry.variant?.frames ?? entry.frames) - 1)),
    ]);
    if (token !== this.loadToken) return;
    this.showImageResult("original", original);
    this.showImageResult("translated", translated);
    this.$("sprite-translated-name").textContent = translated.source === "runedelta"
      ? `Runedelta · ${translated.repositoryPath}` : entry.targetName;
    if (original.ok && !this.thumbnails.get(entry.name) && this.frame === 0) {
      this.thumbnails.set(entry.name, original.dataUrl);
      this.renderList();
    }
    const images = {};
    await Promise.all([["original", original], ["translated", translated]].map(async ([role, result]) => {
      if (!result.ok) return;
      const image = new Image();
      image.src = result.dataUrl;
      try { await image.decode(); images[role] = image; } catch { this.message("Impossible de décoder l’image PNG.", "error"); }
    }));
    if (token !== this.loadToken) return;
    this.placement.load(entry, images, translated.placement, translated.source === "override");
    this.renderSteps();
    if (strip) void this.loadStripImages(entry);
  }

  renderStrip(entry) {
    const count = this.frameCount(entry);
    const strip = this.$("sprite-frame-strip");
    if (count <= 1 || count > MAX_STRIP_FRAMES) {
      strip.replaceChildren();
      return;
    }
    strip.replaceChildren(...Array.from({ length: count }, (_unused, frame) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.frame = String(frame);
      button.setAttribute("role", "option");
      button.setAttribute("aria-label", `Frame ${frame + 1}`);
      button.innerHTML = `<span class="sprite-strip-img"></span><span class="sprite-strip-num">${frame + 1}</span>`;
      return button;
    }));
    this.renderStripSelection();
  }

  renderStripSelection() {
    const entry = this.selected();
    this.$("sprite-frame-strip").querySelectorAll("[data-frame]").forEach((button) => {
      const frame = Number(button.dataset.frame);
      button.classList.toggle("selected", frame === this.frame);
      button.setAttribute("aria-selected", String(frame === this.frame));
      button.classList.toggle("imported", Boolean(entry?.overrideFrames.includes(frame)));
      button.classList.toggle("pending", Boolean(entry?.pendingFrames?.includes(frame)));
    });
    // scrollIntoView ferait aussi défiler l'éditeur : on ne décale que la bande.
    const strip = this.$("sprite-frame-strip"), current = strip.querySelector(".selected");
    if (current && (current.offsetLeft < strip.scrollLeft || current.offsetLeft + current.offsetWidth > strip.scrollLeft + strip.clientWidth)) {
      strip.scrollLeft = current.offsetLeft - strip.clientWidth / 2 + current.offsetWidth / 2;
    }
  }

  // Miniatures de la bande : la version traduite de chaque frame, chargées une à une.
  async loadStripImages(entry) {
    const token = ++this.stripToken;
    const buttons = [...this.$("sprite-frame-strip").querySelectorAll("[data-frame]")];
    const translatedFrames = entry.variant?.frames ?? entry.frames;
    for (const button of buttons) {
      const frame = Number(button.dataset.frame);
      const result = await window.api.getSpriteFrame(entry.name, "translated", Math.min(frame, translatedFrames - 1));
      if (token !== this.stripToken || entry.name !== this.selectedName) return;
      if (result?.ok) button.querySelector(".sprite-strip-img").innerHTML = `<img src="${result.dataUrl}" alt="" />`;
    }
  }

  setImageLoading(role, message) {
    const image = this.$(`sprite-${role}-image`);
    image.classList.add("hidden");
    const loading = this.$(`sprite-${role}-canvas`).querySelector(".sprite-loading");
    loading.textContent = message;
    loading.classList.remove("hidden");
  }

  showImageResult(role, result) {
    const image = this.$(`sprite-${role}-image`);
    const loading = this.$(`sprite-${role}-canvas`).querySelector(".sprite-loading");
    if (!result?.ok) {
      loading.textContent = result?.error ?? "Aperçu indisponible.";
      loading.classList.remove("hidden");
      image.classList.add("hidden");
      return;
    }
    image.src = result.dataUrl;
    image.classList.remove("hidden");
    loading.classList.add("hidden");
  }

  // Un fichier « nom_du_sprite_N.png » va dans la frame N de ce sprite ; un fichier
  // seul au nom quelconque remplace la frame affichée.
  planImports(files) {
    const entry = this.selected();
    const plan = [], rejected = [];
    for (const file of files) {
      if (!/\.png$/i.test(file.name)) { rejected.push(`${file.name} (pas un PNG)`); continue; }
      const match = frameFromFileName(file.name, (name) => this.byName.get(name), entry?.name);
      if (match) {
        const target = this.byName.get(match.name);
        if (match.frame >= this.frameCount(target)) rejected.push(`${file.name} (frame ${match.frame} inexistante)`);
        else plan.push({ file, name: match.name, frame: match.frame });
      } else if (files.length === 1 && entry) {
        plan.push({ file, name: entry.name, frame: this.frame });
      } else {
        rejected.push(`${file.name} (nom attendu : nom_du_sprite_N.png)`);
      }
    }
    return { plan, rejected };
  }

  async importFiles(files) {
    if (this.operationRunning || this.applyRunning || !(await this.savePlacement())) return;
    const { plan, rejected } = this.planImports(files);
    if (!plan.length) {
      this.message(rejected.length ? `Aucun fichier importé : ${rejected.join(", ")}.` : "Sélectionne d’abord un sprite.", "error");
      return;
    }
    this.setBusy(true);
    this.message(plan.length > 1 ? `Import de ${plan.length} PNG…` : "Import et vérification du PNG…");
    const failures = [...rejected];
    const imported = [];
    try {
      for (const item of plan) {
        const result = await window.api.importSpriteFrame(item.name, item.frame, item.file);
        if (!result.ok) { failures.push(`${item.file.name} (${result.error})`); continue; }
        this.replaceEntry(result.entry);
        imported.push(item);
      }
    } finally {
      this.setBusy(false);
    }
    if (imported.length) {
      const here = imported.filter((item) => item.name === this.selectedName);
      if (imported.length === 1 && here.length === 1) this.frame = here[0].frame;
      this.renderDetails();
      await this.loadImages();
      if (here.length) this.openPlacement(false);
    }
    const sprites = new Set(imported.map((item) => item.name)).size;
    const summary = imported.length === 1
      ? `${imported[0].name === this.selectedName ? "Frame" : imported[0].name + ", frame"} ${imported[0].frame + 1} importée. Vérifie sa position, puis applique au jeu.`
      : `${imported.length} frames importées dans ${sprites} sprite${plural(sprites)}.`;
    if (!failures.length) this.message(summary, "success");
    else this.message(`${imported.length ? summary + " " : ""}Ignorés : ${failures.join(" · ")}`, imported.length ? "warning" : "error");
  }

  openPlacement(focus) {
    const panel = this.$("sprite-placement-panel");
    panel.open = true;
    requestAnimationFrame(() => {
      this.placement.fit();
      if (focus) {
        panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
        this.$("sprite-placement-canvas").focus({ preventScroll: true });
      }
    });
  }

  setBusy(busy) {
    this.operationRunning = busy;
    this.placement.busy = busy || this.applyRunning;
    this.placement.update();
    this.updateCounts();
    this.renderSteps();
    const locked = busy || this.applyRunning;
    for (const id of ["sprite-file-input", "sprite-import-button", "sprite-export-frame", "sprite-export-all"]) this.$(id).disabled = locked;
    const entry = this.selected();
    this.$("sprite-reset-frame").disabled = locked || !entry?.overrideFrames.includes(this.frame);
    this.$("sprite-dropzone").classList.toggle("busy", locked);
  }

  async savePlacement() {
    if (this.operationRunning || this.applyRunning) return false;
    if (!this.placement?.dirty) return true;
    const name = this.selectedName, frame = this.frame;
    const position = { ...this.placement.position };
    this.setBusy(true);
    try {
      const result = await window.api.saveSpritePlacement(name, frame, position);
      if (!result.ok) throw new Error(result.error);
      this.placement.saved = { ...result.placement };
      this.placement.update();
      await this.refreshCatalog();
      this.message("Position enregistrée. Applique au jeu pour la voir en jeu.", "success");
      return true;
    } catch (error) {
      this.message(error.message, "error");
      return false;
    } finally {
      this.setBusy(false);
    }
  }

  async resetFrame() {
    const entry = this.selected();
    if (!entry || !entry.overrideFrames.includes(this.frame) || this.operationRunning || this.applyRunning) return;
    this.setBusy(true);
    try {
      const result = await window.api.resetSpriteFrame(entry.name, this.frame);
      if (!result.ok) throw new Error(result.error);
      this.replaceEntry(result.entry);
      this.renderDetails();
      await this.loadImages();
      this.message("Import retiré pour cette frame. Applique au jeu pour rétablir l’original.", "success");
    } catch (error) {
      this.message(error.message, "error");
    } finally {
      this.setBusy(false);
    }
  }

  async exportFrame() {
    const entry = this.selected();
    if (!entry || this.operationRunning || this.applyRunning) return;
    this.message("Préparation de la frame originale…");
    const result = await window.api.exportSpriteFrame(entry.name, Math.min(this.frame, entry.frames - 1));
    if (!result.ok) {
      this.message(result.error, "error");
      return;
    }
    this.message(result.canceled ? "Export annulé." : `Frame exportée : ${result.filePath}. Retouche-la, puis redépose-la ici.`, result.canceled ? "" : "success");
  }

  async exportAllFrames() {
    const entry = this.selected();
    if (!entry || this.operationRunning || this.applyRunning) return;
    this.message(`Préparation des ${entry.frames} frame${plural(entry.frames)}…`);
    const result = await window.api.exportSpriteFrames(entry.name);
    if (!result.ok) {
      this.message(result.error, "error");
      return;
    }
    if (result.canceled) {
      this.message("Export annulé.");
      return;
    }
    const skipped = result.skipped?.length
      ? ` ${result.skipped.length} fichier${plural(result.skipped.length)} déjà présent${plural(result.skipped.length)}, non écrasé${plural(result.skipped.length)}.`
      : "";
    this.message(`${result.exported} frame${plural(result.exported)} exportée${plural(result.exported)} dans ${result.directory}.${skipped} Redépose les PNG ensemble pour tout importer.`,
      result.skipped?.length ? "warning" : "success");
  }

  replaceEntry(next) {
    if (!next) return;
    const index = this.catalog.findIndex((entry) => entry.name === next.name);
    if (index >= 0) this.catalog[index] = next;
    this.byName.set(next.name, next);
    this.updateCounts();
    const scroll = this.$("sprite-list").scrollTop;
    this.applyFilter();
    this.$("sprite-list").scrollTop = scroll;
    this.renderList();
  }

  async refreshCatalog() {
    const result = await window.api.getSpriteCatalog?.();
    if (!result?.ok) return;
    const scroll = this.$("sprite-list").scrollTop;
    this.setCatalog(result.catalog);
    this.applyFilter();
    this.$("sprite-list").scrollTop = scroll;
    this.renderList();
    if (this.selected()) {
      this.renderDetails();
      this.renderStripSelection();
    }
  }

  async applyToGame() {
    if (this.applyRunning || this.operationRunning || !(await this.savePlacement())) return;
    this.applyRunning = true;
    this.setBusy(true);
    this.$("sprite-progress").textContent = "";
    this.$("sprite-progress").classList.remove("hidden");
    this.message("");
    try {
      const result = await window.api.applySpriteOverrides();
      if (!result.ok) throw new Error(result.error);
      this.$("sprite-progress").classList.add("hidden");
      this.message("Sprites et positions appliqués au jeu. Relance le chapitre pour les voir.", "success");
    } catch (error) {
      this.message(error.message, "error");
    } finally {
      this.applyRunning = false;
      this.setBusy(false);
      await this.refreshCatalog();
    }
  }

  appendProgress(line) {
    const progress = this.$("sprite-progress");
    // Hors application, ces lignes ne signalent que l'extraction d'un aperçu, déjà affichée sur les cartes.
    if (!progress || !line || !this.applyRunning) return;
    progress.classList.remove("hidden");
    progress.textContent += `${line}\n`;
    progress.scrollTop = progress.scrollHeight;
  }

  message(text, type = "") {
    const target = this.$("sprite-message");
    target.className = type;
    target.textContent = text ?? "";
  }

  onListKeydown(event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const current = this.filtered.findIndex((entry) => entry.name === this.selectedName);
    const next = Math.max(0, Math.min(this.filtered.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
    const entry = this.filtered[next];
    if (!entry) return;
    void this.select(entry.name);
    const list = this.$("sprite-list");
    const top = next * SPRITE_ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + SPRITE_ROW_HEIGHT > list.scrollTop + list.clientHeight) list.scrollTop = top + SPRITE_ROW_HEIGHT - list.clientHeight;
  }
}

function plural(count) {
  return count > 1 ? "s" : "";
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value);
  return element.innerHTML;
}
