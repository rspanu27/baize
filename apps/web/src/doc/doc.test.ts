import { simulate } from "@baize/physics";
import { getBallSet, getTablePreset, pocketDropCircles, rackLayout } from "@baize/tables";
import { describe, expect, test } from "vitest";
import {
  addBall,
  clearShot,
  loadLayout,
  nextBallId,
  placeBall,
  removeBall,
  setBallSet,
  setShot,
  setStyle,
  setTable,
} from "./ops";
import { newDoc, resolveBallSet, resolveDoc } from "./resolve";
import type { Scene } from "./resolve";
import type { DiagramDoc } from "./types";

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function scene(doc: DiagramDoc): Scene {
  const r = resolveDoc(doc);
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

const pool9 = must(getTablePreset("pool-9@1"), "pool-9");
const poolSet = must(getBallSet("pool-57@1"), "pool set");
const W = pool9.playingArea.widthM;
const L = pool9.playingArea.lengthM;

function racked(): DiagramDoc {
  return loadLayout(newDoc("pool-9@1"), rackLayout(pool9, poolSet, "pool-9ball"), {
    source: "rack",
    mode: "replace",
  });
}

describe("newDoc and resolveDoc", () => {
  test("a new document is empty, versioned, and resolves to its preset", () => {
    const doc = newDoc("pool-9@1");
    expect(doc).toMatchObject({
      schemaVersion: 2,
      table: { preset: "pool-9@1" },
      ballSet: { preset: "pool-57@1" },
      balls: [],
      annotations: [],
    });
    const s = scene(doc);
    expect(s.table.id).toBe("pool-9@1");
    expect(s.ballSet.id).toBe("pool-57@1");
    expect(s.cloth.speedPreset).toBe("medium");
    // The document is plain data: it survives a JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  test("unknown presets and impossible custom tables are reported in plain words", () => {
    const badTable = resolveDoc({ ...newDoc("pool-9@1"), table: { preset: "nope@1" } });
    expect(badTable.ok).toBe(false);
    const badSet = resolveDoc({ ...newDoc("pool-9@1"), ballSet: { preset: "nope@1" } });
    expect(badSet.ok).toBe(false);
    const badCustom = resolveDoc({
      ...newDoc("pool-9@1"),
      table: {
        custom: { game: "pool", lengthM: 1, widthM: 2, cornerMouthM: 0.11, middleMouthM: 0.12 },
      },
    });
    expect(badCustom.ok).toBe(false);
    if (!badCustom.ok) expect(badCustom.problems.join(" ")).toMatch(/longer than its width/);
  });

  test("a custom table resolves with the ball size of the document's ball set", () => {
    const doc: DiagramDoc = {
      ...newDoc("pool-9@1"),
      table: {
        custom: {
          game: "pool",
          lengthM: 2.2,
          widthM: 1.1,
          cornerMouthM: 0.115,
          middleMouthM: 0.125,
        },
      },
    };
    const s = scene(doc);
    expect(s.table.id).toBe("custom");
    expect(s.table.cushion.noseHeightM).toBeCloseTo(0.635 * poolSet.object.diameterM, 12);
  });

  test("ball size overrides scale the mass with volume and keep the cue ball ratio", () => {
    const bigger = must(resolveBallSet({ preset: "pool-57@1", diameterM: 0.06 }), "set");
    expect(bigger.object.diameterM).toBe(0.06);
    expect(bigger.object.massKg).toBeCloseTo(
      poolSet.object.massKg * (0.06 / poolSet.object.diameterM) ** 3,
      12,
    );
    const blackball = must(getBallSet("blackball-51@1"), "blackball");
    const scaled = must(resolveBallSet({ preset: "blackball-51@1", diameterM: 0.0524 }), "set");
    const ratio = must(blackball.cue, "cue").diameterM / blackball.object.diameterM;
    expect(must(scaled.cue, "cue").diameterM).toBeCloseTo(0.0524 * ratio, 12);
    expect(resolveBallSet({ preset: "pool-57@1" })).toBe(poolSet);
  });
});

describe("loadLayout", () => {
  test("a rack arrives as balls with fresh ids, sizes resolve, and the engine accepts it", () => {
    const doc = racked();
    expect(doc.balls).toHaveLength(10);
    expect(doc.balls.map((b) => b.id)).toEqual([
      "b1",
      "b2",
      "b3",
      "b4",
      "b5",
      "b6",
      "b7",
      "b8",
      "b9",
      "b10",
    ]);
    expect(doc.balls[0]?.kind).toBe("cue");
    const s = scene(doc);
    expect(() =>
      simulate({
        table: s.table,
        cloth: s.cloth,
        balls: s.balls,
        ballRestitution: s.ballSet.restitution,
      }),
    ).not.toThrow();
  });

  test("merge adds to the table, replace swaps; photo layouts keep confidence and mark the source", () => {
    const one = loadLayout(
      newDoc("pool-9@1"),
      { balls: [{ kind: "cue", x: 0.5, y: 0.5 }] },
      {
        source: "manual",
        mode: "replace",
      },
    );
    const merged = loadLayout(
      one,
      { balls: [{ kind: "3", x: 0.8, y: 1.5, confidence: 0.4 }] },
      {
        source: "photo",
        mode: "merge",
      },
    );
    expect(merged.balls.map((b) => b.kind)).toEqual(["cue", "3"]);
    expect(merged.balls[1]?.confidence).toBe(0.4);
    expect(merged.source).toEqual({ kind: "photo" });
    const replaced = loadLayout(
      merged,
      { balls: [{ kind: "8", x: 0.6, y: 1 }] },
      {
        source: "rack",
        mode: "replace",
      },
    );
    expect(replaced.balls.map((b) => b.kind)).toEqual(["8"]);
    expect(replaced.source).toEqual({ kind: "manual" });
  });

  test("a bad layout is cleaned: overlaps separated, off-table balls brought in, extras dropped", () => {
    const doc = loadLayout(
      newDoc("pool-9@1"),
      {
        balls: [
          { kind: "1", x: 0.6, y: 1 },
          { kind: "2", x: 0.61, y: 1 },
          { kind: "3", x: -4, y: 9 },
          { kind: "1", x: 0.9, y: 2, confidence: 0.2 },
          { kind: "red", x: 0.3, y: 0.3 },
        ],
      },
      { source: "photo", mode: "replace" },
    );
    expect(doc.balls.map((b) => b.kind)).toEqual(["1", "2", "3"]);
    const [a, b, c] = doc.balls;
    expect(
      Math.hypot(must(a, "a").x - must(b, "b").x, must(a, "a").y - must(b, "b").y),
    ).toBeGreaterThanOrEqual(poolSet.object.diameterM - 1e-9);
    expect(must(c, "c").x).toBeGreaterThan(0);
    expect(must(c, "c").y).toBeLessThan(L);
  });

  test("the shot settings survive a re-rack and point at the new cue ball", () => {
    const first = setShot(racked(), { aimAngleRad: 1.234, speedMps: 4 });
    const again = loadLayout(first, rackLayout(pool9, poolSet, "pool-8ball"), {
      source: "rack",
      mode: "replace",
    });
    expect(again.shot?.aimAngleRad).toBe(1.234);
    expect(again.shot?.cueBallId).toBe(again.balls.find((b) => b.kind === "cue")?.id);
  });
});

describe("placing, adding and removing balls", () => {
  test("placeBall moves only that ball, clears its confidence, and never overlaps or leaves the table", () => {
    const base = loadLayout(
      newDoc("pool-9@1"),
      {
        balls: [
          { kind: "cue", x: 0.5, y: 0.5 },
          { kind: "4", x: 0.8, y: 1.5, confidence: 0.3 },
        ],
      },
      { source: "photo", mode: "replace" },
    );
    const moved = placeBall(base, "b2", { x: 0.7, y: 1.2 });
    expect(moved.balls[1]).toEqual({ id: "b2", kind: "4", x: 0.7, y: 1.2 });
    expect(moved.balls[0]).toBe(base.balls[0]);

    const onTop = placeBall(base, "b2", { x: 0.5, y: 0.5 });
    expect(onTop.balls[0]).toMatchObject({ x: 0.5, y: 0.5 });
    const b2 = must(onTop.balls[1], "b2");
    expect(Math.hypot(b2.x - 0.5, b2.y - 0.5)).toBeGreaterThanOrEqual(
      poolSet.object.diameterM - 1e-9,
    );

    const off = placeBall(base, "b2", { x: 99, y: -99 });
    expect(off.balls[1]?.x).toBeLessThan(W);
    expect(off.balls[1]?.y).toBeGreaterThan(0);
    const circles = pocketDropCircles(pool9);
    for (const c of circles) {
      const p = must(off.balls[1], "ball");
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeGreaterThanOrEqual(c.radiusM);
    }

    expect(placeBall(base, "nope", { x: 1, y: 1 })).toBe(base);
    expect(placeBall(base, "b2", { x: Number.NaN, y: 1 })).toBe(base);
  });

  test("addBall respects how many of a kind the set has", () => {
    let doc = addBall(newDoc("pool-9@1"), "cue", { x: 0.5, y: 0.5 });
    expect(doc.balls).toHaveLength(1);
    const second = addBall(doc, "cue", { x: 0.9, y: 0.9 });
    expect(second).toBe(doc);
    doc = addBall(doc, "7", { x: 0.5, y: 0.5 });
    expect(doc.balls.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(addBall(doc, "red", { x: 1, y: 1 })).toBe(doc);
  });

  test("removing the cue ball removes the shot; removing another ball does not", () => {
    const doc = setShot(racked(), { speedMps: 3 });
    expect(doc.shot).toBeDefined();
    expect(removeBall(doc, "b5").shot).toBeDefined();
    expect(removeBall(doc, "b5").balls).toHaveLength(9);
    expect(removeBall(doc, "b1").shot).toBeUndefined();
    expect(removeBall(doc, "nope")).toBe(doc);
  });

  test("nextBallId never reuses an id, whatever was removed", () => {
    expect(nextBallId([])).toBe("b1");
    const doc = removeBall(racked(), "b3");
    expect(nextBallId(doc.balls)).toBe("b11");
  });
});

describe("setShot", () => {
  test("needs a cue ball, keeps any angle exactly, and holds the tip inside the miscue limit", () => {
    expect(setShot(newDoc("pool-9@1"), { speedMps: 2 }).shot).toBeUndefined();
    const doc = setShot(racked(), { aimAngleRad: 0.123456789012345 });
    expect(doc.shot).toMatchObject({
      cueBallId: "b1",
      aimAngleRad: 0.123456789012345,
      speedMps: 2,
    });
    const tip = setShot(doc, { tipOffset: { side: 0.6, vertical: 0.8 } }).shot?.tipOffset;
    expect(Math.hypot(must(tip, "tip").side, must(tip, "tip").vertical)).toBeCloseTo(0.5, 12);
    expect(must(tip, "tip").side / must(tip, "tip").vertical).toBeCloseTo(0.75, 12);
    expect(setShot(doc, { speedMps: 0 })).toBe(doc);
    expect(setShot(doc, { aimAngleRad: Number.NaN })).toBe(doc);
    expect(clearShot(doc).shot).toBeUndefined();
  });
});

describe("setTable and setBallSet", () => {
  test("changing table scales the layout with the playing area and keeps it legal", () => {
    const doc = racked();
    const smaller = setTable(doc, { preset: "pool-7@1" });
    const t7 = must(getTablePreset("pool-7@1"), "pool-7");
    expect(smaller.table).toEqual({ preset: "pool-7@1" });
    expect(smaller.balls).toHaveLength(10);
    // The cue ball is still on the head spot of the new table.
    expect(smaller.balls[0]?.x).toBeCloseTo(t7.playingArea.widthM / 2, 9);
    expect(smaller.balls[0]?.y).toBeCloseTo(t7.playingArea.lengthM / 4, 9);
    const s = scene(smaller);
    expect(() =>
      simulate({
        table: s.table,
        cloth: s.cloth,
        balls: s.balls,
        ballRestitution: s.ballSet.restitution,
      }),
    ).not.toThrow();
  });

  test("moving to another game drops balls that game does not have", () => {
    const doc = racked();
    const snooker = setTable(doc, { preset: "snooker-12@1" }, { preset: "snooker-52@1" });
    expect(snooker.balls.map((b) => b.kind)).toEqual(["cue"]);
    expect(setTable(doc, { preset: "nope@1" })).toBe(doc);
    expect(setBallSet(doc, { preset: "nope@1" })).toBe(doc);
  });
});

describe("setStyle (schema version 2 fields)", () => {
  test("defaults are left out, so a default style leaves no style at all", () => {
    const doc = newDoc("pool-9@1");
    const styled = setStyle(doc, { theme: "print", pathLine: "dashed", ballLabels: false });
    expect(styled.style).toEqual({ theme: "print", pathLine: "dashed", ballLabels: false });
    const back = setStyle(styled, {
      theme: "table",
      pathLine: "solid",
      pathWeight: "normal",
      ballLabels: true,
    });
    expect("style" in back).toBe(false);
  });

  test("a caption is kept to one clean line of limited length", () => {
    const doc = newDoc("pool-9@1");
    expect(setStyle(doc, { caption: "  Stop
 shot	 drill" }).style?.caption).toBe(
      "Stop shot drill",
    );
    expect(setStyle(doc, { caption: "x".repeat(500) }).style?.caption).toHaveLength(140);
    const cleared = setStyle(setStyle(doc, { caption: "A" }), { caption: "   " });
    expect("style" in cleared).toBe(false);
    // A trailing space is kept while typing, so words can be separated.
    expect(setStyle(doc, { caption: "Stop " }).style?.caption).toBe("Stop ");
  });
});

