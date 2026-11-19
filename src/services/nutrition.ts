import { and, asc, eq, isNull } from "drizzle-orm";
import type { Ctx } from "../context.js";
import type { Db } from "../db/client.js";
import { ingredients, recipeIngredients, recipes } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import {
  NUTRITION_SOURCE,
  autoMatchFood,
  getFood,
  searchFoods,
  type Food,
  type Nutrients,
} from "./foods.js";
import { suggestedNameForFood } from "./ingredientNames.js";
import { getIngredient, requireIngredient, type IngredientView } from "./ingredients.js";
import { resolveRecipeId } from "./recipes.js";
import { convert } from "./units.js";

const NUTRIENT_KEYS = ["calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium"] as const;

const round = (value: number): number => Math.round(value * 100) / 100;

function emptyNutrients(): Nutrients {
  return { calories: null, protein: null, carbs: null, fat: null, fiber: null, sugar: null, sodium: null };
}

// ---------------------------------------------------------------------------
// Food search
// ---------------------------------------------------------------------------

export interface FoodSearchResult extends Food {
  score: number;
  /** Friendly ingredient name for this food ("Onions, raw" → "Onion"). */
  suggestedName: string;
}

/** Search the bundled USDA foods, best match first. */
export function searchFoodList(query: string, limit = 10): FoodSearchResult[] {
  return searchFoods(query, limit).map((match) => ({
    ...match.food,
    score: match.score,
    suggestedName: suggestedNameForFood(match.food.description),
  }));
}

// ---------------------------------------------------------------------------
// Ingredient matching
// ---------------------------------------------------------------------------

export type SetIngredientNutritionInput =
  | { mode: "auto" }
  | { mode: "manual"; fdcId: number | null };

/**
 * Re-run the automatic name match (`auto`) or pin a USDA food (`manual`; a null
 * `fdcId` clears the match and stops future auto-matching for this ingredient).
 * Linking a food clears the ingredient's review flag; a default portion the new food
 * does not have is dropped.
 */
export function setIngredientNutrition(
  ctx: Ctx,
  ingredientId: string,
  input: SetIngredientNutritionInput,
): IngredientView {
  const row = requireIngredient(ctx, ingredientId);
  let fdcId: number | null;
  if (input.mode === "auto") {
    fdcId = autoMatchFood(row.name)?.fdcId ?? null;
  } else {
    fdcId = input.fdcId;
    if (fdcId !== null && getFood(fdcId) === null) {
      throw new AppError("not_found", `Unknown USDA food: ${fdcId}`, { fdcId });
    }
  }
  const portion = row.defaultPortion?.toLowerCase();
  const keepsPortion =
    portion !== undefined &&
    fdcId !== null &&
    getFood(fdcId)?.portions.some((item) => item.label.toLowerCase() === portion) === true;
  ctx.db
    .update(ingredients)
    .set({
      nutritionFdcId: fdcId,
      nutritionSource: input.mode === "auto" ? "auto" : "manual",
      ...(fdcId === null ? {} : { needsReview: false }),
      ...(keepsPortion ? {} : { defaultPortion: null }),
      updatedAt: nowIso(ctx),
    })
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, row.id)))
    .run();
  return getIngredient(ctx, row.id);
}

/**
 * Auto-match every ingredient that was never matched (source null), across all
 * households. Returns how many rows were processed.
 */
export function backfillNutritionMatches(db: Db): number {
  const rows = db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(isNull(ingredients.nutritionSource))
    .all();
  if (rows.length === 0) return 0;
  db.transaction((tx) => {
    for (const row of rows) {
      const fdcId = autoMatchFood(row.name)?.fdcId ?? null;
      tx.update(ingredients)
        .set({ nutritionFdcId: fdcId, nutritionSource: "auto", ...(fdcId === null ? {} : { needsReview: false }) })
        .where(eq(ingredients.id, row.id))
        .run();
    }
  });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Recipe nutrition
// ---------------------------------------------------------------------------

export type NutritionLineStatus = "ok" | "optional" | "no_match" | "no_quantity" | "no_conversion";

export interface RecipeNutritionLine {
  recipeIngredientId: string;
  ingredientId: string;
  name: string;
  qty: number | null;
  qtyMax: number | null;
  unit: string | null;
  grams: number | null;
  food: { fdcId: number; description: string } | null;
  nutrients: Nutrients | null;
  status: NutritionLineStatus;
  /** For `no_conversion`: what to add so the line counts, e.g. "Add a measure: 1 cup = ? g". */
  hint?: string;
}

export interface RecipeNutrition {
  recipeId: string;
  servings: number | null;
  total: Nutrients;
  perServing: Nutrients | null;
  countedLines: number;
  missingLines: number;
  source: string;
  lines: RecipeNutritionLine[];
}

/** Nutrition for a whole recipe and per serving; lines that cannot be computed stay blank. */
export function getRecipeNutrition(ctx: Ctx, idOrSlug: string): RecipeNutrition {
  const recipeId = resolveRecipeId(ctx, idOrSlug);
  const recipe = ctx.db
    .select({ servings: recipes.servings })
    .from(recipes)
    .where(and(eq(recipes.householdId, ctx.householdId), eq(recipes.id, recipeId)))
    .get();
  const rows = ctx.db
    .select({
      line: recipeIngredients,
      name: ingredients.name,
      fdcId: ingredients.nutritionFdcId,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
    .where(
      and(eq(recipeIngredients.householdId, ctx.householdId), eq(recipeIngredients.recipeId, recipeId)),
    )
    .orderBy(asc(recipeIngredients.position))
    .all();

  const sums = emptyNutrients();
  let counted = 0;
  let missing = 0;

  const lines = rows.map(({ line, name, fdcId }): RecipeNutritionLine => {
    const food = fdcId === null ? null : getFood(fdcId);
    const base = {
      recipeIngredientId: line.id,
      ingredientId: line.ingredientId,
      name,
      qty: line.qty,
      qtyMax: line.qtyMax,
      unit: line.unit,
      grams: null as number | null,
      food: food === null ? null : { fdcId: food.fdcId, description: food.description },
      nutrients: null as Nutrients | null,
    };
    if (line.optional) return { ...base, status: "optional" };

    const done = (status: NutritionLineStatus): RecipeNutritionLine => {
      missing += 1;
      return { ...base, status };
    };
    if (line.qty === null) return done("no_quantity");
    if (food === null) return done("no_match");

    const qty = line.qtyMax === null ? line.qty : (line.qty + line.qtyMax) / 2;
    const grams = convert(ctx, qty, line.unit, "g", line.ingredientId);
    if (grams === null) {
      missing += 1;
      return { ...base, status: "no_conversion", hint: `Add a measure: 1 ${line.unit ?? "count"} = ? g` };
    }

    const nutrients = emptyNutrients();
    for (const key of NUTRIENT_KEYS) {
      const per100 = food.per100g[key];
      if (per100 === null) continue;
      const amount = (per100 * grams) / 100;
      nutrients[key] = round(amount);
      sums[key] = (sums[key] ?? 0) + amount;
    }
    counted += 1;
    return { ...base, grams: round(grams), nutrients, status: "ok" };
  });

  const total = emptyNutrients();
  const perServing = emptyNutrients();
  const servings = recipe?.servings ?? null;
  for (const key of NUTRIENT_KEYS) {
    const sum = sums[key];
    total[key] = sum === null ? null : round(sum);
    perServing[key] = sum === null || servings === null || servings <= 0 ? null : round(sum / servings);
  }

  return {
    recipeId,
    servings,
    total,
    perServing: servings === null || servings <= 0 ? null : perServing,
    countedLines: counted,
    missingLines: missing,
    source: NUTRITION_SOURCE,
    lines,
  };
}
