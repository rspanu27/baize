import { getBallSet, getTablePreset } from "@baize/tables";
import type { TableCorners } from "@baize/vision";
import { describe, expect, test } from "vitest";
import { fitWithin } from "./decode";
import {
  MESSAGE_RUN_FAILED,
  reviewStatus,
  MESSAGE_BAULK_END,
  MESSAGE_INVALID,
  MESSAGE_NOT_FOUND,
  addReviewBall,
  arrowStep,
  ballMarkers,
  confirmedLayout,
  defaultCorners,
  kindChoices,
  moveCorner,
  nudgeCorner,
  paddedArea,
  removeReviewBall,
  reviewBalls,
  reviewMessages,
  setBallKind,
  summaryText,
  turnCorners,
} from "./reviewModel";

const table = getTablePreset("pool-9@1");
const set = table ? getBallSet(table.defaultBallSetId) : undefined;
if (!table || !set) throw new Error("missing preset");

const corners: TableCorners = [
  { u: 1, v: 2 },
  { u: 3, v: 4 },
  { u: 5, v: 6 },
  { u: 7, v: 8 },
];

describe("corners", () => {
  test("default corners are inset 20 % from the photo's edges, baulk end at the bottom", () => {
    const c = defaultCorners(1000, 500);
    expect(c[0]).toEqual({ u: 200, v: 400 });
    expect(c[1]).toEqual({ u: 800, v: 400 });
    expect(c[2]).toEqual({ u: 800, v: 100 });
    expect(c[3]).toEqual({ u: 200, v: 100 });
  });

  test("turning the table round gives [c, d, a, b], and twice gives the original", () => {
    const [a, b, c, d] = corners;
    expect(turnCorners(corners)).toEqual([c, d, a, b]);
    expect(turnCorners(turnCorners(corners))).toEqual(corners);
  });

  test("a corner can move outside the photo but is clamped to the padded area", () => {
    const area = paddedArea(1000, 500);
    expect(area).toEqual({ x: -120, y: -60, w: 1240, h: 620 });
    const out = moveCorner(corners, 1, { u: -50, v: 510 }, 1000, 500);
    expect(out[1]).toEqual({ u: -50, v: 510 });
    const far = moveCorner(corners, 2, { u: 5000, v: -5000 }, 1000, 500);
    expect(far[2]).toEqual({ u: 1120, v: -60 });
    // The others stay as they were, and the input is not changed.
    expect(far[0]).toEqual(corners[0]);
    expect(corners[2]).toEqual({ u: 5, v: 6 });
  });

  test("arrow keys step by 1 px, or 10 px with Shift, and nudging clamps", () => {
    expect(arrowStep("ArrowLeft", false)).toEqual({ du: -1, dv: 0 });
    expect(arrowStep("ArrowDown", true)).toEqual({ du: 0, dv: 10 });
    expect(arrowStep("a", false)).toBeUndefined();
    expect(nudgeCorner(corners, 0, 10, -1, 100, 100)[0]).toEqual({ u: 11, v: 1 });
    expect(nudgeCorner(corners, 0, -1000, 0, 100, 100)[0]?.u).toBe(-12);
  });
});

describe("summary and messages", () => {
  test("counts balls and uncertain balls", () => {
    const balls = reviewBalls({
      balls: [
        { kind: "cue", x: 0.5, y: 0.5, confidence: 0.9 },
        { kind: "1", x: 0.6, y: 0.9, confidence: 0.59 },
        { kind: "2", x: 0.3, y: 1.2 },
      ],
    });
    expect(summaryText(balls)).toBe("3 balls found, 1 uncertain");
    expect(summaryText(balls.slice(0, 1))).toBe("1 ball found, 0 uncertain");
    expect(summaryText([])).toBe("0 balls found, 0 uncertain");
    // A ball without a confidence is certain.
    expect(balls[2]?.confidence).toBe(1);
  });

  test("messages follow the problem, and the baulk end is explained for a detected table", () => {
    expect(reviewMessages("table-not-found", false)).toEqual([MESSAGE_NOT_FOUND]);
    expect(reviewMessages("corners-invalid", false)).toEqual([MESSAGE_INVALID]);
    expect(reviewMessages(undefined, true)).toEqual([MESSAGE_BAULK_END]);
    expect(reviewMessages(undefined, false)).toEqual([]);
  });
});

describe("editing balls", () => {
  const start = reviewBalls({ balls: [{ kind: "1", x: 0.5, y: 0.5, confidence: 0.3 }] });

  test("changing the kind makes the ball certain; removing and adding work on a copy", () => {
    const changed = setBallKind(start, 1, "2");
    expect(changed[0]).toMatchObject({ kind: "2", confidence: 1 });
    expect(start[0]).toMatchObject({ kind: "1", confidence: 0.3 });

    const added = addReviewBall(start, "cue", { x: 0.2, y: 0.4 });
    expect(added.balls).toHaveLength(2);
    expect(added.balls[1]).toEqual({ id: added.id, kind: "cue", x: 0.2, y: 0.4, confidence: 1 });
    expect(added.id).not.toBe(1);
    expect(removeReviewBall(added.balls, 1).map((b) => b.id)).toEqual([added.id]);
  });

  test("the kinds offered are the set's, with names", () => {
    const choices = kindChoices(set);
    expect(choices.map((c) => c.kind)).toEqual(set.kinds.map((k) => k.kind));
    expect(choices.find((c) => c.kind === "cue")?.name).toBe("cue ball");
  });

  test("the confirmed layout keeps confidences and drops what cannot be placed", () => {
    const balls = reviewBalls({
      balls: [
        { kind: "cue", x: 0.5, y: 0.5, confidence: 0.4 },
        { kind: "5", x: 0.6, y: 0.9 },
      ],
    });
    const layout = confirmedLayout(balls, table, set);
    expect(layout.balls.map((b) => [b.kind, b.confidence])).toEqual([
      ["cue", 0.4],
      ["5", 1],
    ]);
    const two = confirmedLayout(
      [...balls, { id: 9, kind: "cue", x: 0.1, y: 0.1, confidence: 1 }],
      table,
      set,
    );
    expect(two.balls.filter((b) => b.kind === "cue")).toHaveLength(1);
  });

  test("markers are placed with no camera: none", () => {
    expect(ballMarkers(undefined, start, set)).toEqual([]);
  });
});

describe("decode sizing", () => {
  test("the longer side is capped at 4000 px, keeping the proportions", () => {
    expect(fitWithin(8000, 6000)).toEqual({ width: 4000, height: 3000 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 2000, height: 4000 });
    expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900 });
  });
});

describe("review status", () => {
  test("after a failed run the balls cannot be used, and the screen says why", () => {
    const failed = reviewStatus({
      failed: true,
      problem: undefined,
      hasCamera: true,
      cornersDetected: true,
    });
    expect(failed).toEqual({ messages: [MESSAGE_RUN_FAILED], canConfirm: false });
  });

  test("otherwise the balls can be used when there is a camera and no problem", () => {
    const ok = { failed: false, problem: undefined, hasCamera: true, cornersDetected: false };
    expect(reviewStatus(ok)).toEqual({ messages: [], canConfirm: true });
    expect(reviewStatus({ ...ok, hasCamera: false }).canConfirm).toBe(false);
    expect(reviewStatus({ ...ok, problem: "corners-invalid" }).canConfirm).toBe(false);
    expect(reviewStatus({ ...ok, cornersDetected: true }).messages).toEqual([MESSAGE_BAULK_END]);
  });
});
