import { BALL_BALL_FRICTION } from "@baize/tables";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { frictionlessBallBall } from "../../src/models/ballBall";
import { frictionalBallBall } from "../../src/models/ballBallFriction";
import { kineticEnergy } from "../../src/motion";
import type { BallBallContact, Vec3 } from "../../src/index";

const R = 0.028575;
const M = 0.17;
const E = 0.94;
const DEG = Math.PI / 180;
const NO_SPIN: Vec3 = { x: 0, y: 0, z: 0 };

const model = frictionalBallBall(BALL_BALL_FRICTION);

function ball(vx: number, vy: number, spin: Vec3 = NO_SPIN, massKg = M, radiusM = R) {
  return { radiusM, massKg, velocity: { x: vx, y: vy }, spin } satisfies BallBallContact;
}

/** Line of centres for a cut: the striker moves along +x, the normal is turned by `cutDeg`. */
function cutNormal(cutDeg: number) {
  return { x: Math.cos(cutDeg * DEG), y: Math.sin(cutDeg * DEG) };
}

/**
 * Throw angle in degrees: how far the object ball's direction is from the line of centres.
 * Positive when it is thrown the way the striker was moving across it.
 */
function throwDeg(speed: number, cutDeg: number, spin: Vec3 = NO_SPIN): number {
  const n = cutNormal(cutDeg);
  const out = model.resolve(ball(speed, 0, spin), ball(0, 0), n, E);
  const v = out.b.velocity;
  // The striker's motion across the object ball: its velocity (+x) less the part along n.
  const tx = 1 - n.x * n.x;
  const ty = -n.x * n.y;
  const t = Math.hypot(tx, ty);
  const along = v.x * n.x + v.y * n.y;
  const across = (v.x * tx + v.y * ty) / t;
  return Math.atan2(across, along) / DEG;
}

describe("ball-ball model with friction", () => {
  test("a full-ball stun hit has nothing rubbing: same as the frictionless model", () => {
    const n = { x: 1, y: 0 };
    const a = ball(2, 0);
    const b = ball(0, 0);
    expect(model.resolve(a, b, n, E)).toEqual(frictionlessBallBall.resolve(a, b, n, E));
  });

  test("a slow half-ball stun shot throws the object ball about four degrees", () => {
    // By hand: closing 0.866, J/m = 0.97 * 0.866 = 0.840; surfaces rub at 0.5 m/s, so
    // mu = 0.00995 + 0.108 exp(-0.544) = 0.0726; throw = atan(0.0726) = 4.15 degrees.
    expect(throwDeg(1, 30)).toBeCloseTo(4.15, 1);
    // The object ball picks up side spin from the rubbing; the cue ball had none.
    const out = model.resolve(ball(1, 0), ball(0, 0), cutNormal(30), E);
    expect(Math.abs(out.b.spin.z)).toBeGreaterThan(1);
    expect(out.a.spin.z).toBeCloseTo(out.b.spin.z, 12);
  });

  test("throw is in the direction the cue ball moves across the object ball", () => {
    for (const cut of [10, 30, 50, -10, -30, -50]) {
      expect(throwDeg(1.5, cut)).toBeGreaterThan(0.5);
    }
    // Mirror symmetry.
    expect(throwDeg(1.5, 30)).toBeCloseTo(throwDeg(1.5, -30), 12);
  });

  test("fast shots are thrown less than slow ones", () => {
    const slow = throwDeg(0.5, 30);
    const medium = throwDeg(2, 30);
    const fast = throwDeg(6, 30);
    expect(slow).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(fast);
    expect(fast).toBeGreaterThan(0);
    expect(fast).toBeLessThan(1.5);
  });

  test("gearing outside side spin cancels the throw", () => {
    // The surfaces do not rub when R w_z equals the sideways speed, v sin(cut).
    const v = 1.2;
    const gearing = (v * Math.sin(30 * DEG)) / R;
    expect(throwDeg(v, 30, { x: 0, y: 0, z: gearing })).toBeCloseTo(0, 10);
    // More than gearing throws the other way. Inside side throws the same way as no side, but
    // not more: the surfaces rub faster, and friction falls with that speed.
    expect(throwDeg(v, 30, { x: 0, y: 0, z: 2 * gearing })).toBeLessThan(-0.5);
    const inside = throwDeg(v, 30, { x: 0, y: 0, z: -gearing });
    expect(inside).toBeGreaterThan(1);
    expect(inside).toBeLessThan(throwDeg(v, 30));
  });

  test("side spin on a full-ball hit throws the object ball off the line of centres", () => {
    const n = { x: 1, y: 0 };
    const out = model.resolve(ball(1, 0, { x: 0, y: 0, z: 20 }), ball(0, 0), n, E);
    // Counter-clockwise spin: the cue ball's front surface moves towards +y, so the object
    // ball is pushed towards +y and turns clockwise.
    expect(out.b.velocity.y).toBeGreaterThan(0.01);
    expect(out.b.spin.z).toBeLessThan(0);
    expect(out.a.spin.z).toBeLessThan(20);
    expect(out.a.velocity.y).toBeCloseTo(-out.b.velocity.y, 14);
  });

  test("a rolling cue ball is thrown less than a stunned one (the rubbing is mostly vertical)", () => {
    const v = 1;
    // Rolling along +x: w = (0, v / R, 0).
    const rolling = throwDeg(v, 30, { x: 0, y: v / R, z: 0 });
    expect(rolling).toBeGreaterThan(0);
    expect(rolling).toBeLessThan(throwDeg(v, 30) * 0.8);
  });

  test("follow on a full-ball hit leaves the velocities alone and passes on a little spin", () => {
    const n = { x: 1, y: 0 };
    const a = ball(2, 0, { x: 0, y: 2 / R, z: 0 });
    const b = ball(0, 0);
    const out = model.resolve(a, b, n, E);
    const plain = frictionlessBallBall.resolve(a, b, n, E);
    expect(out.a.velocity).toEqual(plain.a.velocity);
    expect(out.b.velocity).toEqual(plain.b.velocity);
    // The cue ball loses some topspin; the object ball gets the opposite sense about y.
    expect(out.a.spin.y).toBeLessThan(a.spin.y);
    expect(out.a.spin.y).toBeGreaterThan(0.9 * a.spin.y);
    expect(out.b.spin.y).toBeLessThan(0);
  });

  test("friction never reverses the rubbing: tiny slip is stopped, not overshot", () => {
    // 1 mm/s of sideways slip under a hard hit: mu J would be far more than it takes to stop.
    const n = { x: 1, y: 0 };
    const out = model.resolve(ball(5, 0.001), ball(0, 0), n, E);
    const slipAfter =
      out.a.velocity.y - out.b.velocity.y + R * out.a.spin.z * n.x + R * out.b.spin.z * n.x;
    expect(Math.abs(slipAfter)).toBeLessThan(1e-12);
  });

  test("separating balls are left unchanged", () => {
    const a = ball(-1, 0.5, { x: 1, y: 2, z: 3 });
    const b = ball(0.3, 0);
    const out = model.resolve(a, b, { x: 1, y: 0 }, E);
    expect(out.a).toEqual({ velocity: a.velocity, spin: a.spin });
    expect(out.b).toEqual({ velocity: b.velocity, spin: b.spin });
  });

  test("bad friction values are refused", () => {
    expect(() => frictionalBallBall({ a: -0.1, b: 0, c: 1 })).toThrow();
    expect(() => frictionalBallBall({ a: 0.1, b: Number.NaN, c: 1 })).toThrow();
    expect(() => frictionalBallBall({ a: 0, b: 0, c: 0 })).not.toThrow();
  });

  test("zero friction is the frictionless model", () => {
    const none = frictionalBallBall({ a: 0, b: 0, c: 1 });
    const a = ball(1.3, -0.4, { x: 5, y: -9, z: 30 });
    const b = ball(-0.2, 0.1, { x: 1, y: 1, z: -4 });
    const n = cutNormal(20);
    const out = none.resolve(a, b, n, E);
    const plain = frictionlessBallBall.resolve(a, b, n, E);
    expect(out.a.velocity.x).toBeCloseTo(plain.a.velocity.x, 14);
    expect(out.b.velocity.y).toBeCloseTo(plain.b.velocity.y, 14);
    expect(out.a.spin).toEqual(a.spin);
    expect(out.b.spin).toEqual(b.spin);
  });

  test("any collision: momentum conserved, energy never gained, results finite", () => {
    const speed = fc.double({ min: -8, max: 8, noNaN: true });
    const spin = fc.double({ min: -300, max: 300, noNaN: true });
    const state = fc.record({
      vx: speed,
      vy: speed,
      wx: spin,
      wy: spin,
      wz: spin,
      massKg: fc.double({ min: 0.09, max: 0.21, noNaN: true }),
      radiusM: fc.double({ min: 0.023, max: 0.03, noNaN: true }),
    });
    fc.assert(
      fc.property(
        state,
        state,
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (sa, sb, angle, e) => {
          const n = { x: Math.cos(angle), y: Math.sin(angle) };
          const a = ball(sa.vx, sa.vy, { x: sa.wx, y: sa.wy, z: sa.wz }, sa.massKg, sa.radiusM);
          const b = ball(sb.vx, sb.vy, { x: sb.wx, y: sb.wy, z: sb.wz }, sb.massKg, sb.radiusM);
          const out = model.resolve(a, b, n, e);
          const px = a.massKg * a.velocity.x + b.massKg * b.velocity.x;
          const py = a.massKg * a.velocity.y + b.massKg * b.velocity.y;
          const qx = a.massKg * out.a.velocity.x + b.massKg * out.b.velocity.x;
          const qy = a.massKg * out.a.velocity.y + b.massKg * out.b.velocity.y;
          expect(qx).toBeCloseTo(px, 12);
          expect(qy).toBeCloseTo(py, 12);
          const before =
            kineticEnergy(a.massKg, a.radiusM, a.velocity, a.spin) +
            kineticEnergy(b.massKg, b.radiusM, b.velocity, b.spin);
          const after =
            kineticEnergy(a.massKg, a.radiusM, out.a.velocity, out.a.spin) +
            kineticEnergy(b.massKg, b.radiusM, out.b.velocity, out.b.spin);
          expect(after).toBeLessThanOrEqual(before * (1 + 1e-12) + 1e-15);
          for (const v of [
            out.a.velocity.x,
            out.a.velocity.y,
            out.b.velocity.x,
            out.b.velocity.y,
            out.a.spin.x,
            out.a.spin.y,
            out.a.spin.z,
            out.b.spin.x,
            out.b.spin.y,
            out.b.spin.z,
          ]) {
            expect(Number.isFinite(v)).toBe(true);
          }
        },
      ),
      { numRuns: 3000 },
    );
  });

  test("the result is the same on every run (bit for bit)", () => {
    const a = ball(1.7, 0.3, { x: 12, y: -40, z: 25 });
    const b = ball(-0.4, 0.1, { x: 0, y: 3, z: -8 });
    const n = cutNormal(37);
    expect(model.resolve(a, b, n, E)).toEqual(model.resolve(a, b, n, E));
  });
});
