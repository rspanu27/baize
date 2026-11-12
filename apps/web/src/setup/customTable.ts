import { TABLE_DEFAULTS, validateTable } from "@baize/tables";
import type {
  CustomTableFields,
  GameType,
  JawStyle,
  TableSpec,
  ValidationIssue,
} from "@baize/tables";
import type { DocBallSet } from "../doc/types";
import { formatLength, parseLength } from "../units/units";
import type { UnitSystem } from "../units/units";

/**
 * Pure core of the custom table form: the text a person typed in, and what it means for the
 * document. No React, no store.
 */

/** What the form holds: raw text for each length, plus the two choices. */
export interface TableTexts {
  game: GameType;
  /** "auto" leaves `jawStyle` out of the fields, so the game decides. */
  jawStyle: JawStyle | "auto";
  length: string;
  width: string;
  cornerMouth: string;
  middleMouth: string;
}

export type LengthTextField = "length" | "width" | "cornerMouth" | "middleMouth";

/** Fields a message can be shown next to (the ball size control is not part of this form). */
export type ProblemField = keyof CustomTableFields | "ballDiameterM";

export const LENGTH_TEXT_FIELDS: readonly LengthTextField[] = [
  "length",
  "width",
  "cornerMouth",
  "middleMouth",
];

/** The field of `CustomTableFields` that each text box stands for. */
export const FIELD_OF_TEXT: Readonly<Record<LengthTextField, keyof CustomTableFields>> = {
  length: "lengthM",
  width: "widthM",
  cornerMouth: "cornerMouthM",
  middleMouth: "middleMouthM",
};

export const UNPARSEABLE_MESSAGE = "Enter a length such as 2540 mm or 100 in.";

export interface CustomTableResult {
  /** Present when every text parsed (it may still have errors). */
  fields?: CustomTableFields;
  /** Text that could not be read, by field. */
  fieldProblems: Partial<Record<ProblemField, string[]>>;
  /** Everything `validateTable` reported, except about fields whose text did not parse. */
  issues: ValidationIssue[];
  /** True when all text parsed and there are no errors (warnings do not block). */
  canApply: boolean;
}

/** Enough decimals that a value survives being shown and read back. */
const TEXT_PRECISION = 5;

function fmt(valueM: number, system: UnitSystem): string {
  return formatLength(valueM, system, { precision: TEXT_PRECISION });
}

/** The form text for a preset's `TableSpec` or for a custom table's fields. */
export function initialTexts(
  source: TableSpec | CustomTableFields,
  system: UnitSystem,
): TableTexts {
  if ("playingArea" in source) {
    return {
      game: source.game,
      jawStyle: "auto",
      length: fmt(source.playingArea.lengthM, system),
      width: fmt(source.playingArea.widthM, system),
      cornerMouth: fmt(source.pockets.corner.mouthM, system),
      middleMouth: fmt(source.pockets.middle.mouthM, system),
    };
  }
  return {
    game: source.game,
    jawStyle: source.jawStyle ?? "auto",
    length: fmt(source.lengthM, system),
    width: fmt(source.widthM, system),
    cornerMouth: fmt(source.cornerMouthM, system),
    middleMouth: fmt(source.middleMouthM, system),
  };
}

/** Re-expresses every length in the text in another unit system (unreadable text stays). */
export function reformatTexts(texts: TableTexts, from: UnitSystem, to: UnitSystem): TableTexts {
  const next = { ...texts };
  for (const key of LENGTH_TEXT_FIELDS) {
    const m = parseLength(texts[key], from);
    if (m !== undefined) next[key] = fmt(m, to);
  }
  return next;
}

/** Reads the form text and checks it against the table rules. */
export function evaluateCustomTable(
  texts: TableTexts,
  system: UnitSystem,
  ballDiameterM: number,
): CustomTableResult {
  const fieldProblems: Partial<Record<ProblemField, string[]>> = {};
  const parsed: Partial<Record<LengthTextField, number>> = {};
  for (const key of LENGTH_TEXT_FIELDS) {
    const value = parseLength(texts[key], system);
    if (value === undefined) fieldProblems[FIELD_OF_TEXT[key]] = [UNPARSEABLE_MESSAGE];
    else parsed[key] = value;
  }
  const allParsed = Object.keys(fieldProblems).length === 0;
  const fields: CustomTableFields = {
    game: texts.game,
    lengthM: parsed.length ?? Number.NaN,
    widthM: parsed.width ?? Number.NaN,
    cornerMouthM: parsed.cornerMouth ?? Number.NaN,
    middleMouthM: parsed.middleMouth ?? Number.NaN,
    ...(texts.jawStyle === "auto" ? {} : { jawStyle: texts.jawStyle }),
  };
  const issues = validateTable(fields, ballDiameterM).filter(
    (i) => fieldProblems[i.field] === undefined,
  );
  const hasError = issues.some((i) => i.severity === "error");
  return {
    ...(allParsed ? { fields } : {}),
    fieldProblems,
    issues,
    canApply: allParsed && !hasError,
  };
}

/** The ball set for a table of this game: the current one if it fits, else the game's default. */
export function ballSetForGame(
  current: DocBallSet,
  currentGame: GameType | undefined,
  game: GameType,
): DocBallSet {
  if (currentGame === game) return current;
  return { preset: TABLE_DEFAULTS.defaultBallSetId[game] };
}
