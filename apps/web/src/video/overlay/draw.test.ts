import { sampleAt } from "@baize/physics";
import { apparentRadiusPx, projectPoint } from "@baize/vision";
import { afterEach, describe, expect, test, vi } from "vitest";
import { THEMES } from "../../view/theme";
import { DEFAULT_OVERLAYS } from "../types";
import type { ClipAnalysis, ClipShot, OverlayOptions } from "../types";
import { currentShotIndex, drawOverlay, slowText, speedText } from "./draw";
import { FakeContext } from "./fakeContext";
import type { RecordedStroke } from "./fakeContext";
import { MINIMAP_MAX_HEIGHT, MINIMAP_MAX_WIDTH, minimapLayout } from "./minimapLayout";
import { prepare } from "./prepare";
import { fittedShot, testAnalysis } from "./testAnalysis";
import { firstContactSimS } from "./timeline";

const analysis = testAnalysis();
const shot = fittedShot(analysis);
const contactSim = firstContactSimS(shot);
if (contactSim === undefined) throw new Error("no contact in the test shot");

const NONE: OverlayOptions = {
  ...DEFAULT_OVERLAYS,
  cueTrail: false,
  allTrails: false,
  ghostBall: false,
  minimap: false,
  speed: false,
  slowMotion: false,
  labels: false,
};

function draw(options: Partial<OverlayOptions>, clipTimeS: number, slow = false, a = analysis) {
  const fake = new FakeContext();
  drawOverlay(fake.ctx, a, { ...NONE, ...options }, clipTimeS, slow);
  return fake;
}

function lastPoint(s: RecordedStroke) {
  const run = s.runs[s.runs.length - 1];
  return run?.[run.length - 1];
}

/** The cue ball's centre in the picture at a clip time, from the fit. */
function cueInPicture(clipTimeS: number) {
  const s = shot as NonNullable<typeof shot>;
  const i = s.result.tracks.findIndex((t) => t.id === s.cueBallId);
  const b = sampleAt(s.result, clipTimeS - s.strikeS)[i];
  const r = s.result.tracks[i]?.radiusM ?? 0;
  return b ? projectPoint(analysis.camera, { x: b.position.x, y: b.position.y, z: r }) : undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trails", () => {
  test("the cue ball's trail ends where the cue ball is at that moment", () => {
    for (const dt of [0.05, contactSim, contactSim + 0.2, 1.5]) {
      const t = shot.strikeS + dt;
      const fake = draw({ cueTrail: true }, t);
      const line = fake.strokes.find((s) => s.style === THEMES.table.cuePath && s.width === 4);
      expect(line, `trail at ${String(dt)} s`).toBeDefined();
      const end = lastPoint(line as RecordedStroke);
      const want = cueInPicture(t);
      expect(end?.x).toBeCloseTo(want?.u ?? NaN, 6);
      expect(end?.y).toBeCloseTo(want?.v ?? NaN, 6);
      // It starts where the cue ball stood.
      const start = line?.runs[0]?.[0];
      const from = cueInPicture(shot.strikeS);
      expect(start?.x).toBeCloseTo(from?.u ?? NaN, 6);
    }
  });

  test("each trail has a halo under it, drawn first", () => {
    const fake = draw({ cueTrail: true }, shot.strikeS + 1);
    const halo = fake.strokes.findIndex((s) => s.kind === "stroke" && s.width === 4 + 3);
    const line = fake.strokes.findIndex((s) => s.kind === "stroke" && s.width === 4);
    expect(halo).toBeGreaterThanOrEqual(0);
    expect(halo).toBeLessThan(line);
    expect(fake.strokes[halo]?.style).toBe("rgba(0, 0, 0, 0.7)");
  });

  test("all trails draws every ball that moved, the cue ball's last", () => {
    const t = shot.strikeS + 2;
    const only = draw({ cueTrail: true }, t).strokes.filter((s) => s.width === 4 || s.width === 3);
    const all = draw({ allTrails: true }, t).strokes.filter((s) => s.width === 4 || s.width === 3);
    expect(only).toHaveLength(1);
    const moved = prepare(analysis).shots[0]?.trails.filter((tr) => tr.moved).length ?? 0;
    expect(moved).toBeGreaterThan(1);
    expect(all).toHaveLength(moved);
    expect(all[all.length - 1]?.style).toBe(THEMES.table.cuePath);
  });

  test("nothing before the strike or before the first shot", () => {
    expect(draw({ cueTrail: true, allTrails: true }, shot.strikeS - 0.1).strokes).toHaveLength(0);
    expect(currentShotIndex(analysis, shot.startS - 0.01)).toBe(-1);
  });

  test("a finished shot stays until the next one starts", () => {
    const later = { ...shot, index: 1, startS: shot.endS + 5, strikeS: shot.endS + 5 };
    const two: ClipAnalysis = { ...analysis, durationS: later.endS + 10, shots: [shot, later] };
    expect(currentShotIndex(two, shot.endS + 1)).toBe(0);
    expect(currentShotIndex(two, later.startS)).toBe(1);
  });

  test("a shot's paths and speed end where the next shot found starts, even one not fitted", () => {
    // A span the fit could not explain, starting while the first shot's balls still roll.
    const t = shot.strikeS + 1;
    const unfitted: ClipShot = {
      fitted: false,
      index: 1,
      startS: t - 0.2,
      endS: t + 1,
      cueBallId: shot.cueBallId,
      balls: shot.balls,
    };
    const two: ClipAnalysis = { ...analysis, shots: [shot, unfitted] };
    const all = { cueTrail: true, allTrails: true, ghostBall: true, speed: true };
    expect(draw(all, t).strokes.length).toBeGreaterThan(0);
    expect(draw(all, t).texts.length).toBeGreaterThan(0);
    const after = draw(all, t, false, two);
    expect(after.strokes).toHaveLength(0);
    expect(after.texts).toHaveLength(0);
    // Before it starts, the first shot is drawn as usual.
    expect(draw(all, unfitted.startS - 0.05, false, two).strokes.length).toBeGreaterThan(0);
    // The minimap still shows the balls, from the tracked frames.
    const mini = draw({ minimap: true }, t, false, two).strokes;
    expect(mini.some((s) => s.kind === "fill" && s.arcs.length > 0)).toBe(true);
  });

  test("print theme paths are near black with a light halo", () => {
    const fake = draw({ cueTrail: true, theme: "print" }, shot.strikeS + 1);
    expect(fake.strokes.some((s) => s.style === THEMES.print.cuePath && s.width === 4)).toBe(true);
    expect(fake.strokes.some((s) => s.style === "rgba(255, 255, 255, 0.85)")).toBe(true);
  });
});

describe("ghost ball", () => {
  const circleAtContact = (fake: FakeContext) => {
    const want = cueInPicture(shot.strikeS + contactSim);
    return fake.strokes.filter((s) =>
      s.arcs.some(
        (a) => Math.abs(a.x - (want?.u ?? NaN)) < 1e-6 && Math.abs(a.y - (want?.v ?? NaN)) < 1e-6,
      ),
    );
  };

  test("appears at the cue ball's centre at the first contact, and only from then on", () => {
    expect(circleAtContact(draw({ ghostBall: true }, shot.strikeS + contactSim - 0.01))).toEqual(
      [],
    );
    const at = circleAtContact(draw({ ghostBall: true }, shot.strikeS + contactSim));
    expect(at.length).toBeGreaterThan(0);
    const later = circleAtContact(draw({ ghostBall: true }, shot.strikeS + contactSim + 1));
    expect(later.some((s) => s.dash.length > 0)).toBe(true);
    const i = shot.result.tracks.findIndex((t) => t.id === shot.cueBallId);
    const b = sampleAt(shot.result, contactSim)[i];
    const r = shot.result.tracks[i]?.radiusM ?? 0;
    const rPx = apparentRadiusPx(
      analysis.camera,
      { x: b?.position.x ?? 0, y: b?.position.y ?? 0, z: r },
      r,
    );
    expect(at[0]?.arcs[0]?.r).toBeCloseTo(rPx ?? NaN, 9);
  });

  test("is not drawn when turned off", () => {
    expect(circleAtContact(draw({}, shot.strikeS + contactSim + 1))).toEqual([]);
  });
});

describe("speed", () => {
  test("formats per unit system", () => {
    expect(speedText(4.2, "metric")).toBe("4.2 m/s");
    expect(speedText(4.2, "imperial")).toBe("9.4 mph");
    expect(speedText(0.5, "metric")).toBe("0.5 m/s");
  });

  test("is shown from the shot's start, in the chosen units", () => {
    expect(draw({ speed: true }, shot.startS - 0.01).texts).toEqual([]);
    const metric = draw({ speed: true }, shot.startS).texts.map((t) => t.text);
    expect(metric).toContain(speedText(shot.shot.speedMps, "metric"));
    const imperial = draw({ speed: true, units: "imperial" }, shot.endS + 0.2).texts;
    expect(imperial.map((t) => t.text)).toContain(speedText(shot.shot.speedMps, "imperial"));
    expect(imperial[0]?.style).toBe(THEMES.table.captionText);
  });

  test("the slow-motion mark is shown only on slow frames", () => {
    expect(draw({}, 1, false).texts).toEqual([]);
    expect(draw({}, 1, true).texts.map((t) => t.text)).toEqual([slowText()]);
    expect(slowText(0.25)).toBe("Slow motion ¼×");
  });
});

describe("minimap", () => {
  test("sits in the top right corner, inside the frame, at most a quarter of its width", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [1080, 1920],
      [640, 360],
    ] as const) {
      const a = testAnalysis({ widthPx: w, heightPx: h });
      const { box } = minimapLayout(a);
      expect(box.x).toBeGreaterThan(w / 2);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      expect(box.y + box.height).toBeLessThanOrEqual(h);
      expect(box.width).toBeLessThanOrEqual(MINIMAP_MAX_WIDTH * w);
      expect(box.height).toBeLessThanOrEqual(MINIMAP_MAX_HEIGHT * h);
      expect(box.width).toBeGreaterThan(0.2 * w);
    }
  });

  test("is turned like the table in the clip", () => {
    const layout = minimapLayout(analysis);
    // The camera has the head end (y = 0) on the right of the picture.
    expect(layout.orientation).toBe("landscape");
    expect(layout.flipped).toBe(true);
    const { widthM: W, lengthM: L } = analysis.table.playingArea;
    expect(layout.toPx({ x: W / 2, y: 0 }).x).toBeGreaterThan(layout.toPx({ x: W / 2, y: L }).x);
    // Near cushion (x = 0) at the bottom, as in the picture.
    expect(layout.toPx({ x: 0, y: L / 2 }).y).toBeGreaterThan(layout.toPx({ x: W, y: L / 2 }).y);
    // Round trip.
    const p = layout.transform.toTable(layout.toPx({ x: 0.3, y: 1.1 }));
    expect(p.x).toBeCloseTo(0.3, 9);
    expect(p.y).toBeCloseTo(1.1, 9);
  });

  test("shows the balls where the fit puts them during the shot", () => {
    const t = shot.strikeS + 0.8;
    const fake = draw({ minimap: true }, t);
    const layout = minimapLayout(analysis);
    const samples = sampleAt(shot.result, t - shot.strikeS);
    for (const s of samples) {
      if (s.state === "pocketed") continue;
      const p = layout.toPx(s.position);
      const found = fake.strokes.some((st) =>
        st.arcs.some((a) => Math.abs(a.x - p.x) < 1e-6 && Math.abs(a.y - p.y) < 1e-6),
      );
      expect(found, s.id).toBe(true);
    }
  });

  test("labels the numbered balls only when asked", () => {
    const t = shot.startS - 0.2;
    expect(draw({ minimap: true }, t).texts).toEqual([]);
    const labels = draw({ minimap: true, labels: true }, t).texts.map((x) => x.text);
    expect(labels.sort()).toEqual(["1", "12", "9"]);
  });

  test("draws the table once per analysis and theme when an offscreen canvas exists", () => {
    const made: FakeContext[] = [];
    class FakeOffscreen {
      readonly fake = new FakeContext();
      constructor(
        readonly width: number,
        readonly height: number,
      ) {
        made.push(this.fake);
      }
      getContext() {
        return this.fake;
      }
    }
    vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
    const a = testAnalysis();
    const frames = [0.2, 0.9, 1.4].map((t) => draw({ minimap: true }, t, false, a));
    expect(made).toHaveLength(1);
    for (const f of frames) expect(f.images).toHaveLength(1);
    // The table on the cached canvas lands inside it.
    const box = minimapLayout(a).box;
    for (const p of made[0]?.points ?? []) {
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(box.width + 1);
    }
    draw({ minimap: true, theme: "dark" }, 0.2, false, a);
    expect(made).toHaveLength(2);
  });

  test("without an offscreen canvas the table is drawn straight onto the frame", () => {
    const fake = draw({ minimap: true }, 0.2, false, testAnalysis());
    expect(fake.images).toHaveLength(0);
    expect(fake.rects.some((r) => r.style === "#1f6b3a")).toBe(true);
  });
});

describe("bounds", () => {
  const everything: Partial<OverlayOptions> = {
    cueTrail: true,
    allTrails: true,
    ghostBall: true,
    minimap: true,
    speed: true,
    labels: true,
  };

  test("nothing is drawn outside the picture, clipped to it as well", () => {
    for (const a of [analysis, testAnalysis({ widthPx: 1080, heightPx: 1920 })]) {
      for (const theme of ["table", "print", "dark"] as const) {
        for (const t of [0, shot.strikeS + 0.3, shot.strikeS + 1.2, a.durationS]) {
          const fake = draw({ ...everything, theme }, t, true, a);
          expect(fake.calls.slice(0, 2)).toEqual(["save", "clip"]);
          for (const p of fake.points) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(a.widthPx);
            expect(p.y).toBeLessThanOrEqual(a.heightPx);
          }
          expect(fake.calls[fake.calls.length - 1]).toBe("restore");
        }
      }
    }
  });

  test("overlays off draw nothing", () => {
    const fake = draw({}, shot.strikeS + 1);
    expect(fake.strokes).toEqual([]);
    expect(fake.texts).toEqual([]);
  });
});
