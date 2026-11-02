import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cookEvents, recipeIngredients } from "../src/db/schema.js";
import { AppError } from "../src/lib/errors.js";
import { findIngredientByName } from "../src/services/ingredients.js";
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  listStatusHistory,
  scaleRecipeIngredients,
  searchRecipes,
  setRecipeStatus,
  updateRecipe,
} from "../src/services/recipes.js";
import { FIXED_NOW, makeTestCtx } from "./helpers.js";

function expectAppError(fn: () => unknown, code: AppError["code"]): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe(code);
    return appError;
  }
  throw new Error(`Expected an AppError with code ${code}`);
}

/** Clock that advances one second per read, so event ordering is deterministic. */
function tickingClock(start: Date = FIXED_NOW): () => Date {
  let time = start.getTime();
  return () => {
    time += 1000;
    return new Date(time);
  };
}

describe("createRecipe", () => {
  it("auto-creates ingredients, normalizes units and keeps array order", () => {
    const { ctx } = makeTestCtx();

    const recipe = createRecipe(ctx, {
      title: "Weeknight Chili",
      servings: 4,
      tags: ["spicy", "one-pot"],
      ingredients: [
        { ingredient: "Ground beef", category: "protein", qty: 1, unit: "pounds" },
        { ingredient: "Yellow onion", qty: 1, unit: "each" },
        {
          ingredient: "Kosher salt",
          qty: null,
          unit: "Tbsp",
          scalingExempt: true,
          optional: true,
          prepNote: "to taste",
        },
      ],
      steps: [{ text: "Brown the beef." }, { text: "Simmer.", durationMinutes: 30 }],
    });

    expect(recipe.slug).toBe("weeknight-chili");
    expect(recipe.servings).toBe(4);
    expect(recipe.status).toBe("want_to_try");
    expect(recipe.ingredients.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(recipe.ingredients.map((item) => item.unit)).toEqual(["lb", "count", "tbsp"]);
    expect(recipe.ingredients[0]!.ingredient).toMatchObject({
      name: "Ground beef",
      category: "protein",
    });
    expect(recipe.ingredients[2]).toMatchObject({
      qty: null,
      optional: true,
      scalingExempt: true,
      prepNote: "to taste",
    });
    expect(recipe.steps.map((step) => step.position)).toEqual([0, 1]);
    expect(recipe.steps[1]!.durationMinutes).toBe(30);
    expect(recipe.stats).toEqual({ timesCooked: 0, lastCookedAt: null });

    // The ingredient exists in the catalog and the recipe points at it.
    const beef = findIngredientByName(ctx, "ground beef");
    expect(beef?.id).toBe(recipe.ingredients[0]!.ingredientId);
  });

  it("derives totalMinutes from prep + cook when omitted", () => {
    const { ctx } = makeTestCtx();
    const recipe = createRecipe(ctx, { title: "Quick Pasta", prepMinutes: 10, cookMinutes: 15 });
    expect(recipe.totalMinutes).toBe(25);
  });

  it("writes the initial status event", () => {
    const { ctx } = makeTestCtx();
    const recipe = createRecipe(ctx, { title: "Fresh Recipe" });
    const history = listStatusHistory(ctx, recipe.id);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      recipeId: recipe.id,
      status: "want_to_try",
      rating: null,
      note: null,
    });
  });

  it("rejects an unknown explicit ingredient id", () => {
    const { ctx } = makeTestCtx();
    expectAppError(
      () =>
        createRecipe(ctx, {
          title: "Broken",
          ingredients: [{ ingredientId: "ing_missing", qty: 1 }],
        }),
      "not_found",
    );
  });

  it("rejects an inverted quantity range", () => {
    const { ctx } = makeTestCtx();
    expectAppError(
      () =>
        createRecipe(ctx, {
          title: "Bad range",
          ingredients: [{ ingredient: "Rice", qty: 2, qtyMax: 1 }],
        }),
      "validation",
    );
  });
});

describe("recipe slugs", () => {
  it("suffixes collisions per household", () => {
    const { ctx } = makeTestCtx();

    const first = createRecipe(ctx, { title: "Grandma's Chili!" });
    const second = createRecipe(ctx, { title: "Grandma's Chili!" });
    const third = createRecipe(ctx, { title: "Something else", slug: "Grandma's Chili!" });

    expect(first.slug).toBe("grandma-s-chili");
    expect(second.slug).toBe("grandma-s-chili-2");
    expect(third.slug).toBe("grandma-s-chili-3");
  });

  it("resolves recipes by slug and by id", () => {
    const { ctx } = makeTestCtx();
    const created = createRecipe(ctx, { title: "Find Me", servings: 3 });

    expect(getRecipe(ctx, created.slug).id).toBe(created.id);
    expect(getRecipe(ctx, created.id).title).toBe("Find Me");
    expectAppError(() => getRecipe(ctx, "nope"), "not_found");
  });
});

describe("updateRecipe", () => {
  it("replaces ingredient and step lists in full", () => {
    const { ctx } = makeTestCtx();
    const created = createRecipe(ctx, {
      title: "Soup",
      ingredients: [
        { ingredient: "Carrot", qty: 3, unit: "each" },
        { ingredient: "Celery", qty: 2, unit: "stalks" },
        { ingredient: "Onion", qty: 1, unit: "each" },
      ],
      steps: [{ text: "Chop everything." }, { text: "Simmer." }],
    });

    const updated = updateRecipe(ctx, created.id, {
      title: "Carrot Soup",
      ingredients: [{ ingredient: "Carrot", qty: 6, unit: "each", groupLabel: "Base" }],
      steps: [{ text: "Blend." }],
    });

    expect(updated.title).toBe("Carrot Soup");
    expect(updated.slug).toBe("soup"); // slug is stable unless explicitly changed
    expect(updated.ingredients).toHaveLength(1);
    expect(updated.ingredients[0]).toMatchObject({ qty: 6, position: 0, groupLabel: "Base" });
    expect(updated.ingredients[0]!.ingredient.name).toBe("Carrot");
    expect(updated.steps).toHaveLength(1);
    expect(updated.steps[0]).toMatchObject({ text: "Blend.", position: 0 });

    const remaining = ctx.db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, created.id))
      .all();
    expect(remaining).toHaveLength(1);
  });

  it("lets nullable fields be cleared explicitly", () => {
    const { ctx } = makeTestCtx();
    const created = createRecipe(ctx, {
      title: "Notes Recipe",
      notes: "Use the big pot",
      cuisine: "Thai",
    });

    const updated = updateRecipe(ctx, created.id, { notes: null });
    expect(updated.notes).toBeNull();
    expect(updated.cuisine).toBe("Thai");
  });

  it("records a status event when the status changes through a patch", () => {
    const { ctx } = makeTestCtx({ now: tickingClock() });
    const created = createRecipe(ctx, { title: "Patch Status" });

    updateRecipe(ctx, created.id, { status: "rotation" });
    const history = listStatusHistory(ctx, created.id);

    expect(history.items).toHaveLength(2);
    expect(history.items[0]!.status).toBe("rotation");
  });
});

describe("scaleRecipeIngredients", () => {
  it("scales quantities, qtyMax and leaves exempt or unmeasured lines untouched", () => {
    const { ctx } = makeTestCtx();
    const recipe = createRecipe(ctx, {
      title: "Scale Me",
      servings: 4,
      ingredients: [
        { ingredient: "Chicken thighs", qty: 2, qtyMax: 3, unit: "lb" },
        { ingredient: "Salt", qty: 1, unit: "tsp", scalingExempt: true },
        { ingredient: "Black pepper", qty: null, unit: "tsp" },
      ],
    });

    const doubled = scaleRecipeIngredients(ctx, recipe.id, 8);
    expect(doubled.map((item) => [item.qty, item.qtyMax])).toEqual([
      [4, 6],
      [1, null],
      [null, null],
    ]);
    expect(doubled[1]!.scalingExempt).toBe(true);
    expect(doubled[0]).toMatchObject({
      ingredientName: "Chicken thighs",
      category: "other",
      unit: "lb",
      optional: false,
    });

    const halved = scaleRecipeIngredients(ctx, recipe.id, 2);
    expect(halved[0]).toMatchObject({ qty: 1, qtyMax: 1.5 });

    expectAppError(() => scaleRecipeIngredients(ctx, recipe.id, 0), "validation");
  });
});

describe("setRecipeStatus", () => {
  it("updates the recipe and appends history, newest first", () => {
    const { ctx } = makeTestCtx({ now: tickingClock() });
    const created = createRecipe(ctx, { title: "Status Recipe" });

    const first = setRecipeStatus(ctx, created.id, {
      status: "rotation",
      rating: 5,
      note: "Sunday favorite",
    });
    expect(first.recipe.status).toBe("rotation");
    expect(first.recipe.rating).toBe(5);
    expect(first.event).toMatchObject({ status: "rotation", rating: 5, note: "Sunday favorite" });

    setRecipeStatus(ctx, created.id, { status: "archived" });

    const history = listStatusHistory(ctx, created.id);
    expect(history.items.map((event) => event.status)).toEqual([
      "archived",
      "rotation",
      "want_to_try",
    ]);
    expect(history.items[1]).toMatchObject({ rating: 5, note: "Sunday favorite" });
    expect(getRecipe(ctx, created.id).status).toBe("archived");
  });

  it("rejects an out-of-range rating", () => {
    const { ctx } = makeTestCtx();
    const created = createRecipe(ctx, { title: "Rated" });
    expectAppError(() => setRecipeStatus(ctx, created.id, { status: "rotation", rating: 9 }), "validation");
  });
});

describe("recipe stats", () => {
  it("counts done cook events and reports the latest cook", () => {
    const { ctx } = makeTestCtx();
    const recipe = createRecipe(ctx, { title: "Cooked Twice" });

    ctx.db
      .insert(cookEvents)
      .values([
        {
          id: "ce_test_1",
          householdId: ctx.householdId,
          recipeId: recipe.id,
          cookDate: "2026-10-20",
          plannedServings: 4,
          status: "done",
          completedAt: "2026-10-20T18:00:00.000Z",
        },
        {
          id: "ce_test_2",
          householdId: ctx.householdId,
          recipeId: recipe.id,
          cookDate: "2026-10-27",
          plannedServings: 4,
          status: "done",
          completedAt: "2026-10-27T18:00:00.000Z",
        },
        {
          id: "ce_test_3",
          householdId: ctx.householdId,
          recipeId: recipe.id,
          cookDate: "2026-11-05",
          plannedServings: 4,
          status: "planned",
        },
      ])
      .run();

    expect(getRecipe(ctx, recipe.id).stats).toEqual({
      timesCooked: 2,
      lastCookedAt: "2026-10-27T18:00:00.000Z",
    });
  });
});

describe("searchRecipes", () => {
  function seed() {
    const test = makeTestCtx();
    const chili = createRecipe(test.ctx, {
      title: "Weeknight Chili",
      description: "Fast dinner",
      tags: ["spicy"],
      totalMinutes: 45,
      ingredients: [{ ingredient: "Ground beef", category: "protein", qty: 1, unit: "lb" }],
    });
    createRecipe(test.ctx, {
      title: "Overnight Oats",
      tags: ["morning"],
      totalMinutes: 10,
      status: "rotation",
      ingredients: [{ ingredient: "Rolled oats", qty: 1, unit: "cup" }],
    });
    return { ...test, chili };
  }

  it("matches title, description and tags case-insensitively", () => {
    const { ctx } = seed();

    expect(searchRecipes(ctx, { query: "chili" }).items.map((r) => r.title)).toEqual([
      "Weeknight Chili",
    ]);
    expect(searchRecipes(ctx, { query: "FAST" }).items.map((r) => r.title)).toEqual([
      "Weeknight Chili",
    ]);
    expect(searchRecipes(ctx, { query: "spicy" }).items.map((r) => r.title)).toEqual([
      "Weeknight Chili",
    ]);
  });

  it("filters by status, tag, ingredient and total time", () => {
    const { ctx, chili } = seed();

    expect(searchRecipes(ctx, { status: "rotation" }).items.map((r) => r.title)).toEqual([
      "Overnight Oats",
    ]);
    expect(searchRecipes(ctx, { tags: ["SPICY"] }).items.map((r) => r.title)).toEqual([
      "Weeknight Chili",
    ]);
    expect(
      searchRecipes(ctx, { ingredientId: chili.ingredients[0]!.ingredientId }).items.map(
        (r) => r.title,
      ),
    ).toEqual(["Weeknight Chili"]);
    expect(searchRecipes(ctx, { maxTotalMinutes: 20 }).items.map((r) => r.title)).toEqual([
      "Overnight Oats",
    ]);
  });

  it("returns summaries with ingredient counts and stable paging", () => {
    const { ctx } = seed();

    const page = searchRecipes(ctx, { limit: 1, offset: 1 });
    expect(page.total).toBe(2);
    expect(page.limit).toBe(1);
    expect(page.offset).toBe(1);
    expect(page.items).toHaveLength(1);
    // Titles sort alphabetically: Overnight Oats, Weeknight Chili.
    expect(page.items[0]!.title).toBe("Weeknight Chili");
    expect(page.items[0]!.ingredientCount).toBe(1);
    expect(page.items[0]!.timesCooked).toBe(0);
    expect(page.items[0]!.lastCookedAt).toBeNull();
    expect("steps" in page.items[0]!).toBe(false);
  });
});

describe("deleteRecipe", () => {
  it("refuses when cook events reference the recipe, then deletes once free", () => {
    const { ctx } = makeTestCtx();
    const recipe = createRecipe(ctx, { title: "Referenced" });

    ctx.db
      .insert(cookEvents)
      .values({
        id: "ce_delete_1",
        householdId: ctx.householdId,
        recipeId: recipe.id,
        cookDate: "2026-10-20",
        plannedServings: 2,
        status: "planned",
      })
      .run();

    const error = expectAppError(() => deleteRecipe(ctx, recipe.id), "conflict");
    expect(error.details).toMatchObject({ cookEventCount: 1 });

    ctx.db.delete(cookEvents).where(eq(cookEvents.recipeId, recipe.id)).run();
    expect(deleteRecipe(ctx, recipe.id)).toEqual({ deleted: true, id: recipe.id });
    expectAppError(() => getRecipe(ctx, recipe.id), "not_found");
  });
});
