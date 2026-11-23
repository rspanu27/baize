/**
 * Small canvas helpers shared by the overlay drawing. Everything here works on both kinds of
 * 2D context, so the overlays can be drawn on the page or in a worker.
 */

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A point in pixels; `NaN` coordinates mark a break in a line. */
export interface PxPoint {
  x: number;
  y: number;
}

/** Size unit of the overlays: 1 on a 1080p frame, scaled with the frame's shorter side. */
export function overlayUnit(widthPx: number, heightPx: number): number {
  return Math.max(0.25, Math.min(widthPx, heightPx) / 1080);
}

/** Relative luminance of a `#rrggbb` colour (sRGB, as in WCAG); 1 for anything else. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return 1;
  const n = parseInt(m[1], 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * The halo drawn under a line so that it reads on any cloth and any picture: dark under light
 * lines, light under dark ones (the print theme draws its paths in near black).
 */
export function haloFor(colour: string): string {
  return luminance(colour) < 0.2 ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.7)";
}

/** Adds a polyline to the current path, starting a new run after every `NaN` point. */
export function tracePolyline(ctx: Ctx2D, points: readonly PxPoint[]): void {
  let pen = false;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    pen = true;
  }
}

/** Adds a rectangle with rounded corners to the current path. */
export function traceRoundRect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.arcTo(x + w, y, x + w, y + k, k);
  ctx.lineTo(x + w, y + h - k);
  ctx.arcTo(x + w, y + h, x + w - k, y + h, k);
  ctx.lineTo(x + k, y + h);
  ctx.arcTo(x, y + h, x, y + h - k, k);
  ctx.lineTo(x, y + k);
  ctx.arcTo(x, y, x + k, y, k);
  ctx.closePath();
}

/**
 * Adds SVG path data made of `M`, `L` and `Z` commands only (as `cushionPaths` writes it) to
 * the current path. Other commands are not expected and are skipped with their numbers.
 */
export function tracePathData(ctx: Ctx2D, d: string): void {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let command = "";
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i] as string;
    if (/^[A-Za-z]$/.test(tok)) {
      command = tok;
      i++;
      if (command === "Z" || command === "z") ctx.closePath();
      continue;
    }
    const x = Number(tok);
    const y = Number(tokens[i + 1]);
    i += 2;
    if (command === "M") {
      ctx.moveTo(x, y);
      command = "L";
    } else if (command === "L") ctx.lineTo(x, y);
  }
}

/**
 * An offscreen canvas for drawing once and reusing, or undefined where there is none (every
 * browser with WebCodecs has one; the caller then draws straight onto the frame instead).
 */
export function makeCanvas(
  widthPx: number,
  heightPx: number,
): { canvas: OffscreenCanvas; ctx: Ctx2D } | undefined {
  const w = Math.max(1, Math.ceil(widthPx));
  const h = Math.max(1, Math.ceil(heightPx));
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (ctx) return { canvas, ctx };
    }
  } catch {
    // None to be had: the caller draws without the cache.
  }
  return undefined;
}
