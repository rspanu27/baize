import type { CustomTableFields, TableSpec } from "../types";
import { resolveCustomTable } from "../validate";

/**
 * Table presets.
 *
 * Each preset gives the measurements a player could take off a real table: playing area
 * (cushion nose to cushion nose), pocket openings and the ball size the table is played with.
 * The rest (jaw curve, pocket drop, cushion height, bounce and grip) is derived by the same
 * rules as for a custom table, in `validate.ts`, so presets and custom tables share one code
 * path. Those derived values are modelling choices, not published figures.
 *
 * Research notes, sources and open questions: docs/research/table-presets.md. Playing areas
 * and ball sizes were signed off by the project owner on 2026-11-12.
 *
 * Preset ids carry a revision ("@1") and never change meaning once public: a corrected preset
 * gets a new revision and the old one stays, so shared links keep showing the same table.
 *
 * `mouthM` is the opening where the jaw facings begin. For pool that is the usual
 * point-to-point mouth; for the rounded jaws of snooker, blackball and Chinese 8-ball it is
 * the opening usually quoted "at the fall".
 */

const INCH = 0.0254; // exact: 1 in = 25.4 mm by definition

interface PresetDef {
  id: string;
  name: string;
  /** Ball diameter the table is normally played with; sets jaw, drop and cushion defaults. */
  ballDiameterM: number;
  /** Overrides the game's default ball set where the table uses a different size. */
  ballSetId?: string;
  fields: CustomTableFields;
}

// WPA pool pocket mouths, used by every regulation-style pool preset:
// corner 4.5 to 4.625 in, side 5 to 5.125 in (WPA Tournament Table and Equipment
// Specifications, as republished at
// https://www.poolroom.com/tournament-table-equipment-specifications/). Midpoints are used.
const WPA_CORNER_MOUTH_M = ((4.5 + 4.625) / 2) * INCH;
const WPA_SIDE_MOUTH_M = ((5 + 5.125) / 2) * INCH;

// WPA pool ball: 2 1/4 in (same WPA specification page).
const POOL_BALL_M = 2.25 * INCH;

// WPBSA snooker ball: 52.5 mm (WPBSA Official Rules of Snooker and English Billiards,
// May 2022, Section 1, 2(b),
// https://wpbsa.com/wp-content/uploads/Rulebook-Website-Updated-May-2022.pdf).
const SNOOKER_BALL_M = 0.0525;

// Snooker pocket openings are set by WPBSA templates that are not published. These are the
// commonly quoted approximations "at the fall": corner about 3.5 in, middle about 4 in
// (https://forums.azbilliards.com/threads/what-size-are-the-pockets-and-balls-on.268994/ and
// https://aplussnooker.com/standard-snooker-table-sizes-and-dimensions-explained/).
// UNVERIFIED against the templates.
const SNOOKER_CORNER_MOUTH_M = 3.5 * INCH;
const SNOOKER_MIDDLE_MOUTH_M = 4 * INCH;

// UK pool balls: 2 in object balls (Riley FAQ and https://en.wikipedia.org/wiki/Blackball_(pool)).
const BLACKBALL_BALL_M = 2 * INCH;
// UK pool pocket opening: 1.6 ball diameters (WEPF specification as cited at
// https://en.wikipedia.org/wiki/Billiard_table). Used for corner and middle pockets alike:
// UNVERIFIED for the middle pockets, for which no separate figure was found.
const BLACKBALL_MOUTH_M = 1.6 * BLACKBALL_BALL_M;

const DEFS: readonly PresetDef[] = [
  {
    id: "snooker-12@1",
    name: "Snooker 12 ft",
    ballDiameterM: SNOOKER_BALL_M,
    fields: {
      game: "snooker",
      // 11 ft 8.5 in x 5 ft 10 in = 3569 x 1778 mm (WPBSA rules, May 2022, Section 1, 1(a)).
      lengthM: 3.569,
      widthM: 1.778,
      cornerMouthM: SNOOKER_CORNER_MOUTH_M,
      middleMouthM: SNOOKER_MIDDLE_MOUTH_M,
    },
  },
  {
    id: "snooker-10@1",
    name: "Snooker 10 ft",
    ballDiameterM: SNOOKER_BALL_M,
    fields: {
      game: "snooker",
      // 9 ft 8 in x 4 ft 10 in = 2946 x 1473 mm. No governing-body figure exists; this is the
      // value retailers and https://aplussnooker.com/standard-snooker-table-sizes-and-dimensions-explained/
      // agree on. Approximate; signed off by the project owner.
      lengthM: 2.946,
      widthM: 1.473,
      // No source for 10 ft pockets: same openings as the 12 ft table (same ball). UNVERIFIED.
      cornerMouthM: SNOOKER_CORNER_MOUTH_M,
      middleMouthM: SNOOKER_MIDDLE_MOUTH_M,
    },
  },
  {
    id: "snooker-6@1",
    name: "Snooker 6 ft",
    // 1 7/8 in balls: small snooker tables are sold with 1 7/8 in or 2 in balls
    // (https://bestsnookercue.com/blogs/news/snooker-table-sizes-explained-12ft-10ft-6ft).
    // The smaller size is the default because a full 15-red pack does not fit between the
    // pink and black spots of this table with 2 in balls.
    ballDiameterM: 1.875 * INCH,
    ballSetId: "snooker-48@1",
    fields: {
      game: "snooker",
      // 1740 x 864 mm. Inferred: a 6 ft x 3 ft 1.5 in bed less the 89 mm per direction by
      // which the 12 ft playing area is smaller than its bed. UNVERIFIED; signed off by the
      // project owner as the working value.
      lengthM: 1.74,
      widthM: 0.864,
      // No source: the 12 ft openings scaled to the smaller ball (1.57 and 1.78 ball
      // diameters, against 1.69 and 1.94 on the 12 ft table). UNVERIFIED.
      cornerMouthM: 0.075,
      middleMouthM: 0.085,
    },
  },
  {
    id: "pool-9@1",
    name: "Pool 9 ft",
    ballDiameterM: POOL_BALL_M,
    fields: {
      game: "pool",
      // 100 x 50 in (WPA specification, poolroom.com page above).
      lengthM: 100 * INCH,
      widthM: 50 * INCH,
      cornerMouthM: WPA_CORNER_MOUTH_M,
      middleMouthM: WPA_SIDE_MOUTH_M,
    },
  },
  {
    id: "pool-8-pro@1",
    name: "Pool 8 ft pro (92 x 46 in)",
    ballDiameterM: POOL_BALL_M,
    fields: {
      game: "pool",
      // 92 x 46 in: the 8 ft size in the WPA specification (poolroom.com page above).
      lengthM: 92 * INCH,
      widthM: 46 * INCH,
      cornerMouthM: WPA_CORNER_MOUTH_M,
      middleMouthM: WPA_SIDE_MOUTH_M,
    },
  },
  {
    id: "pool-8@1",
    name: "Pool 8 ft (88 x 44 in)",
    ballDiameterM: POOL_BALL_M,
    fields: {
      game: "pool",
      // 88 x 44 in: the common home 8 ft size, chosen by the project owner. UNVERIFIED: no
      // manufacturer page confirming it was found.
      lengthM: 88 * INCH,
      widthM: 44 * INCH,
      // Assumed to follow the WPA mouths; home tables are often looser. UNVERIFIED.
      cornerMouthM: WPA_CORNER_MOUTH_M,
      middleMouthM: WPA_SIDE_MOUTH_M,
    },
  },
  {
    id: "pool-7@1",
    name: "Pool 7 ft (78 x 39 in)",
    ballDiameterM: POOL_BALL_M,
    fields: {
      game: "pool",
      // 78 x 39 in: Diamond-style 7 ft size, chosen by the project owner. UNVERIFIED: no
      // manufacturer page confirming it was found. (pooltool's 7 ft table uses the same
      // 1.9812 x 0.9906 m: https://pooltool.readthedocs.io/en/stable/resources/table_specs.html)
      lengthM: 78 * INCH,
      widthM: 39 * INCH,
      // Bar tables are said to have slightly larger pockets than regulation tables; no figures
      // were found. Assumed 0.118 and 0.131 m (pooltool's 7 ft table: 0.118 and 0.137 m,
      // same page). UNVERIFIED.
      cornerMouthM: 0.118,
      middleMouthM: 0.131,
    },
  },
  {
    id: "pool-7-valley@1",
    name: "Pool 7 ft Valley (74 x 37 in)",
    ballDiameterM: POOL_BALL_M,
    fields: {
      game: "pool",
      // 74 x 37 in: Valley bar-box size, chosen by the project owner. UNVERIFIED: no Valley
      // page stating the playing area was found.
      lengthM: 74 * INCH,
      widthM: 37 * INCH,
      // Valley pockets are reported to be more generous than regulation; no figures were
      // found. Assumed 0.120 and 0.133 m. UNVERIFIED.
      cornerMouthM: 0.12,
      middleMouthM: 0.133,
    },
  },
  {
    id: "blackball-7@1",
    name: "UK pool 7 ft",
    ballDiameterM: BLACKBALL_BALL_M,
    fields: {
      game: "blackball",
      // 1.83 x 0.91 m: supplied by the project owner (2026-11-12).
      lengthM: 1.83,
      widthM: 0.91,
      cornerMouthM: BLACKBALL_MOUTH_M,
      middleMouthM: BLACKBALL_MOUTH_M,
    },
  },
  {
    id: "blackball-6@1",
    name: "UK pool 6 ft",
    ballDiameterM: BLACKBALL_BALL_M,
    fields: {
      game: "blackball",
      // 1.68 x 0.84 m: supplied by the project owner (2026-11-12).
      lengthM: 1.68,
      widthM: 0.84,
      cornerMouthM: BLACKBALL_MOUTH_M,
      middleMouthM: BLACKBALL_MOUTH_M,
    },
  },
  {
    id: "chinese8-9@1",
    name: "Chinese 8-ball 9 ft",
    ballDiameterM: POOL_BALL_M,
    fields: {
      // Pool markings and pool balls, with snooker-style rounded pocket jaws.
      game: "pool",
      jawStyle: "rounded",
      // 2540 x 1270 mm (World Chinese 8-ball Masters rules 2017, Section 3, as posted at
      // https://forums.azbilliards.com/threads/%EF%BC%882%EF%BC%89world-chinese-8-ball-masters-rules-standard-rules-for-the-chinese-eight-ball-game.454319).
      // The 2025 Heyball rules give 1260 mm for the width; both are within the stated +/-9 mm.
      lengthM: 2.54,
      widthM: 1.27,
      // 3.34 in opening quoted for Joy tables without saying which pocket
      // (cuesportsyorkshire.co.uk listing, see research notes); taken as the corner. The middle
      // is assumed to be 3.5 in. UNVERIFIED.
      cornerMouthM: 3.34 * INCH,
      middleMouthM: 3.5 * INCH,
    },
  },
];

function build(def: PresetDef): TableSpec {
  const derived = resolveCustomTable(def.fields, def.ballDiameterM);
  return {
    ...derived,
    id: def.id,
    name: def.name,
    defaultBallSetId: def.ballSetId ?? derived.defaultBallSetId,
  };
}

/** All table presets, in the order they are offered. */
export const TABLE_PRESETS: readonly TableSpec[] = DEFS.map(build);

/** Ball diameter each preset's pockets and cushions were derived for, by preset id. */
export const PRESET_BALL_DIAMETER_M: Readonly<Record<string, number>> = Object.fromEntries(
  DEFS.map((d) => [d.id, d.ballDiameterM]),
);

export function getTablePreset(id: string): TableSpec | undefined {
  return TABLE_PRESETS.find((t) => t.id === id);
}
