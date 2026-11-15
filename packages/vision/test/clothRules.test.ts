import { describe, expect, test } from "vitest";
import { toWorkImage } from "../src/image/pixels";
import { clothMask, findClothModel, isCushionShade } from "../src/table/clothModel";
import type { PhotoImage } from "../src/index";

/** A picture of one colour with rectangles of other colours painted on it. */
function picture(
  width: number,
  height: number,
  base: [number, number, number],
  patches: { x0: number; y0: number; x1: number; y1: number; rgb: [number, number, number] }[],
): PhotoImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const patch = patches.find((p) => x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1);
      data.set([...(patch ? patch.rgb : base), 255], (y * width + x) * 4);
    }
  }
  return { widthPx: width, heightPx: height, data };
}

describe("rules found with the first real test set (pix2pockets, 2026-11-14)", () => {
  const blue: [number, number, number] = [60, 150, 225];
  // The same blue: in shadow, washed out under a lamp, and deeper and brighter (a ball).
  const shaded: [number, number, number] = [24, 60, 90];
  const glare: [number, number, number] = [110, 185, 240];
  const ball: [number, number, number] = [40, 170, 255];
  const red: [number, number, number] = [200, 40, 40];
  const image = picture(200, 200, blue, [
    { x0: 10, y0: 10, x1: 30, y1: 30, rgb: shaded },
    { x0: 40, y0: 10, x1: 60, y1: 30, rgb: glare },
    { x0: 70, y0: 10, x1: 90, y1: 30, rgb: ball },
    { x0: 100, y0: 10, x1: 120, y1: 30, rgb: red },
  ]);
  const img = toWorkImage(image, 200);
  const model = findClothModel(img);
  if (!model) throw new Error("no cloth");
  const shade = new Uint8Array(img.width * img.height);
  const mask = clothMask(img, model, shade);
  const at = (x: number, y: number): number => y * img.width + x;

  test("cloth in shadow is cloth, and is marked as shade", () => {
    expect(mask[at(20, 20)]).toBe(1);
    expect(shade[at(20, 20)]).toBe(1);
    expect(shade[at(150, 150)]).toBe(0);
  });

  test("cloth paled by the glare of a lamp is cloth, and is not shade", () => {
    expect(mask[at(50, 20)]).toBe(1);
    expect(shade[at(50, 20)]).toBe(0);
  });

  test("a brighter thing of the cloth's hue and stronger colour is not cloth", () => {
    expect(mask[at(80, 20)]).toBe(0);
    expect(mask[at(110, 20)]).toBe(0);
  });

  test("a cushion face may be any shade of the cloth's hue, or dark, but not another colour", () => {
    const ycc = (rgb: [number, number, number]): [number, number, number] => {
      const y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      return [y, 0.564 * (rgb[2] - y), 0.713 * (rgb[0] - y)];
    };
    expect(isCushionShade(model, ...ycc([20, 70, 140]))).toBe(true);
    expect(isCushionShade(model, ...ycc([8, 8, 8]))).toBe(true);
    expect(isCushionShade(model, ...ycc(red))).toBe(false);
    expect(isCushionShade(model, ...ycc([240, 240, 235]))).toBe(false);
  });

  test("a part of a photo is copied from where it starts, at the detail asked for", () => {
    const part = toWorkImage(image, 100, { u0: 95.5, v0: 5, u1: 195.2, v1: 105 });
    expect(part.originU).toBe(95);
    expect(part.originV).toBe(5);
    expect(part.scale).toBe(2);
    expect(part.width).toBe(50);
    // The red patch starts at photo pixel (100, 10): working pixel (2.5, 2.5) of the part.
    const cr = (x: number, y: number): number => part.cr[y * part.width + x] as number;
    expect(cr(4, 4)).toBeGreaterThan(50);
    expect(cr(1, 4)).toBeLessThan(0);
    // A given block is used as it is, whatever the longest side would suggest.
    const exact = toWorkImage(image, 1, { u0: 0, v0: 0, u1: 101, v1: 50 }, 3);
    expect([exact.scale, exact.width, exact.height]).toEqual([3, 33, 16]);
    // A block larger than the part is cut to the part, never read past it.
    const tiny = toWorkImage(image, 1, { u0: 10, v0: 10, u1: 14, v1: 30 }, 50);
    expect([tiny.scale, tiny.width, tiny.height]).toEqual([4, 1, 5]);
    // A part reaching beyond the photo is cut to it.
    const cut = toWorkImage(image, 400, { u0: -50, v0: 150, u1: 900, v1: 900 });
    expect([cut.originU, cut.originV, cut.width, cut.height]).toEqual([0, 150, 200, 50]);
  });
});
