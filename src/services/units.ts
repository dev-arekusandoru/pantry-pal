import { and, eq, isNull, or } from "drizzle-orm";
import type { Ctx } from "../context.js";
import { ingredients, unitConversions } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

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
  count: { count: 1, dozen: 12 },
};

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

const FAMILY_BY_UNIT = new Map<string, UnitFamily>();
for (const family of Object.keys(BUILTIN) as UnitFamily[]) {
  for (const unit of Object.keys(BUILTIN[family])) FAMILY_BY_UNIT.set(unit, family);
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

function builtinRatio(from: string, to: string, family: UnitFamily): number | null {
  const baseFrom = BUILTIN[family][from];
  const baseTo = BUILTIN[family][to];
  if (baseFrom === undefined || baseTo === undefined) return null;
  return baseFrom / baseTo;
}

export type UnitConversion = typeof unitConversions.$inferSelect;

interface ConversionRow {
  fromUnit: string;
  toUnit: string;
  factor: number;
}

type Edge = { unit: string; factor: number };

function addEdge(map: Map<string, Edge[]>, from: string, edge: Edge): void {
  const list = map.get(from);
  if (list === undefined) map.set(from, [edge]);
  else list.push(edge);
}

/** Bidirectional conversion edges: stored rows plus same-family built-in conversions. */
function edgesByUnit(rows: ConversionRow[]): Map<string, Edge[]> {
  const map = new Map<string, Edge[]>();
  for (const row of rows) {
    const from = normalizeUnit(row.fromUnit);
    const to = normalizeUnit(row.toUnit);
    if (from === null || to === null || from === to) continue;
    if (!Number.isFinite(row.factor) || row.factor <= 0) continue;
    addEdge(map, from, { unit: to, factor: row.factor });
    addEdge(map, to, { unit: from, factor: 1 / row.factor });
  }
  return map;
}

const MAX_CONVERSION_HOPS = 4;

/**
 * Shortest conversion path between two units using the custom rows and the
 * built-in table, multiplied out. Returns `null` when no path exists.
 */
function findFactor(from: string, to: string, edges: Map<string, Edge[]>): number | null {
  if (from === to) return 1;
  const visited = new Set<string>([from]);
  let frontier: Edge[] = [{ unit: from, factor: 1 }];

  for (let hop = 0; hop < MAX_CONVERSION_HOPS && frontier.length > 0; hop++) {
    const next: Edge[] = [];
    for (const node of frontier) {
      const neighbours: Edge[] = [...(edges.get(node.unit) ?? [])];
      const family = FAMILY_BY_UNIT.get(node.unit);
      if (family !== undefined) {
        const base = BUILTIN[family];
        const baseFrom = base[node.unit];
        if (baseFrom !== undefined) {
          for (const [unit, baseTo] of Object.entries(base)) {
            if (unit !== node.unit) neighbours.push({ unit, factor: baseFrom / baseTo });
          }
        }
      }
      for (const neighbour of neighbours) {
        const factor = node.factor * neighbour.factor;
        if (neighbour.unit === to) return factor;
        if (!visited.has(neighbour.unit)) {
          visited.add(neighbour.unit);
          next.push({ unit: neighbour.unit, factor });
        }
      }
    }
    frontier = next;
  }
  return null;
}

function loadConversionRows(ctx: Ctx, ingredientId: string | null): ConversionRow[] {
  return ctx.db
    .select({
      fromUnit: unitConversions.fromUnit,
      toUnit: unitConversions.toUnit,
      factor: unitConversions.factor,
    })
    .from(unitConversions)
    .where(
      and(
        eq(unitConversions.householdId, ctx.householdId),
        ingredientId === null
          ? isNull(unitConversions.ingredientId)
          : eq(unitConversions.ingredientId, ingredientId),
      ),
    )
    .all();
}

/**
 * Convert `qty` from one unit to another.
 *
 * Order: identity, built-in mass/volume/count tables, per-ingredient conversion
 * rows (both directions, chaining through a built-in family, e.g. `can` → `oz` →
 * `lb`), household-global conversion rows. `null` means the units are not
 * comparable — quantities are never guessed across families.
 */
export function convert(
  ctx: Ctx,
  qty: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
  ingredientId?: string | null,
): number | null {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);

  if (from === null || to === null) {
    // NULL units are only comparable with each other.
    return from === null && to === null ? qty : null;
  }
  if (from === to) return qty;

  const fromFamily = FAMILY_BY_UNIT.get(from);
  if (fromFamily !== undefined && fromFamily === FAMILY_BY_UNIT.get(to)) {
    const ratio = builtinRatio(from, to, fromFamily);
    if (ratio !== null) return qty * ratio;
  }

  if (ingredientId) {
    const factor = findFactor(from, to, edgesByUnit(loadConversionRows(ctx, ingredientId)));
    if (factor !== null) return qty * factor;
  }

  const globalFactor = findFactor(from, to, edgesByUnit(loadConversionRows(ctx, null)));
  return globalFactor === null ? null : qty * globalFactor;
}

export interface ListConversionsOptions {
  /** Restrict to one ingredient's own rows. Omit to list everything. */
  ingredientId?: string;
  /** With `ingredientId`, also include household-global rows. */
  includeGlobal?: boolean;
}

/** Stored custom conversions, ordered by unit pair. */
export function listConversions(ctx: Ctx, options: ListConversionsOptions = {}): UnitConversion[] {
  const conditions = [eq(unitConversions.householdId, ctx.householdId)];
  if (options.ingredientId !== undefined) {
    const scope =
      options.includeGlobal === true
        ? or(
            eq(unitConversions.ingredientId, options.ingredientId),
            isNull(unitConversions.ingredientId),
          )
        : eq(unitConversions.ingredientId, options.ingredientId);
    if (scope !== undefined) conditions.push(scope);
  }
  return ctx.db
    .select()
    .from(unitConversions)
    .where(and(...conditions))
    .orderBy(unitConversions.fromUnit, unitConversions.toUnit)
    .all();
}

export interface CreateConversionInput {
  ingredientId?: string | null;
  fromUnit: string;
  toUnit: string;
  /** 1 fromUnit = factor toUnit. */
  factor: number;
  note?: string | null;
}

function requireNormalizedUnit(raw: string, field: string): string {
  const normalized = normalizeUnit(raw);
  if (normalized === null) {
    throw new AppError("validation", `Unknown ${field}: ${raw}`);
  }
  return normalized;
}

/** Store a custom conversion (per ingredient or household-global when `ingredientId` is null). */
export function createConversion(ctx: Ctx, input: CreateConversionInput): UnitConversion {
  const fromUnit = requireNormalizedUnit(input.fromUnit, "unit");
  const toUnit = requireNormalizedUnit(input.toUnit, "unit");
  if (fromUnit === toUnit) {
    throw new AppError("validation", "Conversion units must differ");
  }
  if (!Number.isFinite(input.factor) || input.factor <= 0) {
    throw new AppError("validation", "Conversion factor must be a positive number");
  }

  const ingredientId = input.ingredientId ?? null;
  if (ingredientId !== null) {
    const ingredient = ctx.db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, ingredientId)))
      .get();
    if (!ingredient) throw new AppError("not_found", `Ingredient not found: ${ingredientId}`);
  }

  // SQLite unique indexes treat NULLs as distinct, so the global row is checked here.
  const existing = ctx.db
    .select({ id: unitConversions.id })
    .from(unitConversions)
    .where(
      and(
        eq(unitConversions.householdId, ctx.householdId),
        ingredientId === null
          ? isNull(unitConversions.ingredientId)
          : eq(unitConversions.ingredientId, ingredientId),
        eq(unitConversions.fromUnit, fromUnit),
        eq(unitConversions.toUnit, toUnit),
      ),
    )
    .get();
  if (existing) {
    throw new AppError("conflict", `Conversion already exists: ${fromUnit} -> ${toUnit}`);
  }

  return ctx.db
    .insert(unitConversions)
    .values({
      id: newId("uc"),
      householdId: ctx.householdId,
      ingredientId,
      fromUnit,
      toUnit,
      factor: input.factor,
      note: input.note ?? null,
      createdAt: nowIso(ctx),
    })
    .returning()
    .get();
}

/** Delete a custom conversion. */
export function deleteConversion(ctx: Ctx, id: string): void {
  const result = ctx.db
    .delete(unitConversions)
    .where(and(eq(unitConversions.householdId, ctx.householdId), eq(unitConversions.id, id)))
    .run();
  if (result.changes === 0) {
    throw new AppError("not_found", `Conversion not found: ${id}`);
  }
}
