import { describe, expect, test } from "vitest";
import type { PhotoImage } from "@baize/vision";
// The synthetic clip renderer lives with the vision package's tests: a shot simulated by the
// physics and drawn through a known camera, frame by frame, with exact truth.
import { renderClip } from "../../../../packages/vision/test/clip";
import type { ClipSpec } from "../../../../packages/vision/test/clip";
import { cameraOf } from "../../../../packages/vision/test/synthetic";
import { projectPoint } from "@baize/vision";
import type { Camera, TableCorners } from "@baize/vision";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import { NO_TUNING } from "../sim/tuning";
import { MESSAGE_CANCELLED, analyseClip, pageBackend } from "./analysis";
import type { CalibratedClip } from "./clipSession";
import type { Clip, ClipFrame } from "./media";

/**
 * The clip analysis end to end on a synthetic clip, on the page backend: the frames are
 * tracked, the shot is found and the physics fit recovers the strike that made the clip.
 */

function noseCorners(camera: Camera, W: number, L: number, z: number): TableCorners {
  const at = (x: number, y: number) => {
    const p = projectPoint(camera, { x, y, z });
    if (!p) throw new Error("a corner is behind the camera");
    return p;
  };
  return [at(0, 0), at(W, 0), at(W, L), at(0, L)];
}

function setup(): {
  spec: ClipSpec;
  scene: Scene;
  calibrated: CalibratedClip;
  frames: ClipFrame[];
  images: Map<ClipFrame, PhotoImage>;
} {
  const resolved = resolveDoc(newDoc("pool-9@1"));
  if (!resolved.ok) throw new Error("no scene");
  const scene = resolved.scene;
  const { table, ballSet, cloth } = scene;
  const { widthM: W, lengthM: L } = table.playingArea;
  const camera = cameraOf({
    position: { x: -0.55 * W, y: L / 2, z: 0.75 * L },
    target: { x: W / 2, y: L / 2 },
    rollRad: 0,
    focalPx: 470,
    widthPx: 640,
    heightPx: 360,
  });
  const balls = [
    { id: "cue", kind: "cue" as const, x: 0.635, y: 0.7 },
    { id: "one", kind: "1" as const, x: 0.55, y: 1.5 },
    { id: "nine", kind: "9" as const, x: 1.0, y: 2.2 },
  ];
  const spec: ClipSpec = {
    table,
    ballSet,
    cloth,
    balls,
    shot: {
      cueBallId: "cue",
      aimAngleRad: Math.atan2(1.5 - 0.7, 0.55 - 0.635) + 0.03,
      speedMps: 2.5,
      tipOffset: { side: 0, vertical: 0 },
    },
    camera,
    look: { cloth: "#2e7d4f" },
    fps: 30,
    leadInS: 0.4,
    tailS: 0.6,
  };
  const clip = renderClip(spec);
  const frames: ClipFrame[] = [];
  const images = new Map<ClipFrame, PhotoImage>();
  for (let i = 0; i < clip.frameCount; i++) {
    const { image, truth } = clip.frame(i);
    const frame = {
      canvas: {} as HTMLCanvasElement,
      timestampS: truth.timeS,
      durationS: 1 / spec.fps,
    };
    frames.push(frame);
    images.set(frame, image);
  }
  const fakeClip: Clip = {
    info: {
      widthPx: 640,
      heightPx: 360,
      durationS: frames.length / spec.fps,
      rotationDeg: 0,
      codec: "avc",
    },
    async *frames() {
      for (const f of frames) yield f;
    },
    frameAt: () => Promise.resolve(frames[0]),
    close: () => undefined,
  };
  const calibrated: CalibratedClip = {
    clip: fakeClip,
    // Where a person would put the corners: the cushion noses, at nose height (the synthetic
    // renderer's own corners lie on the cloth, which the analysis would read as too low).
    corners: noseCorners(camera, W, L, table.cushion.noseHeightM),
    camera,
    frameSize: { widthPx: 640, heightPx: 360 },
    table,
    ballSet,
    balls: balls.map((b, i) => ({ id: i, kind: b.kind, x: b.x, y: b.y, confidence: 1 })),
  };
  return { spec, scene, calibrated, frames, images };
}

describe("analysing a clip", () => {
  test("the shot is found and fitted: speed within 5 %, direction within half a degree", async () => {
    const { spec, scene, calibrated, images } = setup();
    const stages = new Set<string>();
    const analysis = await analyseClip(calibrated, scene, NO_TUNING, {
      backend: pageBackend(),
      readPixels: (frame) => {
        const image = images.get(frame);
        if (!image) throw new Error("unknown frame");
        // The analysis hands the pixels over, so give it its own copy.
        return { ...image, data: new Uint8ClampedArray(image.data) };
      },
      onProgress: (p) => stages.add(p.stage),
    });
    expect(stages).toEqual(new Set(["tracking", "fitting"]));
    expect(analysis.widthPx).toBe(640);
    expect(analysis.frames.length).toBe(images.size);
    expect(analysis.shots).toHaveLength(1);
    const shot = analysis.shots[0];
    if (!shot) throw new Error("no shot");
    expect(Math.abs(shot.shot.speedMps - spec.shot.speedMps) / spec.shot.speedMps).toBeLessThan(
      0.05,
    );
    expect((Math.abs(shot.shot.aimAngleRad - spec.shot.aimAngleRad) * 180) / Math.PI).toBeLessThan(
      0.5,
    );
    expect(shot.cueBallId).toBe("b0");
    expect(shot.strikeS).toBeGreaterThan(0.3);
    expect(shot.strikeS).toBeLessThan(0.5);
    // Tracking 50 frames and fitting the shot (about 600 simulations) takes several seconds.
  }, 30_000);

  test("stopping it rejects with a plain message", async () => {
    const { scene, calibrated, images } = setup();
    const controller = new AbortController();
    let n = 0;
    const run = analyseClip(calibrated, scene, NO_TUNING, {
      backend: pageBackend(),
      signal: controller.signal,
      readPixels: (frame) => {
        if (++n === 5) controller.abort();
        const image = images.get(frame);
        if (!image) throw new Error("unknown frame");
        return { ...image, data: new Uint8ClampedArray(image.data) };
      },
    });
    await expect(run).rejects.toThrow(MESSAGE_CANCELLED);
  });
});
