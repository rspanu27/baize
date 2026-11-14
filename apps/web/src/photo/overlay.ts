import type { ImagePoint } from "@baize/vision";

/**
 * The one place that turns a pointer position on the review overlay into photo pixels. The
 * overlay is an SVG whose viewBox is the photo's own pixel space (plus padding), so the
 * transform is the inverse of the SVG's screen matrix, whatever size it is drawn at.
 */
export function toPhotoPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): ImagePoint | undefined {
  const m = svg.getScreenCTM();
  if (!m) return undefined;
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return { u: p.x, v: p.y };
}
