import { CLOTH_SPEEDS } from "@baize/tables";
import type { BallKind, ClothSpec, ClothSpeed, CustomTableFields, GameType } from "@baize/tables";
import { migrate } from "./migrations";
import { CAPTION_MAX_LENGTH, SCHEMA_VERSION } from "./types";
import type { Annotation, DiagramDoc, DocBall, DocBallSet, DocShot, DocTable } from "./types";

/**
 * The shareable link: a document as text, small enough for a URL.
 *
 *   v2.<c|u>.<payload>
 *
 * `v2` is the schema version of the payload. `c` means the payload is deflate-raw compressed,
 * `u` that it is not. The payload is base64url (no padding) of the UTF-8 bytes of compact JSON.
 *
 * Compact JSON (version 2), default values omitted:
 *   t  table: preset id string, or { g: game, l: length, w: width, c: corner mouth,
 *      m: middle mouth, j?: jaw style }
 *   s  ball set: preset id string, or { p: preset, d?: diameter, c?: cue diameter }
 *   k  cloth: { c: colour, k: speed name | [sliding, rolling, spinning], p?: preset label of
 *      odd coefficients, n?: [nap direction, nap strength] }
 *   b  balls: [id, kind, x, y, confidence?], x and y as integers in units of 0.01 mm
 *   h  shot: [cue ball id, aim angle, tip side, tip vertical, speed, elevation?]
 *   a  annotations: ["m", id, x1, y1, x2, y2] (measure), coordinates like ball positions
 *   o  source: absent = manual, 1 = photo, 0 = no source recorded
 *   y  style: { a?: show all paths, t?: theme "p" print | "d" dark, l?: path line "d" dashed
 *      | "o" dotted, w?: path weight "n" thin | "k" thick, n?: 0 when ball labels are off,
 *      c?: caption }
 *
 * Version 1 was the same without t, l, w, n and c in the style.
 */

export type DecodeResult = { ok: true; doc: DiagramDoc } | { ok: false; problem: string };

export interface EncodeOptions {
  /** "auto" compresses when the browser can and it helps; "off" never does (used by tests). */
  compression?: "auto" | "off";
}

const DAMAGED = "This link is damaged or was cut short.";
const NOT_BAIZE = "This does not look like a Baize link.";
/** Longest text a link may unpack to; a guard against links built to exhaust memory. */
const MAX_UNPACKED_BYTES = 4 * 1024 * 1024;
/** Positions are stored as integers in units of 0.01 mm. */
const POSITION_SCALE = 1e5;
const SMALL_SCALE = 1e6;

const BALL_KINDS: readonly BallKind[] = [
  "cue",
  "red",
  "yellow",
  "green",
  "brown",
  "blue",
  "pink",
  "black",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
];
const GAMES: readonly GameType[] = ["snooker", "pool", "blackball"];
const SPEEDS = Object.keys(CLOTH_SPEEDS) as ClothSpeed[];

// ---------------------------------------------------------------------------------------------
// Bytes and text

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function transform(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit: number,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Write and read at the same time; errors surface through the read side.
  const written = writer.write(bytes as BufferSource).then(() => writer.close());
  written.catch(() => undefined);
  const out = await collect(stream.readable as ReadableStream<Uint8Array>, limit);
  await written;
  return out;
}

const canCompress = (): boolean => typeof CompressionStream !== "undefined";
const canDecompress = (): boolean => typeof DecompressionStream !== "undefined";

// ---------------------------------------------------------------------------------------------
// Document to compact JSON

const pos = (v: number): number => Math.round(v * POSITION_SCALE);
const unpos = (v: number): number => v / POSITION_SCALE;
const small = (v: number): number => Math.round(v * SMALL_SCALE) / SMALL_SCALE;

function compactTable(table: DocTable): unknown {
  if ("preset" in table) return table.preset;
  const c = table.custom;
  return {
    g: c.game,
    l: c.lengthM,
    w: c.widthM,
    c: c.cornerMouthM,
    m: c.middleMouthM,
    ...(c.jawStyle === undefined ? {} : { j: c.jawStyle }),
  };
}

function compactBallSet(set: DocBallSet): unknown {
  if (set.diameterM === undefined && set.cueDiameterM === undefined) return set.preset;
  return {
    p: set.preset,
    ...(set.diameterM === undefined ? {} : { d: set.diameterM }),
    ...(set.cueDiameterM === undefined ? {} : { c: set.cueDiameterM }),
  };
}

function compactCloth(cloth: ClothSpec): unknown {
  const named = SPEEDS.find((name) => {
    const p = CLOTH_SPEEDS[name];
    return (
      cloth.speedPreset === name &&
      p.slidingFriction === cloth.slidingFriction &&
      p.rollingResistance === cloth.rollingResistance &&
      p.spinningFriction === cloth.spinningFriction
    );
  });
  return {
    c: cloth.colour,
    k: named ?? [cloth.slidingFriction, cloth.rollingResistance, cloth.spinningFriction],
    ...(named === undefined && cloth.speedPreset !== "custom" ? { p: cloth.speedPreset } : {}),
    ...(cloth.nap ? { n: [cloth.nap.directionRad, cloth.nap.strength] } : {}),
  };
}

function toCompact(doc: DiagramDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {
    t: compactTable(doc.table),
    s: compactBallSet(doc.ballSet),
    k: compactCloth(doc.cloth),
    b: doc.balls.map((b) => [
      b.id,
      b.kind,
      pos(b.x),
      pos(b.y),
      ...(b.confidence === undefined ? [] : [small(b.confidence)]),
    ]),
  };
  if (doc.shot) {
    const s = doc.shot;
    out.h = [
      s.cueBallId,
      s.aimAngleRad,
      small(s.tipOffset.side),
      small(s.tipOffset.vertical),
      small(s.speedMps),
      ...(s.elevationRad === undefined ? [] : [small(s.elevationRad)]),
    ];
  }
  if (doc.annotations.length > 0) {
    out.a = doc.annotations.map((a) => [
      "m",
      a.id,
      pos(a.from.x),
      pos(a.from.y),
      pos(a.to.x),
      pos(a.to.y),
    ]);
  }
  if (doc.source === undefined) out.o = 0;
  else if (doc.source.kind === "photo") out.o = 1;
  if (doc.style) {
    const s = doc.style;
    const y: Record<string, unknown> = {};
    if (s.showAllPaths !== undefined) y.a = s.showAllPaths;
    if (s.theme !== undefined && s.theme !== "table") y.t = THEME_CODE[s.theme];
    if (s.pathLine !== undefined && s.pathLine !== "solid") y.l = LINE_CODE[s.pathLine];
    if (s.pathWeight !== undefined && s.pathWeight !== "normal") y.w = WEIGHT_CODE[s.pathWeight];
    if (s.ballLabels === false) y.n = 0;
    if (s.caption !== undefined && s.caption !== "") y.c = s.caption;
    out.y = y;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Compact JSON to document, validating everything

class Invalid extends Error {}

function fail(): never {
  throw new Invalid(DAMAGED);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fail();
  return v;
}
function positive(v: unknown): number {
  const n = num(v);
  return n > 0 ? n : fail();
}
function int(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : fail();
}
function str(v: unknown): string {
  return typeof v === "string" && v.length > 0 && v.length < 200 ? v : fail();
}
function arr(v: unknown, min: number, max: number): unknown[] {
  return Array.isArray(v) && v.length >= min && v.length <= max ? (v as unknown[]) : fail();
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T {
  return allowed.find((a) => a === v) ?? fail();
}
function confidence(v: unknown): number {
  const n = num(v);
  return n >= 0 && n <= 1 ? n : fail();
}

function readTable(v: unknown): DocTable {
  if (typeof v === "string") return { preset: str(v) };
  if (!isObject(v)) return fail();
  const custom: CustomTableFields = {
    game: oneOf(v.g, GAMES),
    lengthM: positive(v.l),
    widthM: positive(v.w),
    cornerMouthM: positive(v.c),
    middleMouthM: positive(v.m),
    ...(v.j === undefined ? {} : { jawStyle: oneOf(v.j, ["angled", "rounded"] as const) }),
  };
  return { custom };
}

function readBallSet(v: unknown): DocBallSet {
  if (typeof v === "string") return { preset: str(v) };
  if (!isObject(v)) return fail();
  return {
    preset: str(v.p),
    ...(v.d === undefined ? {} : { diameterM: positive(v.d) }),
    ...(v.c === undefined ? {} : { cueDiameterM: positive(v.c) }),
  };
}

function readCloth(v: unknown): ClothSpec {
  if (!isObject(v)) return fail();
  const colour = str(v.c);
  let nap: Pick<ClothSpec, "nap"> = {};
  if (v.n !== undefined) {
    const n = arr(v.n, 2, 2);
    nap = { nap: { directionRad: num(n[0]), strength: num(n[1]) } };
  }
  if (typeof v.k === "string") {
    const name = oneOf(v.k, SPEEDS);
    return { colour, speedPreset: name, ...CLOTH_SPEEDS[name], ...nap };
  }
  const k = arr(v.k, 3, 3);
  return {
    colour,
    speedPreset: v.p === undefined ? "custom" : oneOf(v.p, SPEEDS),
    slidingFriction: num(k[0]),
    rollingResistance: num(k[1]),
    spinningFriction: num(k[2]),
    ...nap,
  };
}

function readBall(v: unknown): DocBall {
  const b = arr(v, 4, 5);
  return {
    id: str(b[0]),
    kind: oneOf(b[1], BALL_KINDS),
    x: unpos(int(b[2])),
    y: unpos(int(b[3])),
    ...(b.length === 5 ? { confidence: confidence(b[4]) } : {}),
  };
}

function readShot(v: unknown, balls: readonly DocBall[]): DocShot {
  const s = arr(v, 5, 6);
  const cueBallId = str(s[0]);
  if (!balls.some((b) => b.id === cueBallId)) return fail();
  return {
    cueBallId,
    aimAngleRad: num(s[1]),
    tipOffset: { side: num(s[2]), vertical: num(s[3]) },
    speedMps: positive(s[4]),
    ...(s.length === 6 ? { elevationRad: num(s[5]) } : {}),
  };
}

function readAnnotation(v: unknown): Annotation {
  const a = arr(v, 6, 6);
  oneOf(a[0], ["m"] as const);
  return {
    kind: "measure",
    id: str(a[1]),
    from: { x: unpos(int(a[2])), y: unpos(int(a[3])) },
    to: { x: unpos(int(a[4])), y: unpos(int(a[5])) },
  };
}

const THEME_CODE = { print: "p", dark: "d" } as const;
const LINE_CODE = { dashed: "d", dotted: "o" } as const;
const WEIGHT_CODE = { thin: "n", thick: "k" } as const;

function readStyle(v: unknown): NonNullable<DiagramDoc["style"]> {
  if (!isObject(v)) return fail();
  const style: NonNullable<DiagramDoc["style"]> = {};
  if (v.a !== undefined) {
    if (typeof v.a !== "boolean") return fail();
    style.showAllPaths = v.a;
  }
  if (v.t !== undefined) {
    if (v.t === "p") style.theme = "print";
    else if (v.t === "d") style.theme = "dark";
    else return fail();
  }
  if (v.l !== undefined) {
    if (v.l === "d") style.pathLine = "dashed";
    else if (v.l === "o") style.pathLine = "dotted";
    else return fail();
  }
  if (v.w !== undefined) {
    if (v.w === "n") style.pathWeight = "thin";
    else if (v.w === "k") style.pathWeight = "thick";
    else return fail();
  }
  if (v.n !== undefined) {
    if (v.n !== 0) return fail();
    style.ballLabels = false;
  }
  if (v.c !== undefined) {
    if (typeof v.c !== "string" || v.c === "" || v.c.length > CAPTION_MAX_LENGTH) return fail();
    style.caption = v.c;
  }
  return style;
}

function fromCompact(c: unknown): DiagramDoc {
  if (!isObject(c)) return fail();
  const balls = arr(c.b, 0, 10_000).map(readBall);
  if (new Set(balls.map((b) => b.id)).size !== balls.length) return fail();
  if (c.o !== undefined && c.o !== 0 && c.o !== 1) return fail();
  return {
    schemaVersion: SCHEMA_VERSION,
    table: readTable(c.t),
    ballSet: readBallSet(c.s),
    cloth: readCloth(c.k),
    balls,
    ...(c.h === undefined ? {} : { shot: readShot(c.h, balls) }),
    annotations: c.a === undefined ? [] : arr(c.a, 0, 10_000).map(readAnnotation),
    ...(c.o === 0
      ? {}
      : { source: { kind: c.o === 1 ? ("photo" as const) : ("manual" as const) } }),
    ...(c.y === undefined ? {} : { style: readStyle(c.y) }),
  };
}

// ---------------------------------------------------------------------------------------------
// Public API

/** The text that goes after the `#` of a link. */
export async function encodeDoc(doc: DiagramDoc, options: EncodeOptions = {}): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toCompact(doc)));
  const plain = toBase64Url(json);
  const version = String(SCHEMA_VERSION);
  if (options.compression !== "off" && canCompress()) {
    const packed = toBase64Url(
      await transform(json, new CompressionStream("deflate-raw"), Infinity),
    );
    if (packed.length < plain.length) return `v${version}.c.${packed}`;
  }
  return `v${version}.u.${plain}`;
}

/** Reads a link's text back into a document. Never throws. */
export async function decodeDoc(text: string): Promise<DecodeResult> {
  try {
    const parts = text.trim().replace(/^#/, "").split(".");
    const head = /^v(\d{1,6})$/.exec(parts[0] ?? "");
    if (!head) return { ok: false, problem: NOT_BAIZE };
    const version = Number(head[1]);
    if (version > SCHEMA_VERSION) {
      return { ok: false, problem: "This link was made by a newer version of Baize." };
    }
    if (parts.length !== 3 || (parts[1] !== "c" && parts[1] !== "u")) {
      return { ok: false, problem: DAMAGED };
    }
    const bytes = fromBase64Url(parts[2] ?? "");
    if (!bytes) return { ok: false, problem: DAMAGED };
    let json = bytes;
    if (parts[1] === "c") {
      if (!canDecompress()) {
        return { ok: false, problem: "This browser cannot open compressed Baize links." };
      }
      json = await transform(bytes, new DecompressionStream("deflate-raw"), MAX_UNPACKED_BYTES);
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
    const migrated = migrate(version, parsed);
    if (!migrated.ok) return migrated;
    return { ok: true, doc: fromCompact(migrated.compact) };
  } catch {
    return { ok: false, problem: DAMAGED };
  }
}

/** A document as a URL hash, including the leading "#". */
export async function docToHash(doc: DiagramDoc): Promise<string> {
  return `#${await encodeDoc(doc)}`;
}

/** The document in a URL hash, or undefined if the hash is empty or not a Baize link. */
export async function docFromHash(hash: string): Promise<DecodeResult | undefined> {
  if (!hash.startsWith("#v")) return undefined;
  return decodeDoc(hash.slice(1));
}
