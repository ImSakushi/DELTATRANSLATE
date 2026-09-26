// Fonts bitmap extraites du jeu (PNG + CSV de glyphes UTMT)
// CSV : ligne 1 = DisplayName;EmSize;Bold;Italic;Charset;AA;ScaleX;ScaleY
//       lignes suivantes = charCode;srcX;srcY;srcW;srcH;shift;offset

export class BitmapFont {
  constructor(name, image, csvText) {
    this.name = name;
    this.image = image;
    this.glyphs = new Map();
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== "");
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(";");
      if (p.length < 7) continue;
      this.glyphs.set(Number(p[0]), {
        x: Number(p[1]),
        y: Number(p[2]),
        w: Number(p[3]),
        h: Number(p[4]),
        shift: Number(p[5]),
        offset: Number(p[6]),
      });
    }
    this._tintCache = new Map();
    this.missingGlyphs = new Set();
  }

  // Canvas de la texture teintée (les glyphes du jeu sont blancs)
  tinted(color) {
    if (color === "#FFFFFF" || !color) return this.image;
    let c = this._tintCache.get(color);
    if (!c) {
      c = document.createElement("canvas");
      c.width = this.image.width;
      c.height = this.image.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(this.image, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      this._tintCache.set(color, c);
      if (this._tintCache.size > 24) {
        const first = this._tintCache.keys().next().value;
        this._tintCache.delete(first);
      }
    }
    return c;
  }

  drawChar(ctx, ch, x, y, color, scale = 1) {
    const g = this.glyphs.get(ch.codePointAt(0));
    if (!g) { if (ch.trim()) this.missingGlyphs.add(ch); return; }
    if (g.w === 0) return;
    const src = this.tinted(color);
    ctx.drawImage(
      src,
      g.x,
      g.y,
      g.w,
      g.h,
      Math.round(x + g.offset * scale),
      Math.round(y),
      g.w * scale,
      g.h * scale
    );
  }

  // draw_text de GameMaker utilise l'avance propre à chaque glyphe, à la
  // différence du writer principal qui force hspace.
  drawText(ctx, text, x, y, color, scale = 1, lineHeight = 16) {
    const startX = x;
    let dx = x;
    let dy = y;
    for (const ch of String(text).replaceAll("#", "\n")) {
      if (ch === "\r") continue;
      if (ch === "\n") {
        dx = startX;
        dy += lineHeight * scale;
        continue;
      }
      const glyph = this.glyphs.get(ch.codePointAt(0));
      this.drawChar(ctx, ch, dx, dy, color, scale);
      dx += (glyph?.shift ?? 0) * scale;
    }
  }

  hasChar(ch) {
    return this.glyphs.has(ch.codePointAt(0));
  }
}

export async function loadFonts(extractedDir, fontCsvs, language = "fr") {
  const wanted = ["main", "mainbig", "dotumche", "comicsans", "small", "tinynoelle", "8bit"];
  const fonts = {};
  Object.defineProperty(fonts, "loadWarnings", { value: [] });
  const revision = Date.now();
  await Promise.all(
    wanted.map(async (short) => {
      // scr_84_init_localization : les polices japonaises utilisent le préfixe ja_.
      const translated = language === "ja" ? "fnt_ja_" + short : "fnt_" + short + "_" + language;
      if (language === "ja" && !fontCsvs[translated]) {
        fonts.loadWarnings.push(`Police japonaise ${translated} absente. Utilise « Actualiser les polices ».`);
        return;
      }
      const full = fontCsvs[translated] ? translated : "fnt_" + short;
      const csv = fontCsvs[full];
      if (!csv) return;
      const img = new Image();
      const filePath = (extractedDir + "/fonts/" + full + ".png").replace(/\\/g, "/");
      img.src = "file://" + (filePath.startsWith("/") ? "" : "/") +
        filePath.split("/").map(part => encodeURIComponent(part).replace(/%3A/gi, ":")).join("/") + `?v=${revision}`;
      try { await img.decode(); }
      catch {
        fonts.loadWarnings.push(`Police ${full} illisible. Utilise « Actualiser les polices ».`);
        return;
      }
      fonts[short] = new BitmapFont(short, img, csv);
    })
  );
  return fonts;
}
