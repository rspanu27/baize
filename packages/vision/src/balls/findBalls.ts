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
import { clothMask, findClothModel, isCushionShade, tintOf } from "../table/clothModel";
import type { ClothModel } from "../table/clothModel";
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
/** The farthest ball should keep at least this radius in the working copy, pixels. */
const FAR_BALL_RADIUS_PX = 4;
/** The working copy is never larger than this on its longer side, whatever the balls need. */
const MAX_WORK_SIDE = 2400;
/** How far beyond the cushion noses the part of the photo that is worked on reaches, metres. */
const PART_MARGIN_M = 0.3;
/** A disc whose not-cloth pixels are less unlike the cloth than this is cloth (see `distinctness`). */
const DISTINCT_MIN = 1.6;
/** Dark balls among shaded cloth: darker than this share of the cloth. */
const DARK_BALL_BRIGHT = 0.75;
/** ... this full of dark, with at most this share of dark in the ring around, this much left to judge. */
const DARK_BALL_FILL = 0.75;
const DARK_BALL_RING = 0.2;
const DARK_BALL_FREE = 0.7;
/** ... at least this many ball diameters from every cushion, where shadows are. */
const DARK_BALL_CLEAR_BALLS = 1;
/** ... and big enough in the working image for its outline to mean something, pixels. */
const DARK_BALL_MIN_RADIUS_PX = 4;
/** The shape score given to a dark ball found this way: it is never a sure thing. */
const DARK_BALL_SCORE = 0.6;
/** A disc must be at least this full of not-cloth to be a ball. Tuned on synthetic photos. */
const MIN_FILL = 0.55;
/** Width of the ring around a disc that should be cloth, as a share of the ball's radius. */
const RING = 0.45;
/** How much a filled ring counts against a disc. */
const RING_WEIGHT = 0.35;
/** A taken ball explains the pixels within this multiple of its radius (its shadow too). */
const CLAIM_REACH = 1.25;
/** Beyond its own disc a ball explains only pixels darker than this share of the cloth. */
const SHADOW_BRIGHT = 0.75;
/** A ball needs at least this share of its disc left to judge. */
const MIN_FREE = 0.45;
/** A patch of not-cloth joined to the surround counts as surround from this length, in balls. */
const SURROUND_MIN_LENGTH_BALLS = 3;
/** How far in from the cushions such a patch is left out of the judging, metres. */
const SURROUND_REACH_M = 0.06;
/** Width of the strip of bed along each cushion that is left out of the judging, metres. */
const NOSE_STRIP_M = 0.015;
/** Pockets and their hardware: left out within this multiple of the drop radius. */
const POCKET_ZONE = 1.6;
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

/**
 * Share of the pixels of a disc (and of the ring around it) that are not cloth. Pixels in
 * `skip` say nothing about this disc (they are explained by a ball already taken, or lie
 * where cushions, their shadows and pockets are): they count neither for the disc nor
 * against it, and `free` is the share of the disc that is left to judge.
 */
function coverage(
  mask: Uint8Array,
  skip: Uint8Array,
  width: number,
  height: number,
  u: number,
  v: number,
  r: number,
): { fill: number; ring: number; cu: number; cv: number; free: number } {
  const outer = r * (1 + RING);
  const x0 = Math.max(0, Math.floor(u - outer));
  const x1 = Math.min(width - 1, Math.ceil(u + outer));
  const y0 = Math.max(0, Math.floor(v - outer));
  const y1 = Math.min(height - 1, Math.ceil(v + outer));
  let inAll = 0;
  let inDisc = 0;
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
      const skipped = skip[y * width + x] === 1;
      if (d2 <= r * r) {
        inDisc++;
        if (skipped) continue;
        inAll++;
        if (set) {
          inSet++;
          su += x + 0.5;
          sv += y + 0.5;
        }
      } else if (!skipped) {
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
    free: inDisc > 0 ? inAll / inDisc : 0,
  };
}

/**
 * How unlike the cloth the not-cloth pixels of a disc are, on average: for each, the larger
 * of its tint distance in units of the cloth's tint radius and three times its relative
 * difference in brightness, capped at 4. About 1 is a pixel that only just fails to be
 * cloth; a ball is 2 or more.
 */
function distinctness(img: WorkImage, mask: Uint8Array, cloth: ClothModel, d: Disc): number {
  const x0 = Math.max(0, Math.floor(d.u - d.r));
  const x1 = Math.min(img.width - 1, Math.ceil(d.u + d.r));
  const y0 = Math.max(0, Math.floor(d.v - d.r));
  const y1 = Math.min(img.height - 1, Math.ceil(d.v + d.r));
  let n = 0;
  let sum = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - d.u;
      const dy = y + 0.5 - d.v;
      const at = y * img.width + x;
      if (dx * dx + dy * dy > d.r * d.r || mask[at] !== 1) continue;
      const luma = img.y[at] as number;
      const tint =
        Math.hypot(
          tintOf(luma, img.cb[at] as number) - cloth.tintB,
          tintOf(luma, img.cr[at] as number) - cloth.tintR,
        ) / cloth.tintRadius;
      const bright = (3 * Math.abs(luma - cloth.y)) / cloth.y;
      n++;
      sum += Math.min(4, Math.max(tint, bright));
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Finds the balls on a table whose corners (and so its camera) are known. `camera` must be
 * the camera in table coordinates with heights measured from the cloth, as `findTable` and
 * `cameraFromCorners` return it.
 */
export function findBalls(
  image: PhotoImage,
  table: TableSpec,
  ballSet: BallSetSpec,
  camera: Camera,
  /** Height above the cloth of the cushion tops and rails as seen; the nose height by default. */
  surroundHeightM: number = table.cushion.noseHeightM,
  /** For tests: `darkPass: false` leaves out the second pass for dark balls. */
  passes: { darkPass?: boolean } = {},
): FoundBall[] {
  const { widthM: W, lengthM: L } = table.playingArea;
  // Work on the part of the photo that holds the table and its rails, not on all of it: a
  // table that fills a fifth of the photo would otherwise be shrunk until a ball is three
  // pixels across.
  let part: { u0: number; v0: number; u1: number; v1: number } | undefined = {
    u0: Number.POSITIVE_INFINITY,
    v0: Number.POSITIVE_INFINITY,
    u1: Number.NEGATIVE_INFINITY,
    v1: Number.NEGATIVE_INFINITY,
  };
  for (const [x, y] of [
    [-PART_MARGIN_M, -PART_MARGIN_M],
    [W + PART_MARGIN_M, -PART_MARGIN_M],
    [W + PART_MARGIN_M, L + PART_MARGIN_M],
    [-PART_MARGIN_M, L + PART_MARGIN_M],
  ] as const) {
    for (const z of [0, 2 * ballSet.object.diameterM]) {
      const seen = projectPoint(camera, { x, y, z });
      if (!seen || !part) {
        part = undefined;
        break;
      }
      part.u0 = Math.min(part.u0, seen.u);
      part.v0 = Math.min(part.v0, seen.v);
      part.u1 = Math.max(part.u1, seen.u);
      part.v1 = Math.max(part.v1, seen.v);
    }
  }
  // How much to shrink: as for the whole photo (averaging blocks of pixels is what quiets
  // the noise), but no more than leaves the farthest ball a few pixels of radius.
  const wholeBlock = Math.max(1, Math.ceil(Math.max(image.widthPx, image.heightPx) / WORK_SIDE));
  let farRadiusPx = Number.POSITIVE_INFINITY;
  const ballR = ballSet.object.diameterM / 2;
  for (const [x, y] of [
    [0, 0],
    [W, 0],
    [W, L],
    [0, L],
  ] as const) {
    const r = apparentRadiusPx(camera, { x, y, z: ballR }, ballR);
    if (r !== undefined) farRadiusPx = Math.min(farRadiusPx, r);
  }
  // Whole pixels, inside the photo: the same bounds the copy below uses, so that the detail
  // chosen is the detail used.
  const bounds = part
    ? {
        u0: Math.max(0, Math.min(image.widthPx - 1, Math.floor(part.u0))),
        v0: Math.max(0, Math.min(image.heightPx - 1, Math.floor(part.v0))),
        u1: Math.max(1, Math.min(image.widthPx, Math.ceil(part.u1))),
        v1: Math.max(1, Math.min(image.heightPx, Math.ceil(part.v1))),
      }
    : undefined;
  const partSide = bounds
    ? Math.max(bounds.u1 - bounds.u0, bounds.v1 - bounds.v0)
    : Math.max(image.widthPx, image.heightPx);
  const block = Math.max(
    1,
    Math.ceil(partSide / MAX_WORK_SIDE),
    Math.min(wholeBlock, Math.floor(farRadiusPx / FAR_BALL_RADIUS_PX)),
  );
  const img = toWorkImage(image, MAX_WORK_SIDE, bounds, block);
  const cloth = findClothModel(img);
  if (!cloth) return [];
  // Pixels taken for cloth in shadow: darker than the cloth, with its hue. A dark ball that
  // mirrors the cloth (the black, or a blue ball on a blue cloth) is among them.
  const shade = new Uint8Array(img.width * img.height);
  const isCloth = clothMask(img, cloth, shade);
  const radiusM = ballSet.object.diameterM / 2;
  const margin = noseContactDistanceM(radiusM, table.cushion.noseHeightM) - CUSHION_SLACK_M;
  const pockets = pocketDropCircles(table);
  const s = img.scale;
  const ou = img.originU;
  const ov = img.originV;
  // The camera works in photo pixels; the working image is `s` times smaller.
  const toTable = (u: number, v: number): { x: number; y: number } | undefined =>
    imageToTableAtHeight(camera, { u: ou + u * s, v: ov + v * s }, radiusM);
  const onTable = (p: { x: number; y: number }): boolean => {
    if (p.x < margin || p.x > W - margin || p.y < margin || p.y > L - margin) return false;
    for (const c of pockets) {
      if (Math.hypot(p.x - c.x, p.y - c.y) < c.radiusM) return false;
    }
    return true;
  };

  // Where each pixel is if it shows the top of a cushion or a rail (as opposed to a ball).
  const onCloth = (u: number, v: number): { x: number; y: number } | undefined =>
    imageToTableAtHeight(camera, { u: ou + u * s, v: ov + v * s }, surroundHeightM);
  // Where each pixel is if it shows the bed.
  const onBed = (u: number, v: number): { x: number; y: number } | undefined =>
    imageToTableAtHeight(camera, { u: ou + u * s, v: ov + v * s }, 0);
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
  // Pixels that cannot speak for a ball: the cushions and what lies beyond them, the strip
  // of bed under a cushion's overhang (in a real room it is in deep shadow, which is not the
  // colour of the cloth), and the pockets with their hardware. A ball standing there is
  // judged by the rest of its disc. Balls taken later add the pixels they explain.
  const skip = new Uint8Array(img.width * img.height);
  // Everything that is not cloth near the table, rails included, and how far inside the
  // cushions each such pixel is (negative: beyond them). Used below to find the surround.
  const solid = new Uint8Array(img.width * img.height);
  const insideM = new Float32Array(img.width * img.height);
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
        const inside = Math.min(flat.x, W - flat.x, flat.y, L - flat.y);
        // The face of a cushion. Seen from across the table, a cushion shows its face: the
        // band between its nose and the bed below it. A pixel is in that band when the ray
        // through it is inside the noses at nose height and at or beyond them at the height
        // of the bed. The face is cloth turned away from the light, deeper and darker than
        // the bed, and a row of discs fits along it. Pixels of that band with the cloth's
        // hue, or dark, are the cushion; anything else there is a ball in front of it.
        const bed = onBed(x + 0.5, y + 0.5);
        const insideBed = bed ? Math.min(bed.x, W - bed.x, bed.y, L - bed.y) : inside;
        if (
          inside >= 0 &&
          insideBed < NOSE_STRIP_M &&
          isCushionShade(cloth, img.y[at] as number, img.cb[at] as number, img.cr[at] as number)
        ) {
          skip[at] = 1;
          continue;
        }
        solid[at] = 1;
        insideM[at] = inside;
        if (
          inside < NOSE_STRIP_M ||
          pockets.some((c) => Math.hypot(flat.x - c.x, flat.y - c.y) < c.radiusM * POCKET_ZONE)
        ) {
          skip[at] = 1;
        }
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

  // The surround. Where a cushion is not recognised as cloth (in shadow, under coloured
  // light, or because a corner was placed a little off), it shows as a long band of
  // not-cloth joined to what lies beyond the cushions, and discs would fit all along it. A
  // connected patch that reaches beyond the cushions and is longer than a few balls is such
  // a band; the part of it near the cushions is left out. A ball away from the cushion
  // keeps the part of itself that sticks out; a ball frozen to a cushion of that kind is
  // lost, which is the price of not reporting a row of balls that are not there.
  {
    const { width, height } = img;
    const label = new Int32Array(width * height).fill(-1);
    const stack = new Int32Array(width * height);
    const longM = SURROUND_MIN_LENGTH_BALLS * 2 * radiusM;
    for (let start = 0; start < solid.length; start++) {
      if (solid[start] !== 1 || label[start] !== -1) continue;
      let top = 0;
      stack[top++] = start;
      label[start] = start;
      const members: number[] = [];
      let beyond = false;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      while (top > 0) {
        const at = stack[--top] as number;
        members.push(at);
        if ((insideM[at] as number) < 0) beyond = true;
        const x = at % width;
        const y = (at - x) / width;
        const flat = onCloth(x + 0.5, y + 0.5);
        if (flat) {
          if (flat.x < minX) minX = flat.x;
          if (flat.x > maxX) maxX = flat.x;
          if (flat.y < minY) minY = flat.y;
          if (flat.y > maxY) maxY = flat.y;
        }
        if (x > 0 && solid[at - 1] === 1 && label[at - 1] === -1) {
          label[at - 1] = start;
          stack[top++] = at - 1;
        }
        if (x < width - 1 && solid[at + 1] === 1 && label[at + 1] === -1) {
          label[at + 1] = start;
          stack[top++] = at + 1;
        }
        if (y > 0 && solid[at - width] === 1 && label[at - width] === -1) {
          label[at - width] = start;
          stack[top++] = at - width;
        }
        if (y < height - 1 && solid[at + width] === 1 && label[at + width] === -1) {
          label[at + width] = start;
          stack[top++] = at + width;
        }
      }
      if (!beyond || Math.max(maxX - minX, maxY - minY) < longM) continue;
      for (const at of members) {
        if ((insideM[at] as number) < SURROUND_REACH_M) skip[at] = 1;
      }
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
    const c = coverage(mask, skip, img.width, img.height, u, v, r);
    if (c.fill < MIN_FILL || c.free < MIN_FREE) continue;
    discs.push({ x: p.x, y: p.y, u, v, r, score: c.fill - RING_WEIGHT * c.ring });
  }
  discs.sort((a, b) => b.score - a.score || a.v - b.v || a.u - b.u);

  // Take the best discs first; none may stand inside one already taken.
  const minGap = 2 * radiusM * (1 - OVERLAP_ALLOWED);
  const taken: Disc[] = [];
  // A ball that is taken explains the pixels around it, its shadow included. A further ball
  // must be justified by what is left: the crescent of shadow beside a ball is not a second
  // ball, while a real neighbour is still mostly unexplained.
  const claim = (d: Disc): void => {
    const r = d.r * CLAIM_REACH;
    const x0 = Math.max(0, Math.floor(d.u - r));
    const x1 = Math.min(img.width - 1, Math.ceil(d.u + r));
    const y0 = Math.max(0, Math.floor(d.v - r));
    const y1 = Math.min(img.height - 1, Math.ceil(d.v + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - d.u;
        const dy = y + 0.5 - d.v;
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const at = y * img.width + x;
        // Its own disc, and beyond that only what is dark enough to be its shadow: the
        // bright side of a neighbour in a rack is not explained by this ball.
        if (d2 <= d.r * d.r || (img.y[at] as number) < SHADOW_BRIGHT * cloth.y) skip[at] = 1;
      }
    }
  };
  for (const d of discs) {
    // Move the disc onto the middle of what it covers, twice, and score it there.
    let cur = d;
    for (let pass = 0; pass < 2; pass++) {
      const c = coverage(mask, skip, img.width, img.height, cur.u, cur.v, cur.r);
      const p = toTable(c.cu, c.cv);
      if (!p || !onTable(p)) break;
      const r = (apparentRadiusPx(camera, { x: p.x, y: p.y, z: radiusM }, radiusM) ?? 0) / s;
      if (r < MIN_RADIUS_PX) break;
      const again = coverage(mask, skip, img.width, img.height, c.cu, c.cv, r);
      if (again.free < MIN_FREE || again.fill < MIN_FILL) break;
      const score = again.fill - RING_WEIGHT * again.ring;
      if (score < cur.score) break;
      cur = { x: p.x, y: p.y, u: c.cu, v: c.cv, r, score };
    }
    if (taken.some((t) => Math.hypot(t.x - cur.x, t.y - cur.y) < minGap)) continue;
    if (taken.length > 0) {
      const left = coverage(mask, skip, img.width, img.height, cur.u, cur.v, cur.r);
      if (left.free < MIN_FREE || left.fill < MIN_FILL) continue;
    }
    // A ball is clearly not cloth. A patch of cloth whose colour is a little off (a worn or
    // unevenly lit place) fills a disc as well as a ball does, but only just misses being
    // cloth.
    if (distinctness(img, mask, cloth, cur) < DISTINCT_MIN) continue;
    taken.push(cur);
    claim(cur);
  }

  // Dark balls that passed for shaded cloth. Shadow lies beside a ball or along a cushion,
  // and spreads; a ball is a full, round patch of it with lit cloth all around. Only such
  // patches are taken, away from the cushions, after the pixels of the balls above (and
  // their shadows) have been set aside.
  // Strict: not cloth, or dark shade. Broad: also the lighter shade of a ball of the cloth's
  // own colour. A disc is filled from the broad one; the ring around it, which must be lit
  // cloth, is judged by the strict one, so that a ball's softer shadow does not count against
  // it.
  const darkMask = new Uint8Array(img.width * img.height);
  const darkFill = new Uint8Array(img.width * img.height);
  const darkAt: number[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const at = y * img.width + x;
      if (skip[at] === 1) continue;
      // Such a ball is seldom all shade: its number, its stripe and its highlight are plainly
      // not cloth. Both count towards the disc; only the shade may be its centre.
      if (mask[at] === 1) {
        darkMask[at] = 1;
        darkFill[at] = 1;
        continue;
      }
      if (shade[at] !== 1) continue;
      // The lit side of a ball of the cloth's own colour (a blue ball on a blue cloth) is in
      // shade too, only less dark: it fills the disc. Centres must be dark.
      darkFill[at] = 1;
      if ((img.y[at] as number) > DARK_BALL_BRIGHT * cloth.y) continue;
      darkMask[at] = 1;
      const p = toTable(x + 0.5, y + 0.5);
      if (!p || !onTable(p)) continue;
      if (Math.min(p.x, W - p.x, p.y, L - p.y) < DARK_BALL_CLEAR_BALLS * 2 * radiusM) continue;
      darkAt.push(at);
    }
  }
  /** Fill and room from the broad mask, ring from the strict one. */
  const darkCoverage = (u: number, v: number, r: number) => {
    const fill = coverage(darkFill, skip, img.width, img.height, u, v, r);
    const ring = coverage(darkMask, skip, img.width, img.height, u, v, r).ring;
    return { fill: fill.fill, free: fill.free, cu: fill.cu, cv: fill.cv, ring };
  };
  const darkDiscs: Disc[] = [];
  for (const at of darkAt) {
    const x = at % img.width;
    const y = (at - x) / img.width;
    const p = toTable(x + 0.5, y + 0.5);
    if (!p) continue;
    const r = (apparentRadiusPx(camera, { x: p.x, y: p.y, z: radiusM }, radiusM) ?? 0) / s;
    if (r < DARK_BALL_MIN_RADIUS_PX) continue;
    // The dark pixels of such a ball lie on its shaded side, so a disc centred on one of
    // them is off the ball: move it onto the middle of what it covers, as above.
    let u = x + 0.5;
    let v = y + 0.5;
    let c = darkCoverage(u, v, r);
    for (let pass = 0; pass < 2; pass++) {
      const again = darkCoverage(c.cu, c.cv, r);
      if (again.fill - again.ring <= c.fill - c.ring) break;
      u = c.cu;
      v = c.cv;
      c = again;
    }
    if (c.fill < DARK_BALL_FILL || c.ring > DARK_BALL_RING || c.free < DARK_BALL_FREE) continue;
    const q = toTable(u, v);
    if (!q || !onTable(q)) continue;
    darkDiscs.push({ x: q.x, y: q.y, u, v, r, score: c.fill - c.ring });
  }
  darkDiscs.sort((a, b) => b.score - a.score || a.v - b.v || a.u - b.u);
  for (const d of passes.darkPass === false ? [] : darkDiscs) {
    if (taken.some((t) => Math.hypot(t.x - d.x, t.y - d.y) < minGap)) continue;
    const left = darkCoverage(d.u, d.v, d.r);
    if (left.fill < DARK_BALL_FILL || left.ring > DARK_BALL_RING || left.free < DARK_BALL_FREE) {
      continue;
    }
    // Its score among the other balls: a dark ball found this way is never a sure thing.
    taken.push({ ...d, score: Math.min(d.score, DARK_BALL_SCORE) });
    claim(d);
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
/**
 * How bright a black ball is seen against the brightest ball pixels, and how much its tint
 * counts. Measured on the pix2pockets pictures (2026-11-15): the 8 ball's median is 0.17
 * against 0.08 for its paint, and on a blue cloth it looks bluish enough to be named the 2
 * or the 4 when its tint counts fully (half of all 8 balls were named so).
 */
const BLACK_SEEN_BRIGHTNESS = 0.17;
const BLACK_TINT_WEIGHT = 0.3;
/** Below this brightness (against white) the tint of a ball is trusted less, down to this share. */
const DARK_TINT_BRIGHT = 0.3;
const DARK_TINT_TRUST = 0.2;
/** Pixels at least this bright against the brightest ball pixel show the colour of the light. */
const LIGHT_BRIGHT = 0.88;
/** A "light" more tinted than this is taken to be a bright coloured ball instead. */
const LIGHT_MAX_TINT = 0.3;

/** The colour of the light, as the tint a white thing has under it. */
interface Light {
  tintB: number;
  tintR: number;
}

function look(img: WorkImage, disc: Disc, whiteY: number, light: Light): Seen {
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
      // Tints are taken relative to the light, so that white is white under a coloured lamp.
      const tb = tintOf(luma, img.cb[at] as number) - light.tintB;
      const tr = tintOf(luma, img.cr[at] as number) - light.tintR;
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
  // The colour of the light: the brightest pixels on the balls are highlights (the lamp
  // mirrored in the ball) or the cue ball, both of which show the light's own colour. If
  // they are strongly coloured they are more likely a bright ball than the light, and no
  // correction is made.
  let ln = 0;
  let lb = 0;
  let lr = 0;
  for (const d of discs) {
    const r = d.r * 0.8;
    const x0 = Math.max(0, Math.floor(d.u - r));
    const x1 = Math.min(img.width - 1, Math.ceil(d.u + r));
    const y0 = Math.max(0, Math.floor(d.v - r));
    const y1 = Math.min(img.height - 1, Math.ceil(d.v + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - d.u;
        const dy = y + 0.5 - d.v;
        if (dx * dx + dy * dy > r * r) continue;
        const at = y * img.width + x;
        const luma = img.y[at] as number;
        if (luma < LIGHT_BRIGHT * whiteY) continue;
        const tb = tintOf(luma, img.cb[at] as number);
        const tr = tintOf(luma, img.cr[at] as number);
        // A bright pixel of strong colour is a bright ball (the yellow), not the light.
        if (Math.hypot(tb, tr) >= LIGHT_MAX_TINT) continue;
        ln++;
        lb += tb;
        lr += tr;
      }
    }
  }
  const light: Light =
    ln > 0 && Math.hypot(lb / ln, lr / ln) < LIGHT_MAX_TINT
      ? { tintB: lb / ln, tintR: lr / ln }
      : { tintB: 0, tintR: 0 };
  const seen = discs.map((d) => look(img, d, whiteY, light));
  const whiteRef = hexToYcc(CUE_BALL_COLOUR).y;

  interface Kind {
    kind: BallKind;
    left: number;
    striped: boolean;
    cue: boolean;
    black: boolean;
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
      black: kind === "8" || kind === "black",
      // A black ball shows the lamp and the cloth mirrored in it: it is seen brighter than
      // its paint.
      y:
        kind === "8" || kind === "black"
          ? Math.max(c.y / whiteRef, BLACK_SEEN_BRIGHTNESS)
          : c.y / whiteRef,
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
    // A very dark ball has little colour of its own: what tint it shows is the cloth
    // mirrored in it. Its darkness says more than its tint.
    const trust = Math.max(DARK_TINT_TRUST, Math.min(1, b.y / whiteY / DARK_TINT_BRIGHT));
    // A black ball has no colour of its own: what tint it shows is mirrored.
    const tintWeight = k.black ? BLACK_TINT_WEIGHT : 1;
    return 1.6 * trust * tintWeight * tint + 0.6 * bright + 0.9 * Math.abs(b.white - whiteWanted);
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
