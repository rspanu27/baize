import { describe, expect, test } from "vitest";
import { DEFAULT_OVERLAYS } from "../types";
import type { ClipAnalysis } from "../types";
import { testAnalysis } from "./testAnalysis";
import {
  SLOW_AFTER_S,
  SLOW_BEFORE_S,
  SLOW_RATE,
  buildTimeline,
  firstContactSimS,
  slowSpans,
} from "./timeline";

const analysis = testAnalysis();
const shot = analysis.shots[0];
if (!shot) throw new Error("no shot");
const contactSim = firstContactSimS(shot);
if (contactSim === undefined) throw new Error("no contact in the test shot");
const contact = shot.strikeS + contactSim;
const FPS = 30;

function expectWholeClip(frames: { outTimeS: number; clipTimeS: number }[], a: ClipAnalysis) {
  expect(frames[0]?.clipTimeS).toBe(0);
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1] as { outTimeS: number; clipTimeS: number };
    const f = frames[i] as { outTimeS: number; clipTimeS: number };
    expect(f.clipTimeS).toBeGreaterThanOrEqual(prev.clipTimeS);
    expect(f.outTimeS).toBeCloseTo(i / FPS, 12);
  }
  const last = frames[frames.length - 1] as { clipTimeS: number };
  expect(last.clipTimeS).toBeLessThanOrEqual(a.durationS);
  expect(a.durationS - last.clipTimeS).toBeLessThan(1 / FPS + 1e-9);
}

describe("buildTimeline", () => {
  test("without slow motion the clip plays in real time, one frame per 1/fps", () => {
    const frames = buildTimeline(analysis, { ...DEFAULT_OVERLAYS, slowMotion: false }, FPS);
    expect(frames).toHaveLength(Math.ceil(analysis.durationS * FPS));
    frames.forEach((f, i) => {
      expect(f.clipTimeS).toBeCloseTo(i / FPS, 12);
      expect(f.slow).toBe(false);
    });
    expectWholeClip(frames, analysis);
  });

  test("slow motion shows 0.3 s before to 0.7 s after the first contact at quarter speed", () => {
    const frames = buildTimeline(analysis, DEFAULT_OVERLAYS, FPS);
    expectWholeClip(frames, analysis);
    const span = SLOW_BEFORE_S + SLOW_AFTER_S;
    // The slowed second takes four seconds of video instead of one.
    const outDuration = analysis.durationS + span * (1 / SLOW_RATE - 1);
    expect(frames).toHaveLength(Math.ceil(outDuration * FPS - 1e-9));
    const slow = frames.filter((f) => f.slow);
    expect(slow.length).toBeGreaterThanOrEqual(Math.floor((span / SLOW_RATE) * FPS) - 1);
    expect(slow.length).toBeLessThanOrEqual(Math.ceil((span / SLOW_RATE) * FPS) + 1);
    for (const f of slow) {
      expect(f.clipTimeS).toBeGreaterThanOrEqual(contact - SLOW_BEFORE_S - 1e-9);
      expect(f.clipTimeS).toBeLessThanOrEqual(contact + SLOW_AFTER_S + 1e-9);
    }
    for (let i = 1; i < slow.length; i++) {
      const step = (slow[i]?.clipTimeS ?? 0) - (slow[i - 1]?.clipTimeS ?? 0);
      expect(step).toBeCloseTo(SLOW_RATE / FPS, 9);
    }
    // Frames are slow in one run, real time on either side.
    const first = frames.findIndex((f) => f.slow);
    const last = frames.length - 1 - [...frames].reverse().findIndex((f) => f.slow);
    expect(frames.slice(first, last + 1).every((f) => f.slow)).toBe(true);
    const before = frames[first - 1];
    const after = frames[last + 1];
    expect(before && after).toBeTruthy();
    expect((after?.clipTimeS ?? 0) - (frames[last]?.clipTimeS ?? 0)).toBeLessThanOrEqual(
      1 / FPS + 1e-9,
    );
  });

  test("a stretch is cut at the clip's start and overlapping stretches merge", () => {
    const early = { ...analysis, shots: [{ ...shot, strikeS: 0.1 - contactSim }] };
    expect(slowSpans(early)[0]?.startS).toBe(0);
    const twice = {
      ...analysis,
      shots: [shot, { ...shot, index: 1, strikeS: shot.strikeS + 0.4 }],
    };
    const spans = slowSpans(twice);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.startS).toBeCloseTo(contact - SLOW_BEFORE_S, 12);
    expect(spans[0]?.endS).toBeCloseTo(contact + 0.4 + SLOW_AFTER_S, 12);
  });

  test("a shot with no contact is not slowed; bad frame rates are refused", () => {
    const noContact = {
      ...analysis,
      shots: [{ ...shot, result: { ...shot.result, events: [] } }],
    };
    expect(buildTimeline(noContact, DEFAULT_OVERLAYS, FPS).some((f) => f.slow)).toBe(false);
    expect(() => buildTimeline(analysis, DEFAULT_OVERLAYS, 0)).toThrow(RangeError);
    expect(() => buildTimeline(analysis, DEFAULT_OVERLAYS, Number.NaN)).toThrow(RangeError);
    expect(buildTimeline({ ...analysis, durationS: 0 }, DEFAULT_OVERLAYS, FPS)).toEqual([]);
  });

  test("other frame rates cover the clip too", () => {
    for (const fps of [24, 60, 120]) {
      const frames = buildTimeline(analysis, DEFAULT_OVERLAYS, fps);
      const last = frames[frames.length - 1];
      expect(analysis.durationS - (last?.clipTimeS ?? 0)).toBeLessThan(1 / fps + 1e-9);
    }
  });
});
