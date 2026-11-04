/** Quantity and unit formatting shared by the shop and pantry screens. */

const FRACTIONS: ReadonlyArray<readonly [number, string]> = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/** 1.5 -> "1½", 0.25 -> "¼", 2 -> "2", 0.37 -> "0.37". */
export function formatQty(n: number): string {
  if (!Number.isFinite(n)) return "";
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < 0.02) return whole > 0 ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(n * 100) / 100);
}

/** Plain decimal for editing in an input: 1.5 -> "1.5", 0.333333 -> "0.33". */
export function qtyToInput(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Parse what someone types into a quantity box: "2", "1.5", "1,5", "1/2", "1 1/2".
 * Returns null for anything else (including negatives and empty text).
 */
export function parseQty(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const decimal = /^\d*\.?\d+$/.exec(t) ?? /^\d+\.$/.exec(t);
  if (decimal) return Number(t);
  const mixed = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) {
    const [, whole, num, den] = mixed;
    if (Number(den) === 0) return null;
    return Number(whole ?? 0) + Number(num) / Number(den);
  }
  return null;
}

const PLURALS: Record<string, string> = {
  cup: "cups",
  can: "cans",
  jar: "jars",
  bag: "bags",
  bunch: "bunches",
  head: "heads",
  clove: "cloves",
  sprig: "sprigs",
  stalk: "stalks",
  package: "packages",
  bottle: "bottles",
  box: "boxes",
  slice: "slices",
  piece: "pieces",
  fillet: "fillets",
  stick: "sticks",
  carton: "cartons",
  pint: "pints",
  quart: "quarts",
  gallon: "gallons",
};

/** Display label for a normalized unit. "count" shows nothing. */
export function unitLabel(unit: string | null, qty: number | null): string {
  if (unit === null || unit === "count") return "";
  if (unit === "fl_oz") return "fl oz";
  if (qty !== null && qty > 1) return PLURALS[unit] ?? unit;
  return unit;
}

/** "1½ lb", "3 cans", "2" (count), "" when there is no quantity. */
export function formatAmount(qty: number | null, unit: string | null): string {
  if (qty === null) return "";
  const label = unitLabel(unit, qty);
  return label === "" ? formatQty(qty) : `${formatQty(qty)} ${label}`;
}
