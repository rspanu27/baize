/** Plane geometry used to turn a region of cloth into four corners. Points are in pixels. */

export interface Pt {
  x: number;
  y: number;
}

/** Twice the signed area of triangle a, b, c (positive when counter-clockwise in x right, y up). */
export function cross(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Convex hull (Andrew's monotone chain). Returns the vertices in order, without repeats. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const lower: Pt[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] as Pt, lower[lower.length - 1] as Pt, p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i] as Pt;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] as Pt, upper[upper.length - 1] as Pt, p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * The part of a convex polygon inside the rectangle [0, width] x [0, height]
 * (Sutherland-Hodgman, one edge of the rectangle at a time). Empty when none of it is inside.
 */
export function clipToRect(poly: readonly Pt[], width: number, height: number): Pt[] {
  const edges: { inside: (p: Pt) => boolean; cut: (a: Pt, b: Pt) => Pt }[] = [
    { inside: (p) => p.x >= 0, cut: (a, b) => at(a, b, (0 - a.x) / (b.x - a.x)) },
    { inside: (p) => p.x <= width, cut: (a, b) => at(a, b, (width - a.x) / (b.x - a.x)) },
    { inside: (p) => p.y >= 0, cut: (a, b) => at(a, b, (0 - a.y) / (b.y - a.y)) },
    { inside: (p) => p.y <= height, cut: (a, b) => at(a, b, (height - a.y) / (b.y - a.y)) },
  ];
  let out: Pt[] = [...poly];
  for (const edge of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i] as Pt;
      const prev = input[(i + input.length - 1) % input.length] as Pt;
      const curIn = edge.inside(cur);
      const prevIn = edge.inside(prev);
      if (curIn) {
        if (!prevIn) out.push(edge.cut(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(edge.cut(prev, cur));
      }
    }
    if (out.length === 0) return [];
  }
  return out;
}

function at(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** Where the line through a1, a2 meets the line through b1, b2; undefined if parallel. */
export function intersectLines(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | undefined {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const den = dax * dby - day * dbx;
  const scale = Math.hypot(dax, day) * Math.hypot(dbx, dby);
  if (!(Math.abs(den) > 1e-9 * scale)) return undefined;
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / den;
  return { x: a1.x + t * dax, y: a1.y + t * day };
}

/**
 * The four-sided polygon that contains a convex polygon and adds the least area, found by
 * removing one side at a time: the side whose removal (its two neighbours extended until they
 * meet) adds the least area goes first. Short sides such as the cut-off corners at pockets go
 * early, and the corners of the result are where the long sides meet. Returns undefined when
 * the polygon cannot be reduced to four sides.
 */
export function enclosingQuad(hull: readonly Pt[]): Pt[] | undefined {
  let poly = [...hull];
  while (poly.length > 4) {
    const n = poly.length;
    let bestIndex = -1;
    let bestArea = Number.POSITIVE_INFINITY;
    let bestPoint: Pt | undefined;
    for (let i = 0; i < n; i++) {
      // Side i runs from poly[i] to poly[i + 1]; its neighbours are sides i - 1 and i + 1.
      const a0 = poly[(i - 1 + n) % n] as Pt;
      const a1 = poly[i] as Pt;
      const b0 = poly[(i + 1) % n] as Pt;
      const b1 = poly[(i + 2) % n] as Pt;
      const meet = intersectLines(a0, a1, b0, b1);
      if (!meet) continue;
      // The meeting point must be beyond the side (on the outside), not behind it.
      const forward = (meet.x - a1.x) * (a1.x - a0.x) + (meet.y - a1.y) * (a1.y - a0.y);
      const backward = (meet.x - b0.x) * (b0.x - b1.x) + (meet.y - b0.y) * (b0.y - b1.y);
      if (forward < 0 || backward < 0) continue;
      const added = Math.abs(cross(a1, b0, meet)) / 2;
      if (added < bestArea) {
        bestArea = added;
        bestIndex = i;
        bestPoint = meet;
      }
    }
    if (bestIndex < 0 || !bestPoint) return undefined;
    // Replace the two ends of the removed side with the meeting point.
    const next: Pt[] = [];
    for (let k = 0; k < n; k++) {
      if (k === bestIndex) next.push(bestPoint);
      else if (k !== (bestIndex + 1) % n) next.push(poly[k] as Pt);
    }
    poly = next;
  }
  return poly.length === 4 ? poly : undefined;
}

/**
 * Best straight line through points, by total least squares. Returns a point on the line and
 * its unit direction, or undefined for fewer than two distinct points.
 */
export function fitLine(points: readonly Pt[]): { point: Pt; dir: Pt } | undefined {
  const n = points.length;
  if (n < 2) return undefined;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (!(sxx + syy > 0)) return undefined;
  // Direction of the largest spread: the principal axis of the 2 x 2 scatter matrix.
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { point: { x: mx, y: my }, dir: { x: Math.cos(angle), y: Math.sin(angle) } };
}
