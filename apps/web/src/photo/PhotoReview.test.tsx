import { getBallSet, getTablePreset } from "@baize/tables";
import { cameraFromHomography, homographyFromCorners } from "@baize/vision";
import type { TableCorners } from "@baize/vision";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { PHOTO_GUIDANCE, PhotoImportView } from "./PhotoImport";
import { PhotoReviewView } from "./PhotoReview";
import type { PhotoReviewViewProps } from "./PhotoReview";
import {
  MESSAGE_BAULK_END,
  MESSAGE_INVALID,
  MESSAGE_NOT_FOUND,
  ballMarkers,
  kindChoices,
  reviewBalls,
  reviewMessages,
  summaryText,
} from "./reviewModel";

const table = getTablePreset("pool-9@1");
const maybeSet = table ? getBallSet(table.defaultBallSetId) : undefined;
if (!table || !maybeSet) throw new Error("missing preset");
const set = maybeSet;

const W = 1000;
const H = 700;
const corners: TableCorners = [
  { u: 250, v: 600 },
  { u: 750, v: 600 },
  { u: 650, v: 200 },
  { u: 350, v: 200 },
];
const homography = homographyFromCorners(
  corners,
  table.playingArea.widthM,
  table.playingArea.lengthM,
);
const camera = homography ? cameraFromHomography(homography, W, H) : undefined;
if (!camera) throw new Error("no camera");

const balls = reviewBalls({
  balls: [
    { kind: "cue", x: 0.6, y: 0.7, confidence: 0.9 },
    { kind: "9", x: 0.5, y: 1.6, confidence: 0.3 },
  ],
});

function props(over: Partial<PhotoReviewViewProps> = {}): PhotoReviewViewProps {
  return {
    photoUrl: "blob:test",
    widthPx: W,
    heightPx: H,
    corners,
    markers: ballMarkers(camera, balls, set),
    summary: summaryText(balls),
    messages: [],
    hasCamera: true,
    busy: false,
    runs: 0,
    canConfirm: true,
    kinds: kindChoices(set),
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

const render = (p: PhotoReviewViewProps) =>
  renderToStaticMarkup(<PhotoReviewView {...p} />).replaceAll("<!-- -->", "");

describe("PhotoReviewView", () => {
  test("is a labelled modal dialog with the four named corner handles", () => {
    const markup = render(props());
    expect(markup).toMatch(/role="dialog" aria-modal="true" aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(markup)?.[1] ?? "";
    expect(markup).toContain(`<h2 id="${id}">Check the photo</h2>`);
    for (const label of ["Baulk left", "Baulk right", "Top right", "Top left"]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    expect(markup.match(/class="photo-handle"/g)).toHaveLength(4);
    expect(markup).toContain('src="blob:test"');
  });

  test("has the four buttons and the summary", () => {
    const markup = render(props());
    for (const name of [
      "Turn the table round",
      "Find the table again",
      "Use these balls",
      "Cancel",
    ]) {
      expect(markup).toContain(`>${name}</button>`);
    }
    expect(markup).toContain("2 balls found, 1 uncertain");
  });

  test("confirming is not possible while there is a problem, and a busy screen says so", () => {
    expect(render(props({ canConfirm: false }))).toMatch(/disabled=""[^>]*>Use these balls/);
    expect(render(props({ busy: true }))).toContain("Finding the balls…");
  });

  test("each message is shown", () => {
    for (const [problem, detected, text] of [
      ["table-not-found", false, MESSAGE_NOT_FOUND],
      ["corners-invalid", false, MESSAGE_INVALID],
      [undefined, true, MESSAGE_BAULK_END],
    ] as const) {
      const markup = render(props({ messages: reviewMessages(problem, detected) }));
      expect(markup).toContain(text);
    }
    expect(render(props())).not.toContain(MESSAGE_BAULK_END);
    expect(render(props())).toContain("changes you made to balls by hand are lost");
  });

  test("uncertain balls are marked and dashed; certain ones are not", () => {
    const markup = render(props());
    expect(markup.match(/data-uncertain="true"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="9 ball, uncertain"');
    expect(markup).toContain('aria-label="cue ball"');
    expect(markup).toContain("stroke-dasharray");
    expect(markup).toContain(">?</text>");
    expect(markup.match(/>\?<\/text>/g)).toHaveLength(1);
  });

  test("the selected ball's panel lists the set's kinds and offers Remove", () => {
    const none = render(props());
    expect(none).not.toContain('aria-label="Selected ball"');
    const markup = render(props({ selectedId: 2 }));
    expect(markup).toContain('aria-label="Selected ball"');
    expect(markup).toContain("Ball kind</label>");
    const panel =
      /<div role="group" aria-label="Selected ball"[\s\S]*?<\/select>/.exec(markup)?.[0] ?? "";
    for (const k of set.kinds) expect(panel).toContain(`<option value="${k.kind}"`);
    expect(panel).toContain(">cue ball</option>");
    expect(panel).toContain(">9 ball</option>");
    expect(markup).toContain(">Remove</button>");
    expect(markup).toContain(">Add a ball</button>");
  });

  test("without a camera the balls cannot be edited", () => {
    const markup = render(props({ hasCamera: false, markers: [] }));
    expect(markup).not.toContain("Ball to add");
  });
});

describe("PhotoImportView", () => {
  test("a button, a hidden camera-or-file input and the guidance", () => {
    const markup = renderToStaticMarkup(
      <PhotoImportView
        disabled={false}
        busy={false}
        error={undefined}
        focusToken={0}
        onChoose={vi.fn()}
      />,
    );
    expect(markup).toContain(">Import from photo</button>");
    expect(markup).toMatch(
      /<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"/,
    );
    expect(markup).toContain(PHOTO_GUIDANCE);
    expect(PHOTO_GUIDANCE).toContain("The photo stays on this device.");
  });

  test("shows the busy message and errors", () => {
    const markup = renderToStaticMarkup(
      <PhotoImportView
        disabled={false}
        busy={true}
        error="This file could not be read as a picture."
        focusToken={0}
        onChoose={vi.fn()}
      />,
    );
    expect(markup).toContain("Reading the photo…");
    expect(markup).toContain('role="alert"');
  });
});
