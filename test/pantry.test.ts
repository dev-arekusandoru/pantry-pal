import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { availabilityFor } from "../src/services/demand.js";
import { autoMatchFood } from "../src/services/foods.js";
import {
  addAlias,
  createIngredient,
  getIngredient,
  listIngredients,
} from "../src/services/ingredients.js";
import {
  adjustStock,
  applyMovement,
  bulkUpdate,
  deletePantryItem,
  getPantryItem,
  getStockForIngredient,
  listMovements,
  listPantry,
  setStock,
  updatePantryItem,
  verifyItem,
} from "../src/services/pantry.js";
import { setMeasure } from "../src/services/units.js";
import { addIngredient, makeTestApp, makeTestCtx } from "./helpers.js";

function makeClock(start = "2026-11-01T12:00:00.000Z") {
  let current = new Date(start);
  const test = makeTestCtx({ now: () => new Date(current) });
  return {
    ...test,
    advance(ms = 60_000): void {
      current = new Date(current.getTime() + ms);
    },
    nowIso(): string {
      return current.toISOString();
    },
  };
}

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Expected an AppError with code ${code}`);
}

describe("applyMovement ledger", () => {
  it("sets stock, then applies deltas with movement snapshots", () => {
    const { ctx, advance } = makeClock();
    addIngredient(ctx, "Flour");
    const set = setStock(ctx, { ingredient: "Flour", qty: 5, unit: "cup" });

    expect(set.item.qty).toBe(5);
    expect(set.item.unit).toBe("cup");
    expect(set.item.status).toBe("on_hand");
    expect(set.item.ingredient).toMatchObject({ name: "Flour", category: "other" });
    expect(set.movement).toMatchObject({ kind: "set", qty: 5, qtyAfter: 5, statusAfter: "on_hand" });

    advance();
    const delta = adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: -2, unit: "cup" });
    expect(delta.item.qty).toBe(3);
    expect(delta.movement).toMatchObject({ kind: "delta", qty: -2, qtyAfter: 3 });

    advance();
    const more = adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: 4 });
    expect(more.item.qty).toBe(7);
    expect(more.movement.qtyAfter).toBe(7);

    const movements = listMovements(ctx, { ingredientId: set.item.ingredientId });
    expect(movements.map((movement) => movement.qtyAfter)).toEqual([7, 3, 5]);
  });

  it("converts a delta into the item unit", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Rice");
    const set = setStock(ctx, { ingredient: "Rice", qty: 1000, unit: "g" });
    const delta = adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: 1, unit: "kg" });

    expect(delta.item.qty).toBe(2000);
    expect(delta.item.unit).toBe("g");
    expect(delta.movement.qty).toBe(1);
    expect(delta.movement.unit).toBe("kg");
    expect(delta.movement.qtyAfter).toBe(2000);
  });

  it("clamps at zero and marks the item out", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Eggs");
    const set = setStock(ctx, { ingredient: "Eggs", qty: 1, unit: "count" });
    const delta = adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: -5, unit: "count" });

    expect(delta.item.qty).toBe(0);
    expect(delta.item.status).toBe("out");
    expect(delta.movement.qtyAfter).toBe(0);
    expect(delta.movement.statusAfter).toBe("out");
  });

  it("keeps an unknown quantity unknown on a delta", () => {
    const { ctx } = makeClock();
    const paste = addIngredient(ctx, "Tomato paste");
    setMeasure(ctx, paste.id, "can", { grams: 170 });
    const set = setStock(ctx, { ingredient: "Tomato paste", qty: null, unit: "can" });
    expect(set.item.qty).toBeNull();
    expect(set.item.status).toBe("unknown");

    const delta = adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: 3, unit: "can" });
    expect(delta.item.qty).toBeNull();
    expect(delta.item.status).toBe("on_hand");
    expect(delta.movement.qtyAfter).toBeNull();
    expect(delta.movement.statusAfter).toBe("on_hand");
  });

  it("rejects a delta in a unit that does not convert into the stock unit and writes nothing", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Milk");
    const set = setStock(ctx, { ingredient: "Milk", qty: 5, unit: "cup" });

    expect(() => adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: 1, unit: "lb" })).toThrowError(
      /Cannot convert/,
    );
    const row = listPantry(ctx)[0]!;
    expect(row.qty).toBe(5);
    expect(row.unit).toBe("cup");
    expect(listMovements(ctx)).toHaveLength(1);
  });

  it("converts a write in another unit into the stock unit; the first write sets it", () => {
    const { ctx } = makeClock();
    const flour = createIngredient(ctx, { custom: true, name: "Flour" });
    expect(flour.stockUnit).toBeNull();

    const first = setStock(ctx, { ingredientId: flour.id, qty: 2, unit: "lb" });
    expect(first.item.unit).toBe("lb");
    expect(getIngredient(ctx, flour.id).stockUnit).toBe("lb");

    const second = setStock(ctx, { ingredientId: flour.id, qty: 16, unit: "oz" });
    expect(second.item.qty).toBeCloseTo(1, 9);
    expect(second.item.unit).toBe("lb");
    expect(second.movement.unit).toBe("oz");

    const delta = adjustStock(ctx, { ingredientId: flour.id, delta: 8, unit: "oz" });
    expect(delta.item.qty).toBeCloseTo(1.5, 9);
  });

  it("uses par (converted) to decide low vs on_hand", () => {
    const { ctx } = makeClock();
    const rice = createIngredient(ctx, { custom: true, name: "Basmati rice", parQty: 2, parUnit: "kg" });

    const low = setStock(ctx, { ingredientId: rice.id, qty: 1500, unit: "g" });
    expect(low.item.status).toBe("low");

    const stocked = setStock(ctx, { ingredientId: rice.id, qty: 2500, unit: "g" });
    expect(stocked.item.status).toBe("on_hand");

    const out = setStock(ctx, { ingredientId: rice.id, qty: 0, unit: "g" });
    expect(out.item.status).toBe("out");
  });

  it("honours an explicit status for set movements", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Mystery jar");
    const result = setStock(ctx, {
      ingredient: "Mystery jar",
      qty: 5,
      unit: "g",
      status: "unknown",
    });
    expect(result.item.status).toBe("unknown");
    expect(result.movement.statusAfter).toBe("unknown");
  });

  it("works inside a caller's transaction", () => {
    const { ctx } = makeClock();
    const ingredient = createIngredient(ctx, { custom: true, name: "Butter" });

    ctx.db.transaction((tx) => {
      applyMovement(
        { ...ctx, db: tx as unknown as typeof ctx.db },
        { ingredientId: ingredient.id, kind: "set", qty: 250, unit: "g", reason: "import" },
      );
    });

    const stock = getStockForIngredient(ctx, ingredient.id);
    expect(stock).toHaveLength(1);
    expect(stock[0]!.qty).toBe(250);
  });

  it("rejects unknown units, negative sets and deltas on unknown ingredients", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Salt");
    expectAppError(
      () => setStock(ctx, { ingredient: "Salt", qty: 1, unit: "blorp" }),
      "unprocessable",
    );
    expectAppError(
      () => setStock(ctx, { ingredient: "Salt", qty: -1, unit: "g" }),
      "validation",
    );
    expectAppError(
      () => adjustStock(ctx, { ingredient: "Ghost pepper", delta: -1, unit: "count" }),
      "unprocessable",
    );
    expect(listIngredients(ctx).map((row) => row.name)).toEqual(["Salt"]);
  });

  it("never creates an ingredient for an unknown name and lists every unknown name", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Flour");

    try {
      bulkUpdate(ctx, [
        { op: "set", ingredient: "Flour", qty: 1, unit: "cup" },
        { op: "adjust", ingredient: "Bananas", delta: 6, unit: "count" },
        { op: "set", ingredient: "Kumquats", qty: 2, unit: "count" },
      ]);
      throw new Error("expected a 422");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("unprocessable");
      expect(
        (appError.details as { unresolved: Array<{ name: string }> }).unresolved.map((u) => u.name),
      ).toEqual(["Bananas", "Kumquats"]);
    }
    expect(listIngredients(ctx).map((row) => row.name)).toEqual(["Flour"]);
    expect(listPantry(ctx)).toEqual([]);
  });

  it("creates a linked ingredient from a USDA food and reuses it", () => {
    const { ctx } = makeClock();
    const food = autoMatchFood("banana");
    expect(food).not.toBeNull();

    const first = adjustStock(ctx, {
      fdcId: food!.fdcId,
      name: "Banana",
      category: "produce",
      delta: 6,
      unit: "count",
    });
    expect(first.item.ingredient).toMatchObject({ name: "Banana", category: "produce" });
    expect(first.item.qty).toBe(6);

    const second = adjustStock(ctx, { fdcId: food!.fdcId, delta: 2, unit: "count" });
    expect(second.item.ingredientId).toBe(first.item.ingredientId);
    expect(second.item.qty).toBe(8);
    expect(listIngredients(ctx)).toHaveLength(1);
    expect(listIngredients(ctx)[0]!.nutrition?.fdcId).toBe(food!.fdcId);
  });

  it("starts a missing row at zero so a purchase delta becomes the quantity", () => {
    const { ctx } = makeClock();
    const eggs = createIngredient(ctx, { custom: true, name: "Eggs", stockUnit: "count" }).id;

    const purchase = applyMovement(ctx, {
      ingredientId: eggs,
      kind: "delta",
      qty: 16,
      unit: "count",
      reason: "purchase",
    });

    expect(purchase.item.qty).toBe(16);
    expect(purchase.item.unit).toBe("count");
    expect(purchase.item.status).toBe("on_hand");
    expect(purchase.movement.qtyAfter).toBe(16);
    expect(purchase.movement.statusAfter).toBe("on_hand");

    // A negative delta on a row that never existed clamps at 0 and reads as out.
    const removed = applyMovement(ctx, {
      ingredientId: createIngredient(ctx, { custom: true, name: "Saffron", stockUnit: "g" }).id,
      kind: "delta",
      qty: -3,
      unit: "g",
      reason: "cook",
    });
    expect(removed.item.qty).toBe(0);
    expect(removed.item.status).toBe("out");
    expect(removed.movement.qtyAfter).toBe(0);
  });
});

describe("bulkUpdate", () => {
  it("applies every line and returns per-line results", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Oats");
    const results = bulkUpdate(ctx, [
      { op: "set", ingredient: "Oats", qty: 2, unit: "cup" },
      { op: "adjust", ingredient: "Oats", delta: 1, unit: "cup" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.item.qty).toBe(2);
    expect(results[1]!.item.qty).toBe(3);
    expect(listIngredients(ctx)).toHaveLength(1);
  });

  it("rolls every line back when one line is invalid", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Milk");
    expectAppError(
      () =>
        bulkUpdate(ctx, [
          { op: "set", ingredient: "Milk", qty: 2, unit: "l" },
          { op: "adjust", ingredient: "Unicorn tears", delta: -1, unit: "ml" },
        ]),
      "unprocessable",
    );

    expect(listIngredients(ctx).map((row) => row.name)).toEqual(["Milk"]);
    expect(listPantry(ctx)).toHaveLength(0);
    expect(listMovements(ctx)).toHaveLength(0);
  });
});

describe("listPantry", () => {
  it("filters by category, status, query, alias and staleness", () => {
    const { ctx, advance } = makeClock();
    addIngredient(ctx, "Carrots", { category: "produce" });
    addIngredient(ctx, "Chicken thighs", { category: "protein" });
    addIngredient(ctx, "Paprika", { category: "spice" });
    const carrots = setStock(ctx, {
      ingredient: "Carrots",
      qty: 2,
      unit: "lb",
    });
    const chicken = setStock(ctx, {
      ingredient: "Chicken thighs",
      qty: 1,
      unit: "kg",
    });

    expect(listPantry(ctx)).toHaveLength(2);
    expect(listPantry(ctx)[0]!.ingredient.category).toBe("produce");
    expect(listPantry(ctx, { category: "produce" }).map((row) => row.id)).toEqual([carrots.item.id]);
    expect(listPantry(ctx, { status: "on_hand" })).toHaveLength(2);
    expect(listPantry(ctx, { query: "CARROT" })).toHaveLength(1);

    addAlias(ctx, chicken.item.ingredientId, "poultry");
    expect(listPantry(ctx, { query: "poultry" }).map((row) => row.id)).toEqual([
      chicken.item.id,
    ]);

    // Rows stamped two days ago fall behind a one-day window; verifying refreshes one.
    advance(2 * 86_400_000);
    expect(listPantry(ctx, { staleDays: 2 })).toEqual([]);
    expect(listPantry(ctx, { staleDays: 1 }).map((row) => row.id)).toEqual([
      carrots.item.id,
      chicken.item.id,
    ]);
    verifyItem(ctx, carrots.item.id);
    expect(listPantry(ctx, { staleDays: 1 }).map((row) => row.id)).toEqual([chicken.item.id]);
    expect(listPantry(ctx, { staleDays: 0 }).map((row) => row.id)).toEqual([chicken.item.id]);

    // A delta-only row is never a direct observation, so it counts as stale too.
    const paprika = adjustStock(ctx, {
      ingredient: "Paprika",
      delta: 2,
      unit: "tbsp",
      reason: "adjust",
    });
    expect(paprika.item.lastVerifiedAt).toBeNull();
    expect(listPantry(ctx, { staleDays: 1 }).map((row) => row.id)).toEqual([
      chicken.item.id,
      paprika.item.id,
    ]);
  });

  it("keeps one row per ingredient and deletes it", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Yogurt");
    const set = setStock(ctx, { ingredient: "Yogurt", qty: 500, unit: "g" });
    setStock(ctx, { ingredientId: set.item.ingredientId, qty: 250, unit: "g" });

    const stock = getStockForIngredient(ctx, set.item.ingredientId);
    expect(stock).toHaveLength(1);
    expect(stock[0]!.qty).toBe(250);

    deletePantryItem(ctx, set.item.id);
    expect(getStockForIngredient(ctx, set.item.ingredientId)).toHaveLength(0);
    expect(listPantry(ctx).map((row) => row.id)).not.toContain(set.item.id);
    expect(listMovements(ctx, { pantryItemId: set.item.id })).toHaveLength(0);
    expectAppError(() => deletePantryItem(ctx, set.item.id), "not_found");
    expectAppError(() => getPantryItem(ctx, set.item.id), "not_found");
  });

  it("makes a removed row vanish from the list and availability with no movements left behind", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Yogurt");
    const set = setStock(ctx, { ingredient: "Yogurt", qty: 500, unit: "g" });
    const ingredientId = set.item.ingredientId;

    expect(listPantry(ctx).map((row) => row.id)).toContain(set.item.id);
    expect(availabilityFor(ctx, []).find((line) => line.ingredientId === ingredientId)?.onHand).toBe(500);

    deletePantryItem(ctx, set.item.id);

    expect(listPantry(ctx).map((row) => row.id)).not.toContain(set.item.id);
    expect(availabilityFor(ctx, []).some((line) => line.ingredientId === ingredientId)).toBe(false);
    // The row is the ledger subject: its movements go with it, nothing dangles.
    expect(listMovements(ctx, { ingredientId })).toHaveLength(0);
  });
});

describe("verifyItem", () => {
  it("sets lastVerifiedAt and records a verify movement without changing stock", () => {
    const { ctx, advance, nowIso } = makeClock();
    addIngredient(ctx, "Parmesan");
    const set = setStock(ctx, { ingredient: "Parmesan", qty: 100, unit: "g" });

    advance(90_000);
    const verified = verifyItem(ctx, set.item.id);

    expect(verified.item.qty).toBe(100);
    expect(verified.item.lastVerifiedAt).toBe(nowIso());
    expect(verified.movement.reason).toBe("verify");
    expect(verified.movement.kind).toBe("set");
    expect(verified.movement.qtyAfter).toBe(100);
  });
});

describe("lastVerifiedAt", () => {
  it("stamps direct observations (set, purchase, verify) but not cook or waste deltas", () => {
    const { ctx, advance, nowIso } = makeClock();
    addIngredient(ctx, "Parmesan");
    const set = setStock(ctx, { ingredient: "Parmesan", qty: 100, unit: "g" });
    expect(set.item.lastVerifiedAt).toBe(nowIso());

    advance();
    const bought = adjustStock(ctx, {
      ingredientId: set.item.ingredientId,
      delta: 50,
      unit: "g",
      reason: "purchase",
    });
    expect(bought.item.lastVerifiedAt).toBe(nowIso());

    advance();
    const cooked = adjustStock(ctx, {
      ingredientId: set.item.ingredientId,
      delta: -30,
      unit: "g",
      reason: "cook",
    });
    expect(cooked.item.lastVerifiedAt).toBe(bought.item.lastVerifiedAt);

    advance();
    const wasted = adjustStock(ctx, {
      ingredientId: set.item.ingredientId,
      delta: -10,
      unit: "g",
      reason: "waste",
    });
    expect(wasted.item.lastVerifiedAt).toBe(bought.item.lastVerifiedAt);

    advance();
    const reset = setStock(ctx, {
      ingredientId: set.item.ingredientId,
      qty: 40,
      unit: "g",
    });
    expect(reset.item.lastVerifiedAt).toBe(nowIso());

    advance();
    const adjusted = adjustStock(ctx, {
      ingredientId: set.item.ingredientId,
      delta: 2,
      unit: "g",
      reason: "adjust",
    });
    expect(adjusted.item.lastVerifiedAt).toBe(reset.item.lastVerifiedAt);
  });
});

describe("updatePantryItem", () => {
  it("edits notes, dates and status without touching the quantity", () => {
    const { ctx } = makeClock();
    addIngredient(ctx, "Mozzarella");
    const row = setStock(ctx, { ingredient: "Mozzarella", qty: 200, unit: "g" });

    const updated = updatePantryItem(ctx, row.item.id, {
      note: "freeze for later",
      expiresOn: "2026-12-01",
      status: "low",
    });
    expect(updated.note).toBe("freeze for later");
    expect(updated.expiresOn).toBe("2026-12-01");
    expect(updated.status).toBe("low");
    expect(updated.qty).toBe(200);
  });
});

describe("listMovements", () => {
  it("returns newest first with limit and before cursor", () => {
    const { ctx, advance } = makeClock();
    addIngredient(ctx, "Apples");
    const set = setStock(ctx, { ingredient: "Apples", qty: 10, unit: "count" });
    advance();
    adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: -3, unit: "count" });
    advance();
    adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: -2, unit: "count" });

    const all = listMovements(ctx, { ingredientId: set.item.ingredientId });
    expect(all).toHaveLength(3);
    expect(all[0]!.qtyAfter).toBe(5);
    expect(all.map((movement) => movement.ingredientName)).toEqual(["Apples", "Apples", "Apples"]);

    expect(listMovements(ctx, { ingredientId: set.item.ingredientId, limit: 2 })).toHaveLength(2);

    const newest = all[0]!;
    const older = listMovements(ctx, { ingredientId: set.item.ingredientId, before: newest.createdAt });
    expect(older).toHaveLength(2);
    expect(older[0]!.qtyAfter).toBe(7);
  });
});

describe("DELETE /pantry/{id}", () => {
  it("removes the row from GET /pantry and answers 404 for an unknown id", async () => {
    const { ctx, request } = makeTestApp();
    addIngredient(ctx, "Yogurt");
    const set = setStock(ctx, { ingredient: "Yogurt", qty: 500, unit: "g" });

    const before = await request<{ items: { id: string }[] }>("GET", "/api/v1/pantry");
    expect(before.body.items.map((row) => row.id)).toContain(set.item.id);

    const removed = await request("DELETE", `/api/v1/pantry/${set.item.id}`);
    expect(removed.status).toBe(204);

    const after = await request<{ items: { id: string }[] }>("GET", "/api/v1/pantry");
    expect(after.body.items.map((row) => row.id)).not.toContain(set.item.id);

    const repeat = await request("DELETE", `/api/v1/pantry/${set.item.id}`);
    expect(repeat.status).toBe(404);

    const unknown = await request("DELETE", "/api/v1/pantry/pi_unknown");
    expect(unknown.status).toBe(404);
  });
});
