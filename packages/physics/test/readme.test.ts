import { expect, test } from "vitest";
import { prepareTable, sampleAt, simulate } from "../src/index";

// Mirrors the example in README.md. If this changes, change the README too.
test("the README example runs and completes", () => {
  const table = prepareTable({
    playingArea: { lengthM: 2.54, widthM: 1.27 },
    pockets: {
      corner: {
        mouthM: 0.114,
        jawRadiusM: 0.002,
        facingAngleRad: 2.478,
        dropRadiusM: 0.066,
        dropSetbackM: 0.057,
      },
      middle: {
        mouthM: 0.127,
        jawRadiusM: 0.002,
        facingAngleRad: 1.815,
        dropRadiusM: 0.072,
        dropSetbackM: 0.064,
      },
    },
    cushion: { noseHeightM: 0.0363, restitution: 0.85, friction: 0.2 },
  });

  const result = simulate({
    table,
    cloth: { slidingFriction: 0.2, rollingResistance: 0.01, spinningFriction: 0.0127 },
    ballRestitution: 0.94,
    balls: [
      { id: "cue", radiusM: 0.028575, massKg: 0.163, x: 0.635, y: 0.6 },
      { id: "one", radiusM: 0.028575, massKg: 0.163, x: 0.7, y: 1.6 },
    ],
    shot: {
      ballId: "cue",
      aimAngleRad: 1.5,
      speedMps: 2,
      tipOffset: { side: 0, vertical: -0.2 },
    },
  });

  expect(result.status).toBe("complete");
  expect(result.events[0]?.type).toBe("strike");
  expect(result.events.some((e) => e.type === "ball-ball")).toBe(true);
  expect(result.tracks).toHaveLength(2);
  expect(sampleAt(result, 0.5)).toHaveLength(2);
});
