import { buildTableGeometry } from "@baize/physics";
import { TABLE_PRESETS, getTablePreset, markingsFor, spotsFor } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { CUSHION_DEPTH_M } from "./constants";
import { cushionPaths, markingShapes, pocketCircles } from "./tableArt";
import { makeViewTransform } from "./transform";
import type { Orientation } from "./transform";

const orientations: Orientation[] = ["landscape", "portrait"];

describe.each(TABLE_PRESETS.map((t) => [t.id, t] as const))("%s", (_id, table) => {
  const geometry = buildTableGeometry(table);
  describe.each(orientations)("%s", (orientation) => {
    const t = makeViewTransform(
      { widthM: table.playingArea.widthM, lengthM: table.playingArea.lengthM },
      orientation,
    );

    test("six cushions and six pockets, no NaN anywhere", () => {
      const paths = cushionPaths(geometry, CUSHION_DEPTH_M, t);
      expect(paths).toHaveLength(6);
      const pockets = pocketCircles(geometry, t);
      expect(pockets).toHaveLength(6);
      const shapes = markingShapes(markingsFor(table), t);
      expect(JSON.stringify([paths, pockets, shapes])).not.toMatch(/NaN|null/);
    });
  });
});

/** Parses `M x y A r r 0 large sweep x y`. */
function parseArc(d: string) {
  const m = /^M (\S+) (\S+) A (\S+) (\S+) 0 (\d) (\d) (\S+) (\S+)$/.exec(d);
  if (!m) throw new Error(`unexpected arc path: ${d}`);
  const n = (i: number) => Number(m[i]);
  return {
    start: { x: n(1), y: n(2) },
    r: n(3),
    large: n(5),
    sweep: n(6),
    end: { x: n(7), y: n(8) },
  };
}

describe("the snooker D", () => {
  const table = getTablePreset("snooker-12@1");
  if (!table) throw new Error("missing preset");
  const spots = spotsFor(table);
  const spot = (name: string) => {
    const s = spots.find((x) => x.name === name);
    if (!s) throw new Error(name);
    return s;
  };
  const baulkY = spot("brown").y;

  test.each(orientations)("%s: runs green to yellow and bulges towards the baulk cushion", (o) => {
    const t = makeViewTransform(
      { widthM: table.playingArea.widthM, lengthM: table.playingArea.lengthM },
      o,
    );
    const shape = markingShapes(markingsFor(table), t).find((s) => s.kind === "arc");
    if (shape?.kind !== "arc") throw new Error("no D");
    const arc = parseArc(shape.d);

    const green = t.toScreen(spot("green"));
    const yellow = t.toScreen(spot("yellow"));
    expect(arc.start.x).toBeCloseTo(green.x, 3);
    expect(arc.start.y).toBeCloseTo(green.y, 3);
    expect(arc.end.x).toBeCloseTo(yellow.x, 3);
    expect(arc.end.y).toBeCloseTo(yellow.y, 3);

    // Counter-clockwise on the table is counter-clockwise on screen: SVG sweep-flag 0.
    expect(arc.sweep).toBe(0);
    expect(arc.large).toBe(0);

    // Find the middle of the arc from the SVG endpoint parameters and check which side it is on.
    const cx = (arc.start.x + arc.end.x) / 2;
    const cy = (arc.start.y + arc.end.y) / 2;
    const a0 = Math.atan2(arc.start.y - cy, arc.start.x - cx);
    const mid = a0 + (arc.sweep === 1 ? 1 : -1) * (Math.PI / 2);
    const bulge = t.toTable({ x: cx + arc.r * Math.cos(mid), y: cy + arc.r * Math.sin(mid) });
    expect(bulge.y).toBeLessThan(baulkY);
    expect(bulge.y).toBeCloseTo(baulkY - arc.r, 3);
  });
});
