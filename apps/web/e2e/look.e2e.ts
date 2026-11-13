import { expect, test } from "@playwright/test";

/** The Look panel: theme, labels and caption change the drawing, and a caption is one undo step. */
test("look panel changes the diagram", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByRole("button", { name: "9-ball rack" }).click();
  await expect(page.locator("[data-ball-id]")).toHaveCount(10);
  const svg = page.locator("svg.table-view");
  const before = await svg.getAttribute("viewBox");

  await page.getByLabel("Theme").selectOption("print");
  await expect(svg).toHaveAttribute("data-theme", "print");
  await expect(svg.locator("[data-sheet]")).toBeAttached();

  await page.getByLabel("Numbers on balls").uncheck();
  await expect(svg.locator("[data-ball-id] text")).toHaveCount(0);

  const caption = page.getByLabel("Caption");
  await caption.fill("Break shot");
  await expect(svg.locator("[data-caption] text")).toHaveText("Break shot");
  expect(await svg.getAttribute("viewBox")).not.toBe(before);
  await caption.blur();

  // One undo removes the whole caption.
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(svg.locator("[data-caption]")).toHaveCount(0);
  expect(await svg.getAttribute("viewBox")).toBe(before);

  expect(errors).toEqual([]);
});
