import type { Camera, ImagePoint, Mat3, TableCorners } from "../src/index";
import { cameraFromCorners, projectPoint } from "../src/index";
import { solveLinear } from "../src/geometry/linear";
import { fitLine, intersectLines } from "../src/table/quad";
import type { Pt } from "../src/table/quad";

/**
 * The truth for a real photo of a pool table, from its sights (diamonds).
 *
 * A pool table carries 18 sights on its rails at known places: at each 1/8 of the length on
 * the long rails and each 1/4 of the width on the short rails, a fixed distance behind the
 * cushion nose. A picture in which the sights are marked therefore fixes the camera without
 * anyone having measured anything, and with the camera every marked ball can be placed on
 * the table. This is how the public pix2pockets pictures are used as a test set.
 *
 * Assumptions, which limit how exact this truth is: the sights are `setbackM` behind the
 * nose, the rail top is at `railHeightM` above the cloth, and the playing area is twice as
 * long as it is wide. A centimetre of error in the first two moves a ball by a few
 * millimetres.
 */
export interface SightGeometry {
  widthM: number;
  lengthM: number;
  setbackM: number;
  railHeightM: number;
  noseHeightM: number;
}

export interface SightTruth {
  camera: Camera;
  /** Where the corners of the playing area (at nose height) are in the picture. */
  corners: TableCorners;
  /** Sights paired with a marked dot. */
  matched: number;
  /** Median distance between a sight and its dot, pixels. */
  residualPx: number;
}

/** The 18 sights in table coordinates (on the rail top, outside the playing area). */
export function sightPlaces(g: SightGeometry): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const x of [-g.setbackM, g.widthM + g.setbackM]) {
    for (const k of [1, 2, 3, 5, 6, 7]) out.push({ x, y: (g.lengthM * k) / 8 });
  }
  for (const y of [-g.setbackM, g.lengthM + g.setbackM]) {
    for (const k of [1, 2, 3]) out.push({ x: (g.widthM * k) / 4, y });
  }
  return out;
}

interface Pair {
  /** Which rail the sight is on (0 to 3); absent for the corners of the rectangle. */
  rail?: number;
  x: number;
  y: number;
  u: number;
  v: number;
}

/** Least-squares homography through four or more point pairs (plane to picture). */
export function fitHomography(pairs: readonly Pair[]): Mat3 | undefined {
  if (pairs.length < 4) return undefined;
  let size = 0;
  let span = 0;
  for (const p of pairs) {
    size = Math.max(size, Math.abs(p.u), Math.abs(p.v));
    span = Math.max(span, Math.abs(p.x), Math.abs(p.y));
  }
  if (!(size > 0) || !(span > 0)) return undefined;
  const n = new Array<number>(64).fill(0);
  const rhs = new Array<number>(8).fill(0);
  const add = (row: readonly number[], b: number): void => {
    for (let i = 0; i < 8; i++) {
      rhs[i] = (rhs[i] as number) + (row[i] as number) * b;
      for (let j = 0; j < 8; j++) {
        n[i * 8 + j] = (n[i * 8 + j] as number) + (row[i] as number) * (row[j] as number);
      }
    }
  };
  for (const p of pairs) {
    const x = p.x / span;
    const y = p.y / span;
    const u = p.u / size;
    const v = p.v / size;
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solveLinear(n, rhs);
  if (!h) return undefined;
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  return [
    (size * h0) / span,
    (size * h1) / span,
    size * h2,
    (size * h3) / span,
    (size * h4) / span,
    size * h5,
    h6 / span,
    h7 / span,
    1,
  ];
}

function apply(h: Mat3, x: number, y: number): ImagePoint {
  const w = h[6] * x + h[7] * y + h[8];
  return { u: (h[0] * x + h[1] * y + h[2]) / w, v: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Pairs each sight with the nearest free dot that is clearly nearer to it than to others. */
function pairUp(
  h: Mat3,
  places: readonly { x: number; y: number }[],
  dots: readonly ImagePoint[],
): { pairs: Pair[]; residuals: number[] } {
  const seen = places.map((p) => apply(h, p.x, p.y));
  const options: { s: number; d: number; dist: number }[] = [];
  seen.forEach((s, si) => {
    let nearestOther = Number.POSITIVE_INFINITY;
    seen.forEach((o, oi) => {
      if (oi !== si) nearestOther = Math.min(nearestOther, Math.hypot(o.u - s.u, o.v - s.v));
    });
    dots.forEach((d, di) => {
      const dist = Math.hypot(d.u - s.u, d.v - s.v);
      if (dist < 0.3 * nearestOther) options.push({ s: si, d: di, dist });
    });
  });
  options.sort((a, b) => a.dist - b.dist || a.s - b.s || a.d - b.d);
  const usedS = new Set<number>();
  const usedD = new Set<number>();
  const pairs: Pair[] = [];
  const residuals: number[] = [];
  for (const o of options) {
    if (usedS.has(o.s) || usedD.has(o.d)) continue;
    usedS.add(o.s);
    usedD.add(o.d);
    const place = places[o.s] as { x: number; y: number };
    const dot = dots[o.d] as ImagePoint;
    // sightPlaces lists six sights on each long rail, then three on each short one.
    const rail = o.s < 6 ? 0 : o.s < 12 ? 1 : o.s < 15 ? 2 : 3;
    pairs.push({ rail, x: place.x, y: place.y, u: dot.u, v: dot.v });
    residuals.push(o.dist);
  }
  return { pairs, residuals };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length > 0 ? (sorted[Math.floor(sorted.length / 2)] as number) : Number.NaN;
}

/**
 * The camera and the corners of the playing area from the marked sights of one picture.
 *
 * The dots lie on four lines (the rails), and every other dot is on one side of each. The
 * lines with the most dots are taken as candidates, and for each choice of four, and each
 * way of laying the rectangle of sights on their crossings, the 18 sights are compared with
 * the dots: the right choice puts six on each long rail and three on each short one, and
 * gives a camera above the table. The homography is then refitted to all paired sights.
 * Turning the table end for end fits equally well; which end is baulk cannot be told from
 * sights.
 *
 * Returns undefined when fewer than `minMatched` sights can be paired.
 */
export function truthFromSights(
  dots: readonly ImagePoint[],
  widthPx: number,
  heightPx: number,
  g: SightGeometry,
  minMatched = 10,
): SightTruth | undefined {
  if (dots.length < minMatched) return undefined;
  const pts: Pt[] = dots.map((d) => ({ x: d.u, y: d.v }));
  // A rail shows as a line through two or more dots with every other dot on one side of it.
  const tol = Math.max(2, 0.003 * Math.hypot(widthPx, heightPx));
  const found: { on: number[]; span: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i] as Pt;
      const b = pts[j] as Pt;
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(span > tol)) continue;
      const on: number[] = [];
      let left = 0;
      let right = 0;
      pts.forEach((p, k) => {
        const dist = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / span;
        if (Math.abs(dist) <= tol) on.push(k);
        else if (dist > 0) left++;
        else right++;
      });
      if (left > 0 && right > 0) continue;
      if (found.some((f) => f.on.length === on.length && f.on.every((k, n) => k === on[n]))) {
        continue;
      }
      let reach = 0;
      for (const k of on) {
        for (const m of on) {
          const p = pts[k] as Pt;
          const q = pts[m] as Pt;
          reach = Math.max(reach, Math.hypot(p.x - q.x, p.y - q.y));
        }
      }
      found.push({ on, span: reach });
    }
  }
  found.sort((x, y) => y.on.length - x.on.length || y.span - x.span);
  // A rail with only two dots left in view ranks below the lines across the corners (from the
  // last dot of one rail to the first of the next), so more than four candidates are kept.
  const candidates = found.slice(0, 10);
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x / pts.length;
    cy += p.y / pts.length;
  }
  /** The corners where four rails meet, going round, or undefined when they do not close. */
  const cornersOf = (four: readonly { on: number[] }[]): Pt[] | undefined => {
    const lines = four.map((f) => {
      const group = f.on.map((k) => pts[k] as Pt);
      const line = fitLine(group);
      let mx = 0;
      let my = 0;
      for (const p of group) {
        mx += p.x / group.length;
        my += p.y / group.length;
      }
      return { line, angle: Math.atan2(my - cy, mx - cx) };
    });
    lines.sort((x, y) => x.angle - y.angle);
    const out: Pt[] = [];
    for (let i = 0; i < 4; i++) {
      const a = lines[(i + 3) % 4]?.line;
      const b = lines[i]?.line;
      if (!a || !b) return undefined;
      const meet = intersectLines(
        a.point,
        { x: a.point.x + a.dir.x, y: a.point.y + a.dir.y },
        b.point,
        { x: b.point.x + b.dir.x, y: b.point.y + b.dir.y },
      );
      if (!meet) return undefined;
      out.push(meet);
    }
    return out;
  };

  const d = g.setbackM;
  const rect = [
    { x: -d, y: -d },
    { x: g.widthM + d, y: -d },
    { x: g.widthM + d, y: g.lengthM + d },
    { x: -d, y: g.lengthM + d },
  ];
  const places = sightPlaces(g);
  let best: { h: Mat3; pairs: Pair[]; residual: number } | undefined;
  const n = candidates.length;
  for (let i0 = 0; i0 < n; i0++) {
    for (let i1 = i0 + 1; i1 < n; i1++) {
      for (let i2 = i1 + 1; i2 < n; i2++) {
        for (let i3 = i2 + 1; i3 < n; i3++) {
          const corner = cornersOf([i0, i1, i2, i3].map((k) => candidates[k] as { on: number[] }));
          if (!corner) continue;
          for (const reversed of [false, true]) {
            const ring = reversed ? [corner[0], corner[3], corner[2], corner[1]] : corner;
            for (let shift = 0; shift < 4; shift++) {
              const four: Pair[] = rect.map((r, i) => {
                const c = ring[(i + shift) % 4] as Pt;
                return { x: r.x, y: r.y, u: c.x, v: c.y };
              });
              const h = fitHomography(four);
              if (!h || !cameraFromCorners(h, widthPx, heightPx, g.railHeightM)) continue;
              const { pairs, residuals } = pairUp(h, places, dots);
              const residual = median(residuals);
              if (
                !best ||
                pairs.length > best.pairs.length ||
                (pairs.length === best.pairs.length && residual < best.residual - 1e-9)
              ) {
                best = { h, pairs, residual };
              }
            }
          }
        }
      }
    }
  }
  if (!best || best.pairs.length < minMatched) return undefined;

  // Refit to all the paired sights, twice, pairing again in between.
  let h = best.h;
  let pairs = best.pairs;
  let residuals: number[] = [];
  for (let round = 0; round < 2; round++) {
    const fitted = fitHomography(pairs);
    if (!fitted) return undefined;
    h = fitted;
    const again = pairUp(h, places, dots);
    if (again.pairs.length < minMatched) return undefined;
    pairs = again.pairs;
    residuals = again.residuals;
  }
  const camera = cameraFromCorners(h, widthPx, heightPx, g.railHeightM);
  if (!camera) return undefined;
  // No truth rather than a wrong one. A rail with fewer than two sights in view is not
  // located, and a line across a corner can then pass for it: such a fit pairs fewer
  // sights and gives a camera whose focal length does not agree with itself (0.9 in the
  // case that showed this, against 0.02 or less for right ones).
  for (let rail = 0; rail < 4; rail++) {
    if (pairs.filter((p) => p.rail === rail).length < 2) return undefined;
  }
  if (camera.focalMisfit > 0.3) return undefined;
  const at = (x: number, y: number): ImagePoint | undefined =>
    projectPoint(camera, { x, y, z: g.noseHeightM });
  const c0 = at(0, 0);
  const c1 = at(g.widthM, 0);
  const c2 = at(g.widthM, g.lengthM);
  const c3 = at(0, g.lengthM);
  if (!c0 || !c1 || !c2 || !c3) return undefined;
  return {
    camera,
    corners: [c0, c1, c2, c3],
    matched: pairs.length,
    residualPx: median(residuals),
  };
}
