import type { BallTrack, CushionArc, CushionSegment, TableGeometry, Vec2 } from "@baize/physics";

/**
 * Pure drawing helpers for the playground: table coordinates in, SVG strings out.
 *
 * The table is drawn landscape. Table coordinates are metres with x across the width and y
 * along the length (y up); the screen has x to the right and y down. Swapping the two
 * coordinates turns the table a quarter turn without mirroring it, so the head end is on the
 * left and side spin curves the same way it does on a real table seen from above.
 */

/** Table point to screen point (still in metres; the SVG viewBox does the scaling). */
export function toScreen(p: Vec2): Vec2 {
  return { x: p.y, y: p.x };
}

/** Screen point back to table coordinates. */
export function toTable(p: Vec2): Vec2 {
  return { x: p.y, y: p.x };
}

function fmt(n: number): string {
  // Tenth of a millimetre is plenty for drawing and keeps the markup short.
  return (Math.round(n * 1e4) / 1e4).toString();
}

function pt(p: Vec2): string {
  const s = toScreen(p);
  return `${fmt(s.x)} ${fmt(s.y)}`;
}

const ARC_STEPS = 8;

/** Points along a jaw arc, from its `from` end to its `to` end. */
function arcPoints(arc: CushionArc): Vec2[] {
  const out: Vec2[] = [];
  const a0 = Math.atan2(arc.from.y, arc.from.x);
  let sweep = Math.atan2(arc.to.y, arc.to.x) - a0;
  if (sweep < 0) sweep += 2 * Math.PI;
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = a0 + (sweep * i) / ARC_STEPS;
    out.push({
      x: arc.centre.x + arc.radiusM * Math.cos(a),
      y: arc.centre.y + arc.radiusM * Math.sin(a),
    });
  }
  return out;
}

function near(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

/**
 * One jaw as a run of points starting at the jaw point on the rail and ending at the far end
 * of the facing (or of the knuckle arc, if the facing is inside the pocket drop).
 */
function jawFrom(point: Vec2, geometry: TableGeometry): Vec2[] {
  const arc = geometry.arcs.find((a) => {
    const pts = arcPoints(a);
    return near(pts[0] as Vec2, point) || near(pts[pts.length - 1] as Vec2, point);
  });
  if (!arc) return [point];
  let pts = arcPoints(arc);
  if (!near(pts[0] as Vec2, point)) pts = pts.reverse();
  const facing = geometry.segments.find((s) => s.id === `facing-${arc.id.slice(4)}`);
  if (facing) pts.push(facing.b);
  return pts;
}

/**
 * SVG path data for the six cushions. Each is the nose line with its two jaws, closed along a
 * line `depthM` behind the nose.
 */
export function cushionPaths(geometry: TableGeometry, depthM: number): string[] {
  const rails = geometry.segments.filter((s) => s.id.startsWith("rail-"));
  return rails.map((rail: CushionSegment) => {
    const jawA = jawFrom(rail.a, geometry).reverse();
    const jawB = jawFrom(rail.b, geometry);
    const chain = [...jawA, ...jawB];
    const n = rail.normal;
    // Push a point back to the line `depthM` behind the nose.
    const back = (p: Vec2): Vec2 => {
      const depth = -((p.x - rail.a.x) * n.x + (p.y - rail.a.y) * n.y);
      const more = Math.max(0, depthM - depth);
      return { x: p.x - n.x * more, y: p.y - n.y * more };
    };
    const first = chain[0] as Vec2;
    const last = chain[chain.length - 1] as Vec2;
    const all = [...chain, back(last), back(first)];
    return `M ${all.map(pt).join(" L ")} Z`;
  });
}

/**
 * SVG path data for the whole path of a ball: one quadratic Bezier per motion segment, which
 * is exact because every segment has constant acceleration. Empty if the ball never moves.
 */
export function trackPath(track: BallTrack): string {
  let d = "";
  for (const s of track.segments) {
    if (s.state !== "sliding" && s.state !== "rolling") continue;
    if (!Number.isFinite(s.duration) || s.duration <= 0) continue;
    const T = s.duration;
    const control = { x: s.r0.x + (s.v0.x * T) / 2, y: s.r0.y + (s.v0.y * T) / 2 };
    const end = {
      x: s.r0.x + T * (s.v0.x + 0.5 * s.a.x * T),
      y: s.r0.y + T * (s.v0.y + 0.5 * s.a.y * T),
    };
    // Segments are contiguous, but a ball can rest between two moves, so always re-anchor.
    d += `${d ? " " : ""}M ${pt(s.r0)} Q ${pt(control)} ${pt(end)}`;
  }
  return d;
}

/** Distance a ball travels over its whole track, in metres (chord length of fine samples). */
export function trackLength(track: BallTrack): number {
  let total = 0;
  for (const s of track.segments) {
    if (s.state !== "sliding" && s.state !== "rolling") continue;
    if (!Number.isFinite(s.duration) || s.duration <= 0) continue;
    let prev = s.r0;
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const t = (s.duration * i) / steps;
      const p = {
        x: s.r0.x + t * (s.v0.x + 0.5 * s.a.x * t),
        y: s.r0.y + t * (s.v0.y + 0.5 * s.a.y * t),
      };
      total += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
  }
  return total;
}

const POOL_COLOURS: Record<number, string> = {
  1: "#f2c200",
  2: "#1f4fbf",
  3: "#d12a2a",
  4: "#5b2a8c",
  5: "#f07a1a",
  6: "#1c7c4a",
  7: "#7a1f24",
  8: "#141414",
};

export interface BallLook {
  /** Main colour. */
  colour: string;
  /** Striped balls are white with a band of the main colour. */
  striped: boolean;
  /** Number shown on the ball, if any. */
  label: string;
}

/** How to draw a ball of a given kind ("cue", "1".."15", or a snooker colour). */
export function ballLook(kind: string): BallLook {
  if (kind === "cue") return { colour: "#fbfaf2", striped: false, label: "" };
  const n = Number(kind);
  if (Number.isInteger(n) && n >= 1 && n <= 15) {
    const base = n <= 8 ? n : n - 8;
    return { colour: POOL_COLOURS[base] ?? "#888888", striped: n > 8, label: String(n) };
  }
  const named: Record<string, string> = {
    red: "#c8102e",
    yellow: "#f2c200",
    green: "#1c7c4a",
    brown: "#6b3f1d",
    blue: "#1f4fbf",
    pink: "#ef8fb0",
    black: "#141414",
  };
  return { colour: named[kind] ?? "#888888", striped: false, label: "" };
}
