import { and, eq } from "drizzle-orm";
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
import { normalizeName } from "../src/services/ingredients.js";
import { listMovements } from "../src/services/pantry.js";
import {
  addItems,
  checkItems,
  clearItems,
  completeShoppingList,
  createShoppingList,
  deleteItem,
  deleteShoppingList,
  generateShoppingList,
  getShoppingList,
  listShoppingLists,
  updateItem,
  updateShoppingList,
} from "../src/services/shopping.js";
import { makeTestApp, makeTestCtx } from "./helpers.js";

interface IngredientOptions {
  name: string;
  category?: IngredientCategory;
  defaultUnit?: string | null;
  isStaple?: boolean;
  parQty?: number | null;
  parUnit?: string | null;
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
      isStaple: options.isStaple ?? false,
      parQty: options.parQty ?? null,
      parUnit: options.parUnit ?? null,
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

function addCookEvent(ctx: Ctx, event: CookEventOptions): void {
  const timestamp = ctx.now().toISOString();
  ctx.db
    .insert(cookEvents)
    .values({
      id: newId("ce"),
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

function pantryRow(
  ctx: Ctx,
  ingredientId: string,
  location: StorageLocation = "pantry",
): typeof pantryItems.$inferSelect | undefined {
  return ctx.db
    .select()
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.householdId, ctx.householdId),
        eq(pantryItems.ingredientId, ingredientId),
        eq(pantryItems.location, location),
      ),
    )
    .get();
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

/** One planned cook of a single-ingredient recipe. Returns ingredient and plan ids. */
function plannedNeed(
  ctx: Ctx,
  options: {
    ingredient: IngredientOptions;
    recipeTitle?: string;
    qty: number | null;
    unit: string | null;
    servings?: number;
  },
): { ingredientId: string; planId: string; recipeId: string } {
  const ingredientId = addIngredient(ctx, options.ingredient);
  const servings = options.servings ?? 2;
  const recipeId = addRecipe(ctx, { title: options.recipeTitle ?? "Test recipe", servings });
  addRecipeLine(ctx, {
    recipeId,
    ingredientId,
    qty: options.qty,
    unit: options.unit,
    position: 0,
  });
  const planId = addPlan(ctx, "2026-11-02");
  addCookEvent(ctx, {
    mealPlanId: planId,
    recipeId,
    cookDate: "2026-11-02",
    plannedServings: servings,
  });
  return { ingredientId, planId, recipeId };
}

describe("generateShoppingList", () => {
  it("lists only the net need and explains it with the planned cooks", () => {
    const { ctx } = makeTestCtx();
    const { ingredientId, planId } = plannedNeed(ctx, {
      ingredient: { name: "Ground beef", category: "protein", defaultUnit: "lb" },
      recipeTitle: "Slow Cooker Chili",
      qty: 2,
      unit: "lb",
    });
    addPantryItem(ctx, { ingredientId, qty: 1, unit: "lb", status: "on_hand" });

    const detail = generateShoppingList(ctx, { mealPlanId: planId });

    expect(detail.list.title).toBe("Shopping — week of 2026-11-02");
    expect(detail.list.status).toBe("draft");
    expect(detail.list.mealPlanId).toBe(planId);
    expect(detail.items).toHaveLength(1);
    const item = detail.items[0]!;
    expect(item.ingredientId).toBe(ingredientId);
    expect(item.name).toBe("Ground beef");
    expect(item.category).toBe("protein");
    expect(item.qty).toBe(1);
    expect(item.unit).toBe("lb");
    expect(item.needsCheck).toBe(false);
    expect(item.source).toBe("generated");
    expect(item.purposeNote).toBe("Slow Cooker Chili 2 lb");
    expect(detail.counts).toEqual({ total: 1, checked: 0, remaining: 1, needsCheck: 0 });
  });

  it("does not list demand that stock already covers", () => {
    const { ctx } = makeTestCtx();
    const { ingredientId, planId } = plannedNeed(ctx, {
      ingredient: { name: "Rice", category: "pantry", defaultUnit: "lb" },
      qty: 2,
      unit: "lb",
    });
    addPantryItem(ctx, { ingredientId, qty: 2, unit: "lb", status: "on_hand" });

    const detail = generateShoppingList(ctx, { mealPlanId: planId });
    expect(detail.items).toEqual([]);
  });

  it("marks unknown stock as needsCheck with the full demand", () => {
    const { ctx } = makeTestCtx();
    const { ingredientId, planId } = plannedNeed(ctx, {
      ingredient: { name: "Ground beef", defaultUnit: "lb" },
      recipeTitle: "Chili",
      qty: 2,
      unit: "lb",
    });
    addPantryItem(ctx, { ingredientId, qty: null, unit: "lb", status: "on_hand" });

    const detail = generateShoppingList(ctx, { mealPlanId: planId });
    expect(detail.items).toHaveLength(1);
    const item = detail.items[0]!;
    expect(item.qty).toBe(2);
    expect(item.unit).toBe("lb");
    expect(item.needsCheck).toBe(true);
    expect(item.purposeNote).toBe("Chili 2 lb; check the pantry (stock quantity unknown)");
  });

  it("rounds countable needs up to whole units", () => {
    const { ctx } = makeTestCtx();
    const { planId } = plannedNeed(ctx, {
      ingredient: { name: "Eggs", category: "dairy", defaultUnit: "count" },
      qty: 2.5,
      unit: "count",
    });

    const detail = generateShoppingList(ctx, { mealPlanId: planId });
    expect(detail.items[0]!.qty).toBe(3);
    expect(detail.items[0]!.unit).toBe("count");
  });

  it("adds low and out staples as restock items unless disabled", () => {
    const { ctx } = makeTestCtx();
    const planId = addPlan(ctx, "2026-11-02");
    const rice = addIngredient(ctx, {
      name: "Rice",
      category: "pantry",
      defaultUnit: "lb",
      isStaple: true,
      parQty: 3,
      parUnit: "lb",
    });
    addPantryItem(ctx, { ingredientId: rice, qty: 1, unit: "lb", status: "low" });
    const oil = addIngredient(ctx, {
      name: "Olive oil",
      category: "pantry",
      defaultUnit: "bottle",
      isStaple: true,
    });
    addPantryItem(ctx, { ingredientId: oil, qty: 0, unit: "bottle", status: "out" });

    const detail = generateShoppingList(ctx, { mealPlanId: planId });
    expect(detail.items).toHaveLength(2);

    const riceItem = detail.items.find((item) => item.ingredientId === rice)!;
    expect(riceItem.qty).toBe(2);
    expect(riceItem.unit).toBe("lb");
    expect(riceItem.purposeNote).toBe("staple restock");
    expect(riceItem.needsCheck).toBe(false);

    const oilItem = detail.items.find((item) => item.ingredientId === oil)!;
    expect(oilItem.qty).toBeNull();
    expect(oilItem.unit).toBe("bottle");
    expect(oilItem.purposeNote).toBe("staple restock");

    const withoutStaples = generateShoppingList(ctx, { mealPlanId: planId, includeStaples: false });
    expect(withoutStaples.items).toEqual([]);
  });

  it("regenerates without duplicating manual or checked ingredients", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", category: "protein", defaultUnit: "lb" });
    const onion = addIngredient(ctx, { name: "Yellow onion", category: "produce", defaultUnit: "lb" });
    const recipe = addRecipe(ctx, { title: "Chili", servings: 2 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: beef, qty: 1, unit: "lb", position: 0 });
    addRecipeLine(ctx, { recipeId: recipe, ingredientId: onion, qty: 1, unit: "lb", position: 1 });
    const plan = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, {
      mealPlanId: plan,
      recipeId: recipe,
      cookDate: "2026-11-02",
      plannedServings: 2,
    });

    const first = generateShoppingList(ctx, { mealPlanId: plan });
    expect(first.items).toHaveLength(2);
    const listId = first.list.id;
    const onionItem = first.items.find((item) => item.ingredientId === onion)!;
    checkItems(ctx, listId, [{ itemId: onionItem.id, checked: true }]);
    addItems(ctx, listId, [
      { ingredient: "Ground beef", qty: 5, unit: "lb" },
      { name: "Birthday candles", qty: 1, unit: "package" },
    ]);

    const regenerated = generateShoppingList(ctx, { mealPlanId: plan, listId });

    expect(regenerated.list.id).toBe(listId);
    expect(regenerated.counts.total).toBe(3);
    expect(regenerated.counts.checked).toBe(1);
    expect(regenerated.items.filter((item) => item.ingredientId === onion)).toHaveLength(1);

    const beefItem = regenerated.items.find((item) => item.ingredientId === beef)!;
    expect(beefItem.source).toBe("manual");
    expect(beefItem.qty).toBe(5);
    expect(beefItem.purposeNote).toContain("Chili");

    const onionAfter = regenerated.items.find((item) => item.ingredientId === onion)!;
    expect(onionAfter.checkedAt).not.toBeNull();

    const uncheckedOnly = getShoppingList(ctx, listId, { includeChecked: false });
    expect(uncheckedOnly.items.some((item) => item.ingredientId === onion)).toBe(false);
    expect(uncheckedOnly.counts).toEqual({ total: 3, checked: 1, remaining: 2, needsCheck: 0 });
  });

  it("refuses to regenerate a completed list", () => {
    const { ctx } = makeTestCtx();
    const planId = addPlan(ctx, "2026-11-02");
    const detail = createShoppingList(ctx, { title: "Done list" });
    completeShoppingList(ctx, detail.list.id);

    expectAppError(
      () => generateShoppingList(ctx, { mealPlanId: planId, listId: detail.list.id }),
      "conflict",
    );
  });
});

describe("shopping list CRUD", () => {
  it("creates, edits, checks and deletes a manual list", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });

    const created = createShoppingList(ctx, {
      title: "Corner store",
      items: [{ name: "Birthday candles", qty: 1, unit: "package" }],
    });
    expect(created.list.status).toBe("draft");
    expect(created.items).toHaveLength(1);
    expect(created.items[0]!.ingredientId).toBeNull();
    expect(created.items[0]!.source).toBe("manual");

    const listId = created.list.id;
    const added = addItems(ctx, listId, [
      { ingredient: "ground beef", qty: 2, unit: "lbs" },
      { name: "Mystery sauce", qty: 1, unit: "bottle" },
    ]);
    expect(added.items).toHaveLength(2);
    const beefItem = added.items.find((item) => item.ingredientId === beef)!;
    expect(beefItem.name).toBe("Ground beef");
    expect(beefItem.unit).toBe("lb");

    const updated = updateShoppingList(ctx, listId, {
      title: "Corner store run",
      notes: "Saturday",
      status: "shopping",
    });
    expect(updated.list.title).toBe("Corner store run");
    expect(updated.list.notes).toBe("Saturday");
    expect(updated.list.status).toBe("shopping");
    expect(listShoppingLists(ctx, { status: "shopping" }).items).toHaveLength(1);
    expect(listShoppingLists(ctx, { status: "draft" }).items).toEqual([]);

    const edited = updateItem(ctx, listId, beefItem.id, { qty: 3, note: "lean" });
    expect(edited.qty).toBe(3);
    expect(edited.note).toBe("lean");

    const checked = checkItems(ctx, listId, [{ itemId: beefItem.id, checked: true, actualQty: 2.5 }]);
    expect(checked.items[0]!.checkedAt).not.toBeNull();
    expect(checked.items[0]!.actualQty).toBe(2.5);
    expect(checked.items[0]!.actualUnit).toBe("lb");

    const candles = created.items[0]!;
    expect(deleteItem(ctx, listId, candles.id)).toEqual({ deleted: true, id: candles.id });

    deleteShoppingList(ctx, listId);
    expectAppError(() => getShoppingList(ctx, listId), "not_found");
  });

  it("rejects an empty title update", () => {
    const { ctx } = makeTestCtx();
    const created = createShoppingList(ctx, { title: "List" });
    expectAppError(() => updateShoppingList(ctx, created.list.id, { title: "  " }), "validation");
  });
});

describe("clearItems", () => {
  it("removes generated, manual and checked items but keeps the list", () => {
    const { ctx } = makeTestCtx();
    const { ingredientId, planId } = plannedNeed(ctx, {
      ingredient: { name: "Ground beef", category: "protein", defaultUnit: "lb" },
      qty: 2,
      unit: "lb",
    });
    const generated = generateShoppingList(ctx, { mealPlanId: planId });
    const listId = generated.list.id;
    addItems(ctx, listId, [{ name: "Birthday candles", qty: 1, unit: "package" }]);
    const beefItem = generated.items.find((item) => item.ingredientId === ingredientId)!;
    checkItems(ctx, listId, [{ itemId: beefItem.id, checked: true }]);

    const cleared = clearItems(ctx, listId);

    expect(cleared.items).toEqual([]);
    expect(cleared.groups).toEqual([]);
    expect(cleared.counts).toEqual({ total: 0, checked: 0, remaining: 0, needsCheck: 0 });
    expect(cleared.list.id).toBe(listId);
    expect(getShoppingList(ctx, listId).items).toEqual([]);
  });

  it("keeps the stale flag honest and lets a later regenerate repopulate", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", category: "protein", defaultUnit: "lb" });
    const recipeId = addRecipe(ctx, { title: "Chili", servings: 4 });
    addRecipeLine(ctx, { recipeId, ingredientId: beef, qty: 2, unit: "lb", position: 0 });
    const planId = addPlan(ctx, "2026-11-02");
    addCookEvent(ctx, { mealPlanId: planId, recipeId, cookDate: "2026-11-02", plannedServings: 4 });
    const list = generateShoppingList(ctx, { mealPlanId: planId });
    expect(list.items).toHaveLength(1);

    // The plan changes after generation: the list goes stale.
    addCookEvent(ctx, { mealPlanId: planId, recipeId, cookDate: "2026-11-03", plannedServings: 4 });
    expect(getShoppingList(ctx, list.list.id).list.stale).toBe(true);

    clearItems(ctx, list.list.id);
    // Clearing says nothing about the plan, so the banner still tells the truth.
    expect(getShoppingList(ctx, list.list.id).list.stale).toBe(true);

    const regenerated = generateShoppingList(ctx, { mealPlanId: planId, listId: list.list.id });
    expect(regenerated.items).toHaveLength(1);
    expect(regenerated.list.stale).toBe(false);
    expect(getShoppingList(ctx, list.list.id).list.stale).toBe(false);
  });

  it("refuses to clear a completed list", () => {
    const { ctx } = makeTestCtx();
    const created = createShoppingList(ctx, {
      title: "Done list",
      items: [{ name: "Birthday candles" }],
    });
    completeShoppingList(ctx, created.list.id);
    expectAppError(() => clearItems(ctx, created.list.id), "conflict");
    expect(getShoppingList(ctx, created.list.id).items).toHaveLength(1);
  });

  it("clears through DELETE /shopping-lists/:id/items", async () => {
    const { ctx, request } = makeTestApp();
    const created = await request<{ list: { id: string } }>(
      "POST",
      "/api/v1/shopping-lists",
      { title: "Market", items: [{ name: "Candles" }, { name: "Milk" }] },
    );
    expect(created.status).toBe(201);
    const listId = created.body.list.id;

    const cleared = await request<{ items: unknown[]; counts: { total: number } }>(
      "DELETE",
      `/api/v1/shopping-lists/${listId}/items`,
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.items).toEqual([]);
    expect(cleared.body.counts.total).toBe(0);
    expect(getShoppingList(ctx, listId).items).toEqual([]);

    const missing = await request("DELETE", "/api/v1/shopping-lists/sl_missing/items");
    expect(missing.status).toBe(404);
  });
});

describe("completeShoppingList", () => {
  it("writes purchase movements for actual quantities, substitutes and unknown amounts", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    const onion = addIngredient(ctx, { name: "Yellow onion", defaultUnit: "lb" });
    const shallot = addIngredient(ctx, { name: "Shallot", defaultUnit: "lb" });
    const salt = addIngredient(ctx, { name: "Salt", category: "spice" });

    addPantryItem(ctx, { ingredientId: beef, qty: 0, unit: "lb", status: "out" });
    addPantryItem(ctx, { ingredientId: onion, qty: 0, unit: "lb", status: "out" });
    addPantryItem(ctx, { ingredientId: shallot, qty: 0, unit: "lb", status: "out" });
    addPantryItem(ctx, { ingredientId: salt, qty: null, unit: null, status: "out" });

    const detail = createShoppingList(ctx, {
      title: "Market",
      items: [
        { ingredient: "Ground beef", qty: 2, unit: "lb" },
        { ingredient: "Yellow onion", qty: 1, unit: "lb" },
        { ingredient: "Salt" },
        { name: "Birthday candles", qty: 1, unit: "package" },
      ],
    });
    const listId = detail.list.id;
    const byName = (name: string) => detail.items.find((item) => item.name === name)!;

    checkItems(ctx, listId, [
      { itemId: byName("Ground beef").id, checked: true, actualQty: 1.5, actualUnit: "lb" },
      { itemId: byName("Yellow onion").id, checked: true, substituteIngredient: "Shallot" },
      { itemId: byName("Salt").id, checked: true },
      { itemId: byName("Birthday candles").id, checked: true },
    ]);

    const result = completeShoppingList(ctx, listId);

    expect(result.list.status).toBe("done");
    expect(result.list.completedAt).not.toBeNull();
    expect(result.movements).toHaveLength(3);
    expect(result.skipped).toEqual([
      { itemId: byName("Birthday candles").id, name: "Birthday candles", reason: "free_text" },
    ]);
    for (const movement of result.movements) {
      expect(movement.reason).toBe("purchase");
      expect(movement.refType).toBe("shopping_list");
      expect(movement.refId).toBe(listId);
    }

    expect(pantryRow(ctx, beef)!.qty).toBe(1.5);
    expect(pantryRow(ctx, shallot)!.qty).toBe(1);
    // The onion was replaced, so its own stock is untouched.
    expect(pantryRow(ctx, onion)!.qty).toBe(0);

    const saltRow = pantryRow(ctx, salt)!;
    expect(saltRow.qty).toBeNull();
    expect(saltRow.status).toBe("on_hand");
    const saltMovement = result.movements.find((movement) => movement.kind === "set")!;
    expect(saltMovement.qty).toBeNull();

    expectAppError(() => completeShoppingList(ctx, listId), "conflict");
    expectAppError(() => updateShoppingList(ctx, listId, { title: "Nope" }), "conflict");
  });

  it("stocks checked items for ingredients that have no pantry row yet", () => {
    const { ctx } = makeTestCtx();
    const eggs = addIngredient(ctx, { name: "Eggs", defaultUnit: "count" });
    expect(pantryRow(ctx, eggs)).toBeUndefined();

    const detail = createShoppingList(ctx, {
      items: [{ ingredient: "Eggs", qty: 16, unit: "count" }],
    });
    const item = detail.items[0]!;
    checkItems(ctx, detail.list.id, [{ itemId: item.id, checked: true }]);

    const result = completeShoppingList(ctx, detail.list.id);

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).toMatchObject({
      kind: "delta",
      qty: 16,
      qtyAfter: 16,
      statusAfter: "on_hand",
      reason: "purchase",
    });
    const row = pantryRow(ctx, eggs)!;
    expect(row.qty).toBe(16);
    expect(row.unit).toBe("count");
    expect(row.status).toBe("on_hand");
  });

  it("uses received overrides and stores them in the given location", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    addPantryItem(ctx, { ingredientId: beef, qty: 0, unit: "lb", status: "out" });
    addPantryItem(ctx, { ingredientId: beef, qty: 0, unit: "lb", status: "out", location: "freezer" });

    const detail = createShoppingList(ctx, {
      items: [{ ingredient: "Ground beef", qty: 1, unit: "lb" }],
    });
    const item = detail.items[0]!;
    checkItems(ctx, detail.list.id, [{ itemId: item.id, checked: true }]);

    const result = completeShoppingList(ctx, detail.list.id, {
      received: [{ itemId: item.id, qty: 3, unit: "lb", location: "freezer" }],
    });

    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]!.qty).toBe(3);
    expect(pantryRow(ctx, beef, "freezer")!.qty).toBe(3);
    expect(pantryRow(ctx, beef, "pantry")!.qty).toBe(0);
  });

  it("only converts checked items by default but can take every item", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    addPantryItem(ctx, { ingredientId: beef, qty: 0, unit: "lb", status: "out" });

    const detail = createShoppingList(ctx, {
      items: [
        { ingredient: "Ground beef", qty: 1, unit: "lb" },
        { ingredient: "Ground beef", name: "Beef for the freezer", qty: 2, unit: "lb" },
      ],
    });
    const [first, second] = detail.items;
    checkItems(ctx, detail.list.id, [{ itemId: first!.id, checked: true }]);

    const defaultResult = completeShoppingList(ctx, detail.list.id);
    expect(defaultResult.movements).toHaveLength(1);
    expect(pantryRow(ctx, beef)!.qty).toBe(1);
    // The unchecked item stays unchecked and did not move stock.
    const after = getShoppingList(ctx, detail.list.id).items.find((item) => item.id === second!.id)!;
    expect(after.checkedAt).toBeNull();

    const looseList = createShoppingList(ctx, {
      items: [{ ingredient: "Ground beef", qty: 2, unit: "lb" }],
    });
    const loose = completeShoppingList(ctx, looseList.list.id, { onlyChecked: false });
    expect(loose.movements).toHaveLength(1);
    expect(pantryRow(ctx, beef)!.qty).toBe(3);
    const looseItem = getShoppingList(ctx, looseList.list.id).items[0]!;
    expect(looseItem.checkedAt).not.toBeNull();
  });

  it("completes without purchase movements when the pantry already reflects the trip", () => {
    const { ctx } = makeTestCtx();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });
    addPantryItem(ctx, { ingredientId: beef, qty: 3, unit: "lb" });

    const detail = createShoppingList(ctx, {
      items: [{ ingredient: "Ground beef", qty: 2, unit: "lb" }],
    });
    const item = detail.items[0]!;
    const checkedAt = "2026-10-15T09:30:00.000Z";
    checkItems(ctx, detail.list.id, [{ itemId: item.id, checked: true, checkedAt }]);

    const completedAt = "2026-10-16T18:00:00.000Z";
    const result = completeShoppingList(ctx, detail.list.id, {
      recordPurchases: false,
      completedAt,
    });

    expect(result.list.status).toBe("done");
    expect(result.list.completedAt).toBe(completedAt);
    expect(result.movements).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
    // No ledger entry, no stock change.
    expect(listMovements(ctx, { limit: 100 })).toHaveLength(0);
    expect(pantryRow(ctx, beef)!.qty).toBe(3);

    const stored = getShoppingList(ctx, detail.list.id).items.find((row) => row.id === item.id)!;
    expect(stored.checkedAt).toBe(checkedAt);
    expect(stored.actualQty).toBe(2);
    expect(stored.actualUnit).toBe("lb");
  });

  it("surfaces a warning when a purchase cannot be compared with the pantry unit", () => {
    const { ctx } = makeTestCtx();
    const oil = addIngredient(ctx, { name: "Olive oil", defaultUnit: "cup" });
    addPantryItem(ctx, { ingredientId: oil, qty: 1, unit: "cup" });

    const detail = createShoppingList(ctx, {
      items: [{ ingredient: "Olive oil", qty: 1, unit: "bottle" }],
    });
    const item = detail.items[0]!;
    checkItems(ctx, detail.list.id, [{ itemId: item.id, checked: true }]);

    const result = completeShoppingList(ctx, detail.list.id);

    expect(result.list.status).toBe("done");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Olive oil");
    expect(result.warnings[0]).toContain("units not comparable");
    // The stock is untouched, but the caller can now see why.
    expect(pantryRow(ctx, oil)!.qty).toBe(1);
    expect(result.movements[0]!.qtyAfter).toBe(1);
  });
});

describe("shopping quantity validation", () => {
  it("rejects negative quantities on every write path with 400", async () => {
    const { ctx, request } = makeTestApp();
    const beef = addIngredient(ctx, { name: "Ground beef", defaultUnit: "lb" });

    const created = await request<{ list: { id: string }; items: { id: string }[] }>(
      "POST",
      "/api/v1/shopping-lists",
      { title: "Market", items: [{ ingredient: "Ground beef", qty: 2, unit: "lb" }] },
    );
    expect(created.status).toBe(201);
    const listId = created.body.list.id;
    const itemId = created.body.items[0]!.id;

    const add = await request("POST", `/api/v1/shopping-lists/${listId}/items`, {
      items: [{ ingredient: "Ground beef", qty: -2, unit: "lb" }],
    });
    expect(add.status).toBe(400);

    const updateQty = await request("PATCH", `/api/v1/shopping-lists/${listId}/items/${itemId}`, {
      qty: -1,
    });
    expect(updateQty.status).toBe(400);

    const updateActual = await request(
      "PATCH",
      `/api/v1/shopping-lists/${listId}/items/${itemId}`,
      { actualQty: -1 },
    );
    expect(updateActual.status).toBe(400);

    const check = await request("POST", `/api/v1/shopping-lists/${listId}/check`, {
      items: [{ itemId, checked: true, actualQty: -1 }],
    });
    expect(check.status).toBe(400);

    const complete = await request("POST", `/api/v1/shopping-lists/${listId}/complete`, {
      received: [{ itemId, qty: -1 }],
    });
    expect(complete.status).toBe(400);

    // Nothing was written by the rejected requests.
    const detail = getShoppingList(ctx, listId);
    expect(detail.list.status).toBe("draft");
    expect(detail.items[0]!.qty).toBe(2);
    expect(pantryRow(ctx, beef)).toBeUndefined();
  });
});
