import { ballSizeOf, noseContactDistanceM } from "./layout";
import { spotsFor } from "./markings";
import { pocketDropCircles } from "./validate";
import type {
  BallKind,
  BallSetSpec,
  DrillTemplate,
  GameType,
  Layout,
  LayoutBall,
  PoolNumber,
  TableSpec,
} from "./types";

/*
 * Practice drills. Task 4.3. Coordinates as in types.ts: x across the width (0..W), y from the
 * baulk/head end (0) to the top/foot end (L). Every position is derived from the table's spots,
 * its length and width, and the ball diameter; no absolute table dimension appears here.
 *
 * SOURCES. These are the common forms of well-known practice drills (a line of reds up the
 * centre line, a T of reds, an L of balls by a corner, a wagon wheel, a line across the table).
 * No rule book or coaching text was consulted for exact geometry, so every spacing below is this
 * project's own design choice and is labelled as such.
 */

/** Clearance (metres) a drill keeps between balls beyond touching. Spec for task 4.3: 1 mm. */
const MIN_GAP_M = 0.001;

/** Tolerance (metres) for floating-point error when checking a layout. Design tolerance. */
const FIT_TOL_M = 1e-9;

/** Reds placed in each gap between the spots on the snooker centre line. Design choice: 3 keeps even the smallest gap (pink to black on a 6 ft table) well clear of the balls on its spots. */
const SNOOKER_REDS_PER_GAP = 3;

/** Spacing between the balls of a cross line or ring, in ball diameters. Design choice: 2 leaves a one-ball gap between neighbours. */
const CROSS_SPACING_D = 2;

/** Distance of the snooker cue ball from the blue, across the table, in ball diameters. Design choice: 2.5 is near the blue yet clear of the reds on the centre line. */
const CUE_BESIDE_BLUE_D = 2.5;

/** Distance of the cue ball below the pink in the T drill, in ball diameters. Design choice. */
const CUE_BELOW_PINK_D = 3;

/** Fraction of the way from the cue ball to the top-left corner at which the long-pot red sits. Design choice: 0.8 makes a long straight pot with the red between the pink and black spots on a full table. */
const LONG_POT_RED_FRACTION = 0.8;

/**
 * Cut of the black-from-spot shot: lateral offset between the cue ball's line and the black's
 * centre, as a fraction of a ball diameter. A three-quarter-ball hit overlaps the balls by 3/4 of
 * a diameter, so the centres are 1/4 of a diameter apart across the line of travel (geometry).
 */
const THREE_QUARTER_OFFSET = 1 / 4;

/** Distance of the cue ball from the ghost ball in the black-from-spot drill, as a fraction of the table width. Design choice: keeps the cue ball on the table for any width. */
const BLACK_CUE_DISTANCE_WIDTH = 1 / 5;

/** Offsets (in ball diameters, across and along the table) of the reds around the black. Design choice: behind and beside the black, clear of the shot and the pot line. */
const BLACK_RED_OFFSETS_D: readonly (readonly [number, number])[] = [
  [-4, -3],
  [0, -5],
  [4, -6],
];

/** Balls in the pool ladder, and the first and later distances from the cue ball in diameters. Design choice: 5 balls, first 4 diameters out, then every 3, so there is a clear ball between each. */
const LADDER_BALLS = 5;
const LADDER_FIRST_D = 4;
const LADDER_STEP_D = 3;

/** L drill: distance of the corner ball from both cushions, and spacing along the arms, in ball diameters. Design choice. */
const L_OFFSET_D = 3;
const L_SPACING_D = 2.5;
/** Balls added along each arm of the L, besides the corner ball. Design choice. */
const L_ARM_BALLS = 2;

/** Wagon wheel: ring radius and the object ball's and cue ball's distances from the side rail, in ball diameters. Design choice. */
const WHEEL_RADIUS_D = 2.5;
const WHEEL_OBJECT_D = 3;
const WHEEL_CUE_D = WHEEL_OBJECT_D + 2.5;

/** Balls in a line across the table. Design choice: 7, a full set of solids for pool and the whole of one team for blackball. */
const ACROSS_BALLS = 7;

const SQRT3_2 = Math.sqrt(3) / 2;

export const DRILL_TEMPLATES: readonly DrillTemplate[] = [
  {
    id: "snooker-line-up",
    name: "Line-up",
    game: "snooker",
    description:
      "Pot the reds one at a time up the centre line, taking each colour in turn. Play position on the next red every time.",
  },
  {
    id: "snooker-t-line-up",
    name: "T line-up",
    game: "snooker",
    description:
      "A line of reds up from the pink and a cross line of reds through the pink area. Clear them without moving the pink or the black.",
  },
  {
    id: "snooker-long-pot",
    name: "Long pot",
    game: "snooker",
    description:
      "A single red far up the table towards the top-left corner pocket. Pot it from the D, again and again.",
  },
  {
    id: "snooker-black-from-spot",
    name: "Black from the spot",
    game: "snooker",
    description:
      "Pot the black into the top-left corner with a three-quarter-ball hit, then play position on a red.",
  },
  {
    id: "pool-stop-shot-ladder",
    name: "Stop-shot ladder",
    game: "pool",
    description:
      "Five balls in a line towards the top-left corner pocket. Pot each one straight in and stop the cue ball dead.",
  },
  {
    id: "pool-l-drill",
    name: "L drill",
    game: "pool",
    description:
      "Balls in an L along the foot rail and the side rail near a corner pocket. Pot them all, leaving the cue ball in the middle.",
  },
  {
    id: "pool-wagon-wheel",
    name: "Wagon wheel",
    game: "pool",
    description:
      "Pot the ball by the side pocket, then bring the cue ball around the ring of balls at the centre spot.",
  },
  {
    id: "pool-line-across",
    name: "Line across",
    game: "pool",
    description:
      "Seven balls in a line across the table. Pot them in order, getting position on the next ball each time.",
  },
  {
    id: "blackball-line-across",
    name: "Line across",
    game: "blackball",
    description:
      "Seven red and yellow balls in a line across the table. Pot them in order, getting position on the next ball each time.",
  },
];

/** Drills for a game, in a fixed order. */
export function drillsFor(game: GameType): DrillTemplate[] {
  return DRILL_TEMPLATES.filter((d) => d.game === game);
}

interface Pos {
  x: number;
  y: number;
}

function spot(table: TableSpec, name: string): Pos {
  const s = spotsFor(table).find((p) => p.name === name);
  if (!s) throw new Error(`Table has no spot named '${name}'`);
  return { x: s.x, y: s.y };
}

function poolNumber(n: number): PoolNumber {
  return String(n) as PoolNumber;
}

function at(kind: BallKind, x: number, y: number): LayoutBall {
  return { kind, x, y };
}

/** Straight line between two points: the point `i / n` of the way from a to b. */
function between(a: Pos, b: Pos, i: number, n: number): Pos {
  return { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
}

function snookerColours(table: TableSpec): LayoutBall[] {
  const kinds = ["yellow", "green", "brown", "blue", "pink", "black"] as const;
  return kinds.map((kind) => {
    const p = spot(table, kind);
    return at(kind, p.x, p.y);
  });
}

function snookerLineUp(table: TableSpec, ballSet: BallSetSpec): LayoutBall[] {
  const d = ballSet.object.diameterM;
  const brown = spot(table, "brown");
  const blue = spot(table, "blue");
  const pink = spot(table, "pink");
  const black = spot(table, "black");
  const balls = snookerColours(table);
  // Reds evenly between each pair of neighbouring spots, on the centre line.
  const gaps: [Pos, Pos][] = [
    [brown, blue],
    [blue, pink],
    [pink, black],
  ];
  for (const [a, b] of gaps) {
    for (let i = 1; i <= SNOOKER_REDS_PER_GAP; i++) {
      const p = between(a, b, i, SNOOKER_REDS_PER_GAP + 1);
      balls.push(at("red", p.x, p.y));
    }
  }
  balls.push(at("cue", blue.x - CUE_BESIDE_BLUE_D * d, blue.y));
  return balls;
}

function snookerTLineUp(table: TableSpec, ballSet: BallSetSpec): LayoutBall[] {
  const d = ballSet.object.diameterM;
  const pink = spot(table, "pink");
  const black = spot(table, "black");
  const balls = snookerColours(table);
  // The stem of the T: reds evenly between the pink and the black.
  for (let i = 1; i <= SNOOKER_REDS_PER_GAP; i++) {
    const p = between(pink, black, i, SNOOKER_REDS_PER_GAP + 1);
    balls.push(at("red", p.x, p.y));
  }
  // The bar of the T: reds across the table on the pink's line, either side of the pink.
  for (const k of [-2, -1, 1, 2]) {
    balls.push(at("red", pink.x + k * CROSS_SPACING_D * d, pink.y));
  }
  balls.push(at("cue", pink.x, pink.y - CUE_BELOW_PINK_D * d));
  return balls;
}

function snookerLongPot(table: TableSpec): LayoutBall[] {
  const brown = spot(table, "brown");
  const yellow = spot(table, "yellow");
  const { lengthM } = table.playingArea;
  // The D is the half circle of radius (yellow.x - brown.x) on the baulk side of the baulk line.
  // Cue ball half way between the baulk line and the bottom of the D, on the centre line.
  const dRadius = yellow.x - brown.x;
  const cue = { x: brown.x, y: brown.y - dRadius / 2 };
  // Red on the straight line from the cue ball to the top-left corner of the nose rectangle.
  const red = between(cue, { x: 0, y: lengthM }, LONG_POT_RED_FRACTION * 10, 10);
  return [at("cue", cue.x, cue.y), at("red", red.x, red.y)];
}

function snookerBlackFromSpot(table: TableSpec, ballSet: BallSetSpec): LayoutBall[] {
  const d = ballSet.object.diameterM;
  const { lengthM, widthM } = table.playingArea;
  const black = spot(table, "black");
  // Unit vector from the black to the top-left corner pocket (the corner of the nose rectangle).
  const vx = 0 - black.x;
  const vy = lengthM - black.y;
  const vlen = Math.sqrt(vx * vx + vy * vy);
  const ux = vx / vlen;
  const uy = vy / vlen;
  // Ghost ball: where the cue ball is at the moment of contact, one diameter behind the black.
  const gx = black.x - d * ux;
  const gy = black.y - d * uy;
  // The cue ball travels at an angle to the pot line with sin = offset fraction, rotated towards
  // the baulk end so the cue ball comes from the lower right.
  const s = THREE_QUARTER_OFFSET;
  const c = Math.sqrt(1 - s * s);
  const wx = ux * c + uy * s;
  const wy = -ux * s + uy * c;
  const dist = BLACK_CUE_DISTANCE_WIDTH * widthM;
  const balls: LayoutBall[] = [
    at("black", black.x, black.y),
    at("cue", gx - dist * wx, gy - dist * wy),
  ];
  for (const [ox, oy] of BLACK_RED_OFFSETS_D) {
    balls.push(at("red", black.x + ox * d, black.y + oy * d));
  }
  return balls;
}

function poolStopShotLadder(table: TableSpec, ballSet: BallSetSpec): LayoutBall[] {
  const d = ballSet.object.diameterM;
  const { lengthM } = table.playingArea;
  const head = spot(table, "head");
  // Unit vector from the cue ball (on the head spot) to the top-left corner of the nose rectangle.
  const vx = 0 - head.x;
  const vy = lengthM - head.y;
  const vlen = Math.sqrt(vx * vx + vy * vy);
  const balls: LayoutBall[] = [at("cue", head.x, head.y)];
  for (let k = 0; k < LADDER_BALLS; k++) {
    const t = (LADDER_FIRST_D + LADDER_STEP_D * k) * d;
    balls.push(at(poolNumber(k + 1), head.x + (vx / vlen) * t, head.y + (vy / vlen) * t));
  }
  return balls;
}

function poolLDrill(table: TableSpec, ballSet: BallSetSpec): LayoutBall[] {
  const d = ballSet.object.diameterM;
  const { lengthM } = table.playingArea;
  const centre = spot(table, "centre");
  // Corner ball in the top-left corner, an equal distance from the side and foot cushions.
  const cx = L_OFFSET_D * d;
  const cy = lengthM - L_OFFSET_D * d;
  const positions: Pos[] = [{ x: cx, y: cy }];
  for (let k = 1; k <= L_ARM_BALLS; k++) {
    positions.push({ x: cx + k * L_SPACING_D * d, y: cy }); // along the foot rail
    positions.push({ x: cx, y: cy - k * L_SPACING_D * d }); // along the side rail
  }
  const balls: LayoutBall[] = [at("cue", centre.x, centre.y)];
  positions.forEach((p, i) => balls.push(at(poolNumber(i + 1), p.x, p.y)));
  return balls;
}

function poolWagonWheel(table: TableSpec, ballSet: BallSetSpec): LayoutBall[] {
  const d = ballSet.object.diameterM;
  const centre = spot(table, "centre");
  // Six balls on a ring around the centre spot at 60 degree steps starting at 90 degrees, so none
  // lies on the line between the centre and the side pocket. Cos and sin of those angles are exact.
  const unit: Pos[] = [
    { x: 0, y: 1 },
    { x: SQRT3_2, y: 0.5 },
    { x: SQRT3_2, y: -0.5 },
    { x: 0, y: -1 },
    { x: -SQRT3_2, y: -0.5 },
    { x: -SQRT3_2, y: 0.5 },
  ];
  const balls: LayoutBall[] = [
    at("cue", WHEEL_CUE_D * d, centre.y),
    at("1", WHEEL_OBJECT_D * d, centre.y),
  ];
  unit.forEach((u, i) => {
    balls.push(
      at(
        poolNumber(i + 2),
        centre.x + u.x * WHEEL_RADIUS_D * d,
        centre.y + u.y * WHEEL_RADIUS_D * d,
      ),
    );
  });
  return balls;
}

function lineAcross(table: TableSpec, kindAt: (i: number) => BallKind): LayoutBall[] {
  const { lengthM, widthM } = table.playingArea;
  const balls: LayoutBall[] = [];
  // Evenly spaced across the width on the centre string, the same distance from each side.
  for (let i = 0; i < ACROSS_BALLS; i++) {
    balls.push(at(kindAt(i), (widthM * (i + 1)) / (ACROSS_BALLS + 1), lengthM / 2));
  }
  return balls;
}

function poolLineAcross(table: TableSpec): LayoutBall[] {
  const head = spot(table, "head");
  return [at("cue", head.x, head.y), ...lineAcross(table, (i) => poolNumber(i + 1))];
}

function blackballLineAcross(table: TableSpec): LayoutBall[] {
  const baulk = spot(table, "baulk");
  // Alternating reds and yellows, four reds and three yellows.
  return [
    at("cue", baulk.x, baulk.y),
    ...lineAcross(table, (i) => (i % 2 === 0 ? "red" : "yellow")),
  ];
}

function buildDrill(table: TableSpec, ballSet: BallSetSpec, id: string): Layout | undefined {
  switch (id) {
    case "snooker-line-up":
      return { balls: snookerLineUp(table, ballSet) };
    case "snooker-t-line-up":
      return { balls: snookerTLineUp(table, ballSet) };
    case "snooker-long-pot":
      return { balls: snookerLongPot(table) };
    case "snooker-black-from-spot":
      return { balls: snookerBlackFromSpot(table, ballSet) };
    case "pool-stop-shot-ladder":
      return { balls: poolStopShotLadder(table, ballSet) };
    case "pool-l-drill":
      return { balls: poolLDrill(table, ballSet) };
    case "pool-wagon-wheel":
      return { balls: poolWagonWheel(table, ballSet) };
    case "pool-line-across":
      return { balls: poolLineAcross(table) };
    case "blackball-line-across":
      return { balls: blackballLineAcross(table) };
    default:
      return undefined;
  }
}

/** True when the layout is on the table, off the pockets, has no overlaps, and the set has the balls. */
function layoutFits(table: TableSpec, ballSet: BallSetSpec, layout: Layout): boolean {
  const { widthM, lengthM } = table.playingArea;
  const used = new Map<BallKind, number>();
  for (const b of layout.balls) used.set(b.kind, (used.get(b.kind) ?? 0) + 1);
  if ((used.get("cue") ?? 0) !== 1) return false;
  for (const [kind, n] of used) {
    const have = ballSet.kinds.find((k) => k.kind === kind)?.count ?? 0;
    if (have < n) return false;
  }
  const pockets = pocketDropCircles(table);
  const sized = layout.balls.map((b) => ({ ...b, r: ballSizeOf(ballSet, b.kind).diameterM / 2 }));
  for (let i = 0; i < sized.length; i++) {
    const a = sized[i] as (typeof sized)[number];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
    const margin = noseContactDistanceM(a.r, table.cushion.noseHeightM) - FIT_TOL_M;
    if (a.x < margin || a.x > widthM - margin || a.y < margin || a.y > lengthM - margin) {
      return false;
    }
    for (const p of pockets) {
      const dx = a.x - p.x;
      const dy = a.y - p.y;
      if (Math.sqrt(dx * dx + dy * dy) < p.radiusM) return false;
    }
    for (let j = i + 1; j < sized.length; j++) {
      const b = sized[j] as (typeof sized)[number];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (Math.sqrt(dx * dx + dy * dy) < a.r + b.r + MIN_GAP_M - FIT_TOL_M) return false;
    }
  }
  return true;
}

/**
 * The drill's balls on this table, or undefined if the id is unknown, the game does not match the
 * table's, the ball set lacks the balls, or the drill does not fit (a ball would be off the
 * table, over a pocket, or closer than 1 mm to another). Balls are never moved to make it fit.
 */
export function drillLayout(
  table: TableSpec,
  ballSet: BallSetSpec,
  drillId: string,
): Layout | undefined {
  const template = DRILL_TEMPLATES.find((d) => d.id === drillId);
  if (!template || template.game !== table.game) return undefined;
  let layout: Layout | undefined;
  try {
    layout = buildDrill(table, ballSet, drillId);
  } catch {
    return undefined;
  }
  if (!layout || !layoutFits(table, ballSet, layout)) return undefined;
  return layout;
}

/** True when `drillLayout` would return a layout. */
export function drillFits(table: TableSpec, ballSet: BallSetSpec, drillId: string): boolean {
  return drillLayout(table, ballSet, drillId) !== undefined;
}
