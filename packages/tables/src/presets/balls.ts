import type { BallKind, BallSetSpec, PoolNumber } from "../types";

/** Millimetres to metres. */
const MM = 0.001;
/** Grams to kilograms. */
const G = 0.001;

/**
 * Ball-ball normal restitution for phenolic (Aramith-type) balls.
 * Source: Dr. Dave Alciatore, technical proofs TP A.5 and TP A.16 use e = 0.94
 * (https://billiards.colostate.edu/technical_proofs/new/TP_A-5.pdf); his April 2005 Billiards
 * Digest article says most experimental values lie in 0.90-0.96
 * (https://billiards.colostate.edu/bd_articles/2005/april05.pdf); his equipment FAQ gives
 * 0.92-0.98 (https://drdavepoolinfo.com/?p=2349). 0.94 sits inside all three ranges.
 * Used for every set: all are cast phenolic resin. Snooker-specific measurements were not found.
 */
const PHENOLIC_RESTITUTION = 0.94;

/** x cubed by multiplication: `**` is not guaranteed to round the same way in every browser. */
function cube(x: number): number {
  return x * x * x;
}

const SNOOKER_KINDS: BallSetSpec["kinds"] = [
  { kind: "cue", count: 1 },
  { kind: "red", count: 15 },
  { kind: "yellow", count: 1 },
  { kind: "green", count: 1 },
  { kind: "brown", count: 1 },
  { kind: "blue", count: 1 },
  { kind: "pink", count: 1 },
  { kind: "black", count: 1 },
];

const POOL_NUMBERS: readonly PoolNumber[] = [
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

const POOL_KINDS: BallSetSpec["kinds"] = [
  { kind: "cue", count: 1 },
  ...POOL_NUMBERS.map((kind): { kind: BallKind; count: number } => ({ kind, count: 1 })),
];

const BLACKBALL_KINDS: BallSetSpec["kinds"] = [
  { kind: "cue", count: 1 },
  { kind: "red", count: 7 },
  { kind: "yellow", count: 7 },
  { kind: "black", count: 1 },
];

/** All ball sets. Ids are immutable; changing a number means a new revision (`@2`). */
export const BALL_SETS: readonly BallSetSpec[] = [
  {
    id: "snooker-52@1",
    name: "Snooker 52.5 mm",
    game: "snooker",
    kinds: SNOOKER_KINDS,
    object: {
      // Aramith Tournament Champion snooker balls: 2 1/16 in = 52.5 mm
      // (https://www.hamiltonbilliards.com/aramith-2-1-16-inch-52-5mm-22-ball-snooker-set.html).
      diameterM: 52.5 * MM,
      // Retailer listing "weight of each ball approx. 142 g", 1 g matching for SuperPro 1G
      // (https://store.kozoom.com/en/aramith-tournament-champion-superpro-1g-snooker-ball-set.html).
      // No official WPBSA mass was found.
      massKg: 142 * G,
    },
    restitution: PHENOLIC_RESTITUTION,
  },
  {
    id: "snooker-51@1",
    name: "Snooker 2 in (50.8 mm)",
    game: "snooker",
    kinds: SNOOKER_KINDS,
    object: {
      // Aramith Premier 2 in = 50.8 mm snooker set, 22 balls
      // (https://www.ypc.co.uk/product/2inch-50-8mm-aramith-premier-snooker-ball-set-22-balls/);
      // marketed for 6-7 ft tables
      // (https://www.libertygames.co.uk/store/pool-balls/english/aramith-2-inch-snooker-4706203/).
      diameterM: 50.8 * MM,
      // UNVERIFIED: no per-ball mass found. Scaled from 142 g at 52.5 mm by volume (d^3),
      // same phenolic density: 142 * (50.8 / 52.5)^3 = 128.7 g.
      massKg: 142 * cube(50.8 / 52.5) * G,
    },
    restitution: PHENOLIC_RESTITUTION,
  },
  {
    id: "snooker-48@1",
    name: "Snooker 1 7/8 in (47.6 mm)",
    game: "snooker",
    kinds: SNOOKER_KINDS,
    object: {
      // 1 7/8 in = 47.625 mm; 1 7/8 in is sold as a cue ball size by Aramith
      // (https://www.libertygames.co.uk/store/pool-balls/english/suzo-aramith-premier-red-yellow/).
      // UNVERIFIED: a full 22-ball 1 7/8 in snooker set was not found for sale; the size comes
      // from the small-table ball size chart
      // (https://www.askabilliards.com/blogs/billiards-guide/pool-ball-size-chart-what-size-pool-balls-do-you-need).
      diameterM: 47.625 * MM,
      // UNVERIFIED: scaled from 142 g at 52.5 mm by volume: 142 * (47.625 / 52.5)^3 = 106.0 g.
      massKg: 142 * cube(47.625 / 52.5) * G,
    },
    restitution: PHENOLIC_RESTITUTION,
  },
  {
    id: "pool-57@1",
    name: "Pool 2 1/4 in (57.15 mm)",
    game: "pool",
    kinds: POOL_KINDS,
    object: {
      // WPA equipment specifications, section 16 (balls): diameter 2 1/4 in = 57.15 mm
      // (reproduced at https://www.poolroom.com/tournament-table-equipment-specifications/).
      diameterM: 57.15 * MM,
      // WPA equipment specifications, section 16: weight 5.5-6.0 oz (156-170 g). Middle of the
      // range: 5.75 oz = 163.0 g. Dr. Dave notes real balls are about 5.8-5.9 oz
      // (https://www.engr.colostate.edu/~dga/pool/cue/weight/).
      massKg: 5.75 * 28.349523125 * G,
    },
    restitution: PHENOLIC_RESTITUTION,
  },
  {
    id: "blackball-51@1",
    name: "Blackball 2 in (50.8 mm)",
    game: "blackball",
    kinds: BLACKBALL_KINDS,
    object: {
      // Aramith 2 in red and yellow league pool balls, with a 1 7/8 in white
      // (https://www.mastersofgames.com/?p=55527).
      diameterM: 50.8 * MM,
      // UNVERIFIED: no per-ball mass found (only ~2.1 kg per 16-ball set including packaging).
      // Scaled from the WPA pool mean of 163.0 g at 57.15 mm by volume:
      // 163.0 * (50.8 / 57.15)^3 = 114.5 g.
      massKg: 5.75 * 28.349523125 * cube(50.8 / 57.15) * G,
    },
    cue: {
      // 1 7/8 in = 47.625 mm white ball, same listing as above.
      diameterM: 47.625 * MM,
      // UNVERIFIED: scaled by volume as above: 163.0 * (47.625 / 57.15)^3 = 94.3 g.
      massKg: 5.75 * 28.349523125 * cube(47.625 / 57.15) * G,
    },
    restitution: PHENOLIC_RESTITUTION,
  },
];

export function getBallSet(id: string): BallSetSpec | undefined {
  return BALL_SETS.find((b) => b.id === id);
}
