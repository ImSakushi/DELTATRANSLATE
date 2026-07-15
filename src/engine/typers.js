// Tables extraites du GML décompilé de DELTARUNE Ch5
// (scr_texttype, obj_writer_Draw_0, obj_face_Draw_0)

// Sous-ensemble utile au rendu de scr_texttype :
// font, color, hspace, vspace (textscale toujours 1 pour ces typers)
export const TYPERS = {
  1: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  2: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  4: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 28 },
  5: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  6: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  7: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  10: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  12: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  13: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  14: { font: "comicsans", color: "#FFFFFF", hspace: 8, vspace: 18 },
  17: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  18: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  20: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  22: { font: "tinynoelle", color: "#FFFFFF", hspace: 6, vspace: 18 },
  23: { font: "tinynoelle", color: "#FFFFFF", hspace: 6, vspace: 18 },
  30: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  31: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  32: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  33: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  35: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  36: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  40: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  45: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 28 },
  46: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 28 },
  47: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 28 },
  48: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 28 },
  50: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  53: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  55: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  56: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  57: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  58: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  59: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 28 },
  62: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  67: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  68: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  69: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  74: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  75: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  76: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  77: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 28 },
  78: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  83: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  84: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  86: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  87: { font: "main", color: "#FFFFFF", hspace: 8, vspace: 18 },
  88: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  89: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  90: { font: "mainbig", color: "#84F9FF", hspace: 16, vspace: 36 },
  91: { font: "mainbig", color: "#E2A8FC", hspace: 16, vspace: 36 },
  92: { font: "mainbig", color: "#FFF8A1", hspace: 16, vspace: 36 },
  93: { font: "mainbig", color: "#FFAC87", hspace: 16, vspace: 36 },
  94: { font: "mainbig", color: "#86A7FF", hspace: 16, vspace: 36 },
  95: { font: "mainbig", color: "#AEFFBC", hspace: 16, vspace: 36 },
  96: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  97: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
  98: { font: "mainbig", color: "#FFA500", hspace: 16, vspace: 36 },
  100: { font: "8bit", color: "#FFFFFF", hspace: 16, vspace: 20 },
  200: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  201: { font: "dotumche", color: "#000000", hspace: 9, vspace: 20 },
  202: { font: "mainbig", color: "#FFFFFF", hspace: 16, vspace: 36 },
};

// \Tx → global.typer selon le contexte (obj_writer_Draw_0).
// Chaque entrée : [normal, darkzone, fighting] (fighting prime sur darkzone quand défini)
export const T_TAG = {
  "0": { normal: 5, dark: 6 },
  "1": { normal: 2 },
  A: { normal: 18, dark: 89 },
  a: { normal: 20 },
  N: { normal: 12, dark: 56, fight: 59 },
  n: { normal: 23 },
  B: { normal: 13, dark: 57, fight: 77 },
  S: { normal: 10, dark: 30, darkfight: 47 },
  R: { normal: 31, fight: 45 },
  L: { normal: 32, fight: 46 },
  X: { normal: 40 },
  r: { normal: 55 },
  T: { normal: 7 },
  J: { normal: 35 },
  K: { normal: 33, fight: 48 },
  q: { normal: 62 },
  Q: { normal: 58 },
  s: { normal: 14 },
  U: { normal: 17 },
  p: { normal: 67 },
  C: { normal: 87 },
  f: { normal: 83 },
  v: { normal: 84 },
  j: { normal: 5 },
  y: { normal: 5 },
  i: { normal: 5 },
  k: { normal: 5 },
  F: { normal: 88 },
  h: { normal: 86 },
  "+": { normal: 36 },
  "4": { normal: 90 },
  "5": { normal: 91 },
  "6": { normal: 92 },
  "7": { normal: 93 },
  "8": { normal: 94 },
  "9": { normal: 95 },
  P: { normal: 97 },
  O: { normal: 98 },
};

// \cX → couleur (obj_writer_Draw_0)
export const C_TAG = {
  R: "#FF0000",
  B: "#0000FF",
  Y: "#FFFF00",
  G: "#00FF00",
  W: "#FFFFFF",
  X: "#000000",
  P: "#800080",
  M: "#800000",
  S: "#FF80FF",
  V: "#80FF80",
  Z: "RAINBOW",
  a: "#84F9FF",
  y: "#FFF8A1",
  g: "#AEFFBC",
  o: "#FFAC87",
  s: "#E2A8FC",
  p: "#FF8A90",
  b: "#86A7FF",
  "0": "RESET",
};

// \Fx → global.fc (obj_writer_Draw_0)
export const F_TAG = {
  "0": 0,
  S: 1,
  R: 2,
  N: 3,
  T: 4,
  L: 5,
  s: 6,
  U: 9,
  A: 10,
  a: 11,
  B: 12,
  b: 19,
  r: 15,
  u: 18,
  K: 20,
  Q: 21,
  C: 22,
  F: 23,
  f: 24,
  J: 14,
  y: 17,
  i: 13,
  k: 16,
};

export const FC_NAMES = {
  0: "(aucun)",
  1: "Susie",
  2: "Ralsei",
  3: "Noelle",
  4: "Toriel",
  5: "Lancer",
  6: "Sans",
  9: "Undyne",
  10: "Asgore",
  11: "Alphys",
  12: "Berdly",
  13: "Catti",
  14: "Jockington",
  15: "Rudy",
  16: "Catty",
  17: "Bratty",
  18: "Rouxls",
  19: "Burgerpants",
  20: "King",
  21: "Queen",
  22: "Carol",
  23: "Flowery",
  24: "Flowery (dark)",
  25: "Bleu (papillon)",
};

// fc → sprite du visage + offset de dessin (obj_face_Draw_0, branches ch5)
// offset appliqué : draw à (faceX + ox*?, faceY + oy*?) — les offsets du GML
// sont en px écran (déjà pour f=1) sauf indication.
export const FACE_SPRITES = {
  1: { sprite: "spr_face_susie_alt", frameFromFe: true, ox: -5, oy: 0 },
  2: { sprite: "spr_face_r_nohat", frameFromFe: true, ox: -15, oy: -10 },
  3: { sprite: "spr_face_n_matome", frameFromFe: true, ox: -12, oy: -10 },
  4: { sprite: "spr_face_t0", frameFromFe: false, ox: 0, oy: 0 },
  5: { sprite: "spr_face_l0", frameFromFe: true, ox: -15, oy: -10 },
  6: { sprite: "spr_face_sans0", frameFromFe: false, ox: 0, oy: 0 },
  9: { sprite: "spr_face_undyne", frameFromFe: true, ox: -10, oy: 0 },
  10: { sprite: "spr_face_asgore_matome", frameFromFe: true, ox: -10, oy: 0 },
  11: { sprite: "spr_alphysface", frameFromFe: true, ox: -10, oy: 0 },
  12: { sprite: "spr_face_berdly_dark", frameFromFe: true, ox: -10, oy: 0 },
  13: { sprite: "spr_face_catti", frameFromFe: true, ox: -10, oy: 0 },
  14: { sprite: "spr_face_jock0", frameFromFe: false, ox: -10, oy: 0 },
  15: { sprite: "spr_face_rudy", frameFromFe: true, ox: -12, oy: -10 },
  16: { sprite: "spr_face_catty", frameFromFe: true, ox: -10, oy: 0 },
  17: { sprite: "spr_face_bratty", frameFromFe: true, ox: -5, oy: 2 },
  18: { sprite: "spr_face_rurus", frameFromFe: true, ox: -10, oy: 0 },
  19: { sprite: "spr_face_burgerpants", frameFromFe: true, ox: -5, oy: -5 },
  20: { sprite: "spr_face_king", frameFromFe: true, ox: -5, oy: -5 },
  21: { sprite: "spr_face_queen", frameFromFe: true, ox: 0, oy: 0 },
  22: { sprite: "spr_face_carol", frameFromFe: true, ox: -9, oy: -4 },
  23: { sprite: "spr_face_flowery", frameFromFe: true, ox: 8, oy: 0 },
  24: { sprite: "spr_face_flowery_d", frameFromFe: true, ox: 1, oy: 6 },
  25: { sprite: "spr_face_blue", frameFromFe: true, ox: -12, oy: -1 },
};

// \E : caractère → global.fe (0-9 chiffres, A-Z → 10-35, a-z → 36-61)
export function decodeFe(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 90) return c - 55;
  if (c >= 97 && c <= 122) return c - 61;
  return 0;
}

export function encodeFe(fe) {
  if (fe <= 9) return String(fe);
  if (fe <= 35) return String.fromCharCode(fe + 55);
  if (fe <= 61) return String.fromCharCode(fe + 61);
  return "0";
}

// Résout un \Tx selon le mode de preview
export function resolveTyper(tchar, { dark = false, fight = false } = {}) {
  const spec = T_TAG[tchar];
  if (!spec) return null;
  if (dark && fight && spec.darkfight != null) return spec.darkfight;
  if (fight && spec.fight != null) return spec.fight;
  if (dark && spec.dark != null) return spec.dark;
  return spec.normal;
}
