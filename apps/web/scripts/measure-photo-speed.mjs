// Measures how long the photo import takes in the editor, as a person would wait for it:
// from choosing the file to the review screen being shown. Task 5.9; the limit is 8 s
// without WebGPU (docs/SPEC.md). It runs the production build in the Chromium that
// Playwright installs, with the CPU slowed down to stand in for phones.
//
//   pnpm --filter web build
//   node apps/web/scripts/measure-photo-speed.mjs [photo.jpg ...]
//
// Without a photo it makes a synthetic 12-megapixel one (4000 x 3000) in the page. A photo
// given is scaled up or down in the page to 12 megapixels too, keeping its shape. Nothing is
// sent anywhere: the page is served from this machine and the photo is handed to it directly.
// Timing on a shared machine varies; run it on an idle one and read the spread of the runs.
//
// The analysis runs in a worker. Chromium's CPU slow-down applies to the page and may not to
// its workers, so with the slow-down the total time is likely too short; the figure that
// counts for slow phones is the time the analysis takes on the page itself (measured before
// the worker was added: docs/PROGRESS.md). What this does measure with the slow-down is how
// long the page is blocked at a time, which is what the worker is for.
/* global createImageBitmap, document, window -- used inside the page */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const PORT = 5198;
const RATES = [1, 4, 6];
const RUNS = 3;
const TARGET_PIXELS = 12_000_000;

// One command string: on Windows pnpm is a script and needs the shell.
const server = spawn(`pnpm exec vite preview --port ${String(PORT)} --strictPort`, {
  cwd: app,
  shell: true,
  stdio: "ignore",
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://localhost:${String(PORT)}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the preview server did not start (run `pnpm --filter web build` first)");
}

/** A 12-megapixel JPEG made in the page, from a given photo or drawn. */
async function twelveMegapixels(page, photo) {
  const base64 = await page.evaluate(
    async ({ data, target }) => {
      let source;
      if (data) {
        const blob = await (await fetch(`data:image/jpeg;base64,${data}`)).blob();
        source = await createImageBitmap(blob, { imageOrientation: "from-image" });
      }
      const aspect = source ? source.width / source.height : 4 / 3;
      const h = Math.round(Math.sqrt(target / aspect));
      const w = Math.round(h * aspect);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (source) {
        ctx.drawImage(source, 0, 0, w, h);
      } else {
        // Floor, rail, cloth in perspective, and a spread of balls with shadows.
        ctx.fillStyle = "#6f6a63";
        ctx.fillRect(0, 0, w, h);
        const quad = (pts, colour) => {
          ctx.fillStyle = colour;
          ctx.beginPath();
          pts.forEach(([x, y], i) =>
            i === 0 ? ctx.moveTo(x * w, y * h) : ctx.lineTo(x * w, y * h),
          );
          ctx.closePath();
          ctx.fill();
        };
        quad(
          [
            [0.1, 0.92],
            [0.9, 0.92],
            [0.69, 0.09],
            [0.31, 0.09],
          ],
          "#3d2618",
        );
        quad(
          [
            [0.16, 0.875],
            [0.84, 0.875],
            [0.66, 0.14],
            [0.34, 0.14],
          ],
          "#1d5fa3",
        );
        const colours = [
          "#fbfaf2",
          "#f2c200",
          "#1f3fa0",
          "#c0261d",
          "#5a2a82",
          "#ef7d1a",
          "#1e7a3c",
          "#7a1f1f",
          "#141414",
        ];
        colours.forEach((c, i) => {
          const fy = 0.2 + 0.08 * i;
          const fx = 0.38 + ((i * 37) % 24) / 100;
          const r = (0.008 + 0.012 * fy) * w;
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.beginPath();
          ctx.ellipse(fx * w + r * 0.2, fy * h + r * 0.6, r, r * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(fx * w, fy * h, r, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      const bytes = new Uint8Array(await out.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return { b64: btoa(binary), w, h };
    },
    { data: photo ? photo.toString("base64") : undefined, target: TARGET_PIXELS },
  );
  return base64;
}

async function measure(browser, label, photo) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  await page.goto(`http://localhost:${String(PORT)}/`);
  const jpeg = await twelveMegapixels(page, photo);
  const cdp = await context.newCDPSession(page);
  const lines = [];
  for (const rate of RATES) {
    const times = [];
    const blocked = [];
    for (let run = 0; run < RUNS; run++) {
      await page.goto(`http://localhost:${String(PORT)}/`);
      // Long tasks: stretches in which the page could not respond to a tap.
      await page.evaluate(() => {
        window.__longest = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries())
            window.__longest = Math.max(window.__longest, e.duration);
        }).observe({ type: "longtask", buffered: false });
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const start = Date.now();
      await page.getByLabel("Photo of the table").setInputFiles({
        name: "photo.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from(jpeg.b64, "base64"),
      });
      await page
        .getByRole("dialog", { name: "Check the photo" })
        .waitFor({ state: "visible", timeout: 120_000 });
      times.push((Date.now() - start) / 1000);
      blocked.push(await page.evaluate(() => window.__longest / 1000));
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
    times.sort((a, b) => a - b);
    lines.push(
      `${label} (${String(jpeg.w)} x ${String(jpeg.h)}), CPU slowed ${String(rate)}x: ` +
        `${times.map((t) => t.toFixed(2)).join(" / ")} s (median ${times[Math.floor(times.length / 2)].toFixed(2)} s); ` +
        `page blocked at most ${Math.max(...blocked).toFixed(2)} s at a time`,
    );
  }
  await context.close();
  return lines;
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const photos = process.argv.slice(2);
  const results = [];
  if (photos.length === 0) results.push(...(await measure(browser, "synthetic photo", undefined)));
  for (const path of photos) {
    results.push(...(await measure(browser, "given photo", readFileSync(path))));
  }
  await browser.close();
  console.log(results.join("\n"));
} finally {
  server.kill();
}
