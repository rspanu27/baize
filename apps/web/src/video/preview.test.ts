import { describe, expect, test, vi } from "vitest";
import type { Clip, ClipFrame } from "./media";
import { playTimeline } from "./preview";
import type { PlayRequest } from "./preview";
import type { TimelineFrame } from "./types";

/** A clip of `count` frames at `fps`, each canvas tagged with its frame number. */
function fakeClip(count: number, fps: number) {
  const log = { returned: 0, startedAt: [] as number[] };
  const frame = (i: number): ClipFrame => ({
    canvas: { width: 64, height: 36, tag: i } as unknown as HTMLCanvasElement,
    timestampS: i / fps,
    durationS: 1 / fps,
  });
  const clip: Clip = {
    info: { widthPx: 64, heightPx: 36, durationS: count / fps, rotationDeg: 0, codec: "avc" },
    async *frames(fromS = 0) {
      log.startedAt.push(fromS);
      try {
        // As Mediabunny: from the frame shown at `fromS`.
        for (let i = Math.max(0, Math.floor(fromS * fps + 1e-9)); i < count; i++) {
          await Promise.resolve();
          yield frame(i);
        }
      } finally {
        log.returned++;
      }
    },
    frameAt: (t) => Promise.resolve(t < count / fps ? frame(Math.floor(t * fps)) : undefined),
    close: () => undefined,
  };
  return { clip, log };
}

/** A canvas whose content is the tag of the last frame drawn on it. */
function fakeCanvas() {
  const canvas = { width: 0, height: 0, content: -1 } as {
    width: number;
    height: number;
    content: number;
    getContext?: () => unknown;
  };
  canvas.getContext = () => ({
    drawImage: (src: { tag: number }) => {
      canvas.content = src.tag;
    },
  });
  return canvas as unknown as HTMLCanvasElement;
}

/** 0.5 s at 30 fps where clip frames 6 to 8 are each shown four times (quarter speed). */
function timeline(): TimelineFrame[] {
  const out: TimelineFrame[] = [];
  let clip = 0;
  for (let j = 0; j < 30; j++) {
    const slow = clip >= 6 / 30 - 1e-9 && clip < 9 / 30 - 1e-9;
    out.push({ outTimeS: j / 30, clipTimeS: clip, slow });
    clip += (slow ? 0.25 : 1) / 30;
  }
  return out;
}

function request(over: Partial<PlayRequest> & Pick<PlayRequest, "clip">) {
  const shown: { index: number; content: number }[] = [];
  let t = 0;
  const req: PlayRequest = {
    timeline: timeline(),
    from: 0,
    fps: 30,
    show: (source, index) => {
      shown.push({ index, content: (source as unknown as { content: number }).content });
    },
    onBehind: vi.fn(),
    signal: new AbortController().signal,
    now: () => t,
    wait: (ms) => {
      t += ms;
      return Promise.resolve();
    },
    createCanvas: fakeCanvas,
    ...over,
  };
  return { req, shown, advance: (ms: number) => (t += ms) };
}

describe("playing the preview", () => {
  test("every frame from the start in order, each showing the clip frame at or before its time", async () => {
    const { clip, log } = fakeClip(40, 30);
    const { req, shown } = request({ clip });
    const last = await playTimeline(req);
    const frames = req.timeline;
    expect(last).toBe(frames.length - 1);
    expect(shown.map((s) => s.index)).toEqual(frames.map((_, j) => j));
    shown.forEach((s, j) => {
      expect(s.content).toBe(Math.floor((frames[j]?.clipTimeS ?? 0) * 30 + 1e-6));
    });
    // The slow stretch repeats clip frames; the clip was decoded once, in order.
    expect(shown.filter((s) => s.content === 7)).toHaveLength(4);
    expect(log.startedAt).toEqual([0]);
    expect(log.returned).toBe(1);
    expect(req.onBehind).not.toHaveBeenCalled();
  });

  test("from a chosen frame, decoding from its clip time", async () => {
    const { clip, log } = fakeClip(40, 30);
    const { req, shown } = request({ clip, from: 20 });
    await playTimeline(req);
    expect(shown[0]?.index).toBe(20);
    expect(log.startedAt).toEqual([req.timeline[20]?.clipTimeS]);
  });

  test("a device too slow for real time plays every frame anyway, and says so once", async () => {
    const { clip } = fakeClip(40, 30);
    let t = 0;
    const onBehind = vi.fn();
    const { req, shown } = request({
      clip,
      onBehind,
      // Each look at the clock finds 100 ms gone: decoding and drawing take longer than a frame.
      now: () => (t += 100),
    });
    await playTimeline(req);
    expect(shown).toHaveLength(req.timeline.length);
    expect(onBehind).toHaveBeenCalledTimes(1);
  });

  test("stopping ends the play and the decoding", async () => {
    const { clip, log } = fakeClip(40, 30);
    const abort = new AbortController();
    const holder: { shown?: { index: number }[] } = {};
    const { req, shown } = request({
      clip,
      signal: abort.signal,
      show: (_source, index) => {
        holder.shown?.push({ index });
        if (index === 4) abort.abort();
      },
    });
    holder.shown = shown;
    const last = await playTimeline(req);
    expect(last).toBe(4);
    expect(shown.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(log.returned).toBe(1);
  });
});
