import { and, asc, desc, eq, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import type { Ctx } from "../context.js";
import {
  ingredientAliases,
  ingredients,
  pantryItems,
  stockMovements,
  type IngredientCategory,
  type MovementKind,
  type MovementReason,
  type MovementRefType,
  type PantryStatus,
  type StorageLocation,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { resolveIngredient, type Ingredient } from "./ingredients.js";
import { convert, normalizeUnit } from "./units.js";

export type PantryItem = typeof pantryItems.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;

/** Pantry row plus the ingredient it belongs to. */
export interface PantryItemView extends PantryItem {
  ingredient: { id: string; name: string; category: IngredientCategory };
}

export interface MovementResult {
  item: PantryItemView;
  movement: StockMovement;
  warning?: string;
}

export interface StockMovementView extends StockMovement {
  ingredientId: string;
  ingredientName: string;
  location: StorageLocation;
}

export interface ApplyMovementInput {
  ingredientId: string;
  /** Defaults to the ingredient's `defaultLocation`. */
  location?: StorageLocation;
  kind: MovementKind;
  qty: number | null;
  unit: string | null;
  reason: MovementReason;
  refType?: MovementRefType | null;
  refId?: string | null;
  note?: string | null;
  /** Explicit status; only honoured for `set` movements. */
  status?: PantryStatus;
  qtyApprox?: boolean;
  rawText?: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Run `fn` in a transaction (nested calls use SQLite savepoints). */
function withTx<T>(ctx: Ctx, fn: (tx: Ctx) => T): T {
  return ctx.db.transaction((tx) => fn({ ...ctx, db: tx as unknown as Ctx["db"] }));
}

function requireIngredient(ctx: Ctx, id: string): Ingredient {
  const row = ctx.db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, id)))
    .get();
  if (!row) throw new AppError("not_found", `Ingredient not found: ${id}`);
  return row;
}

function requirePantryItem(ctx: Ctx, id: string): PantryItem {
  const row = ctx.db
    .select()
    .from(pantryItems)
    .where(and(eq(pantryItems.householdId, ctx.householdId), eq(pantryItems.id, id)))
    .get();
  if (!row) throw new AppError("not_found", `Pantry item not found: ${id}`);
  return row;
}

function pantryItemView(ctx: Ctx, item: PantryItem): PantryItemView {
  const ingredient = ctx.db
    .select({ id: ingredients.id, name: ingredients.name, category: ingredients.category })
    .from(ingredients)
    .where(
      and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, item.ingredientId)),
    )
    .get();
  if (!ingredient) throw new AppError("not_found", `Ingredient not found: ${item.ingredientId}`);
  return { ...item, ingredient };
}

function normalizeUnitInput(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const normalized = normalizeUnit(raw);
  if (normalized === null) throw new AppError("validation", `Unknown unit: ${raw}`);
  return normalized;
}

/** 0 → out, at/below par (converted) → low, otherwise on_hand. */
function computeStatus(
  ctx: Ctx,
  ingredient: Ingredient,
  qty: number | null,
  unit: string | null,
): PantryStatus {
  if (qty === null) return "unknown";
  if (qty <= 0) return "out";
  if (ingredient.parQty !== null) {
    const par = convert(ctx, ingredient.parQty, ingredient.parUnit, unit, ingredient.id);
    if (par !== null && qty <= par) return "low";
  }
  return "on_hand";
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

function applyMovementIn(ctx: Ctx, input: ApplyMovementInput): MovementResult {
  if (input.qty !== null && !Number.isFinite(input.qty)) {
    throw new AppError("validation", "qty must be a finite number or null");
  }
  if (input.kind === "delta" && input.qty === null) {
    throw new AppError("validation", "A delta movement requires qty");
  }

  const ingredient = requireIngredient(ctx, input.ingredientId);
  const unit = normalizeUnitInput(input.unit);
  const location = input.location ?? ingredient.defaultLocation;
  const existing = ctx.db
    .select()
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.householdId, ctx.householdId),
        eq(pantryItems.ingredientId, ingredient.id),
        eq(pantryItems.location, location),
      ),
    )
    .get();

  const timestamp = nowIso(ctx);
  let qtyAfter: number | null;
  let itemUnit: string | null;
  let statusAfter: PantryStatus;
  let warning: string | undefined;

  if (input.kind === "set") {
    if (input.qty !== null && input.qty < 0) {
      throw new AppError("validation", "qty cannot be negative for a set movement");
    }
    qtyAfter = input.qty;
    itemUnit =
      unit ??
      existing?.unit ??
      (input.qty === null ? null : normalizeUnit(ingredient.defaultUnit));
    if (input.status !== undefined) statusAfter = input.status;
    else if (qtyAfter === null) statusAfter = existing?.status ?? "unknown";
    else statusAfter = computeStatus(ctx, ingredient, qtyAfter, itemUnit);
  } else {
    const delta = input.qty as number;
    itemUnit = existing?.unit ?? unit;
    if (existing === undefined) {
      // No row yet: the household is known to have zero of it, so the delta is
      // the starting amount in the movement's own unit. Clamped at 0 like any
      // other delta.
      qtyAfter = Math.max(0, delta);
      statusAfter = computeStatus(ctx, ingredient, qtyAfter, itemUnit);
    } else if (existing.qty === null) {
      // Unknown amounts stay unknown; a positive delta means "we know we have it".
      qtyAfter = null;
      statusAfter = delta > 0 ? "on_hand" : existing.status;
    } else {
      const converted = convert(ctx, delta, unit ?? itemUnit, itemUnit, ingredient.id);
      if (converted === null) {
        qtyAfter = existing.qty;
        statusAfter = existing.status;
        warning = "units not comparable";
      } else {
        qtyAfter = Math.max(0, existing.qty + converted);
        statusAfter = computeStatus(ctx, ingredient, qtyAfter, itemUnit);
      }
    }
  }

  // A set or a purchase is a direct observation of stock; deltas from cooking or waste are not.
  const observed =
    input.kind === "set" || input.reason === "verify" || input.reason === "purchase";
  const itemValues = {
    qty: qtyAfter,
    unit: itemUnit,
    status: statusAfter,
    qtyApprox: input.qtyApprox ?? existing?.qtyApprox ?? false,
    rawText: input.rawText ?? existing?.rawText ?? null,
    lastVerifiedAt: observed ? timestamp : (existing?.lastVerifiedAt ?? null),
    updatedAt: timestamp,
  };

  let itemId: string;
  if (existing) {
    itemId = existing.id;
    ctx.db.update(pantryItems).set(itemValues).where(eq(pantryItems.id, existing.id)).run();
  } else {
    itemId = newId("pi");
    ctx.db
      .insert(pantryItems)
      .values({
        id: itemId,
        householdId: ctx.householdId,
        ingredientId: ingredient.id,
        location,
        createdAt: timestamp,
        ...itemValues,
      })
      .run();
  }

  const movement = ctx.db
    .insert(stockMovements)
    .values({
      id: newId("mv"),
      householdId: ctx.householdId,
      pantryItemId: itemId,
      kind: input.kind,
      qty: input.qty,
      unit,
      reason: input.reason,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      note: input.note ?? null,
      qtyAfter,
      statusAfter,
      createdAt: timestamp,
    })
    .returning()
    .get();

  const result: MovementResult = {
    item: pantryItemView(ctx, requirePantryItem(ctx, itemId)),
    movement,
  };
  if (warning !== undefined) result.warning = warning;
  return result;
}

/**
 * The single write path for stock: upserts the pantry item, applies the
 * movement (converting delta units when possible, clamping at 0) and appends a
 * `stock_movement` snapshot. Safe to call inside a caller's transaction.
 */
export function applyMovement(ctx: Ctx, input: ApplyMovementInput): MovementResult {
  return withTx(ctx, (tx) => applyMovementIn(tx, input));
}

/** All stock rows for an ingredient, across locations. */
export function getStockForIngredient(ctx: Ctx, ingredientId: string): PantryItemView[] {
  const rows = ctx.db
    .select({ item: pantryItems, ingredient: {
      id: ingredients.id,
      name: ingredients.name,
      category: ingredients.category,
    } })
    .from(pantryItems)
    .innerJoin(ingredients, eq(ingredients.id, pantryItems.ingredientId))
    .where(
      and(
        eq(pantryItems.householdId, ctx.householdId),
        eq(pantryItems.ingredientId, ingredientId),
      ),
    )
    .orderBy(asc(pantryItems.location))
    .all();

  return rows.map(({ item, ingredient }) => ({ ...item, ingredient }));
}

/** One pantry row (with its ingredient) or `not_found`. */
export function getPantryItem(ctx: Ctx, pantryItemId: string): PantryItemView {
  return pantryItemView(ctx, requirePantryItem(ctx, pantryItemId));
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface IngredientRefInput {
  ingredientId?: string;
  /** Free-text name; created when the caller allows it. */
  ingredient?: string;
  /** Category used when the ingredient is created. */
  category?: IngredientCategory;
}

export interface SetStockInput extends IngredientRefInput {
  qty: number | null;
  unit?: string | null;
  location?: StorageLocation;
  status?: PantryStatus;
  note?: string | null;
  expiresOn?: string | null;
  openedOn?: string | null;
  purchasedOn?: string | null;
  qtyApprox?: boolean;
  rawText?: string | null;
  reason?: MovementReason;
  refType?: MovementRefType;
  refId?: string;
}

export interface AdjustStockInput extends IngredientRefInput {
  delta: number;
  unit?: string | null;
  location?: StorageLocation;
  note?: string | null;
  reason?: MovementReason;
  refType?: MovementRefType;
  refId?: string;
}

/** A bulk line: `set` replaces the amount, `adjust` applies a relative delta. */
export type StockLine =
  | ({ op: "set" } & SetStockInput)
  | ({ op: "adjust" } & AdjustStockInput);

/** Resolve `ingredientId` or a name; names resolve through aliases/plurals. */
export function resolveIngredientRef(
  ctx: Ctx,
  ref: IngredientRefInput,
  create: boolean,
): Ingredient {
  if (ref.ingredientId !== undefined && ref.ingredientId !== "") {
    return requireIngredient(ctx, ref.ingredientId);
  }
  if (ref.ingredient !== undefined && ref.ingredient.trim() !== "") {
    return resolveIngredient(ctx, ref.ingredient, {
      create,
      ...(ref.category === undefined ? {} : { category: ref.category }),
    });
  }
  throw new AppError("validation", "ingredient or ingredientId is required");
}

// ---------------------------------------------------------------------------
// Set / adjust
// ---------------------------------------------------------------------------

function setStockIn(ctx: Ctx, input: SetStockInput): MovementResult {
  const ingredient = resolveIngredientRef(ctx, input, true);
  const result = applyMovementIn(ctx, {
    ingredientId: ingredient.id,
    ...(input.location === undefined ? {} : { location: input.location }),
    kind: "set",
    qty: input.qty,
    unit: input.unit ?? null,
    reason: input.reason ?? "adjust",
    ...(input.status === undefined ? {} : { status: input.status }),
    note: input.note ?? null,
    ...(input.refType === undefined ? {} : { refType: input.refType }),
    ...(input.refId === undefined ? {} : { refId: input.refId }),
    ...(input.qtyApprox === undefined ? {} : { qtyApprox: input.qtyApprox }),
    ...(input.rawText === undefined ? {} : { rawText: input.rawText }),
  });

  const metadata: Partial<typeof pantryItems.$inferInsert> = {};
  if (input.note !== undefined) metadata.note = input.note;
  if (input.expiresOn !== undefined) metadata.expiresOn = input.expiresOn;
  if (input.openedOn !== undefined) metadata.openedOn = input.openedOn;
  if (input.purchasedOn !== undefined) metadata.purchasedOn = input.purchasedOn;
  if (Object.keys(metadata).length > 0) {
    ctx.db
      .update(pantryItems)
      .set({ ...metadata, updatedAt: nowIso(ctx) })
      .where(eq(pantryItems.id, result.item.id))
      .run();
    result.item = pantryItemView(ctx, requirePantryItem(ctx, result.item.id));
  }
  return result;
}

function adjustStockIn(ctx: Ctx, input: AdjustStockInput): MovementResult {
  if (!Number.isFinite(input.delta)) {
    throw new AppError("validation", "delta must be a finite number");
  }
  const ingredient = resolveIngredientRef(ctx, input, input.delta > 0);
  return applyMovementIn(ctx, {
    ingredientId: ingredient.id,
    ...(input.location === undefined ? {} : { location: input.location }),
    kind: "delta",
    qty: input.delta,
    unit: input.unit ?? null,
    reason: input.reason ?? "adjust",
    note: input.note ?? null,
    ...(input.refType === undefined ? {} : { refType: input.refType }),
    ...(input.refId === undefined ? {} : { refId: input.refId }),
  });
}

/** Absolute stock ("I have 2 lb of rice"). Creates unknown ingredients. */
export function setStock(ctx: Ctx, input: SetStockInput): MovementResult {
  return withTx(ctx, (tx) => setStockIn(tx, input));
}

/**
 * Relative stock change. Positive deltas create unknown ingredients; negative
 * deltas require the ingredient to exist.
 */
export function adjustStock(ctx: Ctx, input: AdjustStockInput): MovementResult {
  return withTx(ctx, (tx) => adjustStockIn(tx, input));
}

/** Apply many set/adjust lines atomically; any invalid line rolls everything back. */
export function bulkUpdate(ctx: Ctx, lines: StockLine[]): MovementResult[] {
  return withTx(ctx, (tx) =>
    lines.map((line) => (line.op === "adjust" ? adjustStockIn(tx, line) : setStockIn(tx, line))),
  );
}

/** Mark stock as checked now and record a `verify` movement with the same qty. */
export function verifyItem(ctx: Ctx, pantryItemId: string): MovementResult {
  return withTx(ctx, (tx) => {
    const item = requirePantryItem(tx, pantryItemId);
    return applyMovementIn(tx, {
      ingredientId: item.ingredientId,
      location: item.location,
      kind: "set",
      qty: item.qty,
      unit: item.unit,
      reason: "verify",
    });
  });
}

// ---------------------------------------------------------------------------
// Listing / metadata
// ---------------------------------------------------------------------------

export interface ListPantryOptions {
  category?: IngredientCategory;
  location?: StorageLocation;
  status?: PantryStatus;
  /** Only rows never verified or verified more than N days ago. */
  staleDays?: number;
  /** Case-insensitive match against the ingredient name or an alias. */
  query?: string;
}

/** Pantry rows sorted by ingredient category then name. */
export function listPantry(ctx: Ctx, options: ListPantryOptions = {}): PantryItemView[] {
  const conditions = [eq(pantryItems.householdId, ctx.householdId)];
  if (options.category !== undefined) conditions.push(eq(ingredients.category, options.category));
  if (options.location !== undefined) conditions.push(eq(pantryItems.location, options.location));
  if (options.status !== undefined) conditions.push(eq(pantryItems.status, options.status));
  if (options.staleDays !== undefined) {
    if (!Number.isFinite(options.staleDays) || options.staleDays < 0) {
      throw new AppError("validation", "staleDays must be a non-negative number");
    }
    const cutoff = new Date(
      ctx.now().getTime() - options.staleDays * 86_400_000,
    ).toISOString();
    const stale = or(isNull(pantryItems.lastVerifiedAt), lt(pantryItems.lastVerifiedAt, cutoff));
    if (stale !== undefined) conditions.push(stale);
  }

  const search = options.query?.trim() ?? "";
  if (search !== "") {
    const pattern = `%${search.toLowerCase().replace(/\s+/g, " ")}%`;
    const aliasMatches = ctx.db
      .select({ id: ingredientAliases.ingredientId })
      .from(ingredientAliases)
      .where(
        and(
          eq(ingredientAliases.householdId, ctx.householdId),
          like(ingredientAliases.alias, pattern),
        ),
      )
      .all()
      .map((row) => row.id);
    const nameMatch = like(ingredients.normalizedName, pattern);
    const match =
      aliasMatches.length > 0
        ? or(nameMatch, inArray(ingredients.id, aliasMatches))
        : nameMatch;
    if (match !== undefined) conditions.push(match);
  }

  const rows = ctx.db
    .select({
      item: pantryItems,
      ingredient: {
        id: ingredients.id,
        name: ingredients.name,
        category: ingredients.category,
      },
    })
    .from(pantryItems)
    .innerJoin(ingredients, eq(ingredients.id, pantryItems.ingredientId))
    .where(and(...conditions))
    .orderBy(asc(ingredients.category), asc(ingredients.normalizedName), asc(pantryItems.id))
    .all();

  return rows.map(({ item, ingredient }) => ({ ...item, ingredient }));
}

export interface UpdatePantryItemInput {
  location?: StorageLocation;
  note?: string | null;
  expiresOn?: string | null;
  openedOn?: string | null;
  purchasedOn?: string | null;
  rawText?: string | null;
  status?: PantryStatus;
  qtyApprox?: boolean;
}

/** Metadata-only update (moving location, notes, dates). Quantities go through the ledger. */
export function updatePantryItem(
  ctx: Ctx,
  pantryItemId: string,
  input: UpdatePantryItemInput,
): PantryItemView {
  return withTx(ctx, (tx) => {
    const item = requirePantryItem(tx, pantryItemId);
    const patch: Partial<typeof pantryItems.$inferInsert> = {};

    if (input.location !== undefined && input.location !== item.location) {
      const clash = tx.db
        .select({ id: pantryItems.id })
        .from(pantryItems)
        .where(
          and(
            eq(pantryItems.householdId, tx.householdId),
            eq(pantryItems.ingredientId, item.ingredientId),
            eq(pantryItems.location, input.location),
          ),
        )
        .get();
      if (clash) {
        throw new AppError(
          "conflict",
          `Ingredient already has stock in ${input.location}`,
        );
      }
      patch.location = input.location;
    }
    if (input.note !== undefined) patch.note = input.note;
    if (input.expiresOn !== undefined) patch.expiresOn = input.expiresOn;
    if (input.openedOn !== undefined) patch.openedOn = input.openedOn;
    if (input.purchasedOn !== undefined) patch.purchasedOn = input.purchasedOn;
    if (input.rawText !== undefined) patch.rawText = input.rawText;
    if (input.status !== undefined) patch.status = input.status;
    if (input.qtyApprox !== undefined) patch.qtyApprox = input.qtyApprox;

    if (Object.keys(patch).length === 0) return pantryItemView(tx, item);

    patch.updatedAt = nowIso(tx);
    tx.db.update(pantryItems).set(patch).where(eq(pantryItems.id, item.id)).run();
    return pantryItemView(tx, requirePantryItem(tx, item.id));
  });
}

/** Remove a pantry row (its movements cascade away). */
export function deletePantryItem(ctx: Ctx, pantryItemId: string): void {
  const result = ctx.db
    .delete(pantryItems)
    .where(
      and(eq(pantryItems.householdId, ctx.householdId), eq(pantryItems.id, pantryItemId)),
    )
    .run();
  if (result.changes === 0) {
    throw new AppError("not_found", `Pantry item not found: ${pantryItemId}`);
  }
}

export interface ListMovementsOptions {
  pantryItemId?: string;
  ingredientId?: string;
  refType?: MovementRefType;
  refId?: string;
  /** Defaults to 50; clamped to 1..200. */
  limit?: number;
  /** Only movements created strictly before this ISO timestamp. */
  before?: string;
  /**
   * Rowid of the last movement on the previous page (`stock_movement.rowid`,
   * insertion order). Combine with `before` for a compound
   * `(createdAt, rowid)` cursor: rows sharing the boundary timestamp are then
   * paginated in rowid order instead of being skipped or duplicated.
   */
  beforeRowid?: number;
}

/** Ledger entries, newest first. */
export function listMovements(
  ctx: Ctx,
  options: ListMovementsOptions = {},
): StockMovementView[] {
  const conditions = [eq(stockMovements.householdId, ctx.householdId)];
  if (options.pantryItemId !== undefined) {
    conditions.push(eq(stockMovements.pantryItemId, options.pantryItemId));
  }
  if (options.refType !== undefined) conditions.push(eq(stockMovements.refType, options.refType));
  if (options.refId !== undefined) conditions.push(eq(stockMovements.refId, options.refId));
  if (options.ingredientId !== undefined) {
    conditions.push(eq(pantryItems.ingredientId, options.ingredientId));
  }
  if (options.before !== undefined && options.beforeRowid !== undefined) {
    const rowid = sql`${stockMovements}.rowid`;
    conditions.push(
      sql`(${stockMovements.createdAt} < ${options.before} OR (${stockMovements.createdAt} = ${options.before} AND ${rowid} < ${options.beforeRowid}))`,
    );
  } else if (options.before !== undefined) {
    conditions.push(lt(stockMovements.createdAt, options.before));
  } else if (options.beforeRowid !== undefined) {
    conditions.push(sql`${stockMovements}.rowid < ${options.beforeRowid}`);
  }

  const requested = options.limit ?? 50;
  const limit = Math.min(200, Math.max(1, Math.trunc(Number.isFinite(requested) ? requested : 50)));

  const rows = ctx.db
    .select({
      movement: stockMovements,
      ingredientId: pantryItems.ingredientId,
      ingredientName: ingredients.name,
      location: pantryItems.location,
    })
    .from(stockMovements)
    .innerJoin(pantryItems, eq(pantryItems.id, stockMovements.pantryItemId))
    .innerJoin(ingredients, eq(ingredients.id, pantryItems.ingredientId))
    .where(and(...conditions))
    .orderBy(desc(stockMovements.createdAt), desc(sql`${stockMovements}.rowid`))
    .limit(limit)
    .all();

  return rows.map(({ movement, ingredientId, ingredientName, location }) => ({
    ...movement,
    ingredientId,
    ingredientName,
    location,
  }));
}
