// Géométrie de obj_choicer_neo Step_0. `measure` reproduit string_width avec
// la font active et reçoit une ligne sans séparateur #.

export function neoChoiceLayout(options, { scale, side = 1, measure }) {
  const xAnchors = [77.5, 243.5, 160.5, 163.5];
  const yAnchors = [43, 43, 23, 62.5];
  const dAdd = side ? 155 : 0;
  return options.slice(0, 4).map((source, index) => {
    const text = String(source ?? "").startsWith("#")
      ? String(source ?? "").slice(1)
      : String(source ?? "");
    const lines = text.split("#");
    const width = Math.max(0, ...lines.map((line) => measure(line)));
    let y = (yAnchors[index] + dAdd - 1.5) * scale;
    if (index === 2 && lines.length > 1) y += 2 * scale;
    return {
      text,
      lines,
      x: xAnchors[index] * scale,
      y,
      width,
      heartX: xAnchors[index] * scale - Math.round(width / 2) - 11 * scale,
      heartY: y - 4 * scale,
    };
  });
}

export function classicChoiceLayout(
  options,
  { scale, dAdd, fightingOffset = 0, measure }
) {
  const texts = options.slice(0, 4).map((source) => String(source ?? ""));
  const widths = texts.map((text) => Math.max(0, ...text.split("#").map(measure)));
  const result = [];
  const baseTextY = (13 + dAdd) * scale + fightingOffset;
  const heart0 = 30 * scale;
  result[0] = {
    text: texts[0],
    lines: texts[0].split("#"),
    x: heart0 + 16 * scale,
    y: baseTextY,
    width: widths[0],
    heartX: heart0,
    heartY: (34 + dAdd) * scale + fightingOffset,
  };
  if (texts.length >= 2) {
    const heart1 = 276 * scale - widths[1];
    result[1] = {
      text: texts[1],
      lines: texts[1].split("#"),
      x: heart1 + 16 * scale,
      y: baseTextY,
      width: widths[1],
      heartX: heart1,
      heartY: (34 + dAdd) * scale + fightingOffset,
    };
  }
  if (texts.length >= 3) {
    const leftRight = result[0].x + widths[0];
    const rightLeft = result[1].heartX;
    const lowerWidth =
      Math.max(widths[2], texts.length >= 4 ? widths[3] : 0) + 16 * scale;
    const heart2 = leftRight + (rightLeft - leftRight) / 2 - lowerWidth / 2;
    result[2] = {
      text: texts[2],
      lines: texts[2].split("#"),
      x: heart2 + 16 * scale,
      y: baseTextY,
      width: widths[2],
      heartX: heart2,
      heartY: (16 + dAdd) * scale + fightingOffset,
    };
  }
  if (texts.length >= 4) {
    result[3] = {
      text: texts[3],
      lines: texts[3].split("#"),
      x: result[2].heartX + 16 * scale,
      y: (56 + dAdd) * scale + fightingOffset,
      width: widths[3],
      heartX: result[2].heartX,
      heartY: (60 + dAdd) * scale + fightingOffset,
    };
  }
  return result;
}
