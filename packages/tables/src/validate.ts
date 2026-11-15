import type {
  CustomTableFields,
  GameType,
  JawStyle,
  PocketSpec,
  TableSpec,
  ValidationIssue,
} from "./types";

/**
 * Derivation constants for custom tables. Every number carries its source. Items marked
 * UNVERIFIED are modelling choices for which no published figure was found; they are listed
 * in the task report and should be revisited when better data turns up.
 */
/**
 * Distance from the cushion nose back to where the cloth-covered cushion meets the top of
 * the wooden rail, seen from above, metres. The photo import needs it: in a photo the area of
 * cloth colour ends at the rail, not at the nose, and the playing area is this much inside.
 * The WPA Recommended Equipment Specifications (section 7) give the cloth-covered cushion
 * as 1 7/8 to 2 in (4.8 to 5.1 cm) wide "measured from the outer edge of the featherstrip
 * to the nose of the cushion"
 * (https://wpapool.com/wp-content/uploads/2024/01/RECOMMENDED-EQUIPMENT-SPECIFICATIONS.pdf,
 * read 2026-11-15). The value here is larger because it is what a camera sees: the outline
 * of the cloth is taken to lie at nose height, while the cushion top rises towards the rail.
 * Measured, not from a drawing: 6 cm is the middle value found on 157 pictures of the
 * public pix2pockets set (2026-11-14; a tenth of them below 5.5 cm, a tenth above 8.5 cm),
 * where the true place of the cushion noses was worked out from the table's sights. That
 * truth rests on `POOL_SIGHT_SETBACK_M`, which is itself unverified, and nearly all of those
 * tables are tournament pool tables: snooker cushions and bar tables may differ by a
 * centimetre or more. The corners can always be placed by hand.
 */
export const CUSHION_TOP_DEPTH_M = 0.06;

export const TABLE_DEFAULTS = {
  /**
   * Accepted ball diameter range, metres. This is a Baize design bound, not a published
   * rule: it comfortably contains snooker 52.5 mm (WPBSA Rules of Snooker and Billiards,
   * https://ebsa.tv/wp-content/uploads/2019/09/WPBSA-Rules-of-Snooker-and-Billiards-2019-August.pdf),
   * blackball 2 in = 50.8 mm and WPA pool 2 1/4 in = 57.15 mm
   * (https://www.poolroom.com/tournament-table-equipment-specifications/).
   */
  ballDiameterRangeM: { min: 0.045, max: 0.065 },
  /** Accepted playing-area length, metres. Design bound: 1.0 m (small bar/kids table) to 4.5 m (12 ft snooker is 3.569 m, WPBSA rulebook above). */
  lengthRangeM: { min: 1.0, max: 4.5 },
  /** Accepted playing-area width, metres. Design bound: 0.5 m to 2.5 m (12 ft snooker is 1.778 m, WPBSA rulebook above). */
  widthRangeM: { min: 0.5, max: 2.5 },
  /**
   * Table length / width is 2:1 on every regulation table (WPA 9 ft 2.54 x 1.27 m,
   * https://www.poolroom.com/tournament-table-equipment-specifications/; WPBSA 12 ft snooker
   * 3.569 x 1.778 m = 2.007:1, rulebook above). Warn beyond 5 % (design tolerance).
   */
  aspectRatio: 2,
  aspectRatioTolerance: 0.05,
  /**
   * Mouth width, in ball diameters, outside which we warn. Design thresholds. For reference
   * the WPA corner mouth is 4.5-4.625 in (1.96-2.06 balls of 2.25 in) and the side mouth
   * 5-5.125 in (2.22-2.28 balls), from the poolroom.com WPA page above; snooker corner
   * mouths are about 1.8 balls (WPBSA pocket templates; not independently verified).
   */
  tightMouthBalls: 1.4,
  generousMouthBalls: 2.6,
  /**
   * Shortest piece of straight cushion that must remain between two pockets, in ball
   * diameters. Design choice: with less than one ball of straight rail the table is not
   * playable and the pocket jaws would nearly meet.
   */
  minStraightRailBalls: 1,

  /** Jaw knuckle radius for the 'angled' (pool) style, metres. UNVERIFIED: the WPA specification gives no pocket-point radius (checked poolroom.com page, only facing thickness 1/16-1/4 in); 2 mm is a typical sharp-but-not-zero rounding. */
  angledJawRadiusM: 0.002,
  /**
   * Facing angles for the 'angled' style: WPA cut angles 142 degrees (+/-1) corner, 104
   * degrees (+/-1) side, "cut angles of the rubber cushion and its wood backing"
   * (https://www.poolroom.com/tournament-table-equipment-specifications/). Converted to
   * radians as degrees * PI / 180. Assumes the WPA angle is measured from the rail line
   * inside the cushion, matching PocketSpec.facingAngleRad.
   */
  angledFacingAngleRad: {
    corner: (142 * Math.PI) / 180,
    middle: (104 * Math.PI) / 180,
  },
  /**
   * Jaw knuckle radius for the 'rounded' (snooker-style) style, as a multiple of ball
   * diameter. UNVERIFIED approximation: WPBSA defines pocket openings by proprietary
   * templates (see https://forums.azbilliards.com/threads/what-size-are-the-pockets-and-balls-on.268994/)
   * and publishes no radius. One ball diameter gives the visibly round snooker jaws. The
   * radius is also never more than half the mouth: a jaw curve deeper than half the opening
   * would put the end of the curve behind the pocket drop.
   */
  roundedJawRadiusBalls: 1.0,
  /** Facing angles after the curve for 'rounded'. UNVERIFIED geometry: facings run parallel to the pocket axis, i.e. 135 degrees (3 PI / 4) from the rail for a corner on the 45 degree diagonal and 90 degrees (PI / 2) for a middle pocket whose axis is square to the rail. */
  roundedFacingAngleRad: {
    corner: (3 * Math.PI) / 4,
    middle: Math.PI / 2,
  },
  /**
   * Drop circle (slate cut) model. UNVERIFIED: no published geometry. The radius is half the
   * mouth plus `dropReachBalls` ball diameters. The centre is on the pocket axis, measured
   * out from the pocket origin: on the corner of the nose rectangle for a corner pocket
   * (setback 0), and half a mouth behind the nose line for a middle pocket. Either way the
   * circle reaches `dropReachBalls` ball diameters (about 8 mm) into the table past the
   * line across the mouth, and for mouth >= ball diameter it never contains a jaw point.
   */
  dropReachBalls: 0.15,

  /** Cushion nose height as a fraction of ball diameter: WPA 63.5 % (+1 %), range 62.5-64.5 % (https://www.poolroom.com/tournament-table-equipment-specifications/; Dr. Dave, https://drdavepoolinfo.com/FAQ/table/cushion-nose-height/). */
  noseHeightBalls: { pool: 0.635, snooker: 0.635, blackball: 0.635 } satisfies Record<
    GameType,
    number
  >,
  /** UNVERIFIED for snooker and blackball: no WPBSA figure found; the WPA value is reused. */
  /** Ball-cushion normal restitution: pooltool default e_c = 0.85 (Apache-2.0, https://pooltool.readthedocs.io/en/latest/_modules/pooltool/objects/ball/params.html). Mathavan et al. 2010 (Proc. IMechE Part C) report about 0.98 for slow rigid-cushion impacts; the lower figure is the effective value for typical speeds. */
  cushionRestitution: 0.85,
  /** Ball-cushion sliding friction: pooltool default f_c = 0.2 (same source); Mathavan et al. 2010 report about 0.14. */
  cushionFriction: 0.2,

  /** Default ball sets by game; ids defined by the ball-set presets. */
  defaultBallSetId: {
    snooker: "snooker-52@1",
    pool: "pool-57@1",
    blackball: "blackball-51@1",
  } satisfies Record<GameType, string>,
} as const;

const MM = 1000;

/** Millimetres with at most one decimal and no trailing zero: 0.0525 -> "52.5 mm". */
function mm(valueM: number): string {
  return `${String(Math.round(valueM * MM * 10) / 10)} mm`;
}

/** Metres with at most three decimals: 3.569 -> "3.569 m". */
function metres(valueM: number): string {
  return `${String(Math.round(valueM * 1000) / 1000)} m`;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

type Issue = ValidationIssue;

function defaultJawStyle(game: GameType): JawStyle {
  return game === "pool" ? "angled" : "rounded";
}

/** Jaw knuckle radius and facing angle that a jaw style gives a pocket. */
function jawShape(
  kind: "corner" | "middle",
  style: JawStyle,
  ballDiameterM: number,
  mouthM: number,
): { jawRadiusM: number; facingAngleRad: number } {
  const D = TABLE_DEFAULTS;
  return style === "angled"
    ? { jawRadiusM: D.angledJawRadiusM, facingAngleRad: D.angledFacingAngleRad[kind] }
    : {
        jawRadiusM: Math.min(D.roundedJawRadiusBalls * ballDiameterM, mouthM / 2),
        facingAngleRad: D.roundedFacingAngleRad[kind],
      };
}

/**
 * How far along a rail, from the pocket origin, the straight cushion nose is cut back.
 *
 * `mouthM` is the opening where the jaw facings begin, after the knuckle arc of radius rho that
 * turns through theta = pi - facing angle. Working back from the facing start to the jaw point:
 *   corner:  mouth / sqrt(2) + rho (sin theta + cos theta - 1)
 *   middle:  mouth / 2 + rho sin theta
 * (ARCHITECTURE.md section 6; the physics geometry uses the same construction.)
 */
export function pocketCutBackM(
  kind: "corner" | "middle",
  mouthM: number,
  jawRadiusM: number,
  facingAngleRad: number,
): number {
  const theta = Math.PI - facingAngleRad;
  return kind === "corner"
    ? mouthM * Math.SQRT1_2 + jawRadiusM * (Math.sin(theta) + Math.cos(theta) - 1)
    : mouthM / 2 + jawRadiusM * Math.sin(theta);
}

/**
 * Checks custom table fields against sane ranges. Errors block the table from being used;
 * warnings do not. Pure, deterministic, never throws; issues come in a fixed order.
 */
export function validateTable(fields: CustomTableFields, ballDiameterM: number): ValidationIssue[] {
  const issues: Issue[] = [];
  const D = TABLE_DEFAULTS;

  const numeric: { field: Issue["field"]; value: unknown; label: string }[] = [
    { field: "lengthM", value: fields.lengthM, label: "table length" },
    { field: "widthM", value: fields.widthM, label: "table width" },
    { field: "cornerMouthM", value: fields.cornerMouthM, label: "corner pocket opening" },
    { field: "middleMouthM", value: fields.middleMouthM, label: "middle pocket opening" },
    { field: "ballDiameterM", value: ballDiameterM, label: "ball size" },
  ];
  const ok = new Set<Issue["field"]>();
  for (const n of numeric) {
    if (isPositiveNumber(n.value)) {
      ok.add(n.field);
    } else {
      issues.push({
        field: n.field,
        severity: "error",
        code: "not-a-positive-number",
        message: `The ${n.label} must be a number greater than zero (got ${String(n.value)}).`,
      });
    }
  }

  const { lengthM, widthM, cornerMouthM, middleMouthM } = fields;
  const hasLength = ok.has("lengthM");
  const hasWidth = ok.has("widthM");
  const hasCorner = ok.has("cornerMouthM");
  const hasMiddle = ok.has("middleMouthM");
  const hasBall = ok.has("ballDiameterM");

  if (hasLength && hasWidth && lengthM <= widthM) {
    issues.push({
      field: "lengthM",
      severity: "error",
      code: "length-not-longer-than-width",
      message: `The table length (${metres(lengthM)}) must be longer than its width (${metres(widthM)}). Swap the two numbers if you entered them the wrong way round.`,
    });
  }

  if (
    hasBall &&
    (ballDiameterM < D.ballDiameterRangeM.min || ballDiameterM > D.ballDiameterRangeM.max)
  ) {
    issues.push({
      field: "ballDiameterM",
      severity: "error",
      code: "ball-diameter-out-of-range",
      message: `The ball size (${mm(ballDiameterM)}) is outside the supported range of ${mm(D.ballDiameterRangeM.min)} to ${mm(D.ballDiameterRangeM.max)}.`,
    });
  }

  if (hasLength && (lengthM < D.lengthRangeM.min || lengthM > D.lengthRangeM.max)) {
    issues.push({
      field: "lengthM",
      severity: "error",
      code: "length-out-of-range",
      message: `The table length (${metres(lengthM)}) is outside the supported range of ${metres(D.lengthRangeM.min)} to ${metres(D.lengthRangeM.max)}.`,
    });
  }
  if (hasWidth && (widthM < D.widthRangeM.min || widthM > D.widthRangeM.max)) {
    issues.push({
      field: "widthM",
      severity: "error",
      code: "width-out-of-range",
      message: `The table width (${metres(widthM)}) is outside the supported range of ${metres(D.widthRangeM.min)} to ${metres(D.widthRangeM.max)}.`,
    });
  }

  if (hasCorner && hasBall && cornerMouthM <= ballDiameterM) {
    issues.push({
      field: "cornerMouthM",
      severity: "error",
      code: "corner-pocket-narrower-than-ball",
      message: `The corner pockets (${mm(cornerMouthM)}) are narrower than the ball (${mm(ballDiameterM)}), so no ball could be potted. Make the corner pockets wider or the balls smaller.`,
    });
  }
  if (hasMiddle && hasBall && middleMouthM <= ballDiameterM) {
    issues.push({
      field: "middleMouthM",
      severity: "error",
      code: "middle-pocket-narrower-than-ball",
      message: `The middle pockets (${mm(middleMouthM)}) are narrower than the ball (${mm(ballDiameterM)}), so no ball could be potted. Make the middle pockets wider or the balls smaller.`,
    });
  }

  // Straight cushion left between pockets, using the jaw shape this table will be given.
  const style = fields.jawStyle ?? defaultJawStyle(fields.game);
  const shapeBall = hasBall ? ballDiameterM : 0;
  const cornerShape = jawShape("corner", style, shapeBall, hasCorner ? cornerMouthM : 0);
  const middleShape = jawShape("middle", style, shapeBall, hasMiddle ? middleMouthM : 0);
  const cornerCut = hasCorner
    ? pocketCutBackM("corner", cornerMouthM, cornerShape.jawRadiusM, cornerShape.facingAngleRad)
    : 0;
  const middleCut = hasMiddle
    ? pocketCutBackM("middle", middleMouthM, middleShape.jawRadiusM, middleShape.facingAngleRad)
    : 0;
  const minRail = D.minStraightRailBalls * shapeBall;

  if (hasCorner && hasWidth && widthM - 2 * cornerCut < minRail) {
    issues.push({
      field: "cornerMouthM",
      severity: "error",
      code: "corner-pockets-leave-no-end-cushion",
      message: `The corner pockets (${mm(cornerMouthM)}) are so wide that almost nothing is left of the short cushions on a ${metres(widthM)} wide table. Make the corner pockets narrower.`,
    });
  }
  if (hasCorner && hasMiddle && hasLength && lengthM / 2 - cornerCut - middleCut < minRail) {
    issues.push({
      field: "middleMouthM",
      severity: "error",
      code: "pockets-leave-no-side-cushion",
      message: `The corner pockets (${mm(cornerMouthM)}) and middle pockets (${mm(middleMouthM)}) are so wide that almost nothing is left of the long cushions on a ${metres(lengthM)} long table. Make the pockets narrower.`,
    });
  }

  if (hasLength && hasWidth && lengthM > widthM) {
    const ratio = lengthM / widthM;
    if (Math.abs(ratio - D.aspectRatio) / D.aspectRatio > D.aspectRatioTolerance) {
      issues.push({
        field: "lengthM",
        severity: "warning",
        code: "table-not-two-to-one",
        message: `The table is ${metres(lengthM)} by ${metres(widthM)}. Real tables are twice as long as they are wide, so shots may not behave as on a standard table.`,
      });
    }
  }

  if (hasBall) {
    const pockets: [Issue["field"], boolean, number, string, string][] = [
      ["cornerMouthM", hasCorner, cornerMouthM, "corner", "corner"],
      ["middleMouthM", hasMiddle, middleMouthM, "middle", "middle"],
    ];
    for (const [field, present, mouth, label, codePrefix] of pockets) {
      if (!present || mouth <= ballDiameterM) continue;
      if (mouth < D.tightMouthBalls * ballDiameterM) {
        issues.push({
          field,
          severity: "warning",
          code: `${codePrefix}-pocket-very-tight`,
          message: `The ${label} pockets (${mm(mouth)}) are very tight pockets for a ${mm(ballDiameterM)} ball. Only well-aimed shots will drop.`,
        });
      } else if (mouth > D.generousMouthBalls * ballDiameterM) {
        issues.push({
          field,
          severity: "warning",
          code: `${codePrefix}-pocket-very-generous`,
          message: `The ${label} pockets (${mm(mouth)}) are very generous pockets for a ${mm(ballDiameterM)} ball. Almost anything near the pocket will drop.`,
        });
      }
    }
  }

  return issues;
}

function buildPocket(
  kind: "corner" | "middle",
  mouthM: number,
  ballDiameterM: number,
  style: JawStyle,
): PocketSpec {
  const D = TABLE_DEFAULTS;
  const shape = jawShape(kind, style, ballDiameterM, mouthM);
  return {
    mouthM,
    jawRadiusM: shape.jawRadiusM,
    facingAngleRad: shape.facingAngleRad,
    dropRadiusM: mouthM / 2 + D.dropReachBalls * ballDiameterM,
    // Measured from the pocket origin: the corner itself, or half a mouth behind the nose line.
    dropSetbackM: kind === "corner" ? 0 : mouthM / 2,
  };
}

export interface DropCircle {
  id: "corner-bl" | "corner-br" | "corner-tl" | "corner-tr" | "middle-l" | "middle-r";
  x: number;
  y: number;
  radiusM: number;
}

/**
 * The six drop circles of a table: a ball whose centre is inside one is potted. Each centre
 * is `dropSetbackM` out from the pocket origin along the pocket axis (the outward diagonal
 * for a corner, square to the rail for a middle pocket).
 */
export function pocketDropCircles(table: TableSpec): DropCircle[] {
  const W = table.playingArea.widthM;
  const L = table.playingArea.lengthM;
  const c = table.pockets.corner;
  const m = table.pockets.middle;
  const d = c.dropSetbackM * Math.SQRT1_2;
  return [
    { id: "corner-bl", x: -d, y: -d, radiusM: c.dropRadiusM },
    { id: "corner-br", x: W + d, y: -d, radiusM: c.dropRadiusM },
    { id: "corner-tl", x: -d, y: L + d, radiusM: c.dropRadiusM },
    { id: "corner-tr", x: W + d, y: L + d, radiusM: c.dropRadiusM },
    { id: "middle-l", x: -m.dropSetbackM, y: L / 2, radiusM: m.dropRadiusM },
    { id: "middle-r", x: W + m.dropSetbackM, y: L / 2, radiusM: m.dropRadiusM },
  ];
}

/**
 * Turns custom fields into a full TableSpec by filling in derived defaults (jaw radius and
 * facing angle from the jaw style, drop circle, cushion nose height, restitution, friction).
 * Throws if `validateTable` reports an error.
 */
export function resolveCustomTable(fields: CustomTableFields, ballDiameterM: number): TableSpec {
  const errors = validateTable(fields, ballDiameterM).filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Invalid custom table: ${errors.map((e) => e.message).join(" ")}`);
  }
  const D = TABLE_DEFAULTS;
  const style = fields.jawStyle ?? defaultJawStyle(fields.game);
  return {
    id: "custom",
    name: `Custom ${fields.game} table ${String(Math.round(fields.lengthM * 100) / 100)} x ${String(Math.round(fields.widthM * 100) / 100)} m`,
    game: fields.game,
    playingArea: { lengthM: fields.lengthM, widthM: fields.widthM },
    pockets: {
      corner: buildPocket("corner", fields.cornerMouthM, ballDiameterM, style),
      middle: buildPocket("middle", fields.middleMouthM, ballDiameterM, style),
    },
    cushion: {
      noseHeightM: D.noseHeightBalls[fields.game] * ballDiameterM,
      restitution: D.cushionRestitution,
      friction: D.cushionFriction,
    },
    defaultBallSetId: D.defaultBallSetId[fields.game],
  };
}
