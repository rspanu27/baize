import { describe, expect, test } from "vitest";
import { BIG_STEP_M, STEP_M, arrowTarget, dragTarget, grabOffset, isRemoveKey } from "./drag";
import { makeViewTransform } from "./transform";
import type { Orientation } from "./transform";

const table = { widthM: 1.27, lengthM: 2.54 };
const orientations: Orientation[] = ["landscape", "portrait"];

describe.each(orientations)("%s", (orientation) => {
  const view = makeViewTransform(table, orientation);
  const ball = { x: 0.6, y: 1.1 };

  test("grabbing off-centre keeps the offset, so the ball does not jump", () => {
    const grabbed = view.toScreen({ x: 0.62, y: 1.13 });
    const offset = grabOffset(view, ball, grabbed);
    const target = dragTarget(view, offset, grabbed);
    expect(target.x).toBeCloseTo(ball.x, 12);
    expect(target.y).toBeCloseTo(ball.y, 12);
  });

  test("a sequence of moves ends where the pointer went, plus the offset", () => {
    const start = view.toScreen({ x: 0.62, y: 1.13 });
    const offset = grabOffset(view, ball, start);
    const target = dragTarget(view, offset, view.toScreen({ x: 0.3, y: 0.4 }));
    expect(target.x).toBeCloseTo(0.3 - 0.02, 12);
    expect(target.y).toBeCloseTo(0.4 - 0.03, 12);
  });

  test("arrow keys move the ball in screen directions", () => {
    const screenOf = (key: string) => {
      const t = arrowTarget(view, ball, key, false);
      if (!t) throw new Error("no target");
      const a = view.toScreen(ball);
      const b = view.toScreen(t);
      return { dx: b.x - a.x, dy: b.y - a.y };
    };
    expect(screenOf("ArrowRight").dx).toBeCloseTo(STEP_M, 12);
    expect(screenOf("ArrowRight").dy).toBeCloseTo(0, 12);
    expect(screenOf("ArrowLeft").dx).toBeCloseTo(-STEP_M, 12);
    expect(screenOf("ArrowDown").dy).toBeCloseTo(STEP_M, 12);
    expect(screenOf("ArrowUp").dy).toBeCloseTo(-STEP_M, 12);
  });

  test("shift makes the step 10 mm", () => {
    const t = arrowTarget(view, ball, "ArrowRight", true);
    expect(t).toBeDefined();
    expect(Math.hypot((t?.x ?? 0) - ball.x, (t?.y ?? 0) - ball.y)).toBeCloseTo(BIG_STEP_M, 12);
  });
});

test("arrow keys map to the right table directions", () => {
  const ball = { x: 0.6, y: 1.1 };
  // Landscape: screen right is along the table length (+y), screen down is +x.
  const landscape = makeViewTransform(table, "landscape");
  expect(arrowTarget(landscape, ball, "ArrowRight", false)?.y).toBeCloseTo(1.101, 12);
  expect(arrowTarget(landscape, ball, "ArrowDown", false)?.x).toBeCloseTo(0.601, 12);
  // Portrait: screen right is +x, screen up is +y (the head end is at the bottom).
  const portrait = makeViewTransform(table, "portrait");
  expect(arrowTarget(portrait, ball, "ArrowRight", false)?.x).toBeCloseTo(0.601, 12);
  expect(arrowTarget(portrait, ball, "ArrowUp", false)?.y).toBeCloseTo(1.101, 12);
});

test("other keys do nothing; delete and backspace remove", () => {
  const view = makeViewTransform(table, "landscape");
  expect(arrowTarget(view, { x: 0, y: 0 }, "a", false)).toBeUndefined();
  expect(isRemoveKey("Delete")).toBe(true);
  expect(isRemoveKey("Backspace")).toBe(true);
  expect(isRemoveKey("a")).toBe(false);
});
