import { describe, expect, it } from "vitest";
import { BALL_SETS } from "../src/presets/balls";
import { CUE_BALL_COLOUR, UNKNOWN_BALL_COLOUR, ballAppearance } from "../src/presets/ballColours";

describe("ballAppearance", () => {
  it("every kind of every ball set has a real colour", () => {
    for (const set of BALL_SETS) {
      for (const { kind } of set.kinds) {
        const look = ballAppearance(kind);
        expect(look.colour, `${set.id} ${kind}`).toMatch(/^#[0-9a-f]{6}$/);
        expect(look.colour).not.toBe(UNKNOWN_BALL_COLOUR);
      }
    }
  });

  it("pool 9 to 15 are striped in the colour of the ball eight lower", () => {
    for (let n = 9; n <= 15; n++) {
      const stripe = ballAppearance(String(n));
      const solid = ballAppearance(String(n - 8));
      expect(stripe.striped).toBe(true);
      expect(solid.striped).toBe(false);
      expect(stripe.colour).toBe(solid.colour);
    }
    expect(ballAppearance("8")).toEqual({ colour: "#141414", striped: false });
  });

  it("the cue ball is off-white and snooker colours are distinct", () => {
    expect(ballAppearance("cue")).toEqual({ colour: CUE_BALL_COLOUR, striped: false });
    const kinds = ["red", "yellow", "green", "brown", "blue", "pink", "black"];
    expect(new Set(kinds.map((k) => ballAppearance(k).colour)).size).toBe(kinds.length);
  });

  it("an unknown kind gets the unknown colour", () => {
    expect(ballAppearance("16")).toEqual({ colour: UNKNOWN_BALL_COLOUR, striped: false });
    expect(ballAppearance("teal")).toEqual({ colour: UNKNOWN_BALL_COLOUR, striped: false });
  });
});
