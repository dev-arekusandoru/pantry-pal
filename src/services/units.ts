import { and, eq } from "drizzle-orm";
import type { Ctx } from "../context.js";
import { ingredientMeasures, ingredients } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { foodMeasures, getFood } from "./foods.js";
import {
  builtinFactor,
  builtinRatio,
  canonicalUnit,
  COMMON_UNITS,
  FAMILY_BY_UNIT,
  isBuiltinUnit,
  SIZE_UNITS,
} from "./unitNames.js";

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

/** Where a measure comes from. */
export type MeasureSource = "usda" | "usda_estimated" | "user";

/** Weight of ONE unit of an ingredient. */
export interface Measure {
  /** Normalized unit ("cup", "clove", "can", "handful"). */
  unit: string;
  grams: number;
  source: MeasureSource;
  /** True for a USDA portion borrowed from a similar food. */
  estimated: boolean;
  /** The USDA portion label ("cup, chopped"); null for user measures. */
  label: string | null;
  note: string | null;
  /** On a user measure that overrides a USDA one: the USDA grams (for "reset to USDA"). */
  usdaGrams: number | null;
}

type MeasureOwner = Pick<typeof ingredients.$inferSelect, "id" | "name" | "nutritionFdcId" | "defaultPortion">;

interface MeasureTable {
  ingredientId: string;
  ingredientName: string;
  /** Listing order: the food's measures (user overrides in place), then user-only measures. */
  measures: Measure[];
  byUnit: Map<string, Measure>;
  /** Grams of one plain count ("2 eggs"), or null when nothing says. */
  plainCount: number | null;
}

/** Units that are not one natural piece of a food (a plain count never means these). */
const NOT_A_PIECE = new Set([
  "bag",
  "bottle",
  "box",
  "can",
  "carton",
  "container",
  "count",
  "dozen",
  "jar",
  "pack",
  "package",
  "packet",
  "recipe",
  "serving",
  "slice",
  "stick",
]);

/** Preference when deriving a density: larger measures are rounded less. */
const DENSITY_UNIT_ORDER = ["cup", "tbsp", "tsp", "fl_oz", "ml", "l", "pint", "quart", "gallon"];

const SOURCE_ORDER: MeasureSource[] = ["user", "usda", "usda_estimated"];

function isPieceLike(unit: string): boolean {
  return (
    !NOT_A_PIECE.has(unit) &&
    builtinFactor(unit, "mass") === null &&
    builtinFactor(unit, "volume") === null
  );
}

function sizeUnit(unit: string): boolean {
  return (SIZE_UNITS as readonly string[]).includes(unit);
}

function labelMatches(label: string, wanted: string): boolean {
  const text = label.toLowerCase().trim();
  return text === wanted || text.startsWith(`${wanted} `) || text.startsWith(`${wanted},`);
}

function buildTable(ctx: Ctx, owner: MeasureOwner): MeasureTable {
  const food = owner.nutritionFdcId === null ? null : getFood(owner.nutritionFdcId);
  const raw = food === null ? [] : foodMeasures(food);

  // One USDA measure per unit; a real one beats a borrowed one.
  const usda = new Map<string, Measure>();
  for (const entry of raw) {
    if (builtinFactor(entry.unit, "mass") !== null) continue;
    const existing = usda.get(entry.unit);
    if (existing !== undefined && !(existing.estimated && !entry.estimated)) continue;
    usda.set(entry.unit, {
      unit: entry.unit,
      grams: entry.grams,
      source: entry.estimated ? "usda_estimated" : "usda",
      estimated: entry.estimated,
      label: entry.label,
      note: null,
      usdaGrams: null,
    });
  }

  const userRows = ctx.db
    .select()
    .from(ingredientMeasures)
    .where(
      and(
        eq(ingredientMeasures.householdId, ctx.householdId),
        eq(ingredientMeasures.ingredientId, owner.id),
      ),
    )
    .orderBy(ingredientMeasures.unit)
    .all();

  const byUnit = new Map<string, Measure>(usda);
  for (const row of userRows) {
    byUnit.set(row.unit, {
      unit: row.unit,
      grams: row.grams,
      source: "user",
      estimated: false,
      label: null,
      note: row.note,
      usdaGrams: usda.get(row.unit)?.grams ?? null,
    });
  }

  // A plain count means the ingredient's default portion, listed as the `count` measure.
  if (!byUnit.has("count") && food !== null && owner.defaultPortion !== null) {
    const wanted = owner.defaultPortion.toLowerCase().trim();
    const entry =
      raw.find((item) => item.label.toLowerCase().trim() === wanted) ??
      raw.find((item) => labelMatches(item.label, wanted));
    const portion = entry === undefined ? undefined : byUnit.get(entry.unit);
    if (entry !== undefined && portion !== undefined) {
      byUnit.set("count", {
        unit: "count",
        grams: portion.grams,
        source: portion.source,
        estimated: portion.estimated,
        label: entry.label,
        note: null,
        usdaGrams: null,
      });
    }
  }

  // Map order is already the listing order: the food's units (overridden in place), then the rest.
  const inOrder = [...byUnit.values()];

  const plainCount =
    byUnit.get("count")?.grams ??
    byUnit.get("medium")?.grams ??
    inOrder.find((m) => isPieceLike(m.unit))?.grams ??
    null;

  return {
    ingredientId: owner.id,
    ingredientName: owner.name,
    measures: inOrder,
    byUnit,
    plainCount,
  };
}

function ownerOf(ctx: Ctx, ingredientId: string): MeasureOwner | null {
  return (
    ctx.db
      .select({
        id: ingredients.id,
        name: ingredients.name,
        nutritionFdcId: ingredients.nutritionFdcId,
        defaultPortion: ingredients.defaultPortion,
      })
      .from(ingredients)
      .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, ingredientId)))
      .get() ?? null
  );
}

function tableFor(ctx: Ctx, ingredientId: string): MeasureTable | null {
  const owner = ownerOf(ctx, ingredientId);
  return owner === null ? null : buildTable(ctx, owner);
}

/** The ingredient's effective measures: the linked food's, overridden by the household's own. */
export function effectiveMeasures(ctx: Ctx, owner: MeasureOwner): Measure[] {
  return buildTable(ctx, owner).measures;
}

/** Grams in one `unit`, or null when the table has no basis. */
function gramsOfUnit(table: MeasureTable, unit: string): number | null {
  const mass = builtinFactor(unit, "mass");
  if (mass !== null) return mass;

  const volume = builtinFactor(unit, "volume");
  if (volume !== null) {
    // The household's own volume measure wins over the food's, the food's over a borrowed one.
    for (const source of SOURCE_ORDER) {
      const tier = table.measures.filter(
        (m) => m.source === source && builtinFactor(m.unit, "volume") !== null,
      );
      if (tier.length === 0) continue;
      const exact = tier.find((m) => m.unit === unit);
      if (exact !== undefined) return exact.grams;
      for (const base of DENSITY_UNIT_ORDER) {
        const chosen = tier.find((m) => m.unit === base);
        if (chosen !== undefined) {
          return (chosen.grams / (builtinFactor(base, "volume") as number)) * volume;
        }
      }
    }
    return null;
  }

  if (unit === "count") return table.plainCount;
  if (unit === "dozen") return table.plainCount === null ? null : table.plainCount * 12;
  const direct = table.byUnit.get(unit);
  if (direct !== undefined) return direct.grams;
  // A size with no measure of its own weighs what a plain count does.
  return sizeUnit(unit) ? table.plainCount : null;
}

/** Unit key used for conversion: no unit is a plain count; unknown text keeps its custom name. */
function unitKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return "count";
  return canonicalUnit(raw);
}

function convertWith(
  table: MeasureTable | null,
  qty: number,
  from: string,
  to: string,
): number | null {
  if (from === to) return qty;
  const family = FAMILY_BY_UNIT.get(from);
  if (family !== undefined && family === FAMILY_BY_UNIT.get(to)) {
    const ratio = builtinRatio(from, to, family);
    return ratio === null ? null : qty * ratio;
  }
  if (table === null) return null;
  const gramsFrom = gramsOfUnit(table, from);
  const gramsTo = gramsOfUnit(table, to);
  if (gramsFrom === null || gramsTo === null || gramsTo === 0) return null;
  return (qty * gramsFrom) / gramsTo;
}

/**
 * THE converter. Convert `qty` from one unit to another.
 *
 * Order: identity (no unit and "count" are the same plain count), built-in same-family tables
 * (mass, volume, count/size), then through grams with the ingredient's effective measures
 * (its USDA food's, overridden by the household's). `null` means no basis: quantities are never
 * guessed across families.
 */
export function convert(
  ctx: Ctx,
  qty: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
  ingredientId?: string | null,
): number | null {
  const from = unitKey(fromUnit);
  const to = unitKey(toUnit);
  if (from === null || to === null) return null;
  if (from === to) return qty;
  const family = FAMILY_BY_UNIT.get(from);
  if (family !== undefined && family === FAMILY_BY_UNIT.get(to)) return convertWith(null, qty, from, to);
  if (ingredientId === null || ingredientId === undefined) return null;
  return convertWith(tableFor(ctx, ingredientId), qty, from, to);
}

/**
 * A converter bound to one ingredient: loads its measures once, for code that converts many
 * amounts of the same ingredient. Same rules as {@link convert}.
 */
export function converterFor(
  ctx: Ctx,
  ingredientId: string,
): (qty: number, fromUnit: string | null | undefined, toUnit: string | null | undefined) => number | null {
  let table: MeasureTable | null | undefined;
  return (qty, fromUnit, toUnit) => {
    const from = unitKey(fromUnit);
    const to = unitKey(toUnit);
    if (from === null || to === null) return null;
    if (table === undefined) table = tableFor(ctx, ingredientId);
    return convertWith(table, qty, from, to);
  };
}

/** Like {@link convert} but a 422 with a hint when the units cannot be compared. */
export function convertOrThrow(
  ctx: Ctx,
  qty: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
  ingredientId: string,
  what: string,
): number {
  const converted = convert(ctx, qty, fromUnit, toUnit, ingredientId);
  if (converted !== null) return converted;
  const from = unitKey(fromUnit) ?? String(fromUnit);
  const to = unitKey(toUnit) ?? String(toUnit);
  const name = ownerOf(ctx, ingredientId)?.name ?? ingredientId;
  throw new AppError("unprocessable", `Cannot convert ${what} from ${from} to ${to} for ${name}`, {
    ingredientId,
    ingredientName: name,
    unit: from,
    toUnit: to,
    hint: `Add a measure so ${from} and ${to} compare (PUT /ingredients/${ingredientId}/measures/${from}, or the ingredient_measures tool), or use ${to}.`,
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface UnresolvedUnit {
  unit: string;
  ingredientId: string;
  ingredientName: string;
  suggestions: string[];
  hint: string;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] as number;
      row[j] = Math.min(
        current + 1,
        (row[j - 1] as number) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length] as number;
}

const MAX_SUGGESTIONS = 8;

function suggestUnits(raw: string, measureUnits: string[]): string[] {
  const key = raw.trim().toLowerCase();
  const close = COMMON_UNITS.filter((unit) => {
    const name = unit.replaceAll("_", " ");
    return (
      editDistance(key, name) <= (key.length > 4 ? 2 : 1) ||
      (key.length >= 2 && (name.startsWith(key) || key.startsWith(name)))
    );
  });
  const all = [...close, ...measureUnits, "count", "g", "oz", "cup", "tbsp", "tsp"];
  return [...new Set(all)].slice(0, MAX_SUGGESTIONS);
}

function unresolvedUnit(raw: string, table: MeasureTable): UnresolvedUnit {
  const unit = raw.trim();
  return {
    unit,
    ingredientId: table.ingredientId,
    ingredientName: table.ingredientName,
    suggestions: suggestUnits(unit, [...table.byUnit.keys()]),
    hint: `Add a measure for ${unit} first (PUT /ingredients/${table.ingredientId}/measures/${encodeURIComponent(unit)}, or the ingredient_measures tool), or use a suggested unit.`,
  };
}

export interface UnitUse {
  ingredientId: string;
  unit: string | null | undefined;
}

/**
 * Normalize the units of every write in one go. A valid unit is a built-in mass, volume or count
 * unit, a size word, or a unit the ingredient has a measure for (the food's or the household's).
 * A valid unit that cannot convert (cup with no density) is fine: nutrition and the review list
 * show it. Unknown units throw ONE `unprocessable` error listing all of them, so nothing is written.
 * No unit stays null; an empty unit means a plain count.
 */
export function validateUnits(ctx: Ctx, uses: readonly UnitUse[]): Array<string | null> {
  const tables = new Map<string, MeasureTable | null>();
  const issues: UnresolvedUnit[] = [];
  const seen = new Set<string>();

  const result = uses.map((use): string | null => {
    if (use.unit === null || use.unit === undefined) return null;
    const canonical = canonicalUnit(use.unit);
    if (canonical !== null && isBuiltinUnit(canonical)) return canonical;

    if (!tables.has(use.ingredientId)) tables.set(use.ingredientId, tableFor(ctx, use.ingredientId));
    const table = tables.get(use.ingredientId) ?? null;
    if (canonical !== null && table?.byUnit.has(canonical) === true) return canonical;

    if (table !== null) {
      const key = `${use.ingredientId}\u0000${use.unit.trim().toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(unresolvedUnit(use.unit, table));
      }
    }
    return canonical;
  });

  if (issues.length > 0) {
    const list = issues.map((issue) => `${issue.unit} (${issue.ingredientName})`).join(", ");
    throw new AppError("unprocessable", `Unknown unit: ${list}`, { unresolvedUnits: issues });
  }
  return result;
}

/** Validate one ingredient's unit; see {@link validateUnits}. */
export function validateUnit(
  ctx: Ctx,
  ingredientId: string,
  unit: string | null | undefined,
): string | null {
  return validateUnits(ctx, [{ ingredientId, unit }])[0] as string | null;
}

/** Whether `unit` is allowed for the ingredient (same rule as {@link validateUnits}, no throw). */
export function isValidUnitFor(ctx: Ctx, ingredientId: string, unit: string | null): boolean {
  if (unit === null) return true;
  const canonical = canonicalUnit(unit);
  if (canonical === null) return false;
  return isBuiltinUnit(canonical) || tableFor(ctx, ingredientId)?.byUnit.has(canonical) === true;
}

/**
 * Units a picker offers for an ingredient: its stock unit first, then its measures, then the
 * built-in ones.
 */
export function unitsForPicker(stockUnit: string | null, measures: readonly Measure[]): string[] {
  const units = [
    ...(stockUnit === null ? [] : [stockUnit]),
    ...measures.map((measure) => measure.unit),
    ...COMMON_UNITS,
  ];
  return [...new Set(units)];
}

// ---------------------------------------------------------------------------
// Household measures (user rows)
// ---------------------------------------------------------------------------

function requireMeasureOwner(ctx: Ctx, ingredientId: string): MeasureOwner {
  const owner = ownerOf(ctx, ingredientId);
  if (owner === null) throw new AppError("not_found", `Ingredient not found: ${ingredientId}`);
  return owner;
}

function measureUnitOrThrow(raw: string): string {
  const unit = canonicalUnit(raw);
  if (unit === null) {
    throw new AppError(
      "validation",
      `"${raw}" is not a unit name: use letters, numbers, spaces or hyphens (for example "handful")`,
      { unit: raw },
    );
  }
  if (builtinFactor(unit, "mass") !== null) {
    throw new AppError("validation", `${unit} is a fixed mass unit and cannot have a measure`, { unit });
  }
  if (unit === "dozen") {
    throw new AppError("validation", "A dozen is 12 count: set the count measure instead", { unit });
  }
  return unit;
}

/** The ingredient's effective measures (see {@link effectiveMeasures}). */
export function listMeasures(ctx: Ctx, ingredientId: string): Measure[] {
  return effectiveMeasures(ctx, requireMeasureOwner(ctx, ingredientId));
}

export interface SetMeasureInput {
  grams: number;
  note?: string | null | undefined;
}

/** Create or update the household's measure for a unit: it overrides the linked food's. */
export function setMeasure(
  ctx: Ctx,
  ingredientId: string,
  rawUnit: string,
  input: SetMeasureInput,
): Measure {
  const owner = requireMeasureOwner(ctx, ingredientId);
  const unit = measureUnitOrThrow(rawUnit);
  if (!Number.isFinite(input.grams) || input.grams <= 0) {
    throw new AppError("validation", "grams must be a positive number", { grams: input.grams });
  }
  const timestamp = nowIso(ctx);
  const existing = ctx.db
    .select({ id: ingredientMeasures.id, note: ingredientMeasures.note })
    .from(ingredientMeasures)
    .where(and(eq(ingredientMeasures.ingredientId, owner.id), eq(ingredientMeasures.unit, unit)))
    .get();
  if (existing) {
    ctx.db
      .update(ingredientMeasures)
      .set({
        grams: input.grams,
        note: input.note === undefined ? existing.note : input.note,
        updatedAt: timestamp,
      })
      .where(eq(ingredientMeasures.id, existing.id))
      .run();
  } else {
    ctx.db
      .insert(ingredientMeasures)
      .values({
        id: newId("im"),
        householdId: ctx.householdId,
        ingredientId: owner.id,
        unit,
        grams: input.grams,
        note: input.note ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }
  return effectiveMeasures(ctx, owner).find((measure) => measure.unit === unit) as Measure;
}

/** Delete the household's own measure for a unit; the linked food's measure (if any) shows again. */
export function deleteMeasure(ctx: Ctx, ingredientId: string, rawUnit: string): void {
  const owner = requireMeasureOwner(ctx, ingredientId);
  const unit = canonicalUnit(rawUnit) ?? rawUnit;
  const result = ctx.db
    .delete(ingredientMeasures)
    .where(
      and(
        eq(ingredientMeasures.householdId, ctx.householdId),
        eq(ingredientMeasures.ingredientId, owner.id),
        eq(ingredientMeasures.unit, unit),
      ),
    )
    .run();
  if (result.changes > 0) return;
  const known = effectiveMeasures(ctx, owner).some((measure) => measure.unit === unit);
  throw new AppError(
    "not_found",
    known
      ? `${unit} is a USDA measure of ${owner.name}; only your own measures can be deleted (set one to override it)`
      : `${owner.name} has no measure for ${unit}`,
    { ingredientId: owner.id, unit },
  );
}

/**
 * Merge support: move the household's measures of `sourceId` to `targetId`. A unit the target
 * already has its own measure for keeps the target's. Returns how many moved.
 */
export function moveMeasures(ctx: Ctx, sourceId: string, targetId: string): number {
  const rows = ctx.db
    .select()
    .from(ingredientMeasures)
    .where(
      and(
        eq(ingredientMeasures.householdId, ctx.householdId),
        eq(ingredientMeasures.ingredientId, sourceId),
      ),
    )
    .all();
  let moved = 0;
  for (const row of rows) {
    const clash = ctx.db
      .select({ id: ingredientMeasures.id })
      .from(ingredientMeasures)
      .where(and(eq(ingredientMeasures.ingredientId, targetId), eq(ingredientMeasures.unit, row.unit)))
      .get();
    if (clash) {
      ctx.db.delete(ingredientMeasures).where(eq(ingredientMeasures.id, row.id)).run();
    } else {
      ctx.db
        .update(ingredientMeasures)
        .set({ ingredientId: targetId })
        .where(eq(ingredientMeasures.id, row.id))
        .run();
      moved += 1;
    }
  }
  return moved;
}
