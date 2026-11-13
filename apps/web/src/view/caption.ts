import type { Box } from "./transform";

/**
 * Where and how big the caption is drawn. Everything is a fraction of the drawn width of the
 * table (rails included), so the caption scales with any table, unit and orientation.
 */

/** Height of the caption band under the table. */
export const BAND_FRACTION = 0.07;
/** Preferred and smallest font size. */
export const FONT_FRACTION = 0.032;
export const MIN_FONT_FRACTION = 0.02;
/** Text may use this much of the width. */
export const TEXT_WIDTH_FRACTION = 0.94;
/** Typical width of a character as a fraction of the font size (a deliberately honest guess). */
export const CHAR_WIDTH_EM = 0.52;
/** Font size, in the units the text is drawn in before it is scaled down to size. */
export const CAPTION_UNITS = 16;

export interface CaptionLayout {
  /** The whole band, from the bottom of the table drawing to the new bottom edge. */
  band: Box;
  /** Where the baseline middle of the text sits. */
  x: number;
  y: number;
  /** Font size in metres of the drawing. */
  fontSize: number;
  /** Scale that turns the `CAPTION_UNITS` font size into `fontSize`. */
  scale: number;
  /**
   * When even the smallest font would overflow, the length (in the scaled units of the text)
   * the browser must squeeze the text into.
   */
  textLength?: number;
}

/** Layout of a caption in a band added below `box`. */
export function captionLayout(caption: string, box: Box): CaptionLayout {
  const height = box.width * BAND_FRACTION;
  const available = box.width * TEXT_WIDTH_FRACTION;
  const chars = [...caption].length;
  const natural = (size: number): number => chars * CHAR_WIDTH_EM * size;
  const preferred = box.width * FONT_FRACTION;
  const smallest = box.width * MIN_FONT_FRACTION;

  let fontSize = preferred;
  if (natural(preferred) > available) {
    fontSize = Math.max(smallest, available / (chars * CHAR_WIDTH_EM));
  }
  const scale = fontSize / CAPTION_UNITS;
  const overflows = natural(fontSize) > available * 1.0001;
  return {
    band: { x: box.x, y: box.y + box.height, width: box.width, height },
    x: box.x + box.width / 2,
    y: box.y + box.height + height / 2,
    fontSize,
    scale,
    ...(overflows ? { textLength: available / scale } : {}),
  };
}

/** The viewBox with room for the caption band added below. */
export function withCaptionBand(box: Box, caption: string | undefined): Box {
  if (caption === undefined) return box;
  return { ...box, height: box.height + box.width * BAND_FRACTION };
}
