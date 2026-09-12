// Rendu canvas fidèle des textbox de DELTARUNE Ch5
// Géométrie issue de : obj_dialoguer_Draw_0 / Other_10, scr_darkbox(_black),
// obj_battleblcon_Draw_0, scr_facechoice, obj_face_Draw_0
import { applyLanguageTypography, formatText, layoutText } from "./writer.js";
import { classicChoiceLayout, neoChoiceLayout } from "./choice.js";

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
    resolve: (fe, dark, variant) => {
      const hat = variant === "ralsei-hat" || (variant !== "ralsei-nohat" && dark);
      return [
        { name: hat ? "spr_face_r_dark" : "spr_face_r_nohat", frame: fe },
        { name: hat ? "spr_face_r_nohat" : "spr_face_r_dark", frame: fe },
        { name: "spr_face_r_hood", frame: fe },
      ];
    },
  },
  3: {
    ox: -12, oy: -10,
    resolve: (fe, _dark, variant) =>
      variant === "noelle-extended"
        ? [{ name: "spr_face_n_matome_extended", frame: fe }]
        : [
            { name: "spr_face_n_matome", frame: fe },
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

// scr_smallface : banque de sprites utilisée par les portraits secondaires.
const SMALL_FACE_SPRITES = {
  susie: "spr_face_susie_alt",
  ralsei: "spr_face_r_nohat",
  lancer: "spr_face_l0",
  noelle: "spr_face_n_matome",
  noelle_cropped: "spr_face_n_matome_cropped",
  queen: "spr_face_queen",
  rouxls: "spr_face_rurus",
  berdly: "spr_face_berdly_dark",
  rudy: "spr_face_rudy",
  flowery: "spr_face_flowery",
  toriel: "spr_face_t0",
  opuppet: "spr_miniface_orange",
};

// Banques global.writerimg préparées par scr_miniface_init_*.
// La banque flowers vient de face_list dans le GML (IDs résolus via la liste
// des sprites UTMT) ; les autres affectent directement les noms de sprites.
const MINI_FACE_BANKS = {
  flowers: [
    "spr_miniface_aqua",
    "spr_miniface_seth",
    "spr_miniface_orange",
    "spr_miniface_green",
    "spr_miniface_yellow",
    "spr_miniface_blue",
  ],
  aquaseth: [null, "spr_miniface_aqua", "spr_miniface_seth"],
  sweet: [null, "spr_miniface_sweet", "spr_miniface_kk", "spr_miniface_capn"],
  clover: [
    null,
    "spr_miniface_clover_happy",
    "spr_miniface_clover_mad",
    "spr_miniface_clover_sad",
  ],
};

// obj_pinkspeaker Create_0 : global.fe indexe cette table. Les poses de fin
// remplacent le sprite principal lorsque le writer est en pause (halt > 0).
const PINK_SPEAKER_EXPRESSIONS = [
  { name: "spr_pinkspeaker_silhouette", frame: 0 },
  { name: "spr_pinkspeaker_talk", frame: 0, tail: true },
  { name: "spr_pinkspeaker_concerned", frame: 0, tail: true },
  { name: "spr_pinkspeaker_tongue", frame: 0 },
  { name: "spr_pinkspeaker_nya", frame: 1 },
  { name: "spr_pinkspeaker_nya2", frame: 1 },
  { name: "spr_pinkspeaker_talk_happy", frame: 16, tail: true },
  { name: "spr_pinkspeaker_angry", frame: 0 },
  { name: "spr_pinkspeaker_wink", frame: 0, tail: true },
  { name: "spr_pinkspeaker_cry", frame: 0, animate: true },
  { name: "spr_pinkspeaker_sad", frame: 0, halt: "spr_pinkspeaker_sad_end" },
  { name: "spr_pinkspeaker_angry", frame: 0, tears: true },
  {
    name: "spr_pinkspeaker_happytearful",
    frame: 1,
    halt: "spr_pinkspeaker_happytearful_end",
  },
  {
    name: "spr_pinkspeaker_happycry",
    frame: 1,
    halt: "spr_pinkspeaker_happycry_end",
  },
  { name: "spr_pinkspeaker_overjoyed", frame: 0, animate: true },
  { name: "spr_pinkspeaker_shocked", frame: 0, animate: true },
  { name: "spr_pinkspeaker_exploded", frame: 0 },
  { name: "spr_pinkspeaker_angryblush", frame: 0 },
];

const SPRITE_CACHE = new Map();
const SCENE_CACHE = new Map();
const TINTED_SPRITE_CACHE = new Map();

export class Preview {
  constructor(canvas, extractedDir, fonts, spriteFiles, spriteMeta = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.extractedDir = extractedDir;
    this.fonts = fonts;
    this.spriteFiles = new Set(spriteFiles);
    this.spriteMeta = spriteMeta;
    this.jewelTimer = 0;
  }

  // exact=true : ne pas se replier sur la frame 0 si la frame demandée manque
  async sprite(name, frame = 0, exact = false) {
    const variant = `${name}_${this.language}`;
    if (this.language && !["en", "ja"].includes(this.language) &&
        (this.spriteFiles.has(`${variant}_${frame}.png`) || this.spriteFiles.has(`${variant}_0.png`))) name = variant;
    let file = `${name}_${frame}.png`;
    if (!this.spriteFiles.has(file)) {
      if (exact) return null;
      file = `${name}_0.png`; // repli sur la frame 0
      if (!this.spriteFiles.has(file)) return null;
    }
    const cacheKey = this.extractedDir + "/" + file;
    if (!SPRITE_CACHE.has(cacheKey)) {
      const img = new Image();
      img.src =
        "file:///" + (this.extractedDir + "/sprites/" + file).replace(/\\/g, "/");
      SPRITE_CACHE.set(
        cacheKey,
        img.decode().then(() => img).catch(() => null)
      );
    }
    return SPRITE_CACHE.get(cacheKey);
  }

  async sceneImage(file) {
    if (!file) return null;
    if (!SCENE_CACHE.has(file)) {
      const img = new Image();
      img.src = "file:///" + (this.extractedDir + "/" + file).replace(/\\/g, "/");
      SCENE_CACHE.set(file, img.decode().then(() => img).catch(() => null));
    }
    return SCENE_CACHE.get(file);
  }

  // -------------------------------------------------------------------------
  // Rendu principal. mode: darkbox | lightbox | platform | shop | bubble | battletext | trial | plain
  // state: { fc, fe, typer, bubbleSide } hérité de la séquence
  // -------------------------------------------------------------------------
  async render(text, mode, state = {}) {
    this.language = state.language ?? "en";
    this.jewelTimer++;
    text = applyLanguageTypography(text, state.language);
    if (state.choiceOptions) {
      state = {
        ...state,
        choiceOptions: state.choiceOptions.map((option) =>
          applyLanguageTypography(option, state.language)
        ),
      };
    }
    if (state.smallFace) {
      state = {
        ...state,
        smallFace: {
          ...state.smallFace,
          text: applyLanguageTypography(state.smallFace.text, state.language),
          dialogueText: applyLanguageTypography(state.smallFace.dialogueText, state.language),
        },
      };
      if (mode === "platform")
        return this.renderPlatformDialogue(state.smallFace.dialogueText, state);
      return this.renderDialogue(state.smallFace.dialogueText, state, { dark: true });
    }
    switch (mode) {
      case "shop":
        return this.renderShop(text, state);
      case "lightbox":
        return this.renderDialogue(text, state, { dark: false });
      case "platform":
        return this.renderPlatformDialogue(text, state);
      case "bubble":
        return this.renderBubble(text, state);
      case "battletext":
        return this.renderBattleText(text, state);
      case "trial":
        return this.renderTrialCase(text, state);
      case "device":
        return this.renderDevice(text, state);
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

  async drawSceneBackground(ctx, scene, dark) {
    const img = await this.sceneImage(scene?.image);
    if (!img) return false;
    if (dark) {
      ctx.drawImage(img, 0, 0);
      return true;
    }

    // Les vues extraites couvrent 640×480 autour de l'instance. Le monde
    // clair emploie une caméra 320×240 : on recadre cette même vue autour du
    // point exact de l'instance, puis le canvas l'agrandit ×2.
    const roomWidth = Number(scene.roomWidth) || img.width;
    const roomHeight = Number(scene.roomHeight) || img.height;
    const wantedX = Math.max(0, Math.min((Number(scene.focusX) || 0) - 160, roomWidth - 320));
    const wantedY = Math.max(0, Math.min((Number(scene.focusY) || 0) - 120, roomHeight - 240));
    const sourceX = Math.max(0, Math.min(wantedX - (Number(scene.cameraX) || 0), img.width - 320));
    const sourceY = Math.max(0, Math.min(wantedY - (Number(scene.cameraY) || 0), img.height - 240));
    ctx.drawImage(img, sourceX, sourceY, 320, 240, 0, 0, 320, 240);
    return true;
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
      const x = ox + op.x * scale;
      const y = oy + op.y * scale;
      if (op.special === 2) {
        // obj_writer Draw_0, special == 2 : glyphe plein, quatre copies
        // cardinales puis quatre diagonales avec une alpha plus faible.
        const pulse = Math.sin(this.jewelTimer / 14);
        const baseAlpha = ctx.globalAlpha;
        font.drawChar(ctx, op.ch, x, y, color, scale);
        ctx.globalAlpha = baseAlpha * (0.3 + pulse * 0.1);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          font.drawChar(ctx, op.ch, x + dx * scale, y + dy * scale, color, scale);
        ctx.globalAlpha = baseAlpha * (0.08 + pulse * 0.04);
        for (const [dx, dy] of [[1, 1], [-1, -1], [-1, 1], [1, -1]])
          font.drawChar(ctx, op.ch, x + dx * scale, y + dy * scale, color, scale);
        ctx.globalAlpha = baseAlpha;
      } else {
        font.drawChar(ctx, op.ch, x, y, color, scale);
      }
    }
  }

  // draw_sprite_ext : la position GameMaker correspond à l'origine du sprite,
  // pas à son coin supérieur gauche.
  async drawGameSprite(
    ctx,
    name,
    frame,
    x,
    y,
    xscale = 1,
    yscale = xscale,
    angle = 0,
    { exact = false, alpha = 1, filter = "none" } = {}
  ) {
    const img = await this.sprite(name, frame, exact);
    if (!img) return false;
    const meta = this.spriteMeta[name] ?? {};
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = filter;
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate((angle * Math.PI) / 180);
    ctx.scale(xscale, yscale);
    ctx.drawImage(img, -(meta.originX ?? 0), -(meta.originY ?? 0));
    ctx.restore();
    return true;
  }

  async tileSprite(ctx, name, offsetX, offsetY, width, height, alpha = 1) {
    const img = await this.sprite(name, 0, true);
    if (!img) return;
    const startX = ((offsetX % img.width) + img.width) % img.width - img.width;
    const startY = ((offsetY % img.height) + img.height) % img.height - img.height;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let y = startY; y < height; y += img.height) {
      for (let x = startX; x < width; x += img.width) ctx.drawImage(img, x, y);
    }
    ctx.restore();
  }

  async tintedSprite(name, frame, color) {
    const key = `${name}:${frame}:${color}`;
    if (TINTED_SPRITE_CACHE.has(key)) return TINTED_SPRITE_CACHE.get(key);
    const image = await this.sprite(name, frame);
    if (!image) return null;
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    // draw_sprite_ext(..., color, ...) multiplie la couleur propre du sprite
    // par la teinte du writer ; les mini-visages ch5 ne sont pas blancs.
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = color || "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(image, 0, 0);
    TINTED_SPRITE_CACHE.set(key, canvas);
    return canvas;
  }

  // obj_writer Draw_0, tag \mN : global.writerimg[N] à
  // (writingx - 8, wy - 4), scale 2 et teinte mycolor.
  async drawMiniFaces(ctx, miniFaces, bankName, ox = 0, oy = 0, scale = 1) {
    if (!miniFaces?.length) return [];
    const warnings = [];
    const bank = MINI_FACE_BANKS[bankName];
    if (!bank) return [`⚠ Banque de mini-visages inconnue : ${bankName || "non détectée"}`];

    for (const face of miniFaces) {
      const name = bank[face.index];
      if (!name) {
        warnings.push(`⚠ Mini-visage \\m${face.index} absent de la banque ${bankName}`);
        continue;
      }
      const frames = this.spriteMeta[name]?.frames ?? 1;
      const frame = frames > 1 ? Math.floor(this.jewelTimer / 8) % frames : 0;
      const image = await this.tintedSprite(name, frame, face.color);
      if (!image) {
        warnings.push(`⚠ Sprite ${name} introuvable`);
        continue;
      }
      ctx.drawImage(
        image,
        Math.round(ox + face.x * scale),
        Math.round(oy + face.y * scale),
        image.width * 2 * scale,
        image.height * 2 * scale
      );
    }
    return warnings;
  }

  // obj_pinkspeaker Draw_0 : instance à (camera droite - 224,
  // camera bas - sprite_height), échelle 2. La queue est derrière le corps,
  // puis viennent la goutte de sueur et les larmes.
  async drawSpeakerOverlay(ctx, overlay, expression) {
    if (!overlay || overlay.kind !== "pinkspeaker") return [];
    const fe = Number(expression) || Number(overlay.expression) || 0;
    if (fe === 0) return [];
    const spec = PINK_SPEAKER_EXPRESSIONS[Math.min(fe, PINK_SPEAKER_EXPRESSIONS.length - 1)];
    if (!spec) return [`⚠ Expression ${fe} inconnue pour le portrait de Mad Mew Mew`];

    const x = 640 - 224;
    // obj_pinkspeaker fixe image_yscale à 2 dans Create_0, puis les scènes
    // utilisent `camera_bottom - pinkface.sprite_height`. sprite_height inclut
    // cette échelle dans GameMaker : 116 × 2, et non 116 px.
    const baseHeight = this.spriteMeta.spr_pinkspeaker_silhouette?.height || 116;
    const y = 480 - baseHeight * 2;
    if (spec.tail) {
      const tailFrames = this.spriteMeta.spr_pinkspeaker_tail?.frames ?? 1;
      const tailFrame = Math.floor(this.jewelTimer / 5) % Math.max(1, tailFrames);
      await this.drawGameSprite(ctx, "spr_pinkspeaker_tail", tailFrame, x + 2, y, 2, 2, 0, {
        exact: true,
      });
    }

    const bodyName = spec.halt ?? spec.name;
    const bodyFrames = this.spriteMeta[bodyName]?.frames ?? 1;
    const bodyFrame =
      spec.halt || spec.animate
        ? Math.floor(this.jewelTimer / 5) % Math.max(1, bodyFrames)
        : spec.frame % Math.max(1, bodyFrames);
    const bodyDrawn = await this.drawGameSprite(ctx, bodyName, bodyFrame, x, y, 2, 2, 0, {
      exact: true,
    });
    if (!bodyDrawn) return [`⚠ Sprite ${bodyName} introuvable`];

    if (overlay.sweat) {
      await this.drawGameSprite(ctx, "spr_pinkspeaker_sweatdrop", 2, x, y, 2, 2, 0, {
        exact: true,
      });
    }
    if (spec.tears) {
      const tearFrames = this.spriteMeta.spr_pinkspeaker_tears?.frames ?? 1;
      const tearFrame = Math.floor(this.jewelTimer / 5) % Math.max(1, tearFrames);
      await this.drawGameSprite(ctx, "spr_pinkspeaker_tears", tearFrame, x - 2, y + 40, 2, 2, 0, {
        exact: true,
      });
    }
    return [];
  }

  // obj_shop1 Draw_0 : décor Seam ×2, vendeur à (160,34), puis la grande
  // boîte scr_darkbox_black(0,240,640,480) et writer à (30,270).
  async renderShop(text, state = {}) {
    const fmt = formatText(text, {
      charline: state.shopCharline ?? 33,
      initialFc: 0,
    });
    const lay = layoutText(fmt.text, {
      typer: state.typer ?? 6,
      dark: true,
      writingx: 30,
      writingy: 270,
      initialFc: 0,
    });
    const ctx = this.clear(640, 480);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 640, 480);
    // Le décor est une couche optionnelle : la géométrie du mode shop ne
    // dépend jamais de la présence d'un vendeur particulier.
    if (state.scene === "shop-seam") {
      await this.drawGameSprite(ctx, "bg_seam_shop_ch2", 0, 0, 0, 2);
      const seamSprites = [
        "spr_seam_talk",
        "spr_seam_oh",
        "spr_seam_laugh",
        "spr_seam_impatient",
      ];
      await this.drawGameSprite(
        ctx,
        seamSprites[lay.fe] ?? "spr_seam_talk",
        Math.floor(this.jewelTimer / 8) % 2,
        160,
        34,
        2
      );
    }
    await this.drawDarkBox(ctx, 0, 240, 640, 480);
    const miniFaceWarnings = await this.drawMiniFaces(
      ctx,
      lay.miniFaces,
      state.miniFaceBank
    );
    this.drawOps(ctx, lay.ops, 0, 0, 1);

    const warnings = [...lay.warnings, ...miniFaceWarnings];
    if (lay.maxX > 632) warnings.push("⚠ Le texte déborde à droite de la boîte");
    if (lay.maxY + lay.vspace > 472) warnings.push("⚠ Trop de lignes pour la boîte du shop");
    return { warnings, lines: lay.lines, fc: 0, fe: lay.fe, mode: "shop" };
  }

  async drawTrashyBallperson(ctx, timer = 0) {
    const rad = (degrees) => (degrees * Math.PI) / 180;
    const ldx = (length, degrees) => Math.cos(rad(degrees)) * length;
    const ldy = (length, degrees) => -Math.sin(rad(degrees)) * length;
    const center = [120, 124 + Math.sin(timer * 0.1) * 2];
    const footLeft = [120 + ldx(90, 255), 120 + ldy(90, 255)];
    const footRight = [120 + ldx(90, 285), 120 + ldy(90, 285)];
    const assRight = [center[0] + 10, center[1]];
    const assLeft = [center[0] - 10, center[1]];
    const torso = [
      center[0] + Math.cos(timer * 0.05) * 6,
      center[1] - 25 + Math.sin(timer * 0.1) * 2,
    ];
    const shoulderAngle = Math.sin(timer * 0.05) * 6;
    const shoulderRight = [
      torso[0] + ldx(25, -10 - shoulderAngle),
      torso[1] + ldy(25, -10 - shoulderAngle),
    ];
    const shoulderLeft = [
      torso[0] + ldx(25, 190 + shoulderAngle),
      torso[1] + ldy(25, 190 + shoulderAngle),
    ];
    const handRight = [
      shoulderRight[0] + ldx(25, -40 - shoulderAngle),
      shoulderRight[1] + ldy(25, -40 - shoulderAngle),
    ];
    const handLeft = [
      shoulderLeft[0] + ldx(25, 220 + shoulderAngle),
      shoulderLeft[1] + ldy(25, 220 + shoulderAngle),
    ];
    const headAngle = 110 + Math.sin(timer * 0.05) * 10;
    const head = [torso[0] + ldx(30, headAngle), torso[1] + ldy(30, headAngle)];
    // Les pieds sont à 90 px du bassin et les deux segments font 45 px :
    // dans le GML, les genoux sont donc exactement à mi-chemin.
    const kneeLeft = [(center[0] + footLeft[0]) / 2, (center[1] + footLeft[1]) / 2];
    const kneeRight = [(center[0] + footRight[0]) / 2, (center[1] + footRight[1]) / 2];

    const surfaceX = 516 - 120;
    const surfaceY = 167 - 120;
    const xoff = surfaceX - 22;
    const yoff = surfaceY - 18;
    const mix = (a, b, amountA) => a * amountA + b * (1 - amountA);
    const part = (point, name = "spr_ballperson_battle") =>
      this.drawGameSprite(ctx, name, 0, point[0] + xoff, point[1] + yoff, 2);

    await part(handLeft);
    await part(shoulderLeft);
    await part([mix(footLeft[0], kneeLeft[0], 0.75), mix(footLeft[1], kneeLeft[1], 0.75)]);
    await part([mix(footLeft[0], kneeLeft[0], 0.25), mix(footLeft[1], kneeLeft[1], 0.25)]);
    await part([mix(kneeLeft[0], assLeft[0], 0.75), mix(kneeLeft[1], assLeft[1], 0.75)]);
    await part([mix(kneeLeft[0], assLeft[0], 0.25), mix(kneeLeft[1], assLeft[1], 0.25)]);
    await part([center[0], center[1] - 5]);
    await part(torso);
    await part(head, "spr_ballperson_battle_wig");
    await part([mix(assRight[0], kneeRight[0], 0.75), mix(assRight[1], kneeRight[1], 0.75)]);
    await part([mix(assRight[0], kneeRight[0], 0.25), mix(assRight[1], kneeRight[1], 0.25)]);
    await part([mix(kneeRight[0], footRight[0], 0.75), mix(kneeRight[1], footRight[1], 0.75)]);
    await part([mix(kneeRight[0], footRight[0], 0.25), mix(kneeRight[1], footRight[1], 0.25)]);
    await part(shoulderRight);
    await part(handRight);
  }

  async drawSmallNumber(ctx, text, rightX, y) {
    const chars = "0123456789-+";
    const value = String(text);
    let x = rightX - value.length * 8;
    for (const ch of value) {
      const frame = chars.indexOf(ch);
      if (frame >= 0) await this.drawGameSprite(ctx, "spr_numbersfontsmall", frame, x, y);
      x += 8;
    }
  }

  async drawBattleHud(ctx, hp = {}) {
    const boundary = "#351435";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 325, 640, 155);
    ctx.fillStyle = boundary;
    ctx.fillRect(0, 325, 640, 3);
    ctx.fillRect(0, 362, 640, 3);

    const party = [
      { chunk: 0, head: "spr_headkris", headFrame: 6, name: "spr_bnamekris", hp: hp.kris ?? 111, max: 240, color: "#00FFFF" },
      { chunk: 213, head: "spr_headsusie", headFrame: 6, name: "spr_bnamesusie", hp: hp.susie ?? 238, max: 290, color: "#FF00FF" },
      { chunk: 426, head: "spr_headralsei", headFrame: 0, name: "spr_bnameralsei", hp: hp.ralsei ?? 210, max: 210, color: "#00FF00" },
    ];
    for (const member of party) {
      const x = member.chunk;
      await this.drawGameSprite(ctx, member.head, member.headFrame, x + 13, 336);
      await this.drawGameSprite(ctx, member.name, 0, x + 51, 339);
      await this.drawGameSprite(ctx, "spr_hpname", 0, x + 109, 347);
      await this.drawSmallNumber(ctx, member.hp, x + 160, 334);
      await this.drawGameSprite(ctx, "spr_hpslash", 0, x + 159, 332);
      await this.drawSmallNumber(ctx, member.max, x + 205, 334);
      ctx.fillStyle = "#800000";
      ctx.fillRect(x + 128, 347, 75, 8);
      ctx.fillStyle = member.color;
      ctx.fillRect(x + 128, 347, Math.ceil((member.hp / member.max) * 75), 8);
    }
  }

  async drawTensionBar(ctx) {
    const x = 52;
    const y = 40;
    await this.drawGameSprite(ctx, "spr_tensionbar", 1, x, y);
    ctx.fillStyle = "#FF9933";
    ctx.fillRect(x + 3, y + 196 - 196 * 0.6, 21, 196 * 0.6 - 1);
    await this.drawGameSprite(ctx, "spr_tensionbar", 0, x, y);
    await this.drawGameSprite(ctx, "spr_tensionbar_cutout", 0, x, y);
    await this.drawGameSprite(ctx, "spr_tplogo", 0, x - 30, y + 30);
    this.fonts.mainbig?.drawText(ctx, "60", x - 30, y + 70, "#FFFFFF", 1, 28);
    this.fonts.mainbig?.drawText(ctx, "%", x - 25, y + 95, "#FFFFFF", 1, 28);
  }

  // Coque générale de scr_battletext_default : décor de combat, jauge TP, HUD
  // à bp=152 et writer à (30,376). Une rencontre connue peut ajouter sa scène,
  // mais le panneau de texte ne dépend jamais de cette décoration.
  async renderBattleText(text, state = {}) {
    const ctx = this.clear(640, 480);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 640, 480);
    await this.tileSprite(ctx, "bg_battleback1", -82, -82, 640, 325, 0.5);
    await this.tileSprite(ctx, "bg_battleback1", -224, -234, 640, 325, 1);

    if (state.scene === "trashy-trio") {
      const debris = [
        [0, 289, 43, -18], [1, 319, 37, 21], [2, 246, 79, -8],
        [3, 290, 121, 31], [0, 329, 112, 5], [1, 216, 137, -22],
        [4, 279, 138, 40], [2, 326, 149, -15], [0, 338, 164, 17],
        [3, 288, 171, 29], [1, 208, 197, -12], [4, 235, 210, 8],
        [2, 187, 241, 33], [0, 281, 247, -18], [3, 300, 260, 24],
      ];
      for (const [frame, x, y, angle] of debris) {
        await this.drawGameSprite(ctx, "spr_bullet_trash", frame, x, y, 1, 1, angle, {
          exact: true,
          filter: "brightness(50%)",
        });
      }
    }

    const specificScene = state.scene === "trashy-trio";
    await this.drawGameSprite(ctx, specificScene ? "spr_krisb_act" : "spr_krisb_idle", specificScene ? 5 : 0, 94, 50, 2);
    await this.drawGameSprite(ctx, "spr_susieb_idle", 0, 80, 122, 2);
    await this.drawGameSprite(ctx, specificScene ? "spr_ralsei_act" : "spr_ralsei_idle", 0, 72, 200, 2);
    if (state.scene === "trashy-trio") {
      await this.drawTrashyBallperson(ctx, 0);
      await this.drawGameSprite(ctx, "spr_npc_trashy", 0, 386, 170, 2);
      await this.drawGameSprite(ctx, "spr_npc_nubert_super_burrow", 0, 546, 202, 2);
    }
    await this.drawTensionBar(ctx);
    await this.drawBattleHud(ctx);

    if (state.choiceOptions) {
      const choice = await this.drawClassicChoices(ctx, state.choiceOptions, {
        selected: state.choiceSelected,
        scale: 2,
        dAdd: 155,
        fightingOffset: 30,
      });
      return { ...choice, fc: 0, fe: 0, mode: "battletext" };
    }

    const initialFc = state.fc || 0;
    const fmt = formatText(text, { charline: 33, battle: true, initialFc });
    const lay = layoutText(fmt.text, {
      typer: state.typer ?? 4,
      dark: true,
      fight: true,
      writingx: 30,
      writingy: 376,
      faceXShift: 116,
      initialFc,
      initialFe: state.fe || 0,
    });
    let faceExact = true;
    if (lay.fc !== 0) {
      const face = await this.drawFace(
        ctx,
        lay.fc,
        lay.fe,
        26,
        380,
        2,
        true,
        state.faceVariant
      );
      faceExact = face.exact;
    }
    const miniFaceWarnings = await this.drawMiniFaces(
      ctx,
      lay.miniFaces,
      state.miniFaceBank
    );
    this.drawOps(ctx, lay.ops, 0, 0, 1);

    const warnings = [...lay.warnings, ...miniFaceWarnings];
    if (!faceExact)
      warnings.push(`⚠ Expression ${lay.fe} introuvable pour ce visage — frame 0 affichée`);
    if (lay.maxX > 632) warnings.push("⚠ Le texte de combat déborde à droite");
    if (lay.maxY + lay.vspace > 480) warnings.push("⚠ Trop de lignes pour le panneau de combat");
    return { warnings, lines: lay.lines, fc: lay.fc, fe: lay.fe, mode: "battletext" };
  }

  bitmapTextWidth(font, text, scale = 1) {
    if (!font) return 0;
    let width = 0;
    let maxWidth = 0;
    for (const ch of String(text).replaceAll("#", "\n")) {
      if (ch === "\r") continue;
      if (ch === "\n") {
        maxWidth = Math.max(maxWidth, width);
        width = 0;
        continue;
      }
      width += (font.glyphs.get(ch.codePointAt(0))?.shift ?? 0) * scale;
    }
    return Math.max(maxWidth, width);
  }

  drawCenteredChoiceText(ctx, font, item, color, lineHeight) {
    if (!font) return;
    // draw_set_valign(fa_middle) centre le bloc sur son interligne, tandis que
    // le bitmap utile commence plus bas dans la cellule de la font (10 px en
    // mainbig, 5 px en main). Ces valeurs reproduisent la capture en jeu.
    const startY = item.y - (item.lines.length * lineHeight) / 2 + lineHeight * (5 / 18);
    item.lines.forEach((line, index) => {
      const width = this.bitmapTextWidth(font, line);
      font.drawText(ctx, line, item.x - width / 2, startY + index * lineHeight, color);
    });
  }

  async drawNeoChoices(ctx, options, { dark, side, selected }) {
    const scale = dark ? 2 : 1;
    const font = dark ? this.fonts.mainbig : this.fonts.main;
    const layout = neoChoiceLayout(options, {
      scale,
      side,
      measure: (line) => this.bitmapTextWidth(font, line),
    });
    const selectedIndex = Math.max(0, Math.min(layout.length - 1, Number(selected) || 0));
    layout.forEach((item, index) =>
      this.drawCenteredChoiceText(
        ctx,
        font,
        item,
        index === selectedIndex ? "#FFFF00" : "#FFFFFF",
        dark ? 36 : 18
      )
    );
    const heart = layout[selectedIndex];
    const heartDrawn = heart
      ? await this.drawChoiceHeart(ctx, heart.heartX, heart.heartY, scale)
      : false;
    const warnings = [];
    if (!heartDrawn) warnings.push("⚠ Sprite du cœur introuvable — réimporte le data.win");
    for (const item of layout) {
      if (item.x - item.width / 2 < 24 || item.x + item.width / 2 > (dark ? 616 : 305)) {
        warnings.push("⚠ Une option de choix déborde horizontalement de la boîte");
        break;
      }
    }
    return {
      warnings,
      lines: Math.max(1, ...layout.map((item) => item.lines.length)),
    };
  }

  async drawClassicChoices(
    ctx,
    options,
    { selected, scale, dAdd, fightingOffset = 0 }
  ) {
    const font = this.fonts.mainbig;
    const layout = classicChoiceLayout(options, {
      scale,
      dAdd,
      fightingOffset,
      measure: (line) => this.bitmapTextWidth(font, line),
    });
    const selectedIndex = Math.max(0, Math.min(layout.length - 1, Number(selected) || 0));
    layout.forEach((item, index) =>
      font?.drawText(
        ctx,
        item.text,
        item.x,
        item.y,
        index === selectedIndex ? "#FFFF00" : "#FFFFFF",
        1,
        36
      )
    );
    const heart = layout[selectedIndex];
    const heartDrawn = heart
      ? await this.drawChoiceHeart(ctx, heart.heartX, heart.heartY, scale)
      : false;
    const warnings = [];
    if (!heartDrawn) warnings.push("⚠ Sprite du cœur introuvable — réimporte le data.win");
    if (layout.some((item) => item.x < 0 || item.x + item.width > 640))
      warnings.push("⚠ Une option de choix déborde horizontalement de la zone");
    return {
      warnings,
      lines: Math.max(1, ...layout.map((item) => item.lines.length)),
    };
  }

  async drawChoiceHeart(ctx, x, y, scale) {
    // obj_choicer_neo Create_0 : heartSprite 3113 = spr_heartsmall_white,
    // origin (0,0), teinté par heartCol = c_red dans Draw_0.
    const exact = await this.tintedSprite("spr_heartsmall_white", 0, "#FF0000");
    const fallback = exact ? null : await this.sprite("spr_heart_centered", 0, true);
    const image = exact ?? fallback;
    if (!image) return false;
    ctx.drawImage(image, Math.round(x), Math.round(y), 9 * scale, 9 * scale);
    return true;
  }

  // obj_yellow_trial_manager Draw_0 : case_info n'est jamais envoyé au
  // writer. Le dossier est dessiné à (30,376), en main x2, au-dessus du HUD
  // assombri ; les cinq prévenus et le prévenu sélectionné restent en scène.
  async renderTrialCase(text, state = {}) {
    const ctx = this.clear(640, 480);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 640, 480);
    await this.tileSprite(ctx, "bg_battleback1", -82, -82, 640, 325, 0.5);
    await this.tileSprite(ctx, "bg_battleback1", -224, -234, 640, 325, 1);

    // Les héros conservent leurs positions de combat. Les pupitres sont créés
    // à partir de celles-ci par obj_yellow_trial_manager Create_0.
    await this.drawGameSprite(ctx, "spr_kris_lawyer", 0, 94, 50, 2);
    await this.drawGameSprite(ctx, "spr_susie_lawyer", 0, 80, 122, 2);
    await this.drawGameSprite(ctx, "spr_ralsei_lawyer", 0, 72, 200, 2);
    await this.drawGameSprite(ctx, "spr_trial_podium", 1, 154, 106, 2);
    await this.drawGameSprite(ctx, "spr_trial_podium", 0, 140, 184, 2);
    await this.drawGameSprite(ctx, "spr_trial_podium", 1, 132, 272, 2);

    const perps = [
      { name: "spr_aqua_walk_down", frame: 0, xstart: 220, ystart: 240 },
      { name: "spr_seth_walk_down", frame: 0, xstart: 300, ystart: 240 },
      { name: "spr_enemy_green_walk", frame: 0, xstart: 380, ystart: 240 },
      { name: "spr_yellow_walk_down", frame: 0, xstart: 460, ystart: 240 },
      { name: "spr_blue_poses", frame: 2, xstart: 540, ystart: 240 },
    ];
    const drawPerp = async (perp) => {
      const meta = this.spriteMeta[perp.name] ?? {};
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      const originX = meta.originX ?? 0;
      const originY = meta.originY ?? 0;
      const x = perp.xstart - (width - originX);
      const y = perp.ystart - (height - originY) * 2;
      return this.drawGameSprite(ctx, perp.name, perp.frame, x, y, 2, 2, 0, { exact: true });
    };
    for (const perp of perps) await drawPerp(perp);

    await this.drawTensionBar(ctx);
    await this.drawBattleHud(ctx, { kris: 135, susie: 290, ralsei: 144 });

    // begin_trial() fixe darkness à 0.5. Les éléments de sélection sont ensuite
    // redessinés à pleine luminosité dans le Draw du manager.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 640, 480);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    await this.drawGameSprite(ctx, "spr_trial_spotlight", 0, 220, 240, 2, 2.5, 0, {
      exact: true,
      alpha: 0.75,
    });
    ctx.restore();
    const selectedDrawn = await drawPerp(perps[0]);
    await this.drawGameSprite(ctx, "spr_heart_centered", 0, 220, 280, 1, 1, 0, { exact: true });
    const arrowOffset = Math.sin(this.jewelTimer * 0.1) * 3;
    await this.drawGameSprite(ctx, "spr_sneo_bullet_arrow", 0, 240 + arrowOffset, 279, 1, 1, 0, { exact: true });
    await this.drawGameSprite(ctx, "spr_sneo_bullet_arrow", 0, 200 - arrowOffset, 279, -1, 1, 0, { exact: true });

    const prompt = applyLanguageTypography(
      state.trialPrompt ?? "{0} to accuse.",
      state.language
    ).replace("{0}", "    ").replace("~1", "    ");
    const promptFont = this.fonts.main;
    const promptWidth = this.bitmapTextWidth(promptFont, prompt, 2);
    const promptX = Math.round(220 - promptWidth / 2);
    // Branche manette du Draw_0 : l'icône remplace le token d'entrée, puis le
    // texte conserve quatre espaces pour réserver sa place.
    await this.drawGameSprite(ctx, "button_xbox_a", 0, 148, 292, 2, 2, 0, { exact: true });
    promptFont?.drawText(ctx, prompt, promptX, 288, "#FFFFFF", 2, 16);

    this.fonts.main?.drawText(ctx, text, 30, 376, "#FFFFFF", 2, 16);
    ctx.fillStyle = "#9A7ED3";
    for (let a = 0; a < 9; a += 2) ctx.fillRect(378, 376 + a * 10, 4, 10);

    const lines = String(text).replaceAll("#", "\n").split(/\r?\n/);
    const warnings = [];
    if (!selectedDrawn) warnings.push("⚠ Sprites du procès introuvables — réimporte le data.win");
    if (lines.some((line) => this.bitmapTextWidth(this.fonts.main, line, 2) > 340))
      warnings.push("⚠ Le dossier du procès atteint le séparateur violet");
    if (lines.length > 3) warnings.push("⚠ Trop de lignes pour le panneau du procès");
    return { warnings, lines: lines.length, fc: 0, fe: 0, mode: "trial" };
  }

  // --- Boîte de dialogue (monde sombre f=2 sur 640x480 ; monde clair f=1 sur
  //     320x240, upscalé x2 pour l'affichage)
  async renderDialogue(text, state, { dark = true, fight = false }) {
    const f = dark ? 2 : 1;
    const S = dark ? 1 : 2; // upscale d'affichage du monde clair
    const ctx = this.clear(320 * f * S, 240 * f * S);
    ctx.save();
    ctx.scale(S, S);

    const hasScene = await this.drawSceneBackground(ctx, state.sceneContext, dark);
    if (!hasScene)
      this.checkerBg(ctx, dark ? "#151020" : "#1a2c20", "rgba(255,255,255,0.025)");

    const isChoice = Boolean(state.choiceOptions?.length);
    const initialFc = isChoice ? 0 : state.fc || 0;
    const typer = state.typer || (fight ? 47 : dark ? 6 : 5);
    const side = isChoice ? (Number(state.choiceSide) === 0 ? 0 : 1) : 1;

    // formatage (word-wrap)
    const fmt = formatText(text, {
      // obj_writer Other_15 force charline à 23 pour le typer rose, avant
      // que le texte ne puisse atteindre le grand obj_pinkspeaker à droite.
      charline: !fight && typer === 97 ? 23 : 33,
      dialoguer: !fight,
      battle: fight,
      initialFc,
    });

    // --- boîte (obj_dialoguer_Draw_0) ---
    const boxheight = 3;
    let boxRight, boxBottom;
    if (dark) {
      const sidemod = side * 310;
      const x0 = 24,
        y0 = 2 + sidemod,
        x1 = 24 + 592,
        y1 = 168 - 108 + 36 * boxheight + sidemod;
      await this.drawDarkBox(ctx, x0, y0, x1, y1);
      boxRight = x1;
      boxBottom = y1;
    } else {
      const sidemod = side * 155;
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

    if (isChoice) {
      const choice = await this.drawNeoChoices(ctx, state.choiceOptions, {
        dark,
        side,
        selected: state.choiceSelected,
      });
      ctx.restore();
      return {
        ...choice,
        fc: 0,
        fe: 0,
        mode: dark ? "darkbox" : "lightbox",
      };
    }

    // --- writer (obj_dialoguer Other_10) ---
    const writerX = 19 * f + 10 * f;
    const writerY = 20 * f + (-5 + 155 * side) * f;

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
        ctx,
        lay.fc,
        lay.fe,
        writerX + 8 * f,
        writerY + 5 * f,
        f,
        dark,
        state.faceVariant
      );
      faceExact = r.exact;
    }

    const speakerOverlayWarnings = dark
      ? await this.drawSpeakerOverlay(ctx, state.speakerOverlay, lay.fe)
      : [];
    const miniFaceWarnings = await this.drawMiniFaces(
      ctx,
      lay.miniFaces,
      state.miniFaceBank
    );
    this.drawOps(ctx, lay.ops, 0, 0, 1);
    if (state.smallFace) await this.drawSmallFace(ctx, state.smallFace, writerX, writerY);
    ctx.restore();

    const warnings = [...lay.warnings, ...speakerOverlayWarnings, ...miniFaceWarnings];
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

  // obj_dialoguer_plat Draw_0 / Other_10 / Alarm_0 : bande noire sans
  // bordure, charline_bonus = 5 et positions attachées à la caméra 640×480.
  async renderPlatformDialogue(text, state = {}) {
    const ctx = this.clear(640, 480);
    const hasScene = await this.drawSceneBackground(ctx, state.sceneContext, true);
    if (!hasScene) this.checkerBg(ctx, "#151020", "rgba(255,255,255,0.025)");

    const isChoice = Boolean(state.choiceOptions?.length);
    const side = isChoice ? 1 : Number(state.platformSide) === 1 ? 1 : 0;
    const initialFc = isChoice ? 0 : state.fc || 0;
    const typer = state.typer || 6;
    const fmt = formatText(text, {
      charline: (initialFc ? 26 : 33) + 5,
      dialoguer: true,
      initialFc,
    });
    const writerX = 18;
    const writerY = 10 + 380 * side;
    const lay = layoutText(fmt.text, {
      typer,
      dark: true,
      writingx: writerX,
      writingy: writerY,
      faceXShift: 116,
      initialFc,
      initialFe: state.fe || 0,
    });

    const panelY = 380 * side;
    if (lay.fc !== 0) {
      const extensionY = side ? panelY - 20 : panelY;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, extensionY, 110, 120);

      const triangleY = side ? panelY : 100;
      const triangleDrawn = await this.drawGameSprite(
        ctx,
        "spr_gradient_triangle_dialoguer_plat",
        0,
        110,
        triangleY,
        1,
        side ? 1 : -1,
        0,
        { exact: true, filter: "brightness(0)" }
      );
      if (!triangleDrawn) {
        ctx.beginPath();
        ctx.moveTo(110, side ? panelY - 20 : 100);
        ctx.lineTo(110, side ? panelY : 120);
        ctx.lineTo(130, side ? panelY : 100);
        ctx.closePath();
        ctx.fill();
      }
      const fadeDrawn = await this.drawGameSprite(
        ctx,
        "spr_gradient20",
        0,
        110,
        panelY,
        5,
        2,
        270,
        { exact: true, filter: "brightness(0)" }
      );
      if (!fadeDrawn) {
        const fade = ctx.createLinearGradient(110, 0, 210, 0);
        fade.addColorStop(0, "#000000");
        fade.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = fade;
        ctx.fillRect(110, panelY, 100, side ? 40 : 100);
      }
    }

    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, panelY, 640, 100);
    ctx.restore();

    if (isChoice) {
      const choice = await this.drawClassicChoices(ctx, state.choiceOptions, {
        selected: state.choiceSelected,
        scale: 2,
        dAdd: 177,
      });
      return { ...choice, fc: 0, fe: 0, mode: "platform" };
    }

    let faceExact = true;
    if (lay.fc !== 0) {
      const face = await this.drawFace(
        ctx,
        lay.fc,
        lay.fe,
        12,
        side ? 376 : 6,
        2,
        true,
        state.faceVariant
      );
      faceExact = face.exact;
    }
    const miniFaceWarnings = await this.drawMiniFaces(ctx, lay.miniFaces, state.miniFaceBank);
    this.drawOps(ctx, lay.ops, 0, 0, 1);
    if (state.smallFace) await this.drawSmallFace(ctx, state.smallFace, writerX, writerY);

    const warnings = [...lay.warnings, ...miniFaceWarnings];
    if (!faceExact)
      warnings.push(`⚠ Expression ${lay.fe} introuvable pour ce visage — frame 0 affichée`);
    if (lay.maxX > 632) warnings.push("⚠ Le texte déborde à droite de la bande plateformer");
    const textBottom = side ? 480 : 100;
    if (lay.maxY + lay.vspace > textBottom)
      warnings.push("⚠ Trop de lignes pour la bande plateformer");
    return { warnings, lines: lay.lines, fc: lay.fc, fe: lay.fe, mode: "platform" };
  }

  // obj_smallface Alarm_0 + scr_smallface_reset : alarm[0] vaut 5 ; l'alarme
  // stoppe la vitesse avant le 5e déplacement, soit 4 × 10 px vers la gauche.
  async drawSmallFace(ctx, smallFace, writerX, writerY) {
    const xPositions = { left: 70, leftmid: 160, mid: 260, middle: 260, rightmid: 360, right: 400 };
    const yPositions = { top: -10, topmid: 10, mid: 30, middle: 30, bottommid: 50, bottom: 68 };
    const localX = typeof smallFace.x === "number" ? smallFace.x : xPositions[smallFace.x];
    const localY = typeof smallFace.y === "number" ? smallFace.y : yPositions[smallFace.y];
    if (localX == null || localY == null) return;

    const trueX = writerX + localX - 40;
    const trueY = writerY + localY;
    const speaker = String(smallFace.speaker).toLowerCase();
    const spriteName = speaker.startsWith("spr_") ? speaker : SMALL_FACE_SPRITES[speaker];
    const sprite = spriteName
      ? await this.sprite(spriteName, Number(smallFace.expression) || 0, true)
      : null;
    if (sprite) ctx.drawImage(sprite, Math.round(trueX), Math.round(trueY));

    const font = this.fonts.main;
    if (font) font.drawText(ctx, smallFace.text, trueX + 70, trueY + 10, "#FFFFFF", 1, 16);
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

    // personnage qui parle, dessiné sous la bulle. Dérivé de l'ancrage du
    // jeu : ennemi → scr_enemyblcon(x - 10, y + 40, 10) donc instance à
    // (ancre+10, ancre-40) ; héros → scr_heroblcon : ancre (héros.x+100,
    // héros.y+40) donc héros à (ancre-100, ancre-40). Échelle 2 pour tous
    // (scr_enemy_object_init L62, obj_heroparent Create_0).
    const actor = state.bubbleActor;
    let actorWarning = null;
    if (actor?.sprites?.length) {
      const actorX = side === 1 ? anchorX + 10 : anchorX - 100;
      const actorY = anchorY - 40;
      let drawn = false;
      for (const name of actor.sprites) {
        const frames = Math.max(1, this.spriteMeta[name]?.frames ?? 1);
        const frame = Math.floor(this.jewelTimer / 6) % frames;
        if (await this.drawGameSprite(ctx, name, frame, actorX, actorY, 2, 2)) {
          drawn = true;
          break;
        }
      }
      if (!drawn)
        actorWarning =
          `⚠ Sprite ${actor.sprites[0]} introuvable — réimporte le data.win ` +
          "(bouton ⚙ data.win) pour extraire les personnages de combat";
    }

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

    const miniFaceWarnings = await this.drawMiniFaces(
      ctx,
      lay.miniFaces,
      state.miniFaceBank,
      writingx,
      writingy
    );
    this.drawOps(ctx, lay.ops, writingx, writingy, 1);

    const warnings = [...lay.warnings, ...miniFaceWarnings];
    if (actorWarning) warnings.push(actorWarning);
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
    const miniFaceWarnings = await this.drawMiniFaces(
      ctx,
      lay.miniFaces,
      state.miniFaceBank,
      8,
      8,
      scale
    );
    this.drawOps(ctx, lay.ops, 8, 8, scale);
    return {
      warnings: [...lay.warnings, ...miniFaceWarnings],
      lines: lay.lines,
      fc: 0,
      fe: 0,
      mode: "plain",
    };
  }

  // scr_texttype 666/667 + writers créés directement par les objets DEVICE :
  // canvas 320×240, aucun dialoguer et coordonnées absolues du instance_create.
  async renderDevice(text, state = {}) {
    const style = state.deviceStyle ?? {};
    const ctx = this.clear(320, 240);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 320, 240);

    if (style.background === "contact") {
      // DEVICE_OBACK_4 Draw_0 : quatre IMAGE_DEPTH en miroir autour de (160,120).
      for (const [xs, ys] of [[2, 2], [-2, 2], [-2, -2], [2, -2]]) {
        await this.drawGameSprite(ctx, "IMAGE_DEPTH", 0, 160, 120, xs, ys, 0, {
          exact: true,
          alpha: 0.34,
        });
      }
    }

    if (style.vessel) {
      const parts = [
        // Apparence d'exemple : les flags 900…902 dépendent du choix fait en
        // jeu et ne sont pas stockés dans le fichier de langue.
        ["IMAGE_GONERHEAD", 0, 1],
        ["IMAGE_GONERBODY", 34],
        ["IMAGE_GONERLEGS", 60],
      ];
      const steps = Math.max(0, Math.min(3, Number(style.vessel.steps) || 1));
      for (let i = 0; i < steps; i++) {
        await this.drawGameSprite(
          ctx,
          parts[i][0],
          parts[i][2] ?? 0,
          Number(style.vessel.x) || 140,
          (Number(style.vessel.y) || 90) + parts[i][1],
          2,
          2,
          0,
          { exact: true }
        );
      }
    }

    const fmt = formatText(text, { charline: 33, initialFc: 0 });
    const lay = layoutText(fmt.text, {
      typer: state.typer ?? 667,
      writingx: Number(style.x) || 0,
      writingy: Number(style.y) || 0,
      initialFc: 0,
      hspaceScale: Number(style.hspaceScale) || 1,
    });
    const miniFaceWarnings = await this.drawMiniFaces(
      ctx,
      lay.miniFaces,
      state.miniFaceBank
    );
    this.drawOps(ctx, lay.ops, 0, 0, 1);

    const warnings = [...lay.warnings, ...miniFaceWarnings];
    if (lay.maxX > 320) warnings.push("⚠ Le texte DEVICE déborde à droite");
    if (lay.maxY + lay.vspace > 240) warnings.push("⚠ Le texte DEVICE déborde en bas");
    return { warnings, lines: lay.lines, fc: 0, fe: lay.fe, mode: "device" };
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
  async drawFace(ctx, fc, fe, fx, fy, f, dark = true, variant = null) {
    const spec = FACE_TABLE[fc];
    if (!spec) return { exact: false };
    let img = null;
    let exact = true;
    for (const cand of spec.resolve(fe ?? 0, dark, variant)) {
      img = await this.sprite(cand.name, cand.frame, true);
      if (img) break;
    }
    if (!img) {
      exact = false;
      for (const cand of spec.resolve(0, dark, variant)) {
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
