import { mkdir, stat } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Task 7.10: the whole video screen on a clip made in the page. The table is calibrated, the
 * balls tracked (stopping once on the way), the result shown, the video saved as a download,
 * and, if a shot was found, opened in the editor; nothing leaves the page.
 *
 * The clip is the clip test's synthetic table (floor, wooden rail, green cloth, four balls)
 * seen in perspective, 3 s at 30 frames a second: the table still for 0.8 s, then the cue ball
 * rolling up the table in a straight line, slowing evenly and stopping after a second, then
 * still again. The motion is drawn, not simulated, so the physics fit may well be rough.
 */
async function rollingClip(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const path = "/src/video/media.ts";
    const m = (await import(path)) as typeof import("../src/video/media");
    const w = 1200;
    const h = 800;
    const FPS = 30;
    const FRAMES = 90;
    const START = 24;
    const ROLL = 30;
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
    // Distance rolled after k frames: 12 px in the first frame, 0.4 px less each frame after.
    const rolled = (k: number) => {
      const n = Math.max(0, Math.min(ROLL, k));
      return 12 * n - 0.2 * n * (n - 1);
    };
    const writer = await m.createClipWriter(canvas);
    for (let i = 0; i < FRAMES; i++) {
      ctx.fillStyle = "#77736d";
      ctx.fillRect(0, 0, w, h);
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
      const d = rolled(i - START);
      disc(600 + d * 0.05, 600 - d, 16 - d * 0.012, "#fbfaf2");
      disc(520, 360, 12, "#f2c200");
      disc(680, 300, 11, "#c0261d");
      disc(610, 180, 10, "#141414");
      await writer.add(i / FPS, 1 / FPS);
    }
    const blob = await writer.finish();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

test("a clip is tracked, saved as a video and opened in the editor, and nothing is sent", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const clip = await rollingClip(page);

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

  await page.getByLabel("Video clip of the table").setInputFiles({
    name: "break.mp4",
    mimeType: "video/mp4",
    buffer: clip,
  });
  const review = page.getByRole("dialog", { name: "Find the table" });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review.locator(".photo-summary")).toHaveText(
    "The table is placed. Check that each handle is on its corner.",
  );
  await review.getByRole("button", { name: "Use this table" }).click();

  const screen = page.getByRole("dialog", { name: "Overlay a clip" });
  await expect(screen).toHaveAttribute("data-phase", "calibrated");

  // Stopping returns to the placed table.
  await screen.getByRole("button", { name: "Track the balls", exact: true }).click();
  await expect(screen).toHaveAttribute("data-phase", "tracking");
  await expect(screen.getByRole("progressbar", { name: "Tracking progress" })).toBeVisible();
  await screen.getByRole("button", { name: "Stop" }).click();
  await expect(screen).toHaveAttribute("data-phase", "calibrated");
  await expect(screen.getByRole("status")).toHaveText("Tracking stopped. Nothing was kept.");

  // Tracking to the end.
  await screen.getByRole("button", { name: "Track the balls again" }).click();
  await expect(screen).toHaveAttribute("data-phase", "analysed", { timeout: 240_000 });
  const found = screen.getByText(/shots? found\./);
  const none = screen.getByText("No shot was found in this clip.");
  await expect(found.or(none)).toBeVisible();
  const shotFound = await found.isVisible();

  // The overlays can be changed and the preview scrubbed.
  await screen.getByRole("checkbox", { name: "Every ball's path" }).check();
  await screen.getByRole("combobox", { name: "Colours" }).selectOption("dark");
  const scrubber = screen.getByRole("slider", { name: "Preview time" });
  await scrubber.fill("45");
  await expect(scrubber).toHaveValue("45");
  const canvas = screen.getByRole("img", { name: "Preview of the video with the overlays" });
  await expect(canvas).toBeVisible();
  // For looking at: the results screen on a computer and on a phone held upright.
  await mkdir("test-results/video-screen", { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/video-screen/desktop.png" });
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/video-screen/phone.png" });
  await screen.locator(".photo-controls").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await page.screenshot({ path: "test-results/video-screen/phone-controls.png" });
  if (desktop) await page.setViewportSize(desktop);

  // Playing runs to the end of the video and stops there.
  await screen.getByRole("button", { name: "Play" }).click();
  await expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(screen.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 60_000 });
  await expect(scrubber).not.toHaveValue("45");

  // Saving gives a download of the written video.
  const downloading = page.waitForEvent("download", { timeout: 120_000 });
  await screen.getByRole("button", { name: "Save video" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^break-baize\.(mp4|webm)$/);
  expect((await stat(await download.path())).size).toBeGreaterThan(1000);
  await expect(screen.getByText(/^Saved as break-baize\.(mp4|webm)\.$/)).toBeVisible();

  await expect(page.locator("[data-ball-id]")).toHaveCount(0);
  if (shotFound) {
    await screen.getByRole("button", { name: "Open in editor" }).click();
    await expect(screen).toBeHidden();
    expect(await page.locator("[data-ball-id]").count()).toBeGreaterThan(0);
  } else {
    await screen.getByRole("button", { name: "Close" }).click();
    await expect(screen).toBeHidden();
  }
  await expect(page.getByRole("button", { name: "Overlay a clip" })).toBeFocused();

  // Nothing was sent: only the page fetching its own code (the video screen and its workers).
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
  expect(errors).toEqual([]);
});
