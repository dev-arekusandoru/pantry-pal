import { describe, expect, it, vi } from "vitest";
import type { Food, Nutrients } from "../src/services/foods.js";

// A tiny USDA stand-in: spinach with only a cup measure, a second spinach with a borrowed cup, a food with no portions.
vi.mock("../src/services/foods.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/foods.js")>();
  const n = (calories: number): Nutrients => ({
    calories,
    protein: null,
    carbs: null,
    fat: null,
    fiber: null,
    sugar: null,
    sodium: null,
  });
  const foods: Food[] = [
    {
      fdcId: 10,
      description: "Spinach, baby, raw",
      dataType: "foundation",
      per100g: n(20),
      portions: [{ label: "cup", grams: 30, unit: "cup", estimated: false }],
    },
    {
      fdcId: 11,
      description: "Spinach, mature, raw",
      dataType: "foundation",
      per100g: n(25),
      portions: [{ label: "cup", grams: 60, unit: "cup", estimated: true }],
    },
    { fdcId: 12, description: "Rice, white, raw", dataType: "sr_legacy", per100g: n(360), portions: [] },
    {
      fdcId: 13,
      description: "Egg, whole, raw",
      dataType: "sr_legacy",
      per100g: n(140),
      portions: [
        { label: "large", grams: 50, unit: "large", estimated: false },
        { label: "medium", grams: 44, unit: "medium", estimated: false },
      ],
    },
  ];
  return {
    ...actual,
    NUTRITION_SOURCE: "test data",
    getFood: (id: number) => foods.find((food) => food.fdcId === id) ?? null,
    autoMatchFood: () => null,
    searchFoods: () => [],
  };
});

const { completeCookEvent } = await import("../src/services/cooking.js");
const { computeDemand } = await import("../src/services/demand.js");
const { createIngredient, getIngredient, listIngredientsForReview, updateIngredient } = await import(
  "../src/services/ingredients.js"
);
const { getRecipeNutrition, setIngredientNutrition } = await import("../src/services/nutrition.js");
const { setStock } = await import("../src/services/pantry.js");
const { addCookEvent, createPlan } = await import("../src/services/plans.js");
const { createRecipe } = await import("../src/services/recipes.js");
const { convert, deleteMeasure, listMeasures, setMeasure } = await import("../src/services/units.js");
const { makeTestApp, makeTestCtx } = await import("./helpers.js");

const OZ_IN_G = 28.349523125;

interface UnresolvedBody {
  error: {
    code: string;
    details: {
      unresolvedUnits: Array<{ unit: string; ingredientId: string; suggestions: string[]; hint: string }>;
    };
  };
}

describe("measures from the linked USDA food", () => {
  it("a food with only a cup measure gives nutrition for cups and converts pantry stock in ounces", () => {
    const { ctx } = makeTestCtx();
    const spinach = createIngredient(ctx, { fdcId: 10, name: "Baby Spinach" });
    setStock(ctx, { ingredientId: spinach.id, qty: 5, unit: "oz" });
    const recipe = createRecipe(ctx, {
      title: "Spinach Salad",
      servings: 2,
      ingredients: [{ ingredientId: spinach.id, qty: 3, unit: "cup" }],
    });

    const nutrition = getRecipeNutrition(ctx, recipe.id);
    expect(nutrition.lines[0]).toMatchObject({ status: "ok", grams: 90 });
    expect(nutrition.total.calories).toBeCloseTo(18);

    const plan = createPlan(ctx, { weekStart: "2026-11-02" });
    const event = addCookEvent(ctx, plan.id, { recipeId: recipe.id, cookDate: "2026-11-03", plannedServings: 2 });

    // Shopping demand is in the stock unit.
    const demand = computeDemand(ctx, { mealPlanId: plan.id });
    expect(demand[0]).toMatchObject({ ingredientId: spinach.id, unit: "oz" });
    expect(demand[0]!.qty).toBeCloseTo(90 / OZ_IN_G, 3);
    expect(demand[0]!.unconvertible).toEqual([]);

    const completed = completeCookEvent(ctx, event.id);
    expect(completed.warnings).toEqual([]);
    const row = getIngredient(ctx, spinach.id).pantry[0]!;
    expect(row.unit).toBe("oz");
    expect(row.qty).toBeCloseTo(5 - 90 / OZ_IN_G, 6);
    expect(row.qty).toBeCloseTo(1.83, 2);
    // The ledger keeps the recipe's own amount.
    expect(completed.movements[0]).toMatchObject({ qty: -3, unit: "cup" });
  });

  it("lists USDA measures with their source and marks borrowed ones estimated", () => {
    const { ctx } = makeTestCtx();
    const exact = createIngredient(ctx, { fdcId: 10, name: "Baby Spinach" });
    const borrowed = createIngredient(ctx, { fdcId: 11, name: "Mature Spinach" });

    expect(listMeasures(ctx, exact.id)).toEqual([
      { unit: "cup", grams: 30, source: "usda", estimated: false, label: "cup", note: null, usdaGrams: null },
    ]);
    expect(listMeasures(ctx, borrowed.id)[0]).toMatchObject({ source: "usda_estimated", estimated: true, grams: 60 });
    expect(getIngredient(ctx, exact.id).measures).toHaveLength(1);
  });

  it("a user measure overrides the USDA one and deleting it falls back", () => {
    const { ctx } = makeTestCtx();
    const spinach = createIngredient(ctx, { fdcId: 10, name: "Baby Spinach" });

    const override = setMeasure(ctx, spinach.id, "cup", { grams: 40 });
    expect(override).toMatchObject({ unit: "cup", grams: 40, source: "user", usdaGrams: 30 });
    expect(listMeasures(ctx, spinach.id)).toHaveLength(1);
    expect(convert(ctx, 3, "cup", "g", spinach.id)).toBe(120);
    // The household's density wins for every volume unit.
    expect(convert(ctx, 16, "tbsp", "g", spinach.id)).toBeCloseTo(40 * (16 * 14.78676478125) / 236.5882365, 6);

    deleteMeasure(ctx, spinach.id, "cup");
    expect(listMeasures(ctx, spinach.id)[0]).toMatchObject({ grams: 30, source: "usda" });
    expect(convert(ctx, 3, "cup", "g", spinach.id)).toBe(90);
    // USDA measures cannot be deleted.
    expect(() => deleteMeasure(ctx, spinach.id, "cup")).toThrowError(/USDA measure/);
  });

  it("re-linking the food changes the USDA measures and keeps the user's own", () => {
    const { ctx } = makeTestCtx();
    const spinach = createIngredient(ctx, { fdcId: 10, name: "Baby Spinach" });
    setMeasure(ctx, spinach.id, "handful", { grams: 25 });
    expect(convert(ctx, 1, "cup", "g", spinach.id)).toBe(30);

    setIngredientNutrition(ctx, spinach.id, { mode: "manual", fdcId: 11 });

    expect(convert(ctx, 1, "cup", "g", spinach.id)).toBe(60);
    const measures = listMeasures(ctx, spinach.id);
    expect(measures.map((measure) => [measure.unit, measure.source])).toEqual([
      ["cup", "usda_estimated"],
      ["handful", "user"],
    ]);
  });

  it("the default portion of a linked food is the plain-count measure", () => {
    const { ctx } = makeTestCtx();
    const egg = createIngredient(ctx, { fdcId: 13, name: "Egg", defaultPortion: "large" });

    expect(listMeasures(ctx, egg.id).map((measure) => [measure.unit, measure.grams])).toEqual([
      ["large", 50],
      ["medium", 44],
      ["count", 50],
    ]);
    expect(convert(ctx, 2, null, "g", egg.id)).toBe(100);
    expect(convert(ctx, 1, "dozen", "g", egg.id)).toBe(600);
    expect(convert(ctx, 2, "medium", "g", egg.id)).toBe(88);
    expect(convert(ctx, 1, "extra-large", "g", egg.id)).toBe(50);
  });

  it("changing the stock unit converts the pantry amount and par into it, or refuses", () => {
    const { ctx } = makeTestCtx();
    const spinach = createIngredient(ctx, { fdcId: 10, name: "Baby Spinach", stockUnit: "oz", parQty: 2, parUnit: "oz" });
    setStock(ctx, { ingredientId: spinach.id, qty: 5, unit: "oz" });

    const updated = updateIngredient(ctx, spinach.id, { stockUnit: "g" });
    expect(updated.stockUnit).toBe("g");
    expect(updated.parQty).toBeCloseTo(2 * OZ_IN_G, 9);
    expect(updated.pantry[0]).toMatchObject({ unit: "g" });
    expect(updated.pantry[0]!.qty).toBeCloseTo(5 * OZ_IN_G, 9);

    // A can has no weight for this ingredient: nothing changes.
    expect(() => updateIngredient(ctx, spinach.id, { stockUnit: "can" })).toThrowError(/Unknown unit/);
    expect(getIngredient(ctx, spinach.id).stockUnit).toBe("g");
  });
});

describe("a valid unit that does not convert", () => {
  it("is accepted, shows no_conversion with a hint in nutrition and a unit reason in review", async () => {
    const { ctx, request } = makeTestApp();
    const rice = createIngredient(ctx, { fdcId: 12, name: "Rice" });
    setStock(ctx, { ingredientId: rice.id, qty: 2, unit: "lb" });

    const created = await request<{ id: string; slug: string }>("POST", "/api/v1/recipes", {
      title: "Rice Bowl",
      servings: 2,
      ingredients: [{ ingredientId: rice.id, qty: 1, unit: "cup" }],
    });
    expect(created.status).toBe(201);

    const nutrition = await request<{ lines: Array<{ status: string; hint?: string; unit: string }> }>(
      "GET",
      `/api/v1/recipes/${created.body.slug}/nutrition`,
    );
    expect(nutrition.body.lines[0]).toMatchObject({
      status: "no_conversion",
      unit: "cup",
      hint: "Add a measure: 1 cup = ? g",
    });

    const review = await request<{ items: Array<{ ingredient: { id: string }; reasons: string[]; units?: string[] }> }>(
      "GET",
      "/api/v1/ingredients/review",
    );
    const item = review.body.items.find((entry) => entry.ingredient.id === rice.id);
    expect(item).toMatchObject({ reasons: ["unit"], units: ["cup"] });

    // Adding a measure clears the reason.
    setMeasure(ctx, rice.id, "cup", { grams: 185 });
    expect(listIngredientsForReview(ctx).find((entry) => entry.ingredient.id === rice.id)).toBeUndefined();
    expect(getRecipeNutrition(ctx, created.body.slug).lines[0]).toMatchObject({ status: "ok", grams: 185 });
  });
});

describe("unknown units", () => {
  it("are a 422 with suggestions and write nothing; after adding the measure they are accepted", async () => {
    const { ctx, request } = makeTestApp();
    const spinach = createIngredient(ctx, { fdcId: 10, name: "Baby Spinach" });
    const body = {
      title: "Spinach Snack",
      servings: 1,
      ingredients: [{ ingredientId: spinach.id, qty: 2, unit: "handful" }],
    };

    const rejected = await request<UnresolvedBody>("POST", "/api/v1/recipes", body);
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe("unprocessable");
    const [issue] = rejected.body.error.details.unresolvedUnits;
    expect(issue).toMatchObject({ unit: "handful", ingredientId: spinach.id });
    expect(issue!.suggestions).toContain("cup");
    expect(issue!.hint).toContain(`/ingredients/${spinach.id}/measures/handful`);
    const none = await request<{ items: unknown[] }>("GET", "/api/v1/recipes");
    expect(none.body.items).toHaveLength(0);

    // The pantry, par, stock unit and shopping write paths enforce the same rule.
    const pantry = await request<UnresolvedBody>("POST", "/api/v1/pantry/set", {
      ingredientId: spinach.id,
      qty: 1,
      unit: "handful",
    });
    expect(pantry.status).toBe(422);
    const patch = await request<UnresolvedBody>("PATCH", `/api/v1/ingredients/${spinach.id}`, {
      stockUnit: "handful",
    });
    expect(patch.status).toBe(422);
    const list = await request<{ list: { id: string } }>("POST", "/api/v1/shopping-lists", { title: "Run" });
    const item = await request<UnresolvedBody>("POST", `/api/v1/shopping-lists/${list.body.list.id}/items`, {
      items: [{ ingredientId: spinach.id, qty: 1, unit: "handful" }],
    });
    expect(item.status).toBe(422);
    const stored = await request<{ stockUnit: string | null; pantry: unknown[] }>("GET", `/api/v1/ingredients/${spinach.id}`);
    expect(stored.body.stockUnit).toBeNull();
    expect(stored.body.pantry).toEqual([]);

    const put = await request<{ unit: string; grams: number; source: string }>(
      "PUT",
      `/api/v1/ingredients/${spinach.id}/measures/handful`,
      { grams: 25 },
    );
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ unit: "handful", grams: 25, source: "user" });

    const accepted = await request<{ slug: string }>("POST", "/api/v1/recipes", body);
    expect(accepted.status).toBe(201);
    const nutrition = await request<{ lines: Array<{ grams: number; status: string }> }>(
      "GET",
      `/api/v1/recipes/${accepted.body.slug}/nutrition`,
    );
    expect(nutrition.body.lines[0]).toMatchObject({ status: "ok", grams: 50 });
  });
});

describe("measures API", () => {
  it("lists, overrides and deletes measures; USDA measures are 404 on delete", async () => {
    const { ctx, request } = makeTestApp();
    const spinach = createIngredient(ctx, { fdcId: 10, name: "Baby Spinach" });
    const base = `/api/v1/ingredients/${spinach.id}/measures`;

    const listed = await request<{ items: Array<{ unit: string; source: string; estimated: boolean }> }>("GET", base);
    expect(listed.body.items).toEqual([expect.objectContaining({ unit: "cup", source: "usda", estimated: false })]);

    const override = await request<{ grams: number; source: string; usdaGrams: number }>("PUT", `${base}/Cups`, {
      grams: 35,
      note: "packed",
    });
    expect(override.body).toMatchObject({ grams: 35, source: "user", usdaGrams: 30 });

    expect((await request("PUT", `${base}/oz`, { grams: 28 })).status).toBe(400);
    expect((await request("PUT", `${base}/cup`, { grams: -1 })).status).toBe(400);
    expect((await request("PUT", `/api/v1/ingredients/ing_missing/measures/cup`, { grams: 5 })).status).toBe(404);

    expect((await request("DELETE", `${base}/cup`)).status).toBe(204);
    expect((await request("DELETE", `${base}/cup`)).status).toBe(404);
    const after = await request<{ items: Array<{ source: string }> }>("GET", base);
    expect(after.body.items[0]!.source).toBe("usda");
  });

  it("the ingredient view carries stockUnit, measures and the picker units", async () => {
    const { ctx, request } = makeTestApp();
    const spinach = createIngredient(ctx, { fdcId: 10, name: "Baby Spinach", stockUnit: "cup" });
    setMeasure(ctx, spinach.id, "handful", { grams: 25 });

    const view = await request<{ stockUnit: string; units: string[]; measures: Array<{ unit: string }>; defaultUnit?: unknown }>(
      "GET",
      `/api/v1/ingredients/${spinach.id}`,
    );
    expect(view.body.stockUnit).toBe("cup");
    expect(view.body.units.slice(0, 3)).toEqual(["cup", "handful", "count"]);
    expect(view.body.measures.map((measure) => measure.unit)).toEqual(["cup", "handful"]);
    expect(view.body).not.toHaveProperty("defaultUnit");
    expect(view.body).not.toHaveProperty("parUnit");
  });
});
