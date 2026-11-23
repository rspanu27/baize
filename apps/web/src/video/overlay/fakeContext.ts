import type { Ctx2D } from "./canvas";

/**
 * A 2D context that draws nothing and records what it was asked to draw, for the overlay
 * tests (Node has no canvas). Paths are kept in frame pixels, after the context's translation.
 * Not used by the app.
 */

export interface RecordedPoint {
  x: number;
  y: number;
}

export interface RecordedStroke {
  kind: "stroke" | "fill";
  style: string;
  width: number;
  dash: number[];
  /** Runs of points (a new run at every moveTo). */
  runs: RecordedPoint[][];
  /** Circles in the path: centre and radius. */
  arcs: { x: number; y: number; r: number }[];
}

export interface RecordedText {
  text: string;
  x: number;
  y: number;
  font: string;
  style: string;
}

interface State {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  dash: number[];
  tx: number;
  ty: number;
}

export class FakeContext {
  readonly strokes: RecordedStroke[] = [];
  readonly texts: RecordedText[] = [];
  readonly rects: { x: number; y: number; w: number; h: number; style: string }[] = [];
  readonly images: { image: unknown; x: number; y: number }[] = [];
  /** Every point given to the context, in frame pixels, for bounds checks. */
  readonly points: RecordedPoint[] = [];
  readonly calls: string[] = [];

  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  globalAlpha = 1;
  font = "10px sans-serif";
  lineJoin = "miter";
  lineCap = "butt";
  textAlign = "start";
  textBaseline = "alphabetic";

  private dash: number[] = [];
  private tx = 0;
  private ty = 0;
  private stack: State[] = [];
  private runs: RecordedPoint[][] = [];
  private arcs: { x: number; y: number; r: number }[] = [];

  /** This context as the type the overlay code takes. */
  get ctx(): Ctx2D {
    return this as unknown as Ctx2D;
  }

  private at(x: number, y: number): RecordedPoint {
    const p = { x: x + this.tx, y: y + this.ty };
    this.points.push(p);
    return p;
  }

  save(): void {
    this.calls.push("save");
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
      font: this.font,
      dash: this.dash,
      tx: this.tx,
      ty: this.ty,
    });
  }
  restore(): void {
    this.calls.push("restore");
    const s = this.stack.pop();
    if (!s) return;
    Object.assign(this, {
      fillStyle: s.fillStyle,
      strokeStyle: s.strokeStyle,
      lineWidth: s.lineWidth,
      globalAlpha: s.globalAlpha,
      font: s.font,
    });
    this.dash = s.dash;
    this.tx = s.tx;
    this.ty = s.ty;
  }
  translate(x: number, y: number): void {
    this.tx += x;
    this.ty += y;
  }
  beginPath(): void {
    this.runs = [];
    this.arcs = [];
  }
  moveTo(x: number, y: number): void {
    this.runs.push([this.at(x, y)]);
  }
  lineTo(x: number, y: number): void {
    const p = this.at(x, y);
    const run = this.runs[this.runs.length - 1];
    if (run) run.push(p);
    else this.runs.push([p]);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number): void {
    this.at(x1, y1);
    this.lineTo(x2, y2);
  }
  arc(x: number, y: number, r: number): void {
    const c = this.at(x, y);
    this.at(x - r, y - r);
    this.at(x + r, y + r);
    this.arcs.push({ x: c.x, y: c.y, r });
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.at(x, y);
    this.at(x + w, y + h);
  }
  closePath(): void {}
  clip(): void {
    this.calls.push("clip");
  }
  stroke(): void {
    this.strokes.push({
      kind: "stroke",
      style: this.strokeStyle,
      width: this.lineWidth,
      dash: [...this.dash],
      runs: this.runs.map((r) => [...r]),
      arcs: [...this.arcs],
    });
  }
  fill(): void {
    this.strokes.push({
      kind: "fill",
      style: this.fillStyle,
      width: 0,
      dash: [],
      runs: this.runs.map((r) => [...r]),
      arcs: [...this.arcs],
    });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const p = this.at(x, y);
    this.at(x + w, y + h);
    this.rects.push({ x: p.x, y: p.y, w, h, style: this.fillStyle });
  }
  fillText(text: string, x: number, y: number): void {
    const p = this.at(x, y);
    this.texts.push({ text, x: p.x, y: p.y, font: this.font, style: this.fillStyle });
  }
  strokeText(_text: string, x: number, y: number): void {
    this.at(x, y);
  }
  measureText(text: string): { width: number } {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * size * 0.55 };
  }
  setLineDash(dash: number[]): void {
    this.dash = [...dash];
  }
  drawImage(image: { width?: number; height?: number }, x: number, y: number): void {
    const p = this.at(x, y);
    this.at(x + (image.width ?? 0), y + (image.height ?? 0));
    this.images.push({ image, x: p.x, y: p.y });
  }
}
