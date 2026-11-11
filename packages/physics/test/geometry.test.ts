import { resolveCustomTable, validateTable } from "@baize/tables";
import type { CustomTableFields } from "@baize/tables";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { buildTableGeometry, cushionContactDistance, prepareTable } from "../src/geometry";
import { SimInputError } from "../src/index";
import type { CushionArc, CushionSegment, TableGeometry, TableInput, Vec2 } from "../src/index";

const SNOOKER_12 = resolveCustomTable(
  { game: "snooker", lengthM: 3.569, widthM: 1.778, cornerMouthM: 0.086, middleMouthM: 0.105 },
  0.0525,
);
const POOL_9 = resolveCustomTable(
  { game: "pool", lengthM: 2.54, widthM: 1.27, cornerMouthM: 0.1143, middleMouthM: 0.127 },
  0.05715,
);
const BLACKBALL_6 = resolveCustomTable(
  { game: "blackball", lengthM: 1.829, widthM: 0.914, cornerMouthM: 0.085, middleMouthM: 0.095 },
  0.0508,
);
const FIXTURES: [string, TableInput][] = [
  ["snooker 12 ft", SNOOKER_12],
  ["pool 9 ft", POOL_9],
  ["blackball 6 ft", BLACKBALL_6],
];

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
}

function arcEnds(arc: CushionArc): [Vec2, Vec2] {
  return [
    { x: arc.centre.x + arc.radiusM * arc.from.x, y: arc.centre.y + arc.radiusM * arc.from.y },
    { x: arc.centre.x + arc.radiusM * arc.to.x, y: arc.centre.y + arc.radiusM * arc.to.y },
  ];
}

/** Every structural property the engine relies on. */
function checkGeometry(table: TableInput, g: TableGeometry): void {
  const W = table.playingArea.widthM;
  const L = table.playingArea.lengthM;
  expect(g.pockets.map((p) => p.id)).toEqual([
    "corner-bl",
    "corner-br",
    "corner-tl",
    "corner-tr",
    "middle-l",
    "middle-r",
  ]);
  expect(g.arcs).toHaveLength(12);
  const rails = g.segments.filter((s) => s.id.startsWith("rail-"));
  const facings = g.segments.filter((s) => s.id.startsWith("facing-"));
  expect(rails).toHaveLength(6);
  expect(new Set([...g.segments, ...g.arcs].map((p) => p.id)).size).toBe(
    g.segments.length + g.arcs.length,
  );

  // Rails lie on the nose lines, have positive length and face the table centre.
  const centre = { x: W / 2, y: L / 2 };
  for (const r of rails) {
    expect(dist(r.a, r.b)).toBeGreaterThan(0);
    expect(Math.abs(r.normal.x * r.normal.x + r.normal.y * r.normal.y - 1)).toBeLessThan(1e-15);
    expect(r.normal.x * (centre.x - r.a.x) + r.normal.y * (centre.y - r.a.y)).toBeGreaterThan(0);
    // Normal is perpendicular to the rail.
    expect(Math.abs(r.normal.x * (r.b.x - r.a.x) + r.normal.y * (r.b.y - r.a.y))).toBeLessThan(
      1e-15,
    );
    const onLine =
      (r.a.x === 0 && r.b.x === 0) ||
      (r.a.x === W && r.b.x === W) ||
      (r.a.y === 0 && r.b.y === 0) ||
      (r.a.y === L && r.b.y === L);
    expect(onLine).toBe(true);
  }

  // The boundary is a closed chain: every rail end meets exactly one arc end, every other arc
  // end is either the start of a facing or already inside the drop circle, and every facing
  // ends on its drop circle.
  const railEnds = rails.flatMap((r) => [r.a, r.b]);
  expect(railEnds).toHaveLength(12);
  for (const arc of g.arcs) {
    const pocketId = arc.id.slice(4, -2);
    const pocket = g.pockets.find((p) => p.id === pocketId);
    expect(pocket).toBeDefined();
    if (!pocket) continue;
    const ends = arcEnds(arc);
    const touchingRail = ends.filter((e) => railEnds.some((r) => dist(r, e) < 1e-12));
    // A sharp point (radius 0) has both ends on the rail end.
    expect(touchingRail).toHaveLength(arc.radiusM > 0 ? 1 : 2);
    const other = ends.find((e) => !touchingRail.includes(e)) ?? (ends[0] as Vec2);
    const facing = facings.find((f) => f.id === `facing-${arc.id.slice(4)}`);
    if (facing) {
      expect(dist(facing.a, other)).toBeLessThan(1e-12);
      expect(Math.abs(dist(facing.b, pocket.centre) - pocket.radiusM)).toBeLessThan(1e-12);
      // The facing heads away from the playing area.
      const out = { x: pocket.centre.x - centre.x, y: pocket.centre.y - centre.y };
      expect((facing.b.x - facing.a.x) * out.x + (facing.b.y - facing.a.y) * out.y).toBeGreaterThan(
        0,
      );
    } else {
      expect(dist(other, pocket.centre)).toBeLessThanOrEqual(pocket.radiusM + 1e-12);
    }
    // Arc end vectors are unit vectors and the arc spans at most a right angle, counter-clockwise.
    expect(Math.abs(arc.from.x * arc.from.x + arc.from.y * arc.from.y - 1)).toBeLessThan(1e-15);
    expect(arc.from.x * arc.to.y - arc.from.y * arc.to.x).toBeGreaterThan(0);
    expect(arc.from.x * arc.to.x + arc.from.y * arc.to.y).toBeGreaterThan(-1e-15);
  }

  // The opening between the two facing starts of each pocket is the mouth width.
  for (const pocket of g.pockets) {
    const spec = pocket.id.startsWith("corner") ? table.pockets.corner : table.pockets.middle;
    const starts = g.arcs
      .filter((a) => a.id.startsWith(`jaw-${pocket.id}-`))
      .map((arc) => {
        const ends = arcEnds(arc);
        return ends.find((e) => !railEnds.some((r) => dist(r, e) < 1e-12)) ?? (ends[0] as Vec2);
      });
    expect(starts).toHaveLength(2);
    if (spec.jawRadiusM > 0) {
      expect(dist(starts[0] as Vec2, starts[1] as Vec2)).toBeCloseTo(spec.mouthM, 12);
    }
    expect(pocket.radiusM).toBe(spec.dropRadiusM);
  }

  // Bounds contain everything.
  for (const p of g.pockets) {
    expect(p.centre.x - p.radiusM).toBeGreaterThanOrEqual(g.bounds.minX);
    expect(p.centre.x + p.radiusM).toBeLessThanOrEqual(g.bounds.maxX);
    expect(p.centre.y - p.radiusM).toBeGreaterThanOrEqual(g.bounds.minY);
    expect(p.centre.y + p.radiusM).toBeLessThanOrEqual(g.bounds.maxY);
  }
  expect(g.bounds.minX).toBeLessThanOrEqual(0);
  expect(g.bounds.maxX).toBeGreaterThanOrEqual(W);
}

/** Sorted list of all defining points after an optional mirror, for symmetry checks. */
function signature(g: TableGeometry, map: (p: Vec2) => Vec2): string[] {
  // Rounds to 0.1 nm and normalises -0 so mirrored values compare equal as text.
  const num = (v: number): string => (Math.round(v * 1e10) / 1e10 + 0).toFixed(10);
  const key = (p: Vec2): string => {
    const m = map(p);
    return `${num(m.x)},${num(m.y)}`;
  };
  const seg = (s: CushionSegment): string => [key(s.a), key(s.b)].sort().join("|");
  const arc = (a: CushionArc): string => {
    const [e1, e2] = arcEnds(a);
    return `${key(a.centre)}@${[key(e1), key(e2)].sort().join("|")}`;
  };
  return [
    ...g.segments.map(seg),
    ...g.arcs.map(arc),
    ...g.pockets.map((p) => `${key(p.centre)}r${num(p.radiusM)}`),
  ].sort();
}

describe("buildTableGeometry", () => {
  test.each(FIXTURES)("%s: structure and closure", (_name, table) => {
    checkGeometry(table, buildTableGeometry(table));
  });

  test.each(FIXTURES)("%s: mirror symmetric left-right and end-to-end", (_name, table) => {
    const g = buildTableGeometry(table);
    const W = table.playingArea.widthM;
    const L = table.playingArea.lengthM;
    const base = signature(g, (p) => p);
    expect(signature(g, (p) => ({ x: W - p.x, y: p.y }))).toEqual(base);
    expect(signature(g, (p) => ({ x: p.x, y: L - p.y }))).toEqual(base);
  });

  test("pool 9 ft: corner jaw points are mouth / sqrt(2) from the corner (sharp-ish points)", () => {
    const g = buildTableGeometry(POOL_9);
    const rail = g.segments.find((s) => s.id === "rail-bottom");
    expect(rail).toBeDefined();
    // With a 2 mm knuckle the cut-back differs from the sharp-point value by well under 1 mm.
    expect(Math.abs((rail?.a.x ?? 0) - POOL_9.pockets.corner.mouthM / Math.sqrt(2))).toBeLessThan(
      1e-3,
    );
  });

  test("a sharp point (zero jaw radius) is supported", () => {
    const sharp: TableInput = {
      ...POOL_9,
      pockets: {
        corner: { ...POOL_9.pockets.corner, jawRadiusM: 0 },
        middle: { ...POOL_9.pockets.middle, jawRadiusM: 0 },
      },
    };
    const g = buildTableGeometry(sharp);
    checkGeometry(sharp, g);
    const rail = g.segments.find((s) => s.id === "rail-bottom");
    expect(rail?.a.x).toBeCloseTo(sharp.pockets.corner.mouthM / Math.sqrt(2), 14);
  });

  test("is deterministic and prepareTable wraps the same geometry", () => {
    expect(buildTableGeometry(SNOOKER_12)).toEqual(buildTableGeometry(SNOOKER_12));
    const prepared = prepareTable(SNOOKER_12);
    expect(prepared.kind).toBe("prepared-table");
    expect(prepared.geometry).toEqual(buildTableGeometry(SNOOKER_12));
  });

  test("rejects impossible tables with a clear error", () => {
    const tooWide: TableInput = {
      ...POOL_9,
      pockets: { ...POOL_9.pockets, middle: { ...POOL_9.pockets.middle, mouthM: 3 } },
    };
    expect(() => buildTableGeometry(tooWide)).toThrow(SimInputError);
    const badAngle: TableInput = {
      ...POOL_9,
      pockets: { ...POOL_9.pockets, corner: { ...POOL_9.pockets.corner, facingAngleRad: 1 } },
    };
    expect(() => buildTableGeometry(badAngle)).toThrow(/facing angle/);
    const nan: TableInput = { ...POOL_9, playingArea: { lengthM: Number.NaN, widthM: 1 } };
    expect(() => buildTableGeometry(nan)).toThrow(SimInputError);
  });

  test("every valid custom table gives closed, symmetric geometry", () => {
    const fields = fc.record({
      game: fc.constantFrom("snooker", "pool", "blackball"),
      lengthM: fc.double({ min: 1.5, max: 4, noNaN: true }),
      ratio: fc.double({ min: 0.45, max: 0.55, noNaN: true }),
      ballDiameterM: fc.double({ min: 0.046, max: 0.064, noNaN: true }),
      cornerBalls: fc.double({ min: 1.45, max: 2.5, noNaN: true }),
      middleBalls: fc.double({ min: 1.45, max: 2.5, noNaN: true }),
      jawStyle: fc.constantFrom("angled", "rounded"),
    });
    fc.assert(
      fc.property(fields, (f) => {
        const custom: CustomTableFields = {
          game: f.game as CustomTableFields["game"],
          lengthM: f.lengthM,
          widthM: f.lengthM * f.ratio,
          cornerMouthM: f.cornerBalls * f.ballDiameterM,
          middleMouthM: f.middleBalls * f.ballDiameterM,
          jawStyle: f.jawStyle as CustomTableFields["jawStyle"],
        };
        fc.pre(validateTable(custom, f.ballDiameterM).every((i) => i.severity !== "error"));
        const table = resolveCustomTable(custom, f.ballDiameterM);
        const g = buildTableGeometry(table);
        checkGeometry(table, g);
        const base = signature(g, (p) => p);
        expect(signature(g, (p) => ({ x: table.playingArea.widthM - p.x, y: p.y }))).toEqual(base);
      }),
      { numRuns: 300 },
    );
  });
});

describe("cushionContactDistance", () => {
  test("equals the radius for a nose at centre height and shrinks as the nose rises", () => {
    expect(cushionContactDistance(0.03, 0.03)).toBe(0.03);
    const d = cushionContactDistance(0.02625, 0.635 * 0.0525);
    expect(d).toBeLessThan(0.02625);
    expect(d).toBeGreaterThan(0.025);
  });
});
