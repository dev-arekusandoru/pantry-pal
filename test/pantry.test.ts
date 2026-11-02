import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import {
  addAlias,
  createIngredient,
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
import { makeTestCtx } from "./helpers.js";

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
    const set = setStock(ctx, { ingredient: "Eggs", qty: 1, unit: "count" });
    const delta = adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: -5, unit: "count" });

    expect(delta.item.qty).toBe(0);
    expect(delta.item.status).toBe("out");
    expect(delta.movement.qtyAfter).toBe(0);
    expect(delta.movement.statusAfter).toBe("out");
  });

  it("keeps an unknown quantity unknown on a delta", () => {
    const { ctx } = makeClock();
    const set = setStock(ctx, { ingredient: "Tomato paste", qty: null, unit: "can" });
    expect(set.item.qty).toBeNull();
    expect(set.item.status).toBe("unknown");

    const delta = adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: 3, unit: "can" });
    expect(delta.item.qty).toBeNull();
    expect(delta.item.status).toBe("on_hand");
    expect(delta.movement.qtyAfter).toBeNull();
    expect(delta.movement.statusAfter).toBe("on_hand");
    expect(delta.warning).toBeUndefined();
  });

  it("records an incomparable delta with a warning and leaves the quantity alone", () => {
    const { ctx } = makeClock();
    const set = setStock(ctx, { ingredient: "Milk", qty: 5, unit: "cup" });
    const delta = adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: 1, unit: "lb" });

    expect(delta.warning).toBe("units not comparable");
    expect(delta.item.qty).toBe(5);
    expect(delta.item.status).toBe("on_hand");
    expect(delta.movement.qty).toBe(1);
    expect(delta.movement.unit).toBe("lb");
    expect(delta.movement.qtyAfter).toBe(5);
  });

  it("uses par (converted) to decide low vs on_hand", () => {
    const { ctx } = makeClock();
    const rice = createIngredient(ctx, { name: "Basmati rice", parQty: 2, parUnit: "kg" });

    const low = setStock(ctx, { ingredientId: rice.id, qty: 1500, unit: "g" });
    expect(low.item.status).toBe("low");

    const stocked = setStock(ctx, { ingredientId: rice.id, qty: 2500, unit: "g" });
    expect(stocked.item.status).toBe("on_hand");

    const out = setStock(ctx, { ingredientId: rice.id, qty: 0, unit: "g" });
    expect(out.item.status).toBe("out");
  });

  it("honours an explicit status for set movements", () => {
    const { ctx } = makeClock();
    const result = setStock(ctx, {
      ingredient: "Mystery jar",
      qty: 5,
      unit: "g",
      status: "unknown",
    });
    expect(result.item.status).toBe("unknown");
    expect(result.movement.statusAfter).toBe("unknown");
  });

  it("defaults the location to the ingredient default", () => {
    const { ctx } = makeClock();
    const cheese = createIngredient(ctx, { name: "Cheddar", defaultLocation: "fridge" });
    const result = applyMovement(ctx, {
      ingredientId: cheese.id,
      kind: "set",
      qty: 200,
      unit: "g",
      reason: "purchase",
    });
    expect(result.item.location).toBe("fridge");
  });

  it("works inside a caller's transaction", () => {
    const { ctx } = makeClock();
    const ingredient = createIngredient(ctx, { name: "Butter" });

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
    expectAppError(
      () => setStock(ctx, { ingredient: "Salt", qty: 1, unit: "blorp" }),
      "validation",
    );
    expectAppError(
      () => setStock(ctx, { ingredient: "Salt", qty: -1, unit: "g" }),
      "validation",
    );
    expectAppError(
      () => adjustStock(ctx, { ingredient: "Ghost pepper", delta: -1, unit: "count" }),
      "unprocessable",
    );
    expect(listIngredients(ctx)).toHaveLength(0);
  });

  it("creates the ingredient for a positive delta on an unknown name", () => {
    const { ctx } = makeClock();
    const result = adjustStock(ctx, { ingredient: "Bananas", delta: 6, unit: "count" });

    expect(result.item.ingredient.name).toBe("Bananas");
    expect(result.item.qty).toBe(6);
    expect(result.item.unit).toBe("count");
    expect(result.item.status).toBe("on_hand");
    expect(result.movement.qtyAfter).toBe(6);
    expect(listIngredients(ctx)).toHaveLength(1);
  });

  it("starts a missing row at zero so a purchase delta becomes the quantity", () => {
    const { ctx } = makeClock();
    const eggs = createIngredient(ctx, { name: "Eggs", defaultUnit: "count" }).id;

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
    expect(purchase.warning).toBeUndefined();

    // A negative delta on a row that never existed clamps at 0 and reads as out.
    const removed = applyMovement(ctx, {
      ingredientId: createIngredient(ctx, { name: "Saffron", defaultUnit: "g" }).id,
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
    expectAppError(
      () =>
        bulkUpdate(ctx, [
          { op: "set", ingredient: "Milk", qty: 2, unit: "l" },
          { op: "adjust", ingredient: "Unicorn tears", delta: -1, unit: "ml" },
        ]),
      "unprocessable",
    );

    expect(listIngredients(ctx)).toHaveLength(0);
    expect(listPantry(ctx)).toHaveLength(0);
    expect(listMovements(ctx)).toHaveLength(0);
  });
});

describe("listPantry", () => {
  it("filters by category, location, status, query, alias and staleness", () => {
    const { ctx, advance } = makeClock();
    const carrots = setStock(ctx, {
      ingredient: "Carrots",
      category: "produce",
      qty: 2,
      unit: "lb",
      location: "fridge",
    });
    const chicken = setStock(ctx, {
      ingredient: "Chicken thighs",
      category: "protein",
      qty: 1,
      unit: "kg",
      location: "freezer",
    });

    expect(listPantry(ctx)).toHaveLength(2);
    expect(listPantry(ctx)[0]!.ingredient.category).toBe("produce");
    expect(listPantry(ctx, { category: "produce" }).map((row) => row.id)).toEqual([carrots.item.id]);
    expect(listPantry(ctx, { location: "freezer" }).map((row) => row.id)).toEqual([
      chicken.item.id,
    ]);
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
      category: "spice",
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

  it("lists all locations for an ingredient and deletes rows", () => {
    const { ctx } = makeClock();
    const set = setStock(ctx, { ingredient: "Yogurt", qty: 500, unit: "g", location: "fridge" });
    setStock(ctx, { ingredientId: set.item.ingredientId, qty: 250, unit: "g", location: "freezer" });

    const stock = getStockForIngredient(ctx, set.item.ingredientId);
    expect(stock.map((row) => row.location)).toEqual(["freezer", "fridge"]);

    deletePantryItem(ctx, set.item.id);
    expect(getStockForIngredient(ctx, set.item.ingredientId)).toHaveLength(1);
    expect(listMovements(ctx, { pantryItemId: set.item.id })).toHaveLength(0);
    expectAppError(() => deletePantryItem(ctx, set.item.id), "not_found");
    expectAppError(() => getPantryItem(ctx, set.item.id), "not_found");
  });
});

describe("verifyItem", () => {
  it("sets lastVerifiedAt and records a verify movement without changing stock", () => {
    const { ctx, advance, nowIso } = makeClock();
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
  it("moves a row between locations and refuses collisions", () => {
    const { ctx } = makeClock();
    const fridge = setStock(ctx, {
      ingredient: "Mozzarella",
      qty: 200,
      unit: "g",
      location: "fridge",
    });
    setStock(ctx, { ingredientId: fridge.item.ingredientId, qty: 100, unit: "g", location: "pantry" });

    const moved = updatePantryItem(ctx, fridge.item.id, {
      location: "freezer",
      note: "freeze for later",
      expiresOn: "2026-12-01",
    });
    expect(moved.location).toBe("freezer");
    expect(moved.note).toBe("freeze for later");
    expect(moved.expiresOn).toBe("2026-12-01");

    const pantryRow = listPantry(ctx, { location: "pantry" })[0]!;
    expectAppError(
      () => updatePantryItem(ctx, pantryRow.id, { location: "freezer" }),
      "conflict",
    );
  });
});

describe("listMovements", () => {
  it("returns newest first with limit and before cursor", () => {
    const { ctx, advance } = makeClock();
    const set = setStock(ctx, { ingredient: "Apples", qty: 10, unit: "count" });
    advance();
    adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: -3, unit: "count" });
    advance();
    adjustStock(ctx, { ingredientId: set.item.ingredientId, delta: -2, unit: "count" });

    const all = listMovements(ctx, { ingredientId: set.item.ingredientId });
    expect(all).toHaveLength(3);
    expect(all[0]!.qtyAfter).toBe(5);
    expect(all.map((movement) => movement.ingredientName)).toEqual(["Apples", "Apples", "Apples"]);
    expect(all[0]!.location).toBe("pantry");

    expect(listMovements(ctx, { ingredientId: set.item.ingredientId, limit: 2 })).toHaveLength(2);

    const newest = all[0]!;
    const older = listMovements(ctx, { ingredientId: set.item.ingredientId, before: newest.createdAt });
    expect(older).toHaveLength(2);
    expect(older[0]!.qtyAfter).toBe(7);
  });
});
