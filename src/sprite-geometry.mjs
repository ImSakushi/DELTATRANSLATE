export const MAX_SPRITE_SIZE = 8192;

export function validatePlacement(value = { x: 0, y: 0 }) {
  const { x, y } = value;
  if (![x, y].every((v) => Number.isInteger(v) && Math.abs(v) <= MAX_SPRITE_SIZE)) {
    throw new Error(`Le décalage doit être un nombre entier entre −${MAX_SPRITE_SIZE} et ${MAX_SPRITE_SIZE} px.`);
  }
  return { x, y };
}

export function spriteBounds(original, frames) {
  let left = 0, top = 0, right = original.width, bottom = original.height;
  for (const frame of frames) {
    const { x, y } = validatePlacement(frame);
    if (![frame.width, frame.height].every((v) => Number.isInteger(v) && v > 0 && v <= MAX_SPRITE_SIZE)) {
      throw new Error(`Le PNG doit mesurer entre 1 et ${MAX_SPRITE_SIZE} px par côté.`);
    }
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + frame.width);
    bottom = Math.max(bottom, y + frame.height);
  }
  const width = right - left, height = bottom - top;
  if (width > MAX_SPRITE_SIZE || height > MAX_SPRITE_SIZE || width * height > 16777216) {
    throw new Error(`Le sprite positionné dépasse ${MAX_SPRITE_SIZE} px par côté ou 16 mégapixels.`);
  }
  return { left, top, width, height };
}
