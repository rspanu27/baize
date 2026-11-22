import { expect, test } from "@playwright/test";

/**
 * Task 7.1: a video is written and read back in the browser through the editor's own video
 * interface (`src/video/media.ts`, the only user of Mediabunny), and nothing leaves the page.
 * A white ball moves along a green cloth for 30 frames; the clip read back has the same size,
 * length and frames, with the ball where it was drawn.
 */
test("a clip is written and read back in the page, and nothing is sent", async ({ page }) => {
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
    // The module as the dev server serves it to the page (a variable, so that TypeScript does
    // not try to resolve a path that exists only on the server).
    const path = "/src/video/media.ts";
    const m = (await import(path)) as typeof import("../src/video/media");
    const W = 320;
    const H = 240;
    const FRAMES = 30;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const ballX = (i: number) => 40 + i * 8;
    const writer = await m.createClipWriter(canvas);
    for (let i = 0; i < FRAMES; i++) {
      ctx.fillStyle = "#1d6b3a";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ballX(i), 120, 14, 0, Math.PI * 2);
      ctx.fill();
      await writer.add(i / FRAMES, 1 / FRAMES);
    }
    const blob = await writer.finish();

    const clip = await m.openClip(blob);
    const probe = document.createElement("canvas");
    probe.width = W;
    probe.height = H;
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    if (!pctx) throw new Error("no 2d context");
    const times: number[] = [];
    let ball: number[] = [];
    let cloth: number[] = [];
    for await (const f of clip.frames()) {
      if (times.length === 15) {
        pctx.drawImage(f.canvas, 0, 0);
        ball = [...pctx.getImageData(ballX(15), 120, 1, 1).data];
        cloth = [...pctx.getImageData(ballX(15), 40, 1, 1).data];
      }
      times.push(f.timestampS);
    }
    clip.close();
    return {
      format: writer.format,
      codec: writer.codec,
      bytes: blob.size,
      info: clip.info,
      times,
      ball,
      cloth,
    };
  });

  expect(out.bytes).toBeGreaterThan(0);
  expect(out.info.widthPx).toBe(320);
  expect(out.info.heightPx).toBe(240);
  expect(out.info.durationS).toBeCloseTo(1, 1);
  expect(out.times).toHaveLength(30);
  // Exact frame times, in order: frame k at k/30 s.
  out.times.forEach((t, k) => expect(t).toBeCloseTo(k / 30, 3));
  // The ball is white where it was drawn in frame 15, the cloth green around it (lossy video:
  // near, not exact).
  const [br = 0, bg = 0, bb = 0] = out.ball;
  expect(Math.min(br, bg, bb)).toBeGreaterThan(200);
  const [cr = 0, cg = 0, cb = 0] = out.cloth;
  expect(cg).toBeGreaterThan(cr + 40);
  expect(cg).toBeGreaterThan(cb + 20);
  console.log(`video spike: ${out.format} ${out.codec}, ${String(out.bytes)} bytes`);

  // Nothing was sent: only the page fetching its own code (GET, no body, this site, a script,
  // a short path and a short plain query), and no sizeable WebSocket message.
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
  expect(errors).toEqual([]);
});
