import type {
  BallKind,
  LayoutBall,
  BallSetSpec,
  BallSize,
  Layout,
  SanitizeResult,
  TableSpec,
} from "./types";

/** Size of one ball of a set: the cue ball may differ from the object balls. */
export function ballSizeOf(ballSet: BallSetSpec, kind: BallKind): BallSize {
  return kind === "cue" && ballSet.cue ? ballSet.cue : ballSet.object;
}

/**
 * Horizontal distance from the cushion nose line to the centre of a ball touching it.
 * The nose sits at `noseHeightM`, usually above the ball's centre, so this is slightly less
 * than the radius.
 */
export function noseContactDistanceM(radiusM: number, noseHeightM: number): number {
  const d = noseHeightM - radiusM;
  return Math.sqrt(radiusM * radiusM - d * d);
}

/**
 * Two balls whose surfaces overlap by no more than this count as touching, not overlapping.
 * Design tolerance: shared links quantise positions to 0.01 mm, so touching balls can come back
 * overlapping by up to about 14 micrometres; 20 micrometres covers that.
 */
export const TOUCH_TOLERANCE_M = 2e-5;

/** A ball position changing by no more than this (metres) is not reported as moved. Design tolerance. */
const MOVED_EPSILON_M = 1e-12;

/** Maximum push-apart iterations per ball before the spiral search. Design limit. */
const MAX_PUSH_ITERATIONS = 64;

/** Maximum rings, and angular samples per ring unit, of the free-position search. Design limits. */
const MAX_SPIRAL_RINGS = 400;
const SPIRAL_ANGLES_PER_RING = 8;

interface Item {
  index: number;
  ball: LayoutBall;
  r: number;
  x: number;
  y: number;
  priority: number;
}

function confidenceOf(ball: LayoutBall): number {
  return ball.confidence ?? 1;
}

/** Higher confidence first; ties keep the earlier input index. */
function byPriority(
  a: { priority: number; index: number },
  b: { priority: number; index: number },
) {
  return b.priority - a.priority || a.index - b.index;
}

/**
 * Makes a layout physically placeable: balls inside the cushions, no overlaps, and no more
 * balls of a kind than the set has (lowest confidence dropped first). Deterministic.
 * Balls are dropped (reported in `removed`) when their position or kind is invalid, when the set
 * has too few of their kind, or when no free position exists within the search limits.
 */
export function sanitizeLayout(
  layout: Layout,
  table: TableSpec,
  ballSet: BallSetSpec,
): SanitizeResult {
  const { lengthM, widthM } = table.playingArea;
  const removed = new Set<number>();

  // Step 1: non-finite coordinates and kinds not in the set.
  const allowed = new Map<BallKind, number>();
  for (const k of ballSet.kinds) allowed.set(k.kind, (allowed.get(k.kind) ?? 0) + k.count);
  let items: Item[] = [];
  layout.balls.forEach((ball, index) => {
    if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y) || !allowed.has(ball.kind)) {
      removed.add(index);
      return;
    }
    items.push({
      index,
      ball,
      r: ballSizeOf(ballSet, ball.kind).diameterM / 2,
      x: ball.x,
      y: ball.y,
      priority: confidenceOf(ball),
    });
  });

  // Step 2: more balls of a kind than the set has.
  const byKind = new Map<BallKind, Item[]>();
  for (const it of items) {
    const list = byKind.get(it.ball.kind);
    if (list) list.push(it);
    else byKind.set(it.ball.kind, [it]);
  }
  for (const [kind, list] of byKind) {
    const max = allowed.get(kind) ?? 0;
    if (list.length <= max) continue;
    for (const it of [...list].sort(byPriority).slice(max)) removed.add(it.index);
  }
  items = items.filter((it) => !removed.has(it.index));

  // Step 3: clamp inside the cushions.
  const clampAxis = (v: number, margin: number, extent: number): number => {
    const lo = margin;
    const hi = extent - margin;
    if (lo > hi) return extent / 2;
    return Math.min(hi, Math.max(lo, v));
  };
  const clampItem = (it: { r: number }, p: { x: number; y: number }) => {
    const m = noseContactDistanceM(it.r, table.cushion.noseHeightM);
    p.x = clampAxis(p.x, m, widthM);
    p.y = clampAxis(p.y, m, lengthM);
  };
  for (const it of items) clampItem(it, it);

  // Step 4: resolve overlaps in descending priority; placed balls never move.
  const placed: Item[] = [];
  const overlapOf = (it: Item, p: { x: number; y: number }): Item | undefined => {
    let worst: Item | undefined;
    let worstDepth = TOUCH_TOLERANCE_M;
    for (const o of placed) {
      const depth = it.r + o.r - Math.hypot(p.x - o.x, p.y - o.y);
      if (depth > worstDepth) {
        worst = o;
        worstDepth = depth;
      }
    }
    return worst;
  };
  const survivors: Item[] = [];
  for (const it of [...items].sort(byPriority)) {
    const p = { x: it.x, y: it.y };
    let hit = overlapOf(it, p);
    for (let n = 0; hit && n < MAX_PUSH_ITERATIONS; n++) {
      const dx = p.x - hit.x;
      const dy = p.y - hit.y;
      const dist = Math.hypot(dx, dy);
      const ux = dist > 0 ? dx / dist : 1;
      const uy = dist > 0 ? dy / dist : 0;
      const target = it.r + hit.r;
      p.x = hit.x + ux * target;
      p.y = hit.y + uy * target;
      clampItem(it, p);
      hit = overlapOf(it, p);
    }
    if (hit) {
      // Nearest free position on rings around the original (clamped) position.
      const step = it.r / 2;
      const origin = { x: it.x, y: it.y };
      let found: { x: number; y: number } | undefined;
      for (let ring = 1; ring <= MAX_SPIRAL_RINGS && !found; ring++) {
        const count = SPIRAL_ANGLES_PER_RING * ring;
        for (let a = 0; a < count; a++) {
          const angle = (2 * Math.PI * a) / count;
          const c = {
            x: origin.x + Math.cos(angle) * step * ring,
            y: origin.y + Math.sin(angle) * step * ring,
          };
          clampItem(it, c);
          if (!overlapOf(it, c)) {
            found = c;
            break;
          }
        }
      }
      if (!found) {
        removed.add(it.index);
        continue;
      }
      p.x = found.x;
      p.y = found.y;
    }
    it.x = p.x;
    it.y = p.y;
    placed.push(it);
    survivors.push(it);
  }

  // Step 5: output in original order.
  survivors.sort((a, b) => a.index - b.index);
  const moved: number[] = [];
  const balls: LayoutBall[] = survivors.map((it) => {
    if (
      Math.abs(it.x - it.ball.x) > MOVED_EPSILON_M ||
      Math.abs(it.y - it.ball.y) > MOVED_EPSILON_M
    ) {
      moved.push(it.index);
      return { ...it.ball, x: it.x, y: it.y };
    }
    return { ...it.ball };
  });
  return { layout: { balls }, moved, removed: [...removed].sort((a, b) => a - b) };
}
