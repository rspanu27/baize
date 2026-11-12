import { describe, expect, test } from "vitest";
import { shade } from "./shade";

describe("shade", () => {
  test("darkens towards black and lightens towards white", () => {
    expect(shade("#ffffff", -0.5)).toBe("#808080");
    expect(shade("#000000", 0.5)).toBe("#808080");
    expect(shade("#1d7a5f", 0)).toBe("#1d7a5f");
  });

  test("accepts the short form and any case", () => {
    expect(shade("#fff", -1)).toBe("#000000");
    expect(shade("#ABC", 0)).toBe("#aabbcc");
  });

  test("clamps the amount", () => {
    expect(shade("#336699", -5)).toBe("#000000");
    expect(shade("#336699", 5)).toBe("#ffffff");
    expect(shade("#336699", Number.NaN)).toBe("#336699");
  });

  test("leaves something that is not a hex colour alone", () => {
    expect(shade("green", -0.2)).toBe("green");
  });
});
