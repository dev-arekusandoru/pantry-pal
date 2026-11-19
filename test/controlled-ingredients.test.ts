import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "../src/auth/session.js";
import { ingredients, recipeIngredients, recipes } from "../src/db/schema.js";
import { AppError } from "../src/lib/errors.js";
import { completeCookEvent } from "../src/services/cooking.js";
import { getFood, gramsFor } from "../src/services/foods.js";
import { lintIngredientName, suggestedNameForFood } from "../src/services/ingredientNames.js";
import {
  acceptIngredient,
  createIngredient,
  findIngredientByName,
  getIngredient,
  listIngredients,
  listIngredientsForReview,
  mergeIngredients,
  splitIngredient,
  updateIngredient,
} from "../src/services/ingredients.js";
import { getRecipeNutrition } from "../src/services/nutrition.js";
import { applyMovement, getStockForIngredient } from "../src/services/pantry.js";
import { addCookEvent, createPlan } from "../src/services/plans.js";
import {
  createRecipe,
  getRecipe,
  scaleRecipeIngredients,
  updateRecipe,
} from "../src/services/recipes.js";
import { convert, normalizeUnit, unitFamily } from "../src/services/units.js";
import { addIngredient, makeAuthApp, makeTestApp, makeTestCtx, sessionCookie } from "./helpers.js";

/** Real bundled USDA foods (fdcId of a known description). */
const EGG = 171287; // Egg, whole, raw, fresh: portions large 50 g, medium 44 g
const ONION = 170000; // Onions, raw
const MILK = 171265; // Milk, whole, 3.25% milkfat, with added vitamin D
const WATER = 174158; // Water, bottled, generic

interface Unresolved {
  name: string;
  hint?: string;
  suggestions: Array<{ kind: string; name?: string; fdcId?: number; suggestedName?: string }>;
}

function expectAppError(fn: () => unknown, code: AppError["code"]): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`Expected an AppError with code ${code}`);
}

const unresolvedOf = (error: AppError): Unresolved[] =>
  (error.details as { unresolved: Unresolved[] }).unresolved;

describe("name lint", () => {
  it("accepts names of one ingredient, including product-identity words", () => {
    for (const name of ["Ground beef", "Sun-dried tomatoes", "Diced tomatoes", "Crushed red pepper", "Egg"]) {
      expect(lintIngredientName(name), name).toEqual({ ok: true });
    }
  });

  it("rejects quantities, sizes, preparation and alternatives with a hint", () => {
    const rejected: Array<[string, RegExp]> = [
      ["2 eggs", /quantity|number/i],
      ["500g flour", /number|quantity/i],
      ["1 cup milk", /number|quantity/i],
      ["Large eggs", /size/i],
      ["Extra-large eggs", /size/i],
      ["onion, chopped", /comma/i],
      ["Chopped onion", /preparation/i],
      ["Butter, softened", /comma/i],
      ["Salt to taste", /preparation/i],
      ["Salt (to taste)", /brackets/i],
      ["milk or water", /"or"/],
      ["milk/water", /"\/"/],
      ["salt & pepper", /"&"/],
    ];
    for (const [name, reason] of rejected) {
      const lint = lintIngredientName(name);
      expect(lint.ok, name).toBe(false);
      if (!lint.ok) {
        expect(lint.reason, name).toMatch(reason);
        expect(lint.hint.length, name).toBeGreaterThan(0);
      }
    }
    const size = lintIngredientName("Large eggs");
    expect(size.ok === false && size.hint).toContain("unit");
    const alternatives = lintIngredientName("milk or water");
    expect(alternatives.ok === false && alternatives.hint).toContain("alternatives");
    const prep = lintIngredientName("onion, chopped");
    expect(prep.ok === false && prep.hint).toContain("prepNote");
  });

  it("applies to create and rename, and leaves existing bad names alone", () => {
    const { ctx, db } = makeTestCtx();
    expectAppError(() => createIngredient(ctx, { name: "Large eggs", custom: true }), "unprocessable");
    expectAppError(() => createIngredient(ctx, { fdcId: EGG, name: "2 eggs" }), "unprocessable");

    const bad = addIngredient(ctx, "Plain");
    db.update(ingredients).set({ name: "Milk or water", normalizedName: "milk or water" }).where(eq(ingredients.id, bad.id)).run();
    expectAppError(() => updateIngredient(ctx, bad.id, { name: "Milk, whole" }), "unprocessable");
    // Editing something else with the same bad name is fine.
    expect(updateIngredient(ctx, bad.id, { name: "Milk or water", notes: "x" }).notes).toBe("x");
    expect(updateIngredient(ctx, bad.id, { name: "Milk" }).name).toBe("Milk");
  });
});

describe("suggested names from USDA descriptions", () => {
  const table: Array<[string, string]> = [
    ["Onions, raw", "Onion"],
    ["Egg, whole, raw, fresh", "Egg"],
    ["Cheese, cheddar", "Cheddar Cheese"],
    ["Oil, olive, salad or cooking", "Olive Oil"],
    ["Milk, whole, 3.25% milkfat, with added vitamin D", "Milk"],
    ["Butter, salted", "Butter"],
    ["Beef, ground, 85% lean meat / 15% fat, raw", "Ground Beef"],
    ["Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw", "Chicken Breast"],
    ["Fish, salmon, Atlantic, farmed, raw", "Salmon"],
    ["Garlic, raw", "Garlic"],
    ["Tomatoes, sun-dried", "Sun-Dried Tomatoes"],
    ["Tomatoes, sun-dried, packed in oil, drained", "Sun-Dried Tomatoes"],
    ["Potatoes, white, flesh and skin, raw", "White Potato"],
    ["Wheat flour, white, all-purpose, enriched, bleached", "All-Purpose Flour"],
    ["Sugars, granulated", "Granulated Sugar"],
    ["Spices, ginger, ground", "Ground Ginger"],
    ["Spices, pepper, black", "Black Pepper"],
    ["Beans, kidney, red, mature seeds, canned, solids and liquids", "Canned Red Kidney Beans"],
    ["Soy sauce made from soy and wheat (shoyu)", "Soy Sauce"],
    ["Cream, fluid, heavy whipping", "Heavy Cream"],
    ["Cheese, parmesan, grated", "Parmesan Cheese"],
    ["Peppers, sweet, red, raw", "Red Bell Pepper"],
    ["Pork, cured, bacon, unprepared", "Bacon"],
    ["Leavening agents, baking powder, double-acting, sodium aluminum sulfate", "Baking Powder"],
    ["Bananas, raw", "Banana"],
    ["Oats", "Oats"],
  ];

  it.each(table)("%s → %s", (description, expected) => {
    expect(suggestedNameForFood(description)).toBe(expected);
  });

  it("always derives a name that passes the lint, for every bundled food", () => {
    for (const fdcId of [EGG, ONION, MILK, WATER, 171413, 173414, 168567, 175195]) {
      const food = getFood(fdcId)!;
      expect(lintIngredientName(suggestedNameForFood(food.description)).ok, food.description).toBe(true);
    }
  });
});

describe("recipes never create free-text ingredients", () => {
  it("answers an unknown name with every unresolved name, suggestions and hints, and writes nothing", () => {
    const { ctx, db } = makeTestCtx();
    addIngredient(ctx, "Yellow onion");

    const error = expectAppError(
      () =>
        createRecipe(ctx, {
          title: "Needs names",
          ingredients: [
            { ingredient: "yellow onion", qty: 1, unit: "count" },
            { ingredient: "milk or water", qty: 1, unit: "cup" },
            { ingredient: "Onion", qty: 1 },
            { ingredient: "Zzyzx root", qty: 1 },
            { fdcId: EGG, name: "Egg", qty: 2, unit: "large" },
          ],
        }),
      "unprocessable",
    );

    const unresolved = unresolvedOf(error);
    expect(unresolved.map((item) => item.name)).toEqual(["milk or water", "Onion", "Zzyzx root"]);
    const milkOrWater = unresolved[0]!;
    expect(milkOrWater.hint).toMatch(/"or"/);
    expect(milkOrWater.hint).toMatch(/alternatives/);
    expect(milkOrWater.suggestions.length).toBeGreaterThan(0);
    expect(milkOrWater.suggestions.length).toBeLessThanOrEqual(5);
    expect(milkOrWater.suggestions.some((item) => item.kind === "food" && item.fdcId === MILK)).toBe(true);
    for (const suggestion of milkOrWater.suggestions) {
      if (suggestion.kind === "food") expect(suggestion.suggestedName).toBeTruthy();
    }
    // The existing household ingredient comes first for a near name.
    expect(unresolved[1]!.suggestions[0]).toMatchObject({ kind: "ingredient", name: "Yellow Onion" });
    expect(unresolved[2]!.hint).toBeUndefined();
    expect(error.message).toContain("milk or water");
    expect(error.message).toContain("Zzyzx root");

    // Transaction semantics: neither the recipe nor the Egg created for the fdcId line exists.
    expect(db.select().from(recipes).all()).toEqual([]);
    expect(listIngredients(ctx).map((row) => row.name)).toEqual(["Yellow Onion"]);
  });

  it("creates a linked ingredient from an fdcId and reuses it for the next reference", () => {
    const { ctx } = makeTestCtx();

    const first = createRecipe(ctx, {
      title: "Scramble",
      ingredients: [{ fdcId: EGG, name: "Egg", category: "protein", qty: 2, unit: "large" }],
    });
    const egg = findIngredientByName(ctx, "egg")!;
    expect(first.ingredients[0]!.ingredientId).toBe(egg.id);
    expect(egg).toMatchObject({ nutritionFdcId: EGG, nutritionSource: "manual", category: "protein", needsReview: false });

    // Same food again, even with another name: the household ingredient is reused, nothing new is created.
    const second = createRecipe(ctx, {
      title: "Omelet",
      ingredients: [
        { fdcId: EGG, name: "Eggs of the day", qty: 3, unit: "large" },
        { fdcId: EGG, qty: 1, unit: "medium" },
      ],
    });
    expect(second.ingredients.map((line) => line.ingredientId)).toEqual([egg.id, egg.id]);
    expect(listIngredients(ctx)).toHaveLength(1);

    // Without a name, the name is derived from the USDA description.
    const third = createRecipe(ctx, {
      title: "Onion soup",
      ingredients: [{ fdcId: ONION, qty: 2, unit: "count" }],
    });
    expect(third.ingredients[0]!.ingredient.name).toBe("Onion");
  });

  it("rejects a line that names the ingredient twice, an unknown food and a bad explicit name", () => {
    const { ctx } = makeTestCtx();
    expectAppError(
      () => createRecipe(ctx, { title: "x", ingredients: [{ ingredient: "A", fdcId: EGG }] }),
      "validation",
    );
    expectAppError(() => createRecipe(ctx, { title: "x", ingredients: [{ qty: 1 }] }), "validation");
    expectAppError(() => createRecipe(ctx, { title: "x", ingredients: [{ fdcId: 1 }] }), "not_found");
    expectAppError(
      () => createRecipe(ctx, { title: "x", ingredients: [{ fdcId: EGG, name: "Large eggs" }] }),
      "unprocessable",
    );
    expect(listIngredients(ctx)).toEqual([]);
  });

  it("answers over REST with 422, details.unresolved and suggestions", async () => {
    const { request, ctx } = makeTestApp();
    const response = await request<{
      error: { code: string; details: { unresolved: Unresolved[] } };
    }>("POST", "/api/v1/recipes", {
      title: "Soup",
      ingredients: [{ ingredient: "milk or water", qty: 1, unit: "cup" }],
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("unprocessable");
    expect(response.body.error.details.unresolved[0]).toMatchObject({ name: "milk or water" });
    expect(response.body.error.details.unresolved[0]!.hint).toContain("alternatives");
    expect(listIngredients(ctx)).toEqual([]);

    const retry = await request<{ ingredients: Array<{ ingredient: { name: string } }> }>(
      "POST",
      "/api/v1/recipes",
      {
        title: "Soup",
        ingredients: [{ fdcId: MILK, name: "Milk", qty: 1, unit: "cup", alternatives: [{ fdcId: WATER, name: "Water" }] }],
      },
    );
    expect(retry.status).toBe(201);
    expect(retry.body.ingredients[0]!.ingredient.name).toBe("Milk");
  });
});

describe("creating ingredients over REST", () => {
  it("answers a plain create with 422 and suggestions", async () => {
    const { request } = makeTestApp();
    const response = await request<{ error: { details: { unresolved: Unresolved[] } } }>(
      "POST",
      "/api/v1/ingredients",
      { name: "Yellow onion" },
    );
    expect(response.status).toBe(422);
    const entry = response.body.error.details.unresolved[0]!;
    expect(entry.name).toBe("Yellow onion");
    expect(entry.suggestions.some((item) => item.kind === "food" && item.fdcId === ONION)).toBe(true);
  });

  it("flags customs made with an API token for review", async () => {
    const { request } = makeTestApp();
    const created = await request<{ id: string; needsReview: boolean; nutrition: { fdcId: number | null } }>(
      "POST",
      "/api/v1/ingredients",
      { name: "Kumquat", custom: true },
    );
    expect(created.status).toBe(201);
    expect(created.body.needsReview).toBe(true);
    expect(created.body.nutrition.fdcId).toBeNull();

    const review = await request<{
      items: Array<{ ingredient: { name: string }; reasons: string[] }>;
    }>("GET", "/api/v1/ingredients/review");
    expect(review.status).toBe(200);
    expect(review.body.items.map((item) => [item.ingredient.name, item.reasons])).toEqual([
      ["Kumquat", ["unlinked", "custom_unreviewed"]],
    ]);

    const accepted = await request<{ needsReview: boolean }>(
      "POST",
      `/api/v1/ingredients/${created.body.id}/review`,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.needsReview).toBe(false);
    expect((await request<{ items: unknown[] }>("GET", "/api/v1/ingredients/review")).body.items).toEqual([]);
  });

  it("does not flag customs made from a browser session", async () => {
    const app = makeAuthApp();
    const signup = await app.request("POST", "/auth/signup", {
      body: { email: "cook@example.com", password: "correct horse battery candle", householdName: "Test Kitchen" },
      headers: { origin: "http://localhost" },
    });
    expect(signup.status).toBe(201);
    const cookie = sessionCookie(signup);
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);

    const response = await app.request("POST", "/api/v1/ingredients", {
      body: { name: "Kumquat", custom: true },
      headers: { origin: "http://localhost" },
      cookie,
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: "Kumquat", needsReview: false });
  });

  it("creates a linked ingredient from fdcId, derives the name, and answers 409 for a linked food", async () => {
    const { request } = makeTestApp();
    const created = await request<{ id: string; name: string; needsReview: boolean; nutrition: { fdcId: number } }>(
      "POST",
      "/api/v1/ingredients",
      { fdcId: ONION },
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Onion", needsReview: false, nutrition: { fdcId: ONION } });

    const conflict = await request<{ error: { code: string; details: { ingredientId: string } } }>(
      "POST",
      "/api/v1/ingredients",
      { fdcId: ONION, name: "Red onion" },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.ingredientId).toBe(created.body.id);

    const both = await request("POST", "/api/v1/ingredients", { fdcId: ONION, custom: true, name: "Other" });
    expect(both.status).toBe(400);
  });

  it("rejects names that break the naming rules with a hint", async () => {
    const { request } = makeTestApp();
    const response = await request<{ error: { details: { hint: string } } }>("POST", "/api/v1/ingredients", {
      name: "Large eggs",
      custom: true,
    });
    expect(response.status).toBe(422);
    expect(response.body.error.details.hint).toContain("unit");
  });

  it("finds existing ingredients and foods", async () => {
    const { request, ctx } = makeTestApp();
    addIngredient(ctx, "Yellow onion", { aliases: ["onion"] });
    const response = await request<{
      ingredients: Array<{ name: string }>;
      foods: Array<{ fdcId: number; suggestedName: string }>;
    }>("GET", "/api/v1/ingredients/find?query=onion");
    expect(response.status).toBe(200);
    expect(response.body.ingredients.map((item) => item.name)).toEqual(["Yellow Onion"]);
    expect(response.body.foods.find((food) => food.fdcId === ONION)?.suggestedName).toBe("Onion");
  });
});

describe("alternatives", () => {
  it("round-trips through create, read, update and scaling; only the main ingredient counts", () => {
    const { ctx } = makeTestCtx();
    const milk = createIngredient(ctx, { fdcId: MILK, name: "Milk" });
    const water = createIngredient(ctx, { fdcId: WATER, name: "Water" });
    const stock = applyMovement(ctx, {
      ingredientId: water.id,
      kind: "set",
      qty: 10,
      unit: "cup",
      reason: "purchase",
    });
    expect(stock.item.qty).toBe(10);

    const recipe = createRecipe(ctx, {
      title: "Pancakes",
      servings: 2,
      ingredients: [
        {
          ingredient: "milk",
          alternatives: [{ ingredient: "Water" }, { ingredientId: water.id }, { ingredient: "milk" }],
          qty: 1,
          unit: "cup",
        },
      ],
    });
    // Duplicates and the main ingredient itself are dropped.
    expect(recipe.ingredients[0]!.alternatives).toEqual([{ ingredientId: water.id, name: "Water" }]);
    expect(getRecipe(ctx, recipe.slug).ingredients[0]!.alternatives).toEqual([
      { ingredientId: water.id, name: "Water" },
    ]);
    expect(scaleRecipeIngredients(ctx, recipe.id, 4)[0]).toMatchObject({
      ingredientName: "Milk",
      qty: 2,
      alternatives: [{ ingredientId: water.id, name: "Water" }],
    });

    // Nutrition uses the main ingredient: 1 cup of milk (244 g), not water.
    const nutrition = getRecipeNutrition(ctx, recipe.id);
    expect(nutrition.lines).toHaveLength(1);
    expect(nutrition.lines[0]).toMatchObject({ ingredientId: milk.id, food: { fdcId: MILK }, grams: 244 });

    // Cooking deducts the main ingredient only (milk has no stock: warned; water is untouched).
    const plan = createPlan(ctx, { weekStart: "2026-11-02" });
    const event = addCookEvent(ctx, plan.id, { recipeId: recipe.id, cookDate: "2026-11-02", plannedServings: 2 });
    const done = completeCookEvent(ctx, event.id);
    expect(done.movements).toEqual([]);
    expect(getStockForIngredient(ctx, water.id)[0]!.qty).toBe(10);

    // Replacing the lines can drop the alternatives again.
    const updated = updateRecipe(ctx, recipe.id, {
      ingredients: [{ ingredientId: milk.id, qty: 1, unit: "cup" }],
    });
    expect(updated.ingredients[0]!.alternatives).toEqual([]);
  });

  it("collects unknown names of alternatives too", () => {
    const { ctx } = makeTestCtx();
    addIngredient(ctx, "Milk");
    const error = expectAppError(
      () =>
        createRecipe(ctx, {
          title: "x",
          ingredients: [{ ingredient: "Milk", alternatives: [{ ingredient: "Oat drink" }, { ingredient: "Soy drink" }] }],
        }),
      "unprocessable",
    );
    expect(unresolvedOf(error).map((item) => item.name)).toEqual(["Oat drink", "Soy drink"]);
  });
});

describe("sizes and default portions", () => {
  it("treats sizes as count units and keeps the size as the stored unit", () => {
    for (const size of ["small", "medium", "large", "extra-large", "jumbo"]) {
      expect(normalizeUnit(size), size).toBe(size);
      expect(unitFamily(size), size).toBe("count");
    }
    expect(normalizeUnit("Extra Large")).toBe("extra-large");
    const { ctx } = makeTestCtx();
    expect(convert(ctx, 2, "large", "count")).toBe(2);
    expect(convert(ctx, 1, "dozen", "large")).toBe(12);
    expect(convert(ctx, 3, "large", "g")).toBeNull();

    const recipe = createRecipe(ctx, {
      title: "Eggs",
      ingredients: [{ fdcId: EGG, name: "Egg", qty: 2, unit: "Large" }],
    });
    expect(recipe.ingredients[0]!.unit).toBe("large");
  });

  it('gives "2 large eggs" grams through the large portion', () => {
    const { ctx } = makeTestCtx();
    createIngredient(ctx, { fdcId: EGG, name: "Egg" });
    const recipe = createRecipe(ctx, {
      title: "Eggs",
      ingredients: [
        { ingredient: "Egg", qty: 2, unit: "large" },
        { ingredient: "Egg", qty: 1, unit: "extra-large" },
        { ingredient: "Egg", qty: 1, unit: "small" },
        { ingredient: "Egg", qty: 1 },
      ],
    });
    const lines = getRecipeNutrition(ctx, recipe.id).lines;
    expect(lines.map((line) => line.grams)).toEqual([100, 56, 38, 44]);
    expect(lines.map((line) => line.status)).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("uses the default portion for a plain count and validates it against the food", () => {
    const { ctx } = makeTestCtx();
    const egg = createIngredient(ctx, { fdcId: EGG, name: "Egg", defaultPortion: "LARGE" });
    expect(egg.defaultPortion).toBe("large");
    expect(getIngredient(ctx, egg.id).nutrition!.portions.map((portion) => portion.label)).toContain("large");

    const recipe = createRecipe(ctx, {
      title: "Eggs",
      ingredients: [{ ingredient: "Egg", qty: 2 }, { ingredient: "Egg", qty: 1, unit: "dozen" }, { ingredient: "Egg", qty: 1, unit: "medium" }],
    });
    const lines = getRecipeNutrition(ctx, recipe.id).lines;
    expect(lines.map((line) => line.grams)).toEqual([100, 600, 44]);

    expectAppError(() => updateIngredient(ctx, egg.id, { defaultPortion: "colossal" }), "validation");
    expect(updateIngredient(ctx, egg.id, { defaultPortion: null }).defaultPortion).toBeNull();
    expect(updateIngredient(ctx, egg.id, { defaultPortion: "medium" }).defaultPortion).toBe("medium");
    const custom = createIngredient(ctx, { custom: true, name: "Kumquat" });
    expectAppError(() => updateIngredient(ctx, custom.id, { defaultPortion: "large" }), "validation");

    // Without a default portion a plain count falls back to the medium portion.
    expect(gramsFor(getFood(EGG)!, 2, null)).toBe(88);
    expect(gramsFor(getFood(EGG)!, 2, null, "large")).toBe(100);
  });

  it("deducts '2 large' from count stock", () => {
    const { ctx } = makeTestCtx();
    const egg = createIngredient(ctx, { fdcId: EGG, name: "Egg", defaultPortion: "large" });
    applyMovement(ctx, { ingredientId: egg.id, kind: "set", qty: 12, unit: "count", reason: "purchase" });
    const recipe = createRecipe(ctx, {
      title: "Boiled eggs",
      servings: 2,
      ingredients: [{ ingredient: "Egg", qty: 2, unit: "large" }],
    });

    const plan = createPlan(ctx, { weekStart: "2026-11-02" });
    const event = addCookEvent(ctx, plan.id, { recipeId: recipe.id, cookDate: "2026-11-02", plannedServings: 2 });
    const done = completeCookEvent(ctx, event.id);

    expect(done.movements).toHaveLength(1);
    expect(done.movements[0]!.qty).toBeCloseTo(-2, 6);
    expect(getStockForIngredient(ctx, egg.id)[0]).toMatchObject({ qty: 10, unit: "count" });
  });

  it("stores the size on a recipe line even when the household has no such ingredient yet", () => {
    const { ctx, db } = makeTestCtx();
    createRecipe(ctx, {
      title: "Eggs",
      ingredients: [{ fdcId: EGG, name: "Egg", qty: 4, unit: "large" }],
    });
    const rows = db.select().from(recipeIngredients).where(and(eq(recipeIngredients.unit, "large"))).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(4);
  });
});

describe("review", () => {
  it("lists unlinked, custom and badly named ingredients with reasons and suggestions", () => {
    const { ctx, db } = makeTestCtx();
    createIngredient(ctx, { fdcId: ONION, name: "Onion" });
    const custom = createIngredient(ctx, { custom: true, name: "Kumquat" });
    const accepted = createIngredient(ctx, { custom: true, name: "Zzyzx root", needsReview: false });
    const legacy = addIngredient(ctx, "Plain");
    db.update(ingredients)
      .set({ name: "Milk or water", normalizedName: "milk or water", needsReview: true })
      .where(eq(ingredients.id, legacy.id))
      .run();
    const linkedBad = createIngredient(ctx, { fdcId: MILK, name: "Milk" });
    db.update(ingredients)
      .set({ name: "Large milk", normalizedName: "large milk" })
      .where(eq(ingredients.id, linkedBad.id))
      .run();

    const items = listIngredientsForReview(ctx);
    const byName = new Map(items.map((item) => [item.ingredient.name, item]));
    expect([...byName.keys()].sort()).toEqual(["Kumquat", "Large milk", "Milk or water"]);
    expect(byName.get("Kumquat")!.reasons).toEqual(["unlinked", "custom_unreviewed"]);
    expect(byName.get("Kumquat")!.lint).toBeUndefined();
    expect(byName.get("Milk or water")!.reasons).toEqual(["unlinked", "lint", "custom_unreviewed"]);
    expect(byName.get("Milk or water")!.lint!.hint).toContain("alternatives");
    expect(byName.get("Milk or water")!.suggestions.length).toBeGreaterThan(0);
    expect(byName.get("Large milk")!.reasons).toEqual(["lint"]);
    // A well-named linked ingredient needs no suggestions; a badly named one gets some to rename it by.
    expect(byName.get("Large milk")!.suggestions.length).toBeGreaterThan(0);
    expect(byName.get("Large milk")!.suggestions.some((item) => item.kind === "ingredient" && item.name === "Large milk")).toBe(false);

    // Accepting clears the flag; a lint problem stays until the name is fixed.
    expect(acceptIngredient(ctx, custom.id).needsReview).toBe(false);
    expect(acceptIngredient(ctx, accepted.id).needsReview).toBe(false);
    acceptIngredient(ctx, legacy.id);
    expect(listIngredientsForReview(ctx).map((item) => item.ingredient.name).sort()).toEqual([
      "Large milk",
      "Milk or water",
    ]);
    updateIngredient(ctx, linkedBad.id, { name: "Milk" });
    expect(listIngredientsForReview(ctx).map((item) => item.ingredient.name)).toEqual(["Milk or water"]);
  });

  it("clears the flag when a food is linked", async () => {
    const { request } = makeTestApp();
    const created = await request<{ id: string }>("POST", "/api/v1/ingredients", { name: "Kumquat", custom: true });
    const linked = await request<{ needsReview: boolean; nutrition: { fdcId: number } }>(
      "PUT",
      `/api/v1/ingredients/${created.body.id}/nutrition`,
      { mode: "manual", fdcId: ONION },
    );
    expect(linked.status).toBe(200);
    expect(linked.body.needsReview).toBe(false);
    expect((await request<{ items: unknown[] }>("GET", "/api/v1/ingredients/review")).body.items).toEqual([]);
  });

  it("splits an ingredient that names several: rewrites recipe lines, moves stock, archives it", async () => {
    const { ctx, request, db } = makeTestApp();
    const milk = createIngredient(ctx, { fdcId: MILK, name: "Milk" });
    const both = addIngredient(ctx, "Milk and water");
    const other = addIngredient(ctx, "Flour");
    applyMovement(ctx, { ingredientId: both.id, kind: "set", qty: 2, unit: "cup", reason: "purchase" });
    const recipe = createRecipe(ctx, {
      title: "Batter",
      ingredients: [
        { ingredientId: both.id, qty: 1, unit: "cup" },
        { ingredientId: other.id, qty: 2, unit: "cup", alternatives: [{ ingredientId: both.id }] },
      ],
    });

    const response = await request<{
      source: { archivedAt: string | null };
      main: { id: string };
      alternatives: Array<{ name: string }>;
      moved: { recipeLines: number; alternativeLines: number; pantryItems: number };
    }>("POST", `/api/v1/ingredients/${both.id}/split`, {
      main: { ingredientId: milk.id },
      alternatives: [{ fdcId: WATER, name: "Water" }],
    });
    expect(response.status).toBe(200);
    expect(response.body.source.archivedAt).not.toBeNull();
    expect(response.body.main.id).toBe(milk.id);
    expect(response.body.alternatives.map((item) => item.name)).toEqual(["Water"]);
    expect(response.body.moved).toMatchObject({ recipeLines: 1, alternativeLines: 1, pantryItems: 1 });

    const lines = getRecipe(ctx, recipe.id).ingredients;
    expect(lines[0]).toMatchObject({ ingredientId: milk.id });
    expect(lines[0]!.alternatives.map((item) => item.name)).toEqual(["Water"]);
    expect(lines[1]!.ingredient.name).toBe("Flour");
    expect(lines[1]!.alternatives.map((item) => item.name)).toEqual(["Milk", "Water"]);
    expect(getStockForIngredient(ctx, milk.id)[0]).toMatchObject({ qty: 2, unit: "cup" });
    expect(getStockForIngredient(ctx, both.id)).toEqual([]);
    expect(db.select().from(ingredients).where(eq(ingredients.id, both.id)).get()!.archivedAt).not.toBeNull();

    // Unknown targets: nothing changes, every name is listed.
    const other2 = addIngredient(ctx, "Cream and butter");
    const bad = await request<{ error: { details: { unresolved: Unresolved[] } } }>(
      "POST",
      `/api/v1/ingredients/${other2.id}/split`,
      { main: { ingredient: "Cream" }, alternatives: [{ ingredient: "Butter" }] },
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.unresolved.map((item) => item.name)).toEqual(["Cream", "Butter"]);
    expect(getIngredient(ctx, other2.id).archivedAt).toBeNull();

    expectAppError(
      () => splitIngredient(ctx, other2.id, { main: { ingredientId: other2.id } }),
      "validation",
    );
  });
});

describe("merge keeps alternatives consistent", () => {
  it("drops an alternative that becomes the main ingredient of its line", () => {
    const { ctx } = makeTestCtx();
    const milk = addIngredient(ctx, "Milk");
    const dairy = addIngredient(ctx, "Dairy milk");
    const recipe = createRecipe(ctx, {
      title: "x",
      ingredients: [{ ingredientId: milk.id, alternatives: [{ ingredientId: dairy.id }] }],
    });
    expect(recipe.ingredients[0]!.alternatives).toHaveLength(1);

    // Merge the alternative into the main ingredient.
    mergeIngredients(ctx, dairy.id, milk.id);
    expect(getRecipe(ctx, recipe.id).ingredients[0]!.alternatives).toEqual([]);
  });
});
