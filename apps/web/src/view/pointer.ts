import type { Point } from "./transform";

/**
 * The one helper that turns a pointer event into the SVG's own coordinates (metres, before the
 * view transform). Callers pass the result to `view.toTable`.
 */
export function clientToScreen(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): Point | undefined {
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: p.x, y: p.y };
}
