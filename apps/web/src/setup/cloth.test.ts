import { CLOTH_SPEEDS, makeCloth } from "@baize/tables";
import { describe, expect, test } from "vitest";
import {
  napLevelOf,
  parseCoefficient,
  sameColour,
  withCoefficient,
  withColour,
  withNap,
  withSpeed,
} from "./cloth";

const base = makeCloth("#1f6b3a", "medium");

describe("withColour", () => {
  test("keeps coefficients, preset and nap", () => {
    const napped = withNap(base, "heavy");
    const next = withColour(napped, "#112233");
    expect(next).toEqual({ ...napped, colour: "#112233" });
    expect(base.colour).toBe("#1f6b3a");
  });
});

describe("withSpeed", () => {
  test.each(["slow", "medium", "fast"] as const)("%s sets the preset's exact numbers", (speed) => {
    const next = withSpeed({ ...base, speedPreset: "custom", slidingFriction: 0.31 }, speed);
    expect(next).toMatchObject({ ...CLOTH_SPEEDS[speed], speedPreset: speed, colour: base.colour });
  });
});

describe("withCoefficient", () => {
  test("marks the cloth custom and changes only that number", () => {
    const next = withCoefficient(base, "rollingResistance", 0.02);
    expect(next).toEqual({ ...base, rollingResistance: 0.02, speedPreset: "custom" });
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s with undefined", (v) => {
    expect(withCoefficient(base, "slidingFriction", v)).toBeUndefined();
  });
});

describe("withNap", () => {
  test("none removes the field", () => {
    const next = withNap(withNap(base, "light"), "none");
    expect("nap" in next).toBe(false);
  });

  test("light and heavy set strength with the baulk-to-top direction", () => {
    expect(withNap(base, "light").nap).toEqual({ directionRad: Math.PI / 2, strength: 0.5 });
    expect(withNap(base, "heavy").nap).toEqual({ directionRad: Math.PI / 2, strength: 1 });
  });

  test("napLevelOf reads the level back", () => {
    expect(napLevelOf(base)).toBe("none");
    expect(napLevelOf(withNap(base, "light"))).toBe("light");
    expect(napLevelOf(withNap(base, "heavy"))).toBe("heavy");
  });
});

describe("parseCoefficient", () => {
  test("accepts positive numbers only", () => {
    expect(parseCoefficient(" 0.2 ")).toBe(0.2);
    expect(parseCoefficient("0,01")).toBe(0.01);
    expect(parseCoefficient("1e-2")).toBe(0.01);
    for (const bad of ["", "abc", "0", "-0.1", "0.1.2", "NaN", "Infinity"]) {
      expect(parseCoefficient(bad)).toBeUndefined();
    }
  });
});

test("sameColour ignores case", () => {
  expect(sameColour("#ABCDEF", "#abcdef")).toBe(true);
  expect(sameColour("#abcdef", "#abcdee")).toBe(false);
});
