import type { Marking, Spot, TableSpec } from "./types";

/*
 * Coordinates (see types.ts): origin at the baulk/head-end left corner of the playing area,
 * x across the width, y along the length from the baulk end (y = 0) to the top end (y = lengthM).
 * Looking from the baulk end up the table (towards +y) with x increasing to the right:
 * "left" means smaller x and "right" means larger x.
 */

// ---------------------------------------------------------------------------------------------
// Snooker
// ---------------------------------------------------------------------------------------------

/**
 * Full-size snooker playing area length, 11 ft 8.5 in = 3569 mm.
 * Source: WPBSA Rules of Snooker and Billiards, "The Table" (playing area 3569 mm x 1778 mm within
 * the cushion faces), as reproduced at https://www.ebc-billiard.com/rules/snooker (Section 1).
 * Every snooker distance below is stated for this length and scaled by lengthM / this value.
 */
const SNOOKER_FULL_LENGTH_M = 3.569;

/**
 * Baulk line: 29 in (737 mm) from the face of the bottom cushion.
 * Source: WPBSA rules, "The Table"; https://www.ebc-billiard.com/rules/snooker
 */
const SNOOKER_BAULK_LINE_M = 0.737;

/**
 * Radius of the D: 11.5 in (292 mm), centred on the middle of the baulk line, in the baulk.
 * Source: WPBSA rules, "The Table"; https://www.ebc-billiard.com/rules/snooker
 */
const SNOOKER_D_RADIUS_M = 0.292;

/**
 * Black spot: 12.75 in (324 mm) from the face of the top cushion.
 * Source: WPBSA rules, "The Table"; https://www.ebc-billiard.com/rules/snooker (the page shows
 * the fraction garbled; 324 mm = 12.76 in confirms 12 3/4 in).
 */
const SNOOKER_BLACK_FROM_TOP_M = 0.324;

/**
 * Proportional scaling of snooker markings to other table sizes (10 ft, 6 ft, custom) is a
 * project decision (markings scale with lengthM unless a source says otherwise), not a rule
 * from the WPBSA text, which only defines the full-size table.
 */
function snookerScale(table: TableSpec): number {
  return table.playingArea.lengthM / SNOOKER_FULL_LENGTH_M;
}

interface SnookerGeometry {
  centreX: number;
  baulkY: number;
  dRadius: number;
}

function snookerGeometry(table: TableSpec): SnookerGeometry {
  const s = snookerScale(table);
  return {
    centreX: table.playingArea.widthM / 2,
    baulkY: SNOOKER_BAULK_LINE_M * s,
    dRadius: SNOOKER_D_RADIUS_M * s,
  };
}

function snookerSpots(table: TableSpec): Spot[] {
  const { lengthM } = table.playingArea;
  const { centreX, baulkY, dRadius } = snookerGeometry(table);
  const s = snookerScale(table);
  // Blue: the centre of the table (WPBSA: midway between the faces of the top and bottom cushions).
  const blueY = lengthM / 2;
  return [
    { name: "black", x: centreX, y: lengthM - SNOOKER_BLACK_FROM_TOP_M * s },
    // Pink: midway between the blue spot and the face of the top cushion (WPBSA).
    { name: "pink", x: centreX, y: (blueY + lengthM) / 2 },
    { name: "blue", x: centreX, y: blueY },
    // Brown: the middle of the baulk line (WPBSA).
    { name: "brown", x: centreX, y: baulkY },
    // WPBSA: "viewed from the baulk end" yellow is the right-hand corner of the D and green the
    // left-hand corner. Looking from y = 0 towards +y with x increasing to the right, left is
    // smaller x, so green is at centreX - radius and yellow at centreX + radius.
    { name: "green", x: centreX - dRadius, y: baulkY },
    { name: "yellow", x: centreX + dRadius, y: baulkY },
  ];
}

function snookerMarkings(table: TableSpec): Marking[] {
  const { widthM } = table.playingArea;
  const { centreX, baulkY, dRadius } = snookerGeometry(table);
  return [
    { kind: "line", name: "baulk-line", from: { x: 0, y: baulkY }, to: { x: widthM, y: baulkY } },
    {
      kind: "arc",
      name: "d",
      centre: { x: centreX, y: baulkY },
      radiusM: dRadius,
      // Counter-clockwise from pi (towards -x, the green corner) through 3*pi/2 (towards -y, the
      // baulk cushion) to 2*pi (towards +x, the yellow corner): the semicircle on the baulk side.
      startRad: Math.PI,
      endRad: 2 * Math.PI,
    },
    ...snookerSpots(table).map((spot): Marking => ({
      kind: "spot",
      name: spot.name,
      at: { x: spot.x, y: spot.y },
    })),
  ];
}

// ---------------------------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------------------------

/**
 * Head string at 1/4 of the length from the head end, foot string at 1/4 from the foot end
 * (so at 3/4 from the head end).
 * Source: WPA Rules, "Definitions Used in the Rules": "the head string bounding the quarter of
 * the table closest to the head rail", likewise the foot string; head spot, foot spot and centre
 * spot are where those strings (and the centre string) meet the long string down the table's
 * centre. https://cuesight.com/wpa/definitions-used-in-the-rules
 */
const POOL_HEAD_STRING_FRACTION = 1 / 4;
const POOL_FOOT_STRING_FRACTION = 3 / 4;

/**
 * Sights (diamonds) mark 1/8 of the length on the long rails and 1/4 of the width on the short
 * rails, nose to nose.
 * Source: WPA rules definitions ("inlays referred to as diamonds or sights which mark 1/4th of
 * the width and 1/8th of the length"), https://cuesight.com/wpa/definitions-used-in-the-rules ;
 * WPA Tournament Table & Equipment Specifications ("18 sights (or 17 and a name plate)"),
 * https://www.poolroom.com/tournament-table-equipment-specifications/
 */
const POOL_LONG_RAIL_DIVISIONS = 8;
const POOL_SHORT_RAIL_DIVISIONS = 4;

/**
 * How far behind the cushion nose the centre of a pool sight is, on the rail top, metres.
 * UNVERIFIED: 3 11/16 in (tolerance 1/8 in), recalled from the WPA Tournament Table &
 * Equipment Specifications section on sights; the page could not be re-read when this was
 * added (2026-11-14). Bar tables and older tables differ. Nothing in the editor depends on
 * it (sights are drawn at a fixed place on the drawn rail); the photo evaluation uses it to
 * work out true ball positions from labelled sights, and checks it against the pictures.
 */
export const POOL_SIGHT_SETBACK_M = (3 + 11 / 16) * 0.0254;

function poolSpots(table: TableSpec): Spot[] {
  const { lengthM, widthM } = table.playingArea;
  return [
    { name: "head", x: widthM / 2, y: lengthM * POOL_HEAD_STRING_FRACTION },
    { name: "centre", x: widthM / 2, y: lengthM / 2 },
    { name: "foot", x: widthM / 2, y: lengthM * POOL_FOOT_STRING_FRACTION },
  ];
}

function poolSights(table: TableSpec): Marking[] {
  const { lengthM, widthM } = table.playingArea;
  const sights: Marking[] = [];
  // Long rails: divisions 1..7 skipping 4, which is the middle pocket.
  for (const [side, x] of [
    ["left", 0],
    ["right", widthM],
  ] as const) {
    let n = 0;
    for (let k = 1; k < POOL_LONG_RAIL_DIVISIONS; k++) {
      if (k === POOL_LONG_RAIL_DIVISIONS / 2) continue;
      n += 1;
      sights.push({
        kind: "sight",
        name: `sight-${side}-${n}`,
        at: { x, y: (lengthM * k) / POOL_LONG_RAIL_DIVISIONS },
      });
    }
  }
  // Short rails: divisions 1..3 (the ends 0 and 4 are corner pockets).
  for (const [side, y] of [
    ["head", 0],
    ["foot", lengthM],
  ] as const) {
    for (let k = 1; k < POOL_SHORT_RAIL_DIVISIONS; k++) {
      sights.push({
        kind: "sight",
        name: `sight-${side}-${k}`,
        at: { x: (widthM * k) / POOL_SHORT_RAIL_DIVISIONS, y },
      });
    }
  }
  return sights;
}

function poolMarkings(table: TableSpec): Marking[] {
  const { widthM } = table.playingArea;
  const [head, centre, foot] = poolSpots(table) as [Spot, Spot, Spot];
  // No foot string line: it is not marked on real tables.
  return [
    { kind: "line", name: "head-string", from: { x: 0, y: head.y }, to: { x: widthM, y: head.y } },
    { kind: "spot", name: foot.name, at: { x: foot.x, y: foot.y } },
    { kind: "spot", name: head.name, at: { x: head.x, y: head.y } },
    { kind: "spot", name: centre.name, at: { x: centre.x, y: centre.y } },
    ...poolSights(table),
  ];
}

// ---------------------------------------------------------------------------------------------
// Blackball
// ---------------------------------------------------------------------------------------------

/**
 * Baulk line: "a straight line drawn from cushion to cushion at 1/5th of the length of the table
 * from the face of the cushion which lies the greatest distance from the black spot".
 * Source: WPA / EBA blackball rules, quoted via the EBA rules PDF
 * https://eba.leagueapplive.com/pdfs/BB%20Rules.pdf and the WPA blackball rules
 * https://www.blackballaus.com.au/_files/ugd/f24879_97828fa9f54a431f894c479c505c5eb5.pdf
 * (text confirmed through search-engine extracts; the PDFs themselves could not be machine-read).
 * The rules specify no D.
 */
const BLACKBALL_BAULK_FRACTION = 1 / 5;

/** Intersection of the infinite lines through (a1, a2) and (b1, b2). Assumes they are not parallel. */
function intersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): { x: number; y: number } {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / (d1x * d2y - d1y * d2x);
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

/**
 * Black spot: "at the intersection of two imaginary diagonal lines joining centre and corner
 * pockets" (WPA blackball rules; EBA rules, same sources as above). The diagonals meant are those
 * from each centre pocket to the opposite corner pocket at the top (foot) end. With pocket
 * positions taken at the corners and the rail midpoints of the nose rectangle, they are
 * (0, L/2)-(W, L) and (W, L/2)-(0, L), which cross at x = W/2, y = 3L/4: a quarter of the length
 * from the top cushion, independent of the width. Computed here rather than hard-coded.
 */
function blackballBlackSpot(table: TableSpec): { x: number; y: number } {
  const { lengthM, widthM } = table.playingArea;
  return intersect(
    { x: 0, y: lengthM / 2 },
    { x: widthM, y: lengthM },
    { x: widthM, y: lengthM / 2 },
    { x: 0, y: lengthM },
  );
}

function blackballSpots(table: TableSpec): Spot[] {
  const { lengthM, widthM } = table.playingArea;
  const black = blackballBlackSpot(table);
  return [
    { name: "black", x: black.x, y: black.y },
    { name: "baulk", x: widthM / 2, y: lengthM * BLACKBALL_BAULK_FRACTION },
  ];
}

function blackballMarkings(table: TableSpec): Marking[] {
  const { widthM } = table.playingArea;
  const [black, baulk] = blackballSpots(table) as [Spot, Spot];
  return [
    {
      kind: "line",
      name: "baulk-line",
      from: { x: 0, y: baulk.y },
      to: { x: widthM, y: baulk.y },
    },
    { kind: "spot", name: black.name, at: { x: black.x, y: black.y } },
  ];
}

// ---------------------------------------------------------------------------------------------

/** Lines, arcs, spots and sights to draw for a table, derived from its game and size. Task 1.5. */
export function markingsFor(table: TableSpec): Marking[] {
  switch (table.game) {
    case "snooker":
      return snookerMarkings(table);
    case "pool":
      return poolMarkings(table);
    case "blackball":
      return blackballMarkings(table);
  }
}

/** Named spots balls can snap to. Task 1.5. */
export function spotsFor(table: TableSpec): Spot[] {
  switch (table.game) {
    case "snooker":
      return snookerSpots(table);
    case "pool":
      return poolSpots(table);
    case "blackball":
      return blackballSpots(table);
  }
}
