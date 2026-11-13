import type { BallKind } from "@baize/tables";

/**
 * Measuring an import against the truth. Used on synthetic photos in the test suite and,
 * once the project has them, on real labelled photos (see the README for the label format).
 *
 * Position error is given as a share of the table's length, which is how the targets are
 * stated: at most 0.6 % at the median and 1.5 % at the 95th percentile, with at least 95 %
 * of the balls found and 90 % of the solid and snooker balls named.
 */

export interface PlacedBall {
  kind: BallKind;
  x: number;
  y: number;
}

export interface PhotoScore {
  /** Balls that are really there. */
  truth: number;
  /** Of those, how many were found (a found ball within one ball diameter). */
  found: number;
  /** Found balls that match no real ball. */
  extra: number;
  /** Of the found ones, how many were given the right kind. */
  named: number;
  /** Position error of each found ball, as a share of the table length. */
  errors: number[];
}

/**
 * Scores one photo: pairs found balls with real ones, nearest pair first, each ball used
 * once, and only when they are within one ball diameter of each other.
 */
export function scorePhoto(
  found: readonly PlacedBall[],
  truth: readonly PlacedBall[],
  tableLengthM: number,
  ballDiameterM: number,
): PhotoScore {
  const pairs: { t: number; f: number; dist: number }[] = [];
  truth.forEach((t, ti) => {
    found.forEach((f, fi) => {
      const dist = Math.hypot(f.x - t.x, f.y - t.y);
      if (dist < ballDiameterM) pairs.push({ t: ti, f: fi, dist });
    });
  });
  pairs.sort((a, b) => a.dist - b.dist || a.t - b.t || a.f - b.f);
  const usedTruth = new Set<number>();
  const usedFound = new Set<number>();
  const errors: number[] = [];
  let named = 0;
  for (const p of pairs) {
    if (usedTruth.has(p.t) || usedFound.has(p.f)) continue;
    usedTruth.add(p.t);
    usedFound.add(p.f);
    errors.push(p.dist / tableLengthM);
    if ((found[p.f] as PlacedBall).kind === (truth[p.t] as PlacedBall).kind) named++;
  }
  return {
    truth: truth.length,
    found: usedTruth.size,
    extra: found.length - usedFound.size,
    named,
    errors,
  };
}

export interface SetSummary {
  photos: number;
  balls: number;
  /** Share of real balls that were found. */
  recall: number;
  /** Share of found balls given the right kind. */
  identity: number;
  /** Position error as a share of the table length; NaN when no ball was found. */
  medianError: number;
  p95Error: number;
  /** Balls reported that are not there, per photo. */
  extraPerPhoto: number;
}

/** The value below which the given share of a sorted list lies (nearest rank). */
export function quantile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index] as number;
}

/** Sums the scores of many photos into the figures the targets are stated in. */
export function summarise(scores: readonly PhotoScore[]): SetSummary {
  let balls = 0;
  let found = 0;
  let named = 0;
  let extra = 0;
  const errors: number[] = [];
  for (const s of scores) {
    balls += s.truth;
    found += s.found;
    named += s.named;
    extra += s.extra;
    errors.push(...s.errors);
  }
  errors.sort((a, b) => a - b);
  return {
    photos: scores.length,
    balls,
    recall: balls > 0 ? found / balls : Number.NaN,
    identity: found > 0 ? named / found : Number.NaN,
    medianError: quantile(errors, 0.5),
    p95Error: quantile(errors, 0.95),
    extraPerPhoto: scores.length > 0 ? extra / scores.length : Number.NaN,
  };
}

/** One line of plain text for a report. */
export function describeSummary(s: SetSummary): string {
  const pct = (v: number, digits = 1): string =>
    Number.isNaN(v) ? "n/a" : `${(v * 100).toFixed(digits)} %`;
  return (
    `${String(s.photos)} photos, ${String(s.balls)} balls: found ${pct(s.recall)}, ` +
    `named ${pct(s.identity)}, position error median ${pct(s.medianError, 2)} ` +
    `and 95th percentile ${pct(s.p95Error, 2)} of the table length, ` +
    `${s.extraPerPhoto.toFixed(2)} false balls per photo`
  );
}
