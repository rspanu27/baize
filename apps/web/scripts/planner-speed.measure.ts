import { expect, test } from "@playwright/test";
import { getTablePreset, spotsFor } from "@baize/tables";
import type { BallKind } from "@baize/tables";
import { docToHash } from "../src/doc/codec";
import { newDoc } from "../src/doc/resolve";
import type { DiagramDoc } from "../src/doc/types";

/**
 * How long a person waits for the planner (SPEC section 10: first route within 1 s, a 3-shot
 * route within 5 s on a desktop browser, the page never blocked for more than 100 ms). See
 * planner-speed.config.ts for how to run it.
 */

type Ball = { id: string; kind: BallKind; fx: number; fy: number };

function docOf(
  preset: string,
  balls: readonly Ball[],
  extra: DiagramDoc["balls"] = [],
): DiagramDoc {
  const table = getTablePreset(preset);
  if (!table) throw new Error(`no preset ${preset}`);
  const { widthM, lengthM } = table.playingArea;
  return {
    ...newDoc(preset),
    balls: [
      ...balls.map((b) => ({ id: b.id, kind: b.kind, x: widthM * b.fx, y: lengthM * b.fy })),
      ...extra,
    ],
  };
}

/** A full snooker table: 15 reds spread over the top half, the colours on their spots. */
function fullSnooker(): DiagramDoc {
  const table = getTablePreset("snooker-12@1");
  if (!table) throw new Error("no snooker table");
  const { widthM, lengthM } = table.playingArea;
  let s = 3;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const balls: DiagramDoc["balls"] = [{ id: "cue", kind: "cue", x: widthM / 2, y: lengthM * 0.3 }];
  for (const k of ["yellow", "green", "brown", "blue", "pink", "black"] as const) {
    const spot = spotsFor(table).find((p) => p.name === k);
    if (spot) balls.push({ id: k, kind: k, x: spot.x, y: spot.y });
  }
  let n = 0;
  while (n < 15) {
    const b = {
      id: `r${String(n)}`,
      kind: "red" as const,
      x: widthM * (0.08 + 0.84 * rand()),
      y: lengthM * (0.45 + 0.5 * rand()),
    };
    if (balls.every((o) => Math.hypot(o.x - b.x, o.y - b.y) > 0.06)) {
      balls.push(b);
      n++;
    }
  }
  return { ...newDoc("snooker-12@1"), balls };
}

const LAYOUTS: { name: string; doc: () => DiagramDoc }[] = [
  {
    name: "9-ball, five balls left",
    doc: () =>
      docOf("pool-9@1", [
        { id: "cue", kind: "cue", fx: 0.5, fy: 0.3 },
        { id: "5", kind: "5", fx: 0.3, fy: 0.45 },
        { id: "6", kind: "6", fx: 0.75, fy: 0.55 },
        { id: "7", kind: "7", fx: 0.4, fy: 0.7 },
        { id: "8", kind: "8", fx: 0.65, fy: 0.85 },
        { id: "9", kind: "9", fx: 0.2, fy: 0.9 },
      ]),
  },
  { name: "snooker, 15 reds and the colours", doc: fullSnooker },
];

const RATES = [1, 4];

for (const layout of LAYOUTS) {
  test(layout.name, async ({ page }) => {
    const hash = await docToHash(layout.doc());
    const cdp = await page.context().newCDPSession(page);
    const lines: string[] = [];
    for (const rate of RATES) {
      for (let run = 0; run < 3; run++) {
        await page.goto(`/${hash}`);
        await page.evaluate(() => {
          const w = window as unknown as { __longest: number };
          w.__longest = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) w.__longest = Math.max(w.__longest, e.duration);
          }).observe({ type: "longtask", buffered: false });
        });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        const panel = page.locator("section.planner-panel");
        const find = panel.getByRole("button", { name: "Find a route" });
        await find.scrollIntoViewIfNeeded();
        const start = Date.now();
        await find.click();
        await panel
          .getByRole("list", { name: "Route" })
          .getByRole("listitem")
          .first()
          .waitFor({ timeout: 120_000 });
        const first = (Date.now() - start) / 1000;
        await expect(find).toBeVisible({ timeout: 240_000 });
        const all = (Date.now() - start) / 1000;
        const longest = await page.evaluate(
          () => (window as unknown as { __longest: number }).__longest,
        );
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        lines.push(
          `${layout.name}, page CPU slowed ${String(rate)}x, run ${String(run + 1)}: ` +
            `first route ${first.toFixed(2)} s, finished ${all.toFixed(2)} s, ` +
            `page blocked at most ${longest.toFixed(0)} ms`,
        );
      }
    }
    console.log(lines.join("\n"));
  });
}
