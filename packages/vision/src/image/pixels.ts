import type { PhotoImage } from "../types";

/** A small working copy of a photo: one float per channel per pixel, in Y, Cb, Cr. */
export interface WorkImage {
  width: number;
  height: number;
  /** Photo pixels per working pixel (the same in both directions). */
  scale: number;
  /** Photo pixel at which the working copy starts (0, 0 unless a part was cut out). */
  originU: number;
  originV: number;
  /** Brightness, 0..255. */
  y: Float32Array;
  /** Blue-difference and red-difference chroma, centred on 0. */
  cb: Float32Array;
  cr: Float32Array;
}

/**
 * Shrinks a photo by averaging whole blocks of pixels so that its longer side is at most
 * `maxSide`, and converts it to brightness and chroma (ITU-R BT.601 weights). Averaging
 * removes most sensor noise, which is what makes simple colour tests work.
 *
 * With `part` (a rectangle in photo pixels) only that part is copied, so that a table which
 * fills a small share of the photo is not shrunk along with everything around it. With
 * `block`, that many photo pixels make one working pixel, whatever `maxSide` says.
 */
export function toWorkImage(
  image: PhotoImage,
  maxSide: number,
  part?: { u0: number; v0: number; u1: number; v1: number },
  block?: number,
): WorkImage {
  const originU = part ? Math.max(0, Math.min(image.widthPx - 1, Math.floor(part.u0))) : 0;
  const originV = part ? Math.max(0, Math.min(image.heightPx - 1, Math.floor(part.v0))) : 0;
  const endU = part
    ? Math.max(originU + 1, Math.min(image.widthPx, Math.ceil(part.u1)))
    : image.widthPx;
  const endV = part
    ? Math.max(originV + 1, Math.min(image.heightPx, Math.ceil(part.v1)))
    : image.heightPx;
  const longSide = Math.max(endU - originU, endV - originV);
  // Never larger than the part itself, so that a block never reads past it.
  const step = Math.max(
    1,
    Math.min(
      Math.floor(block ?? Math.ceil(longSide / maxSide)),
      Math.min(endU - originU, endV - originV),
    ),
  );
  const width = Math.max(1, Math.floor((endU - originU) / step));
  const height = Math.max(1, Math.floor((endV - originV) / step));
  const y = new Float32Array(width * height);
  const cb = new Float32Array(width * height);
  const cr = new Float32Array(width * height);
  const data = image.data;
  const inv = 1 / (step * step);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dj = 0; dj < step; dj++) {
        let k = ((originV + j * step + dj) * image.widthPx + originU + i * step) * 4;
        for (let di = 0; di < step; di++) {
          r += data[k] as number;
          g += data[k + 1] as number;
          b += data[k + 2] as number;
          k += 4;
        }
      }
      r *= inv;
      g *= inv;
      b *= inv;
      const at = j * width + i;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      y[at] = luma;
      cb[at] = 0.564 * (b - luma);
      cr[at] = 0.713 * (r - luma);
    }
  }
  return { width, height, scale: step, originU, originV, y, cb, cr };
}
