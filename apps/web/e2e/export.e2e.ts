import { expect, test } from "@playwright/test";

/**
 * Task 7.9: the finished video is written in the page (`src/video/export.ts`) and nothing leaves
 * it. A 1 s clip of a white ball crossing a green cloth is written, then exported at a smaller
 * size with a timeline that plays 0 to 0.25 s in real time, 0.25 to 0.5 s at quarter speed and
 * the rest in real time, with a red square drawn on every frame. The video read back has the
 * timeline's length and frame count, the red square, and the ball where the timeline says.
 */
test("a clip is exported with a slow-motion stretch and overlays, and nothing is sent", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
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

  const out = await page.evaluate(async () => {
    // The modules as the dev server serves them to the page (variables, so that TypeScript does
    // not try to resolve paths that exist only on the server).
    const mediaPath = "/src/video/media.ts";
    const exportPath = "/src/video/export.ts";
    const m = (await import(mediaPath)) as typeof import("../src/video/media");
    const x = (await import(exportPath)) as typeof import("../src/video/export");
    const W = 320;
    const H = 240;
    const FPS = 30;
    const ballX = (k: number) => 20 + k * 9;

    // The clip: 30 frames, the ball 9 px further each frame.
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const writer = await m.createClipWriter(canvas);
    for (let k = 0; k < FPS; k++) {
      ctx.fillStyle = "#1d6b3a";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ballX(k), 120, 10, 0, Math.PI * 2);
      ctx.fill();
      await writer.add(k / FPS, 1 / FPS);
    }
    const clipBlob = await writer.finish();
    const clip = await m.openClip(clipBlob);

    // The timeline: 0 to 0.25 s in real time, 0.25 to 0.5 s at quarter speed, then real time.
    const clipTimes = [
      ...Array.from({ length: 8 }, (_, i) => i / FPS),
      ...Array.from({ length: 30 }, (_, j) => 0.25 + j / (4 * FPS)),
      ...Array.from({ length: 15 }, (_, k) => 0.5 + k / FPS),
    ];
    const timeline = clipTimes.map((clipTimeS, i) => ({
      outTimeS: i / FPS,
      clipTimeS,
      slow: i >= 8 && i < 38,
    }));
    // The clip frame each output frame should show: the latest at or before its clip time.
    const shownFrame = clipTimes.map((t) => Math.floor(t * FPS + 1e-6));

    const OW = 240;
    const OH = 180;
    const scale = OW / W;
    let progressCalls = 0;
    const started = performance.now();
    const result = await x.exportVideo({
      clip,
      widthPx: OW,
      heightPx: OH,
      fps: FPS,
      timeline,
      draw: (c) => {
        c.fillStyle = "#ff0000";
        c.fillRect(10, 10, 40, 40);
      },
      onProgress: () => {
        progressCalls++;
      },
    });
    const exportMs = performance.now() - started;
    clip.close();

    // Read the exported video back: frame times, the red square, and where the ball is (the
    // middle of the white pixels on the ball's row).
    const video = await m.openClip(result.blob);
    const probe = document.createElement("canvas");
    probe.width = OW;
    probe.height = OH;
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    if (!pctx) throw new Error("no 2d context");
    const times: number[] = [];
    const ballAt: number[] = [];
    let square: number[] = [];
    for await (const f of video.frames()) {
      pctx.drawImage(f.canvas, 0, 0);
      if (times.length === 20) square = [...pctx.getImageData(30, 30, 1, 1).data];
      const row = pctx.getImageData(0, Math.round(120 * scale), OW, 1).data;
      let sum = 0;
      let n = 0;
      for (let px = 0; px < OW; px++) {
        const i = px * 4;
        if (Math.min(row[i] ?? 0, row[i + 1] ?? 0, row[i + 2] ?? 0) > 200) {
          sum += px;
          n++;
        }
      }
      ballAt.push(n > 0 ? sum / n : -1);
      times.push(f.timestampS);
    }
    video.close();
    return {
      format: result.format,
      codec: result.codec,
      bytes: result.blob.size,
      frames: result.frames,
      seconds: result.seconds,
      info: video.info,
      times,
      square,
      ballAt,
      expectedBallAt: shownFrame.map((k) => ballX(k) * scale),
      progressCalls,
      exportMs,
      fileName: x.exportFileName("break.mov", result.format),
    };
  });

  const N = 53;
  expect(out.bytes).toBeGreaterThan(0);
  expect(out.frames).toBe(N);
  expect(out.seconds).toBeCloseTo(N / 30, 6);
  expect(out.progressCalls).toBe(N + 1);
  expect(out.info.widthPx).toBe(240);
  expect(out.info.heightPx).toBe(180);
  expect(out.info.durationS).toBeCloseTo(N / 30, 1);
  expect(out.times).toHaveLength(N);
  out.times.forEach((t, k) => expect(t).toBeCloseTo(k / 30, 3));
  // The overlay is there (lossy video: near, not exact).
  const [r = 0, g = 0, b = 0] = out.square;
  expect(r).toBeGreaterThan(200);
  expect(g).toBeLessThan(60);
  expect(b).toBeLessThan(60);
  // Each output frame shows the clip frame the timeline asks for: the ball within 2 px of where
  // it was drawn in that clip frame (scaled). In the slow stretch a clip frame shows four times.
  out.ballAt.forEach((xPx, k) =>
    expect(Math.abs(xPx - (out.expectedBallAt[k] ?? 0))).toBeLessThan(2),
  );
  expect(out.fileName).toBe(`break-baize.${out.format}`);
  console.log(
    `video export: ${out.format} ${out.codec}, ${String(N)} frames in ${out.exportMs.toFixed(0)} ms (${(
      (N * 1000) /
      out.exportMs
    ).toFixed(0)} frames/s), ${String(out.bytes)} bytes`,
  );

  // Nothing was sent: only the page fetching its own code (GET, no body, this site, a script,
  // a short path and a short plain query), and no sizeable WebSocket message.
  const origin = new URL(page.url()).origin;
  const sent = requests.filter((req) => {
    if (req.url.startsWith("blob:") || req.url.startsWith("data:")) return false;
    const url = new URL(req.url);
    const ownCode =
      req.method === "GET" &&
      !req.body &&
      url.origin === origin &&
      req.type === "script" &&
      req.url.length <= 300 &&
      /^(\?[\w=&.-]{0,40})?$/.test(url.search);
    return !ownCode;
  });
  expect(sent).toEqual([]);
  expect(framesSent.filter((n) => n > 256)).toEqual([]);
  expect(errors).toEqual([]);
});
