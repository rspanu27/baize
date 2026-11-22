import { sampleAt } from "@baize/physics";
import { getBallSet, getTablePreset, makeCloth } from "@baize/tables";
import type { BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { projectPoint } from "../src/index";
import type { Camera, ImagePoint, PhotoImage } from "../src/index";
import { OCCLUDER_RGB, renderClip } from "./clip";
import type { ClipBall, ClipSpec, Occluder, RenderedClip } from "./clip";
import { SHADOW, renderPhoto } from "./render";
import type { SceneLook } from "./render";
import { cameraOf, cornersSeen } from "./synthetic";

/** The synthetic clip renderer, checked against the simulation it draws. */

const CLOTH = "#2e7d4f";
const LOOK: SceneLook = { cloth: CLOTH };
const WIDTH = 640;
const HEIGHT = 360;

/** A phone on a tripod beside the middle of a long side, high up, scaled to the table. */
function phoneCamera(table: TableSpec): Camera {
  const { widthM: W, lengthM: L } = table.playingArea;
  return cameraOf({
    position: { x: -0.55 * W, y: L / 2, z: 0.75 * L },
    target: { x: W / 2, y: L / 2 },
    rollRad: 0,
    focalPx: 470,
    widthPx: WIDTH,
    heightPx: HEIGHT,
  });
}

/** A shot from the first ball at the ball `target`, aimed `cutRad` off its centre. */
function shotSpec(
  id: string,
  balls: ClipBall[],
  target: string,
  cutRad: number,
  speedMps: number,
  extra: Partial<ClipSpec> = {},
): ClipSpec {
  const table = getTablePreset(id) as TableSpec;
  const ballSet = getBallSet(table.defaultBallSetId) as BallSetSpec;
  const cue = balls[0] as ClipBall;
  const aim = balls.find((b) => b.id === target) as ClipBall;
  return {
    table,
    ballSet,
    cloth: makeCloth(CLOTH, "medium"),
    balls,
    shot: {
      cueBallId: cue.id,
      aimAngleRad: Math.atan2(aim.y - cue.y, aim.x - cue.x) + cutRad,
      speedMps,
      tipOffset: { side: 0, vertical: 0 },
    },
    camera: phoneCamera(table),
    look: LOOK,
    fps: 30,
    leadInS: 0.2,
    tailS: 0.2,
    ...extra,
  };
}

/** Pool: the cue ball cuts the 1 ball; both go to cushions, and the 1 ball later hits the 9. */
const POOL_BALLS: ClipBall[] = [
  { id: "cue", kind: "cue", x: 0.635, y: 0.7 },
  { id: "one", kind: "1", x: 0.55, y: 1.5 },
  { id: "nine", kind: "9", x: 1.0, y: 2.2 },
];
const poolSpec = (extra: Partial<ClipSpec> = {}) =>
  shotSpec("pool-9@1", POOL_BALLS, "one", 0.03, 2.5, extra);

/** Snooker: the cue ball cuts a red; both go to cushions; the black stays on its spot. */
const SNOOKER_BALLS: ClipBall[] = [
  { id: "cue", kind: "cue", x: 0.9, y: 0.8 },
  { id: "red", kind: "red", x: 0.75, y: 2.0 },
  { id: "black", kind: "black", x: 0.889, y: 3.245 },
];
const snookerSpec = (extra: Partial<ClipSpec> = {}) =>
  shotSpec("snooker-12@1", SNOOKER_BALLS, "red", 0.03, 2.2, extra);

function emptyTable(spec: ClipSpec): PhotoImage {
  return renderPhoto(spec.camera, spec.table, spec.ballSet, { balls: [] }, spec.look).image;
}

function sameImage(a: PhotoImage, b: PhotoImage): boolean {
  return Buffer.from(a.data).equals(Buffer.from(b.data));
}

/** Largest difference in any colour channel. */
function maxDifference(a: PhotoImage, b: PhotoImage): number {
  let worst = 0;
  for (let i = 0; i < a.data.length; i++) {
    worst = Math.max(worst, Math.abs((a.data[i] as number) - (b.data[i] as number)));
  }
  return worst;
}

/** Does pixel o of `image` differ from the empty table, other than by a ball's shadow? */
function ballPixel(image: PhotoImage, empty: PhotoImage, o: number): boolean {
  let differs = false;
  let shadow = true;
  for (let c = 0; c < 3; c++) {
    const v = image.data[o + c] as number;
    const e = empty.data[o + c] as number;
    if (v !== e) differs = true;
    if (Math.abs(v - e * SHADOW) > 1) shadow = false;
  }
  return differs && !shadow;
}

/**
 * Centroid of the ball pixels in a window around `near`: where the ball is drawn. Pixel
 * (i, j) stands for the point (i + 0.5, j + 0.5), the ray the renderer traces.
 */
function drawnCentre(
  image: PhotoImage,
  empty: PhotoImage,
  near: ImagePoint,
  halfPx: number,
): ImagePoint | undefined {
  let n = 0;
  let su = 0;
  let sv = 0;
  for (let j = Math.floor(near.v - halfPx); j <= Math.floor(near.v + halfPx); j++) {
    for (let i = Math.floor(near.u - halfPx); i <= Math.floor(near.u + halfPx); i++) {
      if (i < 0 || j < 0 || i >= image.widthPx || j >= image.heightPx) return undefined;
      if (!ballPixel(image, empty, 4 * (j * image.widthPx + i))) continue;
      n++;
      su += i + 0.5;
      sv += j + 0.5;
    }
  }
  return n > 0 ? { u: su / n, v: sv / n } : undefined;
}

const distance = (a: ImagePoint, b: ImagePoint) => Math.hypot(a.u - b.u, a.v - b.v);

/** The still photo of the balls still on the table at a frame's truth. */
function stillPhoto(spec: ClipSpec, clip: RenderedClip, index: number): PhotoImage {
  const layout: Layout = {
    balls: clip
      .truth(index)
      .balls.filter((b) => !b.pocketed)
      .map((b) => ({ kind: b.kind, x: b.x, y: b.y })),
  };
  return renderPhoto(spec.camera, spec.table, spec.ballSet, layout, spec.look).image;
}

describe.each([
  ["pool", poolSpec],
  ["snooker", snookerSpec],
])("%s shot", (_name, makeSpec) => {
  const spec = makeSpec();
  const sharp = makeSpec({ shutter: 0 });

  test("the shot has a ball-ball collision and a cushion, and the table is in view", () => {
    const clip = renderClip(spec);
    const types = clip.result.events.map((e) => e.type);
    expect(types).toContain("ball-ball");
    expect(types).toContain("ball-cushion");
    expect(clip.widthPx).toBe(WIDTH);
    expect(clip.heightPx).toBe(HEIGHT);
    const { widthM, lengthM } = spec.table.playingArea;
    for (const c of cornersSeen(spec.camera, widthM, lengthM)) {
      expect(c.u).toBeGreaterThan(0);
      expect(c.u).toBeLessThan(WIDTH);
      expect(c.v).toBeGreaterThan(0);
      expect(c.v).toBeLessThan(HEIGHT);
    }
    expect(clip.frameCount).toBe(Math.ceil((clip.endS + spec.tailS) * spec.fps));
    expect(clip.endS).toBeCloseTo(spec.leadInS + clip.result.durationS, 12);
  });

  test("without blur, every isolated ball is drawn within a pixel of its true centre", () => {
    const clip = renderClip(sharp);
    const empty = emptyTable(sharp);
    let movingSeen = 0;
    let movingChecked = 0;
    for (let index = 0; index < clip.frameCount; index++) {
      const { image, truth } = clip.frame(index);
      expect(truth.index).toBe(index);
      expect(truth.timeS).toBeCloseTo(index / sharp.fps, 12);
      let checked = 0;
      for (const ball of truth.balls) {
        if (ball.pocketed) continue;
        if (ball.moving) movingSeen++;
        // Isolated: no other ball (or its shadow) within reach of the window.
        const clear = truth.balls.every(
          (o) =>
            o === ball ||
            o.pocketed ||
            distance(o.centre, ball.centre) > ball.radiusPx + o.radiusPx + 10,
        );
        if (!clear) continue;
        const drawn = drawnCentre(image, empty, ball.centre, ball.radiusPx + 4);
        if (!drawn) throw new Error(`frame ${index}: ${ball.id} is not drawn`);
        const off = distance(drawn, ball.centre);
        if (!(off <= 1)) throw new Error(`frame ${index}: ${ball.id} drawn ${off} px away`);
        checked++;
        if (ball.moving) movingChecked++;
      }
      // Every frame has at least one ball to check, and moving balls are checked most of the time.
      expect(checked).toBeGreaterThan(0);
    }
    expect(movingSeen).toBeGreaterThan(0);
    expect(movingChecked / movingSeen).toBeGreaterThan(0.8);
  });

  test("frames before the strike are identical, and the last frames are still", () => {
    const clip = renderClip(spec);
    const exposureS = (spec.shutter ?? 0.5) / spec.fps;
    const first = clip.frame(0);
    expect(first.truth.balls.every((b) => !b.moving)).toBe(true);
    expect(sameImage(first.image, stillPhoto(spec, clip, 0))).toBe(true);
    let before = 0;
    for (let i = 1; i / spec.fps + exposureS <= clip.strikeS; i++) {
      expect(sameImage(clip.frame(i).image, first.image)).toBe(true);
      before++;
    }
    expect(before).toBeGreaterThan(2);
    // A frame soon after the strike shows the cue ball elsewhere.
    const after = Math.ceil(clip.strikeS * spec.fps) + 3;
    expect(sameImage(clip.frame(after).image, first.image)).toBe(false);
    expect(clip.truth(after).balls.some((b) => b.moving)).toBe(true);

    const last = clip.frame(clip.frameCount - 1);
    expect(last.truth.timeS).toBeGreaterThanOrEqual(clip.endS);
    expect(last.truth.balls.every((b) => !b.moving)).toBe(true);
    expect(sameImage(last.image, stillPhoto(spec, clip, clip.frameCount - 1))).toBe(true);
    for (let i = clip.frameCount - 2; i / spec.fps >= clip.endS; i--) {
      expect(sameImage(clip.frame(i).image, last.image)).toBe(true);
    }
  });
});

describe("motion blur", () => {
  const spec = poolSpec({ shutter: 0.5, blurSamples: 8 });
  const clip = renderClip(spec);
  const exposureS = 0.5 / spec.fps;
  const cueTrack = 0;

  /** The first frame in which the cue ball travels fast and straight with nothing near it. */
  function fastFrame(): number {
    for (let index = 0; index < clip.frameCount; index++) {
      const t0 = index / spec.fps - clip.strikeS;
      const t1 = t0 + exposureS;
      if (t0 < 0.02) continue;
      const busy = clip.result.events.some(
        (e) => e.type !== "transition" && e.t >= t0 - 0.02 && e.t <= t1 + 0.02,
      );
      if (busy) continue;
      const truth = clip.truth(index);
      const cue = truth.balls[cueTrack]!;
      const v = sampleAt(clip.result, t0 + exposureS / 2)[cueTrack]!.velocity;
      const speed = Math.hypot(v.x, v.y);
      const alone = truth.balls.every(
        (o) => o === cue || distance(o.centre, cue.centre) > 4 * cue.radiusPx + 20,
      );
      if (cue.moving && speed > 1.5 && alone) return index;
    }
    throw new Error("no fast frame");
  }

  test("a blurred frame is the average of full renders over the shutter time", () => {
    const index = fastFrame();
    const { image } = clip.frame(index);
    const n = 8;
    const sums = new Float64Array(image.data.length);
    for (let s = 0; s < n; s++) {
      const t = index / spec.fps + (exposureS * s) / (n - 1) - clip.strikeS;
      const layout: Layout = {
        balls: sampleAt(clip.result, t)
          .map((b, k) => ({ b, ball: spec.balls[k]! }))
          .filter(({ b }) => b.state !== "pocketed")
          .map(({ b, ball }) => ({ kind: ball.kind, x: b.position.x, y: b.position.y })),
      };
      const photo = renderPhoto(spec.camera, spec.table, spec.ballSet, layout, spec.look).image;
      for (let i = 0; i < sums.length; i++) sums[i] = sums[i]! + photo.data[i]!;
    }
    const average = new Uint8ClampedArray(sums.length);
    for (let i = 0; i < sums.length; i++) average[i] = sums[i]! / n;
    const reference = { widthPx: image.widthPx, heightPx: image.heightPx, data: average };
    expect(maxDifference(image, reference)).toBeLessThanOrEqual(1);
  });

  test("a fast ball is a streak as long as the way it travels while the shutter is open", () => {
    const index = fastFrame();
    const { image, truth } = clip.frame(index);
    const empty = emptyTable(spec);
    const cue = truth.balls[cueTrack]!;
    const r = spec.ballSet.cue ? spec.ballSet.cue.diameterM / 2 : spec.ballSet.object.diameterM / 2;
    // Mid-exposure position and velocity; at constant deceleration the way travelled while the
    // shutter is open is the mid-exposure speed times the open time.
    const mid = sampleAt(clip.result, index / spec.fps + exposureS / 2 - clip.strikeS)[cueTrack]!;
    const speed = Math.hypot(mid.velocity.x, mid.velocity.y);
    const along = { x: mid.velocity.x / speed, y: mid.velocity.y / speed };
    const half = (speed * exposureS) / 2;
    const at = (s: number) =>
      projectPoint(spec.camera, {
        x: mid.position.x + s * along.x,
        y: mid.position.y + s * along.y,
        z: r,
      })!;
    const start = at(-half);
    const end = at(half);
    expect(distance(at(0), cue.centre)).toBeLessThan(1e-9);
    const dirU = (end.u - start.u) / distance(start, end);
    const dirV = (end.v - start.v) / distance(start, end);
    const expected = distance(start, end) + 2 * cue.radiusPx;
    expect(distance(start, end)).toBeGreaterThan(4);

    // Streak pixels: brighter in red than the cloth (the cue ball is white; shadows only darken).
    let lo = Infinity;
    let hi = -Infinity;
    const reach = expected / 2 + 6;
    for (let j = Math.floor(cue.centre.v - reach); j <= cue.centre.v + reach; j++) {
      for (let i = Math.floor(cue.centre.u - reach); i <= cue.centre.u + reach; i++) {
        const o = 4 * (j * image.widthPx + i);
        if ((image.data[o] as number) < (empty.data[o] as number) + 4) continue;
        const s = (i + 0.5 - cue.centre.u) * dirU + (j + 0.5 - cue.centre.v) * dirV;
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
    }
    // Pixel centres span one pixel less than the shape they sample.
    const measured = hi - lo + 1;
    expect(Math.abs(measured - expected)).toBeLessThanOrEqual(1.5);
    // And without blur the same ball is a disc, much shorter.
    const sharp = renderClip({ ...spec, shutter: 0 }).frame(index);
    expect(sameImage(sharp.image, image)).toBe(false);
  });
});

describe("occluder", () => {
  // Where the 9 ball sits before the 1 ball reaches it (clip time 1.98 s).
  const base = poolSpec();
  const ninePos = { x: 1.0, y: 2.2, z: base.ballSet.object.diameterM / 2 };
  const nine = projectPoint(base.camera, ninePos)!;
  const ARM = 20;
  /** An arm reaching up from below the picture: over the 9 ball, then with its edge at the 9's centre. */
  const arm = (tS: number): Occluder | undefined => {
    if (tS >= 0.3 && tS < 1.0) {
      return { u0: nine.u, v0: HEIGHT + 40, u1: nine.u, v1: nine.v - 15, radiusPx: ARM };
    }
    if (tS >= 1.0 && tS < 1.5) {
      return {
        u0: nine.u + ARM,
        v0: HEIGHT + 40,
        u1: nine.u + ARM,
        v1: nine.v - 40,
        radiusPx: ARM,
      };
    }
    return undefined;
  };
  const spec = poolSpec({ shutter: 0, occluder: arm });
  const clip = renderClip(spec);
  const frameAt = (tS: number) => Math.round(tS * spec.fps);

  test("the occluder hides what it covers, and hidden is 1 under it and 0 clear of it", () => {
    const index = frameAt(0.6);
    const { image, truth } = clip.frame(index);
    const shape = arm(truth.timeS)!;
    const nineTruth = truth.balls.find((b) => b.id === "nine")!;
    expect(nineTruth.hidden).toBe(1);
    // Every pixel under the arm, ball or table, is the arm's colour.
    let under = 0;
    for (let j = 0; j < image.heightPx; j++) {
      for (let i = 0; i < image.widthPx; i++) {
        const du = shape.u1 - shape.u0;
        const dv = shape.v1 - shape.v0;
        const s = Math.max(
          0,
          Math.min(
            1,
            ((i + 0.5 - shape.u0) * du + (j + 0.5 - shape.v0) * dv) / (du * du + dv * dv),
          ),
        );
        const d = Math.hypot(i + 0.5 - (shape.u0 + s * du), j + 0.5 - (shape.v0 + s * dv));
        if (d > shape.radiusPx) continue;
        under++;
        const o = 4 * (j * image.widthPx + i);
        expect([image.data[o], image.data[o + 1], image.data[o + 2]]).toEqual([...OCCLUDER_RGB]);
      }
    }
    expect(under).toBeGreaterThan(1000);
    // The 9 ball cannot be found; the other balls, clear of the arm, are untouched.
    const empty = emptyTable(spec);
    const still = stillPhoto(spec, clip, index);
    for (const ball of truth.balls) {
      if (ball.id === "nine") continue;
      expect(Math.abs(ball.centre.u - nine.u)).toBeGreaterThan(ARM + ball.radiusPx + 2);
      expect(ball.hidden).toBe(0);
      expect(drawnCentre(image, empty, ball.centre, ball.radiusPx + 4)).toBeDefined();
      for (let j = Math.floor(ball.centre.v - 8); j < ball.centre.v + 8; j++) {
        for (let i = Math.floor(ball.centre.u - 8); i < ball.centre.u + 8; i++) {
          const o = 4 * (j * image.widthPx + i);
          expect(image.data[o]).toBe(still.data[o]);
        }
      }
    }
  });

  test("a half-covered ball is about half hidden, and nothing is hidden without the occluder", () => {
    const half = clip.truth(frameAt(1.2)).balls.find((b) => b.id === "nine")!;
    expect(half.hidden).toBeGreaterThan(0.45);
    expect(half.hidden).toBeLessThan(0.55);
    const plain = renderClip(poolSpec({ shutter: 0 }));
    for (const t of [0.1, 1.7, 3]) {
      const index = frameAt(t);
      expect(clip.truth(index).balls.every((b) => b.hidden === 0)).toBe(true);
      // Without the arm the frame is the same as the clip with no occluder at all.
      expect(sameImage(clip.frame(index).image, plain.frame(index).image)).toBe(true);
    }
  });
});

describe("pockets and determinism", () => {
  test("a pocketed ball is not drawn", () => {
    // The cue ball alone, sent into the top-right corner pocket, with the 9 ball as a bystander.
    const table = getTablePreset("pool-9@1") as TableSpec;
    const { widthM: W, lengthM: L } = table.playingArea;
    const balls: ClipBall[] = [
      { id: "cue", kind: "cue", x: W - 0.4, y: L - 0.4 },
      { id: "nine", kind: "9", x: 0.3, y: 0.6 },
    ];
    const spec = shotSpec("pool-9@1", balls, "nine", 0, 1.5, { shutter: 0 });
    spec.shot.aimAngleRad = Math.PI / 4;
    const clip = renderClip(spec);
    expect(clip.result.events.some((e) => e.type === "pocket" && e.ballId === "cue")).toBe(true);
    const last = clip.frame(clip.frameCount - 1);
    expect(last.truth.balls[0]!.pocketed).toBe(true);
    expect(last.truth.balls[1]!.pocketed).toBe(false);
    const onlyNine = renderPhoto(
      spec.camera,
      spec.table,
      spec.ballSet,
      { balls: [{ kind: "9", x: 0.3, y: 0.6 }] },
      spec.look,
    ).image;
    expect(sameImage(last.image, onlyNine)).toBe(true);
  });

  test("the same spec gives the same pixels, whatever order frames are drawn in", () => {
    const occluder = (tS: number): Occluder => ({
      u0: 100 + 200 * tS,
      v0: HEIGHT + 30,
      u1: 150 + 200 * tS,
      v1: 150,
      radiusPx: 18,
    });
    const make = () => renderClip(poolSpec({ occluder, look: { ...LOOK, noise: 2, seed: 7 } }));
    const a = make();
    const b = make();
    const picks = [30, 5, 30, 17];
    const fromA = picks.map((i) => a.frame(i).image);
    const fromB = [...picks]
      .reverse()
      .map((i) => b.frame(i).image)
      .reverse();
    for (let k = 0; k < picks.length; k++) {
      expect(sameImage(fromA[k]!, fromB[k]!)).toBe(true);
    }
    expect(sameImage(fromA[0]!, fromA[2]!)).toBe(true);
    // Noise is fresh in every frame: two still frames before the strike differ.
    expect(sameImage(a.frame(0).image, a.frame(1).image)).toBe(false);
    expect(a.truth(17)).toEqual(b.truth(17));
  });
});
