import { beforeEach, describe, expect, test } from "vitest";
import { newDoc } from "../doc/resolve";
import { DEFAULT_TABLE_PRESET, useEditor } from "./store";

const state = () => useEditor.getState();

describe("setStyle", () => {
  beforeEach(() => {
    state().openDoc(newDoc(DEFAULT_TABLE_PRESET));
  });

  test("typing a caption in live changes, then ending the gesture, is one undo step", () => {
    for (const text of ["B", "Br", "Bre", "Brea", "Break"]) {
      state().setStyle({ caption: text }, "live");
    }
    state().endGesture();
    expect(state().history.present.style?.caption).toBe("Break");
    state().undo();
    expect(state().history.present.style).toBeUndefined();
    state().redo();
    expect(state().history.present.style?.caption).toBe("Break");
  });

  test("a change made without a mode is its own step", () => {
    state().setStyle({ theme: "print" });
    state().setStyle({ pathLine: "dashed" });
    state().undo();
    expect(state().history.present.style).toEqual({ theme: "print" });
    state().undo();
    expect(state().history.present.style).toBeUndefined();
  });

  test("a second caption edit after blur is a new step", () => {
    state().setStyle({ caption: "One" }, "live");
    state().endGesture();
    state().setStyle({ caption: "One two" }, "live");
    state().endGesture();
    state().undo();
    expect(state().history.present.style?.caption).toBe("One");
  });
});
