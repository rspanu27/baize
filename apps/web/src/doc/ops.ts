import { sanitizeLayout } from "@baize/tables";
import type { BallKind, ClothSpec, Layout } from "@baize/tables";
import { resolveDoc } from "./resolve";
import type {
  Annotation,
  DiagramDoc,
  DiagramStyle,
  DocBall,
  DocBallSet,
  DocShot,
  DocTable,
} from "./types";
import { CAPTION_MAX_LENGTH } from "./types";

/**
 * Document operations: pure functions from a document to a new document.
 *
 * Every operation that puts balls somewhere runs the result through `sanitizeLayout`, so a
 * document never holds overlapping balls, balls behind a cushion or balls over a pocket.
 * An operation that cannot be applied returns the document it was given, unchanged.
 */

/** Largest tip offset, as a fraction of the ball radius (the miscue limit). */
export const MAX_TIP_OFFSET = 0.5;

/** Lower than any real confidence, so a ball being placed gives way to the others. */
const GIVE_WAY = 1e-6;

/** A ball id not used in the document yet: "b1", "b2", ... */
export function nextBallId(balls: readonly DocBall[]): string {
  let max = 0;
  for (const b of balls) {
    const n = /^b(\d+)$/.exec(b.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `b${String(max + 1)}`;
}

/**
 * Makes the balls of a document legally placed. Balls named in `giveWay` are the ones moved
 * when something is in the way; every other ball keeps its place if it can.
 */
function settle(doc: DiagramDoc, giveWay: ReadonlySet<string> = new Set()): DiagramDoc {
  const resolved = resolveDoc(doc);
  if (!resolved.ok) return doc;
  const { table, ballSet } = resolved.scene;
  const result = sanitizeLayout(
    {
      balls: doc.balls.map((b) => ({
        kind: b.kind,
        x: b.x,
        y: b.y,
        confidence: giveWay.has(b.id) ? GIVE_WAY : (b.confidence ?? 1),
      })),
    },
    table,
    ballSet,
  );
  const removed = new Set(result.removed);
  const kept = doc.balls.filter((_, i) => !removed.has(i));
  const balls = kept.map((b, i) => {
    const placed = result.layout.balls[i];
    // A ball that did not move keeps its identity, so only moved balls re-render.
    return placed && (placed.x !== b.x || placed.y !== b.y)
      ? { ...b, x: placed.x, y: placed.y }
      : b;
  });
  return withValidShot({ ...doc, balls });
}

/** Drops the shot if its cue ball is no longer in the document. */
function withValidShot(doc: DiagramDoc): DiagramDoc {
  if (!doc.shot || doc.balls.some((b) => b.id === doc.shot?.cueBallId)) return doc;
  const { shot: _dropped, ...rest } = doc;
  void _dropped;
  return rest;
}

/** Moves a ball to a point. Moving a ball by hand confirms it, so its confidence is cleared. */
export function placeBall(
  doc: DiagramDoc,
  id: string,
  point: { x: number; y: number },
): DiagramDoc {
  if (!doc.balls.some((b) => b.id === id)) return doc;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return doc;
  const balls = doc.balls.map((b) => {
    if (b.id !== id) return b;
    const { confidence: _confirmed, ...rest } = b;
    void _confirmed;
    return { ...rest, x: point.x, y: point.y };
  });
  return settle({ ...doc, balls }, new Set([id]));
}

/** Adds a ball of a kind at a point. Returns the document unchanged if the set has no more of that kind. */
export function addBall(
  doc: DiagramDoc,
  kind: BallKind,
  point: { x: number; y: number },
): DiagramDoc {
  const resolved = resolveDoc(doc);
  if (!resolved.ok) return doc;
  const allowed = resolved.scene.ballSet.kinds.find((k) => k.kind === kind)?.count ?? 0;
  const have = doc.balls.filter((b) => b.kind === kind).length;
  if (have >= allowed) return doc;
  const id = nextBallId(doc.balls);
  const next = settle(
    { ...doc, balls: [...doc.balls, { id, kind, x: point.x, y: point.y }] },
    new Set([id]),
  );
  return next.balls.some((b) => b.id === id) ? next : doc;
}

export function removeBall(doc: DiagramDoc, id: string): DiagramDoc {
  if (!doc.balls.some((b) => b.id === id)) return doc;
  return withValidShot({ ...doc, balls: doc.balls.filter((b) => b.id !== id) });
}

export function clearBalls(doc: DiagramDoc): DiagramDoc {
  if (doc.balls.length === 0) return doc;
  return withValidShot({ ...doc, balls: [] });
}

export interface LoadLayoutOptions {
  /** Where the layout came from. A photo marks the document as photo-sourced. */
  source: "rack" | "template" | "photo" | "manual";
  /** Replace the balls on the table, or add to them. */
  mode: "replace" | "merge";
}

/**
 * Puts a layout on the table: the single way balls arrive in bulk (racks, templates, photo
 * import). Confidence values in the layout are kept so uncertain balls can be shown as such.
 */
export function loadLayout(
  doc: DiagramDoc,
  layout: Layout,
  options: LoadLayoutOptions,
): DiagramDoc {
  const existing = options.mode === "merge" ? doc.balls : [];
  const balls: DocBall[] = [...existing];
  for (const b of layout.balls) {
    balls.push({
      id: nextBallId(balls),
      kind: b.kind,
      x: b.x,
      y: b.y,
      ...(b.confidence === undefined ? {} : { confidence: b.confidence }),
    });
  }
  // A photo marks the diagram as photo-sourced; replacing the balls by hand clears that mark;
  // adding to what is there keeps it.
  const sourceKind =
    options.source === "photo"
      ? "photo"
      : options.mode === "replace"
        ? "manual"
        : (doc.source?.kind ?? "manual");
  let next: DiagramDoc = settle({ ...doc, balls, source: { kind: sourceKind } });
  // Keep the shot settings, pointed at the new cue ball if the old one is gone.
  if (doc.shot && !next.shot) {
    const cue = next.balls.find((b) => b.kind === "cue");
    if (cue) next = { ...next, shot: { ...doc.shot, cueBallId: cue.id } };
  }
  return next;
}

/** Changes the shot, creating it if there is a cue ball and no shot yet. */
export function setShot(
  doc: DiagramDoc,
  patch: Partial<Omit<DocShot, "elevationRad">>,
): DiagramDoc {
  const cueId =
    patch.cueBallId ?? doc.shot?.cueBallId ?? doc.balls.find((b) => b.kind === "cue")?.id;
  if (!cueId || !doc.balls.some((b) => b.id === cueId)) return doc;
  const base: DocShot = doc.shot ?? {
    cueBallId: cueId,
    aimAngleRad: Math.PI / 2,
    tipOffset: { side: 0, vertical: 0 },
    speedMps: 2,
  };
  const shot: DocShot = { ...base, ...patch, cueBallId: cueId };
  if (!Number.isFinite(shot.aimAngleRad) || !Number.isFinite(shot.speedMps)) return doc;
  if (!(shot.speedMps > 0)) return doc;
  // Keep the tip inside the miscue limit.
  const { side, vertical } = shot.tipOffset;
  if (!Number.isFinite(side) || !Number.isFinite(vertical)) return doc;
  const length = Math.sqrt(side * side + vertical * vertical);
  if (length > MAX_TIP_OFFSET) {
    const k = MAX_TIP_OFFSET / length;
    shot.tipOffset = { side: side * k, vertical: vertical * k };
  }
  return { ...doc, shot };
}

export function clearShot(doc: DiagramDoc): DiagramDoc {
  if (!doc.shot) return doc;
  const { shot: _dropped, ...rest } = doc;
  void _dropped;
  return rest;
}

/** Where a shot left one ball. */
export interface ShotFinal {
  ballId: string;
  position: { x: number; y: number };
  /** Set when the ball dropped into a pocket. */
  pocketed?: string | undefined;
}

/**
 * The table after a shot: every ball where the shot left it, potted balls gone. The shot
 * settings are kept if the cue ball is still on the table, ready for the next shot.
 */
export function continueFromShot(doc: DiagramDoc, finals: readonly ShotFinal[]): DiagramDoc {
  const end = new Map(finals.map((f) => [f.ballId, f]));
  let changed = false;
  const balls: DocBall[] = [];
  for (const b of doc.balls) {
    const f = end.get(b.id);
    if (!f) {
      balls.push(b);
    } else if (f.pocketed !== undefined) {
      changed = true;
    } else if (!Number.isFinite(f.position.x) || !Number.isFinite(f.position.y)) {
      balls.push(b);
    } else if (f.position.x !== b.x || f.position.y !== b.y) {
      changed = true;
      balls.push({ ...b, x: f.position.x, y: f.position.y });
    } else {
      balls.push(b);
    }
  }
  return changed ? settle({ ...doc, balls }) : doc;
}

/**
 * Changes the table. Ball positions are scaled with the playing area, so a layout keeps its
 * shape on a table of another size; balls that do not exist in the new ball set are dropped.
 */
export function setTable(doc: DiagramDoc, table: DocTable, ballSet?: DocBallSet): DiagramDoc {
  const before = resolveDoc(doc);
  const candidate: DiagramDoc = { ...doc, table, ...(ballSet ? { ballSet } : {}) };
  const after = resolveDoc(candidate);
  if (!after.ok) return doc;
  if (!before.ok) return settle(candidate);
  const from = before.scene.table.playingArea;
  const to = after.scene.table.playingArea;
  const balls = doc.balls.map((b) => ({
    ...b,
    x: (b.x * to.widthM) / from.widthM,
    y: (b.y * to.lengthM) / from.lengthM,
  }));
  const annotations = doc.annotations.map((a) => ({
    ...a,
    from: { x: (a.from.x * to.widthM) / from.widthM, y: (a.from.y * to.lengthM) / from.lengthM },
    to: { x: (a.to.x * to.widthM) / from.widthM, y: (a.to.y * to.lengthM) / from.lengthM },
  }));
  return settle({ ...candidate, balls, annotations });
}

export function setBallSet(doc: DiagramDoc, ballSet: DocBallSet): DiagramDoc {
  const candidate = { ...doc, ballSet };
  return resolveDoc(candidate).ok ? settle(candidate) : doc;
}

export function setCloth(doc: DiagramDoc, cloth: ClothSpec): DiagramDoc {
  return { ...doc, cloth };
}

/** An annotation id not used in the document yet: "m1", "m2", ... */
function nextAnnotationId(doc: DiagramDoc): string {
  let max = 0;
  for (const a of doc.annotations) {
    const n = /^m(\d+)$/.exec(a.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `m${String(max + 1)}`;
}

/** Adds a measuring line between two points on the table. */
export function addMeasure(
  doc: DiagramDoc,
  from: { x: number; y: number },
  to: { x: number; y: number },
): DiagramDoc {
  if (![from.x, from.y, to.x, to.y].every((v) => Number.isFinite(v))) return doc;
  if (from.x === to.x && from.y === to.y) return doc;
  const line: Annotation = {
    kind: "measure",
    id: nextAnnotationId(doc),
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
  };
  return { ...doc, annotations: [...doc.annotations, line] };
}

export function removeAnnotation(doc: DiagramDoc, id: string): DiagramDoc {
  if (!doc.annotations.some((a) => a.id === id)) return doc;
  return { ...doc, annotations: doc.annotations.filter((a) => a.id !== id) };
}

export function clearAnnotations(doc: DiagramDoc): DiagramDoc {
  return doc.annotations.length === 0 ? doc : { ...doc, annotations: [] };
}

/** Changes how the diagram is drawn (not what it contains). */
export function setStyle(doc: DiagramDoc, patch: DiagramStyle): DiagramDoc {
  const style: DiagramStyle = { ...doc.style, ...patch };
  // Keep the document minimal: a style that is all defaults is left out.
  if (style.showAllPaths !== true) delete style.showAllPaths;
  if (style.theme === "table") delete style.theme;
  if (style.pathLine === "solid") delete style.pathLine;
  if (style.pathWeight === "normal") delete style.pathWeight;
  if (style.ballLabels !== false) delete style.ballLabels;
  if (style.caption !== undefined) {
    // One line, no control characters, at most the length a link may carry.
    const caption = [...style.caption.replace(/\s+/g, " ")]
      .filter((ch) => ch >= " " && ch !== "\u007f")
      .join("")
      .trimStart()
      .slice(0, CAPTION_MAX_LENGTH);
    if (caption.trim() === "") delete style.caption;
    else style.caption = caption;
  }
  if (Object.keys(style).length === 0) {
    if (!doc.style) return doc;
    const { style: _dropped, ...rest } = doc;
    void _dropped;
    return rest;
  }
  return { ...doc, style };
}
