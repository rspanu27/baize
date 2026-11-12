import { TABLE_PRESETS, getTablePreset, validateTable } from "@baize/tables";
import type { CustomTableFields } from "@baize/tables";
import { describe, expect, test } from "vitest";
import {
  UNPARSEABLE_MESSAGE,
  ballSetForGame,
  evaluateCustomTable,
  initialTexts,
  reformatTexts,
} from "./customTable";
import type { TableTexts } from "./customTable";

const BALL = 0.05715;

function texts(over: Partial<TableTexts> = {}): TableTexts {
  return {
    game: "pool",
    jawStyle: "auto",
    length: "2540 mm",
    width: "1270 mm",
    cornerMouth: "114 mm",
    middleMouth: "127 mm",
    ...over,
  };
}

describe("initialTexts and evaluateCustomTable", () => {
  test.each(TABLE_PRESETS.map((t) => [t.id] as const))(
    "%s: preset to text and back gives the same numbers",
    (id) => {
      const preset = getTablePreset(id);
      if (!preset) throw new Error(id);
      for (const system of ["metric", "imperial"] as const) {
        const r = evaluateCustomTable(initialTexts(preset, system), system, BALL);
        expect(r.fields).toBeDefined();
        expect(r.fields?.game).toBe(preset.game);
        expect(r.fields?.jawStyle).toBeUndefined();
        expect(r.fields?.lengthM).toBeCloseTo(preset.playingArea.lengthM, 5);
        expect(r.fields?.widthM).toBeCloseTo(preset.playingArea.widthM, 5);
        expect(r.fields?.cornerMouthM).toBeCloseTo(preset.pockets.corner.mouthM, 5);
        expect(r.fields?.middleMouthM).toBeCloseTo(preset.pockets.middle.mouthM, 5);
      }
    },
  );

  test("custom fields round trip, including the jaw style", () => {
    const fields: CustomTableFields = {
      game: "snooker",
      lengthM: 3.2,
      widthM: 1.6,
      cornerMouthM: 0.09,
      middleMouthM: 0.1,
      jawStyle: "angled",
    };
    const t = initialTexts(fields, "metric");
    expect(t.jawStyle).toBe("angled");
    expect(evaluateCustomTable(t, "metric", 0.0525).fields).toEqual(fields);
  });

  test("imperial text parses", () => {
    const r = evaluateCustomTable(
      texts({ length: "100 in", width: "50 in", cornerMouth: "4 1/2 in", middleMouth: "5 in" }),
      "imperial",
      BALL,
    );
    expect(r.fields?.lengthM).toBeCloseTo(2.54, 6);
    expect(r.fields?.cornerMouthM).toBeCloseTo(0.1143, 6);
    const feet = evaluateCustomTable(texts({ length: "8 ft 4 in" }), "imperial", BALL);
    expect(feet.fields?.lengthM).toBeCloseTo(2.54, 6);
  });

  test("unparseable text is a problem on that field and blocks applying", () => {
    const r = evaluateCustomTable(texts({ width: "wide" }), "metric", BALL);
    expect(r.fieldProblems.widthM).toEqual([UNPARSEABLE_MESSAGE]);
    expect(r.canApply).toBe(false);
    expect(r.fields).toBeUndefined();
    // No duplicate "not a number" noise for the field that could not be read.
    expect(r.issues.some((i) => i.field === "widthM")).toBe(false);
  });

  test("each validation error lands on the field it names and blocks applying", () => {
    const cases: [Partial<TableTexts>, string][] = [
      [{ length: "500 mm" }, "lengthM"],
      [{ width: "3 m" }, "widthM"],
      [{ cornerMouth: "50 mm" }, "cornerMouthM"],
      [{ middleMouth: "50 mm" }, "middleMouthM"],
    ];
    for (const [over, field] of cases) {
      const r = evaluateCustomTable(texts(over), "metric", BALL);
      expect(r.canApply).toBe(false);
      expect(r.issues.some((i) => i.field === field && i.severity === "error")).toBe(true);
    }
    const ball = evaluateCustomTable(texts(), "metric", 0.2);
    expect(ball.canApply).toBe(false);
    expect(ball.issues.some((i) => i.field === "ballDiameterM")).toBe(true);
  });

  test("issues are exactly what validateTable says", () => {
    const t = texts({ cornerMouth: "50 mm" });
    const r = evaluateCustomTable(t, "metric", BALL);
    expect(r.issues).toEqual(validateTable(r.fields as CustomTableFields, BALL));
  });

  test("warnings do not block applying", () => {
    const r = evaluateCustomTable(texts({ length: "2700 mm" }), "metric", BALL);
    expect(r.issues.some((i) => i.severity === "warning")).toBe(true);
    expect(r.issues.some((i) => i.severity === "error")).toBe(false);
    expect(r.canApply).toBe(true);
  });

  test("jaw style passes through, and automatic leaves it out", () => {
    expect(
      evaluateCustomTable(texts({ jawStyle: "rounded" }), "metric", BALL).fields?.jawStyle,
    ).toBe("rounded");
    const auto = evaluateCustomTable(texts(), "metric", BALL).fields;
    expect(auto && "jawStyle" in auto).toBe(false);
  });
});

describe("reformatTexts", () => {
  test("changes units without changing the lengths", () => {
    const metric = texts();
    const imperial = reformatTexts(metric, "metric", "imperial");
    expect(imperial.length).toBe("8 ft 4 in");
    const back = evaluateCustomTable(imperial, "imperial", BALL).fields;
    const orig = evaluateCustomTable(metric, "metric", BALL).fields;
    expect(back?.lengthM).toBeCloseTo(orig?.lengthM ?? 0, 5);
  });

  test("leaves unreadable text alone", () => {
    expect(reformatTexts(texts({ width: "wide" }), "metric", "imperial").width).toBe("wide");
  });
});

describe("ballSetForGame", () => {
  test("keeps the current set for the same game, else the game's default", () => {
    const current = { preset: "pool-57@1" };
    expect(ballSetForGame(current, "pool", "pool")).toBe(current);
    expect(ballSetForGame(current, "pool", "snooker")).toEqual({ preset: "snooker-52@1" });
  });
});
