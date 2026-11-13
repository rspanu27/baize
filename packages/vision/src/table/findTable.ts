import { CUSHION_TOP_DEPTH_M } from "@baize/tables";
import type { TableSpec } from "@baize/tables";
import { ASSUMED_FOCAL_PER_LONG_SIDE, cameraFromHomography } from "../geometry/camera";
import { homographyFromCorners, tableToImage } from "../geometry/homography";
import { toWorkImage } from "../image/pixels";
import type { WorkImage } from "../image/pixels";
import type { Camera, ImagePoint, PhotoImage, TableCorners } from "../types";
import { clothMask, findClothModel } from "./clothModel";
import type { ClothModel } from "./clothModel";
import { convexHull, cross, enclosingQuad, fitLine, intersectLines, polygonArea } from "./quad";
import type { Pt } from "./quad";

/**
 * Finding the table in a photo.
 *
 * 1. The cloth colour is read from the middle of the photo (`clothModel.ts`).
 * 2. The cloth is the connected area of that colour around the middle. Cushions are covered
 *    in the same cloth, so the area runs out to where the cushions meet the wooden rails.
 * 3. Its outline is reduced to the four straight sides that enclose it. Pockets cut the
 *    corners off; the corners are where the sides meet when extended.
 * 4. Each side is fitted again to the edge pixels along it, for accuracy finer than a pixel.
 * 5. That quadrilateral is the playing area plus the cushions all round. The playing area's
 *    own corners are found by mapping the rectangle that is one cushion depth smaller.
 *
 * Limits, stated plainly. The cushion tops are a few centimetres above the cloth, which this
 * treats as level with it; and the depth of a cushion is a typical value, not this table's.
 * Both move the corners by a centimetre or two at worst. Which end of the table is the baulk
 * end cannot be seen from the outline: the end nearer the camera is taken as baulk, and the
 * result says that this was a guess. All four corners must be in the photo; otherwise
 * nothing is returned and the corners are placed by hand.
 */

export interface FoundTable {
  /** Corners of the playing area (cushion noses), in the order of `TableCorners`. */
  corners: TableCorners;
  /** Corners of the whole cloth-coloured area (out to the rails), same order. */
  outer: TableCorners;
  camera: Camera;
  cloth: ClothModel;
  /** True: which end is baulk was assumed (the nearer end), not seen. */
  baulkEndGuessed: true;
}

/** Longer side of the working copy of the photo, pixels. Enough for corners; fast. */
const WORK_SIDE = 480;
/** The cloth must cover at least this share of the photo. */
const MIN_AREA_SHARE = 0.06;
/** The cloth area must fill at least this share of its four-sided outline. */
const MIN_FILL = 0.8;
/** Share of the outline's edge pixels that may lie on the border of the photo. */
const MAX_BORDER_SHARE = 0.03;
/** Two readings of the corners whose fits differ by less than this fit equally well. */
const FIT_TIE = 1e-3;
/** A difference in log focal length smaller than this does not decide between readings. */
const FOCAL_ODD_MARGIN = 0.25;
/** Edge pixels within this distance (working pixels) of a side are used to refit it. */
const REFIT_BAND = 2.5;

/** The connected area of cloth that covers most of the middle of the picture. */
function clothRegion(
  img: WorkImage,
  mask: Uint8Array,
): { region: Uint8Array; size: number } | undefined {
  const { width, height } = img;
  const label = new Int32Array(width * height).fill(-1);
  const stack = new Int32Array(width * height);
  const cx0 = Math.floor(width * 0.3);
  const cx1 = Math.ceil(width * 0.7);
  const cy0 = Math.floor(height * 0.3);
  const cy1 = Math.ceil(height * 0.7);
  let bestLabel = -1;
  let bestCentral = 0;
  let bestSize = 0;
  let next = 0;
  // Only areas that start in the middle matter; fill from every unvisited cloth pixel there.
  for (let j = cy0; j < cy1; j++) {
    for (let i = cx0; i < cx1; i++) {
      const start = j * width + i;
      if (mask[start] !== 1 || label[start] !== -1) continue;
      const id = next++;
      let top = 0;
      stack[top++] = start;
      label[start] = id;
      let size = 0;
      let central = 0;
      while (top > 0) {
        const at = stack[--top] as number;
        size++;
        const x = at % width;
        const y = (at - x) / width;
        if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) central++;
        if (x > 0 && mask[at - 1] === 1 && label[at - 1] === -1) {
          label[at - 1] = id;
          stack[top++] = at - 1;
        }
        if (x < width - 1 && mask[at + 1] === 1 && label[at + 1] === -1) {
          label[at + 1] = id;
          stack[top++] = at + 1;
        }
        if (y > 0 && mask[at - width] === 1 && label[at - width] === -1) {
          label[at - width] = id;
          stack[top++] = at - width;
        }
        if (y < height - 1 && mask[at + width] === 1 && label[at + width] === -1) {
          label[at + width] = id;
          stack[top++] = at + width;
        }
      }
      if (central > bestCentral) {
        bestCentral = central;
        bestLabel = id;
        bestSize = size;
      }
    }
  }
  if (bestLabel < 0) return undefined;
  const region = new Uint8Array(width * height);
  for (let at = 0; at < region.length; at++) if (label[at] === bestLabel) region[at] = 1;
  return { region, size: bestSize };
}

/** Outer edge pixels of a region: the first and last pixel of every row and every column. */
function outline(img: WorkImage, region: Uint8Array): { points: Pt[]; onBorder: number } {
  const { width, height } = img;
  const seen = new Uint8Array(width * height);
  const points: Pt[] = [];
  let onBorder = 0;
  const add = (x: number, y: number): void => {
    const at = y * width + x;
    if (seen[at] === 1) return;
    seen[at] = 1;
    // Pixel centres.
    points.push({ x: x + 0.5, y: y + 0.5 });
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) onBorder++;
  };
  for (let y = 0; y < height; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (region[y * width + x] === 1) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) {
      add(first, y);
      add(last, y);
    }
  }
  for (let x = 0; x < width; x++) {
    let first = -1;
    let last = -1;
    for (let y = 0; y < height; y++) {
      if (region[y * width + x] === 1) {
        if (first < 0) first = y;
        last = y;
      }
    }
    if (first >= 0) {
      add(x, first);
      add(x, last);
    }
  }
  return { points, onBorder };
}

/** Refits the four sides to the edge pixels along them and returns the new corners. */
function refine(quad: readonly Pt[], edge: readonly Pt[]): Pt[] | undefined {
  const centre = {
    x: quad.reduce((s, p) => s + p.x, 0) / 4,
    y: quad.reduce((s, p) => s + p.y, 0) / 4,
  };
  const lines: { point: Pt; dir: Pt }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i] as Pt;
    const b = quad[(i + 1) % 4] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0)) return undefined;
    const nx = (b.y - a.y) / len;
    const ny = -(b.x - a.x) / len;
    // Edge pixels near this side, away from its ends (where pockets cut the corners off).
    const near = edge.filter((p) => {
      const along = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
      const off = (p.x - a.x) * nx + (p.y - a.y) * ny;
      return along > 0.12 && along < 0.88 && Math.abs(off) < REFIT_BAND;
    });
    const fitted = near.length >= 8 ? fitLine(near) : undefined;
    if (!fitted) {
      lines.push({ point: a, dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } });
      continue;
    }
    // Edge pixel centres are half a pixel inside the true edge: move the line out by that.
    const ox = -fitted.dir.y;
    const oy = fitted.dir.x;
    const side = (fitted.point.x - centre.x) * ox + (fitted.point.y - centre.y) * oy >= 0 ? 1 : -1;
    lines.push({
      point: { x: fitted.point.x + 0.5 * side * ox, y: fitted.point.y + 0.5 * side * oy },
      dir: fitted.dir,
    });
  }
  const corners: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const prev = lines[(i + 3) % 4] as { point: Pt; dir: Pt };
    const cur = lines[i] as { point: Pt; dir: Pt };
    const meet = intersectLines(
      prev.point,
      { x: prev.point.x + prev.dir.x, y: prev.point.y + prev.dir.y },
      cur.point,
      { x: cur.point.x + cur.dir.x, y: cur.point.y + cur.dir.y },
    );
    if (!meet) return undefined;
    corners.push(meet);
  }
  return corners;
}

/**
 * Finds the table in a photo, or returns undefined when it cannot be found with confidence
 * (no clear cloth, the table is cut off by the edge of the photo, or the outline is not a
 * table seen from above).
 */
export function findTable(image: PhotoImage, table: TableSpec): FoundTable | undefined {
  const img = toWorkImage(image, WORK_SIDE);
  if (img.width < 16 || img.height < 16) return undefined;
  const cloth = findClothModel(img);
  if (!cloth) return undefined;
  const found = clothRegion(img, clothMask(img, cloth));
  if (!found || found.size < MIN_AREA_SHARE * img.width * img.height) return undefined;
  const edge = outline(img, found.region);
  // A table that runs off the photo has a corner or a side that cannot be seen.
  if (edge.onBorder > MAX_BORDER_SHARE * edge.points.length) return undefined;
  const hull = convexHull(edge.points);
  const rough = enclosingQuad(hull);
  if (!rough) return undefined;
  if (found.size < MIN_FILL * polygonArea(rough)) return undefined;
  const fine = refine(rough, edge.points) ?? rough;

  // Into photo pixels, and into the order in which a table's corners appear from above:
  // clockwise on the screen (v grows downwards).
  let quad: ImagePoint[] = fine.map((p) => ({ u: p.x * img.scale, v: p.y * img.scale }));
  const turn = cross(
    { x: (quad[0] as ImagePoint).u, y: (quad[0] as ImagePoint).v },
    { x: (quad[1] as ImagePoint).u, y: (quad[1] as ImagePoint).v },
    { x: (quad[2] as ImagePoint).u, y: (quad[2] as ImagePoint).v },
  );
  // Table corners (0,0), (W,0), (W,L), (0,L) are counter-clockwise in table coordinates with
  // y up, which is counter-clockwise in the image too only if v pointed up; v points down.
  if (turn > 0) quad = [...quad].reverse();

  const d = CUSHION_TOP_DEPTH_M;
  const outerW = table.playingArea.widthM + 2 * d;
  const outerL = table.playingArea.lengthM + 2 * d;
  // Which pair of sides is the long one: read the corners starting from each of the four,
  // and keep the reading in which they best fit a rectangle of the table's shape. Opposite
  // starts are the same table turned end for end and fit equally well; of those two, the
  // baulk end is taken to be the one nearer the camera.
  interface Reading {
    outer: TableCorners;
    camera: Camera;
    h: NonNullable<ReturnType<typeof homographyFromCorners>>;
  }
  const readings: (Reading | undefined)[] = [0, 1, 2, 3].map((start) => {
    const outer = [0, 1, 2, 3].map(
      (k) => quad[(start + k) % 4] as ImagePoint,
    ) as unknown as TableCorners;
    const h = homographyFromCorners(outer, outerW, outerL);
    const camera = h ? cameraFromHomography(h, image.widthPx, image.heightPx) : undefined;
    return h && camera ? { outer, camera, h } : undefined;
  });
  const misfitOf = (a: Reading | undefined, b: Reading | undefined): number =>
    Math.min(a?.camera.focalMisfit ?? 2, b?.camera.focalMisfit ?? 2);
  let pair: [Reading | undefined, Reading | undefined] = [readings[0], readings[2]];
  const other: [Reading | undefined, Reading | undefined] = [readings[1], readings[3]];
  const fit = misfitOf(...pair);
  const otherFit = misfitOf(...other);
  if (Math.abs(otherFit - fit) > FIT_TIE) {
    if (otherFit < fit) pair = other;
  } else {
    // The fit says nothing when the photo gives only one equation for the focal length
    // (seen square on from an end or a side) or none (seen from straight above). Then the
    // reading whose focal length is more like a phone's wins; failing that, the longer
    // sides in the photo are taken as the long sides of the table.
    const odd = (r: Reading | undefined): number =>
      r
        ? Math.abs(
            Math.log(
              r.camera.focalPx /
                (ASSUMED_FOCAL_PER_LONG_SIDE * Math.max(image.widthPx, image.heightPx)),
            ),
          )
        : Infinity;
    const oddPair = Math.min(odd(pair[0]), odd(pair[1]));
    const oddOther = Math.min(odd(other[0]), odd(other[1]));
    // Side 0 of a reading is a short (baulk) side.
    const side = (r: Reading | undefined): number =>
      r ? Math.hypot(r.outer[1].u - r.outer[0].u, r.outer[1].v - r.outer[0].v) : Infinity;
    if (Math.abs(oddOther - oddPair) > FOCAL_ODD_MARGIN) {
      if (oddOther < oddPair) pair = other;
    } else if (side(other[0]) < side(pair[0])) {
      pair = other;
    }
  }
  const [first, second] = pair;
  const best =
    first && second
      ? first.camera.position.y <= second.camera.position.y
        ? first
        : second
      : (first ?? second);
  if (!best) return undefined;
  const h = best.h;
  const inner = [
    { x: d, y: d },
    { x: outerW - d, y: d },
    { x: outerW - d, y: outerL - d },
    { x: d, y: outerL - d },
  ].map((p) => tableToImage(h, p)) as unknown as TableCorners;
  // The camera in the playing area's own coordinates.
  const hInner = homographyFromCorners(inner, table.playingArea.widthM, table.playingArea.lengthM);
  const camera = hInner ? cameraFromHomography(hInner, image.widthPx, image.heightPx) : undefined;
  if (!camera) return undefined;
  return { corners: inner, outer: best.outer, camera, cloth, baulkEndGuessed: true };
}
