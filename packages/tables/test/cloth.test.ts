import { describe, expect, test } from "vitest";
import { CLOTH_COLOURS, CLOTH_SPEEDS, makeCloth } from "../src/presets/cloth";
import type { ClothSpeed } from "../src/types";

const speeds: ClothSpeed[] = ["slow", "medium", "fast"];

describe("cloth colours", () => {
  test("seven colours with unique ids and valid hex", () => {
    expect(CLOTH_COLOURS).toHaveLength(7);
    const ids = CLOTH_COLOURS.map((c) => c.id);
    expect(new Set(ids).size).toBe(7);
    for (const c of CLOTH_COLOURS) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.name.length).toBeGreaterThan(0);
    }
    expect(ids).toEqual(
      expect.arrayContaining([
        "green",
        "blue",
        "tournament-blue",
        "red",
        "grey",
        "black",
        "purple",
      ]),
    );
  });
});

describe("cloth speeds", () => {
  test.each(speeds)("%s coefficients are positive and finite", (speed) => {
    for (const v of Object.values(CLOTH_SPEEDS[speed])) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  test("rolling resistance strictly decreases slow -> medium -> fast", () => {
    expect(CLOTH_SPEEDS.slow.rollingResistance).toBeGreaterThan(
      CLOTH_SPEEDS.medium.rollingResistance,
    );
    expect(CLOTH_SPEEDS.medium.rollingResistance).toBeGreaterThan(
      CLOTH_SPEEDS.fast.rollingResistance,
    );
  });

  test("values lie in published ranges", () => {
    for (const speed of speeds) {
      const c = CLOTH_SPEEDS[speed];
      expect(c.rollingResistance).toBeGreaterThanOrEqual(0.005);
      expect(c.rollingResistance).toBeLessThanOrEqual(0.015);
      expect(c.slidingFriction).toBeGreaterThanOrEqual(0.15);
      expect(c.slidingFriction).toBeLessThanOrEqual(0.4);
      // Spin deceleration 5 * mu * g / (2R) with R = 0.028575 m should be 5-15 rad/s^2.
      const alpha = (5 * c.spinningFriction * 9.80665) / (2 * 0.028575);
      expect(alpha).toBeGreaterThanOrEqual(4.9);
      expect(alpha).toBeLessThanOrEqual(15.1);
    }
  });
});

describe("makeCloth", () => {
  test.each(speeds)("builds a %s cloth with no nap", (speed) => {
    const cloth = makeCloth("#1f6b3a", speed);
    expect(cloth).toEqual({
      colour: "#1f6b3a",
      speedPreset: speed,
      ...CLOTH_SPEEDS[speed],
    });
    expect("nap" in cloth).toBe(false);
  });
});
