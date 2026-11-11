import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  classify,
  kineticEnergy,
  makeSegment,
  nextSegment,
  positionAt,
  slipVelocity,
  spinAt,
  velocityAt,
} from "../src/motion";
import type { MotionParams } from "../src/motion";
import type { Segment } from "../src/index";

const P: MotionParams = {
  slidingFriction: 0.2,
  rollingResistance: 0.01,
  spinningFriction: 0.0127,
  gravity: 9.80665,
};
const R = 0.028575;
const M = 0.163;
const O = { x: 0, y: 0 };
const NO_SPIN = { x: 0, y: 0, z: 0 };

function len(v: { x: number; y: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/** Runs a ball to rest and returns every segment. */
function run(first: Segment, radius = R, p = P): Segment[] {
  const out = [first];
  let s = first;
  for (let i = 0; i < 10 && Number.isFinite(s.duration); i++) {
    s = nextSegment(s, radius, p);
    out.push(s);
  }
  return out;
}

describe("classify", () => {
  test("states from kinematics", () => {
    expect(classify(O, NO_SPIN, R)).toBe("stationary");
    expect(classify(O, { x: 0, y: 0, z: 5 }, R)).toBe("spinning");
    expect(classify({ x: 1, y: 0 }, NO_SPIN, R)).toBe("sliding");
    // Natural roll along +x: wy = v / R.
    expect(classify({ x: 1, y: 0 }, { x: 0, y: 1 / R, z: 0 }, R)).toBe("rolling");
    // Natural roll along +y: wx = -v / R.
    expect(classify({ x: 0, y: 1 }, { x: -1 / R, y: 0, z: 3 }, R)).toBe("rolling");
    // At rest with backspin still on the ball: it will slide (draw).
    expect(classify(O, { x: 0, y: -20, z: 0 }, R)).toBe("sliding");
  });
});

describe("sliding", () => {
  test("stun shot: slides for 2v/(7 mu g), ends rolling at 5/7 of the speed", () => {
    const v0 = 2;
    const s = makeSegment(0, O, { x: v0, y: 0 }, NO_SPIN, R, P);
    expect(s.state).toBe("sliding");
    const T = (2 * v0) / (7 * P.slidingFriction * P.gravity);
    expect(s.duration).toBeCloseTo(T, 14);
    const next = nextSegment(s, R, P);
    expect(next.state).toBe("rolling");
    expect(next.v0.x).toBeCloseTo((5 / 7) * v0, 13);
    expect(next.v0.y).toBeCloseTo(0, 14);
    // Distance covered while sliding: 12 v^2 / (49 mu g).
    expect(next.r0.x).toBeCloseTo((12 * v0 * v0) / (49 * P.slidingFriction * P.gravity), 13);
    // Rolling constraint holds at the transition.
    expect(len(slipVelocity(next.v0, next.omega0, R))).toBeLessThan(1e-13);
  });

  test("slip direction is constant during a slide with side-on spin", () => {
    const s = makeSegment(0, O, { x: 1.5, y: 0.4 }, { x: 30, y: -12, z: 8 }, R, P);
    const u0 = slipVelocity(s.v0, s.omega0, R);
    for (const f of [0.1, 0.5, 0.9]) {
      const tau = f * s.duration;
      const u = slipVelocity(velocityAt(s, tau), spinAt(s, tau), R);
      expect((u.x * u0.y - u.y * u0.x) / (len(u) * len(u0))).toBeCloseTo(0, 12);
      expect(len(u)).toBeCloseTo(len(u0) * (1 - f), 12);
    }
  });

  test("draw: a ball with backspin and no speed moves backwards", () => {
    // Backspin for motion along +x is negative wy.
    const s = makeSegment(0, O, O, { x: 0, y: -50, z: 0 }, R, P);
    expect(s.state).toBe("sliding");
    const next = nextSegment(s, R, P);
    expect(next.state).toBe("rolling");
    expect(next.v0.x).toBeLessThan(0);
    // Final rolling speed is 2/7 of R * |w|.
    expect(next.v0.x).toBeCloseTo((-2 / 7) * R * 50, 13);
  });

  test("a rolling ball that loses speed in a collision speeds up again (follow)", () => {
    // Natural roll spin for 2 m/s, but only 0.1 m/s of speed left.
    const s = makeSegment(0, O, { x: 0.1, y: 0 }, { x: 0, y: 2 / R, z: 0 }, R, P);
    expect(s.state).toBe("sliding");
    expect(s.a.x).toBeGreaterThan(0);
    const next = nextSegment(s, R, P);
    expect(next.v0.x).toBeCloseTo((5 * 0.1 + 2 * 2) / 7, 13);
  });
});

describe("rolling", () => {
  test("rolls v^2 / (2 mu_r g) and stops", () => {
    const v0 = 1.2;
    const s = makeSegment(0, O, { x: 0, y: v0 }, { x: -v0 / R, y: 0, z: 0 }, R, P);
    expect(s.state).toBe("rolling");
    expect(s.duration).toBeCloseTo(v0 / (P.rollingResistance * P.gravity), 12);
    const next = nextSegment(s, R, P);
    expect(next.state).toBe("stationary");
    expect(next.r0.y).toBeCloseTo((v0 * v0) / (2 * P.rollingResistance * P.gravity), 12);
    expect(next.v0).toEqual({ x: 0, y: 0 });
    expect(next.duration).toBe(Number.POSITIVE_INFINITY);
  });

  test("the rolling constraint holds throughout", () => {
    const s = makeSegment(0, O, { x: 0.7, y: -0.3 }, NO_SPIN, R, P, "rolling");
    for (const f of [0, 0.3, 0.8, 1]) {
      const tau = f * s.duration;
      expect(len(slipVelocity(velocityAt(s, tau), spinAt(s, tau), R))).toBeLessThan(1e-14);
    }
  });

  test("ends spinning when vertical spin outlasts the roll", () => {
    const s = makeSegment(0, O, { x: 0.05, y: 0 }, { x: 0, y: 0.05 / R, z: 40 }, R, P);
    const segs = run(s);
    expect(segs.map((x) => x.state)).toEqual(["rolling", "spinning", "stationary"]);
  });
});

describe("vertical spin", () => {
  test("decays at 5 mu_sp g / (2R) and stops at zero without reversing", () => {
    const wz = 10;
    const s = makeSegment(0, O, O, { x: 0, y: 0, z: wz }, R, P);
    expect(s.state).toBe("spinning");
    const rate = (5 * P.spinningFriction * P.gravity) / (2 * R);
    expect(s.duration).toBeCloseTo(wz / rate, 12);
    expect(spinAt(s, s.duration / 2).z).toBeCloseTo(wz / 2, 12);
    expect(spinAt(s, s.duration * 3).z).toBe(0);
    const neg = makeSegment(0, O, O, { x: 0, y: 0, z: -wz }, R, P);
    expect(spinAt(neg, neg.duration / 2).z).toBeCloseTo(-wz / 2, 12);
    expect(spinAt(neg, neg.duration * 3).z).toBe(0);
  });

  test("side spin does not bend the path in this model", () => {
    const a = makeSegment(0, O, { x: 1, y: 0 }, NO_SPIN, R, P);
    const b = makeSegment(0, O, { x: 1, y: 0 }, { x: 0, y: 0, z: 60 }, R, P);
    expect(positionAt(b, 0.2)).toEqual(positionAt(a, 0.2));
  });
});

describe("cloth dependence", () => {
  test("faster cloth rolls further; slicker cloth slides longer", () => {
    const roll = (mu: number) => {
      const p = { ...P, rollingResistance: mu };
      const s = makeSegment(0, O, { x: 1, y: 0 }, NO_SPIN, R, p, "rolling");
      return nextSegment(s, R, p).r0.x;
    };
    expect(roll(0.005)).toBeGreaterThan(roll(0.01));
    expect(roll(0.01)).toBeGreaterThan(roll(0.015));
    const slide = (mu: number) =>
      makeSegment(0, O, { x: 1, y: 0 }, NO_SPIN, R, { ...P, slidingFriction: mu }).duration;
    expect(slide(0.18)).toBeGreaterThan(slide(0.22));
  });
});

describe("invariants over random states", () => {
  const speed = fc.double({ min: -8, max: 8, noNaN: true });
  const spin = fc.double({ min: -200, max: 200, noNaN: true });
  const radius = fc.double({ min: 0.0225, max: 0.0325, noNaN: true });
  const params = fc.record({
    slidingFriction: fc.double({ min: 0.05, max: 0.4, noNaN: true }),
    rollingResistance: fc.double({ min: 0.003, max: 0.03, noNaN: true }),
    spinningFriction: fc.double({ min: 0.003, max: 0.05, noNaN: true }),
    gravity: fc.constant(9.80665),
  });

  test("energy never rises, positions are continuous, every ball stops", () => {
    fc.assert(
      fc.property(speed, speed, spin, spin, spin, radius, params, (vx, vy, wx, wy, wz, rad, p) => {
        const segs = run(
          makeSegment(0, O, { x: vx, y: vy }, { x: wx, y: wy, z: wz }, rad, p),
          rad,
          p,
        );
        const last = segs[segs.length - 1] as Segment;
        expect(last.state).toBe("stationary");
        expect(segs.length).toBeLessThanOrEqual(4);
        let prevE = Number.POSITIVE_INFINITY;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i] as Segment;
          const steps = Number.isFinite(s.duration) ? 8 : 1;
          for (let k = 0; k <= steps; k++) {
            const tau = Number.isFinite(s.duration) ? (k / steps) * s.duration : 0;
            const e = kineticEnergy(M, rad, velocityAt(s, tau), spinAt(s, tau));
            expect(e).toBeLessThanOrEqual(prevE * (1 + 1e-12) + 1e-15);
            prevE = e;
          }
          const following = segs[i + 1];
          if (following) {
            const end = positionAt(s, s.duration);
            expect(following.r0.x).toBe(end.x);
            expect(following.r0.y).toBe(end.y);
            expect(following.t0).toBe(s.t0 + s.duration);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  test("identical input gives identical segments", () => {
    const a = run(makeSegment(0, O, { x: 1.3, y: -0.7 }, { x: 12, y: -40, z: 9 }, R, P));
    const b = run(makeSegment(0, O, { x: 1.3, y: -0.7 }, { x: 12, y: -40, z: 9 }, R, P));
    expect(a).toEqual(b);
  });
});
