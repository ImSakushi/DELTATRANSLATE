import { SpritePlacement } from "./sprite-placement.js";

const SPRITE_ROW_HEIGHT = 62;

export class SpriteEditor {
  constructor(getElement) {
    this.$ = getElement;
    this.catalog = [];
    this.filtered = [];
    this.selectedName = null;
    this.frame = 0;
    this.filter = "all";
    this.loadToken = 0;
    this.bound = false;
    this.applyRunning = false;
    this.translationHint = "";
    this.operationRunning = false;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    this.placement = new SpritePlacement(this.$, () => this.updateCounts());
    this.$("sprite-save-placement").onclick = () => void this.savePlacement();
    this.translationHint = this.$("hint").textContent;

    document.querySelectorAll(".workspace-tab").forEach((button) => {
      button.addEventListener("click", () => this.showView(button.dataset.view));
    });
    this.$("sprite-search").addEventListener("input", () => this.applyFilter());
    document.querySelectorAll(".sprite-filter").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelector(".sprite-filter.active")?.classList.remove("active");
        button.classList.add("active");
        this.filter = button.dataset.filter;
        this.applyFilter();
      });
    });
    this.$("sprite-list").addEventListener("scroll", () => this.renderList(), { passive: true });
    this.$("sprite-list").addEventListener("keydown", (event) => this.onListKeydown(event));
    this.$("sprite-prev-frame").addEventListener("click", () => this.moveFrame(-1));
    this.$("sprite-next-frame").addEventListener("click", () => this.moveFrame(1));
    this.$("sprite-dropzone").addEventListener("click", () => this.$("sprite-file-input").click());
    this.$("sprite-dropzone").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.$("sprite-file-input").click();
      }
    });
    this.$("sprite-file-input").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) void this.importFrame(file);
      event.target.value = "";
    });
    const dropzone = this.$("sprite-dropzone");
    dropzone.addEventListener("dragenter", () => dropzone.classList.add("dragging"));
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
    dropzone.addEventListener("dragover", (event) => event.preventDefault());
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragging");
      const file = event.dataTransfer?.files?.[0];
      if (file) void this.importFrame(file);
    });
    this.$("sprite-reset-frame").addEventListener("click", () => void this.resetFrame());
    this.$("sprite-export-frame").addEventListener("click", () => void this.exportFrame());
    this.$("sprite-open-folder").addEventListener("click", () => window.api.openSpriteOverrides());
    this.$("sprite-apply").addEventListener("click", () => void this.applyToGame());
    window.api.onSpriteProgress((line) => this.appendProgress(line));
  }

  init(catalog) {
    this.bind();
    ++this.loadToken;
    this.selectedName = null;
    this.frame = 0;
    this.placement.clear();
    this.catalog = Array.isArray(catalog) ? catalog : [];
    this.applyFilter();
    this.updateCounts();
    if (!this.selectedName && this.filtered.length) this.select(this.filtered[0].name);
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
      this.placement.fit();
      this.renderList();
      this.$("sprite-search").focus();
    }
    this.$("hint").textContent = sprites
      ? "Recherche et filtres à gauche · ←/→ pour les frames · exporte, retouche puis redépose le PNG"
      : this.translationHint;
  }

  updateCounts() {
    const translated = this.catalog.filter((entry) => entry.translated).length;
    const imported = this.catalog.filter((entry) => entry.overrideFrames.length).length;
    this.$("sprite-tab-count").textContent = String(translated);
    this.$("sprite-tab-count").dataset.tooltip =
      `${translated} sprites traduits, dont ${imported} modifiés dans DELTATRANSLATE`;
    this.$("sprite-apply").disabled = imported === 0 || this.applyRunning || this.operationRunning;
  }

  applyFilter() {
    const query = this.$("sprite-search").value.trim().toLocaleLowerCase("fr");
    this.filtered = this.catalog.filter((entry) => {
      if (query && !entry.name.toLocaleLowerCase("fr").includes(query)) return false;
      if (this.filter === "translated") return entry.translated;
      if (this.filter === "todo") return !entry.translated;
      if (this.filter === "imported") return entry.overrideFrames.length > 0;
      return true;
    });
    this.$("sprite-list").scrollTop = 0;
    this.$("sprite-list-spacer").style.height = `${this.filtered.length * SPRITE_ROW_HEIGHT}px`;
    const translated = this.filtered.filter((entry) => entry.translated).length;
    this.$("sprite-list-status").textContent =
      `${this.filtered.length.toLocaleString("fr-FR")} sprites · ${translated.toLocaleString("fr-FR")} traduits`;
    this.renderList();
  }

  renderList() {
    const container = this.$("sprite-list");
    const output = this.$("sprite-list-items");
    const first = Math.max(0, Math.floor(container.scrollTop / SPRITE_ROW_HEIGHT) - 4);
    const count = Math.ceil(container.clientHeight / SPRITE_ROW_HEIGHT) + 8;
    const visible = this.filtered.slice(first, first + count);
    output.replaceChildren(
      ...visible.map((entry, offset) => {
        const imported = entry.overrideFrames.length > 0;
        const item = document.createElement("div");
        item.className = [
          "sprite-list-item",
          entry.translated ? "translated" : "",
          imported ? "imported" : "",
          entry.name === this.selectedName ? "selected" : "",
        ].filter(Boolean).join(" ");
        item.style.top = `${(first + offset) * SPRITE_ROW_HEIGHT}px`;
        item.dataset.name = entry.name;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(entry.name === this.selectedName));
        const state = imported
          ? '<span class="sprite-li-state local">Import local</span>'
          : entry.variant
            ? `<span class="sprite-li-state ok">_${escapeHtml(entry.language ?? "fr")} prêt</span>`
            : '<span class="sprite-li-state">À faire</span>';
        item.innerHTML = `
          <div class="sprite-li-name">${escapeHtml(entry.name)}</div>
          <div class="sprite-li-meta">
            <span>${entry.width}×${entry.height}</span>
            <span>${entry.frames} frame${entry.frames > 1 ? "s" : ""}</span>
            ${state}
          </div>`;
        item.addEventListener("click", () => this.select(entry.name));
        return item;
      })
    );
  }

  selected() {
    return this.catalog.find((entry) => entry.name === this.selectedName) ?? null;
  }

  async select(name) {
    if (this.operationRunning || this.applyRunning || !(await this.savePlacement())) return;
    const entry = this.catalog.find((item) => item.name === name);
    if (!entry) return;
    this.selectedName = name;
    this.frame = 0;
    this.renderList();
    this.renderDetails();
    void this.loadImages();
  }

  renderDetails() {
    const entry = this.selected();
    if (!entry) return;
    const frameCount = this.frameCount(entry);
    this.frame = Math.min(this.frame, Math.max(0, frameCount - 1));
    this.$("sprite-name").textContent = entry.name;
    this.$("sprite-meta").textContent =
      `${entry.width} × ${entry.height} px · origine ${entry.originX}, ${entry.originY} · ` +
      `${entry.frames} frame${entry.frames > 1 ? "s" : ""}`;
    this.$("sprite-original-name").textContent = entry.name;
    this.$("sprite-translated-name").textContent = entry.targetName;
    this.$("sprite-frame-label").textContent = `Frame ${this.frame + 1} / ${frameCount}`;
    this.$("sprite-prev-frame").disabled = frameCount <= 1;
    this.$("sprite-next-frame").disabled = frameCount <= 1;
    const overridden = entry.overrideFrames.includes(this.frame);
    this.$("sprite-reset-frame").disabled = !overridden;

    const badges = [];
    if (entry.variant) badges.push(`<span class="sprite-badge ok">✓ VARIANTE ${escapeHtml((entry.language ?? "fr").toUpperCase())} PRÊTE</span>`);
    else badges.push('<span class="sprite-badge todo">AUCUNE VARIANTE</span>');
    if (entry.overrideFrames.length) {
      badges.push(`<span class="sprite-badge local">${entry.overrideFrames.length} FRAME${entry.overrideFrames.length > 1 ? "S" : ""} IMPORTÉE${entry.overrideFrames.length > 1 ? "S" : ""}</span>`);
    }
    this.$("sprite-badges").innerHTML = badges.join("");
    this.$("sprite-import-title").textContent = overridden
      ? "Remplacer à nouveau cette frame"
      : "Importer la traduction de cette frame";
    this.$("sprite-import-hint").textContent = entry.variant
      ? `PNG de dimensions libres pour ${entry.targetName}, frame ${this.frame + 1}. Aucun redimensionnement ni rognage. Ajuste ensuite sa position dans l’aperçu.`
      : `PNG de dimensions libres pour ${entry.targetName}. Ajuste sa position dans l’aperçu ; prépare une langue dans les paramètres pour une variante indépendante.`;
  }

  frameCount(entry = this.selected()) {
    return Math.max(1, entry?.frames ?? 1, entry?.variant?.frames ?? 0);
  }

  async moveFrame(direction) {
    if (this.operationRunning || this.applyRunning || !(await this.savePlacement())) return;
    const count = this.frameCount();
    this.frame = (this.frame + direction + count) % count;
    this.renderDetails();
    void this.loadImages();
  }

  async loadImages() {
    const entry = this.selected();
    if (!entry) return;
    const token = ++this.loadToken;
    this.placement.clear();
    this.setImageLoading("original", `Extraction de ${entry.name}…`);
    this.setImageLoading("translated", entry.variant ? `Chargement de ${entry.targetName}…` : "Comparaison avec la source…");
    const [original, translated] = await Promise.all([
      window.api.getSpriteFrame(entry.name, "original", Math.min(this.frame, entry.frames - 1)),
      window.api.getSpriteFrame(entry.name, "translated", Math.min(this.frame, (entry.variant?.frames ?? entry.frames) - 1)),
    ]);
    if (token !== this.loadToken) return;
    this.showImageResult("original", original);
    this.showImageResult("translated", translated);
    const images = {};
    await Promise.all([["original", original], ["translated", translated]].map(async ([role, result]) => {
      if (!result.ok) return;
      const image = new Image();
      image.src = result.dataUrl;
      try { await image.decode(); images[role] = image; } catch { this.message("Impossible de décoder l’image PNG.", "error"); }
    }));
    if (token !== this.loadToken) return;
    this.placement.load(entry, images, translated.placement, translated.source === "override");
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

  async importFrame(file) {
    const entry = this.selected();
    if (!entry) return;
    if (!/\.png$/i.test(file.name)) {
      this.message("Le fichier doit être une image PNG.", "error");
      return;
    }
    if (this.operationRunning || this.applyRunning || !(await this.savePlacement())) return;
    const frame = this.frame;
    this.setBusy(true);
    this.message("Import et vérification du PNG…");
    try {
      const result = await window.api.importSpriteFrame(entry.name, frame, file);
      if (!result.ok) throw new Error(result.error);
      this.replaceEntry(result.entry);
      this.renderDetails();
      await this.loadImages();
      this.message(`Frame ${frame + 1} importée. Ajuste sa position dans l’aperçu, puis applique les sprites au jeu.`, "success");
    } catch (error) {
      this.message(error.message, "error");
    } finally {
      this.setBusy(false);
    }
  }

  setBusy(busy) {
    this.operationRunning = busy;
    this.placement.busy = busy || this.applyRunning;
    this.placement.update();
    this.updateCounts();
    this.$("sprite-file-input").disabled = busy || this.applyRunning;
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
      this.message("Position enregistrée. Elle sera conservée à chaque recompilation.", "success");
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
      this.message("Import local et position annulés pour cette frame.", "success");
    } catch (error) {
      this.message(error.message, "error");
    } finally {
      this.setBusy(false);
    }
  }

  async exportFrame() {
    const entry = this.selected();
    if (!entry) return;
    this.message("Préparation de la frame originale…");
    const result = await window.api.exportSpriteFrame(entry.name, Math.min(this.frame, entry.frames - 1));
    if (!result.ok) {
      this.message(result.error, "error");
      return;
    }
    this.message(result.canceled ? "Export annulé." : `Frame exportée : ${result.filePath}`, result.canceled ? "" : "success");
  }

  replaceEntry(next) {
    const index = this.catalog.findIndex((entry) => entry.name === next.name);
    if (index >= 0) this.catalog[index] = next;
    this.applyFilter();
    this.updateCounts();
  }

  async applyToGame() {
    if (this.applyRunning || this.operationRunning || !(await this.savePlacement())) return;
    this.applyRunning = true;
    this.setBusy(true);
    this.$("sprite-progress").textContent = "";
    this.$("sprite-progress").classList.remove("hidden");
    this.message("Recompilation sûre du data.win en cours…");
    try {
      const result = await window.api.applySpriteOverrides();
      if (!result.ok) throw new Error(result.error);
      this.message("Sprites et positions appliqués au jeu avec succès.", "success");
    } catch (error) {
      this.message(error.message, "error");
    } finally {
      this.applyRunning = false;
      this.setBusy(false);
    }
  }

  appendProgress(line) {
    const progress = this.$("sprite-progress");
    if (!progress || !line) return;
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
    this.select(entry.name);
    this.$("sprite-list").scrollTop = Math.max(0, next * SPRITE_ROW_HEIGHT - this.$("sprite-list").clientHeight / 2);
  }
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value);
  return element.innerHTML;
}
