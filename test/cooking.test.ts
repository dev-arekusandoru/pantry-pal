import { describe, expect, it } from "vitest";
import type { Ctx } from "../src/context.js";
import type { ErrorCode } from "../src/lib/errors.js";
import { AppError } from "../src/lib/errors.js";
import {
  completeCookEvent,
  cookAdHoc,
  listCookEvents,
  reopenCookEvent,
  skipCookEvent,
  undoCookEvent,
} from "../src/services/cooking.js";
import { resolveIngredient } from "../src/services/ingredients.js";
import { applyMovement, getStockForIngredient } from "../src/services/pantry.js";
import { addCookEvent, createPlan, listPlans } from "../src/services/plans.js";
import { createRecipe } from "../src/services/recipes.js";
import { makeTestCtx } from "./helpers.js";

function expectAppError(fn: () => unknown, code: ErrorCode): AppError {
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

function stockAt(ctx: Ctx, ingredientId: string, location: string) {
  return getStockForIngredient(ctx, ingredientId).find((row) => row.location === location);
}

function addCook(ctx: Ctx, recipeId: string, plannedServings = 2) {
  const plan = listPlans(ctx).items[0] ?? createPlan(ctx, { weekStart: "2026-11-02" });
  return addCookEvent(ctx, plan.id, {
    recipeId,
    cookDate: "2026-11-02",
    plannedServings,
  });
}

function kitchen() {
  const { ctx } = makeTestCtx();
  const chicken = resolveIngredient(ctx, "chicken breast", { create: true });
  const oil = resolveIngredient(ctx, "olive oil", { create: true });
  const salt = resolveIngredient(ctx, "salt", { create: true });
  const sesame = resolveIngredient(ctx, "sesame seeds", { create: true });

  const recipe = createRecipe(ctx, {
    title: "Chicken skillet",
    servings: 2,
    ingredients: [
      { ingredientId: chicken.id, qty: 1, unit: "lb" },
      { ingredientId: oil.id, qty: 2, unit: "tbsp", optional: true },
      { ingredientId: salt.id, qty: null, unit: null, scalingExempt: true },
      { ingredientId: sesame.id, qty: 1, unit: "tbsp" },
    ],
  });

  applyMovement(ctx, {
    ingredientId: chicken.id,
    location: "fridge",
    kind: "set",
    qty: 3,
    unit: "lb",
    reason: "purchase",
  });
  applyMovement(ctx, {
    ingredientId: oil.id,
    location: "pantry",
    kind: "set",
    qty: 1,
    unit: "cup",
    reason: "purchase",
  });

  return { ctx, chicken, oil, salt, sesame, recipe };
}

describe("completeCookEvent", () => {
  it("decrements scaled ingredients, skips optional items and warns about untracked/unmeasured ones", () => {
    const { ctx, chicken, oil, recipe } = kitchen();
    const event = addCook(ctx, recipe.id, 2);

    const result = completeCookEvent(ctx, event.id, { actualServings: 4 });

    expect(result.cookEvent.status).toBe("done");
    expect(result.cookEvent.actualServings).toBe(4);
    expect(result.cookEvent.completedAt).not.toBeNull();

    // Chicken 1 lb × (4/2) = 2 lb from the 3 lb stock; optional oil and unmeasured salt are skipped.
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.reason).toBe("cook");
    expect(result.movements[0]!.refType).toBe("cook_event");
    expect(result.movements[0]!.refId).toBe(event.id);
    expect(result.movements[0]!.qty).toBeCloseTo(-2, 6);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(1, 6);

    // Optional ingredients are never decremented.
    expect(stockAt(ctx, oil.id, "pantry")?.qty).toBeCloseTo(1, 6);

    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("not tracked in pantry");
    expect(warnings).toContain("without a quantity");
    expect(warnings).toContain("salt");
  });

  it("picks the matching-unit pantry row with the most stock", () => {
    const { ctx } = makeTestCtx();
    const oil = resolveIngredient(ctx, "olive oil", { create: true });
    const recipe = createRecipe(ctx, {
      title: "Garlic oil",
      servings: 2,
      ingredients: [{ ingredientId: oil.id, qty: 4, unit: "tbsp" }],
    });
    applyMovement(ctx, {
      ingredientId: oil.id,
      location: "fridge",
      kind: "set",
      qty: 0.25,
      unit: "cup",
      reason: "purchase",
    });
    applyMovement(ctx, {
      ingredientId: oil.id,
      location: "pantry",
      kind: "set",
      qty: 1,
      unit: "cup",
      reason: "purchase",
    });

    const event = addCook(ctx, recipe.id, 2);
    const result = completeCookEvent(ctx, event.id);

    const pantryRow = stockAt(ctx, oil.id, "pantry")!;
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.pantryItemId).toBe(pantryRow.id);
    expect(result.movements[0]!.qty).toBeCloseTo(-4, 6);
    expect(result.movements[0]!.unit).toBe("tbsp");
    expect(stockAt(ctx, oil.id, "pantry")?.qty).toBeCloseTo(0.75, 6);
    expect(stockAt(ctx, oil.id, "fridge")?.qty).toBeCloseTo(0.25, 6);
  });

  it("completes a recipe without ingredients with a warning and no movements", () => {
    const { ctx } = makeTestCtx();
    const toast = createRecipe(ctx, { title: "Toast", servings: 1 });
    const event = addCook(ctx, toast.id, 1);

    const result = completeCookEvent(ctx, event.id);

    expect(result.cookEvent.status).toBe("done");
    expect(result.cookEvent.actualServings).toBe(1);
    expect(result.movements).toHaveLength(0);
    expect(result.warnings.join("\n")).toContain("no ingredients");
  });

  it("can complete without touching the pantry when decrementPantry=false", () => {
    const { ctx, chicken, recipe } = kitchen();
    const event = addCook(ctx, recipe.id, 2);

    const result = completeCookEvent(ctx, event.id, { decrementPantry: false });

    expect(result.cookEvent.status).toBe("done");
    expect(result.movements).toHaveLength(0);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(3, 6);
  });

  it("rejects a second completion and completing a skipped cook", () => {
    const { ctx, recipe } = kitchen();
    const event = addCook(ctx, recipe.id, 2);

    completeCookEvent(ctx, event.id);
    expectAppError(() => completeCookEvent(ctx, event.id), "conflict");

    const skippedEvent = addCook(ctx, recipe.id, 2);
    skipCookEvent(ctx, skippedEvent.id);
    expectAppError(() => completeCookEvent(ctx, skippedEvent.id), "conflict");
  });

  it("records only the stock that was actually removed when the pantry runs short", () => {
    const { ctx } = makeTestCtx();
    const chicken = resolveIngredient(ctx, "chicken breast", { create: true });
    const recipe = createRecipe(ctx, {
      title: "Roast chicken",
      servings: 2,
      ingredients: [{ ingredientId: chicken.id, qty: 2, unit: "lb" }],
    });
    applyMovement(ctx, {
      ingredientId: chicken.id,
      location: "fridge",
      kind: "set",
      qty: 1,
      unit: "lb",
      reason: "purchase",
    });
    const event = addCook(ctx, recipe.id, 2);

    const result = completeCookEvent(ctx, event.id);

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.qty).toBeCloseTo(-1, 6);
    expect(result.movements[0]!.qtyAfter).toBeCloseTo(0, 6);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(0, 6);
  });

  it("clamps the requested amount in the ingredient unit when the pantry row uses another unit", () => {
    const { ctx } = makeTestCtx();
    const oil = resolveIngredient(ctx, "olive oil", { create: true });
    const recipe = createRecipe(ctx, {
      title: "Dressing",
      servings: 2,
      ingredients: [{ ingredientId: oil.id, qty: 8, unit: "tbsp" }],
    });
    applyMovement(ctx, {
      ingredientId: oil.id,
      location: "pantry",
      kind: "set",
      qty: 0.25,
      unit: "cup",
      reason: "purchase",
    });
    const event = addCook(ctx, recipe.id, 2);

    const result = completeCookEvent(ctx, event.id);

    // 0.25 cup = 4 tbsp, so only 4 of the requested 8 tbsp leave the pantry.
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.qty).toBeCloseTo(-4, 6);
    expect(result.movements[0]!.unit).toBe("tbsp");
    expect(stockAt(ctx, oil.id, "pantry")?.qty).toBeCloseTo(0, 6);
  });

  it("writes no movement when the chosen pantry row is already out", () => {
    const { ctx } = makeTestCtx();
    const chicken = resolveIngredient(ctx, "chicken breast", { create: true });
    const recipe = createRecipe(ctx, {
      title: "Chicken soup",
      servings: 2,
      ingredients: [{ ingredientId: chicken.id, qty: 1, unit: "lb" }],
    });
    applyMovement(ctx, {
      ingredientId: chicken.id,
      location: "fridge",
      kind: "set",
      qty: 0,
      unit: "lb",
      reason: "purchase",
    });
    const event = addCook(ctx, recipe.id, 2);

    const result = completeCookEvent(ctx, event.id);

    expect(result.movements).toHaveLength(0);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(0, 6);
    expect(reopenCookEvent(ctx, event.id).movements).toHaveLength(0);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(0, 6);
  });
});

describe("skipCookEvent", () => {
  it("marks a planned cook skipped and records the note", () => {
    const { ctx, recipe } = kitchen();
    const event = addCook(ctx, recipe.id, 2);

    const skipped = skipCookEvent(ctx, event.id, { note: "Takeout instead" });
    expect(skipped.status).toBe("skipped");
    expect(skipped.notes).toContain("Takeout instead");
    expect(skipped.completedAt).toBeNull();

    expectAppError(() => skipCookEvent(ctx, event.id), "conflict");
    expectAppError(() => reopenCookEvent(ctx, event.id), "conflict");
  });
});

describe("reopenCookEvent", () => {
  it("restores stock with compensating adjust movements", () => {
    const { ctx, chicken, recipe } = kitchen();
    const event = addCook(ctx, recipe.id, 2);

    completeCookEvent(ctx, event.id, { actualServings: 4 });
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(1, 6);

    const reopened = reopenCookEvent(ctx, event.id);

    expect(reopened.cookEvent.status).toBe("planned");
    expect(reopened.cookEvent.actualServings).toBeNull();
    expect(reopened.cookEvent.completedAt).toBeNull();
    expect(reopened.movements).toHaveLength(1);
    expect(reopened.movements[0]!.reason).toBe("adjust");
    expect(reopened.movements[0]!.qty).toBeCloseTo(2, 6);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(3, 6);

    expectAppError(() => reopenCookEvent(ctx, event.id), "conflict");
  });

  it("restores exactly the clamped amount, never inventing stock", () => {
    const { ctx } = makeTestCtx();
    const chicken = resolveIngredient(ctx, "chicken breast", { create: true });
    const recipe = createRecipe(ctx, {
      title: "Roast chicken",
      servings: 2,
      ingredients: [{ ingredientId: chicken.id, qty: 2, unit: "lb" }],
    });
    applyMovement(ctx, {
      ingredientId: chicken.id,
      location: "fridge",
      kind: "set",
      qty: 1,
      unit: "lb",
      reason: "purchase",
    });
    const event = addCook(ctx, recipe.id, 2);

    completeCookEvent(ctx, event.id);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(0, 6);

    const reopened = reopenCookEvent(ctx, event.id);

    expect(reopened.movements).toHaveLength(1);
    expect(reopened.movements[0]!.qty).toBeCloseTo(1, 6);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(1, 6);
  });
});

describe("undoCookEvent", () => {
  it("restores stock and returns a planned cook to planned", () => {
    const { ctx, chicken, recipe } = kitchen();
    const event = addCook(ctx, recipe.id, 2);
    completeCookEvent(ctx, event.id);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(2, 6);

    const undone = undoCookEvent(ctx, event.id);

    expect(undone.deleted).toBe(false);
    expect(undone.cookEvent?.id).toBe(event.id);
    expect(undone.cookEvent?.status).toBe("planned");
    expect(undone.cookEvent?.actualServings).toBeNull();
    expect(undone.movements).toHaveLength(1);
    expect(undone.movements[0]!.note).toContain("Undid");
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(3, 6);

    expectAppError(() => undoCookEvent(ctx, event.id), "conflict");
  });

  it("deletes a completed ad-hoc cook nothing references", () => {
    const { ctx, chicken, recipe } = kitchen();
    const completed = cookAdHoc(ctx, {
      recipeId: recipe.id,
      servings: 2,
      cookDate: "2026-11-01",
      complete: true,
    });
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(2, 6);

    const undone = undoCookEvent(ctx, completed.cookEvent.id);

    expect(undone.deleted).toBe(true);
    expect(undone.cookEvent).toBeNull();
    expect(undone.movements).toHaveLength(1);
    expect(stockAt(ctx, chicken.id, "fridge")?.qty).toBeCloseTo(3, 6);
    expect(listCookEvents(ctx).items).toEqual([]);
    expectAppError(() => undoCookEvent(ctx, completed.cookEvent.id), "not_found");
  });
});
