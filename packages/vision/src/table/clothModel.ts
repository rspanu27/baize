import type { WorkImage } from "../image/pixels";

/**
 * The colour of the cloth in one photo.
 *
 * Nothing is assumed about which colour a cloth is. The cloth is taken to be the most common
 * colour in the middle of the photo (the guidance asks for the whole table in frame, so the
 * middle is cloth). Colour is compared by its tint, which shading hardly changes: chroma
 * divided by brightness. Brightness itself is allowed to vary widely, because a cloth is
 * darker in shadow and on the cushions and lighter under a lamp.
 */
export interface ClothModel {
  /** Mean brightness of the cloth, 0..255. */
  y: number;
  /** Mean tint of the cloth: chroma per unit of brightness. */
  tintB: number;
  tintR: number;
  /** How far a pixel's tint may be from the mean and still be cloth. */
  tintRadius: number;
  /** Brightness range of cloth, including shaded cloth and cushions. */
  yMin: number;
  yMax: number;
}

/** Added to brightness before dividing, so that near-black pixels do not get wild tints. */
const TINT_FLOOR = 24;
/** Share of the photo's width and height, about its middle, used to find the cloth colour. */
const SEED_WINDOW = 0.4;
/** Smallest tint radius: sensor noise and gentle colour casts. Tuned on synthetic photos. */
const MIN_TINT_RADIUS = 0.07;
/** Tint radius as a multiple of the spread of the cloth's own tint. */
const TINT_SPREAD_FACTOR = 4;
/** Cloth may be this much darker (cushions, shadows) or brighter (lamp) than its mean. */
const DARKEST = 0.4;
const BRIGHTEST = 1.7;

export function tintOf(y: number, c: number): number {
  return c / (y + TINT_FLOOR);
}

/** Finds the cloth colour from the middle of the picture, or undefined if there is none. */
export function findClothModel(img: WorkImage): ClothModel | undefined {
  const x0 = Math.floor((img.width * (1 - SEED_WINDOW)) / 2);
  const x1 = Math.ceil((img.width * (1 + SEED_WINDOW)) / 2);
  const y0 = Math.floor((img.height * (1 - SEED_WINDOW)) / 2);
  const y1 = Math.ceil((img.height * (1 + SEED_WINDOW)) / 2);
  // Histogram of tint alone (two axes): cloth of any brightness, lit or shaded, falls in the
  // same few cells, so the fullest cell is the cloth even when something evenly lit (a
  // floor, a wall) shares the middle of the picture.
  const TB = 48;
  const tintBin = (t: number): number =>
    Math.max(0, Math.min(TB - 1, Math.floor((t + 1.2) * (TB / 2.4))));
  const hist = new Uint32Array(TB * TB);
  for (let j = y0; j < y1; j++) {
    for (let i = x0; i < x1; i++) {
      const at = j * img.width + i;
      const luma = img.y[at] as number;
      const a = tintBin(tintOf(luma, img.cb[at] as number));
      const b = tintBin(tintOf(luma, img.cr[at] as number));
      hist[a * TB + b] = (hist[a * TB + b] as number) + 1;
    }
  }
  // The fullest 3 x 3 block of cells, so that a colour on the border of two cells is not
  // split in half.
  let best = -1;
  let bestCount = 0;
  for (let a = 1; a < TB - 1; a++) {
    for (let b = 1; b < TB - 1; b++) {
      let count = 0;
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) count += hist[(a + da) * TB + b + db] as number;
      }
      if (count > bestCount) {
        bestCount = count;
        best = a * TB + b;
      }
    }
  }
  const total = (x1 - x0) * (y1 - y0);
  if (best < 0 || total === 0) return undefined;
  const bestA = Math.floor(best / TB);
  const bestB = best % TB;

  // Mean and spread of the pixels in and next to that cell, any brightness.
  let n = 0;
  let sy = 0;
  let sb = 0;
  let sr = 0;
  let sbb = 0;
  let srr = 0;
  for (let j = y0; j < y1; j++) {
    for (let i = x0; i < x1; i++) {
      const at = j * img.width + i;
      const luma = img.y[at] as number;
      const tb = tintOf(luma, img.cb[at] as number);
      const tr = tintOf(luma, img.cr[at] as number);
      if (Math.abs(tintBin(tb) - bestA) > 1 || Math.abs(tintBin(tr) - bestB) > 1) continue;
      n++;
      sy += luma;
      sb += tb;
      sr += tr;
      sbb += tb * tb;
      srr += tr * tr;
    }
  }
  // The cloth must be a good part of the middle of the picture.
  if (n < 0.25 * total) return undefined;
  const y = sy / n;
  const tintB = sb / n;
  const tintR = sr / n;
  const spread = Math.sqrt(
    Math.max(0, sbb / n - tintB * tintB) + Math.max(0, srr / n - tintR * tintR),
  );
  return {
    y,
    tintB,
    tintR,
    tintRadius: Math.max(MIN_TINT_RADIUS, TINT_SPREAD_FACTOR * spread),
    yMin: DARKEST * y,
    yMax: Math.min(255, BRIGHTEST * y + 10),
  };
}

/** A cloth with at least this much tint has a hue that shadow does not change. */
const HUE_MIN_TINT = 0.12;
/** Cosine of the largest angle between a shaded pixel's chroma and the cloth's (about 18 degrees). */
const HUE_COS = 0.95;
/**
 * A shaded pixel's saturation as a share of the cloth's: shade washes colour out, it does
 * not deepen it much, so a darker thing of the same hue but stronger colour (a blue ball on
 * a blue cloth, a brown rail beside a red cloth) is not cloth.
 */
const HUE_MIN_SATURATION = 0.35;
const HUE_MAX_SATURATION = 1.3;
/**
 * Cloth under the glare of a lamp is brighter and paler than the rest, with the same hue.
 * It may lose this share of its saturation and still be cloth.
 */
const GLARE_MIN_SATURATION = 0.6;
/** ... and it is never stronger in colour: a brighter thing of the same hue and full colour is a ball. */
const GLARE_MAX_SATURATION = 0.97;
/** Below this brightness a pixel has no colour to speak of. */
const HUE_DARK_FLOOR = 8;

/**
 * True where a pixel is cloth: it has the cloth's tint and a brightness cloth can have, or
 * it has the cloth's hue and is darker, or brighter and a little paler. The second rule is for real rooms, where
 * one end of a table can be several times darker than the other and cushions cast shadows:
 * a coloured cloth in shadow keeps its hue, even when its brightness falls outside any
 * fixed range. It is not used for grey or black cloths, which have no hue to keep.
 */
export function clothMask(
  img: WorkImage,
  model: ClothModel,
  /** If given, set to 1 where a pixel is cloth only by the second rule (darker, same hue). */
  shade?: Uint8Array,
): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  const r2 = model.tintRadius * model.tintRadius;
  const tintSize = Math.hypot(model.tintB, model.tintR);
  const hued = tintSize >= HUE_MIN_TINT;
  // The cloth's saturation with the small floor used for shaded pixels below.
  const clothSaturation = (tintSize * (model.y + 24)) / (model.y + HUE_DARK_FLOOR);
  for (let at = 0; at < mask.length; at++) {
    const luma = img.y[at] as number;
    const cb = img.cb[at] as number;
    const cr = img.cr[at] as number;
    if (luma >= model.yMin && luma <= model.yMax) {
      const db = tintOf(luma, cb) - model.tintB;
      const dr = tintOf(luma, cr) - model.tintR;
      if (db * db + dr * dr <= r2) {
        mask[at] = 1;
        continue;
      }
    }
    if (hued && luma >= HUE_DARK_FLOOR && luma <= model.yMax) {
      const chroma = Math.hypot(cb, cr);
      if (chroma <= 0) continue;
      const cos = (cb * model.tintB + cr * model.tintR) / (chroma * tintSize);
      const saturation = chroma / (luma + HUE_DARK_FLOOR);
      const darker = luma < model.y;
      if (
        cos >= HUE_COS &&
        saturation >= (darker ? HUE_MIN_SATURATION : GLARE_MIN_SATURATION) * clothSaturation &&
        saturation <= (darker ? HUE_MAX_SATURATION : GLARE_MAX_SATURATION) * clothSaturation
      ) {
        mask[at] = 1;
        if (shade && darker) shade[at] = 1;
      }
    }
  }
  return mask;
}

/** Cosine of the largest angle between the chroma of a cushion face and the cloth's (about 26 degrees). */
const FACE_HUE_COS = 0.9;
/** Darker than this share of the cloth, a pixel under a cushion is shadow whatever its colour. */
const FACE_DARK = 0.3;

/**
 * True where a pixel could be the face of a cushion or the shadow under it: the cloth's hue
 * at any brightness and any strength of colour, or simply dark. It is a looser test than
 * `clothMask` and is meant only for the narrow band where a cushion's face is seen, where
 * the cloth turns away from the light and looks deeper and darker than on the bed.
 */
export function isCushionShade(model: ClothModel, luma: number, cb: number, cr: number): boolean {
  if (luma < FACE_DARK * model.y) return true;
  const tintSize = Math.hypot(model.tintB, model.tintR);
  if (tintSize < HUE_MIN_TINT) return luma < model.y;
  return hasClothHue(model, luma, cb, cr);
}

/** A pixel with less colour than this share of the cloth's has no hue to compare. */
const FACE_MIN_SATURATION = 0.25;

/**
 * True where a pixel has the hue of a coloured cloth, at any brightness: the bed, the
 * cushion tops, and the cushion faces between them, which are much darker. Always false
 * for a cloth with no hue of its own (grey, black).
 */
export function hasClothHue(model: ClothModel, luma: number, cb: number, cr: number): boolean {
  const tintSize = Math.hypot(model.tintB, model.tintR);
  if (tintSize < HUE_MIN_TINT || luma < HUE_DARK_FLOOR) return false;
  const chroma = Math.hypot(cb, cr);
  const clothSaturation = (tintSize * (model.y + 24)) / (model.y + HUE_DARK_FLOOR);
  if (chroma / (luma + HUE_DARK_FLOOR) < FACE_MIN_SATURATION * clothSaturation) return false;
  return (cb * model.tintB + cr * model.tintR) / (chroma * tintSize) >= FACE_HUE_COS;
}
