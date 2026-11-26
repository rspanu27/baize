import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import type { VideoCodec } from "mediabunny";

/**
 * Reading and writing video files (Phase 7). The only module that imports Mediabunny
 * (MPL-2.0, see THIRD-PARTY-NOTICES.md): lint keeps every other file away from it, so the
 * library can be replaced by anything that provides this interface.
 *
 * Everything happens on this device: a clip is read from the file the person picked and a new
 * one is written to memory, to be saved by them. Nothing is uploaded or stored.
 */

/** What a clip is, as far as the editor needs to know. */
export interface ClipInfo {
  /** Size of the frames as shown (rotation applied). */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly durationS: number;
  /** Clockwise rotation the file asks for when shown, degrees. */
  readonly rotationDeg: 0 | 90 | 180 | 270;
  /** The video codec, e.g. "avc", "hevc", "vp9". */
  readonly codec: string;
  /** Average frames per second, from the first packets; undefined if it cannot be told. */
  readonly fps?: number | undefined;
}

/** One decoded frame: drawn on a canvas, with its exact time in the clip. */
export interface ClipFrame {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly timestampS: number;
  readonly durationS: number;
}

export interface Clip {
  readonly info: ClipInfo;
  /**
   * Frames from `fromS` to `toS` (default: the whole clip), in order. The canvas of a frame may
   * be reused for a later one, so read it before asking for the next.
   */
  frames(fromS?: number, toS?: number): AsyncGenerator<ClipFrame, void, unknown>;
  /** The frame shown at `timeS`, or undefined past the end. */
  frameAt(timeS: number): Promise<ClipFrame | undefined>;
  close(): void;
}

/** A clip that cannot be read, with a message in plain words. */
export class ClipError extends Error {
  readonly code: "unsupported-file" | "no-video" | "cannot-decode" | "cannot-encode";
  constructor(code: ClipError["code"], message: string) {
    super(message);
    this.name = "ClipError";
    this.code = code;
  }
}

/** Packets looked at to estimate the frame rate (a prefix of the file is enough). */
const FPS_PACKETS = 120;

/** Opens a clip from a file the person picked. */
export async function openClip(file: Blob): Promise<Clip> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let track;
  try {
    track = await input.getPrimaryVideoTrack();
  } catch {
    input.dispose();
    throw new ClipError(
      "unsupported-file",
      "This file is not a video this page can read. MP4, MOV and WebM files work.",
    );
  }
  if (!track) {
    input.dispose();
    throw new ClipError("no-video", "This file has no video in it.");
  }
  if (!(await track.canDecode())) {
    input.dispose();
    throw new ClipError(
      "cannot-decode",
      "This browser cannot decode this video. Try another browser, or record the clip as H.264 (on an iPhone: Settings, Camera, Formats, Most Compatible).",
    );
  }
  // The video track's own length: the file's can be longer (an audio track that runs on).
  const [widthPx, heightPx, durationS, rotation, codec, fps] = await Promise.all([
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    track.computeDuration(),
    track.getRotation(),
    track.getCodec(),
    track.computePacketStats(FPS_PACKETS).then(
      (s) =>
        Number.isFinite(s.averagePacketRate) && s.averagePacketRate > 0
          ? s.averagePacketRate
          : undefined,
      () => undefined,
    ),
  ]);
  const sink = new CanvasSink(track);
  return {
    info: { widthPx, heightPx, durationS, rotationDeg: rotation, codec: codec ?? "unknown", fps },
    async *frames(fromS = 0, toS = Number.POSITIVE_INFINITY) {
      for await (const f of sink.canvases(fromS, toS)) {
        yield { canvas: f.canvas, timestampS: f.timestamp, durationS: f.duration };
      }
    },
    async frameAt(timeS) {
      const f = await sink.getCanvas(timeS);
      return f ? { canvas: f.canvas, timestampS: f.timestamp, durationS: f.duration } : undefined;
    },
    close() {
      input.dispose();
    },
  };
}

export type ClipFormat = "mp4" | "webm";

/** Writes frames drawn on one canvas into a new video file, in memory. */
export interface ClipWriter {
  readonly format: ClipFormat;
  readonly codec: string;
  /** Adds what the canvas shows now as the frame at `timestampS`, lasting `durationS`. */
  add(timestampS: number, durationS: number): Promise<void>;
  /** Ends the file and returns it, ready to be saved. */
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
}

const CODECS: Record<ClipFormat, VideoCodec[]> = {
  mp4: ["avc", "hevc", "vp9", "av1"],
  webm: ["vp9", "vp8", "av1"],
};

/**
 * A writer for frames drawn on `canvas`. MP4 is preferred (it plays everywhere), with the first
 * codec this browser can encode at this size and frame rate; WebM if MP4 cannot be written.
 */
export async function createClipWriter(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  preferred: ClipFormat = "mp4",
  fps?: number,
): Promise<ClipWriter> {
  const order: ClipFormat[] = preferred === "mp4" ? ["mp4", "webm"] : ["webm", "mp4"];
  for (const format of order) {
    const codec = await getFirstEncodableVideoCodec(CODECS[format], {
      width: canvas.width,
      height: canvas.height,
      ...(fps !== undefined ? { frameRate: fps } : {}),
    });
    if (!codec) continue;
    const output = new Output({
      format:
        format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    const source = new CanvasSource(canvas, { codec, bitrate: new Quality("high") });
    output.addVideoTrack(source);
    await output.start();
    return {
      format,
      codec,
      add: (timestampS, durationS) => source.add(timestampS, durationS),
      async finish() {
        await output.finalize();
        const buffer = output.target.buffer;
        if (!buffer) throw new ClipError("cannot-encode", "The video could not be written.");
        return new Blob([buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" });
      },
      async cancel() {
        await output.cancel();
      },
    };
  }
  throw new ClipError(
    "cannot-encode",
    "This browser cannot write video. Try a recent Chrome, Edge, Firefox or Safari on a computer.",
  );
}
