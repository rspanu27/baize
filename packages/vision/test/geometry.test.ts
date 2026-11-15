import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  ASSUMED_FOCAL_PER_LONG_SIDE,
  apparentRadiusPx,
  cameraFromCorners,
  cameraFromHomography,
  homographyFromCorners,
  imageToTable,
  imageToTableAtHeight,
  invertHomography,
  projectPoint,
  tableToImage,
} from "../src/index";
import type { Camera, TableCorners } from "../src/index";
import { cameraOf, cornersSeen, seeded } from "./synthetic";
import type { Pose } from "./synthetic";

/**
 * The geometry of the photo import, checked against cameras whose position is known exactly.
 * Table sizes here are examples of playing areas (snooker 12 ft, pool 9 ft, a small table);
 * the code under test takes any size.
 */

const TABLES = [
  { widthM: 1.778, lengthM: 3.569, ballRadiusM: 0.02625 },
  { widthM: 1.27, lengthM: 2.54, ballRadiusM: 0.028575 },
  { widthM: 0.914, lengthM: 1.829, ballRadiusM: 0.0254 },
] as const;

/** A person standing near a corner or a side of the table with a phone. */
function standingPose(
  table: { widthM: number; lengthM: number },
  o: {
    azimuth: number;
    distance: number;
    height: number;
    tx: number;
    ty: number;
    roll: number;
    focal: number;
  },
): Pose {
  const cx = table.widthM / 2;
  const cy = table.lengthM / 2;
  const reach = Math.hypot(cx, cy) + o.distance;
  return {
    position: {
      x: cx + reach * Math.cos(o.azimuth),
      y: cy + reach * Math.sin(o.azimuth),
      z: o.height,
    },
    target: { x: table.widthM * o.tx, y: table.lengthM * o.ty },
    rollRad: o.roll,
    focalPx: o.focal * 4000,
    widthPx: 4000,
    heightPx: 3000,
  };
}

const poseArb = fc.record({
  table: fc.constantFrom(...TABLES),
  azimuth: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
  distance: fc.double({ min: 0.3, max: 2.5, noNaN: true }),
  height: fc.double({ min: 1.1, max: 2.4, noNaN: true }),
  tx: fc.double({ min: 0.3, max: 0.7, noNaN: true }),
  ty: fc.double({ min: 0.3, max: 0.7, noNaN: true }),
  roll: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
  focal: fc.double({ min: 0.55, max: 1.3, noNaN: true }),
  bx: fc.double({ min: 0.03, max: 0.97, noNaN: true }),
  by: fc.double({ min: 0.03, max: 0.97, noNaN: true }),
});

describe("homography of the cloth", () => {
  test("maps the four corners exactly, and back", () => {
    const table = TABLES[0];
    const camera = cameraOf(
      standingPose(table, {
        azimuth: 4,
        distance: 1,
        height: 1.7,
        tx: 0.5,
        ty: 0.5,
        roll: 0.05,
        focal: 0.75,
      }),
    );
    const corners = cornersSeen(camera, table.widthM, table.lengthM);
    const h = homographyFromCorners(corners, table.widthM, table.lengthM);
    if (!h) throw new Error("no homography");
    const hInverse = invertHomography(h);
    if (!hInverse) throw new Error("no inverse");
    const points = [
      { x: 0, y: 0 },
      { x: table.widthM, y: 0 },
      { x: table.widthM, y: table.lengthM },
      { x: 0, y: table.lengthM },
    ];
    points.forEach((p, i) => {
      const seen = tableToImage(h, p);
      expect(seen.u).toBeCloseTo((corners[i] as { u: number }).u, 6);
      expect(seen.v).toBeCloseTo((corners[i] as { v: number }).v, 6);
      const back = imageToTable(hInverse, seen);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    });
    // Any other point of the cloth agrees with the true camera too.
    const inside = { x: 0.4, y: 2.9 };
    const truth = projectPoint(camera, { ...inside, z: 0 });
    const viaH = tableToImage(h, inside);
    expect(viaH.u).toBeCloseTo(truth?.u ?? Number.NaN, 6);
    expect(viaH.v).toBeCloseTo(truth?.v ?? Number.NaN, 6);
  });

  test("corners that are not a quadrilateral give nothing", () => {
    const line: TableCorners = [
      { u: 0, v: 0 },
      { u: 100, v: 100 },
      { u: 200, v: 200 },
      { u: 300, v: 300 },
    ];
    expect(homographyFromCorners(line, 1.27, 2.54)).toBeUndefined();
    const same: TableCorners = [
      { u: 5, v: 5 },
      { u: 5, v: 5 },
      { u: 5, v: 5 },
      { u: 5, v: 5 },
    ];
    expect(homographyFromCorners(same, 1.27, 2.54)).toBeUndefined();
  });
});

describe("camera recovered from the corners", () => {
  test("random standing poses: focal length, position and a ball's place are recovered", () => {
    fc.assert(
      fc.property(poseArb, (o) => {
        const { table } = o;
        const truth = cameraOf(standingPose(table, o));
        const corners = cornersSeen(truth, table.widthM, table.lengthM);
        const h = homographyFromCorners(corners, table.widthM, table.lengthM);
        if (!h) throw new Error("no homography");
        const camera = cameraFromHomography(h, 4000, 3000);
        if (!camera) throw new Error("no camera");
        expect(camera.focalSource).toBe("estimated");
        expect(Math.abs(camera.focalPx / truth.focalPx - 1)).toBeLessThan(1e-6);
        expect(Math.abs(camera.position.x - truth.position.x)).toBeLessThan(1e-5);
        expect(Math.abs(camera.position.y - truth.position.y)).toBeLessThan(1e-5);
        expect(Math.abs(camera.position.z - truth.position.z)).toBeLessThan(1e-5);

        // A ball: its centre is one radius above the cloth.
        const ball = { x: o.bx * table.widthM, y: o.by * table.lengthM, z: table.ballRadiusM };
        const seen = projectPoint(truth, ball);
        if (!seen) throw new Error("ball behind the camera");
        const placed = imageToTableAtHeight(camera, seen, table.ballRadiusM);
        if (!placed) throw new Error("ray does not reach the ball's height");
        // Far inside the 1 mm of the done-check.
        expect(Math.hypot(placed.x - ball.x, placed.y - ball.y)).toBeLessThan(1e-6);
        // And the recovered camera sees the ball where the true one does.
        const again = projectPoint(camera, ball);
        expect(Math.hypot((again?.u ?? 0) - seen.u, (again?.v ?? 0) - seen.v)).toBeLessThan(1e-3);
      }),
      { numRuns: 500 },
    );
  });

  test("without the height correction a far ball is centimetres out", () => {
    const table = TABLES[0];
    // Standing behind the baulk end, looking up the table.
    const pose: Pose = {
      position: { x: table.widthM / 2, y: -1.2, z: 1.6 },
      target: { x: table.widthM / 2, y: table.lengthM / 2 },
      rollRad: 0,
      focalPx: 3000,
      widthPx: 4000,
      heightPx: 3000,
    };
    const truth = cameraOf(pose);
    const h = homographyFromCorners(
      cornersSeen(truth, table.widthM, table.lengthM),
      table.widthM,
      table.lengthM,
    );
    if (!h) throw new Error("no homography");
    const hInverse = invertHomography(h);
    const camera = cameraFromHomography(h, 4000, 3000);
    if (!hInverse || !camera) throw new Error("no camera");
    const ball = { x: table.widthM / 2, y: table.lengthM - 0.3, z: table.ballRadiusM };
    const seen = projectPoint(truth, ball);
    if (!seen) throw new Error("not seen");
    const flat = imageToTable(hInverse, seen);
    // Similar triangles: the error is distance * R / (camera height - R).
    const expected = ((ball.y - pose.position.y) * ball.z) / (pose.position.z - ball.z);
    expect(flat.y - ball.y).toBeCloseTo(expected, 6);
    expect(flat.y - ball.y).toBeGreaterThan(0.07);
    const corrected = imageToTableAtHeight(camera, seen, ball.z);
    expect(Math.abs((corrected?.y ?? 0) - ball.y)).toBeLessThan(1e-6);
  });

  test("a corner outside the photo is fine", () => {
    const table = TABLES[1];
    const pose = standingPose(table, {
      azimuth: 3.9,
      distance: 0.3,
      height: 1.5,
      tx: 0.6,
      ty: 0.6,
      roll: 0,
      focal: 0.9,
    });
    const truth = cameraOf(pose);
    const corners = cornersSeen(truth, table.widthM, table.lengthM);
    const outside = corners.filter((c) => c.u < 0 || c.u > 4000 || c.v < 0 || c.v > 3000);
    expect(outside.length).toBeGreaterThan(0);
    const h = homographyFromCorners(corners, table.widthM, table.lengthM);
    const camera = h ? cameraFromHomography(h, 4000, 3000) : undefined;
    expect(Math.abs((camera?.position.z ?? 0) - 1.5)).toBeLessThan(1e-5);
  });

  test("looking straight down: the focal length is assumed, and positions are still close", () => {
    const table = TABLES[1];
    const pose: Pose = {
      position: { x: table.widthM / 2, y: table.lengthM / 2, z: 3 },
      target: { x: table.widthM / 2, y: table.lengthM / 2 },
      rollRad: 0.3,
      // 20 % away from the assumed value.
      focalPx: ASSUMED_FOCAL_PER_LONG_SIDE * 4000 * 1.2,
      widthPx: 4000,
      heightPx: 3000,
    };
    const truth = cameraOf(pose);
    const h = homographyFromCorners(
      cornersSeen(truth, table.widthM, table.lengthM),
      table.widthM,
      table.lengthM,
    );
    const camera = h ? cameraFromHomography(h, 4000, 3000) : undefined;
    if (!camera) throw new Error("no camera");
    expect(camera.focalSource).toBe("assumed");
    expect(camera.focalPx).toBeCloseTo(ASSUMED_FOCAL_PER_LONG_SIDE * 4000, 6);
    const ball = { x: 0.1, y: 0.2, z: table.ballRadiusM };
    const seen = projectPoint(truth, ball);
    const placed = seen ? imageToTableAtHeight(camera, seen, ball.z) : undefined;
    // The wrong focal length makes the camera 20 % too low; the correction is off by that
    // share of about 1 cm.
    expect(Math.hypot((placed?.x ?? 9) - ball.x, (placed?.y ?? 9) - ball.y)).toBeLessThan(0.003);
  });

  test("corners given the wrong way round are refused", () => {
    const table = TABLES[1];
    const truth = cameraOf(
      standingPose(table, {
        azimuth: 1,
        distance: 1,
        height: 1.7,
        tx: 0.5,
        ty: 0.5,
        roll: 0,
        focal: 0.8,
      }),
    );
    const [a, b, c, d] = cornersSeen(truth, table.widthM, table.lengthM);
    // Mirror image: baulk left and baulk right swapped, top left and top right swapped.
    const mirrored: TableCorners = [b, a, d, c];
    const h = homographyFromCorners(mirrored, table.widthM, table.lengthM);
    expect(h ? cameraFromHomography(h, 4000, 3000) : undefined).toBeUndefined();
  });

  test("a ball looks smaller further away, by the pinhole rule", () => {
    const table = TABLES[0];
    const camera = cameraOf(
      standingPose(table, {
        azimuth: 4.7,
        distance: 1,
        height: 1.7,
        tx: 0.5,
        ty: 0.5,
        roll: 0,
        focal: 0.75,
      }),
    );
    const near = apparentRadiusPx(camera, { x: 0.9, y: 0.2, z: 0.026 }, 0.026) ?? 0;
    const far = apparentRadiusPx(camera, { x: 0.9, y: 3.3, z: 0.026 }, 0.026) ?? 0;
    expect(near).toBeGreaterThan(far * 1.5);
    expect(far).toBeGreaterThan(5);
  });
});

describe("error budget: corners that are a few pixels off", () => {
  test("2 px of corner error on a 12 megapixel photo keeps balls well inside the targets", () => {
    const rand = seeded(20261113);
    const errors: number[] = [];
    for (let i = 0; i < 400; i++) {
      const table = TABLES[i % TABLES.length] as (typeof TABLES)[number];
      const pose = standingPose(table, {
        azimuth: rand() * 2 * Math.PI,
        distance: 0.5 + rand() * 1.5,
        height: 1.4 + rand() * 0.6,
        tx: 0.4 + rand() * 0.2,
        ty: 0.4 + rand() * 0.2,
        roll: (rand() - 0.5) * 0.1,
        focal: 0.65 + rand() * 0.3,
      });
      const truth = cameraOf(pose);
      const exact = cornersSeen(truth, table.widthM, table.lengthM);
      const noisy = exact.map((c) => ({
        u: c.u + (rand() - 0.5) * 4,
        v: c.v + (rand() - 0.5) * 4,
      })) as unknown as TableCorners;
      const h = homographyFromCorners(noisy, table.widthM, table.lengthM);
      const camera = h ? cameraFromHomography(h, 4000, 3000) : undefined;
      if (!camera) throw new Error(`no camera in run ${String(i)}`);
      const ball = {
        x: (0.05 + rand() * 0.9) * table.widthM,
        y: (0.05 + rand() * 0.9) * table.lengthM,
        z: table.ballRadiusM,
      };
      const seen = projectPoint(truth, ball);
      const placed = seen ? imageToTableAtHeight(camera, seen, ball.z) : undefined;
      if (!placed) throw new Error("not placed");
      errors.push(Math.hypot(placed.x - ball.x, placed.y - ball.y) / table.lengthM);
    }
    errors.sort((a, b) => a - b);
    const median = errors[Math.floor(errors.length / 2)] as number;
    const p95 = errors[Math.floor(errors.length * 0.95)] as number;
    const worst = errors[errors.length - 1] as number;
    // Targets: median 0.6 % and 95th percentile 1.5 % of the table length. The geometry's
    // share of that budget, with corners off by up to 2 px each way, must be a small part.
    const summary = `median ${(median * 100).toFixed(3)} %, p95 ${(p95 * 100).toFixed(3)} %, worst ${(worst * 100).toFixed(3)} %`;
    expect(median, summary).toBeLessThan(0.0015);
    expect(p95, summary).toBeLessThan(0.005);
  });
});

describe("corners on the cushion noses, above the cloth", () => {
  // Found with the first real photo (2026-11-14): the corners a person places are where the
  // cushion noses meet, and a nose is about 3.6 cm above the cloth on a pool table.
  const table = TABLES[1];
  const nose = 0.635 * 2 * table.ballRadiusM;
  const pose: Pose = {
    position: { x: -0.3, y: -0.5, z: 1.0 },
    target: { x: table.widthM / 2, y: table.lengthM / 2 },
    rollRad: 0.04,
    focalPx: 2900,
    widthPx: 3000,
    heightPx: 4000,
  };
  const truth = cameraOf(pose);
  // Where the four nose corners really appear: points at nose height, not on the cloth.
  const seenCorners = [
    { x: 0, y: 0 },
    { x: table.widthM, y: 0 },
    { x: table.widthM, y: table.lengthM },
    { x: 0, y: table.lengthM },
  ].map((c) => {
    const p = projectPoint(truth, { ...c, z: nose });
    if (!p) throw new Error("corner not seen");
    return p;
  }) as unknown as TableCorners;
  const far = { x: 0.9, y: table.lengthM - 0.25, z: table.ballRadiusM };

  test("with the nose height given, the camera and a far ball are recovered exactly", () => {
    const h = homographyFromCorners(seenCorners, table.widthM, table.lengthM);
    const camera = h ? cameraFromCorners(h, pose.widthPx, pose.heightPx, nose) : undefined;
    if (!camera) throw new Error("no camera");
    expect(camera.position.x).toBeCloseTo(pose.position.x, 6);
    expect(camera.position.y).toBeCloseTo(pose.position.y, 6);
    expect(camera.position.z).toBeCloseTo(pose.position.z, 6);
    const seen = projectPoint(truth, far);
    const placed = seen ? imageToTableAtHeight(camera, seen, far.z) : undefined;
    expect(Math.hypot((placed?.x ?? 9) - far.x, (placed?.y ?? 9) - far.y)).toBeLessThan(1e-6);
  });

  test("taking the corners to be on the cloth puts the far ball centimetres too near", () => {
    const h = homographyFromCorners(seenCorners, table.widthM, table.lengthM);
    const flat = h ? cameraFromCorners(h, pose.widthPx, pose.heightPx, 0) : undefined;
    if (!flat) throw new Error("no camera");
    const seen = projectPoint(truth, far);
    const placed = seen ? imageToTableAtHeight(flat, seen, far.z) : undefined;
    const error = Math.hypot((placed?.x ?? 9) - far.x, (placed?.y ?? 9) - far.y);
    // About nose height x distance / camera height: this is the error the first real photo
    // showed, with the cushion itself read as a row of balls.
    expect(error).toBeGreaterThan(0.05);
    expect(error).toBeLessThan(0.15);
  });
});

describe("balls placed through the corners' own perspective", () => {
  // Four measured corners never fit a camera exactly. Here the photo's optical centre is
  // 12 % of its width off its middle (a cropped photo), which the recovered camera cannot
  // know. Points are mapped through the corners' perspective, and the camera only carries
  // them along its line of sight between heights (2026-11-15).
  const table = TABLES[1];
  const nose = 0.635 * 2 * table.ballRadiusM;
  const r = table.ballRadiusM;
  const pose: Pose = {
    position: { x: 0.2, y: -0.9, z: 1.3 },
    target: { x: table.widthM / 2, y: table.lengthM / 2 },
    rollRad: 0.02,
    focalPx: 1300,
    widthPx: 2000,
    heightPx: 1500,
  };
  const exact = cameraOf(pose);
  const truth: Camera = { ...exact, centre: { u: exact.centre.u + 240, v: exact.centre.v - 60 } };
  const seen = [
    { x: 0, y: 0 },
    { x: table.widthM, y: 0 },
    { x: table.widthM, y: table.lengthM },
    { x: 0, y: table.lengthM },
  ].map((c) => {
    const p = projectPoint(truth, { ...c, z: nose });
    if (!p) throw new Error("corner not seen");
    return p;
  }) as unknown as TableCorners;
  const h = homographyFromCorners(seen, table.widthM, table.lengthM);
  const camera = h ? cameraFromCorners(h, pose.widthPx, pose.heightPx, nose) : undefined;
  if (!camera) throw new Error("no camera");
  const balls = [
    { x: 0.2, y: 0.3 },
    { x: table.widthM - 0.15, y: table.lengthM - 0.2 },
    { x: table.widthM / 2, y: table.lengthM / 2 },
    { x: 0.1, y: table.lengthM - 0.1 },
  ];
  const errorWith = (cam: Camera): number =>
    Math.max(
      ...balls.map((b) => {
        const p = projectPoint(truth, { ...b, z: r });
        const placed = p ? imageToTableAtHeight(cam, p, r) : undefined;
        return placed ? Math.hypot(placed.x - b.x, placed.y - b.y) : Number.POSITIVE_INFINITY;
      }),
    );

  test("the corners are honoured exactly, and balls land within a few millimetres", () => {
    for (let i = 0; i < 4; i++) {
      const corner = [
        { x: 0, y: 0 },
        { x: table.widthM, y: 0 },
        { x: table.widthM, y: table.lengthM },
        { x: 0, y: table.lengthM },
      ][i] as { x: number; y: number };
      const back = projectPoint(camera, { ...corner, z: nose });
      const given = seen[i] as { u: number; v: number };
      expect(Math.hypot((back?.u ?? 1e9) - given.u, (back?.v ?? 1e9) - given.v)).toBeLessThan(1e-6);
    }
    expect(errorWith(camera)).toBeLessThan(0.004);
  });

  test("through the camera alone the same balls are centimetres off", () => {
    const cameraOnly: Camera = { ...camera };
    delete cameraOnly.plane;
    expect(errorWith(cameraOnly)).toBeGreaterThan(3 * errorWith(camera));
  });
});
