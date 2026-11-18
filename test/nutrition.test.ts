import { describe, expect, it, vi } from "vitest";
import type { Food, Nutrients } from "../src/services/foods.js";

// Deterministic fake dataset; `gramsFor` stays the real implementation.
vi.mock("../src/services/foods.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/foods.js")>();
  const n = (calories: number, protein: number, carbs: number, fat: number): Nutrients => ({
    calories,
    protein,
    carbs,
    fat,
    fiber: null,
    sugar: null,
    sodium: null,
  });
  const foods: Food[] = [
    { fdcId: 1, description: "Rice, white, raw", dataType: "sr_legacy", per100g: n(360, 7, 80, 1), portions: [] },
    {
      fdcId: 2,
      description: "Wheat flour, white",
      dataType: "sr_legacy",
      per100g: { ...n(364, 10, 76, 1), fiber: 2.7 },
      portions: [{ label: "cup", grams: 125 }],
    },
    {
      fdcId: 3,
      description: "Onions, raw",
      dataType: "sr_legacy",
      per100g: n(40, 1, 9, 0),
      portions: [{ label: "medium", grams: 110 }],
    },
    { fdcId: 4, description: "Tomatoes, canned", dataType: "sr_legacy", per100g: n(20, 1, 4, 0), portions: [] },
    { fdcId: 5, description: "Beans, black", dataType: "sr_legacy", per100g: n(340, 21, 62, 1), portions: [] },
  ];
  const byName: Record<string, number> = {
    rice: 1,
    flour: 2,
    onion: 3,
    "canned tomatoes": 4,
    "salt substitute": 5,
  };
  return {
    ...actual,
    NUTRITION_SOURCE: "test data",
    getFood: (id: number) => foods.find((food) => food.fdcId === id) ?? null,
    autoMatchFood: (name: string) =>
      foods.find((food) => food.fdcId === byName[name.trim().toLowerCase()]) ?? null,
    searchFoods: (query: string, limit = 10) =>
      foods
        .filter((food) => food.description.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit)
        .map((food) => ({ food, score: 0.9 })),
  };
});

const { backfillNutritionMatches, getRecipeNutrition, setIngredientNutrition } = await import(
  "../src/services/nutrition.js"
);
const { createIngredient, getIngredient, mergeIngredients, updateIngredient } = await import(
  "../src/services/ingredients.js"
);
const { createRecipe } = await import("../src/services/recipes.js");
const { createConversion } = await import("../src/services/units.js");
const { ingredients } = await import("../src/db/schema.js");
const { makeTestApp, makeTestCtx } = await import("./helpers.js");

describe("recipe nutrition", () => {
  it("computes mass, volume, count and household-converted lines", () => {
    const { ctx } = makeTestCtx();
    const tomatoes = createIngredient(ctx, { name: "Canned tomatoes" });
    createConversion(ctx, { ingredientId: tomatoes.id, fromUnit: "can", toUnit: "g", factor: 400 });

    const recipe = createRecipe(ctx, {
      title: "Everything",
      servings: 4,
      ingredients: [
        { ingredient: "Rice", qty: 200, unit: "g" },
        { ingredient: "Flour", qty: 2, unit: "cup" },
        { ingredient: "Onion", qty: 2, unit: "each" },
        { ingredient: "Canned tomatoes", qty: 1, unit: "can" },
      ],
    });
    const result = getRecipeNutrition(ctx, recipe.id);

    expect(result.source).toBe("test data");
    expect(result.lines.map((line) => line.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(result.lines.map((line) => line.grams)).toEqual([200, 250, 220, 400]);
    expect(result.lines[0]!.nutrients!.calories).toBeCloseTo(720);
    expect(result.lines[3]!.food).toEqual({ fdcId: 4, description: "Tomatoes, canned" });
    // 720 + 910 + 88 + 80
    expect(result.total.calories).toBeCloseTo(1798);
    expect(result.total.fiber).toBeCloseTo(6.75); // only flour has fiber
    expect(result.total.sodium).toBeNull();
    expect(result.countedLines).toBe(4);
    expect(result.missingLines).toBe(0);
    expect(result.servings).toBe(4);
    expect(result.perServing!.calories).toBeCloseTo(449.5);
    expect(result.perServing!.sodium).toBeNull();
  });

  it("leaves unmatched, quantity-less and unconvertible lines blank and skips optional lines", () => {
    const { ctx } = makeTestCtx();
    const recipe = createRecipe(ctx, {
      title: "Gaps",
      servings: 2,
      ingredients: [
        { ingredient: "Rice", qty: 100, unit: "g" },
        { ingredient: "Milk or water", qty: 1, unit: "cup" },
        { ingredient: "Flour", qty: null },
        { ingredient: "Onion", qty: 1, unit: "bunch" },
        { ingredient: "Rice", qty: 500, unit: "g", optional: true },
      ],
    });
    const result = getRecipeNutrition(ctx, recipe.slug);

    expect(result.lines.map((line) => line.status)).toEqual([
      "ok",
      "no_match",
      "no_quantity",
      "no_conversion",
      "optional",
    ]);
    expect(result.lines[1]).toMatchObject({ food: null, nutrients: null, grams: null });
    expect(result.lines[4]!.nutrients).toBeNull();
    expect(result.countedLines).toBe(1);
    expect(result.missingLines).toBe(3);
    expect(result.total.calories).toBeCloseTo(360);
    expect(result.perServing!.calories).toBeCloseTo(180);
  });

  it("uses the midpoint of a quantity range", () => {
    const { ctx } = makeTestCtx();
    const recipe = createRecipe(ctx, {
      title: "Range",
      servings: 1,
      ingredients: [{ ingredient: "Rice", qty: 100, qtyMax: 200, unit: "g" }],
    });
    const result = getRecipeNutrition(ctx, recipe.id);
    expect(result.lines[0]!.grams).toBe(150);
    expect(result.total.calories).toBeCloseTo(540);
  });

  it("gives null totals when nothing is countable", () => {
    const { ctx } = makeTestCtx();
    const recipe = createRecipe(ctx, {
      title: "Nothing",
      servings: 2,
      ingredients: [{ ingredient: "Mystery", qty: 1, unit: "g" }],
    });
    const result = getRecipeNutrition(ctx, recipe.id);
    expect(result.total.calories).toBeNull();
    expect(result.perServing!.calories).toBeNull();
    expect(result.countedLines).toBe(0);
    expect(result.missingLines).toBe(1);
  });
});

describe("ingredient nutrition matching", () => {
  it("auto-matches on create and rename, and exposes it in the view", () => {
    const { ctx } = makeTestCtx();
    const rice = createIngredient(ctx, { name: "Rice" });
    expect(rice.nutrition).toMatchObject({ source: "auto", fdcId: 1, description: "Rice, white, raw" });
    expect(rice.nutrition!.per100g!.calories).toBe(360);

    const unknown = createIngredient(ctx, { name: "Diced tomatoes with green chilies" });
    expect(unknown.nutrition).toBeNull();

    const renamed = updateIngredient(ctx, unknown.id, { name: "Flour" });
    expect(renamed.nutrition).toMatchObject({ source: "auto", fdcId: 2 });
  });

  it("manual override and clear stick across rename", () => {
    const { ctx } = makeTestCtx();
    const rice = createIngredient(ctx, { name: "Rice" });

    const pinned = setIngredientNutrition(ctx, rice.id, { mode: "manual", fdcId: 5 });
    expect(pinned.nutrition).toMatchObject({ source: "manual", fdcId: 5 });
    expect(updateIngredient(ctx, rice.id, { name: "Onion" }).nutrition).toMatchObject({
      source: "manual",
      fdcId: 5,
    });

    const cleared = setIngredientNutrition(ctx, rice.id, { mode: "manual", fdcId: null });
    expect(cleared.nutrition).toEqual({ source: "manual", fdcId: null, description: null, per100g: null });
    expect(updateIngredient(ctx, rice.id, { name: "Flour" }).nutrition?.fdcId).toBeNull();

    const auto = setIngredientNutrition(ctx, rice.id, { mode: "auto" });
    expect(auto.nutrition).toMatchObject({ source: "auto", fdcId: 2 });

    expect(() => setIngredientNutrition(ctx, rice.id, { mode: "manual", fdcId: 999 })).toThrow(
      /Unknown USDA food/,
    );
  });

  it("backfills only never-matched rows", () => {
    const { ctx, db } = makeTestCtx();
    const rice = createIngredient(ctx, { name: "Rice" });
    const manual = createIngredient(ctx, { name: "Onion" });
    setIngredientNutrition(ctx, manual.id, { mode: "manual", fdcId: null });
    db.update(ingredients).set({ nutritionFdcId: null, nutritionSource: null }).run();
    setIngredientNutrition(ctx, manual.id, { mode: "manual", fdcId: null });

    expect(backfillNutritionMatches(db)).toBe(1);
    expect(getIngredient(ctx, rice.id).nutrition).toMatchObject({ source: "auto", fdcId: 1 });
    expect(getIngredient(ctx, manual.id).nutrition).toMatchObject({ source: "manual", fdcId: null });
    expect(backfillNutritionMatches(db)).toBe(0);
  });

  it("merge keeps the target match and carries over the source's when the target has none", () => {
    const { ctx } = makeTestCtx();
    const target = createIngredient(ctx, { name: "Spring rice" });
    const source = createIngredient(ctx, { name: "Rice" });
    expect(target.nutrition).toBeNull();
    expect(mergeIngredients(ctx, source.id, target.id).ingredient.nutrition).toMatchObject({ fdcId: 1 });

    const keep = createIngredient(ctx, { name: "Flour" });
    const other = createIngredient(ctx, { name: "Onion" });
    expect(mergeIngredients(ctx, other.id, keep.id).ingredient.nutrition).toMatchObject({ fdcId: 2 });
  });
});

describe("nutrition API", () => {
  it("serves foods, ingredient matching and recipe nutrition", async () => {
    const t = makeTestApp();
    const ing = createIngredient(t.ctx, { name: "Rice" });
    const recipe = createRecipe(t.ctx, {
      title: "Rice bowl",
      servings: 2,
      ingredients: [{ ingredient: "Rice", qty: 200, unit: "g" }],
    });

    const foods = await t.request<{ items: { fdcId: number; score: number }[] }>(
      "GET",
      "/api/v1/nutrition/foods?q=onions&limit=3",
    );
    expect(foods.status).toBe(200);
    expect(foods.body.items).toMatchObject([{ fdcId: 3, score: 0.9 }]);

    const put = await t.request<{ nutrition: { source: string; fdcId: number } }>(
      "PUT",
      `/api/v1/ingredients/${ing.id}/nutrition`,
      { mode: "manual", fdcId: 5 },
    );
    expect(put.status).toBe(200);
    expect(put.body.nutrition).toMatchObject({ source: "manual", fdcId: 5 });
    expect((await t.request("PUT", `/api/v1/ingredients/${ing.id}/nutrition`, { mode: "bogus" })).status).toBe(400);

    const nutrition = await t.request<{ perServing: Nutrients; countedLines: number }>(
      "GET",
      `/api/v1/recipes/${recipe.slug}/nutrition`,
    );
    expect(nutrition.status).toBe(200);
    expect(nutrition.body.countedLines).toBe(1);
    expect(nutrition.body.perServing.calories).toBeCloseTo(340);
  });
});
