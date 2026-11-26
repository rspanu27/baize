import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Task 7.4: a clip is chosen, opened in the page, its first frame shown, and the table placed
 * on it with the photo review's corner handles; nothing leaves the page.
 *
 * The clip is made in the page through the editor's own video interface: a table seen in
 * perspective (floor, wooden rail, green cloth, a few balls, as the photo tests draw it), with
 * the cue ball rolling for one second at 30 frames a second.
 */
async function syntheticClip(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    // The module as the dev server serves it (a variable, so that TypeScript does not try to
    // resolve a path that exists only on the server).
    const path = "/src/video/media.ts";
    const m = (await import(path)) as typeof import("../src/video/media");
    const w = 1200;
    const h = 800;
    const FRAMES = 30;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
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
    const disc = (x: number, y: number, r: number, colour: string) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const writer = await m.createClipWriter(canvas);
    for (let i = 0; i < FRAMES; i++) {
      ctx.fillStyle = "#77736d";
      ctx.fillRect(0, 0, w, h);
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
      disc(600, 600 - i * 4, 16, "#fbfaf2");
      disc(560, 360, 12, "#f2c200");
      disc(650, 300, 11, "#c0261d");
      disc(610, 200, 10, "#141414");
      await writer.add(i / FRAMES, 1 / FRAMES);
    }
    const blob = await writer.finish();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

test("a clip is opened, its table found on the first frame and confirmed, and nothing is sent", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const clip = await syntheticClip(page);

  // Everything from here on is watched: choosing the clip, calibrating, confirming, closing.
  const requests: { url: string; method: string; body: boolean; type: string }[] = [];
  const framesSent: number[] = [];
  page.on("request", (r) =>
    requests.push({
      url: r.url(),
      method: r.method(),
      body: r.postDataBuffer() !== null,
      type: r.resourceType(),
    }),
  );
  page.on("websocket", (ws) => {
    ws.on("framesent", (f) => framesSent.push(f.payload.length));
  });

  await expect(page.getByText("The clip stays on this device.")).toBeVisible();
  await page.getByLabel("Video clip of the table").setInputFiles({
    name: "break.mp4",
    mimeType: "video/mp4",
    buffer: clip,
  });

  // The first frame, with what the clip is, and the four corner handles.
  const review = page.getByRole("dialog", { name: "Find the table" });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review.getByRole("img", { name: "The first frame of your clip" })).toBeVisible();
  await expect(review.getByText("1200 × 800")).toBeVisible();
  await expect(review.getByText("break.mp4")).toBeVisible();
  for (const name of ["Baulk left", "Baulk right", "Top right", "Top left"]) {
    await expect(review.getByRole("button", { name })).toBeVisible();
  }
  // The table was found by itself on this frame.
  await expect(review.locator(".photo-summary")).toHaveText(
    /^The table is placed\. Check that each handle is on its corner\. \d+ balls? found/,
  );
  // A corner can still be moved by hand; the table is found again for it.
  const handle = review.getByRole("button", { name: "Top left" });
  const before = await handle.getAttribute("transform");
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle).not.toHaveAttribute("transform", before ?? "");
  await expect(review).toHaveAttribute("data-runs", "1", { timeout: 30_000 });
  const placed = (await handle.getAttribute("transform")) ?? "";

  await review.getByRole("button", { name: "Use this table" }).click();
  const screen = page.getByRole("dialog", { name: "Overlay a clip" });
  await expect(screen).toBeVisible();
  await expect(screen.getByRole("status")).toHaveText(
    "The table is placed. Next, track the balls through the clip.",
  );
  await expect(screen.locator("polygon").first()).toBeVisible();

  // Adjusting goes back to the handles, where the table was left.
  await screen.getByRole("button", { name: "Adjust the corners" }).click();
  await expect(review).toBeVisible();
  await expect(handle).toHaveAttribute("transform", placed);
  await review.getByRole("button", { name: "Use this table" }).click();
  await screen.getByRole("button", { name: "Close" }).click();
  await expect(screen).toBeHidden();
  await expect(page.getByRole("button", { name: "Overlay a clip" })).toBeFocused();

  // Nothing was sent: only the page fetching its own code (the video screen, loaded when the
  // clip was chosen, and the table finder's worker): GET, no body, this site, a script, a short
  // path and a short plain query. No sizeable WebSocket message, nothing from the clip stored,
  // nothing in the link, and the diagram unchanged.
  const origin = new URL(page.url()).origin;
  const sent = requests.filter((r) => {
    if (r.url.startsWith("blob:") || r.url.startsWith("data:")) return false;
    const url = new URL(r.url);
    const ownCode =
      r.method === "GET" &&
      !r.body &&
      url.origin === origin &&
      r.type === "script" &&
      r.url.length <= 300 &&
      /^(\?[\w=&.-]{0,40})?$/.test(url.search);
    return !ownCode;
  });
  expect(sent).toEqual([]);
  expect(framesSent.filter((n) => n > 256)).toEqual([]);
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
  expect(stored).not.toMatch(/break\.mp4|data:image|data:video|blob:|widthPx|corners|AAAA/);
  expect(stored.length).toBeLessThan(20_000);
  const hash = new URL(page.url()).hash;
  expect(hash).not.toMatch(/break|data:|blob:/);
  expect(hash.length).toBeLessThan(5_000);
  await expect(page.locator("[data-ball-id]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a file that is not a video is explained in plain words, and Escape closes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Video clip of the table").setInputFiles({
    name: "notes.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("this is not a video"),
  });
  const screen = page.getByRole("dialog", { name: "Overlay a clip" });
  await expect(screen.getByRole("alert")).toHaveText(
    "This file is not a video this page can read. MP4, MOV and WebM files work.",
    { timeout: 30_000 },
  );
  await page.keyboard.press("Escape");
  await expect(screen).toBeHidden();
  await expect(page.getByRole("button", { name: "Overlay a clip" })).toBeFocused();
});
