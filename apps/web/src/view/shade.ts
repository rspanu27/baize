/**
 * Lightens or darkens a hex colour by mixing it towards white (`amount` > 0) or black
 * (`amount` < 0). `amount` is clamped to -1..1. Takes `#rgb` or `#rrggbb` and returns lowercase
 * `#rrggbb`. A string that is not a hex colour is returned unchanged.
 */
export function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const digits = m?.[1];
  if (!digits) return hex;
  const full = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits;
  const k = Number.isFinite(amount) ? Math.max(-1, Math.min(1, amount)) : 0;
  const target = k < 0 ? 0 : 255;
  const f = Math.abs(k);
  let out = "#";
  for (let i = 0; i < 3; i++) {
    const c = parseInt(full.slice(i * 2, i * 2 + 2), 16);
    const v = Math.round(c + (target - c) * f);
    out += Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  }
  return out;
}
