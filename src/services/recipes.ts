import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Ctx } from "../context.js";
import type { Db } from "../db/client.js";
import {
  cookEvents,
  households,
  ingredients,
  recipeIngredients,
  recipeStatusEvents,
  recipeSteps,
  recipes,
  type IngredientCategory,
  type MealType,
  type NutritionInfo,
  type RecipeStatus,
  type SpiceLevel,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { resolveIngredient, type Ingredient } from "./ingredients.js";
import { normalizeUnit } from "./units.js";

export type Recipe = typeof recipes.$inferSelect;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type RecipeStep = typeof recipeSteps.$inferSelect;
export type RecipeStatusEvent = typeof recipeStatusEvents.$inferSelect;

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface RecipeIngredientInput {
  /** Existing ingredient id; alternative to `ingredient`. */
  ingredientId?: string;
  /** Ingredient name; resolved (created when unknown). */
  ingredient?: string;
  /** Category used when the named ingredient has to be created. */
  category?: IngredientCategory;
  qty?: number | null;
  qtyMax?: number | null;
  /** Unit as written; normalized to a canonical unit. */
  unit?: string | null;
  prepNote?: string | null;
  originalText?: string | null;
  optional?: boolean;
  scalingExempt?: boolean;
  groupLabel?: string | null;
}

export interface RecipeStepInput {
  text: string;
  groupLabel?: string | null;
  durationMinutes?: number | null;
  imageUrl?: string | null;
}

export interface CreateRecipeInput {
  title: string;
  slug?: string;
  description?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  author?: string | null;
  imageUrl?: string | null;
  servings?: number;
  yieldText?: string | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  totalMinutes?: number | null;
  spiceLevel?: SpiceLevel | null;
  cuisine?: string | null;
  mealTypes?: MealType[];
  tags?: string[];
  equipment?: string[];
  nutrition?: NutritionInfo | null;
  storageNotes?: string | null;
  leftoverDays?: number | null;
  status?: RecipeStatus;
  rating?: number | null;
  notes?: string | null;
  ingredients?: RecipeIngredientInput[];
  steps?: RecipeStepInput[];
}

/** Patch: only provided fields change; `ingredients`/`steps` replace the full lists. */
export type UpdateRecipeInput = Partial<CreateRecipeInput>;

export interface SearchRecipesInput {
  query?: string;
  status?: RecipeStatus;
  tags?: string[];
  mealType?: MealType;
  ingredientId?: string;
  maxTotalMinutes?: number;
  limit?: number;
  offset?: number;
}

export interface RecipeStats {
  timesCooked: number;
  lastCookedAt: string | null;
}

export interface RecipeIngredientView extends RecipeIngredient {
  ingredient: { id: string; name: string; category: IngredientCategory };
}

export interface RecipeView extends Recipe {
  ingredients: RecipeIngredientView[];
  steps: RecipeStep[];
  stats: RecipeStats;
}

export interface RecipeSummary extends Recipe, RecipeStats {
  ingredientCount: number;
}

export interface RecipeSearchResult {
  items: RecipeSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ScaledIngredient {
  recipeIngredientId: string;
  ingredientId: string;
  ingredientName: string;
  category: IngredientCategory;
  qty: number | null;
  qtyMax: number | null;
  unit: string | null;
  optional: boolean;
  scalingExempt: boolean;
  prepNote: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LAST_COOKED_EXPR = sql<string | null>`max(coalesce(${cookEvents.completedAt}, ${cookEvents.cookDate}))`;

/** Run `fn` inside a database transaction, handing it a ctx bound to the handle. */
function inTransaction<T>(ctx: Ctx, fn: (tx: Ctx) => T): T {
  return ctx.db.transaction((tx) => fn({ ...ctx, db: tx as unknown as Db }));
}

function slugify(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base === "" ? "recipe" : base;
}

function slugTaken(ctx: Ctx, slug: string, excludeId?: string): boolean {
  const where =
    excludeId === undefined
      ? and(eq(recipes.householdId, ctx.householdId), eq(recipes.slug, slug))
      : and(eq(recipes.householdId, ctx.householdId), eq(recipes.slug, slug), ne(recipes.id, excludeId));
  return ctx.db.select({ id: recipes.id }).from(recipes).where(where).get() !== undefined;
}

/** Slug unique per household: base, base-2, base-3, … */
function uniqueSlug(ctx: Ctx, base: string, excludeId?: string): string {
  let candidate = base;
  let attempt = 1;
  while (slugTaken(ctx, candidate, excludeId)) {
    attempt += 1;
    if (attempt > 1000) {
      throw new AppError("conflict", `Could not derive a unique slug from "${base}"`, { slug: base });
    }
    candidate = `${base}-${attempt}`;
  }
  return candidate;
}

function householdDefaultServings(ctx: Ctx): number {
  const row = ctx.db
    .select({ settings: households.settings })
    .from(households)
    .where(eq(households.id, ctx.householdId))
    .get();
  const value = row?.settings.defaultServings;
  return typeof value === "number" && value > 0 ? value : 2;
}

function findRecipe(ctx: Ctx, idOrSlug: string): Recipe {
  const byId = ctx.db
    .select()
    .from(recipes)
    .where(and(eq(recipes.householdId, ctx.householdId), eq(recipes.id, idOrSlug)))
    .get();
  if (byId) return byId;

  const bySlug = ctx.db
    .select()
    .from(recipes)
    .where(and(eq(recipes.householdId, ctx.householdId), eq(recipes.slug, idOrSlug)))
    .get();
  if (bySlug) return bySlug;

  throw new AppError("not_found", `Recipe not found: ${idOrSlug}`, { idOrSlug });
}

function resolveIngredientRef(ctx: Ctx, input: RecipeIngredientInput): Ingredient {
  if (input.ingredientId !== undefined && input.ingredientId !== "") {
    const row = ctx.db
      .select()
      .from(ingredients)
      .where(
        and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, input.ingredientId)),
      )
      .get();
    if (!row) {
      throw new AppError("not_found", `Ingredient not found: ${input.ingredientId}`, {
        ingredientId: input.ingredientId,
      });
    }
    return row;
  }
  if (input.ingredient !== undefined && input.ingredient.trim() !== "") {
    return resolveIngredient(ctx, input.ingredient, {
      create: true,
      ...(input.category === undefined ? {} : { category: input.category }),
    });
  }
  throw new AppError("validation", "Each recipe ingredient needs `ingredientId` or `ingredient`", {
    ingredient: input,
  });
}

function assertQtyRange(qty: number | null, qtyMax: number | null, index: number): void {
  if (qty !== null && qty < 0) {
    throw new AppError("validation", "Ingredient qty cannot be negative", { index, qty });
  }
  if (qtyMax !== null && qtyMax < 0) {
    throw new AppError("validation", "Ingredient qtyMax cannot be negative", { index, qtyMax });
  }
  if (qty !== null && qtyMax !== null && qtyMax < qty) {
    throw new AppError("validation", "Ingredient qtyMax must be greater than or equal to qty", {
      index,
      qty,
      qtyMax,
    });
  }
}

function insertIngredientRows(ctx: Ctx, recipeId: string, inputs: RecipeIngredientInput[]): void {
  if (inputs.length === 0) return;

  const rows = inputs.map((input, index) => {
    const ingredient = resolveIngredientRef(ctx, input);
    const qty = input.qty ?? null;
    const qtyMax = input.qtyMax ?? null;
    assertQtyRange(qty, qtyMax, index);
    return {
      id: newId("ri"),
      householdId: ctx.householdId,
      recipeId,
      ingredientId: ingredient.id,
      qty,
      qtyMax,
      unit: normalizeUnit(input.unit ?? null),
      prepNote: input.prepNote ?? null,
      originalText: input.originalText ?? null,
      optional: input.optional ?? false,
      scalingExempt: input.scalingExempt ?? false,
      groupLabel: input.groupLabel ?? null,
      position: index,
    };
  });

  ctx.db.insert(recipeIngredients).values(rows).run();
}

function insertStepRows(ctx: Ctx, recipeId: string, inputs: RecipeStepInput[]): void {
  if (inputs.length === 0) return;

  const rows = inputs.map((input, index) => {
    const text = input.text.trim();
    if (text === "") {
      throw new AppError("validation", "Recipe step text cannot be empty", { index });
    }
    return {
      id: newId("rs"),
      householdId: ctx.householdId,
      recipeId,
      position: index,
      groupLabel: input.groupLabel ?? null,
      text,
      durationMinutes: input.durationMinutes ?? null,
      imageUrl: input.imageUrl ?? null,
    };
  });

  ctx.db.insert(recipeSteps).values(rows).run();
}

function getStats(ctx: Ctx, recipeId: string): RecipeStats {
  const row = ctx.db
    .select({
      timesCooked: sql<number>`count(*)`,
      lastCookedAt: LAST_COOKED_EXPR,
    })
    .from(cookEvents)
    .where(
      and(
        eq(cookEvents.householdId, ctx.householdId),
        eq(cookEvents.recipeId, recipeId),
        eq(cookEvents.status, "done"),
      ),
    )
    .get();
  return { timesCooked: row?.timesCooked ?? 0, lastCookedAt: row?.lastCookedAt ?? null };
}

function statsForMany(ctx: Ctx, recipeIds: string[]): Map<string, RecipeStats> {
  const stats = new Map<string, RecipeStats>();
  if (recipeIds.length === 0) return stats;

  const rows = ctx.db
    .select({
      recipeId: cookEvents.recipeId,
      timesCooked: sql<number>`count(*)`,
      lastCookedAt: LAST_COOKED_EXPR,
    })
    .from(cookEvents)
    .where(
      and(
        eq(cookEvents.householdId, ctx.householdId),
        eq(cookEvents.status, "done"),
        inArray(cookEvents.recipeId, recipeIds),
      ),
    )
    .groupBy(cookEvents.recipeId)
    .all();

  for (const row of rows) {
    stats.set(row.recipeId, { timesCooked: row.timesCooked, lastCookedAt: row.lastCookedAt });
  }
  return stats;
}

function ingredientCountsForMany(ctx: Ctx, recipeIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (recipeIds.length === 0) return counts;

  const rows = ctx.db
    .select({ recipeId: recipeIngredients.recipeId, n: sql<number>`count(*)` })
    .from(recipeIngredients)
    .where(
      and(
        eq(recipeIngredients.householdId, ctx.householdId),
        inArray(recipeIngredients.recipeId, recipeIds),
      ),
    )
    .groupBy(recipeIngredients.recipeId)
    .all();

  for (const row of rows) counts.set(row.recipeId, row.n);
  return counts;
}

function getIngredientRows(ctx: Ctx, recipeId: string): RecipeIngredientView[] {
  return ctx.db
    .select({
      ri: {
        id: recipeIngredients.id,
        householdId: recipeIngredients.householdId,
        recipeId: recipeIngredients.recipeId,
        ingredientId: recipeIngredients.ingredientId,
        qty: recipeIngredients.qty,
        qtyMax: recipeIngredients.qtyMax,
        unit: recipeIngredients.unit,
        prepNote: recipeIngredients.prepNote,
        originalText: recipeIngredients.originalText,
        optional: recipeIngredients.optional,
        scalingExempt: recipeIngredients.scalingExempt,
        groupLabel: recipeIngredients.groupLabel,
        position: recipeIngredients.position,
      },
      ingredientName: ingredients.name,
      ingredientCategory: ingredients.category,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
    .where(
      and(
        eq(recipeIngredients.householdId, ctx.householdId),
        eq(recipeIngredients.recipeId, recipeId),
      ),
    )
    .orderBy(asc(recipeIngredients.position), asc(recipeIngredients.id))
    .all()
    .map(({ ri, ingredientName, ingredientCategory }) => ({
      ...ri,
      ingredient: { id: ri.ingredientId, name: ingredientName, category: ingredientCategory },
    }));
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createRecipe(ctx: Ctx, input: CreateRecipeInput): RecipeView {
  const title = input.title?.trim() ?? "";
  if (title === "") {
    throw new AppError("validation", "Recipe title is required");
  }
  if (input.servings !== undefined && !(input.servings > 0)) {
    throw new AppError("validation", "Recipe servings must be positive", {
      servings: input.servings,
    });
  }
  if (input.rating != null && (input.rating < 1 || input.rating > 5)) {
    throw new AppError("validation", "Rating must be between 1 and 5", { rating: input.rating });
  }

  return inTransaction(ctx, (tx) => {
    const timestamp = nowIso(tx);
    const prepMinutes = input.prepMinutes ?? null;
    const cookMinutes = input.cookMinutes ?? null;
    const derivedTotal =
      prepMinutes !== null || cookMinutes !== null
        ? (prepMinutes ?? 0) + (cookMinutes ?? 0)
        : null;

    const recipe = tx.db
      .insert(recipes)
      .values({
        id: newId("rcp"),
        householdId: tx.householdId,
        title,
        slug: uniqueSlug(tx, slugify(input.slug ?? title)),
        description: input.description ?? null,
        sourceUrl: input.sourceUrl ?? null,
        sourceName: input.sourceName ?? null,
        author: input.author ?? null,
        imageUrl: input.imageUrl ?? null,
        servings: input.servings ?? householdDefaultServings(tx),
        yieldText: input.yieldText ?? null,
        prepMinutes,
        cookMinutes,
        totalMinutes: input.totalMinutes === undefined ? derivedTotal : input.totalMinutes,
        spiceLevel: input.spiceLevel ?? null,
        cuisine: input.cuisine ?? null,
        mealTypes: input.mealTypes ?? [],
        tags: input.tags ?? [],
        equipment: input.equipment ?? [],
        nutrition: input.nutrition ?? null,
        storageNotes: input.storageNotes ?? null,
        leftoverDays: input.leftoverDays ?? null,
        status: input.status ?? "want_to_try",
        rating: input.rating ?? null,
        notes: input.notes ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
      .get();

    insertIngredientRows(tx, recipe.id, input.ingredients ?? []);
    insertStepRows(tx, recipe.id, input.steps ?? []);

    tx.db
      .insert(recipeStatusEvents)
      .values({
        id: newId("rse"),
        householdId: tx.householdId,
        recipeId: recipe.id,
        status: recipe.status,
        rating: recipe.rating,
        note: null,
        createdAt: timestamp,
      })
      .run();

    return getRecipe(tx, recipe.id);
  });
}

export function updateRecipe(ctx: Ctx, id: string, patch: UpdateRecipeInput): RecipeView {
  return inTransaction(ctx, (tx) => {
    const existing = findRecipe(tx, id);

    if (patch.title !== undefined && patch.title.trim() === "") {
      throw new AppError("validation", "Recipe title cannot be empty");
    }
    if (patch.servings !== undefined && !(patch.servings > 0)) {
      throw new AppError("validation", "Recipe servings must be positive", {
        servings: patch.servings,
      });
    }
    if (patch.rating != null && (patch.rating < 1 || patch.rating > 5)) {
      throw new AppError("validation", "Rating must be between 1 and 5", { rating: patch.rating });
    }

    const values: Partial<typeof recipes.$inferInsert> = { updatedAt: nowIso(tx) };

    if (patch.title !== undefined) values.title = patch.title.trim();
    if (patch.slug !== undefined) {
      values.slug = uniqueSlug(tx, slugify(patch.slug), existing.id);
    }
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.sourceUrl !== undefined) values.sourceUrl = patch.sourceUrl;
    if (patch.sourceName !== undefined) values.sourceName = patch.sourceName;
    if (patch.author !== undefined) values.author = patch.author;
    if (patch.imageUrl !== undefined) values.imageUrl = patch.imageUrl;
    if (patch.servings !== undefined) values.servings = patch.servings;
    if (patch.yieldText !== undefined) values.yieldText = patch.yieldText;
    if (patch.prepMinutes !== undefined) values.prepMinutes = patch.prepMinutes;
    if (patch.cookMinutes !== undefined) values.cookMinutes = patch.cookMinutes;
    if (patch.totalMinutes !== undefined) {
      values.totalMinutes = patch.totalMinutes;
    } else if (patch.prepMinutes !== undefined || patch.cookMinutes !== undefined) {
      const prep = patch.prepMinutes !== undefined ? patch.prepMinutes : existing.prepMinutes;
      const cook = patch.cookMinutes !== undefined ? patch.cookMinutes : existing.cookMinutes;
      if (existing.totalMinutes === null && (prep !== null || cook !== null)) {
        values.totalMinutes = (prep ?? 0) + (cook ?? 0);
      }
    }
    if (patch.spiceLevel !== undefined) values.spiceLevel = patch.spiceLevel;
    if (patch.cuisine !== undefined) values.cuisine = patch.cuisine;
    if (patch.mealTypes !== undefined) values.mealTypes = patch.mealTypes;
    if (patch.tags !== undefined) values.tags = patch.tags;
    if (patch.equipment !== undefined) values.equipment = patch.equipment;
    if (patch.nutrition !== undefined) values.nutrition = patch.nutrition;
    if (patch.storageNotes !== undefined) values.storageNotes = patch.storageNotes;
    if (patch.leftoverDays !== undefined) values.leftoverDays = patch.leftoverDays;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.rating !== undefined) values.rating = patch.rating;
    if (patch.notes !== undefined) values.notes = patch.notes;

    const updated = tx.db
      .update(recipes)
      .set(values)
      .where(and(eq(recipes.householdId, tx.householdId), eq(recipes.id, existing.id)))
      .returning()
      .get();

    if (patch.ingredients !== undefined) {
      tx.db
        .delete(recipeIngredients)
        .where(
          and(
            eq(recipeIngredients.householdId, tx.householdId),
            eq(recipeIngredients.recipeId, existing.id),
          ),
        )
        .run();
      insertIngredientRows(tx, existing.id, patch.ingredients);
    }

    if (patch.steps !== undefined) {
      tx.db
        .delete(recipeSteps)
        .where(
          and(eq(recipeSteps.householdId, tx.householdId), eq(recipeSteps.recipeId, existing.id)),
        )
        .run();
      insertStepRows(tx, existing.id, patch.steps);
    }

    if (patch.status !== undefined && patch.status !== existing.status) {
      tx.db
        .insert(recipeStatusEvents)
        .values({
          id: newId("rse"),
          householdId: tx.householdId,
          recipeId: existing.id,
          status: patch.status,
          rating: updated.rating,
          note: null,
          createdAt: nowIso(tx),
        })
        .run();
    }

    return getRecipe(tx, existing.id);
  });
}

/** Recipe with ingredients (ordered, nested ingredient), steps and cook stats. */
export function getRecipe(ctx: Ctx, id: string): RecipeView {
  const recipe = findRecipe(ctx, id);
  return {
    ...recipe,
    ingredients: getIngredientRows(ctx, recipe.id),
    steps: ctx.db
      .select()
      .from(recipeSteps)
      .where(
        and(eq(recipeSteps.householdId, ctx.householdId), eq(recipeSteps.recipeId, recipe.id)),
      )
      .orderBy(asc(recipeSteps.position), asc(recipeSteps.id))
      .all(),
    stats: getStats(ctx, recipe.id),
  };
}

export function searchRecipes(ctx: Ctx, input: SearchRecipesInput = {}): RecipeSearchResult {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(input.offset ?? 0), 0);

  const conditions = [eq(recipes.householdId, ctx.householdId)];

  const needle = input.query?.trim().toLowerCase() ?? "";
  if (needle !== "") {
    conditions.push(
      sql`(instr(lower(${recipes.title}), ${needle}) > 0
        or instr(lower(coalesce(${recipes.description}, '')), ${needle}) > 0
        or instr(lower(${recipes.tags}), ${needle}) > 0)`,
    );
  }

  if (input.status !== undefined) conditions.push(eq(recipes.status, input.status));

  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag !== "");
  if (tags.length > 0) {
    const values = sql.join(
      tags.map((tag) => sql`${tag.toLowerCase()}`),
      sql`, `,
    );
    conditions.push(
      sql`exists (select 1 from json_each(${recipes.tags}) je where lower(je.value) in (${values}))`,
    );
  }

  if (input.mealType !== undefined) {
    conditions.push(
      sql`exists (select 1 from json_each(${recipes.mealTypes}) je where je.value = ${input.mealType})`,
    );
  }

  if (input.ingredientId !== undefined) {
    const usingIngredient = ctx.db
      .select({ id: recipeIngredients.recipeId })
      .from(recipeIngredients)
      .where(
        and(
          eq(recipeIngredients.householdId, ctx.householdId),
          eq(recipeIngredients.ingredientId, input.ingredientId),
        ),
      );
    conditions.push(inArray(recipes.id, usingIngredient));
  }

  if (input.maxTotalMinutes !== undefined) {
    conditions.push(
      sql`coalesce(${recipes.totalMinutes}, ${recipes.prepMinutes} + ${recipes.cookMinutes}) <= ${input.maxTotalMinutes}`,
    );
  }

  const where = and(...conditions);

  const total =
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(recipes)
      .where(where)
      .get()?.n ?? 0;

  const rows = ctx.db
    .select()
    .from(recipes)
    .where(where)
    .orderBy(sql`lower(${recipes.title}) asc`, sql`${recipes.id} asc`)
    .limit(limit)
    .offset(offset)
    .all();

  const ids = rows.map((row) => row.id);
  const stats = statsForMany(ctx, ids);
  const counts = ingredientCountsForMany(ctx, ids);

  return {
    items: rows.map((row) => {
      const rowStats = stats.get(row.id) ?? { timesCooked: 0, lastCookedAt: null };
      return {
        ...row,
        ingredientCount: counts.get(row.id) ?? 0,
        timesCooked: rowStats.timesCooked,
        lastCookedAt: rowStats.lastCookedAt,
      };
    }),
    total,
    limit,
    offset,
  };
}

export interface SetRecipeStatusInput {
  status: RecipeStatus;
  rating?: number | null;
  note?: string | null;
}

/**
 * Update the recipe status (and optional rating) and append a status event.
 */
export function setRecipeStatus(
  ctx: Ctx,
  id: string,
  input: SetRecipeStatusInput,
): { recipe: RecipeView; event: RecipeStatusEvent } {
  if (input.rating != null && (input.rating < 1 || input.rating > 5)) {
    throw new AppError("validation", "Rating must be between 1 and 5", { rating: input.rating });
  }

  return inTransaction(ctx, (tx) => {
    const existing = findRecipe(tx, id);

    const updated = tx.db
      .update(recipes)
      .set({
        status: input.status,
        ...(input.rating === undefined ? {} : { rating: input.rating }),
        updatedAt: nowIso(tx),
      })
      .where(and(eq(recipes.householdId, tx.householdId), eq(recipes.id, existing.id)))
      .returning()
      .get();

    const event = tx.db
      .insert(recipeStatusEvents)
      .values({
        id: newId("rse"),
        householdId: tx.householdId,
        recipeId: existing.id,
        status: input.status,
        rating: input.rating === undefined ? updated.rating : input.rating,
        note: input.note ?? null,
        createdAt: nowIso(tx),
      })
      .returning()
      .get();

    return { recipe: getRecipe(tx, existing.id), event };
  });
}

/** Newest first. */
export function listStatusHistory(
  ctx: Ctx,
  recipeId: string,
): { items: RecipeStatusEvent[] } {
  const recipe = findRecipe(ctx, recipeId);
  const items = ctx.db
    .select()
    .from(recipeStatusEvents)
    .where(
      and(
        eq(recipeStatusEvents.householdId, ctx.householdId),
        eq(recipeStatusEvents.recipeId, recipe.id),
      ),
    )
    .orderBy(desc(recipeStatusEvents.createdAt), desc(recipeStatusEvents.id))
    .all();
  return { items };
}

/**
 * Delete a recipe. Recipes referenced by cook events are protected: archive them
 * (set status "archived") instead so cooking history stays intact.
 */
export function deleteRecipe(ctx: Ctx, id: string): { deleted: true; id: string } {
  return inTransaction(ctx, (tx) => {
    const recipe = findRecipe(tx, id);
    const cookEventCount =
      tx.db
        .select({ n: sql<number>`count(*)` })
        .from(cookEvents)
        .where(
          and(eq(cookEvents.householdId, tx.householdId), eq(cookEvents.recipeId, recipe.id)),
        )
        .get()?.n ?? 0;

    if (cookEventCount > 0) {
      throw new AppError(
        "conflict",
        `Recipe "${recipe.title}" is referenced by ${cookEventCount} cook event(s); archive it instead (set status to "archived").`,
        { cookEventCount },
      );
    }

    tx.db
      .delete(recipes)
      .where(and(eq(recipes.householdId, tx.householdId), eq(recipes.id, recipe.id)))
      .run();
    return { deleted: true as const, id: recipe.id };
  });
}

/**
 * Scale a recipe's ingredients to `servings`. `scalingExempt` ingredients and
 * ingredients without a quantity are returned untouched.
 */
export function scaleRecipeIngredients(
  ctx: Ctx,
  recipeId: string,
  servings: number,
): ScaledIngredient[] {
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new AppError("validation", "servings must be a positive number", { servings });
  }

  const recipe = findRecipe(ctx, recipeId);
  const factor = recipe.servings > 0 ? servings / recipe.servings : 1;

  return getIngredientRows(ctx, recipe.id).map((row) => {
    const unscaled = row.scalingExempt || row.qty === null;
    return {
      recipeIngredientId: row.id,
      ingredientId: row.ingredientId,
      ingredientName: row.ingredient.name,
      category: row.ingredient.category,
      qty: unscaled || row.qty === null ? row.qty : row.qty * factor,
      qtyMax:
        unscaled || row.qtyMax === null
          ? row.qtyMax
          : row.qtyMax * factor,
      unit: row.unit,
      optional: row.optional,
      scalingExempt: row.scalingExempt,
      prepNote: row.prepNote,
    };
  });
}
