import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The Phase 2 acceptance flow: set up a custom table, build a coaching diagram on it, play
 * the shot, share it, and reopen the link to find the same diagram.
 */

/** What a diagram looks like on screen, for comparing two pages. */
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector("svg.table-view");
    return {
      viewBox: svg?.getAttribute("viewBox"),
      balls: [...document.querySelectorAll("[data-ball-id]")].map((b) => [
        b.getAttribute("data-kind"),
        b.getAttribute("transform"),
      ]),
      paths: [...document.querySelectorAll("[data-path] path")].map((p) => p.getAttribute("d")),
      measures: document.querySelectorAll("[data-measure]").length,
      angle: document.querySelector<HTMLInputElement>("#shot-angle")?.value,
    };
  });
}

test("custom table, diagram, play, share, reopen identical", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Metric" }).click();

  // A custom table, a little over two metres long.
  const before = await page.locator("svg.table-view").getAttribute("viewBox");
  await page.getByLabel("Table", { exact: true }).selectOption("custom");
  const length = page.getByLabel("Length", { exact: true });
  await length.fill("2.1 m");
  await length.blur();
  const width = page.getByLabel("Width", { exact: true });
  await width.fill("1.05 m");
  await width.blur();
  await expect.poll(() => page.locator("svg.table-view").getAttribute("viewBox")).not.toBe(before);

  // Balls and a shot.
  await page.getByRole("button", { name: "9-ball rack" }).click();
  await expect(page.locator("[data-ball-id]")).toHaveCount(10);
  await page.getByRole("button", { name: "Add a shot" }).first().click();
  await expect(page.getByRole("button", { name: /Play shot/ })).toBeVisible();

  // Aim by dragging on the cloth: the angle follows the pointer.
  const box = await page.locator("svg.table-view").boundingBox();
  if (!box) throw new Error("no table");
  const angleBefore = await page.locator("#shot-angle").inputValue();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.42, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#shot-angle")).not.toHaveValue(angleBefore);
  await expect(page.locator("[data-path] path").first()).toBeAttached();

  // A measuring line.
  await page.getByRole("button", { name: "Measure a distance" }).click();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("[data-measure]")).toHaveCount(1);
  await page.getByRole("button", { name: /Measuring/ }).click();

  // Play the shot: the table is still there, and the setup comes back.
  await page.getByRole("button", { name: /Play shot/ }).click();
  await expect(page.getByRole("button", { name: "Back to setup" })).toBeVisible();
  await expect(page.locator("[data-playback-ball]").first()).toBeAttached();
  await page.getByRole("button", { name: "Back to setup" }).click();
  await expect(page.locator("[data-ball-id]")).toHaveCount(10);

  // A playback does not come back with undo and redo: they return to the setup.
  await page.getByRole("button", { name: /Play shot/ }).click();
  await expect(page.getByRole("button", { name: "Back to setup" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByRole("button", { name: /Play shot/ })).toBeVisible();
  await expect(page.locator("[data-playback-ball]")).toHaveCount(0);

  // Save as SVG: a self-contained picture without the editor's controls.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^baize-.*\.svg$/);
  const svg = await readFile(await download.path(), "utf8");
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain("physics v1");
  expect(svg).toMatch(/width="2000"/);
  expect(svg).not.toMatch(/class=|tabindex=|role="slider"/);
  // Ten balls, each with its outline, and the measuring label keeps its halo.
  expect(svg.match(/data-ball-id=/g)).toHaveLength(10);
  expect(svg).toMatch(/<text[^>]*stroke-width: 3\.5/);

  // Share, and open the link in a fresh browser context.
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect.poll(() => page.url()).toContain("#v1.");
  const original = await snapshot(page);

  const context = await browser.newContext();
  const reopened = await context.newPage();
  reopened.on("pageerror", (e) => errors.push(e.message));
  await reopened.goto(page.url());
  await expect(reopened.locator("[data-ball-id]")).toHaveCount(10);
  await expect(reopened.locator("[data-measure]")).toHaveCount(1);
  expect(await snapshot(reopened)).toEqual(original);
  await context.close();

  expect(errors).toEqual([]);
});

test("the page never scrolls and the panel does", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "9-ball rack" }).click();
  const sizes = await page.evaluate(() => {
    const panel = document.querySelector(".editor-panels");
    const table = document.querySelector("svg.table-view")?.getBoundingClientRect();
    return {
      page: document.documentElement.scrollHeight,
      window: window.innerHeight,
      panelScrolls: panel ? panel.scrollHeight > panel.clientHeight : false,
      tableBottom: table?.bottom ?? 0,
      tableWidth: table?.width ?? 0,
    };
  });
  expect(sizes.page).toBe(sizes.window);
  expect(sizes.panelScrolls).toBe(true);
  expect(sizes.tableBottom).toBeLessThan(sizes.window);
  expect(sizes.tableWidth).toBeGreaterThan(300);
});
