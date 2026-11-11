import { ballSizeOf } from "./layout";
import { spotsFor } from "./markings";
import type {
  BallKind,
  BallSetSpec,
  GameType,
  Layout,
  LayoutBall,
  PoolNumber,
  RackKind,
  TableSpec,
} from "./types";

/*
 * Rack arrangements. Coordinates as in types.ts: y grows from the baulk/head end towards the
 * top/foot end. Triangles point their apex towards the baulk/head end (smaller y) and rows extend
 * towards the foot cushion. Row spacing is d * sqrt(3) / 2 and balls in a row are d apart, so
 * neighbours touch exactly (centre distance = d, up to floating point).
 *
 * SOURCES. Web access was unavailable while this task was done, so none of the rule texts below
 * could be re-fetched; every rule statement is marked UNVERIFIED and is from the author's
 * knowledge of the rules, to be re-checked by the lead:
 *  - Snooker: WPBSA Rules of Snooker and Billiards, "Positioning of balls": 15 reds in a
 *    triangle, apex red as close as possible to the pink without touching it, the base towards
 *    the top cushion, colours on their spots. UNVERIFIED wording.
 *    (https://ebsa.tv/wp-content/uploads/2019/09/WPBSA-Rules-of-Snooker-and-Billiards-2019-August.pdf)
 *  - 10-red and 6-red snooker (WPBSA / IBSF short-form variants): reds racked in the same
 *    triangle shape with the apex in the same place, 4 rows and 3 rows. UNVERIFIED.
 *  - 8-ball: WPA Pool Rules, "Racking": apex ball on the foot spot, 8 ball in the middle of the
 *    third row, a stripe and a solid in the two back corners, other balls random.
 *    UNVERIFIED wording; "other balls ascending" is a deterministic project choice.
 *  - 9-ball: WPA Pool Rules: diamond of nine balls, 1 ball at the apex on the foot spot, 9 ball
 *    in the centre, others random. UNVERIFIED wording; ascending order is a project choice.
 *  - Blackball (WPA / EBA blackball rules): 15 balls in a triangle, black on the black spot in
 *    the middle of the third row, reds and yellows otherwise alternating. The exact red/yellow
 *    pattern is UNVERIFIED; the one below is a project choice with 7 of each and differently
 *    coloured back corners.
 */

/**
 * Gap left between the apex red and the pink in snooker, metres. Design tolerance: the rules say
 * "as close as possible without touching"; 1 mm keeps the balls visibly and numerically apart.
 */
const SNOOKER_APEX_GAP_M = 0.001;

const ROW_FACTOR = Math.sqrt(3) / 2;

/** Racks available for a game. Task 1.6. */
export function racksFor(game: GameType): RackKind[] {
  switch (game) {
    case "snooker":
      return ["snooker-15", "snooker-10", "snooker-6"];
    case "pool":
      return ["pool-8ball", "pool-9ball", "pool-15"];
    case "blackball":
      return ["blackball"];
  }
}

const RACK_GAME: Record<RackKind, GameType> = {
  "snooker-15": "snooker",
  "snooker-10": "snooker",
  "snooker-6": "snooker",
  "pool-8ball": "pool",
  "pool-9ball": "pool",
  "pool-15": "pool",
  blackball: "blackball",
};

interface Pos {
  x: number;
  y: number;
}

/** Triangle with `rows` rows, apex at `apex`, balls `d` apart. Row-major order. */
function trianglePositions(apex: Pos, rows: number, d: number): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i <= r; i++) {
      out.push({ x: apex.x + (i - r / 2) * d, y: apex.y + r * d * ROW_FACTOR });
    }
  }
  return out;
}

/** Diamond with row sizes 1,2,3,2,1, apex at `apex`. Row-major order. */
function diamondPositions(apex: Pos, d: number): Pos[] {
  const out: Pos[] = [];
  [1, 2, 3, 2, 1].forEach((count, r) => {
    for (let i = 0; i < count; i++) {
      out.push({ x: apex.x + (i - (count - 1) / 2) * d, y: apex.y + r * d * ROW_FACTOR });
    }
  });
  return out;
}

function spot(table: TableSpec, name: string): Pos {
  const s = spotsFor(table).find((p) => p.name === name);
  if (!s) throw new Error(`Table has no spot named '${name}'`);
  return { x: s.x, y: s.y };
}

function poolNumber(n: number): PoolNumber {
  return String(n) as PoolNumber;
}

/** Throws unless the ball set has at least the wanted number of each kind. */
function requireKinds(ballSet: BallSetSpec, wanted: Map<BallKind, number>, rack: RackKind): void {
  for (const [kind, count] of wanted) {
    const have = ballSet.kinds.find((k) => k.kind === kind)?.count ?? 0;
    if (have < count) {
      throw new Error(
        `Ball set '${ballSet.id}' cannot make rack '${rack}': needs ${String(count)} '${kind}', has ${String(have)}`,
      );
    }
  }
}

function snookerRack(table: TableSpec, ballSet: BallSetSpec, rows: number): LayoutBall[] {
  const d = ballSizeOf(ballSet, "red").diameterM;
  const colours: BallKind[] = ["yellow", "green", "brown", "blue", "pink", "black"];
  const brown = spot(table, "brown");
  const yellow = spot(table, "yellow");
  const pink = spot(table, "pink");
  const balls: LayoutBall[] = [
    // Cue ball in the D, on the baulk line midway between the brown and yellow spots (project
    // choice; the rules allow anywhere in the D).
    { kind: "cue", x: (brown.x + yellow.x) / 2, y: brown.y },
  ];
  for (const kind of colours) {
    const p = spot(table, kind);
    balls.push({ kind, x: p.x, y: p.y });
  }
  const apex = { x: pink.x, y: pink.y + d + SNOOKER_APEX_GAP_M };
  for (const p of trianglePositions(apex, rows, d)) balls.push({ kind: "red", x: p.x, y: p.y });
  return balls;
}

const BLACKBALL_PATTERN: string[] = ["Y", "RY", "YBR", "RYRY", "RRYRY"];

/**
 * Ball positions for a rack on a given table with a given ball set. Task 1.6.
 *
 * Output order: cue ball first; snooker then yellow, green, brown, blue, pink, black, then the
 * reds row by row from the apex; pool and blackball then the object balls row by row from the
 * apex (left to right within a row, looking from the baulk end).
 */
export function rackLayout(table: TableSpec, ballSet: BallSetSpec, rack: RackKind): Layout {
  if (RACK_GAME[rack] !== table.game) {
    throw new Error(`Rack '${rack}' is for ${RACK_GAME[rack]}, but the table is for ${table.game}`);
  }
  const wanted = new Map<BallKind, number>([["cue", 1]]);
  const want = (kind: BallKind, n: number): void => {
    wanted.set(kind, (wanted.get(kind) ?? 0) + n);
  };

  let balls: LayoutBall[];
  switch (rack) {
    case "snooker-15":
    case "snooker-10":
    case "snooker-6": {
      const rows = rack === "snooker-15" ? 5 : rack === "snooker-10" ? 4 : 3;
      want("red", (rows * (rows + 1)) / 2);
      for (const k of ["yellow", "green", "brown", "blue", "pink", "black"] as const) want(k, 1);
      requireKinds(ballSet, wanted, rack);
      balls = snookerRack(table, ballSet, rows);
      break;
    }
    case "pool-8ball":
    case "pool-9ball":
    case "pool-15": {
      const head = spot(table, "head");
      const foot = spot(table, "foot");
      const d = ballSet.object.diameterM;
      const count = rack === "pool-9ball" ? 9 : 15;
      for (let n = 1; n <= count; n++) want(poolNumber(n), 1);
      requireKinds(ballSet, wanted, rack);
      const positions =
        rack === "pool-9ball" ? diamondPositions(foot, d) : trianglePositions(foot, 5, d);
      // Which ball goes in which position, row-major.
      const order: number[] = new Array<number>(positions.length).fill(0);
      if (rack === "pool-15") {
        for (let i = 0; i < 15; i++) order[i] = i + 1;
      } else if (rack === "pool-8ball") {
        // Row-major indices: third row middle = 4; back corners = 10 and 14.
        order[4] = 8;
        order[10] = 1;
        order[14] = 9;
        const rest = [2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15];
        let next = 0;
        for (let i = 0; i < order.length; i++)
          if (order[i] === 0) order[i] = rest[next++] as number;
      } else {
        // Diamond row-major: apex = 0, centre (third row middle) = 4.
        order[0] = 1;
        order[4] = 9;
        const rest = [2, 3, 4, 5, 6, 7, 8];
        let next = 0;
        for (let i = 0; i < order.length; i++)
          if (order[i] === 0) order[i] = rest[next++] as number;
      }
      balls = [{ kind: "cue", x: head.x, y: head.y }];
      positions.forEach((p, i) => {
        balls.push({ kind: poolNumber(order[i] as number), x: p.x, y: p.y });
      });
      break;
    }
    case "blackball": {
      want("red", 7);
      want("yellow", 7);
      want("black", 1);
      requireKinds(ballSet, wanted, rack);
      const d = ballSet.object.diameterM;
      const black = spot(table, "black");
      const baulk = spot(table, "baulk");
      // Black is in the middle of the third row, so the apex is two rows nearer the baulk end.
      const apex = { x: black.x, y: black.y - 2 * d * ROW_FACTOR };
      const positions = trianglePositions(apex, 5, d);
      const symbols = BLACKBALL_PATTERN.join("").split("");
      balls = [{ kind: "cue", x: baulk.x, y: baulk.y }];
      positions.forEach((p, i) => {
        const s = symbols[i];
        const kind: BallKind = s === "R" ? "red" : s === "Y" ? "yellow" : "black";
        balls.push({ kind, x: p.x, y: p.y });
      });
      break;
    }
  }
  return { balls };
}
