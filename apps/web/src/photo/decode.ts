import type { PhotoImage } from "@baize/vision";

/** The longer side of a decoded photo is at most this many pixels (design limit: speed and memory). */
export const MAX_PHOTO_SIDE_PX = 4000;

const UNREADABLE = "This file could not be read as a picture. Choose a JPEG, PNG or WebP photo.";

/** The size to draw a photo at so that its longer side is at most `max`. */
export function fitWithin(
  widthPx: number,
  heightPx: number,
  max: number = MAX_PHOTO_SIDE_PX,
): { width: number; height: number } {
  const longer = Math.max(widthPx, heightPx);
  if (longer <= max) return { width: widthPx, height: heightPx };
  const scale = max / longer;
  return {
    width: Math.max(1, Math.round(widthPx * scale)),
    height: Math.max(1, Math.round(heightPx * scale)),
  };
}

/**
 * Reads a chosen file into pixels, in the browser. The camera's rotation (EXIF) is applied,
 * and a very large photo is scaled down. The file goes nowhere else.
 */
export async function decodePhoto(file: Blob): Promise<PhotoImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(UNREADABLE);
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    if (width < 2 || height < 2) throw new Error(UNREADABLE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser cannot read pictures into memory.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    return { widthPx: width, heightPx: height, data: pixels.data };
  } finally {
    bitmap.close();
  }
}

/** Waits for the browser to paint, so that the busy message shows before a long synchronous call. */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    // Without a page to paint (unit tests), there is nothing to wait for.
    if (typeof requestAnimationFrame === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const fallback = setTimeout(resolve, 150);
    requestAnimationFrame(() => {
      setTimeout(() => {
        clearTimeout(fallback);
        resolve();
      }, 0);
    });
  });
}
