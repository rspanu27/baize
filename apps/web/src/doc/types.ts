import type { BallKind, ClothSpec, CustomTableFields } from "@baize/tables";

/**
 * The diagram document: everything a shared link contains, and nothing else.
 *
 * Plain serialisable data in SI units (metres, radians, m/s), in table coordinates: origin at
 * the head/baulk-end left corner of the playing area, x across the width, y along the length.
 *
 * The format is versioned. Any change to it needs a new `schemaVersion` and a migration in
 * `migrations.ts`, so that old links keep opening.
 */
export const SCHEMA_VERSION = 2;

/** A table preset by id (for example "pool-9@1"), or the measurements of a custom table. */
export type DocTable = { preset: string } | { custom: CustomTableFields };

export interface DocBallSet {
  /** Ball set preset id, for example "pool-57@1". */
  preset: string;
  /** Object-ball diameter override, for custom ball sizes. */
  diameterM?: number;
  /** Cue-ball diameter override, where the cue ball differs from the object balls. */
  cueDiameterM?: number;
}

export interface DocBall {
  /** Unique within the document. */
  id: string;
  kind: BallKind;
  x: number;
  y: number;
  /** 0..1, present only for balls placed automatically (photo import) and not yet confirmed. */
  confidence?: number;
}

export interface DocShot {
  cueBallId: string;
  /** Aim direction, counter-clockwise from +x. Not rounded: any angle can be stored. */
  aimAngleRad: number;
  /** Tip contact point as fractions of the ball radius. */
  tipOffset: { side: number; vertical: number };
  /** Cue-ball speed just after the strike. */
  speedMps: number;
  /** Reserved; must be 0 or absent in schema version 1. */
  elevationRad?: number;
}

/** Things drawn on top of the table. Version 1 has only measuring lines. */
export type Annotation = {
  kind: "measure";
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
};

/** Colours of the drawing. "table" follows the cloth colour; the others are for print and slides. */
export type DiagramTheme = "table" | "print" | "dark";
export type PathLine = "solid" | "dashed" | "dotted";
export type PathWeight = "thin" | "normal" | "thick";

/** Longest caption a document may carry, in UTF-16 units (what a text box's maxLength counts). */
export const CAPTION_MAX_LENGTH = 140;

/**
 * A caption as a document may hold it: one line (every run of white space becomes one space),
 * no control characters, nothing that cannot be written in an SVG or XML file (lone
 * surrogates, U+FFFE, U+FFFF), no leading space, and at most `CAPTION_MAX_LENGTH` units
 * without cutting a character in half. A trailing space is kept, so that words can be typed.
 */
export function cleanCaption(text: string): string {
  let out = "";
  let started = false;
  // `for of` walks code points; a lone surrogate comes through as a single unit.
  for (const ch of text.replace(/\s+/g, " ")) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    const isLoneSurrogate = code >= 0xd800 && code <= 0xdfff;
    const isNonCharacter = (code & 0xfffe) === 0xfffe;
    if (isControl || isLoneSurrogate || isNonCharacter) continue;
    // No space at the start, and never two in a row (a dropped character may sit between two).
    if (ch === " " && (!started || out.endsWith(" "))) continue;
    if (out.length + ch.length > CAPTION_MAX_LENGTH) break;
    started = true;
    out += ch;
  }
  return out;
}

/** How the diagram is drawn. Every field is optional; an absent field means the default. */
export interface DiagramStyle {
  /** Draw every moving ball's path at full strength, not only the cue ball and first object ball. */
  showAllPaths?: boolean;
  /** Default "table". (Since schema version 2.) */
  theme?: DiagramTheme;
  /** How ball paths are drawn. Default "solid". (Since schema version 2.) */
  pathLine?: PathLine;
  /** Default "normal". (Since schema version 2.) */
  pathWeight?: PathWeight;
  /** Numbers on pool balls and the marks on uncertain balls. Default true. (Since version 2.) */
  ballLabels?: boolean;
  /** A line of text shown with the diagram and in exports. (Since schema version 2.) */
  caption?: string;
}

/**
 * True when two documents differ at most in their style (how they are drawn): every other
 * field is the very same object. Documents are immutable and a style change keeps the other
 * fields, so comparing them by identity is exact for style edits and never wrongly true.
 */
export function sameExceptStyle(a: DiagramDoc, b: DiagramDoc): boolean {
  return (
    a === b ||
    (a.table === b.table &&
      a.ballSet === b.ballSet &&
      a.cloth === b.cloth &&
      a.balls === b.balls &&
      a.shot === b.shot &&
      a.annotations === b.annotations &&
      a.source === b.source)
  );
}

export interface DiagramDoc {
  schemaVersion: typeof SCHEMA_VERSION;
  table: DocTable;
  ballSet: DocBallSet;
  cloth: ClothSpec;
  balls: DocBall[];
  shot?: DocShot;
  annotations: Annotation[];
  /** Where the layout came from. A photo is never stored, only this marker. */
  source?: { kind: "manual" | "photo" };
  style?: DiagramStyle;
}
