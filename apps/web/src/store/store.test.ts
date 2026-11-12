import { getBallSet, getTablePreset, rackLayout } from "@baize/tables";
import { beforeEach, describe, expect, test } from "vitest";
import { newDoc } from "../doc/resolve";
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  commit,
  createHistory,
  endGesture,
  live,
  redo,
  undo,
} from "./history";
import { DEFAULT_TABLE_PRESET, useEditor } from "./store";

describe("history", () => {
  test("commit, undo and redo walk the steps; a new commit clears redo", () => {
    let h = createHistory("a");
    h = commit(h, "b");
    h = commit(h, "c");
    expect([h.past, h.present, h.future]).toEqual([["a", "b"], "c", []]);
    h = undo(h);
    expect([h.present, canUndo(h), canRedo(h)]).toEqual(["b", true, true]);
    h = redo(h);
    expect(h.present).toBe("c");
    h = undo(undo(h));
    expect([h.present, canUndo(h)]).toEqual(["a", false]);
    expect(undo(h)).toBe(h);
    h = commit(h, "z");
    expect([h.present, canRedo(h)]).toEqual(["z", false]);
    expect(redo(h)).toBe(h);
  });

  test("a whole live gesture is one undo step", () => {
    let h = createHistory(0);
    h = commit(h, 1);
    for (const v of [2, 3, 4, 5]) h = live(h, v);
    expect(h.gesture).toBe(true);
    h = endGesture(h);
    expect([h.past, h.present]).toEqual([[0, 1], 5]);
    expect(undo(h).present).toBe(1);
    // The next gesture is its own step.
    h = live(live(h, 6), 7);
    h = endGesture(h);
    expect(undo(h).present).toBe(5);
  });

  test("setting the same value adds no step, and the history is capped", () => {
    const h = createHistory("a");
    expect(commit(h, "a")).toBe(h);
    expect(live(h, "a")).toBe(h);
    let long = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) long = commit(long, i);
    expect(long.past).toHaveLength(HISTORY_LIMIT);
    expect(long.present).toBe(HISTORY_LIMIT + 50);
  });
});

describe("editor store", () => {
  const table = getTablePreset(DEFAULT_TABLE_PRESET);
  const set = table ? getBallSet(table.defaultBallSetId) : undefined;
  if (!table || !set) throw new Error("missing preset");
  const rack = rackLayout(table, set, "pool-9ball");
  const doc = () => useEditor.getState().history.present;

  beforeEach(() => {
    useEditor.getState().openDoc(newDoc(DEFAULT_TABLE_PRESET));
  });

  test("loadLayout is one undoable step", () => {
    useEditor.getState().loadLayout(rack, { source: "rack", mode: "replace" });
    expect(doc().balls).toHaveLength(10);
    expect(useEditor.getState().history.past).toHaveLength(1);
    useEditor.getState().undo();
    expect(doc().balls).toHaveLength(0);
    useEditor.getState().redo();
    expect(doc().balls).toHaveLength(10);
  });

  test("dragging a ball is one undo step, however many moves it takes", () => {
    const s = useEditor.getState();
    s.loadLayout(rack, { source: "rack", mode: "replace" });
    const start = { ...doc().balls[0] };
    for (let i = 1; i <= 20; i++) {
      useEditor.getState().placeBall("b1", { x: 0.4 + i * 0.005, y: 0.5 }, "live");
    }
    useEditor.getState().endGesture();
    expect(doc().balls[0]?.x).toBeCloseTo(0.5, 12);
    expect(useEditor.getState().history.past).toHaveLength(2);
    useEditor.getState().undo();
    expect(doc().balls[0]).toEqual(start);
  });

  test("aiming live and then changing speed are two separate steps", () => {
    const s = useEditor.getState();
    s.loadLayout(rack, { source: "rack", mode: "replace" });
    for (const a of [1, 1.1, 1.2]) useEditor.getState().setShot({ aimAngleRad: a }, "live");
    useEditor.getState().endGesture();
    useEditor.getState().setShot({ speedMps: 5 });
    expect(doc().shot).toMatchObject({ aimAngleRad: 1.2, speedMps: 5 });
    useEditor.getState().undo();
    expect(doc().shot).toMatchObject({ aimAngleRad: 1.2, speedMps: 2 });
    useEditor.getState().undo();
    expect(doc().shot).toBeUndefined();
  });

  test("an operation that changes nothing adds no undo step", () => {
    const before = useEditor.getState().history;
    useEditor.getState().removeBall("nope");
    useEditor.getState().addBall("red", { x: 0.5, y: 0.5 });
    expect(useEditor.getState().history).toBe(before);
  });

  test("the selection follows the document: removing or undoing away a ball deselects it", () => {
    const s = useEditor.getState();
    s.addBall("cue", { x: 0.5, y: 0.5 });
    s.select("b1");
    expect(useEditor.getState().selectedBallId).toBe("b1");
    useEditor.getState().undo();
    expect(useEditor.getState().selectedBallId).toBeUndefined();
    useEditor.getState().redo();
    useEditor.getState().select("b1");
    useEditor.getState().removeBall("b1");
    expect(useEditor.getState().selectedBallId).toBeUndefined();
  });

  test("openDoc replaces the document and clears the history", () => {
    const s = useEditor.getState();
    s.loadLayout(rack, { source: "rack", mode: "replace" });
    useEditor.getState().openDoc(newDoc("snooker-12@1"));
    expect(doc().table).toEqual({ preset: "snooker-12@1" });
    expect(useEditor.getState().history.past).toHaveLength(0);
  });
});
