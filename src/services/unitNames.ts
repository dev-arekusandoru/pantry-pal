/**
 * Unit names: the built-in unit tables, aliases and normalization. Pure functions with no database or
 * food-data dependency, so the food data (foods.ts) and the converter (units.ts) can both use them.
 */

/** Physical family of a unit. Units outside these families are "packaging" units. */
export type UnitFamily = "mass" | "volume" | "count";

/** Built-in families; values are the amount of the family base unit in one unit. */
const BUILTIN: Record<UnitFamily, Record<string, number>> = {
  mass: { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 },
  volume: {
    ml: 1,
    l: 1000,
    tsp: 4.92892159375,
    tbsp: 14.78676478125,
    fl_oz: 29.5735295625,
    cup: 236.5882365,
    pint: 473.176473,
    quart: 946.352946,
    gallon: 3785.411784,
  },
  // Size words are counts: "2 large eggs" is 2 count. The stored unit keeps the size.
  count: { count: 1, dozen: 12, small: 1, medium: 1, large: 1, "extra-large": 1, jumbo: 1 },
};

/** The size words, in ascending order. They are valid units in the count family. */
export const SIZE_UNITS = ["small", "medium", "large", "extra-large", "jumbo"] as const;

const ALIASES: Record<string, string> = {
  // mass
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kilo: "kg",
  kilos: "kg",
  // volume
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  l: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  cup: "cup",
  cups: "cup",
  c: "cup",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbs: "tbsp",
  tbsps: "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsps: "tsp",
  "fl oz": "fl_oz",
  fl_oz: "fl_oz",
  floz: "fl_oz",
  "fluid ounce": "fl_oz",
  "fluid ounces": "fl_oz",
  pint: "pint",
  pints: "pint",
  pt: "pint",
  quart: "quart",
  quarts: "quart",
  qt: "quart",
  gallon: "gallon",
  gallons: "gallon",
  gal: "gallon",
  // count
  count: "count",
  each: "count",
  ea: "count",
  whole: "count",
  x: "count",
  dozen: "dozen",
  dozens: "dozen",
  small: "small",
  medium: "medium",
  large: "large",
  "extra-large": "extra-large",
  "extra large": "extra-large",
  xl: "extra-large",
  jumbo: "jumbo",
  // packaging units (kept as-is, singular)
  can: "can",
  cans: "can",
  jar: "jar",
  jars: "jar",
  bag: "bag",
  bags: "bag",
  bunch: "bunch",
  bunches: "bunch",
  head: "head",
  heads: "head",
  clove: "clove",
  cloves: "clove",
  sprig: "sprig",
  sprigs: "sprig",
  stalk: "stalk",
  stalks: "stalk",
  package: "package",
  packages: "package",
  pkg: "package",
  pkgs: "package",
  pack: "package",
  packs: "package",
  bottle: "bottle",
  bottles: "bottle",
  box: "box",
  boxes: "box",
  slice: "slice",
  slices: "slice",
  piece: "piece",
  pieces: "piece",
  fillet: "fillet",
  fillets: "fillet",
  filet: "fillet",
  filets: "fillet",
  stick: "stick",
  sticks: "stick",
  carton: "carton",
  cartons: "carton",
};

export const FAMILY_BY_UNIT = new Map<string, UnitFamily>();
for (const family of Object.keys(BUILTIN) as UnitFamily[]) {
  for (const unit of Object.keys(BUILTIN[family])) FAMILY_BY_UNIT.set(unit, family);
}

/** Amount of the family base unit (g, ml, count) in one built-in `unit`, or `null`. */
export function builtinFactor(unit: string, family: UnitFamily): number | null {
  const table = BUILTIN[family];
  return Object.hasOwn(table, unit) ? (table[unit] as number) : null;
}

/**
 * Canonicalize a free-text unit (case-insensitive, plural tolerant).
 *
 * `null`/`undefined` stay `null`, an empty string means "count", `"T"` → `tbsp`,
 * `"t"` → `tsp`. Unknown units return `null` instead of a guess.
 */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return "count";
  // The classic uppercase T / lowercase t shorthand is case-sensitive.
  if (trimmed === "T") return "tbsp";
  if (trimmed === "t") return "tsp";

  const key = trimmed.toLowerCase().replaceAll(".", "").replace(/\s+/g, " ");
  const direct = ALIASES[key];
  if (direct !== undefined) return direct;

  // Generic plural fallback for aliases that are not listed explicitly.
  if (key.endsWith("es")) {
    const singular = ALIASES[key.slice(0, -2)];
    if (singular !== undefined) return singular;
  }
  if (key.endsWith("s")) {
    const singular = ALIASES[key.slice(0, -1)];
    if (singular !== undefined) return singular;
  }
  return null;
}

/** Built-in family of a unit, or `null` for packaging units / unknown units. */
export function unitFamily(unit: string | null | undefined): UnitFamily | null {
  const normalized = normalizeUnit(unit);
  if (normalized === null) return null;
  return FAMILY_BY_UNIT.get(normalized) ?? null;
}

/** Ratio between two units of one built-in family (`from` per `to`), or null. */
export function builtinRatio(from: string, to: string, family: UnitFamily): number | null {
  const baseFrom = BUILTIN[family][from];
  const baseTo = BUILTIN[family][to];
  if (baseFrom === undefined || baseTo === undefined) return null;
  return baseFrom / baseTo;
}


// ---------------------------------------------------------------------------
// Unit keys
// ---------------------------------------------------------------------------

/** Longest custom unit name; "handful", "big handful", "sleeve"... */
const MAX_CUSTOM_UNIT_LENGTH = 32;

function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Normalized form of a unit that has no built-in alias: lowercase, singular, single spaces.
 * `null` when the text is not a plausible unit name (empty, digits first, odd characters).
 */
export function customUnitName(raw: string): string | null {
  const key = raw.trim().toLowerCase().replaceAll(".", "").replace(/\s+/g, " ");
  if (key === "" || key.length > MAX_CUSTOM_UNIT_LENGTH || !/^[a-z][a-z0-9 -]*$/.test(key)) return null;
  return singularize(key);
}

/**
 * Canonical unit for any text: the built-in alias table first ("cups" → "cup"), else the custom
 * name ("handfuls" → "handful"). `null` for text that cannot be a unit. Whether the unit is
 * *allowed* for an ingredient is {@link validateUnits}' job.
 */
export function canonicalUnit(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return normalizeUnit(raw) ?? customUnitName(raw);
}

/** Built-in unit (mass, volume, count family or size word). */
export function isBuiltinUnit(unit: string): boolean {
  return FAMILY_BY_UNIT.has(unit);
}

/** The built-in units in the order pickers list them. */
export const COMMON_UNITS: readonly string[] = [
  "count",
  "g",
  "kg",
  "oz",
  "lb",
  "tsp",
  "tbsp",
  "fl_oz",
  "cup",
  "pint",
  "quart",
  "gallon",
  "ml",
  "l",
  "dozen",
  ...SIZE_UNITS,
];
