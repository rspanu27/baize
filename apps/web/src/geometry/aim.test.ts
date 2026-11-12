import { describe, expect, test } from "vitest";
import {
  aimAtGhost,
  angleAt,
  angleBetween,
  angleOf,
  contactFraction,
  cutAngle,
  distance,
  firstBallOnLine,
  ghostBall,
  normalizeAngle,
} from "./aim";
import type { Point } from "./aim";

const R = 0.028575;
const DEG = Math.PI / 180;
const p = (x: number, y: number): Point => ({ x, y });

describe("angles", () => {
  test("angleOf", () => {
    expect(angleOf(p(0, 0), p(1, 0))).toBe(0);
    expect(angleOf(p(0, 0), p(0, 1))).toBeCloseTo(Math.PI / 2, 12);
    expect(angleOf(p(0, 0), p(-1, 0))).toBeCloseTo(Math.PI, 12);
    expect(angleOf(p(0, 0), p(-1, -0))).toBeCloseTo(Math.PI, 12);
    expect(angleOf(p(0, 0), p(0, -1))).toBeCloseTo(-Math.PI / 2, 12);
  });

  test("normalizeAngle", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(1.5 * Math.PI, 12);
    expect(normalizeAngle(2 * Math.PI)).toBe(0);
    expect(normalizeAngle(-1e-20)).toBeLessThan(2 * Math.PI);
    expect(normalizeAngle(101 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normalizeAngle(-101 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(Object.is(normalizeAngle(-0), 0)).toBe(true);
  });

  test("distance", () => {
    expect(distance(p(0, 0), p(3, 4))).toBe(5);
  });

  test("angleBetween is symmetric and in range", () => {
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        const a2 = p(Math.cos(i * 0.31), Math.sin(i * 0.31));
        const b2 = p(2 + Math.cos(j * 0.47), 1 + Math.sin(j * 0.47));
        const a1 = p(0, 0);
        const b1 = p(2, 1);
        const v = angleBetween(a1, a2, b1, b2);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(Math.PI / 2 + 1e-12);
        expect(angleBetween(b1, b2, a1, a2)).toBeCloseTo(v, 12);
        // Reversing a line's direction changes nothing.
        expect(angleBetween(a2, a1, b1, b2)).toBeCloseTo(v, 12);
      }
    }
  });

  test("angleBetween known values", () => {
    expect(angleBetween(p(0, 0), p(1, 0), p(0, 0), p(0, 1))).toBeCloseTo(Math.PI / 2, 12);
    expect(angleBetween(p(0, 0), p(1, 0), p(0, 0), p(-1, 0))).toBeCloseTo(0, 12);
    expect(angleBetween(p(0, 0), p(1, 0), p(0, 0), p(-1, 1))).toBeCloseTo(Math.PI / 4, 12);
  });

  test("angleAt", () => {
    expect(angleAt(p(0, 0), p(1, 0), p(0, 1))).toBeCloseTo(Math.PI / 2, 12);
    expect(angleAt(p(0, 0), p(1, 0), p(-1, 0))).toBeCloseTo(Math.PI, 12);
    expect(angleAt(p(0, 0), p(1, 0), p(2, 0))).toBe(0);
    expect(angleAt(p(1, 1), p(2, 1), p(2, 2))).toBeCloseTo(Math.PI / 4, 12);
    expect(angleAt(p(0, 0), p(1, 0), p(0, -1))).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe("ghostBall", () => {
  test("lies on the target line, one diameter from the object ball", () => {
    const obj = p(0.5, 1);
    const target = p(0.9, 2.2);
    const g = ghostBall(obj, target, R, R);
    expect(g).toBeDefined();
    if (!g) return;
    expect(distance(g, obj)).toBeCloseTo(2 * R, 12);
    // Collinear with target and object ball, on the far side from the target.
    expect(angleAt(obj, g, target)).toBeCloseTo(Math.PI, 9);
  });

  test("uses both radii", () => {
    const g = ghostBall(p(0, 0), p(0, 1), 0.03, 0.02);
    expect(g?.x).toBeCloseTo(0, 12);
    expect(g?.y).toBeCloseTo(-0.05, 12);
  });

  test("undefined when the target is the object ball", () => {
    expect(ghostBall(p(1, 1), p(1, 1), R, R)).toBeUndefined();
  });

  test("aimAtGhost", () => {
    expect(aimAtGhost(p(0, 0), p(0, 2))).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe("cutAngle", () => {
  const obj = p(0, 0);
  const target = p(0, 1);
  const d = 2 * R;
  // Cue ball placed so its path to the ghost ball (0, -d) makes the given angle with +y.
  function cueFor(cutDeg: number, length = 0.5): Point {
    const t = cutDeg * DEG;
    return p(-length * Math.sin(t), -d - length * Math.cos(t));
  }

  test("straight shot is 0", () => {
    expect(cutAngle(p(0, -0.8), obj, target, R, R)).toBeCloseTo(0, 12);
  });

  test("half-ball is 30 degrees with contact fraction 0.5", () => {
    const a = cutAngle(cueFor(30), obj, target, R, R);
    expect(a).toBeCloseTo(30 * DEG, 12);
    expect(contactFraction(a ?? NaN)).toBeCloseTo(0.5, 12);
  });

  test("45 degree construction", () => {
    const a = cutAngle(cueFor(45), obj, target, R, R);
    expect(a).toBeCloseTo(45 * DEG, 12);
    expect(cutAngle(cueFor(-45), obj, target, R, R)).toBeCloseTo(45 * DEG, 12);
  });

  test("impossible shots are undefined", () => {
    // Cue ball behind the target side of the object ball.
    expect(cutAngle(p(0, 0.8), obj, target, R, R)).toBeUndefined();
    // Cue ball overlapping the object ball.
    expect(cutAngle(p(0.01, 0), obj, target, R, R)).toBeUndefined();
    // Degenerate: target is the object ball, or cue ball sits on the ghost ball.
    expect(cutAngle(p(0, -0.8), obj, obj, R, R)).toBeUndefined();
    expect(cutAngle(p(0, -d), obj, target, R, R)).toBeUndefined();
    // Past 90 degrees.
    expect(cutAngle(cueFor(100), obj, target, R, R)).toBeUndefined();
  });

  test("contactFraction ends", () => {
    expect(contactFraction(0)).toBe(1);
    expect(contactFraction(Math.PI / 2)).toBeCloseTo(0, 12);
  });

  test("grid invariants", () => {
    const o = p(1, 1);
    const t = p(1.4, 2.1);
    let defined = 0;
    for (let ix = 0; ix <= 8; ix++) {
      for (let iy = 0; iy <= 8; iy++) {
        const cue = p(0.1 + ix * 0.225, 0.05 + iy * 0.3);
        const a = cutAngle(cue, o, t, R, R);
        const g = ghostBall(o, t, R, R);
        expect(distance(g as Point, o)).toBeCloseTo(2 * R, 12);
        if (a !== undefined) {
          defined++;
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(Math.PI / 2 + 1e-12);
          // Mirroring x across the table centre leaves the cut angle unchanged.
          const m = (q: Point): Point => p(2 - q.x, q.y);
          expect(cutAngle(m(cue), m(o), m(t), R, R)).toBeCloseTo(a, 9);
          // The cue path to the ghost agrees with angleAt.
          expect(a).toBeCloseTo(angleAt(g as Point, cue, p(2 * g!.x - o.x, 2 * g!.y - o.y)), 9);
        }
      }
    }
    expect(defined).toBeGreaterThan(10);
  });
});

describe("firstBallOnLine", () => {
  const cue = p(0, 0);
  const ball = (id: string, x: number, y: number, radiusM = R) => ({ id, x, y, radiusM });

  test("picks the nearer of two balls on the line", () => {
    const hit = firstBallOnLine(cue, 0, R, [ball("far", 2, 0), ball("near", 1, 0)]);
    expect(hit?.id).toBe("near");
    expect(hit?.distance).toBeCloseTo(1 - 2 * R, 12);
    expect(hit?.ghost.x).toBeCloseTo(1 - 2 * R, 12);
    expect(hit?.ghost.y).toBeCloseTo(0, 12);
  });

  test("ghost is the sum of radii from the hit ball, with mixed radii", () => {
    const b = ball("b", 0.8, 0.02, 0.02);
    const hit = firstBallOnLine(cue, 0, R, [b]);
    expect(hit).toBeDefined();
    expect(distance(hit?.ghost as Point, b)).toBeCloseTo(R + 0.02, 12);
  });

  test("ignores balls behind the cue ball", () => {
    expect(firstBallOnLine(cue, 0, R, [ball("behind", -1, 0)])).toBeUndefined();
    expect(firstBallOnLine(cue, 0, R, [ball("behind", -1, 0), ball("ahead", 1, 0)])?.id).toBe(
      "ahead",
    );
  });

  test("ignores balls the line misses by more than the sum of radii", () => {
    expect(firstBallOnLine(cue, 0, R, [ball("wide", 1, 2 * R + 0.001)])).toBeUndefined();
    const graze = firstBallOnLine(cue, 0, R, [ball("close", 1, 2 * R - 0.001)]);
    expect(graze?.id).toBe("close");
    expect(distance(graze?.ghost as Point, p(1, 2 * R - 0.001))).toBeCloseTo(2 * R, 12);
  });

  test("works at an angle and with no balls", () => {
    const hit = firstBallOnLine(p(1, 1), Math.PI / 2, R, [ball("up", 1, 2)]);
    expect(hit?.ghost.x).toBeCloseTo(1, 12);
    expect(hit?.ghost.y).toBeCloseTo(2 - 2 * R, 12);
    expect(firstBallOnLine(cue, 0, R, [])).toBeUndefined();
  });
});
