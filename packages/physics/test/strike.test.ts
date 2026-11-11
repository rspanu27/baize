import { describe, expect, test } from "vitest";
import { SimInputError } from "../src/index";
import type { ShotInput } from "../src/index";
import { classify, slipVelocity } from "../src/motion";
import { MAX_TIP_OFFSET, strike } from "../src/strike";

const R = 0.02625;

function shot(over: Partial<ShotInput> = {}): ShotInput {
  return {
    ballId: "cue",
    aimAngleRad: 0,
    speedMps: 2,
    tipOffset: { side: 0, vertical: 0 },
    ...over,
  };
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof SimInputError ? e.code : `other: ${String(e)}`;
  }
  return undefined;
}

describe("strike", () => {
  test("centre-ball hit: speed along the aim line, no spin (a stun start)", () => {
    const s = strike(R, shot());
    expect(s.velocity).toEqual({ x: 2, y: 0 });
    // Compare with +0 added so that -0 components equal 0.
    expect({ x: s.spin.x + 0, y: s.spin.y + 0, z: s.spin.z + 0 }).toEqual({ x: 0, y: 0, z: 0 });
    expect(classify(s.velocity, s.spin, R)).toBe("sliding");
  });

  test("aim angle is counter-clockwise from +x", () => {
    const up = strike(R, shot({ aimAngleRad: Math.PI / 2 }));
    expect(up.velocity.x).toBeCloseTo(0, 15);
    expect(up.velocity.y).toBe(2);
    const diag = strike(R, shot({ aimAngleRad: (3 * Math.PI) / 4 }));
    expect(diag.velocity.x).toBeCloseTo(-Math.SQRT2, 14);
    expect(diag.velocity.y).toBeCloseTo(Math.SQRT2, 14);
  });

  test("tip at 0.4 R above centre gives natural roll in any direction", () => {
    for (const angle of [0, 1, 2.5, -2]) {
      const s = strike(R, shot({ aimAngleRad: angle, tipOffset: { side: 0, vertical: 0.4 } }));
      const u = slipVelocity(s.velocity, s.spin, R);
      expect(Math.sqrt(u.x * u.x + u.y * u.y)).toBeLessThan(1e-14);
    }
  });

  test("below centre gives backspin: the contact point slips forwards faster than the ball", () => {
    const s = strike(R, shot({ tipOffset: { side: 0, vertical: -0.3 } }));
    const u = slipVelocity(s.velocity, s.spin, R);
    expect(u.x).toBeCloseTo(2 * (1 + 2.5 * 0.3), 13);
    expect(s.spin.y).toBeLessThan(0);
  });

  test("right-hand side gives counter-clockwise spin seen from above; left the opposite", () => {
    const right = strike(R, shot({ tipOffset: { side: 0.3, vertical: 0 } }));
    const left = strike(R, shot({ tipOffset: { side: -0.3, vertical: 0 } }));
    expect(right.spin.z).toBeCloseTo((2.5 * 2 * 0.3) / R, 12);
    expect(left.spin.z).toBe(-right.spin.z);
    // Side spin alone does not change the direction or the forward roll.
    expect(right.velocity).toEqual({ x: 2, y: 0 });
    expect(right.spin.y + 0).toBe(0);
  });

  test("spin scales with speed and inversely with radius", () => {
    const a = strike(R, shot({ tipOffset: { side: 0.2, vertical: 0.2 } }));
    const b = strike(2 * R, shot({ speedMps: 4, tipOffset: { side: 0.2, vertical: 0.2 } }));
    expect(b.spin.z).toBeCloseTo(a.spin.z, 12);
    expect(b.spin.y).toBeCloseTo(a.spin.y, 12);
  });

  test("rejects invalid shots with specific codes", () => {
    expect(code(() => strike(R, shot({ speedMps: 0 })))).toBe("invalid-shot");
    expect(code(() => strike(R, shot({ speedMps: Number.NaN })))).toBe("invalid-shot");
    expect(code(() => strike(R, shot({ aimAngleRad: Number.POSITIVE_INFINITY })))).toBe(
      "invalid-shot",
    );
    expect(code(() => strike(R, shot({ elevationRad: 0.1 })))).toBe("elevation-not-supported");
    expect(code(() => strike(R, shot({ elevationRad: 0 })))).toBeUndefined();
    expect(code(() => strike(R, shot({ tipOffset: { side: 0.4, vertical: 0.4 } })))).toBe(
      "tip-offset-too-large",
    );
    expect(
      code(() => strike(R, shot({ tipOffset: { side: MAX_TIP_OFFSET, vertical: 0 } }))),
    ).toBeUndefined();
  });

  test("is bit-identical across calls", () => {
    const s = shot({ aimAngleRad: 1.2345, tipOffset: { side: 0.11, vertical: -0.27 } });
    expect(strike(R, s)).toEqual(strike(R, s));
  });
});
