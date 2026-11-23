import { getBallSet, getTablePreset } from "@baize/tables";
import type { TableCorners } from "@baize/vision";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { PhotoReviewView } from "../photo/PhotoReview";
import type { PhotoReviewViewProps } from "../photo/PhotoReview";
import {
  CALIBRATION_NOT_PLACED,
  CALIBRATION_PLACED,
  calibrationSummary,
  kindChoices,
} from "../photo/reviewModel";
import { CLIP_ACCEPT, CLIP_GUIDANCE, ClipImport, ClipImportView } from "./ClipImport";
import type { ClipInfo } from "./media";
import { MESSAGE_STOPPED } from "./resultsModel";
import {
  CALIBRATED_READY,
  CLIP_STAYS,
  ClipDetails,
  TRACKING_HELP,
  VideoScreenView,
  trackingText,
} from "./VideoScreenView";
import type { VideoScreenViewProps } from "./VideoScreenView";

const table = getTablePreset("pool-9@1");
const maybeSet = table ? getBallSet(table.defaultBallSetId) : undefined;
if (!table || !maybeSet) throw new Error("missing preset");
const ballSet = maybeSet;

const INFO: ClipInfo = {
  widthPx: 1920,
  heightPx: 1080,
  durationS: 8.43,
  rotationDeg: 0,
  codec: "avc",
};
const corners: TableCorners = [
  { u: 300, v: 950 },
  { u: 1620, v: 950 },
  { u: 1400, v: 200 },
  { u: 520, v: 200 },
];

const clean = (markup: string) => markup.replaceAll("<!-- -->", "");
const screen = (p: VideoScreenViewProps) => clean(renderToStaticMarkup(<VideoScreenView {...p} />));

describe("idle: the entry in the editor", () => {
  test("a button, a labelled video file input and the guidance", () => {
    const markup = clean(
      renderToStaticMarkup(<ClipImportView disabled={false} focusToken={0} onChoose={vi.fn()} />),
    );
    expect(markup).toMatch(/<button type="button" aria-describedby="([^"]+)">Overlay a clip</);
    const about = /aria-describedby="([^"]+)"/.exec(markup)?.[1] ?? "";
    expect(markup).toContain(`<p id="${about}" class="toolbar-note">${CLIP_GUIDANCE}</p>`);
    expect(markup).toContain(`accept="${CLIP_ACCEPT}"`);
    expect(CLIP_ACCEPT).toContain("video/*");
    for (const ext of [".mp4", ".mov", ".webm"]) expect(CLIP_ACCEPT).toContain(ext);
    expect(markup).toContain('aria-label="Video clip of the table"');
    // Choosing a clip that exists, not recording one.
    expect(markup).not.toContain("capture");
    expect(CLIP_GUIDANCE).toContain("The clip stays on this device.");
  });

  test("the connected entry shows no screen until a clip is chosen", () => {
    const markup = renderToStaticMarkup(<ClipImport />);
    expect(markup).toContain(">Overlay a clip</button>");
    expect(markup).not.toContain('role="dialog"');
  });

  test("it is disabled while the diagram cannot be shown", () => {
    const markup = renderToStaticMarkup(
      <ClipImportView disabled focusToken={0} onChoose={vi.fn()} />,
    );
    expect(markup).toMatch(/disabled=""[^>]*>Overlay a clip/);
  });
});

describe("opening and error", () => {
  test("opening: a labelled dialog that says so, with Close", () => {
    const markup = screen({ phase: "opening", fileName: "break.mp4", onClose: vi.fn() });
    expect(markup).toMatch(/role="dialog" aria-modal="true" aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(markup)?.[1] ?? "";
    expect(markup).toContain(`<h2 id="${id}">Overlay a clip</h2>`);
    expect(markup).toContain('data-phase="opening"');
    expect(markup).toContain('<p role="status">Opening the clip…</p>');
    expect(markup).toContain("break.mp4");
    expect(markup).toContain(">Close</button>");
    expect(markup).toContain(CLIP_STAYS);
  });

  test("error: the message as an alert, and Close", () => {
    const message =
      "This browser cannot decode this video. Try another browser, or record the clip as H.264.";
    const markup = screen({ phase: "error", message, fileName: "x.mov", onClose: vi.fn() });
    expect(markup).toContain('data-phase="error"');
    expect(markup).toMatch(/role="alert"[^>]*>This browser cannot decode this video/);
    expect(markup).toContain(">Close</button>");
    expect(markup).not.toContain("Adjust the corners");
  });
});

describe("calibrating: the photo review's corner handles on the first frame", () => {
  function props(over: Partial<PhotoReviewViewProps> = {}): PhotoReviewViewProps {
    return {
      purpose: "calibration",
      details: <ClipDetails fileName="break.mp4" info={INFO} />,
      photoUrl: "blob:frame",
      widthPx: INFO.widthPx,
      heightPx: INFO.heightPx,
      corners,
      markers: [],
      summary: calibrationSummary(true),
      messages: [],
      hasCamera: true,
      busy: false,
      runs: 0,
      canConfirm: true,
      kinds: kindChoices(ballSet),
      selectedId: undefined,
      addKind: "cue",
      adding: false,
      onCornerMove: vi.fn(),
      onCornerEnd: vi.fn(),
      onCornerKey: vi.fn(),
      onTurn: vi.fn(),
      onFindAgain: vi.fn(),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      onSelect: vi.fn(),
      onChangeKind: vi.fn(),
      onRemove: vi.fn(),
      onPickAddKind: vi.fn(),
      onToggleAdding: vi.fn(),
      onPlace: vi.fn(),
      ...over,
    };
  }
  const review = (p: PhotoReviewViewProps) =>
    clean(renderToStaticMarkup(<PhotoReviewView {...p} />));

  test("titled for the table, with the clip's details and the four handles", () => {
    const markup = review(props());
    const id = /aria-labelledby="([^"]+)"/.exec(markup)?.[1] ?? "";
    expect(markup).toContain(`<h2 id="${id}">Find the table</h2>`);
    expect(markup).toContain('alt="The first frame of your clip"');
    expect(markup).toContain('src="blob:frame"');
    expect(markup).toContain("1920 × 1080");
    expect(markup).toContain("8.4 s");
    expect(markup).toContain("H.264");
    expect(markup.match(/class="photo-handle"/g)).toHaveLength(4);
    expect(markup).toContain(CALIBRATION_PLACED);
  });

  test("offers the table, not ball editing", () => {
    const markup = review(props());
    for (const name of [
      "Turn the table round",
      "Find the table again",
      "Use this table",
      "Close the clip",
    ]) {
      expect(markup).toContain(`>${name}</button>`);
    }
    expect(markup).not.toContain("Use these balls");
    expect(markup).not.toContain("Add a ball");
    expect(markup).not.toContain("Tap a ball");
    expect(markup).not.toContain("changes you made to balls by hand are lost");
  });

  test("a table not placed cannot be used, and a busy screen says what it is doing", () => {
    const markup = review(props({ canConfirm: false, summary: calibrationSummary(false) }));
    expect(markup).toMatch(/disabled=""[^>]*>Use this table/);
    expect(markup).toContain(CALIBRATION_NOT_PLACED);
    expect(review(props({ busy: true }))).toContain("Finding the table…");
  });
});

describe("calibrated", () => {
  const calibrated = (over: Partial<Extract<VideoScreenViewProps, { phase: "calibrated" }>> = {}) =>
    screen({
      phase: "calibrated",
      fileName: "break.mp4",
      info: INFO,
      frameUrl: "blob:frame",
      frameSize: { widthPx: 1920, heightPx: 1080 },
      corners,
      onAdjust: vi.fn(),
      onTrack: vi.fn(),
      onClose: vi.fn(),
      ...over,
    });

  test("the frame with the table outlined, the clip's details, and Track the balls", () => {
    const markup = calibrated();
    expect(markup).toContain('data-phase="calibrated"');
    expect(markup).toContain(`<p role="status">${CALIBRATED_READY}</p>`);
    expect(markup).toContain('src="blob:frame"');
    expect(markup).toContain('viewBox="0 0 1920 1080"');
    expect(markup).toContain('points="300,950 1620,950 1400,200 520,200"');
    expect(markup).toContain("<dt>Codec</dt><dd>H.264</dd>");
    expect(markup).toContain("<dt>Length</dt><dd>8.4 s</dd>");
    expect(markup).toContain(
      '<button type="button" class="photo-primary">Track the balls</button>',
    );
    expect(markup).toContain(">Adjust the corners</button>");
    expect(markup).toContain(">Close</button>");
    expect(markup).not.toContain('role="alert"');
  });

  test("after an error: the message in plain words, and tracking can be tried again", () => {
    const markup = calibrated({
      notice: { kind: "error", text: "The clip analysis could not run in the background." },
    });
    expect(markup).toMatch(
      /role="alert"[^>]*>The clip analysis could not run in the background\.</,
    );
    expect(markup).toContain(">Track the balls again</button>");
    expect(markup).toContain(`<p role="status">${CALIBRATED_READY}</p>`);
  });

  test("after Stop: back to the placed table, saying so", () => {
    const markup = calibrated({ notice: { kind: "stopped", text: MESSAGE_STOPPED } });
    expect(markup).toContain(`<p role="status">${MESSAGE_STOPPED}</p>`);
    expect(markup).not.toContain('role="alert"');
    expect(markup).toContain(">Track the balls again</button>");
  });
});

describe("tracking", () => {
  const tracking = (stage: "tracking" | "fitting", share: number) =>
    screen({
      phase: "tracking",
      fileName: "break.mp4",
      info: INFO,
      frameUrl: "blob:frame",
      frameSize: { widthPx: 1920, heightPx: 1080 },
      corners,
      progress: { stage, share },
      onStop: vi.fn(),
      onClose: vi.fn(),
    });

  test("the stage and share as words and a progress bar, with Stop", () => {
    const markup = tracking("tracking", 0.423);
    expect(markup).toContain('data-phase="tracking"');
    expect(markup).toContain('<p role="status">Tracking the balls: 42 %</p>');
    expect(markup).toContain('<progress max="1" value="0.423" aria-label="Tracking progress"');
    expect(markup).toContain(TRACKING_HELP);
    expect(markup).toContain(">Stop</button>");
    expect(markup).toContain(">Close</button>");
    expect(markup).not.toContain("Track the balls</button>");
    expect(markup).not.toContain("Adjust the corners");
    expect(tracking("fitting", 1)).toContain('<p role="status">Fitting the shots: 100 %</p>');
  });

  test("shares out of range are shown within 0 and 100 %", () => {
    expect(trackingText({ stage: "tracking", share: -1 })).toBe("Tracking the balls: 0 %");
    expect(trackingText({ stage: "fitting", share: 3 })).toBe("Fitting the shots: 100 %");
    expect(trackingText({ stage: "fitting", share: Number.NaN })).toBe("Fitting the shots: 0 %");
  });
});
