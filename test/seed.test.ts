import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError, isAppError } from "../src/lib/errors.js";
import type { SeedData } from "../src/schemas/seed.js";
import { parseSeed } from "../src/schemas/seed.js";
import { loadSeed, type SeedResult } from "../src/seed/load.js";
import { computeDemand } from "../src/services/demand.js";
import { getHousehold, listMembers } from "../src/services/households.js";
import {
  findIngredientByName,
  listIngredients,
} from "../src/services/ingredients.js";
import { getStockForIngredient, listMovements, listPantry } from "../src/services/pantry.js";
import { getPlan } from "../src/services/plans.js";
import { getRecipe, listStatusHistory, searchRecipes } from "../src/services/recipes.js";
import { checkRecipe } from "../src/services/rules.js";
import { getShoppingList, listShoppingLists } from "../src/services/shopping.js";
import { convert } from "../src/services/units.js";
import { makeTestCtx, type TestContext } from "./helpers.js";

const SEED_JSON = JSON.parse(
  readFileSync(new URL("../seed/example.json", import.meta.url), "utf8"),
) as unknown;

const WEEK_START = "2026-11-16";

function errorFrom(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

function asAppError(error: unknown): AppError {
  if (!isAppError(error)) throw error instanceof Error ? error : new Error("expected an AppError");
  return error;
}

describe("loadSeed(seed/example.json)", () => {
  let test: TestContext;
  let result: SeedResult;

  beforeAll(() => {
    test = makeTestCtx();
    result = loadSeed(test.ctx, structuredClone(SEED_JSON));
  });

  it("imports every section with the counts declared by the seed", () => {
    expect(result.summary).toMatchObject({
      householdMembers: 2,
      ingredients: 100,
      measures: 17,
      pantryItems: 51,
      stockMovements: 51,
      dietaryRules: 11,
      recipes: 15,
      mealPlans: 1,
      cookEvents: 16,
      mealSlots: 24,
      prepTasks: 7,
      shoppingLists: 1,
      shoppingListItems: 44,
    });

    const seed = parseSeed(SEED_JSON);
    expect(result.summary.ingredientAliases).toBe(
      seed.ingredients.reduce((sum, ingredient) => sum + ingredient.aliases.length, 0),
    );
    expect(result.summary.recipeIngredients).toBe(
      seed.recipes.reduce((sum, recipe) => sum + recipe.ingredients.length, 0),
    );
    expect(result.summary.recipeSteps).toBe(
      seed.recipes.reduce((sum, recipe) => sum + recipe.steps.length, 0),
    );
    expect(listIngredients(test.ctx)).toHaveLength(100);
  });

  it("links every seeded ingredient to a USDA food or declares it custom, with no review flags", () => {
    const seed = parseSeed(SEED_JSON);
    const declared = new Map(seed.ingredients.map((item) => [item.name, item]));
    const rows = listIngredients(test.ctx);
    expect(rows).toHaveLength(seed.ingredients.length);
    for (const row of rows) {
      const input = declared.get(row.name);
      expect(input, row.name).toBeDefined();
      expect(row.needsReview, row.name).toBe(false);
      expect(row.nutrition?.fdcId ?? null, row.name).toBe(input!.fdcId ?? null);
      expect(input!.fdcId !== undefined || input!.custom === true, row.name).toBe(true);
    }

    const egg = rows.find((row) => row.name === "Eggs");
    expect(egg).toMatchObject({ defaultPortion: "large", nutrition: { fdcId: 171287 } });
    expect(rows.some((row) => row.name === "Sun-Dried Tomatoes")).toBe(true);
    const eggLines = getRecipe(test.ctx, "eggs-and-toast").ingredients.filter(
      (line) => line.ingredient.name === "Eggs",
    );
    expect(eggLines.map((line) => line.unit)).toEqual(["large"]);
  });

  it("loads through the service layer without warnings", () => {
    expect(result.warnings).toEqual([]);
  });

  it("applies the household and its members", () => {
    const household = getHousehold(test.db, test.ctx.householdId);
    expect(household.name).toBe("Demo Kitchen");
    expect(household.timezone).toBe("America/New_York");
    expect(household.settings).toMatchObject({
      defaultServings: 2,
      spiceLevel: "mild",
      lunchBatchServings: 6,
      dinnerServings: 4,
      weekStartsOn: 1,
      unitSystem: "us",
    });
    expect(household.settings.planningNotes).toContain("No mushrooms, no pork");

    const members = listMembers(test.ctx).items.map((member) => member.name).sort();
    expect(members).toEqual(["Robin", "Sam"]);
  });

  it("links the chili cook on Nov 15 to the Mon-Wed lunch slots, all leftovers", () => {
    const plan = getPlan(test.ctx, WEEK_START);
    expect(plan.status).toBe("active");
    expect(plan.cookEvents).toHaveLength(16);

    const chili = plan.cookEvents.find((event) => event.label === "Lunch batch A (Mon-Wed)");
    expect(chili).toBeDefined();
    expect(chili?.recipeTitle).toBe("Easy Slow Cooker Chili");
    expect(chili?.cookDate).toBe("2026-11-15");
    expect(chili?.status).toBe("planned");
    expect(chili?.plannedServings).toBe(6);

    const lunchSlots = plan.days
      .flatMap((day) => day.meals.lunch.map((slot) => ({ date: day.date, slot })))
      .filter(({ slot }) => slot.cookEventId === chili?.id);

    expect(lunchSlots.map(({ date }) => date)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
    ]);
    // The chili is cooked on 2026-11-15, so every later lunch is a leftover
    // (isLeftover = slot.date > cookDate).
    expect(lunchSlots.map(({ slot }) => slot.isLeftover)).toEqual([true, true, true]);
    expect(lunchSlots.map(({ slot }) => slot.servings)).toEqual([2, 2, 2]);

    // Sunday's lunch is cooked the same day, so it is not a leftover.
    const sundayLunch = plan.days.find((day) => day.date === "2026-11-22")?.meals.lunch[0];
    expect(sundayLunch).toMatchObject({ kind: "meal", isLeftover: false });

    // A full Monday-Sunday week: every day has breakfast, lunch and dinner planned.
    expect(plan.days.map((day) => day.date)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    for (const day of plan.days) {
      expect(day.meals.breakfast.length, day.date).toBeGreaterThan(0);
      expect(day.meals.lunch.length, day.date).toBeGreaterThan(0);
      expect(day.meals.dinner.length, day.date).toBeGreaterThan(0);
    }

    const allSlots = plan.days.reduce(
      (sum, day) =>
        sum +
        Object.values(day.meals).reduce((count, slots) => count + slots.length, 0),
      0,
    );
    expect(allSlots).toBe(24);
  });

  it("imports the pantry snapshot without fabricating purchases", () => {
    const beef = findIngredientByName(test.ctx, "Ground beef");
    expect(beef).not.toBeNull();
    const stock = getStockForIngredient(test.ctx, beef!.id);
    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({
      qty: 2,
      unit: "lb",
      status: "on_hand",
      qtyApprox: false,
      rawText: "Ground Beef | 2 lb",
      note: null,
    });

    const beefMovements = listMovements(test.ctx, { ingredientId: beef!.id });
    expect(beefMovements).toHaveLength(1);
    expect(beefMovements[0]).toMatchObject({
      kind: "set",
      reason: "import",
      refType: "seed",
      refId: null,
      qty: 2,
      unit: "lb",
      qtyAfter: 2,
      statusAfter: "on_hand",
    });

    // An "on hand" line keeps a null quantity and stays "on_hand", not "unknown".
    const salt = findIngredientByName(test.ctx, "Salt");
    const saltStock = getStockForIngredient(test.ctx, salt!.id);
    expect(saltStock[0]).toMatchObject({
      qty: null,
      unit: null,
      status: "on_hand",
      rawText: "Salt | on hand",
    });

    const movements = listMovements(test.ctx, { limit: 200 });
    expect(movements).toHaveLength(51);
    expect(movements.every((movement) => movement.reason === "import")).toBe(true);
    expect(
      movements.every((movement) => movement.refType === "seed" && movement.refId === null),
    ).toBe(true);
  });

  it("makes recipe units comparable to pantry units", () => {
    const tomatoes = findIngredientByName(test.ctx, "Diced tomatoes with green chilies");
    const garlic = findIngredientByName(test.ctx, "Garlic");
    expect(convert(test.ctx, 2, "can", "oz", tomatoes!.id)).toBeCloseTo(29, 3);
    expect(convert(test.ctx, 1, "head", "clove", garlic!.id)).toBeCloseTo(10, 9);
  });

  it("imports the in-progress shopping list with a mix of checked items and no stock changes", () => {
    const lists = listShoppingLists(test.ctx).items;
    expect(lists).toHaveLength(1);

    const detail = getShoppingList(test.ctx, lists[0]!.id);
    expect(detail.list).toMatchObject({
      status: "shopping",
      completedAt: null,
      title: `Shopping - week of ${WEEK_START}`,
    });
    expect(detail.list.mealPlanId).toBe(getPlan(test.ctx, WEEK_START).id);
    expect(detail.items).toHaveLength(44);
    expect(detail.counts).toMatchObject({ total: 44, checked: 18, remaining: 26 });

    for (const item of detail.items) {
      expect(item.source).toBe("manual");
    }

    // The pantry snapshot is independent of the list: no purchase movements.
    const movements = listMovements(test.ctx, { limit: 200 });
    expect(movements.filter((movement) => movement.reason === "purchase")).toHaveLength(0);
  });

  it("checks every seeded recipe against the household rules", () => {
    const recipes = searchRecipes(test.ctx, {}).items;
    expect(recipes).toHaveLength(15);

    // Keyword rules match whole words only, so "ham" does not fire on the
    // "hamburger meat" alias of Ground beef; no seeded recipe violates a rule.
    for (const recipe of recipes) {
      const check = checkRecipe(test.ctx, recipe.id);
      expect(check.violations).toEqual([]);
      expect(check.ok).toBe(true);
    }

    const bySlug = new Map(recipes.map((recipe) => [recipe.slug, recipe]));
    const chili = checkRecipe(test.ctx, bySlug.get("slow-cooker-chili")!.id);
    expect(chili.spice).toEqual({ recipeLevel: "mild", householdLevel: "mild", exceeds: false });
  });

  it("records the seed provenance on each recipe's status event", () => {
    const declared = new Map(parseSeed(SEED_JSON).recipes.map((recipe) => [recipe.key, recipe.status]));
    for (const recipe of searchRecipes(test.ctx, {}).items) {
      const history = listStatusHistory(test.ctx, recipe.id).items;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        status: declared.get(recipe.slug),
        rating: null,
        note: "Seeded from example.json",
      });
    }
  });

  it("computes plan demand from the planned servings", () => {
    const plan = getPlan(test.ctx, WEEK_START);
    const beef = findIngredientByName(test.ctx, "Ground beef");
    const demand = computeDemand(test.ctx, { mealPlanId: plan.id });
    const line = demand.find((entry) => entry.ingredientId === beef!.id);
    expect(line).toBeDefined();
    // chili: 2 lb scaled 6/8 = 1.5 lb; ground beef & broccoli: 1 lb at 4/4.
    expect(line?.unit).toBe("lb");
    expect(line?.qty).toBeCloseTo(2.5);
    expect(line?.unconvertible).toEqual([]);
    expect(line?.uses.map((use) => use.recipeTitle).sort()).toEqual([
      "Easy Slow Cooker Chili",
      "Ground Beef and Broccoli",
    ]);
  });

  it("refuses a second load into the populated household", () => {
    const error = asAppError(errorFrom(() => loadSeed(test.ctx, structuredClone(SEED_JSON))));
    expect(error.code).toBe("conflict");
    expect(error.details).toMatchObject({ ingredients: 100, recipes: 15 });

    expect(listIngredients(test.ctx)).toHaveLength(100);
    expect(listPantry(test.ctx)).toHaveLength(51);
  });
});

describe("loadSeed validation", () => {
  it("rejects ingredient references that are not declared", () => {
    const test = makeTestCtx();
    const data = structuredClone(SEED_JSON) as SeedData;
    data.recipes[0]!.ingredients[0]!.ingredient = "Unicorn tears";

    const error = asAppError(errorFrom(() => loadSeed(test.ctx, data)));
    expect(error.code).toBe("validation");
    expect(error.details).toMatchObject({ unresolved: ["Unicorn tears"] });
    expect(listIngredients(test.ctx)).toHaveLength(0);
  });

  it("rejects units the unit service does not know, before writing anything", () => {
    const test = makeTestCtx();
    const data = structuredClone(SEED_JSON) as SeedData;
    data.recipes[0]!.ingredients[0]!.unit = "furlong";

    const error = asAppError(errorFrom(() => loadSeed(test.ctx, data)));
    expect(error.code).toBe("unprocessable");
    expect(error.details).toMatchObject({ unresolvedUnits: [expect.objectContaining({ unit: "furlong" })] });
    expect(listIngredients(test.ctx)).toHaveLength(0);
  });

  it("imports step links by ingredient index", () => {
    const test = makeTestCtx();
    const data = structuredClone(SEED_JSON) as SeedData;
    const recipe = data.recipes[0]!;
    recipe.steps[0] = { ...recipe.steps[0]!, links: [{ ingredientIndex: 0, qty: 1 }] };

    loadSeed(test.ctx, data);

    const view = getRecipe(test.ctx, recipe.key);
    expect(view.steps[0]!.links).toHaveLength(1);
    expect(view.steps[0]!.links[0]).toMatchObject({
      recipeIngredientId: view.ingredients[0]!.id,
      ingredientName: view.ingredients[0]!.ingredient.name,
      qty: 1,
      unit: view.ingredients[0]!.unit,
    });
  });

  it("rejects a step link that points outside the recipe's ingredient list", () => {
    const test = makeTestCtx();
    const data = structuredClone(SEED_JSON) as SeedData;
    const recipe = data.recipes[0]!;
    recipe.steps[0] = {
      ...recipe.steps[0]!,
      links: [{ ingredientIndex: recipe.ingredients.length, qty: null }],
    };

    const error = asAppError(errorFrom(() => loadSeed(test.ctx, data)));
    expect(error.code).toBe("validation");
    expect(listIngredients(test.ctx)).toHaveLength(0);
  });
});
