import { expect, test } from "vitest";
import { ballSizeOf, noseContactDistanceM } from "../src/index";
import type { BallSetSpec } from "../src/index";

const set: BallSetSpec = {
  id: "test",
  name: "test",
  game: "blackball",
  kinds: [{ kind: "cue", count: 1 }],
  object: { diameterM: 0.0508, massKg: 0.1 },
  cue: { diameterM: 0.0476, massKg: 0.09 },
  restitution: 0.9,
};

test("ballSizeOf returns the cue size only for the cue ball", () => {
  expect(ballSizeOf(set, "cue")).toEqual(set.cue);
  expect(ballSizeOf(set, "red")).toEqual(set.object);
  expect(ballSizeOf({ ...set, cue: undefined }, "cue")).toEqual(set.object);
});

test("noseContactDistanceM equals the radius when the nose is at centre height", () => {
  expect(noseContactDistanceM(0.03, 0.03)).toBe(0.03);
  expect(noseContactDistanceM(0.03, 0.04)).toBeCloseTo(Math.sqrt(0.0009 - 0.0001), 15);
});
