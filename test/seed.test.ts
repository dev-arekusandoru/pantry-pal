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
import { listStatusHistory, searchRecipes } from "../src/services/recipes.js";
import { checkRecipe } from "../src/services/rules.js";
import { getShoppingList, listShoppingLists } from "../src/services/shopping.js";
import { convert } from "../src/services/units.js";
import { makeTestCtx, type TestContext } from "./helpers.js";

const SEED_JSON = JSON.parse(
  readFileSync(new URL("../seed/example.json", import.meta.url), "utf8"),
) as unknown;

const COMPLETED_AT = "2026-02-01T16:00:00.000Z";

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
      ingredients: 65,
      unitConversions: 16,
      pantryItems: 46,
      stockMovements: 46,
      dietaryRules: 11,
      recipes: 8,
      mealPlans: 1,
      cookEvents: 12,
      mealSlots: 21,
      prepTasks: 7,
      shoppingLists: 1,
      shoppingListItems: 33,
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
    expect(listIngredients(test.ctx)).toHaveLength(65);
  });

  it("loads through the service layer without warnings", () => {
    expect(result.warnings).toEqual([]);
  });

  it("applies the household and its members", () => {
    const household = getHousehold(test.db, test.ctx.householdId);
    expect(household.name).toBe("Example Household");
    expect(household.timezone).toBe("UTC");
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

  it("links the chili cook on Nov 1 to the Mon-Wed lunch slots, all leftovers", () => {
    const plan = getPlan(test.ctx, "2026-02-02");
    expect(plan.status).toBe("active");
    expect(plan.cookEvents).toHaveLength(12);

    const chili = plan.cookEvents.find((event) => event.label === "Batch A - lunch (Mon-Wed)");
    expect(chili).toBeDefined();
    expect(chili?.recipeTitle).toBe("Easy Slow Cooker Chili");
    expect(chili?.cookDate).toBe("2026-02-01");
    expect(chili?.status).toBe("planned");
    expect(chili?.plannedServings).toBe(6);

    const lunchSlots = plan.days
      .flatMap((day) => day.meals.lunch.map((slot) => ({ date: day.date, slot })))
      .filter(({ slot }) => slot.cookEventId === chili?.id);

    expect(lunchSlots.map(({ date }) => date)).toEqual([
      "2026-02-02",
      "2026-02-03",
      "2026-02-04",
    ]);
    // The chili is cooked on 2026-02-01, so every later lunch is a leftover
    // (isLeftover = slot.date > cookDate).
    expect(lunchSlots.map(({ slot }) => slot.isLeftover)).toEqual([true, true, true]);
    expect(lunchSlots.map(({ slot }) => slot.servings)).toEqual([2, 2, 2]);

    const freeform = plan.days
      .flatMap((day) => day.meals.lunch.map((slot) => ({ date: day.date, slot })))
      .find(({ date }) => date === "2026-02-08");
    expect(freeform?.slot).toMatchObject({
      kind: "freeform",
      label: "Leftovers / fridge clean-out",
      cookEventId: null,
    });

    const allSlots = plan.days.reduce(
      (sum, day) =>
        sum +
        Object.values(day.meals).reduce((count, slots) => count + slots.length, 0),
      0,
    );
    expect(allSlots).toBe(21);
  });

  it("imports the pantry snapshot without fabricating purchases", () => {
    const beef = findIngredientByName(test.ctx, "Ground beef");
    expect(beef).not.toBeNull();
    const stock = getStockForIngredient(test.ctx, beef!.id);
    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({
      location: "fridge",
      qty: 3,
      unit: "lb",
      status: "on_hand",
      qtyApprox: false,
      rawText: "Ground beef | 3 lb | protein | 2026-02-01",
      note: null,
    });

    const beefMovements = listMovements(test.ctx, { ingredientId: beef!.id });
    expect(beefMovements).toHaveLength(1);
    expect(beefMovements[0]).toMatchObject({
      kind: "set",
      reason: "import",
      refType: "seed",
      refId: null,
      qty: 3,
      unit: "lb",
      qtyAfter: 3,
      statusAfter: "on_hand",
    });

    // An "on hand" line keeps a null quantity and stays "on_hand", not "unknown".
    const salt = findIngredientByName(test.ctx, "Salt");
    const saltStock = getStockForIngredient(test.ctx, salt!.id);
    expect(saltStock[0]).toMatchObject({
      qty: null,
      unit: null,
      status: "on_hand",
      rawText: "Salt | on hand | spice | 2026-02-01",
    });

    const movements = listMovements(test.ctx, { limit: 200 });
    expect(movements).toHaveLength(46);
    expect(movements.every((movement) => movement.reason === "import")).toBe(true);
    expect(
      movements.every((movement) => movement.refType === "seed" && movement.refId === null),
    ).toBe(true);
  });

  it("makes recipe units comparable to pantry units", () => {
    const tomatoes = findIngredientByName(test.ctx, "Diced tomatoes with green chilies");
    const garlic = findIngredientByName(test.ctx, "Garlic");
    expect(convert(test.ctx, 2, "can", "oz", tomatoes!.id)).toBeCloseTo(29);
    expect(convert(test.ctx, 1, "head", "clove", garlic!.id)).toBe(10);
  });

  it("imports the historical shopping list as done, fully checked, with no stock changes", () => {
    const lists = listShoppingLists(test.ctx).items;
    expect(lists).toHaveLength(1);

    const detail = getShoppingList(test.ctx, lists[0]!.id);
    expect(detail.list).toMatchObject({
      status: "done",
      completedAt: COMPLETED_AT,
      title: "Week of Mon Feb 2 - Sun Feb 8, 2026",
    });
    expect(detail.list.mealPlanId).toBe(getPlan(test.ctx, "2026-02-02").id);
    expect(detail.items).toHaveLength(33);
    expect(detail.counts).toMatchObject({ total: 33, checked: 33, remaining: 0 });

    for (const item of detail.items) {
      expect(item.source).toBe("manual");
      expect(item.checkedAt).toBe(COMPLETED_AT);
      expect(item.actualQty).toBe(item.qty);
      expect(item.actualUnit).toBe(item.unit);
    }

    // The pantry snapshot already includes the trip: no purchase movements.
    const movements = listMovements(test.ctx, { limit: 200 });
    expect(movements.filter((movement) => movement.reason === "purchase")).toHaveLength(0);
  });

  it("checks every seeded recipe against the household rules", () => {
    const recipes = searchRecipes(test.ctx, {}).items;
    expect(recipes).toHaveLength(8);

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
    for (const recipe of searchRecipes(test.ctx, {}).items) {
      const history = listStatusHistory(test.ctx, recipe.id).items;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        status: "want_to_try",
        rating: null,
        note: "Seeded from example.json",
      });
    }
  });

  it("computes plan demand from the planned servings", () => {
    const plan = getPlan(test.ctx, "2026-02-02");
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
    expect(error.details).toMatchObject({ ingredients: 65, recipes: 8 });

    expect(listIngredients(test.ctx)).toHaveLength(65);
    expect(listPantry(test.ctx)).toHaveLength(46);
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
    expect(error.code).toBe("validation");
    expect(Array.isArray(error.details?.issues)).toBe(true);
    expect(listIngredients(test.ctx)).toHaveLength(0);
  });
});
