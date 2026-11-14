import { getBallSet, getTablePreset } from "@baize/tables";
import { beforeEach, describe, expect, test } from "vitest";
import { newDoc } from "../doc/resolve";
import { DEFAULT_TABLE_PRESET, useEditor } from "../store/store";
import { confirmedLayout, reviewBalls } from "./reviewModel";

describe("confirming a photo import", () => {
  const table = getTablePreset(DEFAULT_TABLE_PRESET);
  const set = table ? getBallSet(table.defaultBallSetId) : undefined;
  if (!table || !set) throw new Error("missing preset");
  const doc = () => useEditor.getState().history.present;

  beforeEach(() => {
    useEditor.getState().openDoc(newDoc(DEFAULT_TABLE_PRESET));
  });

  test("the balls are loaded as one undo step, marked as from a photo, with their confidences", () => {
    const reviewed = reviewBalls({
      balls: [
        { kind: "cue", x: 0.6, y: 0.7, confidence: 0.9 },
        { kind: "1", x: 0.5, y: 1.6, confidence: 0.3 },
        { kind: "2", x: 0.8, y: 1.2 },
      ],
    });
    useEditor
      .getState()
      .loadLayout(confirmedLayout(reviewed, table, set), { source: "photo", mode: "replace" });

    expect(doc().balls).toHaveLength(3);
    expect(doc().source).toEqual({ kind: "photo" });
    expect(doc().balls.map((b) => b.confidence)).toEqual([0.9, 0.3, 1]);
    expect(useEditor.getState().history.past).toHaveLength(1);
    useEditor.getState().undo();
    expect(doc().balls).toHaveLength(0);
  });

  test("the document holds nothing of the photo", () => {
    useEditor
      .getState()
      .loadLayout(
        confirmedLayout(
          reviewBalls({ balls: [{ kind: "cue", x: 0.6, y: 0.7, confidence: 0.5 }] }),
          table,
          set,
        ),
        { source: "photo", mode: "replace" },
      );
    const text = JSON.stringify(useEditor.getState().history);
    for (const forbidden of ['"data"', "widthPx", "heightPx", "blob:", "data:"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
