import {
  CUE_BALL_COLOUR,
  CUSHION_TOP_DEPTH_M,
  ballAppearance,
  ballSizeOf,
  noseContactDistanceM,
  pocketDropCircles,
} from "@baize/tables";
import type { BallKind, BallSetSpec, LayoutBall, TableSpec } from "@baize/tables";
import { apparentRadiusPx, imageToTableAtHeight, projectPoint } from "../geometry/camera";
import { toWorkImage } from "../image/pixels";
import type { WorkImage } from "../image/pixels";
import { clothMask, findClothModel, tintOf } from "../table/clothModel";
import type { Camera, PhotoImage } from "../types";

/**
 * Finding balls without a trained model.
 *
 * A ball is something on the cloth that is not the colour of the cloth and has the size a
 * ball must have where it stands. For every pixel that is not cloth, the finder asks: if a
 * ball's centre were seen here, where on the table would the ball be (the ray through the
 * pixel, cut one ball radius above the cloth), how big would it look, and how much of that
 * disc is in fact not cloth? Discs that are well filled, with cloth around them, are balls.
 * The best ones are taken first, and none may stand inside another. Working from the table
 * position, not from shapes in the picture, is what copes with balls that hide part of each
 * other, as in a rack.
 *
 * Each ball is then named by its colour against the colours of the ball set, respecting how
 * many of each kind the set has. Brightness is judged against the brightest ball found, which
 * stands in for white.
 *
 * What this cannot do, and says so through low confidence or by missing the ball: a ball of
 * the cloth's own colour (the green on a green snooker cloth), the numbers on pool balls,
 * telling the pool balls that share a colour apart beyond solid or striped, and anything in
 * poor light. Those are what the trained detector of stage B is for.
 */

export interface FoundBall extends LayoutBall {
  /** Always set: how sure the finder is, 0 to 1, of both the ball and its kind. */
  confidence: number;
}

/** Longer side of the working copy of the photo, pixels. A far ball must still be a few across. */
const WORK_SIDE = 1200;
/** A disc must be at least this full of not-cloth to be a ball. Tuned on synthetic photos. */
const MIN_FILL = 0.55;
/** Width of the ring around a disc that should be cloth, as a share of the ball's radius. */
const RING = 0.45;
/** How much a filled ring counts against a disc. */
const RING_WEIGHT = 0.35;
/** Balls smaller than this in the working image cannot be judged, pixels. */
const MIN_RADIUS_PX = 1.6;
/** Two balls may be found this much closer than touching (pixels are coarse), as a share of 2R. */
const OVERLAP_ALLOWED = 0.12;
/** The rail's colour is read from this strip beyond the cushions, metres from their edge. */
const RAIL_SAMPLE_FROM_M = 0.01;
const RAIL_SAMPLE_TO_M = 0.06;
/** A pixel is rail-coloured within this tint distance and this share of the rail's brightness. */
const RAIL_TINT = 0.12;
const RAIL_BRIGHT = 0.45;
/** Pocket openings: darker than this share of the cloth, within this multiple of the drop radius. */
const POCKET_DARK = 0.45;
const POCKET_REACH = 1.25;
/** Slack inside the cushions for a ball's centre, metres: half a centimetre of pixel error. */
const CUSHION_SLACK_M = 0.005;

interface Disc {
  /** Table position of the ball. */
  x: number;
  y: number;
  /** Centre and radius in working pixels. */
  u: number;
  v: number;
  r: number;
  score: number;
}

function hexToYcc(hex: string): { y: number; cb: number; cr: number } {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return { y, cb: 0.564 * (b - y), cr: 0.713 * (r - y) };
}

/** Share of the pixels of a disc (and of the ring around it) that are not cloth. */
function coverage(
  mask: Uint8Array,
  width: number,
  height: number,
  u: number,
  v: number,
  r: number,
): { fill: number; ring: number; cu: number; cv: number } {
  const outer = r * (1 + RING);
  const x0 = Math.max(0, Math.floor(u - outer));
  const x1 = Math.min(width - 1, Math.ceil(u + outer));
  const y0 = Math.max(0, Math.floor(v - outer));
  const y1 = Math.min(height - 1, Math.ceil(v + outer));
  let inAll = 0;
  let inSet = 0;
  let ringAll = 0;
  let ringSet = 0;
  let su = 0;
  let sv = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - u;
      const dy = y + 0.5 - v;
      const d2 = dx * dx + dy * dy;
      if (d2 > outer * outer) continue;
      const set = mask[y * width + x] === 1;
      if (d2 <= r * r) {
        inAll++;
        if (set) {
          inSet++;
          su += x + 0.5;
          sv += y + 0.5;
        }
      } else {
        ringAll++;
        if (set) ringSet++;
      }
    }
  }
  return {
    fill: inAll > 0 ? inSet / inAll : 0,
    ring: ringAll > 0 ? ringSet / ringAll : 0,
    cu: inSet > 0 ? su / inSet : u,
    cv: inSet > 0 ? sv / inSet : v,
  };
}

/**
 * Finds the balls on a table whose corners (and so its camera) are known. `camera` must be
 * the camera in the playing area's coordinates, as `findTable` returns it or as recovered
 * from corners placed by hand.
 */
export function findBalls(
  image: PhotoImage,
  table: TableSpec,
  ballSet: BallSetSpec,
  camera: Camera,
): FoundBall[] {
  const img = toWorkImage(image, WORK_SIDE);
  const cloth = findClothModel(img);
  if (!cloth) return [];
  const isCloth = clothMask(img, cloth);
  const { widthM: W, lengthM: L } = table.playingArea;
  const radiusM = ballSet.object.diameterM / 2;
  const margin = noseContactDistanceM(radiusM, table.cushion.noseHeightM) - CUSHION_SLACK_M;
  const pockets = pocketDropCircles(table);
  const s = img.scale;
  // The camera works in photo pixels; the working image is `s` times smaller.
  const toTable = (u: number, v: number): { x: number; y: number } | undefined =>
    imageToTableAtHeight(camera, { u: u * s, v: v * s }, radiusM);
  const onTable = (p: { x: number; y: number }): boolean => {
    if (p.x < margin || p.x > W - margin || p.y < margin || p.y > L - margin) return false;
    for (const c of pockets) {
      if (Math.hypot(p.x - c.x, p.y - c.y) < c.radiusM) return false;
    }
    return true;
  };

  // Where each pixel is on the plane of the cloth (as opposed to at the height of a ball).
  const onCloth = (u: number, v: number): { x: number; y: number } | undefined =>
    imageToTableAtHeight(camera, { u: u * s, v: v * s }, 0);
  const depth = CUSHION_TOP_DEPTH_M;
  /** How far outside the playing area a point of the cloth plane is (0 inside). */
  const outside = (p: { x: number; y: number }): number =>
    Math.max(0, -p.x, p.x - W, -p.y, p.y - L);

  // The colour of the rails, from the strip just beyond the cushions. The far rail is seen
  // right behind any ball on the far cushion, and without this it would pass for balls.
  let rn = 0;
  let ry = 0;
  let rb = 0;
  let rr = 0;
  for (let y = 0; y < img.height; y += 2) {
    for (let x = 0; x < img.width; x += 2) {
      const at = y * img.width + x;
      if (isCloth[at] === 1) continue;
      const p = onCloth(x + 0.5, y + 0.5);
      if (!p) continue;
      const out = outside(p);
      if (out < depth + RAIL_SAMPLE_FROM_M || out > depth + RAIL_SAMPLE_TO_M) continue;
      const luma = img.y[at] as number;
      rn++;
      ry += luma;
      rb += tintOf(luma, img.cb[at] as number);
      rr += tintOf(luma, img.cr[at] as number);
    }
  }
  const rail = rn >= 20 ? { y: ry / rn, tintB: rb / rn, tintR: rr / rn } : undefined;
  const isRail = (at: number): boolean => {
    if (!rail) return false;
    const luma = img.y[at] as number;
    if (luma < rail.y * (1 - RAIL_BRIGHT) || luma > rail.y * (1 + RAIL_BRIGHT)) return false;
    const db = tintOf(luma, img.cb[at] as number) - rail.tintB;
    const dr = tintOf(luma, img.cr[at] as number) - rail.tintR;
    return db * db + dr * dr < RAIL_TINT * RAIL_TINT;
  };

  // Not cloth, and where a ball could be: the mask the discs are scored on. A pixel counts
  // only if something at the height of a ball could be seen there over the playing area or
  // its cushions. Left out: the room, rail-coloured pixels beyond the cushions, and the
  // dark of the pockets.
  const reach = margin - radiusM * 3;
  const mask = new Uint8Array(img.width * img.height);
  const candidates: number[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const at = y * img.width + x;
      if (isCloth[at] === 1) continue;
      const p = toTable(x + 0.5, y + 0.5);
      if (!p) continue;
      if (p.x < reach || p.x > W - reach || p.y < reach || p.y > L - reach) continue;
      const flat = onCloth(x + 0.5, y + 0.5);
      if (flat) {
        if (outside(flat) > depth && isRail(at)) continue;
        const luma = img.y[at] as number;
        if (
          luma < POCKET_DARK * cloth.y &&
          pockets.some((c) => Math.hypot(flat.x - c.x, flat.y - c.y) < c.radiusM * POCKET_REACH)
        ) {
          continue;
        }
      }
      mask[at] = 1;
      if (onTable(p)) candidates.push(at);
    }
  }

  // Score a disc at every candidate pixel.
  const discs: Disc[] = [];
  for (const at of candidates) {
    const x = at % img.width;
    const y = (at - x) / img.width;
    const u = x + 0.5;
    const v = y + 0.5;
    const p = toTable(u, v);
    if (!p) continue;
    const r = (apparentRadiusPx(camera, { x: p.x, y: p.y, z: radiusM }, radiusM) ?? 0) / s;
    if (r < MIN_RADIUS_PX) continue;
    const c = coverage(mask, img.width, img.height, u, v, r);
    if (c.fill < MIN_FILL) continue;
    discs.push({ x: p.x, y: p.y, u, v, r, score: c.fill - RING_WEIGHT * c.ring });
  }
  discs.sort((a, b) => b.score - a.score || a.v - b.v || a.u - b.u);

  // Take the best discs first; none may stand inside one already taken.
  const minGap = 2 * radiusM * (1 - OVERLAP_ALLOWED);
  const taken: Disc[] = [];
  for (const d of discs) {
    // Move the disc onto the middle of what it covers, twice, and score it there.
    let cur = d;
    for (let pass = 0; pass < 2; pass++) {
      const c = coverage(mask, img.width, img.height, cur.u, cur.v, cur.r);
      const p = toTable(c.cu, c.cv);
      if (!p || !onTable(p)) break;
      const r = (apparentRadiusPx(camera, { x: p.x, y: p.y, z: radiusM }, radiusM) ?? 0) / s;
      if (r < MIN_RADIUS_PX) break;
      const again = coverage(mask, img.width, img.height, c.cu, c.cv, r);
      const score = again.fill - RING_WEIGHT * again.ring;
      if (score < cur.score) break;
      cur = { x: p.x, y: p.y, u: c.cu, v: c.cv, r, score };
    }
    if (taken.some((t) => Math.hypot(t.x - cur.x, t.y - cur.y) < minGap)) continue;
    taken.push(cur);
  }

  return nameBalls(img, taken, ballSet);
}

interface Seen {
  disc: Disc;
  /** Mean brightness and tint of the coloured part, and the share of the disc that is white. */
  y: number;
  tintB: number;
  tintR: number;
  white: number;
}

/** A pixel is "white" when it is bright against the brightest ball and has almost no tint. */
const WHITE_TINT = 0.09;
const WHITE_BRIGHT = 0.62;

function look(img: WorkImage, disc: Disc, whiteY: number): Seen {
  const r = disc.r * 0.8;
  let n = 0;
  let white = 0;
  let cn = 0;
  let sy = 0;
  let sb = 0;
  let sr = 0;
  const x0 = Math.max(0, Math.floor(disc.u - r));
  const x1 = Math.min(img.width - 1, Math.ceil(disc.u + r));
  const y0 = Math.max(0, Math.floor(disc.v - r));
  const y1 = Math.min(img.height - 1, Math.ceil(disc.v + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - disc.u;
      const dy = y + 0.5 - disc.v;
      if (dx * dx + dy * dy > r * r) continue;
      const at = y * img.width + x;
      const luma = img.y[at] as number;
      const tb = tintOf(luma, img.cb[at] as number);
      const tr = tintOf(luma, img.cr[at] as number);
      n++;
      if (Math.hypot(tb, tr) < WHITE_TINT && luma > WHITE_BRIGHT * whiteY) {
        white++;
      } else {
        cn++;
        sy += luma;
        sb += tb;
        sr += tr;
      }
    }
  }
  return {
    disc,
    y: cn > 0 ? sy / cn : whiteY,
    tintB: cn > 0 ? sb / cn : 0,
    tintR: cn > 0 ? sr / cn : 0,
    white: n > 0 ? white / n : 0,
  };
}

/** Names the found discs from the colours of the ball set, within the set's counts. */
function nameBalls(img: WorkImage, discs: readonly Disc[], ballSet: BallSetSpec): FoundBall[] {
  if (discs.length === 0) return [];
  // The brightest pixels on any ball stand in for white under this light.
  let whiteY = 1;
  for (const d of discs) {
    const x = Math.min(img.width - 1, Math.max(0, Math.floor(d.u)));
    const y = Math.min(img.height - 1, Math.max(0, Math.floor(d.v)));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(img.height - 1, Math.max(0, y + dy));
        const xx = Math.min(img.width - 1, Math.max(0, x + dx));
        whiteY = Math.max(whiteY, img.y[yy * img.width + xx] as number);
      }
    }
  }
  const seen = discs.map((d) => look(img, d, whiteY));
  const whiteRef = hexToYcc(CUE_BALL_COLOUR).y;

  interface Kind {
    kind: BallKind;
    left: number;
    striped: boolean;
    cue: boolean;
    y: number;
    tintB: number;
    tintR: number;
  }
  const kinds: Kind[] = ballSet.kinds.map(({ kind, count }) => {
    const a = ballAppearance(kind);
    const c = hexToYcc(a.colour);
    return {
      kind,
      left: count,
      striped: a.striped,
      cue: kind === "cue",
      y: c.y / whiteRef,
      tintB: tintOf(c.y, c.cb),
      tintR: tintOf(c.y, c.cr),
    };
  });

  /** How unlike a kind a seen ball is: 0 is a perfect match. */
  const cost = (b: Seen, k: Kind): number => {
    if (k.cue) {
      // Nearly all white.
      return 1.2 * (1 - b.white) + 0.3 * Math.hypot(b.tintB, b.tintR);
    }
    const tint = Math.hypot(b.tintB - k.tintB, b.tintR - k.tintR);
    const bright = Math.abs(b.y / whiteY - k.y);
    // A striped ball shows a good share of white; a solid one shows little (a highlight).
    const whiteWanted = k.striped ? 0.45 : 0.03;
    return 1.6 * tint + 0.6 * bright + 0.9 * Math.abs(b.white - whiteWanted);
  };

  // Hand out kinds best match first, never more of a kind than the set has.
  const pairs: { ball: number; kind: number; cost: number }[] = [];
  seen.forEach((b, i) => {
    kinds.forEach((k, j) => {
      pairs.push({ ball: i, kind: j, cost: cost(b, k) });
    });
  });
  pairs.sort((a, b) => a.cost - b.cost || a.ball - b.ball || a.kind - b.kind);
  const chosen: (number | undefined)[] = seen.map(() => undefined);
  const chosenCost: number[] = seen.map(() => 0);
  for (const p of pairs) {
    if (chosen[p.ball] !== undefined) continue;
    const k = kinds[p.kind] as Kind;
    if (k.left <= 0) continue;
    k.left--;
    chosen[p.ball] = p.kind;
    chosenCost[p.ball] = p.cost;
  }

  const out: FoundBall[] = [];
  seen.forEach((b, i) => {
    const pick = chosen[i];
    // More discs than the set has balls: the extra ones are not balls of this set.
    if (pick === undefined) return;
    const k = kinds[pick] as Kind;
    // The runner-up among other kinds: a close second means the name is a guess.
    let second = Number.POSITIVE_INFINITY;
    kinds.forEach((other, j) => {
      if (j !== pick) second = Math.min(second, cost(b, other));
    });
    const own = chosenCost[i] as number;
    const margin = Number.isFinite(second) ? Math.max(0, Math.min(1, (second - own) / 0.25)) : 1;
    const fit = Math.max(0, Math.min(1, 1 - own / 0.6));
    const shape = Math.max(0, Math.min(1, (b.disc.score - 0.3) / 0.5));
    const confidence = Math.round(100 * Math.min(shape, 0.35 + 0.65 * Math.min(margin, fit))) / 100;
    out.push({ kind: k.kind, x: b.disc.x, y: b.disc.y, confidence });
  });
  return out;
}

/** For tests and the review screen: where a found ball's centre is in the photo. */
export function ballInPhoto(
  camera: Camera,
  ball: { x: number; y: number },
  ballSet: BallSetSpec,
  kind: BallKind,
): { u: number; v: number } | undefined {
  const r = ballSizeOf(ballSet, kind).diameterM / 2;
  return projectPoint(camera, { x: ball.x, y: ball.y, z: r });
}
