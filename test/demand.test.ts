import { describe, expect, it } from "vitest";
import type { Ctx } from "../src/context.js";
import {
  cookEvents,
  ingredients,
  mealPlans,
  pantryItems,
  recipeIngredients,
  recipes,
  type CookStatus,
  type IngredientCategory,
  type PantryStatus,
  type StorageLocation,
} from "../src/db/schema.js";
import { AppError, type ErrorCode } from "../src/lib/errors.js";
import { newId } from "../src/lib/ids.js";
import { computeAvailability, computeDemand } from "../src/services/demand.js";
import { normalizeName } from "../src/services/ingredients.js";
import { makeTestCtx } from "./helpers.js";

interface IngredientOptions {
  name: string;
  category?: IngredientCategory;
  defaultUnit?: string | null;
}

function addIngredient(ctx: Ctx, options: IngredientOptions): string {
  const id = newId("ing");
  const timestamp = ctx.now().toISOString();
  ctx.db
    .insert(ingredients)
    .values({
      id,
      householdId: ctx.householdId,
      name: options.name,
      normalizedName: normalizeName(options.name),
      category: options.category ?? "other",
      defaultUnit: options.defaultUnit ?? null,
      defaultLocation: "pantry",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

function addRecipe(ctx: Ctx, options: { title: string; servings: number }): string {
  const id = newId("rcp");
  const timestamp = ctx.now().toISOString();
  ctx.db
    .insert(recipes)
    .values({
      id,
      householdId: ctx.householdId,
      title: options.title,
      slug: id,
      servings: options.servings,
      status: "rotation",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

interface RecipeLine {
  recipeId: string;
  ingredientId: string;
  qty: number | null;
  qtyMax?: number | null;
  unit: string | null;
  optional?: boolean;
  position: number;
}

function addRecipeLine(ctx: Ctx, line: RecipeLine): void {
  ctx.db
    .insert(recipeIngredients)
    .values({
      id: newId("ri"),
      householdId: ctx.householdId,
      recipeId: line.recipeId,
      ingredientId: line.ingredientId,
      qty: line.qty,
      qtyMax: line.qtyMax ?? null,
      unit: line.unit,
      optional: line.optional ?? false,
      position: line.position,
    })
    .run();
}

function addPlan(ctx: Ctx, weekStart: string): string {
  const id = newId("plan");
  const timestamp = ctx.now().toISOString();
  ctx.db
    .insert(mealPlans)
    .values({
      id,
      householdId: ctx.householdId,
      weekStart,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

interface CookEventOptions {
  mealPlanId?: string | null;
  recipeId: string;
  cookDate: string;
  plannedServings: number;
  status?: CookStatus;
}

function addCookEvent(ctx: Ctx, event: CookEventOptions): string {
  const id = newId("ce");
  const timestamp = ctx.now().toISOString();
  ctx.db
    .insert(cookEvents)
    .values({
      id,
      householdId: ctx.householdId,
      mealPlanId: event.mealPlanId ?? null,
      recipeId: event.recipeId,
      cookDate: event.cookDate,
      plannedServings: event.plannedServings,
      status: event.status ?? "planned",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

interface PantryOptions {
  ingredientId: string;
  qty: number | null;
  unit?: string | null;
  status?: PantryStatus;
  location?: StorageLocation;
}

function addPantryItem(ctx: Ctx, item: PantryOptions): void {
  const timestamp = ctx.now().toISOString();
  ctx.db
    .insert(pantryItems)
    .values({
      id: newId("pi"),
      householdId: ctx.householdId,
      ingredientId: item.ingredientId,
      location: item.location ?? "pantry",
      qty: item.qty,
      unit: item.unit ?? null,
      status: item.status ?? "on_hand",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

function expectAppError(fn: () => unknown, code: ErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Expected AppError(${code}) but nothing was thrown`);
}

describe("computeDemand", () => {
  it("aggregates scaled quantities across recipes with oz/lb conversion", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, {
      name: "Ground beef",
      category: "protein",
      defaultUnit: "lb",
    });

    const chili = addRecipe(ctx, { title: "Slow Cooker Chili", servings: 4 });
    addRecipeLine(ctx, { recipeId: chili, ingredientId: beef, qty: 16, unit: "oz", position: 0 });

    const broccoli = addRecipe(ctx, { title: "Ground Beef & Broccoli", servings: 4 });
    addRecipeLine(ctx, { recipeId: broccoli, ingredientId: beef, qty: 1, unit: "lb", position: 0 });

    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: chili,
      cookDate: "2026-11-02",
      plannedServings: 4,
    });
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: broccoli,
      cookDate: "2026-11-04",
      plannedServings: 8,
    });

    const demand = computeDemand(ctx, { mealPlanId: plan });

    expect(demand).toHaveLength(1);
    const line = demand[0]!;
    expect(line.ingredientId).toBe(beef);
    expect(line.ingredientName).toBe("Ground beef");
    expect(line.category).toBe("protein");
    expect(line.unit).toBe("lb");
    // 16 oz → 1 lb; 1 lb × (8/4 servings) → 2 lb.
    expect(line.qty).toBe(3);
    expect(line.unconvertible).toEqual([]);
    expect(line.uses).toHaveLength(2);
    expect(line.uses.map((use) => use.recipeTitle)).toEqual([
      "Slow Cooker Chili",
      "Ground Beef & Broccoli",
    ]);
  });

  it("prefers the pantry row unit as the target unit", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    addPantryItem(ctx, { ingredientId: beef, qty: 8, unit: "oz", status: "on_hand" });

    const recipe = addRecipe(ctx, { title: "Chili", servings: 4 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: beef, qty: 16, unit: "oz", position: 0 });
    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: recipe,
      cookDate: "2026-11-02",
      plannedServings: 4,
    });

    const demand = computeDemand(ctx, { mealPlanId: plan });
    expect(demand[0]!.unit).toBe("oz");
    expect(demand[0]!.qty).toBe(16);
  });

  it("excludes optional ingredients unless includeOptional is set", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    const cheese = addIngredient(ctx, { name: "Cheddar", category: "dairy", defaultUnit: "oz" });

    const recipe = addRecipe(ctx, { title: "Cheeseburger bowl", servings: 2 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: beef, qty: 1, unit: "lb", position: 0 });
    addRecipeLine(ctx, {
      recipeId: recipe,
      ingredientId: cheese,
      qty: 2,
      unit: "oz",
      optional: true,
      position: 1,
    });

    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: recipe,
      cookDate: "2026-11-03",
      plannedServings: 2,
    });

    const plain = computeDemand(ctx, { mealPlanId: plan });
    expect(plain.map((line) => line.ingredientId)).toEqual([beef]);

    const withOptional = computeDemand(ctx, { mealPlanId: plan, includeOptional: true });
    expect(withOptional.map((line) => line.ingredientId).sort()).toEqual([beef, cheese].sort());
    const cheeseLine = withOptional.find((line) => line.ingredientId === cheese)!;
    expect(cheeseLine.qty).toBe(2);
    expect(cheeseLine.uses[0]!.optional).toBe(true);
  });

  it("buckets lines that cannot convert into the target unit", () => {
    const { ctx } = makeTestCtx();
    const mystery = addIngredient(ctx, { name: "Mystery mix" });

    const cups = addRecipe(ctx, { title: "Two cups", servings: 1 });
    addRecipeLine(ctx, { recipeId: cups, ingredientId: mystery, qty: 2, unit: "cup", position: 0 });
    const cup = addRecipe(ctx, { title: "One cup", servings: 1 });
    addRecipeLine(ctx, { recipeId: cup, ingredientId: mystery, qty: 1, unit: "cup", position: 0 });
    const pound = addRecipe(ctx, { title: "One pound", servings: 1 });
    addRecipeLine(ctx, { recipeId: pound, ingredientId: mystery, qty: 1, unit: "lb", position: 0 });

    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, { mealPlanId: plan, recipeId: cups, cookDate: "2026-11-02", plannedServings: 1 });
    addCookEvent(ctx, { mealPlanId: plan, recipeId: cup, cookDate: "2026-11-03", plannedServings: 1 });
    addCookEvent(ctx, { mealPlanId: plan, recipeId: pound, cookDate: "2026-11-04", plannedServings: 1 });

    const demand = computeDemand(ctx, { mealPlanId: plan });
    expect(demand).toHaveLength(1);
    const line = demand[0]!;
    expect(line.unit).toBe("cup");
    expect(line.qty).toBe(3);
    expect(line.unconvertible).toEqual([
      { qty: 1, unit: "lb", recipeTitle: "One pound" },
    ]);
  });

  it("ignores done cooks and honours plan and cook-date filters", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    const recipe = addRecipe(ctx, { title: "Beef", servings: 1 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: beef, qty: 1, unit: "lb", position: 0 });

    const firstPlan = addPlan(ctx, "2026-11-02");
    const secondPlan = addPlan(ctx, "2026-11-09");
    addCookEvent(ctx, {
      mealPlanId: firstPlan,
      recipeId: recipe,
      cookDate: "2026-11-03",
      plannedServings: 1,
    });
    addCookEvent(ctx, {
      mealPlanId: secondPlan,
      recipeId: recipe,
      cookDate: "2026-11-09",
      plannedServings: 1,
    });
    addCookEvent(ctx, {
      recipeId: recipe,
      cookDate: "2026-11-04",
      plannedServings: 1,
      status: "done",
    });

    expect(computeDemand(ctx)[0]!.qty).toBe(2);
    expect(computeDemand(ctx, { mealPlanId: secondPlan })[0]!.qty).toBe(1);
    expect(computeDemand(ctx, { from: "2026-11-05" })[0]!.qty).toBe(1);
    expect(computeDemand(ctx, { from: "2026-11-01", to: "2026-11-05" })[0]!.qty).toBe(1);
    expect(computeDemand(ctx, { mealPlanId: firstPlan, from: "2026-11-05" })).toEqual([]);
  });

  it("rejects an unknown meal plan", () => {
    const { ctx } = makeTestCtx();
    expectAppError(() => computeDemand(ctx, { mealPlanId: "plan_missing" }), "not_found");
  });

  it("returns a null quantity when no line is measured", () => {
    const { ctx } = makeTestCtx();
    const salt = addIngredient(ctx, { name: "Salt", category: "spice" });
    const recipe = addRecipe(ctx, { title: "Seasoning", servings: 1 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: salt, qty: null, unit: null, position: 0 });

    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: recipe,
      cookDate: "2026-11-02",
      plannedServings: 1,
    });

    const demand = computeDemand(ctx, { mealPlanId: plan });
    expect(demand[0]!.qty).toBeNull();
    expect(demand[0]!.unit).toBeNull();
    expect(demand[0]!.uses[0]!.qty).toBeNull();
  });

  it("sums ranged quantities into qtyMax", () => {
    const { ctx } = makeTestCtx();
    const onion = addIngredient(ctx, { name: "Yellow onion", category: "produce" });
    const recipe = addRecipe(ctx, { title: "Onion soup", servings: 2 });
    addRecipeLine(ctx, {
      recipeId: recipe,
      ingredientId: onion,
      qty: 1,
      qtyMax: 2,
      unit: "head",
      position: 0,
    });

    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: recipe,
      cookDate: "2026-11-02",
      plannedServings: 2,
    });

    const demand = computeDemand(ctx, { mealPlanId: plan });
    expect(demand[0]!.unit).toBe("head");
    expect(demand[0]!.qty).toBe(1);
    expect(demand[0]!.qtyMax).toBe(2);
  });
});

describe("computeAvailability", () => {
  it("subtracts committed demand from known stock", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    addPantryItem(ctx, { ingredientId: beef, qty: 0.5, unit: "lb", status: "on_hand" });

    const recipe = addRecipe(ctx, { title: "Chili", servings: 4 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: beef, qty: 2, unit: "lb", position: 0 });
    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: recipe,
      cookDate: "2026-11-02",
      plannedServings: 4,
    });

    const lines = computeAvailability(ctx, { mealPlanId: plan });
    const line = lines.find((candidate) => candidate.ingredientId === beef)!;
    expect(line.unit).toBe("lb");
    expect(line.onHand).toBe(0.5);
    expect(line.onHandStatus).toBe("on_hand");
    expect(line.committed).toBe(2);
    expect(line.available).toBe(-1.5);
    expect(line.comparable).toBe(true);
    expect(line.committedBy).toHaveLength(1);
  });

  it("marks unknown stock as incomparable without guessing", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    addPantryItem(ctx, { ingredientId: beef, qty: null, unit: "lb", status: "on_hand" });

    const recipe = addRecipe(ctx, { title: "Chili", servings: 4 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: beef, qty: 2, unit: "lb", position: 0 });
    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: recipe,
      cookDate: "2026-11-02",
      plannedServings: 4,
    });

    const line = computeAvailability(ctx, { mealPlanId: plan }).find(
      (candidate) => candidate.ingredientId === beef,
    )!;
    expect(line.onHand).toBeNull();
    expect(line.onHandStatus).toBe("unknown");
    expect(line.committed).toBe(2);
    expect(line.available).toBeNull();
    expect(line.comparable).toBe(false);
  });

  it("includes stocked ingredients with no demand as fully available", () => {
    const { ctx } = makeTestCtx();
    const rice = addIngredient(ctx, { name: "Rice", category: "pantry", defaultUnit: "lb" });
    addPantryItem(ctx, { ingredientId: rice, qty: 3, unit: "lb", status: "on_hand" });

    const line = computeAvailability(ctx).find((candidate) => candidate.ingredientId === rice)!;
    expect(line.committed).toBe(0);
    expect(line.onHand).toBe(3);
    expect(line.available).toBe(3);
    expect(line.comparable).toBe(true);
    expect(line.committedBy).toEqual([]);
  });

  it("flags demand with unconvertible units as incomparable", () => {
    const { ctx } = makeTestCtx();
    const mystery = addIngredient(ctx, { name: "Mystery mix" });
    const recipe = addRecipe(ctx, { title: "Mix", servings: 1 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: mystery, qty: 2, unit: "cup", position: 0 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: mystery, qty: 1, unit: "lb", position: 1 });
    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: recipe,
      cookDate: "2026-11-02",
      plannedServings: 1,
    });

    const line = computeAvailability(ctx, { mealPlanId: plan }).find(
      (candidate) => candidate.ingredientId === mystery,
    )!;
    expect(line.onHand).toBe(0);
    expect(line.onHandStatus).toBe("out");
    expect(line.comparable).toBe(false);
    expect(line.available).toBeNull();
  });

  it("sums stock across locations in the target unit", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    addPantryItem(ctx, { ingredientId: beef, qty: 16, unit: "oz", status: "on_hand", location: "freezer" });
    addPantryItem(ctx, { ingredientId: beef, qty: 1, unit: "lb", status: "on_hand", location: "fridge" });

    const line = computeAvailability(ctx).find((candidate) => candidate.ingredientId === beef)!;
    expect(line.unit).toBe("oz");
    expect(line.onHand).toBe(32);
  });
});
