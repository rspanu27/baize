/**
 * Exporting the diagram as an SVG or PNG file. Everything happens in the browser: the table
 * that is on screen is copied, made self-contained, and handed to the browser as a download.
 */

/** Width of an exported PNG, in pixels, along the long side of the table. */
export const PNG_LONG_SIDE_PX = 2000;

/** Printed on every export, so a diagram is not mistaken for more than the model gives. */
export const EXPORT_NOTE = "Baize, physics v2: throw and squirt modelled; no swerve or nap";

/** Parts of the editor that are controls, not part of the diagram. */
const CONTROL_SELECTOR =
  ".aim-handle, .aim-surface, .measure-surface, .ball-focus, .ball-selection, .measure-draft";

/** Style properties copied from the page's style sheets onto each exported element. */
const COPIED_STYLES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-weight",
  "paint-order",
] as const;

export interface PixelSize {
  width: number;
  height: number;
}

/** Pixel size of an export of a drawing `width` by `height` (any unit), long side given. */
export function pixelSize(width: number, height: number, longSidePx: number): PixelSize {
  if (!(width > 0) || !(height > 0)) return { width: longSidePx, height: longSidePx };
  const k = longSidePx / Math.max(width, height);
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/** A file name such as "baize-pool-9-ft-2026-11-13.svg": lower case, no odd characters. */
export function exportFileName(tableName: string, date: string, extension: string): string {
  const slug = tableName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `baize-${slug || "diagram"}-${date}.${extension}`;
}

/**
 * A self-contained copy of the table drawing as SVG text: controls removed, styles from the
 * page written onto the elements, a pixel size set, and the physics note added.
 */
export function svgText(svg: SVGSVGElement, longSidePx = PNG_LONG_SIDE_PX): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  // Styles are read from the live elements, which are in the same order as the copies.
  const live = [...svg.querySelectorAll("*")];
  const copies = [...copy.querySelectorAll("*")];
  copies.forEach((el, i) => {
    const source = live[i];
    if (!source) return;
    const style = getComputedStyle(source);
    for (const property of COPIED_STYLES) {
      const value = style.getPropertyValue(property);
      if (value) (el as SVGElement).style.setProperty(property, value);
    }
    el.removeAttribute("class");
    el.removeAttribute("tabindex");
  });
  // Remove controls after the styles were copied, so the two lists stayed in step.
  const controls = [...svg.querySelectorAll(CONTROL_SELECTOR)];
  for (const control of controls) {
    const index = live.indexOf(control);
    copies[index]?.remove();
  }

  const box = svg.viewBox.baseVal;
  const size = pixelSize(box.width, box.height, longSidePx);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(size.width));
  copy.setAttribute("height", String(size.height));
  copy.removeAttribute("class");
  copy.removeAttribute("style");

  // The note sits on the bottom rail, drawn at a normal font size and scaled to the drawing.
  const scale = Math.max(box.width, box.height) / 1400;
  const note = document.createElementNS("http://www.w3.org/2000/svg", "text");
  note.setAttribute(
    "transform",
    `translate(${String(box.x + box.width - 0.03)} ${String(box.y + box.height - 0.02)}) scale(${String(scale)})`,
  );
  note.setAttribute("text-anchor", "end");
  note.setAttribute("font-size", "11");
  note.setAttribute("font-family", "system-ui, sans-serif");
  note.setAttribute("fill", "#ffffff");
  note.setAttribute("fill-opacity", "0.7");
  note.textContent = EXPORT_NOTE;
  copy.appendChild(note);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`;
}

/** Renders SVG text to a PNG. Rejects if the browser cannot draw it. */
export async function pngBlob(svg: string, size: PixelSize): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => {
        resolve();
      };
      image.onerror = () => {
        reject(new Error("The diagram could not be drawn as an image."));
      };
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot make images.");
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The image could not be saved."));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Hands a file to the browser as a download. */
export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the address is withdrawn.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
