import { sinCos } from "./math/trig";
import { SimInputError } from "./types";
import type {
  CushionArc,
  CushionSegment,
  PocketId,
  PocketInput,
  PocketZone,
  PreparedTable,
  TableGeometry,
  TableInput,
  Vec2,
} from "./types";

/**
 * Collision geometry generated from a table description.
 *
 * The playing area is the rectangle [0, W] x [0, L] bounded by the cushion nose lines. At each
 * of the six pockets the straight nose stops at a jaw point; from there the jaw turns away from
 * the playing area on a knuckle arc of radius `jawRadiusM` and continues as a straight facing
 * until it meets the pocket's drop circle. Everything is built by one code path, so presets and
 * custom tables behave identically.
 *
 * `mouthM` is the width of the opening where the two facings begin (the ends of the knuckle
 * arcs). With the tiny knuckle radius of a pool table this is the usual point-to-point mouth;
 * with the large radius of a snooker table it is the opening at the end of the curve.
 *
 * Only two primitive kinds exist: one-sided straight segments and convex arcs (radius 0 is a
 * sharp point). The boundary is closed by construction: rail, arc, facing, drop circle, facing,
 * arc, rail, all sharing end points.
 */

const SQRT_HALF = Math.sqrt(0.5);

interface JawFrame {
  /** Unit vector along the rail nose line, pointing towards the pocket. */
  readonly d: Vec2;
  /** Unit normal of that rail, pointing into the playing area. */
  readonly n: Vec2;
}

interface PocketFrame {
  readonly id: PocketId;
  /** Where the rail lines meet (corner) or the middle of the opening on the rail line (middle). */
  readonly origin: Vec2;
  /** Unit vector along the pocket axis, pointing out of the playing area. */
  readonly axis: Vec2;
  readonly jaws: readonly [JawFrame, JawFrame];
  readonly spec: PocketInput;
}

interface BuiltJaw {
  /** Distance along the rail from the pocket origin back to the jaw point. */
  readonly cutBack: number;
  /** Where the facing starts (end of the knuckle arc). */
  readonly facingStart: Vec2;
  readonly arc: CushionArc;
  readonly facing: CushionSegment | undefined;
}

function invalid(message: string): never {
  throw new SimInputError("invalid-table", message);
}

function requirePositive(value: number, name: string): void {
  if (!(value > 0) || !Number.isFinite(value)) invalid(`${name} must be a positive number`);
}

/**
 * Horizontal distance from a cushion nose line to the centre of a ball touching it. The nose
 * is at height `noseHeightM`, generally above the ball's centre, so this is a little less than
 * the radius.
 */
export function cushionContactDistance(radiusM: number, noseHeightM: number): number {
  const dz = noseHeightM - radiusM;
  return Math.sqrt(radiusM * radiusM - dz * dz);
}

function buildJaw(
  pocket: PocketFrame,
  jaw: JawFrame,
  suffix: string,
): { jaw: Omit<BuiltJaw, "facing">; finish: (dropCentre: Vec2) => BuiltJaw } {
  const { spec, origin, axis } = pocket;
  const { d, n } = jaw;
  const rho = spec.jawRadiusM;
  // The jaw turns from the rail direction away from the playing area by (pi - facing angle).
  const { sin: sn, cos: cs } = sinCos(Math.PI - spec.facingAngleRad);
  // Rotation sense that takes d towards -n.
  const s = -d.y * -n.x + d.x * -n.y > 0 ? 1 : -1;
  const rot = (v: Vec2): Vec2 => ({ x: v.x * cs - s * v.y * sn, y: s * v.x * sn + v.y * cs });
  const f = rot(d); // facing direction, heading into the pocket
  const nf = rot(n); // facing normal, pointing into the pocket channel

  // Choose the cut-back k so that the facing starts mouth/2 to the side of the pocket axis.
  // Offset of a point p from the axis: cross(p - origin, axis).
  const q = -d.x * axis.y - -d.y * axis.x; // offset gained per unit of cut-back
  const side = q > 0 ? 1 : -1;
  const arcShift = rho * ((nf.x - n.x) * axis.y - (nf.y - n.y) * axis.x);
  const k = (side * 0.5 * spec.mouthM - arcShift) / q;
  if (!(k > 0)) invalid(`pocket ${pocket.id}: jaw radius is too large for the mouth width`);

  const point: Vec2 = { x: origin.x - k * d.x, y: origin.y - k * d.y };
  const centre: Vec2 = { x: point.x - rho * n.x, y: point.y - rho * n.y };
  const facingStart: Vec2 = { x: centre.x + rho * nf.x, y: centre.y + rho * nf.y };
  const arc: CushionArc = {
    id: `jaw-${pocket.id}-${suffix}`,
    centre,
    radiusM: rho,
    from: s > 0 ? n : nf,
    to: s > 0 ? nf : n,
  };

  const finish = (dropCentre: Vec2): BuiltJaw => {
    // Run the facing from its start along f until it meets the drop circle.
    const ex = facingStart.x - dropCentre.x;
    const ey = facingStart.y - dropCentre.y;
    const c = ex * ex + ey * ey - spec.dropRadiusM * spec.dropRadiusM;
    if (c <= 0) return { cutBack: k, facingStart, arc, facing: undefined };
    const b = ex * f.x + ey * f.y;
    const disc = b * b - c;
    if (disc < 0 || b >= 0) {
      invalid(`pocket ${pocket.id}: the jaw facing does not reach the pocket drop`);
    }
    const len = -b - Math.sqrt(disc);
    const end: Vec2 = { x: facingStart.x + len * f.x, y: facingStart.y + len * f.y };
    return {
      cutBack: k,
      facingStart,
      arc,
      facing: { id: `facing-${pocket.id}-${suffix}`, a: facingStart, b: end, normal: nf },
    };
  };
  return { jaw: { cutBack: k, facingStart, arc }, finish };
}

function validateTable(table: TableInput): void {
  const { lengthM, widthM } = table.playingArea;
  requirePositive(lengthM, "playing area length");
  requirePositive(widthM, "playing area width");
  for (const [name, p] of [
    ["corner", table.pockets.corner],
    ["middle", table.pockets.middle],
  ] as const) {
    requirePositive(p.mouthM, `${name} pocket mouth`);
    requirePositive(p.dropRadiusM, `${name} pocket drop radius`);
    if (!(p.jawRadiusM >= 0) || !Number.isFinite(p.jawRadiusM)) {
      invalid(`${name} pocket jaw radius must be zero or positive`);
    }
    if (!Number.isFinite(p.dropSetbackM)) invalid(`${name} pocket drop setback must be finite`);
    // The jaw must turn away from the table by more than 0 and at most a right angle.
    if (!(p.facingAngleRad >= Math.PI / 2 && p.facingAngleRad < Math.PI)) {
      invalid(`${name} pocket facing angle must be between 90 and 180 degrees`);
    }
  }
  const c = table.cushion;
  requirePositive(c.noseHeightM, "cushion nose height");
  if (!(c.restitution > 0 && c.restitution <= 1)) invalid("cushion restitution must be in (0, 1]");
  if (!(c.friction >= 0) || !Number.isFinite(c.friction)) {
    invalid("cushion friction must be zero or positive");
  }
}

/** Builds the collision geometry of a table. Throws `SimInputError('invalid-table')`. */
export function buildTableGeometry(table: TableInput): TableGeometry {
  validateTable(table);
  const W = table.playingArea.widthM;
  const L = table.playingArea.lengthM;
  const corner = table.pockets.corner;
  const middle = table.pockets.middle;
  const h = SQRT_HALF;

  const right: Vec2 = { x: 1, y: 0 };
  const left: Vec2 = { x: -1, y: 0 };
  const up: Vec2 = { x: 0, y: 1 };
  const down: Vec2 = { x: 0, y: -1 };

  // Jaw "a" of each pocket is listed first; the order is fixed and part of the stable ids.
  const frames: PocketFrame[] = [
    {
      id: "corner-bl",
      origin: { x: 0, y: 0 },
      axis: { x: -h, y: -h },
      jaws: [
        { d: down, n: right },
        { d: left, n: up },
      ],
      spec: corner,
    },
    {
      id: "corner-br",
      origin: { x: W, y: 0 },
      axis: { x: h, y: -h },
      jaws: [
        { d: down, n: left },
        { d: right, n: up },
      ],
      spec: corner,
    },
    {
      id: "corner-tl",
      origin: { x: 0, y: L },
      axis: { x: -h, y: h },
      jaws: [
        { d: up, n: right },
        { d: left, n: down },
      ],
      spec: corner,
    },
    {
      id: "corner-tr",
      origin: { x: W, y: L },
      axis: { x: h, y: h },
      jaws: [
        { d: up, n: left },
        { d: right, n: down },
      ],
      spec: corner,
    },
    {
      id: "middle-l",
      origin: { x: 0, y: L / 2 },
      axis: left,
      jaws: [
        { d: up, n: right },
        { d: down, n: right },
      ],
      spec: middle,
    },
    {
      id: "middle-r",
      origin: { x: W, y: L / 2 },
      axis: right,
      jaws: [
        { d: up, n: left },
        { d: down, n: left },
      ],
      spec: middle,
    },
  ];

  const segments: CushionSegment[] = [];
  const arcs: CushionArc[] = [];
  const pockets: PocketZone[] = [];
  const cut = new Map<PocketId, readonly [number, number]>();

  for (const frame of frames) {
    const a = buildJaw(frame, frame.jaws[0], "a");
    const b = buildJaw(frame, frame.jaws[1], "b");
    // Drop circle: on the pocket axis, `dropSetbackM` beyond the line joining the facing starts.
    const midX = 0.5 * (a.jaw.facingStart.x + b.jaw.facingStart.x);
    const midY = 0.5 * (a.jaw.facingStart.y + b.jaw.facingStart.y);
    const centre: Vec2 = {
      x: midX + frame.spec.dropSetbackM * frame.axis.x,
      y: midY + frame.spec.dropSetbackM * frame.axis.y,
    };
    const jawA = a.finish(centre);
    const jawB = b.finish(centre);
    arcs.push(jawA.arc, jawB.arc);
    if (jawA.facing) segments.push(jawA.facing);
    if (jawB.facing) segments.push(jawB.facing);
    pockets.push({ id: frame.id, centre, radiusM: frame.spec.dropRadiusM });
    cut.set(frame.id, [jawA.cutBack, jawB.cutBack]);
  }

  const cutOf = (id: PocketId, jaw: 0 | 1): number => {
    const c = cut.get(id);
    if (!c) throw new Error("unreachable: pocket not built");
    return c[jaw];
  };

  // Straight rails between jaw points. Corner jaw "a" lies on a long rail (x = 0 or x = W),
  // jaw "b" on a short rail (y = 0 or y = L). Middle jaw "a" is the lower one (it runs up
  // towards the pocket), jaw "b" the upper one.
  const rail = (id: string, a: Vec2, b: Vec2, normal: Vec2, along: number): void => {
    if (!(along > 0)) invalid(`the pockets leave no straight cushion on ${id}`);
    segments.push({ id, a, b, normal });
  };
  const yBL = cutOf("corner-bl", 0);
  const yML0 = L / 2 - cutOf("middle-l", 0);
  const yML1 = L / 2 + cutOf("middle-l", 1);
  const yTL = L - cutOf("corner-tl", 0);
  rail("rail-left-lower", { x: 0, y: yBL }, { x: 0, y: yML0 }, right, yML0 - yBL);
  rail("rail-left-upper", { x: 0, y: yML1 }, { x: 0, y: yTL }, right, yTL - yML1);
  const yBR = cutOf("corner-br", 0);
  const yMR0 = L / 2 - cutOf("middle-r", 0);
  const yMR1 = L / 2 + cutOf("middle-r", 1);
  const yTR = L - cutOf("corner-tr", 0);
  rail("rail-right-lower", { x: W, y: yBR }, { x: W, y: yMR0 }, left, yMR0 - yBR);
  rail("rail-right-upper", { x: W, y: yMR1 }, { x: W, y: yTR }, left, yTR - yMR1);
  const xBL = cutOf("corner-bl", 1);
  const xBR = W - cutOf("corner-br", 1);
  rail("rail-bottom", { x: xBL, y: 0 }, { x: xBR, y: 0 }, up, xBR - xBL);
  const xTL = cutOf("corner-tl", 1);
  const xTR = W - cutOf("corner-tr", 1);
  rail("rail-top", { x: xTL, y: L }, { x: xTR, y: L }, down, xTR - xTL);

  let minX = 0;
  let minY = 0;
  let maxX = W;
  let maxY = L;
  for (const p of pockets) {
    minX = Math.min(minX, p.centre.x - p.radiusM);
    minY = Math.min(minY, p.centre.y - p.radiusM);
    maxX = Math.max(maxX, p.centre.x + p.radiusM);
    maxY = Math.max(maxY, p.centre.y + p.radiusM);
  }

  return { widthM: W, lengthM: L, segments, arcs, pockets, bounds: { minX, minY, maxX, maxY } };
}

/** Builds a table's geometry once so it can be reused across many simulations. */
export function prepareTable(table: TableInput): PreparedTable {
  return { kind: "prepared-table", table, geometry: buildTableGeometry(table) };
}

export function isPreparedTable(table: TableInput | PreparedTable): table is PreparedTable {
  return (table as PreparedTable).kind === "prepared-table";
}
