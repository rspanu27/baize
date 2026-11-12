import { describe, expect, test } from "vitest";
import {
  MPS_PER_MPH,
  METRES_PER_INCH,
  defaultUnitSystem,
  formatAngle,
  formatDistance,
  formatLength,
  formatSpeed,
  parseLength,
} from "./units";

describe("constants", () => {
  test("exact conversion factors", () => {
    expect(METRES_PER_INCH).toBe(0.0254);
    expect(MPS_PER_MPH).toBe(0.44704);
  });
});

describe("formatLength", () => {
  test("metric", () => {
    expect(formatLength(0.0525, "metric")).toBe("52.5 mm");
    expect(formatLength(0.737, "metric")).toBe("737 mm");
    expect(formatLength(3.569, "metric")).toBe("3.569 m");
    expect(formatLength(1, "metric")).toBe("1 m");
    expect(formatLength(0.99999, "metric")).toBe("1 m");
  });

  test("imperial", () => {
    expect(formatLength(2.25 * 0.0254, "imperial")).toBe("2.25 in");
    expect(formatLength(100 * 0.0254, "imperial")).toBe("8 ft 4 in");
    expect(formatLength(108 * 0.0254, "imperial")).toBe("9 ft");
    expect(formatLength(12 * 0.0254, "imperial")).toBe("1 ft");
    expect(formatLength(11.999 * 0.0254, "imperial")).toBe("1 ft");
    expect(formatLength(99.5 * 0.0254, "imperial")).toBe("8 ft 3.5 in");
  });

  test("precision override", () => {
    expect(formatLength(0.0525, "metric", { precision: 0 })).toBe("53 mm");
    expect(formatLength(3.569, "metric", { precision: 1 })).toBe("3.6 m");
    expect(formatLength(2.256 * 0.0254, "imperial", { precision: 3 })).toBe("2.256 in");
  });
});

describe("formatDistance", () => {
  test("metric", () => {
    expect(formatDistance(0.86, "metric")).toBe("86 cm");
    expect(formatDistance(1.24, "metric")).toBe("1.24 m");
    expect(formatDistance(0.999, "metric")).toBe("1 m");
  });
  test("imperial", () => {
    expect(formatDistance(20.5 * 0.0254, "imperial")).toBe("20.5 in");
    expect(formatDistance(4.1 * 12 * 0.0254, "imperial")).toBe("4.1 ft");
  });
});

describe("formatSpeed", () => {
  test("both systems", () => {
    expect(formatSpeed(2.4, "metric")).toBe("2.4 m/s");
    expect(formatSpeed(5.4 * 0.44704, "imperial")).toBe("5.4 mph");
  });
});

describe("formatAngle", () => {
  test("degrees", () => {
    expect(formatAngle((33.7 * Math.PI) / 180)).toBe("33.7°");
    expect(formatAngle(Math.PI / 4)).toBe("45°");
    expect(formatAngle(Math.PI / 6, 3)).toBe("30°");
  });
  test("normalises negative zero", () => {
    expect(formatAngle(-0)).toBe("0°");
    expect(formatAngle(-1e-9)).toBe("0°");
  });
});

describe("parseLength", () => {
  const mm = (x: number) => x / 1000;
  const inch = (x: number) => x * 0.0254;
  const ft = (x: number) => x * 12 * 0.0254;
  const metric = (t: string) => parseLength(t, "metric");
  const imperial = (t: string) => parseLength(t, "imperial");

  test("plain numbers use the current system", () => {
    expect(metric("3569")).toBeCloseTo(mm(3569), 12);
    expect(imperial("100")).toBeCloseTo(inch(100), 12);
  });

  test("metric units", () => {
    for (const system of ["metric", "imperial"] as const) {
      expect(parseLength("3569mm", system)).toBeCloseTo(3.569, 12);
      expect(parseLength("3569 mm", system)).toBeCloseTo(3.569, 12);
      expect(parseLength("356.9 cm", system)).toBeCloseTo(3.569, 12);
      expect(parseLength("3.569 m", system)).toBeCloseTo(3.569, 12);
      expect(parseLength("  3.569   M ", system)).toBeCloseTo(3.569, 12);
    }
  });

  test("decimal comma", () => {
    expect(metric("3,569 m")).toBeCloseTo(3.569, 12);
    expect(metric("3,569")).toBeCloseTo(3.569, 12);
    expect(metric("52,5 mm")).toBeCloseTo(0.0525, 12);
    expect(metric("3,5 m")).toBeCloseTo(3.5, 12);
  });

  test("inches and feet", () => {
    for (const system of ["metric", "imperial"] as const) {
      expect(parseLength("100 in", system)).toBeCloseTo(inch(100), 12);
      expect(parseLength('100"', system)).toBeCloseTo(inch(100), 12);
      expect(parseLength("8 ft", system)).toBeCloseTo(ft(8), 12);
      expect(parseLength("8'", system)).toBeCloseTo(ft(8), 12);
      expect(parseLength("8 ft 4 in", system)).toBeCloseTo(inch(100), 12);
      expect(parseLength("8' 4\"", system)).toBeCloseTo(inch(100), 12);
      expect(parseLength("8ft4", system)).toBeCloseTo(inch(100), 12);
      expect(parseLength("8.5 ft", system)).toBeCloseTo(ft(8.5), 12);
      expect(parseLength("8 FT 4 IN", system)).toBeCloseTo(inch(100), 12);
    }
  });

  test("fractions", () => {
    expect(imperial("2 1/4 in")).toBeCloseTo(inch(2.25), 12);
    expect(imperial('2-1/4"')).toBeCloseTo(inch(2.25), 12);
    expect(imperial("1/2 in")).toBeCloseTo(inch(0.5), 12);
    expect(imperial("8 ft 2 1/2 in")).toBeCloseTo(inch(98.5), 12);
  });

  test("rejects", () => {
    for (const bad of [
      "",
      "   ",
      "abc",
      "-5",
      "-5 mm",
      "0",
      "0 mm",
      "5 furlongs",
      "1/0 in",
      "8 4",
      "8 in 4 ft",
      "5 mm 5 mm",
      "1 ft 2 in 3 in",
      "--",
      "3.5.2",
    ]) {
      expect(metric(bad), bad).toBeUndefined();
      expect(imperial(bad), bad).toBeUndefined();
    }
  });
});

describe("round trips", () => {
  const metricValues = [0.0005, 0.0262, 0.0525, 0.2, 0.737, 0.9, 1, 1.2345, 1.994, 2.5, 3.569];
  const imperialValues = [0.001, 0.0286, 0.05715, 0.2, 0.3, 0.3048, 0.5, 1.2, 1.994, 2.5, 3.569];

  test("metric", () => {
    for (const x of metricValues) {
      const back = parseLength(formatLength(x, "metric"), "metric");
      expect(back, String(x)).toBeDefined();
      expect(Math.abs((back ?? 0) - x)).toBeLessThanOrEqual(x < 1 ? 5.1e-5 : 5.1e-4);
    }
  });

  test("imperial", () => {
    for (const x of imperialValues) {
      const text = formatLength(x, "imperial");
      const back = parseLength(text, "imperial");
      expect(back, text).toBeDefined();
      const tol = (x / 0.0254 < 12 ? 0.0051 : 0.051) * 0.0254;
      expect(Math.abs((back ?? 0) - x)).toBeLessThanOrEqual(tol);
    }
  });

  test("a format in one system parses in the other", () => {
    for (const x of metricValues) {
      expect(parseLength(formatLength(x, "metric"), "imperial")).toBeCloseTo(x, 3);
    }
  });
});

describe("defaultUnitSystem", () => {
  test("by region", () => {
    expect(defaultUnitSystem("en-US")).toBe("imperial");
    expect(defaultUnitSystem("en_us")).toBe("imperial");
    expect(defaultUnitSystem("en-LR")).toBe("imperial");
    expect(defaultUnitSystem("my-MM")).toBe("imperial");
    expect(defaultUnitSystem("en-Latn-US")).toBe("imperial");
    expect(defaultUnitSystem("en-GB")).toBe("metric");
    expect(defaultUnitSystem("de")).toBe("metric");
    expect(defaultUnitSystem("")).toBe("metric");
  });
  test("without an argument returns a valid system", () => {
    expect(["metric", "imperial"]).toContain(defaultUnitSystem());
  });
});
