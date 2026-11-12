import type { CushionArc, CushionSegment, TableGeometry, Vec2 } from "@baize/physics";
import type { Marking } from "@baize/tables";
import { SIGHT_OFFSET_M } from "./constants";
import type { Box, ViewTransform } from "./transform";

/**
 * Pure drawing helpers: table geometry and a view transform in, SVG path data and shapes out.
 * Every point goes through the transform, so the same code draws either orientation.
 */

function fmt(n: number): string {
  // Tenth of a millimetre is plenty for drawing and keeps the markup short.
  return (Math.round(n * 1e4) / 1e4).toString();
}

function pt(t: ViewTransform, p: Vec2): string {
  const s = t.toScreen(p);
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
export function cushionPaths(
  geometry: TableGeometry,
  depthM: number,
  transform: ViewTransform,
): string[] {
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
    return `M ${all.map((p) => pt(transform, p)).join(" L ")} Z`;
  });
}

export interface PocketCircle {
  id: string;
  cx: number;
  cy: number;
  r: number;
}

/** The pocket drop circles in screen space. */
export function pocketCircles(geometry: TableGeometry, transform: ViewTransform): PocketCircle[] {
  return geometry.pockets.map((p) => {
    const c = transform.toScreen(p.centre);
    return { id: p.id, cx: c.x, cy: c.y, r: p.radiusM };
  });
}

/**
 * The screen rectangle of the playing area grown by `outsetM` on every side (outset 0 is the
 * nose rectangle; the cushion depth gives the cloth; the rail width gives the outer rail).
 */
export function tableRect(transform: ViewTransform, outsetM: number): Box {
  return transform.viewBox(outsetM);
}

export type MarkingShape =
  | { kind: "line"; name: string; x1: number; y1: number; x2: number; y2: number }
  | { kind: "arc"; name: string; d: string }
  | { kind: "spot"; name: string; cx: number; cy: number }
  | { kind: "sight"; name: string; cx: number; cy: number };

/**
 * SVG arc path data for a table-space arc (counter-clockwise from `startRad` to `endRad`).
 * The transform is a rotation, so a counter-clockwise arc on the table is counter-clockwise on
 * screen too, which in SVG's y-down space is sweep-flag 0 (and 1 for a clockwise arc). A sweep
 * of a full turn or more is split in two halves, since one arc cannot start where it ends.
 */
export function arcPath(
  centre: Vec2,
  radiusM: number,
  startRad: number,
  endRad: number,
  transform: ViewTransform,
): string {
  const sweep = endRad - startRad;
  const at = (a: number): string =>
    pt(transform, { x: centre.x + radiusM * Math.cos(a), y: centre.y + radiusM * Math.sin(a) });
  const flag = sweep >= 0 ? 0 : 1;
  const r = fmt(radiusM);
  const arc = (large: number, to: number): string =>
    `A ${r} ${r} 0 ${String(large)} ${String(flag)} ${at(to)}`;
  if (Math.abs(sweep) >= 2 * Math.PI - 1e-9) {
    const mid = startRad + sweep / 2;
    return `M ${at(startRad)} ${arc(0, mid)} ${arc(0, endRad)}`;
  }
  const large = Math.abs(sweep) > Math.PI + 1e-9 ? 1 : 0;
  return `M ${at(startRad)} ${arc(large, endRad)}`;
}

/**
 * Screen shapes for the markings. Sights sit on the nose line in the data; they are drawn out
 * on the wooden rail, in the middle of the rail's width.
 */
export function markingShapes(
  markings: readonly Marking[],
  transform: ViewTransform,
): MarkingShape[] {
  const W = transform.widthM;
  const L = transform.lengthM;
  return markings.map((m): MarkingShape => {
    switch (m.kind) {
      case "line": {
        const a = transform.toScreen(m.from);
        const b = transform.toScreen(m.to);
        return { kind: "line", name: m.name, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      }
      case "arc":
        return {
          kind: "arc",
          name: m.name,
          d: arcPath(m.centre, m.radiusM, m.startRad, m.endRad, transform),
        };
      case "spot": {
        const c = transform.toScreen(m.at);
        return { kind: "spot", name: m.name, cx: c.x, cy: c.y };
      }
      case "sight": {
        const out = SIGHT_OFFSET_M;
        const c = transform.toScreen({
          x: m.at.x <= 0 ? -out : m.at.x >= W ? W + out : m.at.x,
          y: m.at.y <= 0 ? -out : m.at.y >= L ? L + out : m.at.y,
        });
        return { kind: "sight", name: m.name, cx: c.x, cy: c.y };
      }
    }
  });
}
