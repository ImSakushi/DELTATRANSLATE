import { spriteBounds, validatePlacement } from "./sprite-geometry.mjs";

export class SpritePlacement {
  constructor(getElement, onChange) {
    this.$ = getElement;
    this.onChange = onChange;
    this.canvas = this.$("sprite-placement-canvas");
    this.position = { x: 0, y: 0 };
    this.saved = { ...this.position };
    this.zoom = 2;
    this.center = { x: 0, y: 0 };
    this.editable = false;
    this.busy = false;
    this.images = {};
    this.bind();
  }

  get dirty() {
    return this.position.x !== this.saved.x || this.position.y !== this.saved.y;
  }

  bind() {
    for (const axis of ["x", "y"]) {
      this.$(`sprite-offset-${axis}`).addEventListener("input", (event) => {
        this.move({ ...this.position, [axis]: event.target.valueAsNumber });
      });
    }
    this.$("sprite-offset-reset").onclick = () => this.move({ x: 0, y: 0 });
    this.$("sprite-zoom").onchange = (event) => { this.zoom = Number(event.target.value); this.draw(); };
    this.$("sprite-fit").onclick = () => this.fit();
    for (const id of ["sprite-overlay", "sprite-grid", "sprite-background"]) this.$(id).onchange = () => this.draw();
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        this.pan = { x: event.clientX, y: event.clientY, center: { ...this.center } };
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
      if (!this.editable || this.busy || event.button !== 0) return;
      event.preventDefault();
      this.canvas.focus();
      const point = this.point(event);
      const target = this.entry.variant ?? this.entry;
      const x = this.position.x - target.originX, y = this.position.y - target.originY;
      if (point.x < x || point.y < y || point.x >= x + this.images.translated.width || point.y >= y + this.images.translated.height) return;
      this.drag = { point, position: { ...this.position } };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.pan) {
        this.center = { x: this.pan.center.x - (event.clientX - this.pan.x) / this.zoom,
          y: this.pan.center.y - (event.clientY - this.pan.y) / this.zoom };
        this.draw();
        return;
      }
      if (!this.drag) return;
      const point = this.point(event);
      this.move({ x: this.drag.position.x + Math.round(point.x - this.drag.point.x),
        y: this.drag.position.y + Math.round(point.y - this.drag.point.y) });
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) this.canvas.addEventListener(type, () => { this.drag = this.pan = null; });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.center.x += event.deltaX / this.zoom;
      this.center.y += event.deltaY / this.zoom;
      this.draw();
    }, { passive: false });
    this.canvas.addEventListener("keydown", (event) => {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!directions[event.key] || !this.editable || this.busy) return;
      event.preventDefault();
      event.stopPropagation();
      const [dx, dy] = directions[event.key], step = event.shiftKey ? 10 : 1;
      this.move({ x: this.position.x + dx * step, y: this.position.y + dy * step });
    });
  }

  clear() {
    this.entry = null;
    this.images = {};
    this.editable = false;
    this.drag = this.pan = null;
    this.position = this.saved = { x: 0, y: 0 };
    this.update();
    this.draw();
  }

  load(entry, images, placement, editable) {
    this.entry = entry;
    this.images = images;
    this.position = validatePlacement(placement ?? { x: 0, y: 0 });
    this.saved = { ...this.position };
    this.editable = editable && Boolean(images.translated);
    this.update();
    this.fit();
  }

  move(position) {
    if (!this.editable || this.busy) return;
    try {
      validatePlacement(position);
      spriteBounds(this.entry.variant ?? this.entry, [{ ...position, width: this.images.translated.width, height: this.images.translated.height }]);
      this.position = position;
      this.update();
      this.draw();
      this.onChange();
    } catch (error) {
      this.$("sprite-placement-status").textContent = error.message;
    }
  }

  update() {
    for (const axis of ["x", "y"]) {
      this.$(`sprite-offset-${axis}`).value = this.position[axis];
      this.$(`sprite-offset-${axis}`).disabled = !this.editable || this.busy;
    }
    this.$("sprite-offset-reset").disabled = !this.editable || this.busy;
    this.$("sprite-save-placement").disabled = !this.dirty || this.busy;
    const image = this.images.translated;
    this.$("sprite-placement-status").textContent = image
      ? `${image.width} × ${image.height} px · ${this.dirty ? "Position non enregistrée" : this.editable ? "Position enregistrée" : "Importe un PNG pour le déplacer"}` : "Chargement de l’aperçu…";
  }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - rect.width / 2) / this.zoom + this.center.x,
      y: (event.clientY - rect.top - rect.height / 2) / this.zoom + this.center.y };
  }

  fit() {
    if (!this.entry) return;
    const target = this.entry.variant ?? this.entry;
    const original = this.images.original, translated = this.images.translated;
    const left = Math.min(-this.entry.originX, this.position.x - target.originX);
    const top = Math.min(-this.entry.originY, this.position.y - target.originY);
    const right = Math.max((original?.width ?? this.entry.width) - this.entry.originX,
      this.position.x - target.originX + (translated?.width ?? target.width));
    const bottom = Math.max((original?.height ?? this.entry.height) - this.entry.originY,
      this.position.y - target.originY + (translated?.height ?? target.height));
    this.center = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const available = Math.min((this.canvas.clientWidth - 48) / (right - left), (this.canvas.clientHeight - 48) / (bottom - top));
    this.zoom = [16, 8, 4, 2, 1, .5, .25, .125, .0625, .03125].find((zoom) => zoom <= available) ?? .03125;
    this.$("sprite-zoom").value = String(this.zoom);
    this.draw();
  }

  draw() {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    const ctx = this.canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.imageSmoothingEnabled = false;
    const background = this.$("sprite-background").value;
    ctx.fillStyle = background === "white" ? "#fff" : "#111";
    ctx.fillRect(0, 0, width, height);
    if (background === "checker") {
      ctx.fillStyle = "#24242c";
      for (let y = 0; y < height; y += 12) for (let x = 0; x < width; x += 12)
        if ((x / 12 + y / 12) % 2 === 0) ctx.fillRect(x, y, 12, 12);
    }
    if (!this.entry) return;
    const ox = Math.round(width / 2 - this.center.x * this.zoom), oy = Math.round(height / 2 - this.center.y * this.zoom);
    const drawImage = (image, x, y) => image && ctx.drawImage(image, ox + x * this.zoom, oy + y * this.zoom, image.width * this.zoom, image.height * this.zoom);
    const target = this.entry.variant ?? this.entry;
    if (this.$("sprite-overlay").checked) {
      ctx.globalAlpha = .3;
      drawImage(this.images.original, -this.entry.originX, -this.entry.originY);
      ctx.globalAlpha = 1;
    }
    drawImage(this.images.translated, this.position.x - target.originX, this.position.y - target.originY);
    if (this.$("sprite-grid").checked && this.zoom >= 4) {
      ctx.strokeStyle = "#80808055";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ((ox % this.zoom) + this.zoom) % this.zoom; x < width; x += this.zoom) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, height); }
      for (let y = ((oy % this.zoom) + this.zoom) % this.zoom; y < height; y += this.zoom) { ctx.moveTo(0, y + .5); ctx.lineTo(width, y + .5); }
      ctx.stroke();
    }
    ctx.strokeStyle = "#4eb9ff";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - this.entry.originX * this.zoom + .5, oy - this.entry.originY * this.zoom + .5, this.entry.width * this.zoom, this.entry.height * this.zoom);
    ctx.strokeStyle = "#ffb84e";
    ctx.beginPath(); ctx.moveTo(ox - 7, oy + .5); ctx.lineTo(ox + 7, oy + .5);
    ctx.moveTo(ox + .5, oy - 7); ctx.lineTo(ox + .5, oy + 7); ctx.stroke();
  }
}
