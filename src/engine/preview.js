// Rendu canvas fidèle des textbox de DELTARUNE Ch5
// Géométrie issue de : obj_dialoguer_Draw_0 / Other_10, scr_darkbox(_black),
// obj_battleblcon_Draw_0, scr_facechoice, obj_face_Draw_0
import { formatText, layoutText } from "./writer.js";

// Résolution des portraits (obj_face_Draw_0, branches chapitre 5 / ch > 1).
// Chaque entrée peut fournir :
//  - resolve(fe, dark) → liste de candidats {name, frame} essayés dans l'ordre
//  - ox/oy : offset de dessin (px écran, non multiplié par f)
//  - body : sprite dessiné derrière (Toriel)
// encode fe → suffixe des sprites énumérés des anciens chapitres (s0..s9, sA..sD)
const feSuffix = (fe) => (fe <= 9 ? String(fe) : String.fromCharCode(55 + fe));

const FACE_TABLE = {
  1: {
    ox: -5, oy: 0,
    resolve: (fe) => [
      { name: "spr_face_susie_alt", frame: fe },
      { name: `spr_face_s${feSuffix(fe)}`, frame: 0 }, // chapitre 1
    ],
  },
  2: {
    ox: -15, oy: -10,
    resolve: (fe, dark) => [
      { name: dark ? "spr_face_r_dark" : "spr_face_r_nohat", frame: fe },
      { name: "spr_face_r_nohat", frame: fe },
      { name: "spr_face_r_dark", frame: fe },
      { name: "spr_face_r_hood", frame: fe },
    ],
  },
  3: {
    ox: -12, oy: -10,
    resolve: (fe) => [
      { name: "spr_face_n_matome", frame: fe },
      { name: "spr_face_n_matome_extended", frame: fe },
      { name: `spr_face_n${feSuffix(fe)}`, frame: 0 }, // anciens chapitres
    ],
  },
  4: {
    ox: 0, oy: 0,
    body: { name: "spr_face_tbody", ox: -7, oy: 29 },
    resolve: (fe) =>
      fe <= 9
        ? [{ name: `spr_face_t${fe}`, frame: 0 }]
        : [{ name: "spr_face_toriel_matome_extended", frame: fe }],
  },
  5: { ox: -15, oy: -10, resolve: (fe) => [{ name: "spr_face_l0", frame: fe }] },
  6: {
    ox: 0, oy: 0,
    resolve: (fe) => [{ name: `spr_face_sans${Math.min(fe, 5)}`, frame: 0 }],
  },
  9: { ox: -10, oy: 0, resolve: (fe) => [{ name: "spr_face_undyne", frame: fe }] },
  10: {
    ox: -10, oy: 0,
    resolve: (fe, dark) => {
      const crown = dark ? "_crown" : "";
      return fe <= 8
        ? [
            { name: `spr_face_asgore${fe}${crown}`, frame: 0 },
            { name: `spr_face_asgore_matome${crown}`, frame: fe },
          ]
        : [{ name: `spr_face_asgore_matome${crown}`, frame: fe }];
    },
  },
  11: { ox: -10, oy: 0, resolve: (fe) => [{ name: "spr_alphysface", frame: fe }] },
  12: {
    ox: -10, oy: 0,
    resolve: (fe, dark) => [
      { name: dark ? "spr_face_berdly_dark" : "spr_face_berdly", frame: fe },
    ],
  },
  13: { ox: -10, oy: 0, resolve: (fe) => [{ name: "spr_face_catti", frame: fe }] },
  14: {
    ox: -10, oy: 0,
    resolve: (fe) => [
      { name: `spr_face_jock${Math.min(fe, 9)}`, frame: 0 },
      { name: "spr_face_jockington_matome_extended", frame: fe },
    ],
  },
  15: { ox: -12, oy: -10, resolve: (fe) => [{ name: "spr_face_rudy", frame: fe }] },
  16: { ox: -10, oy: 0, resolve: (fe) => [{ name: "spr_face_catty", frame: fe }] },
  17: { ox: -5, oy: 2, resolve: (fe) => [{ name: "spr_face_bratty", frame: fe }] },
  18: { ox: -10, oy: 0, resolve: (fe) => [{ name: "spr_face_rurus", frame: fe }] },
  19: { ox: -5, oy: -5, resolve: (fe) => [{ name: "spr_face_burgerpants", frame: fe }] },
  20: { ox: -5, oy: -5, resolve: (fe) => [{ name: "spr_face_king", frame: fe }] },
  21: { ox: 0, oy: 0, resolve: (fe) => [{ name: "spr_face_queen", frame: fe }] },
  22: { ox: -9, oy: -4, resolve: (fe) => [{ name: "spr_face_carol", frame: fe }] },
  23: { ox: 8, oy: 0, resolve: (fe) => [{ name: "spr_face_flowery", frame: fe }] },
  24: { ox: 1, oy: 6, resolve: (fe) => [{ name: "spr_face_flowery_d", frame: fe }] },
  25: {
    ox: -12, oy: -1,
    resolve: (fe) =>
      fe === 59
        ? [{ name: "spr_face_blank", frame: 0 }]
        : [{ name: "spr_face_blue", frame: fe }],
  },
};

const SPRITE_CACHE = new Map();

export class Preview {
  constructor(canvas, extractedDir, fonts, spriteFiles) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.extractedDir = extractedDir;
    this.fonts = fonts;
    this.spriteFiles = new Set(spriteFiles);
    this.jewelTimer = 0;
  }

  // exact=true : ne pas se replier sur la frame 0 si la frame demandée manque
  async sprite(name, frame = 0, exact = false) {
    let file = `${name}_${frame}.png`;
    if (!this.spriteFiles.has(file)) {
      if (exact) return null;
      file = `${name}_0.png`; // repli sur la frame 0
      if (!this.spriteFiles.has(file)) return null;
    }
    if (!SPRITE_CACHE.has(file)) {
      const img = new Image();
      img.src =
        "file:///" + (this.extractedDir + "/sprites/" + file).replace(/\\/g, "/");
      SPRITE_CACHE.set(
        file,
        img.decode().then(() => img).catch(() => null)
      );
    }
    return SPRITE_CACHE.get(file);
  }

  // -------------------------------------------------------------------------
  // Rendu principal. mode: darkbox | lightbox | bubble | battletext | plain
  // state: { fc, fe, typer, bubbleSide } hérité de la séquence
  // -------------------------------------------------------------------------
  async render(text, mode, state = {}) {
    this.jewelTimer++;
    switch (mode) {
      case "lightbox":
        return this.renderDialogue(text, state, { dark: false });
      case "bubble":
        return this.renderBubble(text, state);
      case "battletext":
        return this.renderDialogue(text, state, { dark: true, fight: true });
      case "plain":
        return this.renderPlain(text, state);
      case "darkbox":
      default:
        return this.renderDialogue(text, state, { dark: true });
    }
  }

  clear(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    return ctx;
  }

  checkerBg(ctx, c1, c2) {
    ctx.fillStyle = c1;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = c2;
    for (let gy = 0; gy < this.canvas.height; gy += 32)
      for (let gx = (gy / 32) % 2 ? 32 : 0; gx < this.canvas.width; gx += 64)
        ctx.fillRect(gx, gy, 32, 32);
  }

  drawOps(ctx, ops, ox, oy, scale) {
    for (const op of ops) {
      const font = this.fonts[op.font];
      if (!font) continue;
      let color = op.color;
      if (color && color.startsWith("RAINBOW:")) {
        const n = Number(color.slice(8));
        color = rainbowHex((((n * 20 + this.jewelTimer * 3) % 255) + 255) % 255);
      }
      font.drawChar(ctx, op.ch, ox + op.x * scale, oy + op.y * scale, color, scale);
    }
  }

  // --- Boîte de dialogue (monde sombre f=2 sur 640x480 ; monde clair f=1 sur
  //     320x240, upscalé x2 pour l'affichage)
  async renderDialogue(text, state, { dark = true, fight = false }) {
    const f = dark ? 2 : 1;
    const S = dark ? 1 : 2; // upscale d'affichage du monde clair
    const ctx = this.clear(320 * f * S, 240 * f * S);
    ctx.save();
    ctx.scale(S, S);

    this.checkerBg(ctx, dark ? "#151020" : "#1a2c20", "rgba(255,255,255,0.025)");

    const initialFc = state.fc || 0;
    const typer = state.typer || (fight ? 47 : dark ? 6 : 5);

    // formatage (word-wrap)
    const fmt = formatText(text, {
      charline: 33,
      dialoguer: !fight,
      battle: fight,
      initialFc,
    });

    // --- boîte (obj_dialoguer_Draw_0, side = 1 : en bas) ---
    const boxheight = 3;
    let boxRight, boxBottom;
    if (dark) {
      const sidemod = 310;
      const x0 = 24,
        y0 = 2 + sidemod,
        x1 = 24 + 592,
        y1 = 168 - 108 + 36 * boxheight + sidemod;
      await this.drawDarkBox(ctx, x0, y0, x1, y1);
      boxRight = x1;
      boxBottom = y1;
    } else {
      const sidemod = 155;
      // bordure (c_border blanc) puis intérieur (c_inner noir)
      const hei = 80 - 54 + 18 * boxheight + sidemod - (5 + sidemod);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(16, 5 + sidemod, 288 + 1, hei + 1);
      const wid = 13 + 288 - 19;
      const hei2 = 77 - 54 + 18 * boxheight + sidemod - (8 + sidemod);
      ctx.fillStyle = "#000000";
      ctx.fillRect(19, 8 + sidemod, wid + 1, hei2 + 1);
      boxRight = 305;
      boxBottom = 236;
    }

    // --- writer (obj_dialoguer Other_10, side = 1) ---
    const writerX = 19 * f + 10 * f;
    const writerY = 20 * f + (-5 + 155) * f;

    const lay = layoutText(fmt.text, {
      typer,
      dark,
      fight,
      writingx: writerX,
      writingy: writerY,
      faceXShift: 58 * f,
      initialFc,
      initialFe: state.fe || 0,
    });

    // --- portrait (scr_facechoice : writer + (8f, 5f)) ---
    let faceExact = true;
    if (lay.fc !== 0) {
      const r = await this.drawFace(
        ctx, lay.fc, lay.fe, writerX + 8 * f, writerY + 5 * f, f, dark
      );
      faceExact = r.exact;
    }

    this.drawOps(ctx, lay.ops, 0, 0, 1);
    ctx.restore();

    const warnings = [...lay.warnings];
    if (!faceExact)
      warnings.push(`⚠ Expression ${lay.fe} introuvable pour ce visage — frame 0 affichée`);
    if (lay.maxX > boxRight - 8) warnings.push("⚠ Le texte déborde à droite de la boîte");
    if (lay.maxY + lay.vspace > boxBottom) warnings.push("⚠ Trop de lignes pour la boîte");

    return {
      warnings,
      lines: lay.lines,
      fc: lay.fc,
      fe: lay.fe,
      mode: dark ? (fight ? "battletext" : "darkbox") : "lightbox",
    };
  }

  // --- Bulle de combat (obj_battleblcon, auto_length = 1)
  async renderBubble(text, state) {
    const ctx = this.clear(640, 480);
    this.checkerBg(ctx, "#000000", "#0d0d16");

    const typer = state.typer || 50; // dotumche noir 9/20
    const fmt = formatText(text, { charline: 33, battle: true, initialFc: 0 });
    const lay = layoutText(fmt.text, {
      typer,
      dark: true,
      fight: true,
      writingx: 0,
      writingy: 0,
      initialFc: 0,
    });

    // balloonwidth/height (obj_battleblcon_Draw_0)
    const bw = fmt.stringmax * lay.hspace + 10;
    const bh = (fmt.linecount + 1) * lay.vspace + 5;

    // ancre de la bulle (position type ennemi)
    const side = state.bubbleSide === -1 ? -1 : 1;
    const anchorX = side === 1 ? 480 : 160;
    const anchorY = 150;
    const initX = anchorX + 5;
    const initY = anchorY + 3;
    let writingx = side === 1 ? initX - (bw + 20) : initX + 20;
    const writingy = initY - bh / 2;

    // bulle blanche : deux rectangles superposés (comme le jeu)
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(writingx - 10, writingy - 5, bw + 10, bh);
    ctx.fillRect(writingx - 5, writingy - 10, bw, bh + 10);

    // queue (spr_battleblcon_parts frame 4)
    const tail = await this.sprite("spr_battleblcon_parts", 4);
    const blconscale = bh < 40 ? 0.5 : 1;
    if (tail) {
      ctx.save();
      if (side === 1) {
        ctx.translate(anchorX, anchorY);
        ctx.scale(1, blconscale);
      } else {
        ctx.translate(anchorX - 20, anchorY);
        ctx.scale(-1, blconscale);
      }
      ctx.drawImage(tail, 0, 0);
      ctx.restore();
    }

    this.drawOps(ctx, lay.ops, writingx, writingy, 1);

    const warnings = [...lay.warnings];
    if (bw > 330) warnings.push(`⚠ Bulle très large (${bw}px) — pense à couper avec &`);
    if (writingx < 10) warnings.push("⚠ La bulle sort de l'écran à gauche");
    return { warnings, lines: lay.lines, fc: 0, fe: 0, mode: "bubble" };
  }

  // --- Texte libre (menus, strings)
  async renderPlain(text, state) {
    const typer = state.typer || 5;
    const fmt = formatText(text, { charline: 999, initialFc: 0 });
    const lay = layoutText(fmt.text, {
      typer,
      writingx: 0,
      writingy: 0,
      initialFc: 0,
    });
    const scale = 2;
    const w = Math.min(1280, Math.max(320, lay.maxX + 16) * scale);
    const h = Math.max(48, (lay.maxY + lay.vspace + 8) * scale);
    const ctx = this.clear(w, h);
    for (let gy = 0; gy < h; gy += 16)
      for (let gx = 0; gx < w; gx += 16) {
        ctx.fillStyle = (gx / 16 + gy / 16) % 2 ? "#26262e" : "#1e1e26";
        ctx.fillRect(gx, gy, 16, 16);
      }
    this.drawOps(ctx, lay.ops, 8, 8, scale);
    return { warnings: lay.warnings, lines: lay.lines, fc: 0, fe: 0, mode: "plain" };
  }

  // --- Boîte du monde sombre (scr_darkbox_black + scr_darkbox)
  async drawDarkBox(ctx, x0, y0, x1, y1) {
    // fond noir (d_rectangle(x0+20, y0+20, x1-20, y1-20))
    ctx.fillStyle = "#000000";
    ctx.fillRect(x0 + 20, y0 + 20, x1 - x0 - 40, y1 - y0 - 40);

    const top = await this.sprite("spr_textbox_top", 0);
    const left = await this.sprite("spr_textbox_left", 0);
    const jewelFrame = Math.floor(this.jewelTimer / 3) % 3;
    const corner = await this.sprite("spr_textbox_topleft", jewelFrame);

    const tw = x1 - x0 - 63; // textbox_width
    const th = y1 - y0 - 63; // textbox_height

    if (top && tw > 0) {
      // haut : draw_sprite_stretched(…, x0+32, y0, tw, 32)
      ctx.drawImage(top, x0 + 32, y0, tw, 32);
      // bas : draw_sprite_ext(…, x0+32, y1+1, xscale=tw, yscale=-2)
      ctx.save();
      ctx.translate(x0 + 32, y1 + 1);
      ctx.scale(1, -1);
      ctx.drawImage(top, 0, 0, tw, top.height * 2);
      ctx.restore();
    }
    if (left && th > 0) {
      const lw = left.width;
      // droite : xscale = -2 à (x1+1) ; gauche : xscale = 2 à x0 ; hauteur = th
      ctx.save();
      ctx.translate(x1 + 1, y0 + 32);
      ctx.scale(-1, 1);
      ctx.drawImage(left, 0, 0, lw * 2, th);
      ctx.restore();
      ctx.drawImage(left, x0, y0 + 32, lw * 2, th);
    }
    if (corner) {
      const cw = corner.width * 2;
      const chh = corner.height * 2;
      ctx.drawImage(corner, x0, y0, cw, chh);
      ctx.save();
      ctx.translate(x1 + 1, y0);
      ctx.scale(-1, 1);
      ctx.drawImage(corner, 0, 0, cw, chh);
      ctx.restore();
      ctx.save();
      ctx.translate(x0, y1 + 1);
      ctx.scale(1, -1);
      ctx.drawImage(corner, 0, 0, cw, chh);
      ctx.restore();
      ctx.save();
      ctx.translate(x1 + 1, y1 + 1);
      ctx.scale(-1, -1);
      ctx.drawImage(corner, 0, 0, cw, chh);
      ctx.restore();
    }
  }

  // --- Portrait (obj_face_Draw_0, branches chapitre 5)
  // fx, fy : position de l'instance obj_face ; f : échelle du sprite
  // Retourne {exact} — false si l'expression demandée n'existe pas telle quelle.
  async drawFace(ctx, fc, fe, fx, fy, f, dark = true) {
    const spec = FACE_TABLE[fc];
    if (!spec) return { exact: false };
    let img = null;
    let exact = true;
    for (const cand of spec.resolve(fe ?? 0, dark)) {
      img = await this.sprite(cand.name, cand.frame, true);
      if (img) break;
    }
    if (!img) {
      exact = false;
      for (const cand of spec.resolve(0, dark)) {
        img = await this.sprite(cand.name, 0);
        if (img) break;
      }
    }
    if (!img) img = await this.sprite("spr_face_placeholder", 0);
    if (!img) return { exact: false };
    if (spec.body) {
      const body = await this.sprite(spec.body.name, 0);
      if (body)
        ctx.drawImage(
          body,
          Math.round(fx + spec.body.ox),
          Math.round(fy + spec.body.oy),
          body.width * f,
          body.height * f
        );
    }
    ctx.drawImage(
      img,
      Math.round(fx + spec.ox),
      Math.round(fy + spec.oy),
      img.width * f,
      img.height * f
    );
    return { exact };
  }
}

function rainbowHex(v255) {
  const h = (v255 / 255) * 360;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = Math.round(255 * (1 - Math.max(-1, Math.min(k - 3, 9 - k, 1)) * 0.5));
    return c.toString(16).padStart(2, "0");
  };
  return "#" + f(0) + f(8) + f(4);
}
