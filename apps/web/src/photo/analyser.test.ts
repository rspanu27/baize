import { TABLE_PRESETS, getBallSet } from "@baize/tables";
import type { PhotoImage } from "@baize/vision";
import { describe, expect, test } from "vitest";
import { createAnalyser, mainThreadAnalyser } from "./analyser";

const table = TABLE_PRESETS.find((t) => t.id === "pool-9@1");
const ballSet = table ? getBallSet(table.defaultBallSetId) : undefined;
if (!table || !ballSet) throw new Error("no 9 ft table");

/** A grey picture: there is no table in it. */
const blank: PhotoImage = {
  widthPx: 64,
  heightPx: 48,
  data: new Uint8ClampedArray(64 * 48 * 4).fill(128),
};

describe("running the photo import", () => {
  test("on the main thread, it gives the import's answer", async () => {
    const analyser = mainThreadAnalyser(blank);
    const result = await analyser.run(table, ballSet);
    expect(result.problem).toBe("table-not-found");
    expect(result.layout.balls).toEqual([]);
  });

  test("once the photo is closed, a run is refused", async () => {
    const analyser = mainThreadAnalyser(blank);
    analyser.dispose();
    await expect(analyser.run(table, ballSet)).rejects.toThrow("closed");
  });

  test("where workers are not available it runs on the main thread", async () => {
    // The unit tests run without a browser, so there is no Worker.
    expect(typeof Worker).toBe("undefined");
    const analyser = createAnalyser(blank);
    const result = await analyser.run(table, ballSet, {
      corners: [
        { u: 10, v: 40 },
        { u: 54, v: 40 },
        { u: 44, v: 8 },
        { u: 20, v: 8 },
      ],
    });
    expect(result.problem).toBeUndefined();
    expect(result.diagnostics.cornersDetected).toBe(false);
    analyser.dispose();
  });
});
