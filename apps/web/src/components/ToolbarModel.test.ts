import { describe, expect, test } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import {
  RACK_LABELS,
  drillEntries,
  historyShortcut,
  isTypingTarget,
  paletteEntries,
  rackEntries,
  tableCentre,
} from "./ToolbarModel";

function sceneFor(id: string, balls: { kind: string; n: number }[] = []): Scene {
  const doc = newDoc(id);
  let i = 0;
  const withBalls = {
    ...doc,
    balls: balls.flatMap(({ kind, n }) =>
      Array.from({ length: n }, () => {
        i += 1;
        return { id: `b${String(i)}`, kind: kind as never, x: 0.05 * i, y: 0.05 * i };
      }),
    ),
  };
  const r = resolveDoc(withBalls);
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

describe("palette", () => {
  test("pool has the cue ball and 15 numbered balls, all available", () => {
    const entries = paletteEntries(sceneFor("pool-9@1"));
    const numbers = Array.from({ length: 15 }, (_, i) => String(i + 1));
    expect(entries.map((e) => e.kind)).toEqual(["cue", ...numbers]);
    expect(entries.every((e) => e.remaining === 1)).toBe(true);
  });

  test("a kind at its limit has none remaining", () => {
    const entries = paletteEntries(sceneFor("pool-9@1", [{ kind: "cue", n: 1 }]));
    expect(entries.find((e) => e.kind === "cue")?.remaining).toBe(0);
    expect(entries.find((e) => e.kind === "9")?.remaining).toBe(1);
  });

  test("snooker counts reds", () => {
    const entries = paletteEntries(sceneFor("snooker-12@1", [{ kind: "red", n: 15 }]));
    expect(entries.find((e) => e.kind === "red")?.remaining).toBe(0);
    expect(entries.find((e) => e.kind === "black")?.remaining).toBe(1);
    expect(entries.find((e) => e.kind === "red")?.name).toBe("red ball");
  });
});

describe("racks", () => {
  test("pool offers pool racks with readable labels", () => {
    const entries = rackEntries(sceneFor("pool-9@1"));
    expect(entries.map((e) => e.label)).toEqual(["8-ball rack", "9-ball rack", "15-ball rack"]);
    expect(entries.every((e) => e.fits && e.reason === undefined)).toBe(true);
  });

  test("snooker and blackball", () => {
    expect(rackEntries(sceneFor("snooker-12@1")).map((e) => e.label)).toEqual([
      "Full snooker rack",
      "10 reds",
      "6 reds",
    ]);
    expect(rackEntries(sceneFor("blackball-7@1")).map((e) => e.label)).toEqual(["Blackball rack"]);
  });

  test("every rack has a label", () => {
    expect(Object.keys(RACK_LABELS)).toHaveLength(7);
  });
});

test("the centre of the table", () => {
  const scene = sceneFor("pool-9@1");
  const { widthM, lengthM } = scene.table.playingArea;
  expect(tableCentre(scene)).toEqual({ x: widthM / 2, y: lengthM / 2 });
});

describe("shortcuts", () => {
  const e = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey", boolean>>) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });

  test("undo and redo", () => {
    expect(historyShortcut(e("z", { ctrlKey: true }))).toBe("undo");
    expect(historyShortcut(e("z", { metaKey: true }))).toBe("undo");
    expect(historyShortcut(e("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyShortcut(e("z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(historyShortcut(e("y", { ctrlKey: true }))).toBe("redo");
  });

  test("plain keys and other combinations are ignored", () => {
    expect(historyShortcut(e("z", {}))).toBeUndefined();
    expect(historyShortcut(e("y", { metaKey: true }))).toBeUndefined();
    expect(historyShortcut(e("a", { ctrlKey: true }))).toBeUndefined();
  });

  test("typing targets", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("drillEntries", () => {
  test("every preset table offers the drills of its game, each with a description", () => {
    const pool = drillEntries(sceneFor("pool-9@1"));
    expect(pool.map((d) => d.id)).toEqual([
      "pool-stop-shot-ladder",
      "pool-l-drill",
      "pool-wagon-wheel",
      "pool-line-across",
    ]);
    for (const d of pool) expect(d.description.length).toBeGreaterThan(20);
    expect(drillEntries(sceneFor("snooker-12@1")).map((d) => d.id)).toContain("snooker-line-up");
  });

  test("a drill that does not fit is not offered", () => {
    // A 9-ball set has no balls numbered above 9; every pool drill here uses at most 7.
    const scene = sceneFor("pool-9@1");
    const few = {
      ...scene,
      ballSet: { ...scene.ballSet, kinds: scene.ballSet.kinds.filter((k) => k.kind === "cue") },
    };
    expect(drillEntries(few)).toEqual([]);
  });
});
