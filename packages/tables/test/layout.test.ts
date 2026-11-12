import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ballSizeOf, noseContactDistanceM, sanitizeLayout, TOUCH_TOLERANCE_M } from "../src/layout";
import { BALL_SETS } from "../src/presets/balls";
import { pocketDropCircles, resolveCustomTable } from "../src/validate";
import type { BallKind, BallSetSpec, Layout, LayoutBall } from "../src/types";

const set = BALL_SETS.find((b) => b.id === "pool-57@1") as BallSetSpec;
const table = resolveCustomTable(
  { game: "pool", lengthM: 2.54, widthM: 1.27, cornerMouthM: 0.12, middleMouthM: 0.13 },
  set.object.diameterM,
);
const d = set.object.diameterM;
const margin = noseContactDistanceM(d / 2, table.cushion.noseHeightM);
const run = (balls: LayoutBall[]) => sanitizeLayout({ balls }, table, set);

describe("sanitizeLayout steps", () => {
  it("drops non-finite coordinates", () => {
    const r = run([
      { kind: "1", x: NaN, y: 1 },
      { kind: "2", x: 0.5, y: Infinity },
      { kind: "3", x: 0.5, y: 1 },
    ]);
    expect(r.removed).toEqual([0, 1]);
    expect(r.layout.balls.map((b) => b.kind)).toEqual(["3"]);
  });

  it("drops kinds not in the set", () => {
    const r = run([
      { kind: "red", x: 0.5, y: 1 },
      { kind: "1", x: 0.7, y: 1 },
    ]);
    expect(r.removed).toEqual([0]);
  });

  it("resolves duplicate identities by confidence, ties by input index", () => {
    const r = run([
      { kind: "cue", x: 0.3, y: 1, confidence: 0.4 },
      { kind: "cue", x: 0.6, y: 1, confidence: 0.9 },
      { kind: "cue", x: 0.9, y: 1, confidence: 0.9 },
    ]);
    expect(r.removed).toEqual([0, 2]);
    expect(r.layout.balls).toEqual([{ kind: "cue", x: 0.6, y: 1, confidence: 0.9 }]);
    const absent = run([
      { kind: "1", x: 0.3, y: 1 },
      { kind: "1", x: 0.6, y: 1, confidence: 1 },
    ]);
    expect(absent.removed).toEqual([1]);
  });

  it("clamps balls to the cushions", () => {
    const r = run([
      { kind: "1", x: -5, y: -5 },
      { kind: "2", x: 99, y: 99 },
    ]);
    expect(r.moved).toEqual([0, 1]);
    // Clamped to the cushions, and then moved out of the corner pockets they landed over.
    for (const b of r.layout.balls) {
      expect(b.x).toBeGreaterThanOrEqual(margin - 1e-12);
      expect(b.x).toBeLessThanOrEqual(1.27 - margin + 1e-12);
      expect(b.y).toBeGreaterThanOrEqual(margin - 1e-12);
      expect(b.y).toBeLessThanOrEqual(2.54 - margin + 1e-12);
    }
    expect(r.layout.balls[0]?.x).toBeLessThan(0.2);
    expect(r.layout.balls[0]?.y).toBeLessThan(0.2);
    expect(r.layout.balls[1]?.x).toBeGreaterThan(1.07);
    expect(r.layout.balls[1]?.y).toBeGreaterThan(2.34);
  });

  it("clamps a ball to a cushion away from the pockets without moving it along the rail", () => {
    const r = run([{ kind: "1", x: -5, y: 0.7 }]);
    expect(r.layout.balls[0]).toMatchObject({ x: margin, y: 0.7 });
  });

  it("separates an overlapping pair to exactly touching, moving the lower confidence ball", () => {
    const r = run([
      { kind: "1", x: 0.6, y: 1, confidence: 0.2 },
      { kind: "2", x: 0.62, y: 1, confidence: 0.8 },
    ]);
    expect(r.moved).toEqual([0]);
    const [a, b] = r.layout.balls as [LayoutBall, LayoutBall];
    expect(b.x).toBe(0.62);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(d, 12);
    expect(a.x).toBeLessThan(b.x);
    expect(a.confidence).toBe(0.2);
  });

  it("moves in +x when centres coincide", () => {
    const r = run([
      { kind: "1", x: 0.6, y: 1 },
      { kind: "2", x: 0.6, y: 1 },
    ]);
    expect(r.moved).toEqual([1]);
    expect(r.layout.balls[1]!.x).toBeCloseTo(0.6 + d, 12);
    expect(r.layout.balls[1]!.y).toBe(1);
  });

  it("tolerates overlap up to the touch tolerance", () => {
    const r = run([
      { kind: "1", x: 0.6, y: 1 },
      { kind: "2", x: 0.6 + d - TOUCH_TOLERANCE_M / 2, y: 1 },
    ]);
    expect(r.moved).toEqual([]);
  });

  it("keeps a ball that is wedged against a cushion", () => {
    const r = run([
      { kind: "1", x: margin, y: 1 },
      { kind: "2", x: margin + 0.001, y: 1, confidence: 0.5 },
    ]);
    expect(r.removed).toEqual([]);
    const [a, b] = r.layout.balls as [LayoutBall, LayoutBall];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(d - TOUCH_TOLERANCE_M);
    expect(b.x).toBeGreaterThanOrEqual(margin);
  });
});

const kindArb = fc.constantFrom(...set.kinds.map((k) => k.kind)) as fc.Arbitrary<BallKind>;
const ballArb = fc.record(
  {
    kind: kindArb,
    x: fc.double({ min: -1, max: 2.5, noNaN: true }),
    y: fc.double({ min: -1, max: 4, noNaN: true }),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  },
  { requiredKeys: ["kind", "x", "y"] },
);

describe("sanitizeLayout properties", () => {
  it("never overlaps, always clamps, is idempotent and deterministic", () => {
    fc.assert(
      fc.property(fc.array(ballArb, { maxLength: 25 }), (balls) => {
        const layout: Layout = { balls };
        const r = sanitizeLayout(layout, table, set);
        expect(sanitizeLayout(layout, table, set)).toEqual(r);
        const out = r.layout.balls;
        for (const b of out) {
          const m = noseContactDistanceM(
            ballSizeOf(set, b.kind).diameterM / 2,
            table.cushion.noseHeightM,
          );
          expect(b.x).toBeGreaterThanOrEqual(m);
          expect(b.x).toBeLessThanOrEqual(1.27 - m);
          expect(b.y).toBeGreaterThanOrEqual(m);
          expect(b.y).toBeLessThanOrEqual(2.54 - m);
        }
        for (let i = 0; i < out.length; i++) {
          for (let j = i + 1; j < out.length; j++) {
            const gap = Math.hypot(out[i]!.x - out[j]!.x, out[i]!.y - out[j]!.y) - d;
            expect(gap).toBeGreaterThanOrEqual(-TOUCH_TOLERANCE_M);
          }
        }
        expect(out.length + r.removed.length).toBe(balls.length);
        const again = sanitizeLayout(r.layout, table, set);
        expect(again.layout).toEqual(r.layout);
        expect(again.moved).toEqual([]);
        expect(again.removed).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

describe("sanitizeLayout and pockets", () => {
  const circles = pocketDropCircles(table);
  const overPocket = (b: { x: number; y: number }): boolean =>
    circles.some((c) => Math.hypot(b.x - c.x, b.y - c.y) < c.radiusM);

  it("moves a ball in the corner of the cushions out of the corner pocket", () => {
    const r = run([{ kind: "1", x: margin, y: margin }]);
    expect(r.moved).toEqual([0]);
    const b = r.layout.balls[0] as LayoutBall;
    expect(overPocket(b)).toBe(false);
    expect(b.x).toBeGreaterThanOrEqual(margin - 1e-12);
    expect(b.y).toBeGreaterThanOrEqual(margin - 1e-12);
    expect(Math.hypot(b.x, b.y)).toBeLessThan(0.2);
  });

  it("moves a ball in the mouth of a middle pocket back onto the table", () => {
    const r = run([{ kind: "1", x: margin, y: 1.27 }]);
    const b = r.layout.balls[0] as LayoutBall;
    expect(overPocket(b)).toBe(false);
    expect(Math.abs(b.y - 1.27)).toBeLessThan(0.15);
  });

  it("never leaves a ball over a pocket, and stays idempotent", () => {
    const kinds = set.kinds.map((k) => k.kind);
    const ball = fc.record({
      kind: fc.constantFrom(...kinds),
      x: fc.double({ min: -0.3, max: 1.6, noNaN: true }),
      y: fc.double({ min: -0.3, max: 2.9, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(ball, { maxLength: 25 }), (balls) => {
        const first = sanitizeLayout({ balls }, table, set);
        for (const b of first.layout.balls) expect(overPocket(b)).toBe(false);
        const second = sanitizeLayout(first.layout, table, set);
        expect(second.moved).toEqual([]);
        expect(second.removed).toEqual([]);
        expect(second.layout).toEqual(first.layout);
      }),
      { numRuns: 300 },
    );
  });
});
