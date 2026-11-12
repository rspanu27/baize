import type { BallInput } from "@baize/physics";
import {
  getBallSet,
  getTablePreset,
  makeCloth,
  resolveCustomTable,
  validateTable,
} from "@baize/tables";
import type { BallKind, BallSetSpec, ClothSpec, TableSpec } from "@baize/tables";
import { SCHEMA_VERSION } from "./types";
import type { DiagramDoc, DocBallSet, DocShot } from "./types";

/**
 * Turns a document into the concrete things the renderer and the simulator need: a full
 * table, a full ball set, and balls with their sizes.
 */

export interface SceneBall extends BallInput {
  kind: BallKind;
  confidence?: number;
}

export interface Scene {
  table: TableSpec;
  ballSet: BallSetSpec;
  cloth: ClothSpec;
  balls: SceneBall[];
  shot?: DocShot;
}

export type ResolveResult =
  | { ok: true; scene: Scene }
  /** Plain-words problems, for example an unknown preset or impossible custom table. */
  | { ok: false; problems: string[] };

/** The ball set a document asks for, with any size overrides applied. */
export function resolveBallSet(spec: DocBallSet): BallSetSpec | undefined {
  const base = getBallSet(spec.preset);
  if (!base) return undefined;
  if (spec.diameterM === undefined && spec.cueDiameterM === undefined) return base;
  // A ball of another size is taken to be made of the same material: mass goes with volume.
  const scaled = (size: { diameterM: number; massKg: number }, diameterM: number) => {
    const k = diameterM / size.diameterM;
    return { diameterM, massKg: size.massKg * k * k * k };
  };
  const object = spec.diameterM === undefined ? base.object : scaled(base.object, spec.diameterM);
  const baseCue = base.cue ?? base.object;
  const cue =
    spec.cueDiameterM !== undefined
      ? scaled(baseCue, spec.cueDiameterM)
      : base.cue
        ? spec.diameterM === undefined
          ? base.cue
          : scaled(base.cue, (base.cue.diameterM / base.object.diameterM) * spec.diameterM)
        : undefined;
  return { ...base, id: `${base.id}+custom`, object, ...(cue ? { cue } : {}) };
}

export function resolveDoc(doc: DiagramDoc): ResolveResult {
  const problems: string[] = [];
  const ballSet = resolveBallSet(doc.ballSet);
  if (!ballSet)
    problems.push(`This diagram uses a ball set that is not known: ${doc.ballSet.preset}.`);

  let table: TableSpec | undefined;
  if ("preset" in doc.table) {
    table = getTablePreset(doc.table.preset);
    if (!table) problems.push(`This diagram uses a table that is not known: ${doc.table.preset}.`);
  } else if (ballSet) {
    const errors = validateTable(doc.table.custom, ballSet.object.diameterM).filter(
      (i) => i.severity === "error",
    );
    if (errors.length > 0) problems.push(...errors.map((e) => e.message));
    else table = resolveCustomTable(doc.table.custom, ballSet.object.diameterM);
  }

  if (!table || !ballSet || problems.length > 0) return { ok: false, problems };

  const balls: SceneBall[] = doc.balls.map((b) => {
    const size = b.kind === "cue" && ballSet.cue ? ballSet.cue : ballSet.object;
    return {
      id: b.id,
      kind: b.kind,
      radiusM: size.diameterM / 2,
      massKg: size.massKg,
      x: b.x,
      y: b.y,
      ...(b.confidence === undefined ? {} : { confidence: b.confidence }),
    };
  });
  return {
    ok: true,
    scene: { table, ballSet, cloth: doc.cloth, balls, ...(doc.shot ? { shot: doc.shot } : {}) },
  };
}

/** Cloth colour used for a new diagram. */
export const DEFAULT_CLOTH_COLOUR = "#1d7a5f";

/** A new, empty diagram on a table preset, with that table's usual balls and medium cloth. */
export function newDoc(tablePresetId: string): DiagramDoc {
  const table = getTablePreset(tablePresetId);
  if (!table) throw new Error(`Unknown table preset: ${tablePresetId}`);
  return {
    schemaVersion: SCHEMA_VERSION,
    table: { preset: table.id },
    ballSet: { preset: table.defaultBallSetId },
    cloth: makeCloth(DEFAULT_CLOTH_COLOUR, "medium"),
    balls: [],
    annotations: [],
    source: { kind: "manual" },
  };
}
