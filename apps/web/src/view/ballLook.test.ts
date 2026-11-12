import { BALL_SETS } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { LOW_CONFIDENCE, ballLook, ballName, isLowConfidence, stripePath } from "./ballLook";

describe("ballLook", () => {
  describe.each(BALL_SETS.map((s) => [s.id, s] as const))("%s", (_id, set) => {
    test.each(set.kinds.map((k) => k.kind))("%s has a real colour", (kind) => {
      const look = ballLook(kind);
      expect(look.colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(look.colour).not.toBe("#888888");
    });
  });

  test("stripes are 9 to 15 only", () => {
    for (let n = 1; n <= 15; n++) expect(ballLook(String(n)).striped).toBe(n >= 9);
    for (const k of ["cue", "red", "yellow", "green", "brown", "blue", "pink", "black"]) {
      expect(ballLook(k).striped).toBe(false);
    }
  });

  test("labels are on numbered balls only", () => {
    for (let n = 1; n <= 15; n++) expect(ballLook(String(n)).label).toBe(String(n));
    for (const k of ["cue", "red", "yellow", "black"]) expect(ballLook(k).label).toBe("");
  });

  test("a stripe shares its colour with the solid 8 below it", () => {
    expect(ballLook("9").colour).toBe(ballLook("1").colour);
    expect(ballLook("15").colour).toBe(ballLook("7").colour);
  });

  test("names", () => {
    expect(ballName("9")).toBe("9 ball");
    expect(ballName("cue")).toBe("cue ball");
    expect(ballName("red")).toBe("red ball");
  });

  test("low confidence is below the threshold, and absent means certain", () => {
    expect(isLowConfidence(undefined)).toBe(false);
    expect(isLowConfidence(LOW_CONFIDENCE)).toBe(false);
    expect(isLowConfidence(LOW_CONFIDENCE - 0.01)).toBe(true);
  });

  test("stripe path is a closed band inside the ball", () => {
    const d = stripePath(1, 0.5);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toContain("NaN");
  });
});
