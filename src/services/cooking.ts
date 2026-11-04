import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Ctx } from "../context.js";
import {
  cookEvents,
  ingredients,
  pantryItems,
  stockMovements,
  type CookStatus,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { isIsoDate, nowIso } from "../lib/time.js";
import { applyMovement, getStockForIngredient } from "./pantry.js";
import { addAdHocCookEvent, getCookEvent, type CookEventView, type RecipeRef } from "./plans.js";
import { scaleRecipeIngredients } from "./recipes.js";
import { convert, normalizeUnit } from "./units.js";

export type StockMovement = typeof stockMovements.$inferSelect;
type PantryRow = typeof pantryItems.$inferSelect;

/** Structural view of a stock row (matches the pantry service's PantryItemView). */
interface StockRow extends PantryRow {
  ingredient: { id: string; name: string };
}

export interface CompleteCookEventInput {
  /** Servings actually produced; defaults to the planned servings. */
  actualServings?: number;
  rating?: number;
  notes?: string;
  /** Decrement pantry stock from the scaled recipe ingredients. Default true. */
  decrementPantry?: boolean;
}

export interface CompleteCookEventResult {
  cookEvent: CookEventView;
  movements: StockMovement[];
  warnings: string[];
}

export interface SkipCookEventInput {
  note?: string;
}

export interface ReopenCookEventResult {
  cookEvent: CookEventView;
  /** Compensating adjustments written to the ledger. */
  movements: StockMovement[];
  warnings: string[];
}

function withTx(ctx: Ctx, tx: unknown): Ctx {
  return { ...ctx, db: tx as Ctx["db"] };
}

function requireEventRow(ctx: Ctx, cookEventId: string): typeof cookEvents.$inferSelect {
  const row = ctx.db
    .select()
    .from(cookEvents)
    .where(and(eq(cookEvents.householdId, ctx.householdId), eq(cookEvents.id, cookEventId)))
    .get();
  if (!row) {
    throw new AppError("not_found", `Cook event not found: ${cookEventId}`, { id: cookEventId });
  }
  return row;
}

function assertServings(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError("validation", `${field} must be a positive number`, { [field]: value });
  }
}

function assertRating(value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new AppError("validation", "rating must be an integer between 1 and 5", { rating: value });
  }
}

/** Pick the pantry row to decrement: matching unit first, then most stock. */
function pickStockRow(stock: StockRow[], unit: string | null): StockRow {
  const targetUnit = normalizeUnit(unit);
  const sameUnit = stock.filter((row) => normalizeUnit(row.unit) === targetUnit);
  const pool = sameUnit.length > 0 ? sameUnit : stock;
  return [...pool].sort((a, b) => {
    if (a.qty === null && b.qty === null) return 0;
    if (a.qty === null) return 1;
    if (b.qty === null) return -1;
    return b.qty - a.qty;
  })[0]!;
}

/**
 * Complete a cook: `planned → done`, records actual servings and (by default)
 * decrements the scaled recipe ingredients from the pantry in one transaction.
 */
export function completeCookEvent(
  ctx: Ctx,
  cookEventId: string,
  input: CompleteCookEventInput = {},
): CompleteCookEventResult {
  assertRating(input.rating);

  return ctx.db.transaction((tx) => {
    const t = withTx(ctx, tx);
    const existing = requireEventRow(t, cookEventId);
    if (existing.status === "done") {
      throw new AppError("conflict", `Cook event ${cookEventId} is already completed`, {
        id: cookEventId,
      });
    }
    if (existing.status === "skipped") {
      throw new AppError("conflict", `Cook event ${cookEventId} was skipped`, { id: cookEventId });
    }

    const actualServings = input.actualServings ?? existing.plannedServings;
    assertServings(actualServings, "actualServings");

    const timestamp = nowIso(t);
    t.db
      .update(cookEvents)
      .set({
        status: "done",
        actualServings,
        completedAt: timestamp,
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: timestamp,
      })
      .where(eq(cookEvents.id, existing.id))
      .run();

    const movements: StockMovement[] = [];
    const warnings: string[] = [];

    if (input.decrementPantry !== false) {
      const ingredients = scaleRecipeIngredients(t, existing.recipeId, actualServings);
      if (ingredients.length === 0) {
        warnings.push(
          `Recipe ${existing.recipeId} has no ingredients; nothing was decremented from the pantry.`,
        );
      }

      const unmeasured: string[] = [];
      for (const ingredient of ingredients) {
        if (ingredient.optional) continue;
        if (ingredient.qty === null) {
          unmeasured.push(ingredient.ingredientName);
          continue;
        }
        if (ingredient.qty === 0) continue;

        const stock = getStockForIngredient(t, ingredient.ingredientId);
        if (stock.length === 0) {
          warnings.push(
            `${ingredient.ingredientName} is not tracked in pantry; nothing was decremented.`,
          );
          continue;
        }

        const target = pickStockRow(stock, ingredient.unit);
        const wanted = Math.abs(ingredient.qty);
        // Never record more than the pantry actually holds: the ledger row is what
        // reopenCookEvent reverses, so an over-recorded decrement would create stock.
        const available =
          target.qty === null
            ? null
            : convert(t, target.qty, target.unit, ingredient.unit, ingredient.ingredientId);
        const requested = available === null ? wanted : Math.min(wanted, Math.abs(available));
        if (requested <= 0) continue;

        const result = applyMovement(t, {
          ingredientId: ingredient.ingredientId,
          location: target.location,
          kind: "delta",
          qty: -requested,
          unit: ingredient.unit,
          reason: "cook",
          refType: "cook_event",
          refId: existing.id,
          note: `Cook ${existing.id} (${actualServings} servings)`,
        });
        movements.push(result.movement);
        if (result.warning !== undefined) {
          warnings.push(`${ingredient.ingredientName}: ${result.warning}`);
        }
      }

      if (unmeasured.length > 0) {
        warnings.push(
          `${unmeasured.length} ingredient(s) without a quantity were not decremented: ${unmeasured.join(", ")}.`,
        );
      }
    }

    return { cookEvent: getCookEvent(t, existing.id), movements, warnings };
  });
}

export interface CookAdHocInput extends RecipeRef {
  /** Servings cooked; defaults to the household defaultServings. */
  servings?: number;
  /** Defaults to today on the context clock. */
  cookDate?: string;
  /** Also complete the cook now (decrements the pantry). Default false. */
  complete?: boolean;
}

/**
 * Record a cook outside any plan (cooking from the recipe box). With `complete`,
 * the cook is completed in the same transaction exactly like
 * {@link completeCookEvent}; otherwise it stays planned and `movements` is empty.
 */
export function cookAdHoc(ctx: Ctx, input: CookAdHocInput): CompleteCookEventResult {
  return ctx.db.transaction((tx) => {
    const t = withTx(ctx, tx);
    const created = addAdHocCookEvent(t, {
      ...(input.recipeId === undefined ? {} : { recipeId: input.recipeId }),
      ...(input.recipe === undefined ? {} : { recipe: input.recipe }),
      ...(input.cookDate === undefined ? {} : { cookDate: input.cookDate }),
      ...(input.servings === undefined ? {} : { plannedServings: input.servings }),
    });
    if (input.complete !== true) return { cookEvent: created, movements: [], warnings: [] };
    return completeCookEvent(t, created.id);
  });
}

/** Mark a planned cook as skipped (it did not happen). */
export function skipCookEvent(
  ctx: Ctx,
  cookEventId: string,
  input: SkipCookEventInput = {},
): CookEventView {
  return ctx.db.transaction((tx) => {
    const t = withTx(ctx, tx);
    const existing = requireEventRow(t, cookEventId);
    if (existing.status === "done") {
      throw new AppError("conflict", `Cook event ${cookEventId} is already completed`, {
        id: cookEventId,
      });
    }
    if (existing.status === "skipped") {
      throw new AppError("conflict", `Cook event ${cookEventId} is already skipped`, {
        id: cookEventId,
      });
    }

    const note = input.note?.trim();
    t.db
      .update(cookEvents)
      .set({
        status: "skipped",
        notes:
          note !== undefined && note !== ""
            ? existing.notes
              ? `${existing.notes}\n${note}`
              : note
            : existing.notes,
        updatedAt: nowIso(t),
      })
      .where(eq(cookEvents.id, existing.id))
      .run();

    return getCookEvent(t, existing.id);
  });
}

/**
 * Reopen a completed cook (`done → planned`), writing compensating `adjust`
 * movements that reverse whatever this event took out of the pantry.
 */
export function reopenCookEvent(ctx: Ctx, cookEventId: string): ReopenCookEventResult {
  return ctx.db.transaction((tx) => {
    const t = withTx(ctx, tx);
    const existing = requireEventRow(t, cookEventId);
    if (existing.status !== "done") {
      throw new AppError(
        "conflict",
        `Cook event ${cookEventId} is ${existing.status}, only completed cooks can be reopened`,
        { id: cookEventId, status: existing.status },
      );
    }

    const ledger = t.db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.householdId, t.householdId),
          eq(stockMovements.refType, "cook_event"),
          eq(stockMovements.refId, existing.id),
        ),
      )
      .all();

    const netByItemUnit = new Map<string, { pantryItemId: string; unit: string | null; net: number }>();
    for (const movement of ledger) {
      if (movement.qty === null) continue;
      const key = `${movement.pantryItemId}\u0000${movement.unit ?? ""}`;
      const current = netByItemUnit.get(key) ?? {
        pantryItemId: movement.pantryItemId,
        unit: movement.unit,
        net: 0,
      };
      current.net += movement.qty;
      netByItemUnit.set(key, current);
    }

    const movements: StockMovement[] = [];
    const warnings: string[] = [];
    for (const { pantryItemId, unit, net } of netByItemUnit.values()) {
      if (Math.abs(net) < 1e-9) continue;
      const item = t.db
        .select()
        .from(pantryItems)
        .where(and(eq(pantryItems.householdId, t.householdId), eq(pantryItems.id, pantryItemId)))
        .get();
      if (!item) {
        warnings.push(`Pantry item ${pantryItemId} no longer exists; nothing was restored for it.`);
        continue;
      }
      const result = applyMovement(t, {
        ingredientId: item.ingredientId,
        location: item.location,
        kind: "delta",
        qty: -net,
        unit,
        reason: "adjust",
        refType: "cook_event",
        refId: existing.id,
        note: `Reopened cook event ${existing.id}`,
      });
      movements.push(result.movement);
      if (result.warning !== undefined) warnings.push(result.warning);
    }

    t.db
      .update(cookEvents)
      .set({ status: "planned", completedAt: null, actualServings: null, updatedAt: nowIso(t) })
      .where(eq(cookEvents.id, existing.id))
      .run();

    return { cookEvent: getCookEvent(t, existing.id), movements, warnings };
  });
}

/** A stock movement attributed to a cook, with the ingredient it touched. */
export interface CookEventMovementView extends StockMovement {
  ingredientId: string;
  ingredientName: string;
}

export interface CookEventHistoryItem extends CookEventView {
  /** Present only when `includeMovements` was requested. */
  movements?: CookEventMovementView[];
}

export interface ListCookEventsInput {
  planId?: string;
  from?: string;
  to?: string;
  status?: CookStatus;
  recipeId?: string;
  limit?: number;
  /** Attach the pantry movements each cook produced (`refType` = cook_event). */
  includeMovements?: boolean;
}

/** Cook history ("what did we eat"), newest cook date first. */
export function listCookEvents(
  ctx: Ctx,
  input: ListCookEventsInput = {},
): { items: CookEventHistoryItem[] } {
  const conditions = [eq(cookEvents.householdId, ctx.householdId)];
  if (input.planId !== undefined) conditions.push(eq(cookEvents.mealPlanId, input.planId));
  if (input.status !== undefined) conditions.push(eq(cookEvents.status, input.status));
  if (input.recipeId !== undefined) conditions.push(eq(cookEvents.recipeId, input.recipeId));
  if (input.from !== undefined) {
    if (!isIsoDate(input.from)) {
      throw new AppError("validation", "from must be a valid YYYY-MM-DD date", { from: input.from });
    }
    conditions.push(gte(cookEvents.cookDate, input.from));
  }
  if (input.to !== undefined) {
    if (!isIsoDate(input.to)) {
      throw new AppError("validation", "to must be a valid YYYY-MM-DD date", { to: input.to });
    }
    conditions.push(sql`${cookEvents.cookDate} <= ${input.to}`);
  }

  const limit =
    input.limit === undefined ? -1 : Math.min(Math.max(1, Math.trunc(input.limit)), 500);
  const rows = ctx.db
    .select({ id: cookEvents.id })
    .from(cookEvents)
    .where(and(...conditions))
    .orderBy(desc(cookEvents.cookDate), desc(cookEvents.createdAt), desc(sql`${cookEvents}.rowid`))
    .limit(limit)
    .all();

  const items: CookEventHistoryItem[] = rows.map((row) => getCookEvent(ctx, row.id));

  if (input.includeMovements === true && items.length > 0) {
    const movements = ctx.db
      .select({
        movement: stockMovements,
        ingredientId: pantryItems.ingredientId,
        ingredientName: ingredients.name,
      })
      .from(stockMovements)
      .innerJoin(pantryItems, eq(pantryItems.id, stockMovements.pantryItemId))
      .innerJoin(ingredients, eq(ingredients.id, pantryItems.ingredientId))
      .where(
        and(
          eq(stockMovements.householdId, ctx.householdId),
          eq(stockMovements.refType, "cook_event"),
          inArray(
            stockMovements.refId,
            items.map((item) => item.id),
          ),
        ),
      )
      .orderBy(asc(stockMovements.createdAt), asc(sql`${stockMovements}.rowid`))
      .all();

    const byEvent = new Map<string, CookEventMovementView[]>();
    for (const { movement, ingredientId, ingredientName } of movements) {
      if (movement.refId === null) continue;
      const list = byEvent.get(movement.refId);
      const view = { ...movement, ingredientId, ingredientName };
      if (list === undefined) byEvent.set(movement.refId, [view]);
      else list.push(view);
    }
    for (const item of items) item.movements = byEvent.get(item.id) ?? [];
  }

  return { items };
}
