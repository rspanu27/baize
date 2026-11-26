import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MESSAGE_CANCELLED,
  MESSAGE_NOT_WRITTEN,
  exportFileName,
  exportVideo,
  saveBlob,
} from "./export";
import type { ExportRequest } from "./export";
import { ClipError } from "./media";
import type { Clip, ClipFrame, ClipWriter } from "./media";
import type { TimelineFrame } from "./types";

/**
 * A fake canvas that remembers what it shows as a label: a clip frame's canvas shows "f<time>",
 * a drawImage copies the source's label, and the overlays add "+overlay".
 */
interface FakeCanvas {
  width: number;
  height: number;
  content: string | null;
  getContext(kind: "2d"): FakeContext;
}
interface FakeContext {
  canvas: FakeCanvas;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  clearRect(): void;
  drawImage(src: FakeCanvas): void;
  save(): void;
  restore(): void;
}

function fakeCanvas(width = 0, height = 0): FakeCanvas {
  const canvas: FakeCanvas = {
    width,
    height,
    content: null,
    getContext: () => ctx,
  };
  const ctx: FakeContext = {
    canvas,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    clearRect: () => {
      canvas.content = null;
    },
    drawImage: (src) => {
      canvas.content = src.content;
    },
    save: () => undefined,
    restore: () => undefined,
  };
  return canvas;
}

/**
 * A clip whose frames are at `times`. Like the real one, a single canvas is reused for every
 * frame, so a frame must be read before the next is asked for. `frames(from)` starts at the
 * frame shown at `from`.
 */
function fakeClip(times: readonly number[]) {
  const shared = fakeCanvas(640, 360);
  const log = { from: [] as number[], decoded: 0, closed: false };
  const clip: Clip = {
    info: { widthPx: 640, heightPx: 360, durationS: 1, rotationDeg: 0, codec: "avc" },
    async *frames(fromS = 0) {
      log.from.push(fromS);
      try {
        for (let k = 0; k < times.length; k++) {
          const t = times[k] ?? 0;
          const next = times[k + 1] ?? Number.POSITIVE_INFINITY;
          if (next <= fromS) continue;
          await Promise.resolve();
          shared.content = `f${t.toFixed(4)}`;
          log.decoded++;
          yield {
            canvas: shared as unknown as OffscreenCanvas,
            timestampS: t,
            durationS: next - t,
          } satisfies ClipFrame;
        }
      } finally {
        log.closed = true;
      }
    },
    frameAt: () => Promise.resolve(undefined),
    close: () => undefined,
  };
  return { clip, log };
}

function fakeWriter(out: { canvas?: FakeCanvas } = {}) {
  const added: { t: number; d: number; shows: string | null }[] = [];
  const calls = { finish: 0, cancel: 0 };
  const writer: ClipWriter = {
    format: "mp4",
    codec: "avc",
    add: (t, d) => {
      added.push({ t, d, shows: out.canvas?.content ?? null });
      return Promise.resolve();
    },
    finish: () => {
      calls.finish++;
      return Promise.resolve(new Blob(["video"], { type: "video/mp4" }));
    },
    cancel: () => {
      calls.cancel++;
      return Promise.resolve();
    },
  };
  return { writer, added, calls };
}

const range = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
const label = (t: number) => `f${t.toFixed(4)}+overlay`;

function request(
  clip: Clip,
  timeline: TimelineFrame[],
  fps: number,
  over: Partial<ExportRequest> = {},
) {
  const sink: { canvas?: FakeCanvas } = {};
  const w = fakeWriter(sink);
  const created: FakeCanvas[] = [];
  const draws: TimelineFrame[] = [];
  const req: ExportRequest = {
    clip,
    widthPx: 320,
    heightPx: 180,
    fps,
    timeline,
    draw: (ctx, frame) => {
      draws.push(frame);
      const c = (ctx as unknown as FakeContext).canvas;
      c.content = `${c.content ?? "empty"}+overlay`;
    },
    createCanvas: (wPx, hPx) => {
      const c = fakeCanvas(wPx, hPx);
      created.push(c);
      return c as unknown as OffscreenCanvas;
    },
    createWriter: (canvas, preferred, writerFps) => {
      sink.canvas = canvas as unknown as FakeCanvas;
      expect(preferred).toBe(over.preferred ?? "mp4");
      // The writer is told the frame rate, so the codec is chosen for it.
      expect(writerFps).toBe(fps);
      return Promise.resolve(w.writer);
    },
    ...over,
  };
  return { req, ...w, created, draws, sink };
}

const realTime = (n: number, fps: number, startS = 0): TimelineFrame[] =>
  range(n, (i) => i).map((i) => ({ outTimeS: i / fps, clipTimeS: startS + i / fps, slow: false }));

describe("exportVideo", () => {
  test("real time: each output frame shows the clip frame at its time, with the overlays", async () => {
    const { clip, log } = fakeClip(range(30, (k) => k / 30));
    const r = request(clip, realTime(30, 30), 30);
    const result = await exportVideo(r.req);
    expect(r.added.map((a) => a.shows)).toEqual(range(30, (k) => label(k / 30)));
    expect(r.added.map((a) => a.t)).toEqual(range(30, (i) => i / 30));
    r.added.forEach((a) => expect(a.d).toBeCloseTo(1 / 30, 12));
    expect(r.draws).toHaveLength(30);
    expect(log.from).toEqual([0]);
    expect(log.decoded).toBe(30);
    expect(log.closed).toBe(true);
    expect(r.calls).toEqual({ finish: 1, cancel: 0 });
    expect(result.format).toBe("mp4");
    expect(result.codec).toBe("avc");
    expect(result.frames).toBe(30);
    expect(result.seconds).toBeCloseTo(1, 12);
    expect(await result.blob.text()).toBe("video");
    // The writer gets a canvas of the output size.
    expect(r.sink.canvas?.width).toBe(320);
    expect(r.sink.canvas?.height).toBe(180);
  });

  test("slow motion: a clip frame is shown again for each output frame of the stretch", async () => {
    const { clip, log } = fakeClip(range(30, (k) => k / 30));
    // 0.25 s to 0.5 s of the clip at quarter speed: 30 output frames at 30 fps covering 7.5 clip
    // frames, each clip frame shown four times.
    const timeline = range(30, (i) => ({
      outTimeS: i / 30,
      clipTimeS: 0.25 + i / 120,
      slow: true,
    }));
    const r = request(clip, timeline, 30);
    await exportVideo(r.req);
    const expected = timeline.map((f) => label(Math.floor(f.clipTimeS * 30 + 1e-9) / 30));
    expect(r.added.map((a) => a.shows)).toEqual(expected);
    // Frames 7.5 to 14.75 of the clip: frame 7 first (shown at 0.25 s), frame 14 last.
    expect(r.added[0]?.shows).toBe(label(7 / 30));
    expect(r.added[29]?.shows).toBe(label(14 / 30));
    // Decoded once, from where the timeline starts, and only as far as needed (plus one ahead).
    expect(log.from).toEqual([0.25]);
    expect(log.decoded).toBe(9);
  });

  test("between clip frames the nearest earlier one is shown, and skipped ones are passed over", async () => {
    // A 10 fps clip.
    const { clip } = fakeClip(range(10, (k) => k / 10));
    const timeline: TimelineFrame[] = [
      { outTimeS: 0, clipTimeS: 0.04, slow: false },
      { outTimeS: 0.1, clipTimeS: 0.099, slow: false },
      { outTimeS: 0.2, clipTimeS: 0.1, slow: false },
      { outTimeS: 0.3, clipTimeS: 0.19, slow: false },
      // A jump over most of the clip.
      { outTimeS: 0.4, clipTimeS: 0.75, slow: false },
      // Past the last frame: the last frame stays.
      { outTimeS: 0.5, clipTimeS: 2, slow: false },
    ];
    const r = request(clip, timeline, 10);
    await exportVideo(r.req);
    expect(r.added.map((a) => a.shows)).toEqual([
      label(0),
      label(0),
      label(0.1),
      label(0.1),
      label(0.7),
      label(0.9),
    ]);
  });

  test("a frame time a hair after the clip time (time-scale rounding) counts as at it", async () => {
    const { clip } = fakeClip([0, 0.1 + 5e-5, 0.2]);
    const r = request(clip, [{ outTimeS: 0, clipTimeS: 0.1, slow: false }], 30);
    await exportVideo(r.req);
    expect(r.added[0]?.shows).toBe(label(0.1 + 5e-5));
  });

  test("a clip time before the clip's first frame shows that first frame", async () => {
    const { clip } = fakeClip([0.5, 0.6, 0.7]);
    const r = request(clip, realTime(3, 10, 0.4), 10);
    await exportVideo(r.req);
    expect(r.added.map((a) => a.shows)).toEqual([label(0.5), label(0.5), label(0.6)]);
  });

  test("progress is reported for every frame", async () => {
    const { clip } = fakeClip(range(10, (k) => k / 10));
    const progress: [number, number][] = [];
    const r = request(clip, realTime(10, 10), 10, {
      onProgress: (done, total) => progress.push([done, total]),
    });
    await exportVideo(r.req);
    expect(progress).toEqual(range(11, (i) => [i, 10]));
  });

  test("cancelling stops the export, cancels the writer and closes the clip's frames", async () => {
    const { clip, log } = fakeClip(range(30, (k) => k / 30));
    const abort = new AbortController();
    const r = request(clip, realTime(30, 30), 30, {
      signal: abort.signal,
      onProgress: (done) => {
        if (done === 3) abort.abort();
      },
    });
    const err = await exportVideo(r.req).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
    expect((err as DOMException).message).toBe(MESSAGE_CANCELLED);
    expect(r.added).toHaveLength(3);
    expect(r.calls).toEqual({ finish: 0, cancel: 1 });
    expect(log.closed).toBe(true);
  });

  test("an export already cancelled does not start a writer", async () => {
    const { clip } = fakeClip([0]);
    const abort = new AbortController();
    abort.abort();
    const createWriter = vi.fn();
    const r = request(clip, realTime(1, 30), 30, { signal: abort.signal, createWriter });
    await expect(exportVideo(r.req)).rejects.toMatchObject({
      name: "AbortError",
      message: MESSAGE_CANCELLED,
    });
    expect(createWriter).not.toHaveBeenCalled();
  });

  test("the page gets a turn every few frames", async () => {
    const { clip } = fakeClip(range(12, (k) => k / 12));
    const spy = vi.spyOn(globalThis, "setTimeout");
    try {
      const r = request(clip, realTime(12, 12), 12);
      await exportVideo(r.req);
      const zeroDelay = spy.mock.calls.filter((c) => c[1] === 0);
      expect(zeroDelay.length).toBeGreaterThanOrEqual(3);
    } finally {
      spy.mockRestore();
    }
  });

  test("a writer that cannot be made passes its ClipError through", async () => {
    const { clip } = fakeClip([0]);
    const e = new ClipError("cannot-encode", "This browser cannot write video.");
    const r = request(clip, realTime(1, 30), 30, { createWriter: () => Promise.reject(e) });
    await expect(exportVideo(r.req)).rejects.toBe(e);
  });

  test("a failure while writing is reported in plain words and the writer is cancelled", async () => {
    const { clip, log } = fakeClip(range(5, (k) => k / 5));
    const r = request(clip, realTime(5, 5), 5, {
      draw: () => {
        throw new Error("overlay broke");
      },
    });
    await expect(exportVideo(r.req)).rejects.toThrow(`${MESSAGE_NOT_WRITTEN} overlay broke`);
    expect(r.calls).toEqual({ finish: 0, cancel: 1 });
    expect(log.closed).toBe(true);
  });

  test("a clip with no frames is reported", async () => {
    const { clip } = fakeClip([]);
    const r = request(clip, realTime(2, 30), 30);
    await expect(exportVideo(r.req)).rejects.toThrow(/no frames to show/);
    expect(r.calls.cancel).toBe(1);
  });

  test("the WebM preference is passed to the writer", async () => {
    const { clip } = fakeClip([0]);
    const r = request(clip, realTime(1, 30), 30, { preferred: "webm" });
    await exportVideo(r.req);
    expect(r.added).toHaveLength(1);
  });

  test.each([
    [{ widthPx: 321 }, /even numbers/],
    [{ heightPx: 0 }, /even numbers/],
    [{ fps: 0 }, /frame rate/],
    [{ timeline: [] }, /no frames to write/],
    [
      {
        timeline: [
          { outTimeS: 0, clipTimeS: 0.5, slow: false },
          { outTimeS: 0.1, clipTimeS: 0.4, slow: false },
        ],
      },
      /goes back in the clip/,
    ],
    [
      {
        timeline: [
          { outTimeS: 0.1, clipTimeS: 0, slow: false },
          { outTimeS: 0.1, clipTimeS: 0.1, slow: false },
        ],
      },
      /not in order/,
    ],
  ] as [Partial<ExportRequest>, RegExp][])(
    "a request that cannot be written is refused: %o",
    async (over, message) => {
      const { clip } = fakeClip([0]);
      const createWriter = vi.fn();
      const r = request(clip, realTime(2, 30), 30, { ...over, createWriter });
      await expect(exportVideo(r.req)).rejects.toThrow(message);
      expect(createWriter).not.toHaveBeenCalled();
    },
  );
});

describe("exportFileName", () => {
  test.each([
    ["break.mp4", "mp4", "break-baize.mp4"],
    ["IMG_0042.MOV", "mp4", "IMG_0042-baize.mp4"],
    ["shot.final.webm", "webm", "shot.final-baize.webm"],
    ["no extension", "mp4", "no extension-baize.mp4"],
    ["C:\\clips\\long pot.mov", "mp4", "long pot-baize.mp4"],
    ['bad:name?*".mp4', "mp4", "bad_name___-baize.mp4"],
    ["", "mp4", "video-baize.mp4"],
    [".mp4", "webm", "video-baize.webm"],
  ] as const)("%s as %s is saved as %s", (name, format, expected) => {
    expect(exportFileName(name, format)).toBe(expected);
  });
});

describe("saveBlob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("clicks a download link for an object URL and revokes the URL afterwards", () => {
    vi.useFakeTimers();
    const a = {
      href: "",
      download: "",
      style: { display: "" },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    vi.stubGlobal("document", { createElement: vi.fn(() => a), body: { appendChild } });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    try {
      const blob = new Blob(["video"]);
      saveBlob(blob, "break-baize.mp4");
      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(a.href).toBe("blob:video");
      expect(a.download).toBe("break-baize.mp4");
      expect(appendChild).toHaveBeenCalledWith(a);
      expect(a.click).toHaveBeenCalledOnce();
      expect(a.remove).toHaveBeenCalledOnce();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:video");
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });
});
