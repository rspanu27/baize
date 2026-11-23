import { ballSizeOf, pocketDropCircles } from "@baize/tables";
import type { BallKind, BallSetSpec, TableSpec } from "@baize/tables";
import { apparentRadiusPx, imageToTableAtHeight, projectPoint } from "../geometry/camera";
import type { Camera, ImagePoint, PhotoImage } from "../types";

/**
 * Ball tracking through a clip from a camera that does not move (task 7.5, SPEC section 11).
 *
 * The first frame is the still table: the background. In every later frame, a pixel is
 * evidence of a ball when it differs from the background, is not a ball's shadow (the same
 * colour, darker) and is not cloth (a ball that has left its place uncovers cloth, which also
 * differs from the background). Evidence pixels on the table are grouped into blobs: a ball, a
 * blurred ball (a streak), two balls touching, or something large in the way (a player's arm).
 *
 * Each ball that moves, or whose place has changed, is matched to a blob near where its last
 * motion says it should be; where two balls share a blob the blob's pixels are divided between
 * them. A ball's place is the middle of its pixels, seen from the camera at one radius above
 * the cloth: for a streak that is where the ball was halfway through the exposure. A ball not
 * found is hidden (it keeps moving as predicted) or, near a pocket, potted. A ball that stops
 * becomes part of the background again, so the next shot starts from a clean still table.
 *
 * Positions are in table metres; the camera is the one recovered from the clip's corners.
 */

export interface TrackStart {
  readonly id: string;
  readonly kind: BallKind;
  readonly x: number;
  readonly y: number;
}

export type TrackState = "rest" | "moving" | "hidden" | "pocketed" | "lost";

export interface TrackedBall {
  readonly id: string;
  readonly kind: BallKind;
  readonly state: TrackState;
  /** Table position, metres (the last known or predicted one when hidden). */
  readonly x: number;
  readonly y: number;
  /** Table velocity, metres per second (0 at rest). */
  readonly vx: number;
  readonly vy: number;
  /** Where its centre was seen in this frame, when it was. */
  readonly seen?: ImagePoint;
}

export interface TrackedFrame {
  readonly timeS: number;
  readonly balls: readonly TrackedBall[];
}

export interface TrackOptions {
  /** A pixel differs from the background when a colour channel differs by more than this. */
  readonly diffLevel: number;
  /** A resting ball's place has changed when more than this share of its disc differs. */
  readonly disturbedShare: number;
  /** Below this speed for `restFrames` frames in a row, a ball is at rest, m/s. */
  readonly restSpeedMps: number;
  readonly restFrames: number;
  /** Fastest a ball is taken to move, m/s (bounds the search for a ball just struck). */
  readonly maxSpeedMps: number;
  /** A ball unseen this long is lost, seconds. */
  readonly lostAfterS: number;
}

export const DEFAULT_TRACK_OPTIONS: TrackOptions = {
  diffLevel: 28,
  disturbedShare: 0.35,
  restSpeedMps: 0.03,
  restFrames: 3,
  maxSpeedMps: 12,
  lostAfterS: 1.5,
};

export interface Tracker {
  /** Feeds the next frame (in order); the first one fed is the still table. */
  push(image: PhotoImage, timeS: number): TrackedFrame;
}

/** A ball darkened by its shadow keeps its colour, scaled by between these. */
const SHADOW_MIN = 0.3;
const SHADOW_MAX = 0.93;
const SHADOW_SPREAD = 0.08;
/** Cloth: chromaticity within this of the cloth's, brightness within these shares of it. */
const CLOTH_CHROMA = 0.035;
const CLOTH_BRIGHT_MIN = 0.35;
const CLOTH_BRIGHT_MAX = 1.6;
/** Blobs smaller than this share of a far ball's disc are noise. */
const MIN_BLOB_SHARE = 0.2;
/** A blob larger than this many balls (with their streaks) is something in the way. */
const OCCLUDER_BALLS = 4;
/** How far a ball may land from where it was predicted, as a share of its travel, plus radii. */
const GATE_TRAVEL = 0.8;
const GATE_RADII = 3;
/** Velocity smoothing: share of the new measurement. */
const VELOCITY_GAIN = 0.7;

interface Ball {
  id: string;
  kind: BallKind;
  radiusM: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: TrackState;
  /** Frames in a row below the rest speed. */
  slow: number;
  /** Time it was last seen. */
  seenAtS: number;
  /** Where it rested before it moved, to clean the background once it is clear of it. */
  leftFrom?: { x: number; y: number };
  colour: [number, number, number];
}

interface Blob {
  pixels: number[];
  sumU: number;
  sumV: number;
  colour: [number, number, number];
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

export function createTracker(
  table: TableSpec,
  ballSet: BallSetSpec,
  camera: Camera,
  start: readonly TrackStart[],
  options: TrackOptions = DEFAULT_TRACK_OPTIONS,
): Tracker {
  const { widthM: W, lengthM: L } = table.playingArea;
  const pockets = pocketDropCircles(table);
  const balls: Ball[] = start.map((b) => ({
    id: b.id,
    kind: b.kind,
    radiusM: ballSizeOf(ballSet, b.kind).diameterM / 2,
    x: b.x,
    y: b.y,
    vx: 0,
    vy: 0,
    state: "rest",
    slow: 0,
    seenAtS: 0,
    colour: [0, 0, 0],
  }));
  const smallestR = Math.min(...balls.map((b) => b.radiusM), ballSet.object.diameterM / 2);

  let background: Uint8ClampedArray | undefined;
  let widthPx = 0;
  let heightPx = 0;
  let clothChroma: [number, number] = [0, 0];
  let clothBright = 0;
  /** Per row, the columns inside the table (the playing area grown by a ball, at ball height). */
  let rows: { from: number; to: number }[] = [];
  let lastT = 0;

  const view = (b: { x: number; y: number }, r: number) => {
    const p = { x: b.x, y: b.y, z: r };
    const centre = projectPoint(camera, p);
    const radius = apparentRadiusPx(camera, p, r);
    return centre && radius ? { centre, radius } : undefined;
  };

  /** Pixel indices inside a ball's disc (shrunk by `share`). */
  const disc = (b: Ball, share: number): number[] => {
    const v = view(b, b.radiusM);
    if (!v) return [];
    const r = v.radius * share;
    const out: number[] = [];
    const u0 = Math.max(0, Math.floor(v.centre.u - r));
    const u1 = Math.min(widthPx - 1, Math.ceil(v.centre.u + r));
    const v0 = Math.max(0, Math.floor(v.centre.v - r));
    const v1 = Math.min(heightPx - 1, Math.ceil(v.centre.v + r));
    for (let j = v0; j <= v1; j++) {
      for (let i = u0; i <= u1; i++) {
        const du = i + 0.5 - v.centre.u;
        const dv = j + 0.5 - v.centre.v;
        if (du * du + dv * dv <= r * r) out.push(j * widthPx + i);
      }
    }
    return out;
  };

  function setup(image: PhotoImage, timeS: number) {
    widthPx = image.widthPx;
    heightPx = image.heightPx;
    background = new Uint8ClampedArray(image.data);
    lastT = timeS;
    // The table's outline at ball height, grown by a ball radius so balls at a cushion count.
    const g = smallestR;
    const quad = [
      { x: -g, y: -g },
      { x: W + g, y: -g },
      { x: W + g, y: L + g },
      { x: -g, y: L + g },
    ].map((p) => projectPoint(camera, { x: p.x, y: p.y, z: smallestR }));
    rows = [];
    for (let j = 0; j < heightPx; j++) {
      const y = j + 0.5;
      let from = Number.POSITIVE_INFINITY;
      let to = Number.NEGATIVE_INFINITY;
      for (let k = 0; k < 4; k++) {
        const a = quad[k];
        const b = quad[(k + 1) % 4];
        if (!a || !b) continue;
        if ((a.v <= y && b.v > y) || (b.v <= y && a.v > y)) {
          const u = a.u + ((y - a.v) / (b.v - a.v)) * (b.u - a.u);
          from = Math.min(from, u);
          to = Math.max(to, u);
        }
      }
      rows.push({
        from: Math.max(0, Math.ceil(from - 0.5)),
        to: Math.min(widthPx - 1, Math.floor(to - 0.5)),
      });
    }
    // Each ball's colour, from the middle of its disc.
    for (const b of balls) {
      const px = disc(b, 0.6);
      const c: [number, number, number] = [0, 0, 0];
      for (const p of px)
        for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (image.data[4 * p + k] as number);
      if (px.length > 0) for (let k = 0; k < 3; k++) c[k] = (c[k] as number) / px.length;
      b.colour = c;
      b.seenAtS = timeS;
    }
    // The cloth's colour: the median chromaticity and brightness of table pixels off the balls.
    const taken = new Set<number>();
    for (const b of balls) for (const p of disc(b, 1.6)) taken.add(p);
    const rs: number[] = [];
    const gs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < heightPx; j += 3) {
      const row = rows[j];
      if (!row) continue;
      for (let i = row.from; i <= row.to; i += 3) {
        const p = j * widthPx + i;
        if (taken.has(p)) continue;
        const r = image.data[4 * p] as number;
        const gg = image.data[4 * p + 1] as number;
        const bb = image.data[4 * p + 2] as number;
        const s = r + gg + bb + 1;
        rs.push(r / s);
        gs.push(gg / s);
        ys.push(s);
      }
    }
    const median = (a: number[]) => {
      a.sort((p, q) => p - q);
      return a[Math.floor(a.length / 2)] ?? 0;
    };
    clothChroma = [median(rs), median(gs)];
    clothBright = median(ys);
  }

  /** The pixel differs from the background, other than by a shadow. */
  const changed = (data: Uint8ClampedArray, p: number): boolean => {
    const bg = background as Uint8ClampedArray;
    let differs = false;
    let kSum = 0;
    let kMin = Number.POSITIVE_INFINITY;
    let kMax = Number.NEGATIVE_INFINITY;
    for (let c = 0; c < 3; c++) {
      const f = data[4 * p + c] as number;
      const b = bg[4 * p + c] as number;
      if (Math.abs(f - b) > options.diffLevel) differs = true;
      const k = (f + 1) / (b + 1);
      kSum += k;
      if (k < kMin) kMin = k;
      if (k > kMax) kMax = k;
    }
    if (!differs) return false;
    const k = kSum / 3;
    const shadow = k >= SHADOW_MIN && k <= SHADOW_MAX && kMax - kMin <= SHADOW_SPREAD * 3;
    return !shadow;
  };

  const clothLike = (data: Uint8ClampedArray, p: number): boolean => {
    const r = data[4 * p] as number;
    const g = data[4 * p + 1] as number;
    const b = data[4 * p + 2] as number;
    const s = r + g + b + 1;
    if (s < clothBright * CLOTH_BRIGHT_MIN || s > clothBright * CLOTH_BRIGHT_MAX) return false;
    const dr = r / s - clothChroma[0];
    const dg = g / s - clothChroma[1];
    return Math.sqrt(dr * dr + dg * dg) <= CLOTH_CHROMA;
  };

  /** Copies the frame into the background over a ball's place (it now shows what is there). */
  const refresh = (data: Uint8ClampedArray, at: { x: number; y: number }, r: number) => {
    const bg = background as Uint8ClampedArray;
    const ghost = { ...at, radiusM: r } as Ball;
    for (const p of disc(ghost, 1.5)) {
      for (let c = 0; c < 4; c++) bg[4 * p + c] = data[4 * p + c] as number;
    }
  };

  /** Blobs of evidence pixels on the table. */
  function blobs(data: Uint8ClampedArray): Blob[] {
    const evidence = new Uint8Array(widthPx * heightPx);
    for (let j = 0; j < heightPx; j++) {
      const row = rows[j];
      if (!row) continue;
      for (let i = row.from; i <= row.to; i++) {
        const p = j * widthPx + i;
        if (changed(data, p) && !clothLike(data, p)) evidence[p] = 1;
      }
    }
    const out: Blob[] = [];
    const stack: number[] = [];
    for (let p = 0; p < evidence.length; p++) {
      if (evidence[p] !== 1) continue;
      evidence[p] = 2;
      stack.push(p);
      const blob: Blob = {
        pixels: [],
        sumU: 0,
        sumV: 0,
        colour: [0, 0, 0],
        minU: widthPx,
        maxU: 0,
        minV: heightPx,
        maxV: 0,
      };
      while (stack.length > 0) {
        const q = stack.pop() as number;
        const u = q % widthPx;
        const v = (q - u) / widthPx;
        blob.pixels.push(q);
        blob.sumU += u + 0.5;
        blob.sumV += v + 0.5;
        for (let c = 0; c < 3; c++)
          blob.colour[c] = (blob.colour[c] as number) + (data[4 * q + c] as number);
        if (u < blob.minU) blob.minU = u;
        if (u > blob.maxU) blob.maxU = u;
        if (v < blob.minV) blob.minV = v;
        if (v > blob.maxV) blob.maxV = v;
        const nbrs = [
          u > 0 ? q - 1 : -1,
          u < widthPx - 1 ? q + 1 : -1,
          v > 0 ? q - widthPx : -1,
          v < heightPx - 1 ? q + widthPx : -1,
        ];
        for (const n of nbrs) {
          if (n >= 0 && evidence[n] === 1) {
            evidence[n] = 2;
            stack.push(n);
          }
        }
      }
      const n = blob.pixels.length;
      for (let c = 0; c < 3; c++) blob.colour[c] = (blob.colour[c] as number) / n;
      out.push(blob);
    }
    return out;
  }

  const pottedNear = (b: Ball): boolean =>
    pockets.some((c) => Math.hypot(b.x - c.x, b.y - c.y) <= c.radiusM + 2 * b.radiusM);

  function snapshot(timeS: number, seen: Map<Ball, ImagePoint>): TrackedFrame {
    return {
      timeS,
      balls: balls.map((b) => {
        const at = seen.get(b);
        return {
          id: b.id,
          kind: b.kind,
          state: b.state,
          x: b.x,
          y: b.y,
          vx: b.vx,
          vy: b.vy,
          ...(at ? { seen: at } : {}),
        };
      }),
    };
  }

  return {
    push(image, timeS) {
      if (!background) {
        setup(image, timeS);
        return snapshot(timeS, new Map());
      }
      const dt = Math.max(1e-6, timeS - lastT);
      lastT = timeS;
      const data = image.data;

      // Which balls to look for: those moving or hidden, and resting ones whose place changed.
      const wanted: Ball[] = [];
      for (const b of balls) {
        if (b.state === "pocketed" || b.state === "lost") continue;
        if (b.state === "rest") {
          const px = disc(b, 0.8);
          let n = 0;
          for (const p of px) if (changed(data, p)) n++;
          if (px.length === 0 || n / px.length <= options.disturbedShare) continue;
        }
        wanted.push(b);
      }
      const seen = new Map<Ball, ImagePoint>();
      if (wanted.length === 0) return snapshot(timeS, seen);

      const found = blobs(data);
      const pxArea = (b: Ball, at: { x: number; y: number }) => {
        const v = view(at, b.radiusM);
        return v ? Math.PI * v.radius * v.radius : 0;
      };
      // The smallest disc a ball can show on this table: the farthest corner, smallest ball.
      const farDiscPx = Math.min(
        ...[
          { x: 0, y: 0 },
          { x: W, y: 0 },
          { x: W, y: L },
          { x: 0, y: L },
        ].map((p) => {
          const v = view(p, smallestR);
          return v ? Math.PI * v.radius * v.radius : Number.POSITIVE_INFINITY;
        }),
      );

      // Candidate matches: each wanted ball with each blob near its prediction.
      interface Match {
        ball: Ball;
        blob: number;
        cost: number;
      }
      const matches: Match[] = [];
      for (const b of wanted) {
        const moving = b.state === "moving" || b.state === "hidden";
        const pred = { x: b.x + b.vx * dt, y: b.y + b.vy * dt };
        const speed = Math.hypot(b.vx, b.vy);
        const travel = moving ? speed * dt : options.maxSpeedMps * dt;
        const gate = GATE_TRAVEL * travel + GATE_RADII * b.radiusM + (moving ? 0 : travel);
        const ref = view(pred, b.radiusM);
        if (!ref) continue;
        const area = Math.PI * ref.radius * ref.radius;
        // The most a ball can cover: its disc swept along a frame's travel (a streak).
        const travelPx = (travel / b.radiusM) * ref.radius;
        const mostPx = area + 2 * ref.radius * travelPx;
        found.forEach((blob, k) => {
          const n = blob.pixels.length;
          if (n < MIN_BLOB_SHARE * Math.min(area, farDiscPx)) return;
          const centre = { u: blob.sumU / n, v: blob.sumV / n };
          const at = imageToTableAtHeight(camera, centre, b.radiusM);
          if (!at) return;
          const d = Math.hypot(at.x - pred.x, at.y - pred.y);
          // A blob much larger than balls can be is something in the way.
          if (n / mostPx > OCCLUDER_BALLS) return;
          if (d > gate + Math.sqrt(n / Math.PI) * (b.radiusM / ref.radius)) return;
          let colourDiff = 0;
          for (let c = 0; c < 3; c++) {
            colourDiff += Math.abs((blob.colour[c] as number) - (b.colour[c] as number));
          }
          matches.push({ ball: b, blob: k, cost: d / gate + colourDiff / 765 });
        });
      }
      matches.sort((p, q) => p.cost - q.cost || balls.indexOf(p.ball) - balls.indexOf(q.ball));

      // Each ball takes its best blob; a blob takes as many balls as it is large enough for.
      // Moving balls choose first. A resting ball whose place changed takes only a blob no moving
      // ball has: its own pixels do not differ from the background while it is still there, so a
      // blob next to it is most likely a moving ball passing.
      const owners = new Map<number, Ball[]>();
      const assigned = new Set<Ball>();
      for (const pass of [false, true]) {
        for (const m of matches) {
          if (assigned.has(m.ball) || (m.ball.state === "rest") !== pass) continue;
          const blob = found[m.blob] as Blob;
          const list = owners.get(m.blob) ?? [];
          if (pass && list.length > 0) continue;
          const area = pxArea(m.ball, m.ball);
          const capacity = Math.max(1, Math.round(blob.pixels.length / Math.max(1, area)));
          if (list.length >= capacity) continue;
          list.push(m.ball);
          owners.set(m.blob, list);
          assigned.add(m.ball);
        }
      }

      // Where each ball is: the middle of its blob, or of its share of a shared blob.
      for (const [k, owned] of owners) {
        const blob = found[k] as Blob;
        const centres = owned.map((b) => {
          const v = view({ x: b.x + b.vx * dt, y: b.y + b.vy * dt }, b.radiusM);
          return v
            ? { ...v.centre }
            : { u: blob.sumU / blob.pixels.length, v: blob.sumV / blob.pixels.length };
        });
        if (owned.length === 1) {
          centres[0] = { u: blob.sumU / blob.pixels.length, v: blob.sumV / blob.pixels.length };
        } else {
          for (let iter = 0; iter < 5; iter++) {
            const sums = centres.map(() => ({ u: 0, v: 0, n: 0 }));
            for (const q of blob.pixels) {
              const u = (q % widthPx) + 0.5;
              const v = Math.floor(q / widthPx) + 0.5;
              let best = 0;
              let bestD = Number.POSITIVE_INFINITY;
              centres.forEach((c, i) => {
                const d = (c.u - u) * (c.u - u) + (c.v - v) * (c.v - v);
                if (d < bestD) {
                  bestD = d;
                  best = i;
                }
              });
              const s = sums[best] as { u: number; v: number; n: number };
              s.u += u;
              s.v += v;
              s.n++;
            }
            sums.forEach((s, i) => {
              if (s.n > 0) centres[i] = { u: s.u / s.n, v: s.v / s.n };
            });
          }
        }
        owned.forEach((b, i) => {
          const c = centres[i] as ImagePoint;
          const at = imageToTableAtHeight(camera, c, b.radiusM);
          if (!at) return;
          const vx = (at.x - b.x) / dt;
          const vy = (at.y - b.y) / dt;
          const fresh = b.state === "rest";
          if (fresh) b.leftFrom = { x: b.x, y: b.y };
          b.vx = fresh ? vx : VELOCITY_GAIN * vx + (1 - VELOCITY_GAIN) * b.vx;
          b.vy = fresh ? vy : VELOCITY_GAIN * vy + (1 - VELOCITY_GAIN) * b.vy;
          b.x = at.x;
          b.y = at.y;
          b.seenAtS = timeS;
          b.state = "moving";
          seen.set(b, c);
        });
      }

      // Balls looked for and not found: hidden (moving on as predicted), potted, or lost.
      for (const b of wanted) {
        if (seen.has(b)) continue;
        if (b.state === "rest") continue; // its place changed, but nothing like it moved off
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (pottedNear(b)) {
          b.state = "pocketed";
          b.vx = 0;
          b.vy = 0;
        } else if (timeS - b.seenAtS > options.lostAfterS) {
          b.state = "lost";
        } else {
          b.state = "hidden";
        }
      }

      // Balls that have stopped rest again, and become part of the background; places left
      // behind are cleaned once the ball is clear of them.
      for (const b of balls) {
        if (b.state !== "moving" || !seen.has(b)) continue;
        if (b.leftFrom && Math.hypot(b.x - b.leftFrom.x, b.y - b.leftFrom.y) > 3 * b.radiusM) {
          const clear = balls.every(
            (o) =>
              o === b ||
              o.state === "pocketed" ||
              Math.hypot(
                o.x - (b.leftFrom as { x: number }).x,
                o.y - (b.leftFrom as { y: number }).y,
              ) >
                3 * o.radiusM,
          );
          if (clear) refresh(data, b.leftFrom, b.radiusM);
          delete b.leftFrom;
        }
        if (Math.hypot(b.vx, b.vy) < options.restSpeedMps) {
          b.slow++;
          if (b.slow >= options.restFrames) {
            b.state = "rest";
            b.vx = 0;
            b.vy = 0;
            b.slow = 0;
            refresh(data, b, b.radiusM);
          }
        } else {
          b.slow = 0;
        }
      }
      return snapshot(timeS, seen);
    },
  };
}
