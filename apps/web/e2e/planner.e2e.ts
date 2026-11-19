import { expect, test } from "@playwright/test";
import { docToHash } from "../src/doc/codec";
import { newDoc, resolveDoc } from "../src/doc/resolve";
import type { DiagramDoc } from "../src/doc/types";

/**
 * The planner in the editor (tasks 6.9 and 6.10): a nine-ball ending opened from a link, a route
 * found in the worker, its first shot used and played, and the ball the route meant is potted.
 */

/** A 9 ft table with the cue ball, the 8 and the 9, at shares of the playing area. */
function nineBallEnding(): DiagramDoc {
  const base = newDoc("pool-9@1");
  const resolved = resolveDoc(base);
  if (!resolved.ok) throw new Error("the 9 ft table does not resolve");
  const { widthM, lengthM } = resolved.scene.table.playingArea;
  const at = (id: "cue" | "8" | "9", fx: number, fy: number) => ({
    id,
    kind: id,
    x: widthM * fx,
    y: lengthM * fy,
  });
  return { ...base, balls: [at("cue", 0.5, 0.25), at("8", 0.4, 0.5), at("9", 0.55, 0.75)] };
}

test("find a route, use its first shot, play it: the intended ball drops", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/${await docToHash(nineBallEnding())}`);
  await expect(page.locator("[data-ball-id]")).toHaveCount(3);

  const panel = page.locator("section.planner-panel");
  await expect(panel.getByLabel("Game")).toHaveValue("nine-ball");
  await expect(panel.getByLabel("Player level")).toHaveValue("club");

  await panel.getByRole("button", { name: "Find a route" }).click();
  const route = panel.getByRole("list", { name: "Route" });
  await expect(route.getByRole("listitem").first()).toBeVisible({ timeout: 30_000 });
  // Wait for the search to end, so the route is the final one.
  await expect(panel.getByRole("button", { name: "Find a route" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator("[data-route-step]").first()).toBeAttached();

  const first = (await route.getByRole("listitem").first().textContent()) ?? "";
  const ball = /^(\d+) ball/.exec(first)?.[1];
  expect(ball, `step 1 reads "${first}"`).toBeDefined();

  await panel.getByRole("button", { name: "Use this shot" }).first().click();
  await expect(page.locator("#shot-angle")).toBeVisible();

  // The editor's own readout of the shot: the planned ball is potted.
  const potted = page.locator(".shot-panel .shot-result dt", { hasText: "Potted" }).locator("+ dd");
  await expect(potted).toContainText(`${String(ball)} ball`);

  // Play it: the route steps aside while the shot runs, and the planned ball drops.
  await page.getByRole("button", { name: /Play shot/ }).click();
  await expect(page.getByRole("button", { name: "Back to setup" })).toBeVisible();
  await expect(page.locator("[data-route-layer]")).toHaveCount(0);
  await expect(
    page.locator(`[data-mark="pocket"] title`, { hasText: `${String(ball)} ball potted` }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Back to setup" }).click();

  // Rate the shot now in the diagram: the planner's own shot pots the same ball.
  await panel.getByRole("button", { name: "Rate my shot" }).click();
  await expect(panel.locator(".planner-rating")).toContainText(`the ${String(ball)} ball in the`);

  expect(errors).toEqual([]);
});
