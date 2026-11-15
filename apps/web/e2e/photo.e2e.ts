import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * A synthetic photo made inside the page: grey floor, brown rail, a green cloth seen in
 * perspective with all four corners well inside the picture, and four coloured discs on it.
 */
async function syntheticPhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const w = 1200;
    const h = 800;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#77736d";
    ctx.fillRect(0, 0, w, h);
    const quad = (pts: number[][], colour: string) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x as number, y as number);
        else ctx.lineTo(x as number, y as number);
      });
      ctx.closePath();
      ctx.fill();
    };
    // Rail, then cloth: the baulk end is the wide, lower edge.
    quad(
      [
        [120, 735],
        [1080, 735],
        [830, 75],
        [370, 75],
      ],
      "#4a2f1c",
    );
    quad(
      [
        [190, 700],
        [1010, 700],
        [790, 110],
        [410, 110],
      ],
      "#1c7c4a",
    );
    const disc = (x: number, y: number, r: number, colour: string) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    disc(600, 600, 16, "#fbfaf2");
    disc(560, 360, 12, "#f2c200");
    disc(650, 300, 11, "#c0261d");
    disc(610, 200, 10, "#141414");
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) throw new Error("no png");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

async function openReview(page: Page) {
  await page.goto("/");
  const png = await syntheticPhoto(page);
  await page.getByLabel("Photo of the table").setInputFiles({
    name: "table.png",
    mimeType: "image/png",
    buffer: png,
  });
  const dialog = page.getByRole("dialog", { name: "Check the photo" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

test("import from a photo: review, confirm, undo, and nothing leaves the page", async ({
  page,
}) => {
  const requests: { url: string; method: string; body: boolean }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const png = await syntheticPhoto(page);
  // Everything from here on is watched: choosing the photo, reviewing it, confirming.
  page.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method(), body: r.postDataBuffer() !== null }),
  );

  await expect(page.getByText("The photo stays on this device.")).toBeVisible();
  await page.getByLabel("Photo of the table").setInputFiles({
    name: "table.png",
    mimeType: "image/png",
    buffer: png,
  });
  const dialog = page.getByRole("dialog", { name: "Check the photo" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("button", { name: "Baulk left" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Top right" })).toBeVisible();
  await expect(dialog.getByRole("status").first()).toContainText(/\d+ balls? found/);
  const summary = (await dialog.locator(".photo-summary").textContent()) ?? "";
  expect(Number(/^(\d+) ball/.exec(summary)?.[1])).toBeGreaterThan(0);

  await dialog.getByRole("button", { name: "Use these balls" }).click();
  await expect(dialog).toBeHidden();
  const balls = page.locator("[data-ball-id]");
  expect(await balls.count()).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Import from photo" })).toBeFocused();

  // One Undo removes them all.
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(balls).toHaveCount(0);

  // Nothing was sent: no request carried a body, none used another method than GET, and none
  // went anywhere but this site (the only ones are the page loading its own analysis worker).
  // No image data was stored, and the link carries none.
  const origin = new URL(page.url()).origin;
  const sent = requests.filter(
    (r) =>
      !r.url.startsWith("blob:") &&
      !r.url.startsWith("data:") &&
      (r.body || r.method !== "GET" || new URL(r.url).origin !== origin),
  );
  expect(sent).toEqual([]);
  const stored = await page.evaluate(() => {
    const out: string[] = [];
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i) ?? "";
        out.push(k, store.getItem(k) ?? "");
      }
    }
    return out.join("\n");
  });
  expect(stored).not.toMatch(/data:image|blob:|iVBOR|widthPx/);
  expect(stored.length).toBeLessThan(20_000);
  const hash = new URL(page.url()).hash;
  expect(hash).not.toMatch(/data:image|blob:|iVBOR/);
  expect(hash.length).toBeLessThan(5_000);
  expect(errors).toEqual([]);
});

test("cancel leaves the table unchanged", async ({ page }) => {
  const dialog = await openReview(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-ball-id]")).toHaveCount(0);

  // Escape cancels too, and the table is kept as it was.
  await page.getByRole("button", { name: "9-ball rack" }).click();
  await expect(page.locator("[data-ball-id]")).toHaveCount(10);
  await page.getByLabel("Photo of the table").setInputFiles({
    name: "again.png",
    mimeType: "image/png",
    buffer: await syntheticPhoto(page),
  });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-ball-id]")).toHaveCount(10);
});

test("a corner can be moved, a ball changed and one added, and a bad file is explained", async ({
  page,
}) => {
  const dialog = await openReview(page);
  const handle = dialog.getByRole("button", { name: "Baulk left" });
  const before = await handle.getAttribute("transform");
  await handle.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(handle).not.toHaveAttribute("transform", before ?? "");
  // The balls are found again for the new corner; edits are made after that.
  await expect(dialog).toHaveAttribute("data-runs", "1", { timeout: 30_000 });

  const ball = dialog.locator(".photo-ball").first();
  await ball.dispatchEvent("pointerdown", { bubbles: true });
  const select = dialog.getByLabel("Ball kind");
  await expect(select).toBeVisible();
  await select.selectOption("5");
  await expect(dialog.getByRole("button", { name: "5 ball" })).toBeVisible();
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(dialog.getByRole("button", { name: "5 ball" })).toHaveCount(0);

  const placed = dialog.locator(".photo-ball");
  const countBefore = await placed.count();
  await dialog.getByLabel("Ball to add").selectOption("3");
  await dialog.getByRole("button", { name: "Add a ball" }).click();
  await dialog.locator("svg.photo-overlay").click({ position: { x: 300, y: 300 } });
  await expect(placed).toHaveCount(countBefore + 1);
  await expect(dialog.locator('.photo-ball[aria-pressed="true"]')).toHaveAccessibleName("3 ball");

  await dialog.getByRole("button", { name: "Use these balls" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-ball-id]").first()).toBeVisible();

  await page.getByLabel("Photo of the table").setInputFiles({
    name: "notes.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not a picture"),
  });
  await expect(page.getByRole("alert").filter({ hasText: "could not be read" })).toBeVisible();
});

test("on a small phone the two closing buttons stay in view while the controls scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 560 });
  const dialog = await openReview(page);
  // Selecting a ball and starting to add one makes the controls taller than their share.
  await dialog.locator(".photo-ball").first().dispatchEvent("pointerdown", { bubbles: true });
  await dialog.getByRole("button", { name: "Add a ball" }).click();
  for (const name of ["Use these balls", "Cancel"]) {
    await expect(dialog.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  }
  const controls = dialog.locator(".photo-controls");
  await controls.evaluate((el) => el.scrollTo(0, 0));
  for (const name of ["Use these balls", "Cancel"]) {
    await expect(dialog.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  }
});
