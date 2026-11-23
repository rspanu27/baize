import { getBallSet, getTablePreset } from "@baize/tables";
import type { ImportResult, PhotoImage, TableCorners } from "@baize/vision";
import { describe, expect, test, vi } from "vitest";
import type { PhotoAnalyser } from "../photo/analyser";
import {
  MESSAGE_NO_FRAME,
  MESSAGE_UNREADABLE,
  codecText,
  durationText,
  firstFrame,
  openClipSession,
  openingMessage,
  sizeText,
} from "./clipSession";
import type { ClipSessionDeps } from "./clipSession";
import type { Clip, ClipFrame } from "./media";

const table = getTablePreset("pool-9@1");
const maybeSet = table ? getBallSet(table.defaultBallSetId) : undefined;
if (!table || !maybeSet) throw new Error("missing preset");
const ballSet = maybeSet;

const corners: TableCorners = [
  { u: 100, v: 400 },
  { u: 540, v: 400 },
  { u: 460, v: 80 },
  { u: 180, v: 80 },
];
const RESULT: ImportResult = {
  corners,
  layout: { balls: [{ kind: "cue", x: 0.5, y: 0.6, confidence: 0.9 }] },
  diagnostics: { cornersDetected: true } as ImportResult["diagnostics"],
};

const FRAME = { canvas: {}, timestampS: 0, durationS: 1 / 30 } as unknown as ClipFrame;

function fakeClip(frames: { atStart?: ClipFrame; all?: ClipFrame[] } = { atStart: FRAME }) {
  const close = vi.fn();
  const clip: Clip = {
    info: { widthPx: 640, heightPx: 480, durationS: 2, rotationDeg: 0, codec: "avc" },
    async *frames() {
      for (const f of frames.all ?? []) {
        await Promise.resolve();
        yield f;
      }
    },
    frameAt: () => Promise.resolve(frames.atStart),
    close,
  };
  return { clip, close };
}

function fakes(
  over: {
    clip?: Clip;
    open?: () => Promise<Clip>;
    run?: () => Promise<ImportResult>;
  } = {},
) {
  const clip = over.clip ?? fakeClip().clip;
  const dispose = vi.fn();
  const revokeUrl = vi.fn();
  const handed: PhotoImage[] = [];
  const analyser: PhotoAnalyser = {
    run: vi.fn(over.run ?? (() => Promise.resolve(RESULT))),
    dispose,
  };
  const deps: ClipSessionDeps = {
    openClip: over.open ?? (() => Promise.resolve(clip)),
    readFrame: () =>
      Promise.resolve({
        image: { widthPx: 640, heightPx: 480, data: new Uint8ClampedArray(640 * 480 * 4) },
        url: "blob:frame",
      }),
    createAnalyser: (image) => {
      handed.push(image);
      return analyser;
    },
    revokeUrl,
  };
  return { deps, analyser, dispose, revokeUrl, handed };
}

const file = new File(["not really a video"], "break.mp4", { type: "video/mp4" });

describe("openClipSession", () => {
  test("opens the clip, reads its first frame and finds the table on it", async () => {
    const { clip } = fakeClip();
    const f = fakes({ clip });
    const session = await openClipSession(
      file,
      table,
      ballSet,
      f.deps,
      new AbortController().signal,
    );
    expect(session.clip).toBe(clip);
    expect(session.fileName).toBe("break.mp4");
    expect(session.frameUrl).toBe("blob:frame");
    expect(session.frameSize).toEqual({ widthPx: 640, heightPx: 480 });
    expect(f.handed).toHaveLength(1);
    expect(f.analyser.run).toHaveBeenCalledWith(table, ballSet);
    expect(session.initial.corners).toEqual(corners);
    expect(session.initial.cornersDetected).toBe(true);
    expect(session.initial.balls).toHaveLength(1);
  });

  test("closing ends the worker, revokes the frame's URL and closes the clip, once", async () => {
    const { clip, close } = fakeClip();
    const f = fakes({ clip });
    const session = await openClipSession(
      file,
      table,
      ballSet,
      f.deps,
      new AbortController().signal,
    );
    expect(close).not.toHaveBeenCalled();
    session.close();
    session.close();
    expect(f.dispose).toHaveBeenCalledTimes(1);
    expect(f.revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:frame");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("a clip that cannot be opened gives its plain message", async () => {
    const f = fakes({
      open: () => Promise.reject(new Error("This file has no video in it.")),
    });
    const failed = openClipSession(file, table, ballSet, f.deps, new AbortController().signal);
    await expect(failed).rejects.toThrow("This file has no video in it.");
    expect(f.handed).toHaveLength(0);
  });

  test("a clip without a frame is closed and explained", async () => {
    const { clip, close } = fakeClip({});
    const f = fakes({ clip });
    await expect(
      openClipSession(file, table, ballSet, f.deps, new AbortController().signal),
    ).rejects.toThrow(MESSAGE_NO_FRAME);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("if the table finder fails, everything made so far is let go", async () => {
    const { clip, close } = fakeClip();
    const f = fakes({
      clip,
      run: () => Promise.reject(new Error("The photo could not be analysed.")),
    });
    await expect(
      openClipSession(file, table, ballSet, f.deps, new AbortController().signal),
    ).rejects.toThrow("could not be analysed");
    expect(f.dispose).toHaveBeenCalledTimes(1);
    expect(f.revokeUrl).toHaveBeenCalledWith("blob:frame");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("closing the screen while the clip opens lets everything go", async () => {
    const { clip, close } = fakeClip();
    const abort = new AbortController();
    const f = fakes({
      clip,
      run: () => {
        abort.abort(new Error("closed"));
        return Promise.resolve(RESULT);
      },
    });
    await expect(openClipSession(file, table, ballSet, f.deps, abort.signal)).rejects.toThrow(
      "closed",
    );
    expect(f.dispose).toHaveBeenCalledTimes(1);
    expect(f.revokeUrl).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("firstFrame", () => {
  test("is the frame at 0 s, or the first frame of a clip that starts later", async () => {
    expect(await firstFrame(fakeClip().clip)).toBe(FRAME);
    const later = { ...FRAME, timestampS: 0.04 };
    expect(await firstFrame(fakeClip({ all: [later, FRAME] }).clip)).toBe(later);
    expect(await firstFrame(fakeClip({}).clip)).toBeUndefined();
  });
});

describe("clip details in words", () => {
  test("size, length and codec", () => {
    expect(sizeText({ widthPx: 1920, heightPx: 1080 })).toBe("1920 × 1080");
    expect(durationText(8.43)).toBe("8.4 s");
    expect(durationText(65.2)).toBe("1 min 05 s");
    expect(durationText(Number.NaN)).toBe("unknown length");
    expect(codecText("avc")).toBe("H.264");
    expect(codecText("hevc")).toBe("HEVC (H.265)");
    expect(codecText("prores")).toBe("prores");
  });

  test("an opening error is shown in its own words, or a plain fallback", () => {
    expect(openingMessage(new Error("This file has no video in it."))).toBe(
      "This file has no video in it.",
    );
    expect(openingMessage("boom")).toBe(MESSAGE_UNREADABLE);
  });
});
