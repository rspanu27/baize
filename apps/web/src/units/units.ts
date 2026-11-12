// Display units. Everything inside the app is SI; this is the only module where mm, inches, feet,
// cm, mph and degrees appear.

export type UnitSystem = "metric" | "imperial";

/** Metres per inch (exact, by the 1959 international yard and pound agreement). */
export const METRES_PER_INCH = 0.0254;
/** Metres per foot (12 inches, exact). */
export const METRES_PER_FOOT = 12 * METRES_PER_INCH;
/** Metres per second per mile per hour (exact: 1609.344 m / 3600 s). */
export const MPS_PER_MPH = 0.44704;

/** Format with at most `decimals` decimals, dropping trailing zeros and negative zero. */
function fmt(value: number, decimals: number): string {
  const n = Number(value.toFixed(decimals));
  return (n === 0 ? 0 : n).toString();
}

export interface FormatLengthOptions {
  /** Maximum decimals of the main unit (mm, m, in; the inches part of feet and inches). */
  precision?: number;
}

/** A dimension such as a table size or ball radius: "52.5 mm", "3.569 m", "2.25 in", "8 ft 4 in". */
export function formatLength(
  valueM: number,
  system: UnitSystem,
  options: FormatLengthOptions = {},
): string {
  const p = options.precision;
  if (system === "metric") {
    const mm = valueM * 1000;
    const mmDecimals = p ?? 1;
    if (Math.abs(Number(mm.toFixed(mmDecimals))) < 1000) return `${fmt(mm, mmDecimals)} mm`;
    return `${fmt(valueM, p ?? 3)} m`;
  }
  const inches = valueM / METRES_PER_INCH;
  const sign = inches < 0 ? "-" : "";
  const abs = Math.abs(inches);
  const smallDecimals = p ?? 2;
  if (Number(abs.toFixed(smallDecimals)) < 12) return `${fmt(inches, smallDecimals)} in`;
  const inchDecimals = p ?? 1;
  let feet = Math.floor(abs / 12);
  let rest = Number((abs - feet * 12).toFixed(inchDecimals));
  if (rest >= 12) {
    feet += 1;
    rest = 0;
  }
  return rest === 0 ? `${sign}${feet} ft` : `${sign}${feet} ft ${fmt(rest, inchDecimals)} in`;
}

/** A path length: "86 cm", "1.24 m", "20.5 in", "4.1 ft". */
export function formatDistance(valueM: number, system: UnitSystem): string {
  if (system === "metric") {
    if (Math.abs(Number((valueM * 100).toFixed(0))) < 100) return `${fmt(valueM * 100, 0)} cm`;
    return `${fmt(valueM, 2)} m`;
  }
  if (Math.abs(valueM) < 3 * METRES_PER_FOOT) return `${fmt(valueM / METRES_PER_INCH, 1)} in`;
  return `${fmt(valueM / METRES_PER_FOOT, 1)} ft`;
}

/** A speed: "2.4 m/s" or "5.4 mph". */
export function formatSpeed(valueMps: number, system: UnitSystem): string {
  if (system === "metric") return `${fmt(valueMps, 1)} m/s`;
  return `${fmt(valueMps / MPS_PER_MPH, 1)} mph`;
}

/** An angle in degrees: "33.7°". */
export function formatAngle(rad: number, decimals = 1): string {
  return `${fmt((rad * 180) / Math.PI, decimals)}°`;
}

type Unit = "mm" | "cm" | "m" | "in" | "ft";

const UNIT_ALIASES: Record<string, Unit> = {
  mm: "mm",
  cm: "cm",
  m: "m",
  in: "in",
  inch: "in",
  inches: "in",
  '"': "in",
  "''": "in",
  "″": "in",
  ft: "ft",
  foot: "ft",
  feet: "ft",
  "'": "ft",
  "′": "ft",
};

const METRES_PER_UNIT: Record<Unit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: METRES_PER_INCH,
  ft: METRES_PER_FOOT,
};

// One segment: a number (mixed fraction, fraction or decimal) and an optional unit.
const SEGMENT =
  /\s*(\d+[\s-]+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|\.\d+)\s*(mm|cm|m|inches|inch|in|feet|foot|ft|"|''|'|″|′)?/y;

interface Segment {
  value: number;
  unit: Unit | undefined;
}

function parseNumber(token: string, unit: Unit | undefined): number | undefined {
  const frac = /^(?:(\d+)[\s-]+)?(\d+)\/(\d+)$/.exec(token);
  if (frac) {
    const den = Number(frac[3]);
    if (den === 0) return undefined;
    return Number(frac[1] ?? 0) + Number(frac[2]) / den;
  }
  if (token.includes(",")) {
    // "3,569" with no unit or in mm is a thousands separator (3569 mm); otherwise a decimal comma.
    const thousands = /^\d{1,3},\d{3}$/.test(token) && (unit === undefined || unit === "mm");
    return Number(token.replace(",", thousands ? "" : "."));
  }
  return Number(token);
}

/** Parse what a person types in a dimension box. Returns metres, or undefined if not understood. */
export function parseLength(text: string, system: UnitSystem): number | undefined {
  const s = text.trim().toLowerCase();
  if (s === "") return undefined;
  const segments: Segment[] = [];
  let pos = 0;
  while (pos < s.length) {
    SEGMENT.lastIndex = pos;
    const m = SEGMENT.exec(s);
    if (!m) return undefined;
    const unit = m[2] === undefined ? undefined : UNIT_ALIASES[m[2]];
    const value = parseNumber(m[1] ?? "", unit);
    if (value === undefined || !Number.isFinite(value)) return undefined;
    segments.push({ value, unit });
    pos = SEGMENT.lastIndex;
    if (segments.length > 2) return undefined;
  }
  let metres: number;
  if (segments.length === 1) {
    const seg = segments[0] as Segment;
    const unit = seg.unit ?? (system === "metric" ? "mm" : "in");
    metres = seg.value * METRES_PER_UNIT[unit];
  } else {
    // Feet and inches: "8 ft 4 in", "8' 4\"", "8ft4".
    const [feet, inches] = segments as [Segment, Segment];
    if (feet.unit !== "ft" || (inches.unit !== undefined && inches.unit !== "in")) return undefined;
    metres = feet.value * METRES_PER_FOOT + inches.value * METRES_PER_INCH;
  }
  return metres > 0 && Number.isFinite(metres) ? metres : undefined;
}

/** Imperial for locales whose region is US, LR or MM; otherwise metric. */
export function defaultUnitSystem(locale?: string): UnitSystem {
  const tag =
    locale ?? (globalThis as { navigator?: { language?: string } }).navigator?.language ?? "";
  const region = tag
    .split(/[-_]/)
    .slice(1)
    .find((part) => /^[a-z]{2}$/i.test(part));
  const r = region?.toUpperCase();
  return r === "US" || r === "LR" || r === "MM" ? "imperial" : "metric";
}
