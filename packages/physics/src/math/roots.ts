import { quadraticRoots } from "./quadratic";

/**
 * First "downward crossing" of a polynomial of degree at most 4 on a finite window.
 *
 * This is the one root-finding routine behind every collision test. The caller supplies a gap
 * function f(t) = c0 + c1 t + c2 t^2 + c3 t^3 + c4 t^4 that is positive while two things are
 * apart and reaches zero when they touch. The answer is the first time in [0, T] at which
 * they come into contact while closing.
 *
 * Method (derivative bracketing): the roots of f'' (a quadratic, closed form) split the window
 * into pieces on which f' is monotone; each piece holds at most one root of f', found by
 * bisection-safeguarded Newton; those roots split the window into pieces on which f itself is
 * monotone, and a monotone piece holds at most one crossing. Only + - * / and sqrt are used,
 * so results are bit-identical on every JavaScript engine.
 *
 * Contact rule:
 *  - If f starts positive, the event is the first time f falls to 0.
 *  - If f starts at or below 0 (already touching) and is closing faster than `closingTol`
 *    (f'(0) < -closingTol), the event is at t = 0.
 *  - If f starts at or below 0 and is not closing, nothing happens while it rises. If it never
 *    rises above 0 and later falls `penetrationTol` below its starting value, that is the event
 *    (resting contact that starts to press in). Once f has risen above 0 the pair has separated
 *    and the first rule applies again.
 *
 * `accept`, if given, can veto a crossing (for example a contact outside an arc's angular
 * range). The search then continues with the next crossing after f has risen above 0 again.
 */
export interface CrossingOptions {
  /** Threshold on -f'(0) above which a pair that starts in contact collides at t = 0. */
  readonly closingTol: number;
  /** How far below its starting value f must fall before resting contact counts as an event. */
  readonly penetrationTol: number;
  readonly accept?: (t: number) => boolean;
}

/** Returned when there is no crossing in the window. */
export const NO_CROSSING = -1;

const MAX_ITERATIONS = 200;

// Scratch storage; the routine is not re-entrant, and `accept` must not call it.
const quadScratch: number[] = [0, 0];
const breaksD: number[] = [0, 0, 0, 0];
const breaksF: number[] = [0, 0, 0, 0, 0];

function evalPoly(c0: number, c1: number, c2: number, c3: number, c4: number, t: number): number {
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * c4)));
}

/**
 * Root of the cubic-or-lower polynomial d0 + d1 t + d2 t^2 + d3 t^3 inside [lo, hi], given that
 * it is monotone there and its values at the ends have opposite signs (or one is zero).
 */
function monotoneRootCubic(
  d0: number,
  d1: number,
  d2: number,
  d3: number,
  lo: number,
  hi: number,
  fLo: number,
  fHi: number,
): number {
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  const rising = fHi > 0;
  let a = lo;
  let b = hi;
  let x = 0.5 * (a + b);
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const fx = d0 + x * (d1 + x * (d2 + x * d3));
    if (fx === 0) return x;
    if (fx > 0 === rising) b = x;
    else a = x;
    const mid = 0.5 * (a + b);
    if (mid <= a || mid >= b) break;
    const dfx = d1 + x * (2 * d2 + x * 3 * d3);
    let next = dfx !== 0 ? x - fx / dfx : mid;
    if (!(next > a && next < b)) next = mid;
    x = next;
  }
  return 0.5 * (a + b);
}

/**
 * Time in (lo, hi] at which the quartic falls to `level`, given that it is monotone decreasing
 * on [lo, hi], above `level` at lo and at or below it at hi. Returns a time at which the
 * polynomial is at or below `level` (the contact side), within a few ulps of the true crossing.
 */
function decreasingCrossing(
  c0: number,
  c1: number,
  c2: number,
  c3: number,
  c4: number,
  level: number,
  lo: number,
  hi: number,
): number {
  let a = lo; // f(a) > level
  let b = hi; // f(b) <= level
  let x = 0.5 * (a + b);
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const fx = evalPoly(c0, c1, c2, c3, c4, x) - level;
    if (fx > 0) a = x;
    else b = x;
    const mid = 0.5 * (a + b);
    if (mid <= a || mid >= b) break;
    const dfx = c1 + x * (2 * c2 + x * (3 * c3 + x * 4 * c4));
    let next = dfx < 0 ? x - fx / dfx : mid;
    if (!(next > a && next < b)) next = mid;
    x = next;
  }
  return b;
}

/**
 * See the module comment. Coefficients are in ascending order. `T` must be finite and >= 0.
 * Returns the event time in [0, T], or NO_CROSSING.
 */
export function firstDownCrossing(
  c0: number,
  c1: number,
  c2: number,
  c3: number,
  c4: number,
  T: number,
  options: CrossingOptions,
): number {
  const accept = options.accept;

  // Start in contact and closing: immediate event.
  let vetoedAtStart = false;
  if (c0 <= 0 && c1 < -options.closingTol) {
    if (accept === undefined || accept(0)) return 0;
    vetoedAtStart = true;
  }
  if (!(T > 0)) return NO_CROSSING;

  // Cheap rejection: a lower bound of f on [0, T] that stays positive means no contact.
  if (c0 > 0) {
    const T2 = T * T;
    const bound =
      c0 +
      (c1 < 0 ? c1 * T : 0) +
      (c2 < 0 ? c2 * T2 : 0) +
      (c3 < 0 ? c3 * T2 * T : 0) +
      (c4 < 0 ? c4 * T2 * T2 : 0);
    if (bound > 0) return NO_CROSSING;
  }

  // f'(t) = d0 + d1 t + d2 t^2 + d3 t^3
  const d0 = c1;
  const d1 = 2 * c2;
  const d2 = 3 * c3;
  const d3 = 4 * c4;

  // Roots of f'' inside (0, T) split [0, T] into monotone pieces of f'.
  let nD = 0;
  const nQ = quadraticRoots(3 * d3, 2 * d2, d1, quadScratch);
  for (let i = 0; i < nQ; i++) {
    const r = quadScratch[i] as number;
    if (r > 0 && r < T) breaksD[nD++] = r;
  }

  // Roots of f' inside (0, T): the interior breakpoints of the monotone pieces of f.
  let nF = 0;
  let u = 0;
  let fu = d0;
  for (let i = 0; i <= nD; i++) {
    const v = i < nD ? (breaksD[i] as number) : T;
    const fv = d0 + v * (d1 + v * (d2 + v * d3));
    if ((fu < 0 && fv > 0) || (fu > 0 && fv < 0)) {
      const r = monotoneRootCubic(d0, d1, d2, d3, u, v, fu, fv);
      if (r > 0 && r < T && (nF === 0 || r > (breaksF[nF - 1] as number))) breaksF[nF++] = r;
    } else if (fv === 0 && v > 0 && v < T && (nF === 0 || v > (breaksF[nF - 1] as number))) {
      breaksF[nF++] = v;
    }
    u = v;
    fu = fv;
  }

  // Walk the monotone pieces of f in time order.
  // `level` is what f must fall to for an event: 0 once the pair is apart; a little below the
  // starting value while it has been in contact since t = 0; -Infinity after a vetoed crossing
  // until f rises above 0 again.
  let level = c0 > 0 ? 0 : vetoedAtStart ? Number.NEGATIVE_INFINITY : c0 - options.penetrationTol;
  let a = 0;
  let fa = c0;
  for (let i = 0; i <= nF; i++) {
    const b = i < nF ? (breaksF[i] as number) : T;
    const fb = evalPoly(c0, c1, c2, c3, c4, b);
    if (fa > 0) level = 0;
    if (fb < fa && fa > level && fb <= level) {
      const t = decreasingCrossing(c0, c1, c2, c3, c4, level, a, b);
      if (accept === undefined || accept(t)) return t;
      level = Number.NEGATIVE_INFINITY;
    }
    a = b;
    fa = fb;
  }
  return NO_CROSSING;
}
