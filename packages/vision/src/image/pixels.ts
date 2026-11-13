import type { PhotoImage } from "../types";

/** A small working copy of a photo: one float per channel per pixel, in Y, Cb, Cr. */
export interface WorkImage {
  width: number;
  height: number;
  /** Photo pixels per working pixel (the same in both directions). */
  scale: number;
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
 */
export function toWorkImage(image: PhotoImage, maxSide: number): WorkImage {
  const longSide = Math.max(image.widthPx, image.heightPx);
  const block = Math.max(1, Math.ceil(longSide / maxSide));
  const width = Math.floor(image.widthPx / block);
  const height = Math.floor(image.heightPx / block);
  const y = new Float32Array(width * height);
  const cb = new Float32Array(width * height);
  const cr = new Float32Array(width * height);
  const data = image.data;
  const inv = 1 / (block * block);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dj = 0; dj < block; dj++) {
        let k = ((j * block + dj) * image.widthPx + i * block) * 4;
        for (let di = 0; di < block; di++) {
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
  return { width, height, scale: block, y, cb, cr };
}
