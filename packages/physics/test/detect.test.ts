import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  NO_CROSSING,
  PENETRATION_TOL_M,
  ballArcTime,
  ballBallTime,
  ballPocketTime,
  ballSegmentTime,
} from "../src/detect";
import type { Kinematics } from "../src/detect";
import type { CushionArc, CushionSegment, PocketZone } from "../src/index";

function kin(x: number, y: number, vx = 0, vy = 0, ax = 0, ay = 0): Kinematics {
  return { x, y, vx, vy, ax, ay };
}

function at(k: Kinematics, t: number): { x: number; y: number } {
  return { x: k.x + t * (k.vx + 0.5 * k.ax * t), y: k.y + t * (k.vy + 0.5 * k.ay * t) };
}

const D = 0.1;

describe("ballBallTime", () => {
  test("head-on at constant speed", () => {
    expect(ballBallTime(kin(0, 0, 1, 0), kin(1, 0), D, 10)).toBeCloseTo(0.9, 13);
  });

  test("head-on with deceleration", () => {
    // 0.9 = t - 0.25 t^2  ->  t = 2 (1 - sqrt(0.1))
    const t = ballBallTime(kin(0, 0, 1, 0, -0.5, 0), kin(1, 0), D, 10);
    expect(t).toBeCloseTo(2 * (1 - Math.sqrt(0.1)), 13);
  });

  test("a decelerating ball that stops short never arrives", () => {
    // Travels at most v^2 / (2a) = 0.5 < 0.9.
    expect(ballBallTime(kin(0, 0, 1, 0, -1, 0), kin(1, 0), D, 1)).toBe(NO_CROSSING);
  });

  test("both moving", () => {
    expect(ballBallTime(kin(0, 0, 1, 0), kin(1, 0, -1, 0), D, 10)).toBeCloseTo(0.45, 13);
  });

  test("argument order does not matter", () => {
    const a = kin(0, 0.02, 1.3, 0.1, -0.2, 0);
    const b = kin(0.8, 0, -0.4, 0, 0.1, 0);
    expect(ballBallTime(a, b, D, 10)).toBe(ballBallTime(b, a, D, 10));
  });

  test("a miss and a cut hit", () => {
    expect(ballBallTime(kin(0, 0.1001, 1, 0), kin(1, 0), D, 10)).toBe(NO_CROSSING);
    // Offset by half the contact distance: contact when dx = D * sqrt(3)/2.
    const t = ballBallTime(kin(0, 0.05, 1, 0), kin(1, 0), D, 10);
    expect(t).toBeCloseTo(1 - (D * Math.sqrt(3)) / 2, 13);
  });

  test("respects the window", () => {
    expect(ballBallTime(kin(0, 0, 1, 0), kin(1, 0), D, 0.89)).toBe(NO_CROSSING);
  });

  test("touching balls: closing collides now, separating and resting do not", () => {
    expect(ballBallTime(kin(0, 0, 1, 0), kin(D, 0), D, 5)).toBe(0);
    expect(ballBallTime(kin(0, 0, -1, 0), kin(D, 0), D, 5)).toBe(NO_CROSSING);
    expect(ballBallTime(kin(0, 0), kin(D, 0), D, 5)).toBe(NO_CROSSING);
    // Sliding past each other tangentially.
    expect(ballBallTime(kin(0, 0, 0, 1), kin(D, 0), D, 5)).toBe(NO_CROSSING);
  });

  test("touching balls with slightly overlapping input still collide when driven together", () => {
    expect(ballBallTime(kin(0, 0, 1, 0), kin(D - 1e-5, 0), D, 5)).toBe(0);
  });

  test("touching, same speed, but the back ball decelerates less: contact after the penetration bound", () => {
    const t = ballBallTime(kin(0, 0, 1, 0, -0.1, 0), kin(D, 0, 1, 0, -2, 0), D, 0.4);
    expect(t).toBeGreaterThan(0);
    // Gap shrinks as 0.95 t^2; it reaches the bound at sqrt(tol / 0.95).
    expect(t).toBeCloseTo(Math.sqrt(PENETRATION_TOL_M / 0.95), 6);
  });

  test("random pairs: at the reported time the balls are touching, and never overlap before", () => {
    const c = fc.double({ min: -2, max: 2, noNaN: true });
    const acc = fc.double({ min: -1, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        c,
        c,
        c,
        c,
        acc,
        acc,
        c,
        c,
        c,
        c,
        acc,
        acc,
        (x1, y1, vx1, vy1, ax1, ay1, x2, y2, vx2, vy2, ax2, ay2) => {
          const a = kin(x1, y1, vx1, vy1, ax1, ay1);
          const b = kin(x2, y2, vx2, vy2, ax2, ay2);
          const gap = (t: number): number => {
            const p = at(a, t);
            const q = at(b, t);
            return Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)) - D;
          };
          fc.pre(gap(0) > 1e-3);
          const T = 2;
          const t = ballBallTime(a, b, D, T);
          const end = t === NO_CROSSING ? T : t;
          for (let i = 0; i <= 400; i++) {
            expect(gap((i / 400) * end)).toBeGreaterThan(-1e-9);
          }
          if (t !== NO_CROSSING) expect(Math.abs(gap(t))).toBeLessThan(1e-11);
        },
      ),
      { numRuns: 1500 },
    );
  }, 60_000);
});

// Left rail: nose line x = 0 for y in [0, 1], balls live at x > 0.
const RAIL: CushionSegment = {
  id: "rail",
  a: { x: 0, y: 0 },
  b: { x: 0, y: 1 },
  normal: { x: 1, y: 0 },
};
const DC = 0.05;

describe("ballSegmentTime", () => {
  test("square approach", () => {
    expect(ballSegmentTime(kin(0.5, 0.5, -1, 0), RAIL, DC, 10)).toBeCloseTo(0.45, 14);
  });

  test("angled approach with deceleration", () => {
    const b = kin(0.5, 0.2, -1, 0.5, 0.4, -0.2);
    const t = ballSegmentTime(b, RAIL, DC, 10);
    expect(at(b, t).x).toBeCloseTo(DC, 13);
    expect(t).toBeGreaterThan(0.45);
  });

  test("no contact when moving away, parallel, or stopping short", () => {
    expect(ballSegmentTime(kin(0.5, 0.5, 1, 0), RAIL, DC, 10)).toBe(NO_CROSSING);
    expect(ballSegmentTime(kin(0.5, 0.5, 0, 1), RAIL, DC, 10)).toBe(NO_CROSSING);
    expect(ballSegmentTime(kin(0.5, 0.5, -1, 0, 2, 0), RAIL, DC, 10)).toBe(NO_CROSSING);
  });

  test("contact beyond the ends of the segment is not this segment's", () => {
    expect(ballSegmentTime(kin(0.5, 1.5, -1, 0), RAIL, DC, 10)).toBe(NO_CROSSING);
    expect(ballSegmentTime(kin(0.5, -0.2, -1, 0), RAIL, DC, 10)).toBe(NO_CROSSING);
    // Exactly at the end counts.
    expect(ballSegmentTime(kin(0.5, 1, -1, 0), RAIL, DC, 10)).toBeCloseTo(0.45, 14);
  });

  test("a ball behind the nose line is ignored", () => {
    expect(ballSegmentTime(kin(-0.2, 0.5, -1, 0), RAIL, DC, 10)).toBe(NO_CROSSING);
    expect(ballSegmentTime(kin(-0.2, 0.5, 1, 0), RAIL, DC, 10)).toBe(NO_CROSSING);
  });

  test("a ball frozen to the cushion: into it collides now, along or away does not", () => {
    expect(ballSegmentTime(kin(DC, 0.5, -1, 0.3), RAIL, DC, 10)).toBe(0);
    expect(ballSegmentTime(kin(DC, 0.5, 0, 1), RAIL, DC, 10)).toBe(NO_CROSSING);
    expect(ballSegmentTime(kin(DC, 0.5, 1, 0), RAIL, DC, 10)).toBe(NO_CROSSING);
    expect(ballSegmentTime(kin(DC, 0.5), RAIL, DC, 10)).toBe(NO_CROSSING);
  });
});

// Quarter arc of radius 0.02 around the origin covering directions from +x to +y.
const ARC: CushionArc = {
  id: "arc",
  centre: { x: 0, y: 0 },
  radiusM: 0.02,
  from: { x: 1, y: 0 },
  to: { x: 0, y: 1 },
};

describe("ballArcTime", () => {
  test("straight at the middle of the arc", () => {
    const h = Math.SQRT1_2;
    const t = ballArcTime(kin(h, h, -h, -h), ARC, DC, 10);
    expect(t).toBeCloseTo(1 - (ARC.radiusM + DC), 13);
  });

  test("contact outside the arc's angular range is ignored", () => {
    const h = Math.SQRT1_2;
    // Arriving from the opposite quadrant: touches only the phantom part of the circle.
    expect(ballArcTime(kin(-h, -h, h, h), ARC, DC, 10)).toBe(NO_CROSSING);
    // Arriving along -y towards the +x end: contact direction is below the +x axis.
    expect(ballArcTime(kin(0.06, -1, 0, 1), ARC, DC, 10)).toBe(NO_CROSSING);
  });

  test("the ends of the arc count", () => {
    expect(ballArcTime(kin(1, 0, -1, 0), ARC, DC, 10)).toBeCloseTo(1 - 0.07, 13);
    expect(ballArcTime(kin(0, 1, 0, -1), ARC, DC, 10)).toBeCloseTo(1 - 0.07, 13);
  });

  test("a sharp point (radius 0) is hit at the contact distance", () => {
    const point: CushionArc = { ...ARC, radiusM: 0 };
    const h = Math.SQRT1_2;
    expect(ballArcTime(kin(h, h, -h, -h), point, DC, 10)).toBeCloseTo(1 - DC, 13);
  });

  test("a glancing pass that misses", () => {
    expect(ballArcTime(kin(1, 0.0701, -1, 0), ARC, DC, 10)).toBe(NO_CROSSING);
  });
});

const POCKET: PocketZone = { id: "corner-bl", centre: { x: 0, y: 0 }, radiusM: 0.06 };

describe("ballPocketTime", () => {
  test("a ball rolling in drops when its centre reaches the circle", () => {
    expect(ballPocketTime(kin(1, 0, -1, 0), POCKET, 10)).toBeCloseTo(0.94, 13);
  });

  test("a ball already inside drops at once, whatever its motion", () => {
    expect(ballPocketTime(kin(0.01, 0.01), POCKET, 10)).toBe(0);
    expect(ballPocketTime(kin(0.01, 0.01, 1, 1), POCKET, 10)).toBe(0);
    expect(ballPocketTime(kin(0.01, 0.01), POCKET, 0)).toBe(0);
  });

  test("a ball passing by or stopping short does not drop", () => {
    expect(ballPocketTime(kin(1, 0.07, -1, 0), POCKET, 10)).toBe(NO_CROSSING);
    expect(ballPocketTime(kin(1, 0, -1, 0, 1, 0), POCKET, 1)).toBe(NO_CROSSING);
    expect(ballPocketTime(kin(1, 0), POCKET, 10)).toBe(NO_CROSSING);
  });
});
