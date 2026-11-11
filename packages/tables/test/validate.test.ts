import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TABLE_DEFAULTS, resolveCustomTable, validateTable } from "../src/validate";
import type { CustomTableFields, PocketSpec, ValidationIssue } from "../src/types";

const snooker: CustomTableFields = {
  game: "snooker",
  lengthM: 3.569,
  widthM: 1.778,
  cornerMouthM: 0.0933,
  middleMouthM: 0.1,
};
const snookerBall = 0.0525;
const pool: CustomTableFields = {
  game: "pool",
  lengthM: 2.54,
  widthM: 1.27,
  cornerMouthM: 0.1175,
  middleMouthM: 0.13,
};
const poolBall = 0.05715;

function find(issues: ValidationIssue[], code: string): ValidationIssue | undefined {
  return issues.find((i) => i.code === code);
}

describe("validateTable", () => {
  it("accepts a 12 ft snooker table and a 9 ft pool table", () => {
    expect(validateTable(snooker, snookerBall).filter((i) => i.severity === "error")).toEqual([]);
    expect(validateTable(pool, poolBall)).toEqual([]);
  });

  it("flags non-finite and non-positive numbers", () => {
    for (const bad of [NaN, Infinity, -1, 0]) {
      const issues = validateTable({ ...snooker, lengthM: bad }, snookerBall);
      const issue = find(issues, "not-a-positive-number");
      expect(issue).toMatchObject({ field: "lengthM", severity: "error" });
      expect(issue?.message).toContain(String(bad));
    }
    expect(find(validateTable(snooker, NaN), "not-a-positive-number")?.field).toBe("ballDiameterM");
    expect(
      find(validateTable({ ...snooker, cornerMouthM: 0 }, snookerBall), "not-a-positive-number")
        ?.field,
    ).toBe("cornerMouthM");
    expect(
      find(validateTable({ ...snooker, middleMouthM: -2 }, snookerBall), "not-a-positive-number")
        ?.field,
    ).toBe("middleMouthM");
    expect(
      find(validateTable({ ...snooker, widthM: NaN }, snookerBall), "not-a-positive-number")?.field,
    ).toBe("widthM");
  });

  it("flags a table that is not longer than it is wide", () => {
    const issue = find(
      validateTable({ ...snooker, lengthM: 1.7, widthM: 1.778 }, snookerBall),
      "length-not-longer-than-width",
    );
    expect(issue).toMatchObject({ field: "lengthM", severity: "error" });
    expect(issue?.message).toContain("1.7 m");
    expect(issue?.message).toContain("1.778 m");
  });

  it("flags a ball diameter outside 45-65 mm", () => {
    for (const d of [0.04, 0.07]) {
      const issue = find(validateTable(snooker, d), "ball-diameter-out-of-range");
      expect(issue).toMatchObject({ field: "ballDiameterM", severity: "error" });
      expect(issue?.message).toContain(`${d * 1000} mm`);
    }
  });

  it("flags length and width outside their ranges", () => {
    const longIssue = find(
      validateTable({ ...snooker, lengthM: 5 }, snookerBall),
      "length-out-of-range",
    );
    expect(longIssue).toMatchObject({ field: "lengthM", severity: "error" });
    expect(longIssue?.message).toContain("5 m");
    const shortIssue = find(
      validateTable({ ...snooker, lengthM: 0.9, widthM: 0.45 }, snookerBall),
      "length-out-of-range",
    );
    expect(shortIssue?.message).toContain("0.9 m");
    const wideIssue = find(
      validateTable({ ...snooker, lengthM: 4.4, widthM: 2.6 }, snookerBall),
      "width-out-of-range",
    );
    expect(wideIssue).toMatchObject({ field: "widthM", severity: "error" });
    expect(wideIssue?.message).toContain("2.6 m");
    const narrowIssue = find(
      validateTable({ ...snooker, lengthM: 1.2, widthM: 0.45 }, snookerBall),
      "width-out-of-range",
    );
    expect(narrowIssue?.message).toContain("0.45 m");
  });

  it("flags pockets narrower than (or equal to) the ball", () => {
    const corner = find(
      validateTable({ ...snooker, cornerMouthM: 0.048 }, snookerBall),
      "corner-pocket-narrower-than-ball",
    );
    expect(corner).toMatchObject({ field: "cornerMouthM", severity: "error" });
    expect(corner?.message).toContain("48 mm");
    expect(corner?.message).toContain("52.5 mm");
    const middle = find(
      validateTable({ ...snooker, middleMouthM: 0.0525 }, snookerBall),
      "middle-pocket-narrower-than-ball",
    );
    expect(middle).toMatchObject({ field: "middleMouthM", severity: "error" });
    expect(middle?.message).toContain("52.5 mm");
  });

  it("flags corner pockets that leave no short cushion", () => {
    // 1.0 m wide: 2 * 0.75 / sqrt(2) = 1.06 m > 1.0 m
    const issue = find(
      validateTable({ ...snooker, lengthM: 3, widthM: 1.0, cornerMouthM: 0.75 }, snookerBall),
      "corner-pockets-leave-no-end-cushion",
    );
    expect(issue).toMatchObject({ field: "cornerMouthM", severity: "error" });
    expect(issue?.message).toContain("750 mm");
    expect(issue?.message).toContain("1 m");
  });

  it("flags pockets that leave no long cushion", () => {
    // 1.2 m long: 2 * 0.2 / sqrt(2) + 0.9 > 1.2 (well, 0.283 + 0.9 = 1.18 < 1.2, so widen the middle)
    const issue = find(
      validateTable(
        { ...snooker, lengthM: 1.2, widthM: 0.6, cornerMouthM: 0.2, middleMouthM: 0.95 },
        snookerBall,
      ),
      "pockets-leave-no-side-cushion",
    );
    expect(issue).toMatchObject({ field: "middleMouthM", severity: "error" });
    expect(issue?.message).toContain("200 mm");
    expect(issue?.message).toContain("950 mm");
    expect(issue?.message).toContain("1.2 m");
  });

  it("warns about tables that are not 2:1", () => {
    const issue = find(
      validateTable({ ...snooker, lengthM: 3.2, widthM: 1.78 }, snookerBall),
      "table-not-two-to-one",
    );
    expect(issue).toMatchObject({ field: "lengthM", severity: "warning" });
    expect(issue?.message).toContain("3.2 m");
    expect(issue?.message).toContain("1.78 m");
    // 4.9 % off is fine, 2:1 exactly is fine
    expect(
      find(
        validateTable({ ...snooker, lengthM: 2.09 * 1.0, widthM: 1.0 }, snookerBall),
        "table-not-two-to-one",
      ),
    ).toBeUndefined();
  });

  it("warns about very tight and very generous pockets", () => {
    const tightC = find(
      validateTable({ ...snooker, cornerMouthM: 0.06 }, snookerBall),
      "corner-pocket-very-tight",
    );
    expect(tightC).toMatchObject({ field: "cornerMouthM", severity: "warning" });
    expect(tightC?.message).toContain("60 mm");
    expect(tightC?.message).toContain("very tight pockets");
    const tightM = find(
      validateTable({ ...snooker, middleMouthM: 0.06 }, snookerBall),
      "middle-pocket-very-tight",
    );
    expect(tightM).toMatchObject({ field: "middleMouthM", severity: "warning" });
    const wideC = find(
      validateTable({ ...snooker, cornerMouthM: 0.15 }, snookerBall),
      "corner-pocket-very-generous",
    );
    expect(wideC).toMatchObject({ field: "cornerMouthM", severity: "warning" });
    expect(wideC?.message).toContain("150 mm");
    expect(wideC?.message).toContain("very generous pockets");
    const wideM = find(
      validateTable({ ...snooker, middleMouthM: 0.15 }, snookerBall),
      "middle-pocket-very-generous",
    );
    expect(wideM).toMatchObject({ field: "middleMouthM", severity: "warning" });
  });

  it("is deterministic, never throws on junk and keeps a stable order", () => {
    const junk = {
      game: "pool",
      lengthM: NaN,
      widthM: -1,
      cornerMouthM: Infinity,
      middleMouthM: 0,
    } as CustomTableFields;
    const a = validateTable(junk, NaN);
    expect(a).toEqual(validateTable(junk, NaN));
    expect(a.map((i) => i.field)).toEqual([
      "lengthM",
      "widthM",
      "cornerMouthM",
      "middleMouthM",
      "ballDiameterM",
    ]);
    for (const issue of a) expect(issue.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("uses no jargon in messages", () => {
    const all = [
      ...validateTable(
        { ...snooker, lengthM: 3.2, widthM: 1.78, cornerMouthM: 0.06, middleMouthM: 0.15 },
        snookerBall,
      ),
      ...validateTable({ ...snooker, cornerMouthM: 0.048 }, snookerBall),
    ];
    for (const i of all) expect(i.message).not.toMatch(/aspect|nose|knuckle|jaw/i);
  });
});

describe("resolveCustomTable", () => {
  it("throws listing the messages on an invalid table", () => {
    expect(() => resolveCustomTable({ ...snooker, cornerMouthM: 0.048 }, snookerBall)).toThrow(
      /48 mm/,
    );
    expect(() => resolveCustomTable({ ...snooker, lengthM: NaN }, snookerBall)).toThrow();
  });

  it("resolves a snooker table with rounded jaws by default", () => {
    const t = resolveCustomTable(snooker, snookerBall);
    expect(t.id).toBe("custom");
    expect(t.name).toBe("Custom snooker table 3.57 x 1.78 m");
    expect(t.game).toBe("snooker");
    expect(t.playingArea).toEqual({ lengthM: 3.569, widthM: 1.778 });
    expect(t.defaultBallSetId).toBe("snooker-52@1");
    expect(t.pockets.corner.jawRadiusM).toBeCloseTo(snookerBall, 12);
    expect(t.pockets.corner.mouthM).toBe(0.0933);
    expect(t.cushion.noseHeightM).toBeCloseTo(0.635 * snookerBall, 12);
  });

  it("resolves a pool table with WPA angled jaws by default", () => {
    const t = resolveCustomTable(pool, poolBall);
    expect(t.defaultBallSetId).toBe("pool-57@1");
    expect(t.pockets.corner.facingAngleRad).toBeCloseTo((142 * Math.PI) / 180, 12);
    expect(t.pockets.middle.facingAngleRad).toBeCloseTo((104 * Math.PI) / 180, 12);
    expect(t.pockets.corner.jawRadiusM).toBeLessThan(0.005);
    expect(t.cushion.noseHeightM).toBeCloseTo(0.635 * poolBall, 12);
  });

  it("honours an explicit jaw style and maps blackball", () => {
    const rounded = resolveCustomTable({ ...pool, jawStyle: "rounded" }, poolBall);
    expect(rounded.pockets.corner.jawRadiusM).toBeCloseTo(poolBall, 12);
    const angled = resolveCustomTable({ ...snooker, jawStyle: "angled" }, snookerBall);
    expect(angled.pockets.middle.facingAngleRad).toBeCloseTo((104 * Math.PI) / 180, 12);
    const bb = resolveCustomTable({ ...pool, game: "blackball" }, 0.0508);
    expect(bb.defaultBallSetId).toBe("blackball-51@1");
    expect(bb.pockets.corner.jawRadiusM).toBeCloseTo(0.0508, 12);
  });

  const validFields = fc
    .record({
      game: fc.constantFrom("snooker", "pool", "blackball"),
      lengthM: fc.double({ min: 1.0, max: 4.5, noNaN: true }),
      widthM: fc.double({ min: 0.5, max: 2.5, noNaN: true }),
      cornerFactor: fc.double({ min: 1.01, max: 3, noNaN: true }),
      middleFactor: fc.double({ min: 1.01, max: 3, noNaN: true }),
      jawStyle: fc.option(fc.constantFrom("angled", "rounded"), { nil: undefined }),
      ball: fc.double({ min: 0.045, max: 0.065, noNaN: true }),
    })
    .map(({ cornerFactor, middleFactor, ...f }) => ({
      ...f,
      cornerMouthM: cornerFactor * f.ball,
      middleMouthM: middleFactor * f.ball,
    }))
    .filter((f) =>
      validateTable(f as CustomTableFields, f.ball).every((i) => i.severity !== "error"),
    );

  function checkDrop(pocket: PocketSpec, kind: "corner" | "middle", ball: number): void {
    const m = pocket.mouthM;
    const r = ball / 2;
    // (a) jaw facings can reach the circle
    expect(pocket.dropRadiusM).toBeGreaterThanOrEqual((m / 2) * 0.9);
    // (b) positive setback, circle reaches only slightly past the mouth line
    expect(pocket.dropSetbackM).toBeGreaterThan(0);
    expect(pocket.dropRadiusM - pocket.dropSetbackM).toBeLessThanOrEqual(0.2 * ball);
    // (c) a ball resting on a rail at least one mouth from the nearest jaw point is outside
    if (kind === "corner") {
      // Corner at origin, rail along +x. Mouth line midpoint is m/2 along the inward
      // diagonal; the circle centre is setback beyond it, away from the table.
      const t = (m / 2 - pocket.dropSetbackM) / Math.SQRT2;
      const jawX = m * Math.SQRT1_2;
      const bx = jawX + m;
      const by = r;
      expect(Math.hypot(bx - t, by - t)).toBeGreaterThan(pocket.dropRadiusM);
    } else {
      // Middle pocket on the rail x = 0 at y = 0; circle centre at x = -setback.
      const bx = r;
      const by = m / 2 + m;
      expect(Math.hypot(bx + pocket.dropSetbackM, by)).toBeGreaterThan(pocket.dropRadiusM);
    }
  }

  function allFinite(value: unknown): boolean {
    if (typeof value === "number") return Number.isFinite(value);
    if (value && typeof value === "object") return Object.values(value).every(allFinite);
    return true;
  }

  it("property: derived values are finite, satisfy the drop-circle constraints and are repeatable", () => {
    fc.assert(
      fc.property(validFields, ({ ball, ...rest }) => {
        const fields = rest as CustomTableFields;
        const a = resolveCustomTable(fields, ball);
        expect(allFinite(a)).toBe(true);
        expect(a).toEqual(resolveCustomTable(fields, ball));
        checkDrop(a.pockets.corner, "corner", ball);
        checkDrop(a.pockets.middle, "middle", ball);
        expect(a.cushion.noseHeightM).toBeGreaterThan(0);
        expect(a.cushion.restitution).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it("drop constraints also hold on the two reference tables", () => {
    for (const [f, b] of [
      [snooker, snookerBall],
      [pool, poolBall],
    ] as const) {
      const t = resolveCustomTable(f, b);
      checkDrop(t.pockets.corner, "corner", b);
      checkDrop(t.pockets.middle, "middle", b);
    }
  });

  it("exposes readonly derivation constants", () => {
    expect(TABLE_DEFAULTS.defaultBallSetId.snooker).toBe("snooker-52@1");
  });
});
