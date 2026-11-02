import { and, asc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import type { Ctx } from "../context.js";
import {
  INGREDIENT_CATEGORIES,
  cookEvents,
  ingredients,
  mealPlans,
  pantryItems,
  recipes,
  type IngredientCategory,
  type PantryStatus,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { scaleRecipeIngredients } from "./recipes.js";
import { convert, normalizeUnit } from "./units.js";

/** One planned cook that needs an ingredient. */
export interface DemandUse {
  cookEventId: string;
  recipeId: string;
  recipeTitle: string;
  /** YYYY-MM-DD */
  cookDate: string;
  /** Quantity in the recipe line's own unit, before conversion. */
  qty: number | null;
  unit: string | null;
  /** The recipe marks this ingredient optional. */
  optional: boolean;
}

/** A demand line whose unit could not be converted into the line's target unit. */
export interface UnconvertibleDemand {
  qty: number | null;
  unit: string | null;
  recipeTitle: string;
}

/** Aggregated ingredient demand over the planned cook events in scope. */
export interface DemandLine {
  ingredientId: string;
  ingredientName: string;
  category: IngredientCategory;
  /** Target unit: pantry stock unit, else the ingredient default unit, else the most common line unit. */
  unit: string | null;
  /** Sum of line quantities converted into `unit`; null when no line carried a quantity. */
  qty: number | null;
  /** Sum of the upper bounds of ranged quantities ("1-2 heads"), when any line has one. */
  qtyMax?: number;
  /** Lines that could not be expressed in `unit` (mass vs volume vs count). */
  unconvertible: UnconvertibleDemand[];
  uses: DemandUse[];
}

export interface DemandInput {
  mealPlanId?: string;
  /** Inclusive lower bound on cookDate (YYYY-MM-DD). */
  from?: string;
  /** Inclusive upper bound on cookDate (YYYY-MM-DD). */
  to?: string;
  /** Include optional recipe ingredients (default false). */
  includeOptional?: boolean;
}

/** Ingredient coverage: stock on hand versus what the planned cooks commit. */
export interface AvailabilityLine {
  ingredientId: string;
  ingredientName: string;
  category: IngredientCategory;
  /** Unit used for `onHand`, `committed` and `available`. */
  unit: string | null;
  /** Stock summed across pantry locations; null when any location's amount is unknown. */
  onHand: number | null;
  onHandStatus: PantryStatus;
  /** Planned demand in `unit`; null when the demand has no comparable quantity. */
  committed: number | null;
  /** onHand - committed; null when the two sides are not comparable. */
  available: number | null;
  /** True when onHand and committed are known in the same unit. */
  comparable: boolean;
  /** The planned cooks that make up `committed`. */
  committedBy: DemandUse[];
}

/** Aisle ordering used for demand and shopping output. */
export function categoryRank(category: IngredientCategory): number {
  const index = INGREDIENT_CATEGORIES.indexOf(category);
  return index === -1 ? INGREDIENT_CATEGORIES.length : index;
}

/** Round a quantity to `dp` decimals, removing float noise (0.9999999 → 1). */
export function roundQty(value: number, dp = 4): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Normalize a unit, keeping unknown-but-non-empty units as a lowercase token so
 * "2 packs" stays a comparable string instead of vanishing.
 */
export function normalizeUnitLoose(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return normalizeUnit("");
  return normalizeUnit(trimmed) ?? trimmed.toLowerCase();
}

type PantryRow = typeof pantryItems.$inferSelect;

function pantryRowsFor(ctx: Ctx, ingredientIds: string[]): Map<string, PantryRow[]> {
  const grouped = new Map<string, PantryRow[]>();
  if (ingredientIds.length === 0) return grouped;

  const rows = ctx.db
    .select()
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.householdId, ctx.householdId),
        inArray(pantryItems.ingredientId, ingredientIds),
      ),
    )
    .all();

  for (const row of rows) {
    const bucket = grouped.get(row.ingredientId);
    if (bucket) bucket.push(row);
    else grouped.set(row.ingredientId, [row]);
  }
  return grouped;
}

/** Unit of the best-stocked pantry row (largest known quantity), if any row has a unit. */
function pantryUnitFor(rows: PantryRow[]): string | null {
  const sorted = [...rows].sort((a, b) => (b.qty ?? -1) - (a.qty ?? -1));
  for (const row of sorted) {
    const unit = normalizeUnitLoose(row.unit);
    if (unit !== null) return unit;
  }
  return null;
}

/** Most common non-null unit among recipe lines; ties keep the first-seen unit. */
function mostCommonUnit(units: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const unit of units) {
    if (unit === null) continue;
    const next = (counts.get(unit) ?? 0) + 1;
    counts.set(unit, next);
    if (next > bestCount) {
      best = unit;
      bestCount = next;
    }
  }
  return best;
}

/** Target unit priority: pantry stock unit → ingredient default unit → most common line unit. */
function targetUnitFor(
  defaultUnit: string | null | undefined,
  lineUnits: Array<string | null>,
  pantryRows: PantryRow[],
): string | null {
  return (
    pantryUnitFor(pantryRows) ??
    normalizeUnitLoose(defaultUnit ?? null) ??
    mostCommonUnit(lineUnits)
  );
}

function assertPlanExists(ctx: Ctx, mealPlanId: string): void {
  const plan = ctx.db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.householdId, ctx.householdId), eq(mealPlans.id, mealPlanId)))
    .get();
  if (!plan) {
    throw new AppError("not_found", `Meal plan not found: ${mealPlanId}`, { mealPlanId });
  }
}

function compareDemandLines(
  a: { category: IngredientCategory; ingredientName: string; ingredientId: string },
  b: { category: IngredientCategory; ingredientName: string; ingredientId: string },
): number {
  const byCategory = categoryRank(a.category) - categoryRank(b.category);
  if (byCategory !== 0) return byCategory;
  const byName = a.ingredientName.localeCompare(b.ingredientName);
  if (byName !== 0) return byName;
  return a.ingredientId.localeCompare(b.ingredientId);
}

interface DemandGroup {
  ingredientId: string;
  ingredientName: string;
  category: IngredientCategory;
  entries: Array<{ qty: number | null; qtyMax: number | null; unit: string | null; recipeTitle: string }>;
  uses: DemandUse[];
}

/**
 * Demand from planned cook events: scale each recipe to its planned servings,
 * convert every line into one target unit per ingredient, then aggregate.
 */
export function computeDemand(ctx: Ctx, input: DemandInput = {}): DemandLine[] {
  const conditions: SQL[] = [
    eq(cookEvents.householdId, ctx.householdId),
    eq(cookEvents.status, "planned"),
  ];
  if (input.mealPlanId !== undefined) {
    assertPlanExists(ctx, input.mealPlanId);
    conditions.push(eq(cookEvents.mealPlanId, input.mealPlanId));
  }
  if (input.from !== undefined) conditions.push(gte(cookEvents.cookDate, input.from));
  if (input.to !== undefined) conditions.push(lte(cookEvents.cookDate, input.to));

  const events = ctx.db
    .select({
      id: cookEvents.id,
      recipeId: cookEvents.recipeId,
      cookDate: cookEvents.cookDate,
      plannedServings: cookEvents.plannedServings,
      recipeTitle: recipes.title,
      createdAt: cookEvents.createdAt,
    })
    .from(cookEvents)
    .innerJoin(recipes, eq(recipes.id, cookEvents.recipeId))
    .where(and(...conditions))
    .orderBy(asc(cookEvents.cookDate), asc(cookEvents.createdAt), asc(cookEvents.id))
    .all();

  if (events.length === 0) return [];

  const groups = new Map<string, DemandGroup>();
  for (const event of events) {
    const scaled = scaleRecipeIngredients(ctx, event.recipeId, event.plannedServings);
    for (const line of scaled) {
      if (line.optional && input.includeOptional !== true) continue;

      const unit = normalizeUnitLoose(line.unit);
      let group = groups.get(line.ingredientId);
      if (!group) {
        group = {
          ingredientId: line.ingredientId,
          ingredientName: line.ingredientName,
          category: line.category,
          entries: [],
          uses: [],
        };
        groups.set(line.ingredientId, group);
      }
      group.entries.push({
        qty: line.qty,
        qtyMax: line.qtyMax,
        unit,
        recipeTitle: event.recipeTitle,
      });
      group.uses.push({
        cookEventId: event.id,
        recipeId: event.recipeId,
        recipeTitle: event.recipeTitle,
        cookDate: event.cookDate,
        qty: line.qty,
        unit,
        optional: line.optional,
      });
    }
  }
  if (groups.size === 0) return [];

  const ingredientIds = [...groups.keys()];
  const pantryByIngredient = pantryRowsFor(ctx, ingredientIds);
  const ingredientRows = ctx.db
    .select()
    .from(ingredients)
    .where(
      and(
        eq(ingredients.householdId, ctx.householdId),
        inArray(ingredients.id, ingredientIds),
      ),
    )
    .all();
  const defaultUnits = new Map(ingredientRows.map((row) => [row.id, row.defaultUnit] as const));

  const lines: DemandLine[] = [];
  for (const group of groups.values()) {
    const pantryRows = pantryByIngredient.get(group.ingredientId) ?? [];
    const target = targetUnitFor(
      defaultUnits.get(group.ingredientId) ?? null,
      group.entries.map((entry) => entry.unit),
      pantryRows,
    );

    let qtySum = 0;
    let qtyCounted = false;
    let maxSum = 0;
    let maxCounted = false;
    const unconvertible: UnconvertibleDemand[] = [];

    for (const entry of group.entries) {
      if (entry.qty !== null) {
        const converted = convert(ctx, entry.qty, entry.unit, target, group.ingredientId);
        if (converted === null) {
          unconvertible.push({
            qty: entry.qty,
            unit: entry.unit,
            recipeTitle: entry.recipeTitle,
          });
        } else {
          qtySum += converted;
          qtyCounted = true;
        }
      }
      if (entry.qtyMax !== null) {
        const convertedMax = convert(ctx, entry.qtyMax, entry.unit, target, group.ingredientId);
        if (convertedMax !== null) {
          maxSum += convertedMax;
          maxCounted = true;
        }
      }
    }

    lines.push({
      ingredientId: group.ingredientId,
      ingredientName: group.ingredientName,
      category: group.category,
      unit: target,
      qty: qtyCounted ? roundQty(qtySum) : null,
      ...(maxCounted ? { qtyMax: roundQty(maxSum) } : {}),
      unconvertible,
      uses: group.uses,
    });
  }

  return lines.sort(compareDemandLines);
}

function onHandStatusFor(onHand: number | null, rows: PantryRow[]): PantryStatus {
  if (onHand === null) return "unknown";
  if (onHand <= 0) return "out";
  if (rows.some((row) => row.status === "low")) return "low";
  return "on_hand";
}

/**
 * Availability for every ingredient with pantry stock or planned demand. This
 * replaces the old "reservation" concept: `committed` is computed from demand,
 * nothing is written.
 */
export function availabilityFor(ctx: Ctx, demand: DemandLine[]): AvailabilityLine[] {
  const demandByIngredient = new Map(demand.map((line) => [line.ingredientId, line] as const));

  const pantryRows = ctx.db
    .select()
    .from(pantryItems)
    .where(eq(pantryItems.householdId, ctx.householdId))
    .all();
  const pantryByIngredient = new Map<string, PantryRow[]>();
  for (const row of pantryRows) {
    const bucket = pantryByIngredient.get(row.ingredientId);
    if (bucket) bucket.push(row);
    else pantryByIngredient.set(row.ingredientId, [row]);
  }

  const ids = new Set<string>([...pantryByIngredient.keys(), ...demandByIngredient.keys()]);
  if (ids.size === 0) return [];

  const ingredientRows = ctx.db
    .select()
    .from(ingredients)
    .where(
      and(eq(ingredients.householdId, ctx.householdId), inArray(ingredients.id, [...ids])),
    )
    .all();
  const ingredientById = new Map(ingredientRows.map((row) => [row.id, row] as const));

  const lines: AvailabilityLine[] = [];
  for (const id of ids) {
    const ingredient = ingredientById.get(id);
    if (!ingredient) continue;

    const rows = pantryByIngredient.get(id) ?? [];
    const demandLine = demandByIngredient.get(id) ?? null;
    const unit = demandLine
      ? demandLine.unit
      : targetUnitFor(ingredient.defaultUnit, [], rows);

    let onHandSum = 0;
    let stockUnknown = false;
    for (const row of rows) {
      if (row.qty === null) {
        stockUnknown = true;
        continue;
      }
      const converted = convert(ctx, row.qty, normalizeUnitLoose(row.unit), unit, id);
      if (converted === null) {
        stockUnknown = true;
        continue;
      }
      onHandSum += converted;
    }
    const onHand: number | null = stockUnknown ? null : roundQty(onHandSum);

    const demandComparable =
      demandLine === null || (demandLine.unconvertible.length === 0 && demandLine.qty !== null);
    const committed = demandLine === null ? 0 : demandLine.qty;
    const comparable = onHand !== null && demandComparable;
    const available =
      comparable && onHand !== null && committed !== null
        ? roundQty(onHand - committed)
        : null;

    lines.push({
      ingredientId: id,
      ingredientName: ingredient.name,
      category: ingredient.category,
      unit,
      onHand,
      onHandStatus: onHandStatusFor(onHand, rows),
      committed,
      available,
      comparable,
      committedBy: demandLine?.uses ?? [],
    });
  }

  return lines.sort(compareDemandLines);
}

/** Availability for the planned cooks in scope (optionally limited to one meal plan). */
export function computeAvailability(ctx: Ctx, input: { mealPlanId?: string } = {}): AvailabilityLine[] {
  const demand = computeDemand(
    ctx,
    input.mealPlanId === undefined ? {} : { mealPlanId: input.mealPlanId },
  );
  return availabilityFor(ctx, demand);
}
