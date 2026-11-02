import { and, asc, eq, inArray, isNull, like, or } from "drizzle-orm";
import type { Ctx } from "../context.js";
import {
  dietaryRules,
  ingredientAliases,
  ingredients,
  pantryItems,
  recipeIngredients,
  shoppingListItems,
  stockMovements,
  unitConversions,
  type IngredientCategory,
  type PantryStatus,
  type StorageLocation,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { convert, normalizeUnit } from "./units.js";

export type Ingredient = typeof ingredients.$inferSelect;

/** Canonical lookup key: trimmed, lowercased, whitespace collapsed. */
export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Simple singular/plural candidates derived from a normalized name. */
function variantNames(normalized: string): string[] {
  const variants = new Set<string>();
  if (normalized.length > 3) {
    if (normalized.endsWith("es")) variants.add(normalized.slice(0, -2));
    if (normalized.endsWith("s")) variants.add(normalized.slice(0, -1));
  }
  variants.add(`${normalized}s`);
  variants.add(`${normalized}es`);
  variants.delete(normalized);
  return [...variants];
}

function findByNormalizedName(ctx: Ctx, normalized: string): Ingredient | null {
  const row = ctx.db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.normalizedName, normalized)))
    .get();
  return row ?? null;
}

function findByAlias(ctx: Ctx, alias: string): Ingredient | null {
  const link = ctx.db
    .select({ ingredientId: ingredientAliases.ingredientId })
    .from(ingredientAliases)
    .where(and(eq(ingredientAliases.householdId, ctx.householdId), eq(ingredientAliases.alias, alias)))
    .get();
  if (!link) return null;

  const row = ctx.db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, link.ingredientId)))
    .get();
  return row ?? null;
}

/**
 * Resolve an ingredient name without creating anything: exact normalized name,
 * then alias, then simple singular/plural variants of the name.
 * Archived ingredients still match (so history keeps resolving).
 */
export function findIngredientByName(ctx: Ctx, name: string): Ingredient | null {
  const normalized = normalizeName(name);
  if (normalized === "") return null;

  const direct = findByNormalizedName(ctx, normalized) ?? findByAlias(ctx, normalized);
  if (direct) return direct;

  for (const variant of variantNames(normalized)) {
    const match = findByNormalizedName(ctx, variant) ?? findByAlias(ctx, variant);
    if (match) return match;
  }
  return null;
}

export interface ResolveIngredientOptions {
  /** Create the ingredient when nothing matches. */
  create?: boolean;
  /** Category used when creating a new ingredient (defaults to "other"). */
  category?: IngredientCategory;
}

/**
 * Resolve a free-text ingredient name; with `create: true` a missing ingredient is
 * inserted (original casing, trimmed) and returned. Otherwise throws `unprocessable`
 * with `{ unresolved: [name] }`.
 */
export function resolveIngredient(
  ctx: Ctx,
  name: string,
  options: ResolveIngredientOptions = {},
): Ingredient {
  const displayName = name.trim().replace(/\s+/g, " ");
  const normalized = normalizeName(name);
  if (normalized === "") {
    throw new AppError("validation", "Ingredient name is required");
  }

  const existing = findIngredientByName(ctx, name);
  if (existing) return existing;

  if (!options.create) {
    throw new AppError("unprocessable", `Unknown ingredient: ${displayName}`, {
      unresolved: [displayName],
    });
  }

  const timestamp = nowIso(ctx);
  return ctx.db
    .insert(ingredients)
    .values({
      id: newId("ing"),
      householdId: ctx.householdId,
      name: displayName,
      normalizedName: normalized,
      category: options.category ?? "other",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface IngredientAliasView {
  id: string;
  alias: string;
  createdAt: string;
}

export interface IngredientConversionView {
  id: string;
  ingredientId: string | null;
  fromUnit: string;
  toUnit: string;
  factor: number;
  note: string | null;
  createdAt: string;
}

export interface IngredientStockView {
  id: string;
  location: StorageLocation;
  qty: number | null;
  unit: string | null;
  qtyApprox: boolean;
  status: PantryStatus;
}

/** Ingredient row plus its aliases, custom conversions and pantry stock. */
export interface IngredientView extends Omit<Ingredient, "householdId"> {
  aliases: IngredientAliasView[];
  conversions: IngredientConversionView[];
  pantry: IngredientStockView[];
}

function ingredientView(ctx: Ctx, row: Ingredient): IngredientView {
  const { householdId: _householdId, ...rest } = row;

  const aliases = ctx.db
    .select({
      id: ingredientAliases.id,
      alias: ingredientAliases.alias,
      createdAt: ingredientAliases.createdAt,
    })
    .from(ingredientAliases)
    .where(
      and(
        eq(ingredientAliases.householdId, ctx.householdId),
        eq(ingredientAliases.ingredientId, row.id),
      ),
    )
    .orderBy(asc(ingredientAliases.alias))
    .all();

  const conversions = ctx.db
    .select({
      id: unitConversions.id,
      ingredientId: unitConversions.ingredientId,
      fromUnit: unitConversions.fromUnit,
      toUnit: unitConversions.toUnit,
      factor: unitConversions.factor,
      note: unitConversions.note,
      createdAt: unitConversions.createdAt,
    })
    .from(unitConversions)
    .where(
      and(
        eq(unitConversions.householdId, ctx.householdId),
        eq(unitConversions.ingredientId, row.id),
      ),
    )
    .orderBy(asc(unitConversions.fromUnit), asc(unitConversions.toUnit))
    .all();

  const pantry = ctx.db
    .select({
      id: pantryItems.id,
      location: pantryItems.location,
      qty: pantryItems.qty,
      unit: pantryItems.unit,
      qtyApprox: pantryItems.qtyApprox,
      status: pantryItems.status,
    })
    .from(pantryItems)
    .where(
      and(eq(pantryItems.householdId, ctx.householdId), eq(pantryItems.ingredientId, row.id)),
    )
    .orderBy(asc(pantryItems.location))
    .all();

  return { ...rest, aliases, conversions, pantry };
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

function findAliasRow(
  ctx: Ctx,
  alias: string,
): typeof ingredientAliases.$inferSelect | null {
  return (
    ctx.db
      .select()
      .from(ingredientAliases)
      .where(
        and(
          eq(ingredientAliases.householdId, ctx.householdId),
          eq(ingredientAliases.alias, alias),
        ),
      )
      .get() ?? null
  );
}

function normalizeUnitInput(raw: string | null | undefined, field: string): string | null {
  if (raw === null || raw === undefined) return null;
  const normalized = normalizeUnit(raw);
  if (normalized === null) {
    throw new AppError("validation", `Unknown ${field}: ${raw}`);
  }
  return normalized;
}

function requireParQty(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(raw) || raw < 0) {
    throw new AppError("validation", "parQty must be a non-negative number");
  }
  return raw;
}

function statusFor(
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
// Read
// ---------------------------------------------------------------------------

export interface ListIngredientsOptions {
  /** Case-insensitive substring matched against the name or any alias. */
  query?: string;
  category?: IngredientCategory;
  includeArchived?: boolean;
}

/** Ingredients with their aliases, conversions and pantry stock, sorted by name. */
export function listIngredients(
  ctx: Ctx,
  options: ListIngredientsOptions = {},
): IngredientView[] {
  const conditions = [eq(ingredients.householdId, ctx.householdId)];
  if (options.includeArchived !== true) conditions.push(isNull(ingredients.archivedAt));
  if (options.category !== undefined) conditions.push(eq(ingredients.category, options.category));

  const search = options.query?.trim() ?? "";
  if (search !== "") {
    const pattern = `%${normalizeName(search)}%`;
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
    .select()
    .from(ingredients)
    .where(and(...conditions))
    .orderBy(asc(ingredients.normalizedName))
    .all();
  return rows.map((row) => ingredientView(ctx, row));
}

/** One ingredient with nested aliases, conversions and pantry stock. */
export function getIngredient(ctx: Ctx, id: string): IngredientView {
  return ingredientView(ctx, requireIngredient(ctx, id));
}

// ---------------------------------------------------------------------------
// Create / update / archive
// ---------------------------------------------------------------------------

export interface CreateIngredientInput {
  name: string;
  description?: string | null;
  category?: IngredientCategory;
  aliases?: string[];
  defaultUnit?: string | null;
  defaultLocation?: StorageLocation;
  imageUrl?: string | null;
  shelfLifeDays?: number | null;
  isStaple?: boolean;
  parQty?: number | null;
  parUnit?: string | null;
  notes?: string | null;
}

function createIngredientIn(ctx: Ctx, input: CreateIngredientInput): IngredientView {
  const name = input.name.trim().replace(/\s+/g, " ");
  const normalized = normalizeName(input.name);
  if (normalized === "") throw new AppError("validation", "Ingredient name is required");
  if (findByNormalizedName(ctx, normalized)) {
    throw new AppError("conflict", `Ingredient already exists: ${name}`);
  }

  const timestamp = nowIso(ctx);
  const id = newId("ing");
  const row = ctx.db
    .insert(ingredients)
    .values({
      id,
      householdId: ctx.householdId,
      name,
      normalizedName: normalized,
      description: input.description ?? null,
      category: input.category ?? "other",
      defaultUnit: normalizeUnitInput(input.defaultUnit, "unit"),
      defaultLocation: input.defaultLocation ?? "pantry",
      imageUrl: input.imageUrl ?? null,
      shelfLifeDays: input.shelfLifeDays ?? null,
      isStaple: input.isStaple ?? false,
      parQty: requireParQty(input.parQty),
      parUnit: normalizeUnitInput(input.parUnit, "unit"),
      notes: input.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()
    .get();

  const seen = new Set<string>();
  for (const raw of input.aliases ?? []) {
    const alias = normalizeName(raw);
    if (alias === "" || seen.has(alias)) continue;
    seen.add(alias);
    addAliasIn(ctx, id, raw);
  }

  return ingredientView(ctx, row);
}

/** Create an ingredient (aliases included). Duplicate names/aliases are a conflict. */
export function createIngredient(ctx: Ctx, input: CreateIngredientInput): IngredientView {
  return withTx(ctx, (tx) => createIngredientIn(tx, input));
}

export interface UpdateIngredientInput {
  name?: string;
  description?: string | null;
  category?: IngredientCategory;
  defaultUnit?: string | null;
  defaultLocation?: StorageLocation;
  imageUrl?: string | null;
  shelfLifeDays?: number | null;
  isStaple?: boolean;
  parQty?: number | null;
  parUnit?: string | null;
  notes?: string | null;
}

function updateIngredientIn(
  ctx: Ctx,
  id: string,
  input: UpdateIngredientInput,
): IngredientView {
  const row = requireIngredient(ctx, id);
  const patch: Partial<typeof ingredients.$inferInsert> = {};

  if (input.name !== undefined) {
    const name = input.name.trim().replace(/\s+/g, " ");
    const normalized = normalizeName(input.name);
    if (normalized === "") throw new AppError("validation", "Ingredient name is required");
    const clash = findByNormalizedName(ctx, normalized);
    if (clash && clash.id !== row.id) {
      throw new AppError("conflict", `Ingredient already exists: ${name}`);
    }
    patch.name = name;
    patch.normalizedName = normalized;
  }
  if (input.description !== undefined) patch.description = input.description;
  if (input.category !== undefined) patch.category = input.category;
  if (input.defaultUnit !== undefined) {
    patch.defaultUnit = normalizeUnitInput(input.defaultUnit, "unit");
  }
  if (input.defaultLocation !== undefined) patch.defaultLocation = input.defaultLocation;
  if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl;
  if (input.shelfLifeDays !== undefined) patch.shelfLifeDays = input.shelfLifeDays;
  if (input.isStaple !== undefined) patch.isStaple = input.isStaple;
  if (input.parQty !== undefined) patch.parQty = requireParQty(input.parQty);
  if (input.parUnit !== undefined) {
    patch.parUnit = normalizeUnitInput(input.parUnit, "unit");
  }
  if (input.notes !== undefined) patch.notes = input.notes;

  if (Object.keys(patch).length === 0) return ingredientView(ctx, row);

  patch.updatedAt = nowIso(ctx);
  const updated = ctx.db
    .update(ingredients)
    .set(patch)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, row.id)))
    .returning()
    .get();
  return ingredientView(ctx, updated);
}

/** Partial update; renaming keeps `normalizedName` in sync. */
export function updateIngredient(
  ctx: Ctx,
  id: string,
  input: UpdateIngredientInput,
): IngredientView {
  return withTx(ctx, (tx) => updateIngredientIn(tx, id, input));
}

/** Soft-delete: sets `archivedAt`. History keeps resolving the ingredient. */
export function archiveIngredient(ctx: Ctx, id: string): IngredientView {
  return withTx(ctx, (tx) => {
    const row = requireIngredient(tx, id);
    if (row.archivedAt !== null) return ingredientView(tx, row);
    const updated = tx.db
      .update(ingredients)
      .set({ archivedAt: nowIso(tx), updatedAt: nowIso(tx) })
      .where(and(eq(ingredients.householdId, tx.householdId), eq(ingredients.id, id)))
      .returning()
      .get();
    return ingredientView(tx, updated);
  });
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

function addAliasIn(ctx: Ctx, ingredientId: string, rawAlias: string): IngredientAliasView {
  const ingredient = requireIngredient(ctx, ingredientId);
  const alias = normalizeName(rawAlias);
  if (alias === "") throw new AppError("validation", "Alias is required");
  if (alias === ingredient.normalizedName) {
    throw new AppError("conflict", `Alias duplicates the ingredient name: ${alias}`);
  }
  if (findAliasRow(ctx, alias)) {
    throw new AppError("conflict", `Alias already in use: ${alias}`);
  }
  if (findByNormalizedName(ctx, alias)) {
    throw new AppError("conflict", `Alias conflicts with an ingredient name: ${alias}`);
  }

  return ctx.db
    .insert(ingredientAliases)
    .values({
      id: newId("ali"),
      householdId: ctx.householdId,
      ingredientId: ingredient.id,
      alias,
      createdAt: nowIso(ctx),
    })
    .returning({ id: ingredientAliases.id, alias: ingredientAliases.alias, createdAt: ingredientAliases.createdAt })
    .get();
}

/** Add an alternate name; collisions with names or other aliases are a conflict. */
export function addAlias(ctx: Ctx, ingredientId: string, alias: string): IngredientAliasView {
  return withTx(ctx, (tx) => addAliasIn(tx, ingredientId, alias));
}

/** Remove one of an ingredient's aliases. */
export function removeAlias(ctx: Ctx, ingredientId: string, aliasId: string): void {
  const result = ctx.db
    .delete(ingredientAliases)
    .where(
      and(
        eq(ingredientAliases.householdId, ctx.householdId),
        eq(ingredientAliases.id, aliasId),
        eq(ingredientAliases.ingredientId, ingredientId),
      ),
    )
    .run();
  if (result.changes === 0) {
    throw new AppError("not_found", `Alias not found: ${aliasId}`);
  }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeIngredientsResult {
  ingredient: IngredientView;
  moved: {
    recipeIngredients: number;
    pantryItems: number;
    shoppingItems: number;
    rules: number;
    conversions: number;
    aliases: number;
  };
}

/**
 * Fold `sourceId` into `targetId` in one transaction: recipe ingredients, pantry
 * stock (summed when the target has a row at the same location), shopping items,
 * rules and conversions move over; the source name becomes an alias of the
 * target and the source row is deleted.
 */
export function mergeIngredients(
  ctx: Ctx,
  sourceId: string,
  targetId: string,
): MergeIngredientsResult {
  if (sourceId === targetId) {
    throw new AppError("validation", "Cannot merge an ingredient into itself");
  }
  return withTx(ctx, (tx) => {
    const source = requireIngredient(tx, sourceId);
    const target = requireIngredient(tx, targetId);
    const timestamp = nowIso(tx);

    const recipeIngredientsMoved = tx.db
      .update(recipeIngredients)
      .set({ ingredientId: target.id })
      .where(
        and(
          eq(recipeIngredients.householdId, tx.householdId),
          eq(recipeIngredients.ingredientId, source.id),
        ),
      )
      .run().changes;

    // Pantry: sum at the same location, otherwise move the row.
    const sourceRows = tx.db
      .select()
      .from(pantryItems)
      .where(
        and(
          eq(pantryItems.householdId, tx.householdId),
          eq(pantryItems.ingredientId, source.id),
        ),
      )
      .all();
    const targetRows = tx.db
      .select()
      .from(pantryItems)
      .where(
        and(
          eq(pantryItems.householdId, tx.householdId),
          eq(pantryItems.ingredientId, target.id),
        ),
      )
      .all();
    const targetByLocation = new Map<StorageLocation, typeof pantryItems.$inferSelect>(
      targetRows.map((row) => [row.location, row] as const),
    );

    let pantryItemsMoved = 0;
    for (const src of sourceRows) {
      const dst = targetByLocation.get(src.location);
      if (!dst) {
        tx.db
          .update(pantryItems)
          .set({ ingredientId: target.id, updatedAt: timestamp })
          .where(eq(pantryItems.id, src.id))
          .run();
        pantryItemsMoved += 1;
        continue;
      }

      let qty = dst.qty;
      let unit = dst.unit;
      let changed = false;
      if (qty === null && src.qty !== null) {
        qty = src.qty;
        unit = src.unit;
        changed = true;
      } else if (qty !== null && src.qty !== null) {
        const converted = convert(tx, src.qty, src.unit, unit, target.id);
        if (converted !== null) {
          qty = qty + converted;
          changed = true;
        }
      }
      const status = changed ? statusFor(tx, target, qty, unit) : dst.status;
      tx.db
        .update(pantryItems)
        .set({ qty, unit, status, updatedAt: timestamp })
        .where(eq(pantryItems.id, dst.id))
        .run();
      // Keep the ledger history on the surviving row (movements cascade-delete).
      tx.db
        .update(stockMovements)
        .set({ pantryItemId: dst.id })
        .where(eq(stockMovements.pantryItemId, src.id))
        .run();
      tx.db.delete(pantryItems).where(eq(pantryItems.id, src.id)).run();
      targetByLocation.set(dst.location, { ...dst, qty, unit, status });
      pantryItemsMoved += 1;
    }

    const shoppingItemsMoved = tx.db
      .update(shoppingListItems)
      .set({ ingredientId: target.id })
      .where(
        and(
          eq(shoppingListItems.householdId, tx.householdId),
          eq(shoppingListItems.ingredientId, source.id),
        ),
      )
      .run().changes;
    tx.db
      .update(shoppingListItems)
      .set({ substituteIngredientId: target.id })
      .where(
        and(
          eq(shoppingListItems.householdId, tx.householdId),
          eq(shoppingListItems.substituteIngredientId, source.id),
        ),
      )
      .run();

    const rulesMoved = tx.db
      .update(dietaryRules)
      .set({ ingredientId: target.id, updatedAt: timestamp })
      .where(
        and(
          eq(dietaryRules.householdId, tx.householdId),
          eq(dietaryRules.ingredientId, source.id),
        ),
      )
      .run().changes;

    const sourceConversions = tx.db
      .select()
      .from(unitConversions)
      .where(
        and(
          eq(unitConversions.householdId, tx.householdId),
          eq(unitConversions.ingredientId, source.id),
        ),
      )
      .all();
    let conversionsMoved = 0;
    for (const row of sourceConversions) {
      const clash = tx.db
        .select({ id: unitConversions.id })
        .from(unitConversions)
        .where(
          and(
            eq(unitConversions.householdId, tx.householdId),
            eq(unitConversions.ingredientId, target.id),
            eq(unitConversions.fromUnit, row.fromUnit),
            eq(unitConversions.toUnit, row.toUnit),
          ),
        )
        .get();
      if (clash) {
        tx.db.delete(unitConversions).where(eq(unitConversions.id, row.id)).run();
      } else {
        tx.db
          .update(unitConversions)
          .set({ ingredientId: target.id })
          .where(eq(unitConversions.id, row.id))
          .run();
        conversionsMoved += 1;
      }
    }

    const sourceAliases = tx.db
      .select()
      .from(ingredientAliases)
      .where(
        and(
          eq(ingredientAliases.householdId, tx.householdId),
          eq(ingredientAliases.ingredientId, source.id),
        ),
      )
      .all();
    let aliasesMoved = 0;
    for (const row of sourceAliases) {
      const owner = findAliasRow(tx, row.alias);
      if ((owner && owner.id !== row.id) || row.alias === target.normalizedName) {
        tx.db.delete(ingredientAliases).where(eq(ingredientAliases.id, row.id)).run();
        continue;
      }
      tx.db
        .update(ingredientAliases)
        .set({ ingredientId: target.id })
        .where(eq(ingredientAliases.id, row.id))
        .run();
      aliasesMoved += 1;
    }

    if (
      source.normalizedName !== target.normalizedName &&
      findAliasRow(tx, source.normalizedName) === null
    ) {
      tx.db
        .insert(ingredientAliases)
        .values({
          id: newId("ali"),
          householdId: tx.householdId,
          ingredientId: target.id,
          alias: source.normalizedName,
          createdAt: timestamp,
        })
        .run();
      aliasesMoved += 1;
    }

    tx.db
      .delete(ingredients)
      .where(and(eq(ingredients.householdId, tx.householdId), eq(ingredients.id, source.id)))
      .run();

    return {
      ingredient: ingredientView(tx, target),
      moved: {
        recipeIngredients: recipeIngredientsMoved,
        pantryItems: pantryItemsMoved,
        shoppingItems: shoppingItemsMoved,
        rules: rulesMoved,
        conversions: conversionsMoved,
        aliases: aliasesMoved,
      },
    };
  });
}
