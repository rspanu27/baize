import { POOL_SIGHT_SETBACK_M, TABLE_PRESETS } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { imageToTableAtHeight, projectPoint } from "../src/index";
import type { ImagePoint } from "../src/index";
import { sightPlaces, truthFromSights } from "./sights";
import type { SightGeometry } from "./sights";
import { cameraOf, seeded } from "./synthetic";
import type { Pose } from "./synthetic";

/**
 * The truth-maker for real photos is itself checked here, on sights projected through a
 * known camera: a truth that is wrong would make every figure measured with it wrong.
 */
describe("truth from the sights of a pool table", () => {
  const table = TABLE_PRESETS.find((t) => t.id === "pool-9@1");
  if (!table) throw new Error("no 9 ft pool table");
  const g: SightGeometry = {
    widthM: table.playingArea.widthM,
    lengthM: table.playingArea.lengthM,
    setbackM: POOL_SIGHT_SETBACK_M,
    railHeightM: table.cushion.noseHeightM,
    noseHeightM: table.cushion.noseHeightM,
  };
  const poses: Pose[] = [
    // From one end, as a player or a television camera sees it.
    {
      position: { x: 0.5, y: -1.6, z: 1.7 },
      target: { x: g.widthM / 2, y: g.lengthM / 2 },
      rollRad: 0.02,
      focalPx: 1500,
      widthPx: 1920,
      heightPx: 1080,
    },
    // From beyond a corner.
    {
      position: { x: -1.2, y: -1.0, z: 1.9 },
      target: { x: g.widthM / 2, y: g.lengthM / 2 },
      rollRad: -0.03,
      focalPx: 1400,
      widthPx: 1920,
      heightPx: 1080,
    },
    // From the side, nearly overhead.
    {
      position: { x: 3.0, y: 1.3, z: 4.5 },
      target: { x: g.widthM / 2, y: g.lengthM / 2 },
      rollRad: 0,
      focalPx: 2200,
      widthPx: 1920,
      heightPx: 1080,
    },
  ];

  function dotsOf(pose: Pose, noisePx: number, drop: number, seed: number): ImagePoint[] {
    const camera = cameraOf(pose);
    const rand = seeded(seed);
    const dots: ImagePoint[] = [];
    for (const s of sightPlaces(g)) {
      const p = projectPoint(camera, { ...s, z: g.railHeightM });
      if (!p) throw new Error("sight not seen");
      dots.push({ u: p.u + (rand() - 0.5) * 2 * noisePx, v: p.v + (rand() - 0.5) * 2 * noisePx });
    }
    // Shuffle (labels come in no order) and lose a few (hidden by a player).
    for (let i = dots.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [dots[i], dots[j]] = [dots[j] as ImagePoint, dots[i] as ImagePoint];
    }
    return dots.slice(drop);
  }

  /** Distance between a ball placed with the recovered camera and where it really is. */
  function ballError(pose: Pose, dots: ImagePoint[]): number {
    const truth = truthFromSights(dots, pose.widthPx, pose.heightPx, g);
    if (!truth) throw new Error("no truth");
    const r = table ? table.cushion.noseHeightM / 1.27 : 0;
    let worst = 0;
    for (const ball of [
      { x: 0.2, y: 0.3 },
      { x: g.widthM - 0.1, y: g.lengthM - 0.15 },
      { x: g.widthM / 2, y: g.lengthM / 2 },
    ]) {
      const seen = projectPoint(cameraOf(pose), { ...ball, z: r });
      const placed = seen ? imageToTableAtHeight(truth.camera, seen, r) : undefined;
      if (!placed) throw new Error("ball not placed");
      // Turned end for end is the same table: take the nearer of the two readings.
      const direct = Math.hypot(placed.x - ball.x, placed.y - ball.y);
      const turned = Math.hypot(g.widthM - placed.x - ball.x, g.lengthM - placed.y - ball.y);
      worst = Math.max(worst, Math.min(direct, turned));
    }
    return worst;
  }

  test.each(poses.map((p, i) => [i, p] as const))(
    "exact sights give the exact camera (view %i)",
    (_i, pose) => {
      const dots = dotsOf(pose, 0, 0, 1);
      const truth = truthFromSights(dots, pose.widthPx, pose.heightPx, g);
      expect(truth?.matched).toBe(18);
      expect(truth?.residualPx).toBeLessThan(1e-6);
      expect(ballError(pose, dots)).toBeLessThan(1e-6);
    },
  );

  test.each(poses.map((p, i) => [i, p] as const))(
    "with a pixel of noise and four sights hidden, balls are placed within 12 mm (view %i)",
    (i, pose) => {
      let made = 0;
      for (let seed = 0; seed < 12; seed++) {
        const dots = dotsOf(pose, 1, 4, 100 * i + seed);
        // A rail left with fewer than two sights cannot be found: no truth then, never a
        // wrong one.
        if (!truthFromSights(dots, pose.widthPx, pose.heightPx, g)) continue;
        made++;
        // Measured: up to 9 mm for the worst of three balls at this picture size. This is
        // the precision of the truth itself, about 0.35 % of the length of a 9 ft table.
        expect(ballError(pose, dots)).toBeLessThan(0.012);
      }
      expect(made).toBeGreaterThanOrEqual(6);
    },
  );

  test("too few sights give no truth rather than a guess", () => {
    const pose = poses[0] as Pose;
    expect(truthFromSights(dotsOf(pose, 0, 10, 3), pose.widthPx, pose.heightPx, g)).toBeUndefined();
  });
});
