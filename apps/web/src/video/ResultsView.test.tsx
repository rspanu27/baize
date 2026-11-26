import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { fittedShot, testAnalysis } from "./overlay/testAnalysis";
import { SPEED_MAX } from "../shot/shotModel";
import {
  MESSAGE_NOT_FITTED,
  MESSAGE_PICK_SHOT,
  NO_SHOTS,
  NO_SHOTS_HINT,
  clampNote,
} from "./resultsModel";
import { OVERLAY_FLAGS, PREVIEW_BEHIND, ResultsView } from "./ResultsView";
import type { ResultsViewProps } from "./ResultsView";
import { DEFAULT_OVERLAYS } from "./types";
import type { ClipShot } from "./types";

const analysis = testAnalysis({ widthPx: 1280, heightPx: 720 });
const first = fittedShot(analysis);
const shots: ClipShot[] = [
  { ...first, startS: 0.5, rmsM: 0.004 },
  { ...first, index: 1, startS: 12.25, rmsM: 0.05, shot: { ...first.shot, speedMps: 1.5 } },
];

function props(over: Partial<ResultsViewProps> = {}): ResultsViewProps {
  return {
    details: <p>break.mp4</p>,
    durationS: 20,
    shots,
    choice: 0,
    options: DEFAULT_OVERLAYS,
    units: "metric",
    canvasRef: { current: null },
    widthPx: 1280,
    heightPx: 720,
    frameCount: 90,
    frameIndex: 30,
    timeS: 1,
    lengthS: 3,
    playing: false,
    behind: false,
    save: { kind: "idle" },
    onChoose: vi.fn(),
    onFlag: vi.fn(),
    onTheme: vi.fn(),
    onScrub: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onSave: vi.fn(),
    onCancelSave: vi.fn(),
    onOpen: vi.fn(),
    onAdjust: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

const clean = (markup: string) => markup.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
const view = (p: ResultsViewProps) => clean(renderToStaticMarkup(<ResultsView {...p} />));

/** The markup of the label (choice) whose text contains `text`. */
function labelWith(markup: string, text: string): string {
  const labels = markup.match(/<label[^>]*>.*?<\/label>/g) ?? [];
  const found = labels.find((l) => l.includes(text));
  if (!found) throw new Error(`no label with ${text}`);
  return found;
}

describe("results", () => {
  test("the shots found, each with its time, the cue ball's speed and the fit", () => {
    const markup = view(props());
    expect(markup).toContain('data-phase="analysed"');
    expect(markup).toContain('<p role="status">2 shots found.</p>');
    expect(markup).toContain("<legend>The video shows</legend>");
    expect(labelWith(markup, "Whole clip")).toContain("0:20.0");
    const one = labelWith(markup, "Shot 1 at 0:00.5");
    expect(one).toContain("cue ball 3 m/s, good fit (0.4 cm)");
    expect(one).toContain('checked=""');
    const two = labelWith(markup, "Shot 2 at 0:12.3");
    expect(two).toContain("cue ball 1.5 m/s, poor fit (5.0 cm)");
    expect(two).not.toContain('checked=""');
    expect(labelWith(markup, "Whole clip")).not.toContain('checked=""');
  });

  test("speeds follow the units preference", () => {
    const markup = view(props({ units: "imperial" }));
    expect(markup).toContain("cue ball 3.4 mph");
    expect(markup).toContain("Speeds in mph, as set in the editor.");
  });

  test("no shot found: says so with a hint; the whole clip can still be saved", () => {
    const markup = view(props({ shots: [], choice: "whole" }));
    expect(markup).toContain(`<p role="status">${NO_SHOTS}</p>`);
    expect(markup).toContain(NO_SHOTS_HINT);
    expect(NO_SHOTS_HINT).toMatch(/camera was still/);
    expect(NO_SHOTS_HINT).toMatch(/whole table/);
    expect(NO_SHOTS_HINT).toMatch(/cue ball can be seen on the first frame/);
    expect(labelWith(markup, "Whole clip")).toContain('checked=""');
    expect(markup).toMatch(/<button type="button" class="photo-primary">Save video</);
    expect(markup).toMatch(/disabled=""[^>]*>Open in editor/);
  });

  test("Open in editor needs a shot picked", () => {
    expect(view(props())).toMatch(/<button type="button">Open in editor</);
    const whole = view(props({ choice: "whole" }));
    expect(whole).toMatch(/aria-describedby="([^"]+)"[^>]*>Open in editor/);
    const hint = /aria-describedby="([^"]+)"[^>]*>Open in editor/.exec(whole)?.[1] ?? "";
    expect(whole).toContain(`id="${hint}" class="photo-help clip-open-hint">${MESSAGE_PICK_SHOT}`);
  });

  test("a shot that could not be fitted is listed, and cannot be opened in the editor", () => {
    const withUnfitted: ClipShot[] = [
      ...shots,
      {
        fitted: false,
        index: 2,
        startS: 15,
        endS: 16,
        cueBallId: first.cueBallId,
        balls: first.balls,
      },
    ];
    const markup = view(props({ shots: withUnfitted, choice: 2 }));
    expect(markup).toContain('<p role="status">3 shots found, 1 could not be fitted.</p>');
    const three = labelWith(markup, "Shot 3 at 0:15.0");
    expect(three).toContain("could not be fitted");
    expect(three).toContain('checked=""');
    expect(markup).toMatch(/disabled=""[^>]*>Open in editor/);
    expect(markup).toContain(MESSAGE_NOT_FITTED);
    // A fitted shot beside it still opens.
    expect(view(props({ shots: withUnfitted, choice: 0 }))).toMatch(
      /<button type="button">Open in editor</,
    );
  });

  test("a shot faster than the editor allows says it opens at the editor's top speed", () => {
    const fast: ClipShot[] = [{ ...first, shot: { ...first.shot, speedMps: SPEED_MAX + 2 } }];
    expect(view(props({ shots: fast, choice: 0 }))).toContain(clampNote("metric"));
    expect(view(props())).not.toContain(clampNote("metric"));
  });
});

describe("overlay choices", () => {
  test("a labelled checkbox for each overlay, ticked as the options say", () => {
    const markup = view(props());
    expect(markup).toContain("<legend>Overlays</legend>");
    expect(OVERLAY_FLAGS.map(([flag]) => flag).sort()).toEqual(
      ["allTrails", "cueTrail", "ghostBall", "labels", "minimap", "slowMotion", "speed"].sort(),
    );
    for (const [flag, label] of OVERLAY_FLAGS) {
      const l = labelWith(markup, label);
      expect(l).toContain('type="checkbox"');
      expect(l.includes('checked=""')).toBe(DEFAULT_OVERLAYS[flag]);
    }
    const all = view(props({ options: { ...DEFAULT_OVERLAYS, allTrails: true, cueTrail: false } }));
    expect(labelWith(all, "Every ball's path")).toContain('checked=""');
    expect(labelWith(all, "Cue ball's path")).not.toContain('checked=""');
  });

  test("the theme select offers the editor's themes, on the one chosen", () => {
    const markup = view(props({ options: { ...DEFAULT_OVERLAYS, theme: "dark" } }));
    const select = labelWith(markup, "Colours");
    expect(select).toContain('<option value="table">Table colours</option>');
    expect(select).toContain('<option value="print">Print (white)</option>');
    expect(select).toContain('<option value="dark" selected="">Dark</option>');
  });
});

describe("preview", () => {
  test("a canvas at the video's size, a labelled scrubber over its frames, and Play", () => {
    const markup = view(props());
    expect(markup).toMatch(/<canvas class="clip-canvas" width="1280" height="720"/);
    expect(markup).toContain('aria-label="Preview of the video with the overlays"');
    expect(markup).toMatch(/<input type="range" min="0" max="89" step="1" [^>]*value="30"/);
    expect(markup).toContain('aria-label="Preview time"');
    expect(markup).toContain('aria-valuetext="0:01.0 of 0:03.0"');
    expect(markup).toContain(">Play</button>");
    expect(markup).not.toContain(PREVIEW_BEHIND);
  });

  test("while playing: Pause; and a note when the preview falls behind", () => {
    const markup = view(props({ playing: true, behind: true }));
    expect(markup).toContain(">Pause</button>");
    expect(markup).not.toContain(">Play</button>");
    expect(markup).toContain(PREVIEW_BEHIND);
  });
});

describe("saving", () => {
  test("progress with Cancel; the choices and other actions wait", () => {
    const markup = view(props({ save: { kind: "saving", done: 30, total: 120 } }));
    expect(markup).toContain('<p role="status">Writing the video: 25 %</p>');
    expect(markup).toMatch(/<progress max="1" value="0.25" aria-label="Writing progress"/);
    expect(markup).toContain(">Cancel</button>");
    expect(markup).toMatch(/disabled=""[^>]*>Save video/);
    expect(markup).toMatch(/disabled=""[^>]*>Open in editor/);
    expect(markup).toMatch(/disabled=""[^>]*>Play/);
    expect(markup.match(/<fieldset[^>]*disabled=""/g)).toHaveLength(2);
    expect(markup).toMatch(/<button type="button">Close</);
  });

  test("how it ended: saved, cancelled or failed", () => {
    expect(view(props({ save: { kind: "saved", fileName: "break-baize.mp4" } }))).toContain(
      '<p role="status">Saved as break-baize.mp4.</p>',
    );
    expect(view(props({ save: { kind: "cancelled" } }))).toContain(
      '<p role="status">The video was not saved.</p>',
    );
    expect(view(props({ save: { kind: "failed", message: "No encoder." } }))).toMatch(
      /role="alert"[^>]*>No encoder\.</,
    );
  });
});
