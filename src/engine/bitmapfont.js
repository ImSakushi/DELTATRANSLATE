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
    if (!g || g.w === 0) return;
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

  hasChar(ch) {
    return this.glyphs.has(ch.codePointAt(0));
  }
}

export async function loadFonts(extractedDir, fontCsvs) {
  const wanted = ["main", "mainbig", "dotumche", "comicsans", "small", "tinynoelle", "8bit"];
  const fonts = {};
  await Promise.all(
    wanted.map(async (short) => {
      const full = "fnt_" + short;
      const csv = fontCsvs[full];
      if (!csv) return;
      const img = new Image();
      img.src = "file:///" + (extractedDir + "/fonts/" + full + ".png").replace(/\\/g, "/");
      await img.decode().catch(() => {});
      fonts[short] = new BitmapFont(short, img, csv);
    })
  );
  return fonts;
}
