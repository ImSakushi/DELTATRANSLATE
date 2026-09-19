import fs from "node:fs";
import path from "node:path";
import { spriteBounds, validatePlacement } from "../src/sprite-geometry.mjs";

export function readPlacement(directory, frame) {
  const file = path.join(directory, `${frame}.offset`);
  if (!fs.existsSync(file)) return { x: 0, y: 0 };
  const values = fs.readFileSync(file, "utf8").trim().split(";");
  if (values.length !== 2 || values.some((v) => !/^-?\d+$/.test(v))) throw new Error(`Position invalide : ${file}`);
  return validatePlacement({ x: Number(values[0]), y: Number(values[1]) });
}

export function readPngSize(file) {
  const header = Buffer.alloc(24);
  const descriptor = fs.openSync(file, "r");
  try {
    if (fs.readSync(descriptor, header, 0, 24, 0) !== 24 ||
        !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        header.toString("ascii", 12, 16) !== "IHDR") throw new Error("Le fichier n’est pas un PNG valide.");
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function validateSpriteOverrides(directory, original, replacement) {
  const frames = fs.existsSync(directory) ? fs.readdirSync(directory)
    .filter((name) => /^\d+\.png$/.test(name) && Number.parseInt(name) !== replacement.frame)
    .map((name) => ({ ...readPngSize(path.join(directory, name)), ...readPlacement(directory, Number.parseInt(name)) })) : [];
  return spriteBounds(original, [...frames, replacement]);
}

export const spriteImportCsx = fs.readFileSync(new URL("./import-sprite-overrides.csx", import.meta.url), "utf8");
