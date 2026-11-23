import type { PhotoImage } from "@baize/vision";
import { fitWithin } from "../photo/decode";
import type { ClipFrame } from "./media";

/**
 * A decoded frame copied into pixels for the table finder and into a JPEG object URL for
 * showing it, in the browser. The frame's own canvas may be reused by the decoder, so it is
 * copied at once. A very large frame is scaled down as photos are. Nothing leaves the page.
 */
export async function readFrame(frame: ClipFrame): Promise<{ image: PhotoImage; url: string }> {
  const source = frame.canvas;
  const { width, height } = fitWithin(source.width, source.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot read video frames into memory.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });
  if (!blob) throw new Error("The first frame of the clip could not be shown.");
  return {
    image: { widthPx: width, heightPx: height, data: pixels.data },
    url: URL.createObjectURL(blob),
  };
}
