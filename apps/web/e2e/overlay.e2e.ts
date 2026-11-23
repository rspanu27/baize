import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/**
 * Task 7.8, visual check: frames with every overlay drawn by the browser's own canvas onto a
 * stand-in clip frame (a synthetic analysis), saved as PNGs under test-results/overlay for a
 * person to look at (never committed), and the overlay's drawing time per 1080p frame.
 */
test("overlays render onto 1080p frames", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  const out = await page.evaluate(async () => {
    // Modules as the dev server serves them (variables, so TypeScript does not resolve them).
    const fixturePath = "/src/video/overlay/testAnalysis.ts";
    const drawPath = "/src/video/overlay/draw.ts";
    const timelinePath = "/src/video/overlay/timeline.ts";
    const typesPath = "/src/video/types.ts";
    const fx = (await import(fixturePath)) as typeof import("../src/video/overlay/testAnalysis");
    const d = (await import(drawPath)) as typeof import("../src/video/overlay/draw");
    const tl = (await import(timelinePath)) as typeof import("../src/video/overlay/timeline");
    const ty = (await import(typesPath)) as typeof import("../src/video/types");

    const analysis = fx.testAnalysis();
    const shot = analysis.shots[0];
    if (!shot) throw new Error("no shot");
    const contact = tl.firstContactSimS(shot) ?? 0;
    const canvas = document.createElement("canvas");
    canvas.width = analysis.widthPx;
    canvas.height = analysis.heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const all = { ...ty.DEFAULT_OVERLAYS, allTrails: true, labels: true };
    const shots: { name: string; png: string }[] = [];
    const picture = (
      name: string,
      t: number,
      slow: boolean,
      options: typeof ty.DEFAULT_OVERLAYS,
    ): void => {
      fx.drawTestFrame(ctx, analysis, t);
      d.drawOverlay(ctx, analysis, options, t, slow);
      shots.push({ name, png: canvas.toDataURL("image/png") });
    };
    picture("1-before-shot", shot.startS - 0.2, false, ty.DEFAULT_OVERLAYS);
    picture("2-before-contact", shot.strikeS + contact * 0.7, true, ty.DEFAULT_OVERLAYS);
    picture("3-after-contact", shot.strikeS + contact + 0.4, true, ty.DEFAULT_OVERLAYS);
    picture("4-end-all-trails", analysis.durationS, false, all);
    picture("5-print-imperial", shot.strikeS + 1.5, false, {
      ...all,
      theme: "print",
      units: "imperial",
    });
    picture("6-dark", shot.strikeS + 1.5, false, { ...all, theme: "dark" });

    // Timing over the whole timeline with every overlay on. "Record" is the drawOverlay call
    // alone; "flushed" adds the GPU work, as the difference between frames drawn with and
    // without overlays, each forced to finish by reading back one pixel.
    const frames = tl.buildTimeline(analysis, all, 30);
    const run = (withOverlay: boolean) => {
      let record = 0;
      const started = performance.now();
      for (const f of frames) {
        fx.drawTestFrame(ctx, analysis, f.clipTimeS);
        if (withOverlay) {
          const t0 = performance.now();
          d.drawOverlay(ctx, analysis, all, f.clipTimeS, f.slow);
          record += performance.now() - t0;
        }
        ctx.getImageData(0, 0, 1, 1);
      }
      return { total: performance.now() - started, record };
    };
    run(true); // warm up (and fill the minimap cache)
    const plain = run(false);
    const over = run(true);
    return {
      shots,
      frames: frames.length,
      recordMs: over.record / frames.length,
      flushedMs: (over.total - plain.total) / frames.length,
    };
  });

  await mkdir("test-results/overlay", { recursive: true });
  for (const s of out.shots) {
    const data = s.png.replace(/^data:image\/png;base64,/, "");
    await writeFile(`test-results/overlay/${s.name}.png`, Buffer.from(data, "base64"));
  }
  console.log(
    `overlay per 1080p frame over ${String(out.frames)} frames: ` +
      `${out.recordMs.toFixed(2)} ms drawing calls, ${out.flushedMs.toFixed(2)} ms with GPU work`,
  );
  expect(out.shots).toHaveLength(6);
  expect(out.recordMs).toBeLessThan(50);
  expect(errors).toEqual([]);
});
