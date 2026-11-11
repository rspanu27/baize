import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { frictionlessBallBall } from "../../src/models/ballBall";
import { kineticEnergy } from "../../src/motion";
import type { BallBallContact } from "../../src/index";

function ball(vx: number, vy: number, massKg = 0.163, radiusM = 0.028575): BallBallContact {
  return { radiusM, massKg, velocity: { x: vx, y: vy }, spin: { x: 3, y: -7, z: 11 } };
}

const X = { x: 1, y: 0 };

describe("frictionless ball-ball model", () => {
  test("head-on, equal masses, e = 1: velocities swap", () => {
    const r = frictionlessBallBall.resolve(ball(2, 0), ball(0, 0), X, 1);
    expect(r.a.velocity).toEqual({ x: 0, y: 0 });
    expect(r.b.velocity).toEqual({ x: 2, y: 0 });
  });

  test("head-on with e < 1: striker keeps (1 - e) / 2 of its speed", () => {
    const e = 0.94;
    const r = frictionlessBallBall.resolve(ball(2, 0), ball(0, 0), X, e);
    expect(r.a.velocity.x).toBeCloseTo(1 - e, 14);
    expect(r.b.velocity.x).toBeCloseTo(1 + e, 14);
  });

  test("cut shot with e = 1: the two balls leave at 90 degrees (the 90 degree rule)", () => {
    // Half-ball hit: line of centres at 30 degrees to the striker's direction.
    const n = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
    const r = frictionlessBallBall.resolve(ball(1.5, 0), ball(0, 0), n, 1);
    const dot = r.a.velocity.x * r.b.velocity.x + r.a.velocity.y * r.b.velocity.y;
    expect(dot).toBeCloseTo(0, 14);
    // Object ball leaves along the line of centres.
    expect(r.b.velocity.x * n.y - r.b.velocity.y * n.x).toBeCloseTo(0, 14);
  });

  test("spins are untouched (no throw in v1)", () => {
    const a = ball(1, 0.2);
    const b = ball(0, 0);
    const r = frictionlessBallBall.resolve(a, b, X, 0.94);
    expect(r.a.spin).toEqual(a.spin);
    expect(r.b.spin).toEqual(b.spin);
  });

  test("separating or sliding-past balls are left unchanged", () => {
    const a = ball(-1, 0.5);
    const b = ball(0.3, 0);
    const r = frictionlessBallBall.resolve(a, b, X, 0.94);
    expect(r.a.velocity).toEqual(a.velocity);
    expect(r.b.velocity).toEqual(b.velocity);
    const tangent = frictionlessBallBall.resolve(ball(0, 1), ball(0, 0), X, 0.94);
    expect(tangent.a.velocity).toEqual({ x: 0, y: 1 });
  });

  test("a light cue ball bounces back off a heavier object ball", () => {
    const r = frictionlessBallBall.resolve(
      ball(1, 0, 0.094, 0.0238),
      ball(0, 0, 0.1145, 0.0254),
      X,
      1,
    );
    expect(r.a.velocity.x).toBeLessThan(0);
    expect(r.b.velocity.x).toBeGreaterThan(0);
  });

  test("perfectly inelastic (e = 0): no closing speed remains", () => {
    const r = frictionlessBallBall.resolve(ball(1, 0.3, 0.1), ball(-0.5, 0, 0.2), X, 0);
    expect(r.a.velocity.x - r.b.velocity.x).toBeCloseTo(0, 14);
    expect(r.a.velocity.y).toBe(0.3);
  });

  test("momentum is conserved, energy never rises, balls do not close afterwards", () => {
    const v = fc.double({ min: -10, max: 10, noNaN: true });
    const m = fc.double({ min: 0.08, max: 0.25, noNaN: true });
    fc.assert(
      fc.property(
        v,
        v,
        v,
        v,
        m,
        m,
        fc.double({ min: 0, max: 6.283, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (ax, ay, bx, by, ma, mb, angle, e) => {
          const n = { x: Math.cos(angle), y: Math.sin(angle) };
          const a = ball(ax, ay, ma);
          const b = ball(bx, by, mb);
          const r = frictionlessBallBall.resolve(a, b, n, e);
          const px = ma * ax + mb * bx;
          const py = ma * ay + mb * by;
          expect(ma * r.a.velocity.x + mb * r.b.velocity.x).toBeCloseTo(px, 12);
          expect(ma * r.a.velocity.y + mb * r.b.velocity.y).toBeCloseTo(py, 12);
          const before =
            kineticEnergy(ma, a.radiusM, a.velocity, a.spin) +
            kineticEnergy(mb, b.radiusM, b.velocity, b.spin);
          const after =
            kineticEnergy(ma, a.radiusM, r.a.velocity, r.a.spin) +
            kineticEnergy(mb, b.radiusM, r.b.velocity, r.b.spin);
          expect(after).toBeLessThanOrEqual(before * (1 + 1e-13) + 1e-15);
          const closing =
            (r.a.velocity.x - r.b.velocity.x) * n.x + (r.a.velocity.y - r.b.velocity.y) * n.y;
          expect(closing).toBeLessThanOrEqual(1e-12);
        },
      ),
      { numRuns: 3000 },
    );
  });
});
