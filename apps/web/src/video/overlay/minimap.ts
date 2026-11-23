import { buildTableGeometry } from "@baize/physics";
import { CLOTH_COLOURS, markingsFor } from "@baize/tables";
import type { Marking } from "@baize/tables";
import type { DiagramTheme } from "../../doc/types";
import { ballLook } from "../../view/ballLook";
import {
  CUSHION_DARKEN,
  CUSHION_DEPTH_M,
  MARKING_WIDTH_M,
  RAIL_CORNER_RADIUS_M,
  RAIL_WIDTH_M,
  SIGHT_RADIUS_M,
  SPOT_RADIUS_M,
} from "../../view/constants";
import { shade } from "../../view/shade";
import { cushionPaths, markingShapes, pocketCircles, tableRect } from "../../view/tableArt";
import { THEMES } from "../../view/theme";
import type { ThemeColours } from "../../view/theme";
import type { ClipAnalysis } from "../types";
import { makeCanvas, tracePathData, traceRoundRect } from "./canvas";
import type { Ctx2D } from "./canvas";
import type { MinimapLayout } from "./minimapLayout";
import type { Prepared } from "./prepare";

/**
 * The minimap: the table seen from above, drawn with the editor's table helpers and theme
 * colours straight in frame pixels. The table itself does not change during a clip, so it is
 * drawn once per analysis and theme onto an offscreen canvas and copied onto every frame.
 */

/**
 * Cloth colour of the "table" theme when the analysis carries none: in the editor it is the
 * document's own cloth (`ClipAnalysis.clothColour`); without one, the first cloth preset (green)
 * stands in.
 */
export const MINIMAP_CLOTH = (CLOTH_COLOURS[0] as { hex: string }).hex;

/** Steps for drawing a marking arc (the D) as a polyline. */
const ARC_STEPS = 48;
const OUTLINE_PX = 1;

export function clothColour(colours: ThemeColours, analysisCloth?: string): string {
  return colours.cloth ?? analysisCloth ?? MINIMAP_CLOTH;
}

/** Draws the table (sheet, rails, cloth, pockets, cushions, markings) in frame pixels. */
export function drawMinimapTable(
  ctx: Ctx2D,
  analysis: ClipAnalysis,
  layout: MinimapLayout,
  theme: DiagramTheme,
): void {
  const colours = THEMES[theme];
  const t = layout.transform;
  const s = layout.scale;
  const geometry = buildTableGeometry(analysis.table);
  const cloth = clothColour(colours, analysis.clothColour);
  const cushion = colours.cushion ?? shade(cloth, -CUSHION_DARKEN);
  const cushionEdge = colours.cushionEdge ?? shade(cloth, -CUSHION_DARKEN - 0.15);

  ctx.save();
  const { box } = layout;
  if (colours.sheet) {
    ctx.fillStyle = colours.sheet;
    ctx.fillRect(box.x, box.y, box.width, box.height);
  }
  const rails = tableRect(t, RAIL_WIDTH_M);
  ctx.beginPath();
  traceRoundRect(ctx, rails.x, rails.y, rails.width, rails.height, RAIL_CORNER_RADIUS_M * s);
  ctx.fillStyle = colours.rail;
  ctx.fill();
  ctx.lineWidth = OUTLINE_PX;
  ctx.strokeStyle = colours.railOutline ?? "rgba(0, 0, 0, 0.6)";
  ctx.stroke();

  const bed = tableRect(t, CUSHION_DEPTH_M);
  ctx.fillStyle = cloth;
  ctx.fillRect(bed.x, bed.y, bed.width, bed.height);

  ctx.fillStyle = colours.pocket;
  for (const p of pocketCircles(geometry, t)) {
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.r * s, 0, 2 * Math.PI);
    ctx.fill();
  }

  ctx.fillStyle = cushion;
  ctx.strokeStyle = cushionEdge;
  ctx.lineWidth = Math.max(0.5, 0.003 * s);
  for (const d of cushionPaths(geometry, CUSHION_DEPTH_M, t)) {
    ctx.beginPath();
    tracePathData(ctx, d);
    ctx.fill();
    ctx.stroke();
  }

  const markings = markingsFor(analysis.table);
  ctx.lineWidth = Math.max(1, MARKING_WIDTH_M * s);
  ctx.strokeStyle = colours.marking;
  for (const m of markingShapes(markings, t)) {
    if (m.kind === "line") {
      ctx.globalAlpha = colours.lineOpacity;
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
      ctx.stroke();
    } else if (m.kind === "spot") {
      ctx.globalAlpha = colours.spotOpacity;
      ctx.fillStyle = colours.marking;
      ctx.beginPath();
      ctx.arc(m.cx, m.cy, Math.max(1, SPOT_RADIUS_M * s), 0, 2 * Math.PI);
      ctx.fill();
    } else if (m.kind === "sight") {
      ctx.globalAlpha = 1;
      ctx.fillStyle = colours.sight;
      ctx.beginPath();
      ctx.arc(m.cx, m.cy, Math.max(1, SIGHT_RADIUS_M * s), 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  // Arcs from the marking data itself, as polylines (the SVG arc data is in metres).
  ctx.globalAlpha = colours.lineOpacity;
  for (const m of markings) if (m.kind === "arc") strokeArc(ctx, m, layout);
  ctx.restore();
}

function strokeArc(ctx: Ctx2D, m: Extract<Marking, { kind: "arc" }>, layout: MinimapLayout): void {
  ctx.beginPath();
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = m.startRad + ((m.endRad - m.startRad) * i) / ARC_STEPS;
    const q = layout.toPx({
      x: m.centre.x + m.radiusM * Math.cos(a),
      y: m.centre.y + m.radiusM * Math.sin(a),
    });
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
}

interface StaticMinimap {
  canvas: OffscreenCanvas;
}

/**
 * Copies the table onto the frame: from the picture kept for this analysis and theme, drawn
 * on first use, or drawn straight onto the frame where no offscreen canvas can be made.
 */
export function drawMinimapBackground(
  ctx: Ctx2D,
  analysis: ClipAnalysis,
  prepared: Prepared,
  theme: DiagramTheme,
): void {
  const layout = prepared.minimap;
  const { box } = layout;
  let kept = prepared.statics.get(theme) as StaticMinimap | null | undefined;
  if (kept === undefined) {
    const made = makeCanvas(box.width, box.height);
    if (made) {
      made.ctx.translate(-box.x, -box.y);
      drawMinimapTable(made.ctx, analysis, layout, theme);
      kept = { canvas: made.canvas };
    } else kept = null;
    prepared.statics.set(theme, kept);
  }
  if (kept) ctx.drawImage(kept.canvas, box.x, box.y);
  else drawMinimapTable(ctx, analysis, layout, theme);
}

/** A ball seen from above, as in the editor: colour, stripe band and outline. */
export function drawBall(
  ctx: Ctx2D,
  kind: string,
  x: number,
  y: number,
  r: number,
  colours: ThemeColours,
): void {
  const look = ballLook(kind);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = look.striped ? "#ffffff" : look.colour;
  ctx.fill();
  if (look.striped) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = look.colour;
    ctx.fillRect(x - r, y - r * 0.55, 2 * r, r * 1.1);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
  ctx.globalAlpha = colours.ballOutlineOpacity;
  ctx.strokeStyle = colours.ballOutline;
  ctx.lineWidth = Math.max(0.75, colours.ballOutlineWidth * r);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
