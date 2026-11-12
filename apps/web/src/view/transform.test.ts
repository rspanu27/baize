import { describe, expect, test } from "vitest";
import { makeViewTransform } from "./transform";
import type { Orientation } from "./transform";

const table = { widthM: 1.27, lengthM: 2.54 };
const orientations: Orientation[] = ["landscape", "portrait"];

describe.each(orientations)("%s", (orientation) => {
  const t = makeViewTransform(table, orientation);

  test("toTable undoes toScreen", () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 0.3, y: 2 },
      { x: 1.27, y: 2.54 },
    ]) {
      const back = t.toTable(t.toScreen(p));
      expect(back.x).toBeCloseTo(p.x, 12);
      expect(back.y).toBeCloseTo(p.y, 12);
    }
  });

  test("does not mirror: a counter-clockwise turn on the table stays counter-clockwise", () => {
    const o = t.toScreen({ x: 0.5, y: 1 });
    const a = t.toScreen({ x: 1.5, y: 1 });
    const b = t.toScreen({ x: 0.5, y: 2 });
    const cross = (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    // +x to +y is counter-clockwise on the table; on a y-down screen that is a negative cross.
    expect(cross).toBeLessThan(0);
  });

  test("the viewBox covers the playing area plus the margin", () => {
    const m = 0.17;
    const box = t.viewBox(m);
    for (const p of [
      { x: -m, y: -m },
      { x: table.widthM + m, y: table.lengthM + m },
      { x: -m, y: table.lengthM + m },
      { x: table.widthM + m, y: -m },
    ]) {
      const s = t.toScreen(p);
      expect(s.x).toBeGreaterThanOrEqual(box.x - 1e-12);
      expect(s.x).toBeLessThanOrEqual(box.x + box.width + 1e-12);
      expect(s.y).toBeGreaterThanOrEqual(box.y - 1e-12);
      expect(s.y).toBeLessThanOrEqual(box.y + box.height + 1e-12);
    }
    // Opposite margin corners land exactly on the box corners.
    const lo = t.toScreen({ x: -m, y: -m });
    const hi = t.toScreen({ x: table.widthM + m, y: table.lengthM + m });
    expect(Math.min(lo.x, hi.x)).toBeCloseTo(box.x, 12);
    expect(Math.min(lo.y, hi.y)).toBeCloseTo(box.y, 12);
    expect(Math.abs(hi.x - lo.x)).toBeCloseTo(box.width, 12);
    expect(Math.abs(hi.y - lo.y)).toBeCloseTo(box.height, 12);
  });
});

describe("head end", () => {
  test("landscape: head end on the left, length runs rightwards", () => {
    const t = makeViewTransform(table, "landscape");
    expect(t.toScreen({ x: 0.6, y: 0 }).x).toBe(0);
    expect(t.toScreen({ x: 0.6, y: table.lengthM }).x).toBe(table.lengthM);
    const box = t.viewBox(0.1);
    expect(box.width).toBeGreaterThan(box.height);
  });

  test("portrait: head end at the bottom", () => {
    const t = makeViewTransform(table, "portrait");
    expect(t.toScreen({ x: 0.6, y: 0 }).y).toBe(table.lengthM);
    expect(t.toScreen({ x: 0.6, y: table.lengthM }).y).toBe(0);
    expect(t.toScreen({ x: 0.3, y: 1 }).x).toBe(0.3);
    const box = t.viewBox(0.1);
    expect(box.height).toBeGreaterThan(box.width);
  });
});
