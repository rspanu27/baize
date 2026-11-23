import { beforeEach, describe, expect, test } from "vitest";
import { newDoc } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { useEditor } from "../store/store";
import { THEMES } from "../view/theme";
import { MINIMAP_CLOTH, clothColour } from "./overlay/minimap";
import { buildTimeline } from "./overlay/timeline";
import { testAnalysis } from "./overlay/testAnalysis";
import {
  DEFAULT_FPS,
  SHOT_MARGIN_S,
  clipFps,
  clipTimeText,
  coveredSpan,
  docWithClipShot,
  fitText,
  fitWord,
  initialChoice,
  openShotInEditor,
  outputSize,
  outputTimeline,
  shotDetails,
  shotLabel,
} from "./resultsModel";
import { DEFAULT_OVERLAYS } from "./types";
import type { ClipAnalysis, ClipShot } from "./types";

/** A clip with 3 s of still table before the shot and after it, at 30 fps. */
const analysis = testAnalysis({ leadInS: 3, tailS: 3, widthPx: 1280, heightPx: 720 });
const shot = analysis.shots[0] as ClipShot;

describe("words for the shots found", () => {
  test("clip times as minutes, seconds and tenths", () => {
    expect(clipTimeText(0)).toBe("0:00.0");
    expect(clipTimeText(2.34)).toBe("0:02.3");
    expect(clipTimeText(65)).toBe("1:05.0");
    expect(clipTimeText(59.97)).toBe("1:00.0");
    expect(clipTimeText(Number.NaN)).toBe("0:00.0");
  });

  test("fit quality: good under 1 cm, rough under 3 cm, poor above, with the number", () => {
    expect(fitWord(0.004)).toBe("good");
    expect(fitWord(0.0099)).toBe("good");
    expect(fitWord(0.01)).toBe("rough");
    expect(fitWord(0.029)).toBe("rough");
    expect(fitWord(0.03)).toBe("poor");
    expect(fitText(0.006, "metric")).toBe("good fit (0.6 cm)");
    expect(fitText(0.042, "metric")).toBe("poor fit (4.2 cm)");
    expect(fitText(0.0254, "imperial")).toBe("rough fit (1 in)");
  });

  test("a shot: its time in the clip, the cue ball's speed in the units preference, the fit", () => {
    const s: ClipShot = { ...shot, index: 1, startS: 2.34, rmsM: 0.015 };
    expect(shotLabel(s)).toBe("Shot 2 at 0:02.3");
    expect(shotDetails(s, "metric")).toBe("cue ball 3 m/s, rough fit (1.5 cm)");
    expect(shotDetails(s, "imperial")).toMatch(/^cue ball 6\.7 mph, rough fit/);
  });
});

describe("what the video covers", () => {
  test("starts on the first shot, or the whole clip when there is none", () => {
    expect(initialChoice(analysis)).toBe(0);
    expect(initialChoice({ ...analysis, shots: [] })).toBe("whole");
  });

  test("a shot from a second before it starts to a second after it ends, cut to the clip", () => {
    expect(coveredSpan(analysis, "whole")).toEqual({ startS: 0, endS: analysis.durationS });
    const span = coveredSpan(analysis, 0);
    expect(span.startS).toBeCloseTo(shot.startS - SHOT_MARGIN_S, 9);
    expect(span.endS).toBeCloseTo(shot.endS + SHOT_MARGIN_S, 9);
    const early: ClipAnalysis = {
      ...analysis,
      shots: [{ ...shot, startS: 0.3, endS: analysis.durationS - 0.2 }],
    };
    expect(coveredSpan(early, 0)).toEqual({ startS: 0, endS: analysis.durationS });
  });

  test("the timeline keeps only frames in that stretch, starting at 0 at the video's rate", () => {
    const fps = 30;
    const all = buildTimeline(analysis, DEFAULT_OVERLAYS, fps);
    expect(outputTimeline(analysis, DEFAULT_OVERLAYS, fps, "whole")).toHaveLength(all.length);

    const frames = outputTimeline(analysis, DEFAULT_OVERLAYS, fps, 0);
    const span = coveredSpan(analysis, 0);
    expect(frames.length).toBeGreaterThan(fps);
    expect(frames.length).toBeLessThan(all.length);
    frames.forEach((f, j) => {
      expect(f.outTimeS).toBeCloseTo(j / fps, 12);
      expect(f.clipTimeS).toBeGreaterThanOrEqual(span.startS - 1e-6);
      expect(f.clipTimeS).toBeLessThanOrEqual(span.endS + 1e-6);
    });
    expect(frames[0]?.clipTimeS).toBeLessThan(span.startS + 1 / fps);
    expect(frames[frames.length - 1]?.clipTimeS).toBeGreaterThan(span.endS - 1 / fps);
    // The slow motion around the contact is kept, and the frames before the stretch are not.
    expect(frames.some((f) => f.slow)).toBe(true);
    expect(all.filter((f) => f.clipTimeS < span.startS - 1e-6).length).toBeGreaterThan(fps);

    const noSlow = outputTimeline(analysis, { ...DEFAULT_OVERLAYS, slowMotion: false }, fps, 0);
    expect(noSlow.length).toBeLessThan(frames.length);
    expect(noSlow.some((f) => f.slow)).toBe(false);
  });
});

describe("size and frame rate of the video", () => {
  test("the frame rate from the frames' spacing, rounded; 30 when it cannot be told", () => {
    expect(clipFps(analysis)).toBe(30);
    expect(clipFps(testAnalysis({ fps: 60 }))).toBe(60);
    const jittery = [0, 0.0334, 0.0666, 0.1001, 0.1333, 0.25].map((timeS) => ({
      timeS,
      balls: [],
    }));
    expect(clipFps({ frames: jittery })).toBe(30);
    expect(clipFps({ frames: [] })).toBe(DEFAULT_FPS);
    expect(clipFps({ frames: [{ timeS: 1, balls: [] }] })).toBe(DEFAULT_FPS);
  });

  test("the clip's size, the longer side at most 1920, even numbers", () => {
    expect(outputSize(1280, 720)).toEqual({ widthPx: 1280, heightPx: 720 });
    expect(outputSize(3840, 2160)).toEqual({ widthPx: 1920, heightPx: 1080 });
    expect(outputSize(1080, 1920)).toEqual({ widthPx: 1080, heightPx: 1920 });
    expect(outputSize(2160, 3841)).toEqual({ widthPx: 1080, heightPx: 1920 });
    expect(outputSize(641, 359)).toEqual({ widthPx: 642, heightPx: 360 });
  });
});

describe("Open in editor", () => {
  function startDoc(): DiagramDoc {
    const doc = newDoc("pool-9@1");
    return {
      ...doc,
      balls: [
        { id: "1", kind: "cue", x: 0.3, y: 0.3 },
        { id: "2", kind: "8", x: 0.6, y: 1.2 },
      ],
    };
  }

  beforeEach(() => {
    useEditor.getState().openDoc(startDoc());
  });

  test("the balls at rest before the shot, and the fitted shot on the document's cue ball", () => {
    const doc = docWithClipShot(startDoc(), shot);
    expect(doc.balls.map((b) => b.kind)).toEqual(shot.balls.map((b) => b.kind));
    doc.balls.forEach((b, i) => {
      const from = shot.balls[i];
      expect(b.x).toBeCloseTo(from?.x ?? NaN, 6);
      expect(b.y).toBeCloseTo(from?.y ?? NaN, 6);
    });
    // Ids are the document's own, not the analysis's.
    expect(doc.balls.map((b) => b.id)).not.toContain("cue");
    const cue = doc.balls.find((b) => b.kind === "cue");
    expect(doc.shot).toEqual({
      cueBallId: cue?.id,
      aimAngleRad: shot.shot.aimAngleRad,
      speedMps: shot.shot.speedMps,
      tipOffset: shot.shot.tipOffset,
    });
    // The document format has no video source: the layout is marked as from a camera picture.
    expect(doc.source).toEqual({ kind: "photo" });
  });

  test("is one undo step", () => {
    const before = useEditor.getState().history;
    openShotInEditor(shot);
    const after = useEditor.getState().history;
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(after.present.balls).toHaveLength(shot.balls.length);
    expect(after.present.shot?.speedMps).toBe(shot.shot.speedMps);
    useEditor.getState().undo();
    expect(useEditor.getState().history.present).toBe(before.present);
    useEditor.getState().redo();
    expect(useEditor.getState().history.present).toBe(after.present);
  });
});

describe("the minimap's cloth", () => {
  test("the table theme uses the document's cloth colour carried by the analysis", () => {
    expect(clothColour(THEMES.table, "#3366aa")).toBe("#3366aa");
    expect(clothColour(THEMES.table)).toBe(MINIMAP_CLOTH);
    // The print and dark themes have their own cloth.
    expect(clothColour(THEMES.print, "#3366aa")).toBe(THEMES.print.cloth);
    expect(clothColour(THEMES.dark, "#3366aa")).toBe(THEMES.dark.cloth);
  });
});
