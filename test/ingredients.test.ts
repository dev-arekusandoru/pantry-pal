import { describe, expect, it } from "vitest";
import {
  dietaryRules,
  recipeIngredients,
  recipes,
  shoppingListItems,
  shoppingLists,
} from "../src/db/schema.js";
import { AppError } from "../src/lib/errors.js";
import {
  addAlias,
  archiveIngredient,
  createIngredient,
  findIngredientByName,
  getIngredient,
  listIngredients,
  mergeIngredients,
  removeAlias,
  resolveIngredient,
  updateIngredient,
} from "../src/services/ingredients.js";
import { listMovements, listPantry, setStock } from "../src/services/pantry.js";
import { createConversion } from "../src/services/units.js";
import { makeTestCtx } from "./helpers.js";

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

describe("createIngredient", () => {
  it("stores names, aliases and defaults", () => {
    const { ctx } = makeTestCtx();
    const created = createIngredient(ctx, {
      name: "  Yellow   onion ",
      category: "produce",
      aliases: ["Onion", "yellow onions"],
      defaultUnit: "pounds",
      defaultLocation: "counter",
      parQty: 2,
      parUnit: "lb",
    });

    expect(created.name).toBe("Yellow onion");
    expect(created.normalizedName).toBe("yellow onion");
    expect(created.category).toBe("produce");
    expect(created.defaultUnit).toBe("lb");
    expect(created.defaultLocation).toBe("counter");
    expect(created.parQty).toBe(2);
    expect(created.aliases.map((alias) => alias.alias)).toEqual(["onion", "yellow onions"]);
    expect(created.pantry).toEqual([]);
  });

  it("rejects duplicate names case-insensitively", () => {
    const { ctx } = makeTestCtx();
    createIngredient(ctx, { name: "Tomato" });
    expectAppError(() => createIngredient(ctx, { name: "tomato" }), "conflict");
    expectAppError(() => createIngredient(ctx, { name: "   " }), "validation");
  });

  it("rejects an alias that another alias already uses and rolls back", () => {
    const { ctx } = makeTestCtx();
    createIngredient(ctx, { name: "Scallion", aliases: ["green onion"] });
    expectAppError(
      () => createIngredient(ctx, { name: "Spring onion", aliases: ["Green Onion"] }),
      "conflict",
    );
    expect(listIngredients(ctx).map((row) => row.name)).toEqual(["Scallion"]);
  });

  it("rejects unknown units", () => {
    const { ctx } = makeTestCtx();
    expectAppError(() => createIngredient(ctx, { name: "Mystery", defaultUnit: "smidgen" }), "validation");
  });
});

describe("listIngredients / getIngredient", () => {
  it("filters by query (name or alias) and category", () => {
    const { ctx } = makeTestCtx();
    createIngredient(ctx, { name: "Scallion", category: "produce", aliases: ["green onion"] });
    createIngredient(ctx, { name: "Chicken thigh", category: "protein" });

    expect(listIngredients(ctx)).toHaveLength(2);
    expect(listIngredients(ctx, { query: "GREEN" }).map((row) => row.name)).toEqual(["Scallion"]);
    expect(listIngredients(ctx, { query: "chick" }).map((row) => row.name)).toEqual([
      "Chicken thigh",
    ]);
    expect(listIngredients(ctx, { category: "produce" }).map((row) => row.name)).toEqual([
      "Scallion",
    ]);
    expect(listIngredients(ctx, { query: "nothing" })).toHaveLength(0);
  });

  it("returns aliases, conversions and pantry stock", () => {
    const { ctx } = makeTestCtx();
    const ingredient = createIngredient(ctx, { name: "Coconut milk", aliases: ["coco milk"] });
    setStock(ctx, { ingredientId: ingredient.id, qty: 2, unit: "can", location: "pantry" });
    createConversion(ctx, {
      ingredientId: ingredient.id,
      fromUnit: "can",
      toUnit: "fl oz",
      factor: 13.5,
    });

    const view = getIngredient(ctx, ingredient.id);
    expect(view.aliases.map((alias) => alias.alias)).toEqual(["coco milk"]);
    expect(view.conversions).toHaveLength(1);
    expect(view.conversions[0]).toMatchObject({ fromUnit: "can", toUnit: "fl_oz", factor: 13.5 });
    expect(view.pantry).toHaveLength(1);
    expect(view.pantry[0]).toMatchObject({ location: "pantry", qty: 2, unit: "can" });

    expectAppError(() => getIngredient(ctx, "ing_missing"), "not_found");
  });
});

describe("resolveIngredient names", () => {
  it("resolves canonical names, plurals and aliases", () => {
    const { ctx } = makeTestCtx();
    const onion = createIngredient(ctx, {
      name: "Yellow onion",
      aliases: ["onion", "sweet onion"],
    });

    expect(findIngredientByName(ctx, "yellow onion")?.id).toBe(onion.id);
    expect(findIngredientByName(ctx, "yellow onions")?.id).toBe(onion.id);
    expect(findIngredientByName(ctx, "sweet onions")?.id).toBe(onion.id);
    expect(findIngredientByName(ctx, "garlic")).toBeNull();
    expect(resolveIngredient(ctx, "YELLOW ONION").id).toBe(onion.id);
  });
});

describe("updateIngredient", () => {
  it("renames and keeps normalizedName in sync", () => {
    const { ctx } = makeTestCtx();
    const ingredient = createIngredient(ctx, { name: "Eggplant" });
    const renamed = updateIngredient(ctx, ingredient.id, { name: "Aubergine", notes: "purple" });

    expect(renamed.name).toBe("Aubergine");
    expect(renamed.normalizedName).toBe("aubergine");
    expect(renamed.notes).toBe("purple");
    expect(findIngredientByName(ctx, "aubergine")?.id).toBe(ingredient.id);
    expect(findIngredientByName(ctx, "eggplant")).toBeNull();
  });

  it("rejects renaming onto another ingredient", () => {
    const { ctx } = makeTestCtx();
    createIngredient(ctx, { name: "Courgette" });
    const other = createIngredient(ctx, { name: "Zucchini" });
    expectAppError(() => updateIngredient(ctx, other.id, { name: "courgette" }), "conflict");
  });

  it("updates nullable metadata and par values", () => {
    const { ctx } = makeTestCtx();
    const ingredient = createIngredient(ctx, { name: "Olive oil", parQty: 1, parUnit: "l" });
    const updated = updateIngredient(ctx, ingredient.id, {
      parQty: 2,
      parUnit: "liters",
      defaultUnit: "ml",
      isStaple: true,
      description: "Extra virgin",
    });
    expect(updated.parQty).toBe(2);
    expect(updated.parUnit).toBe("l");
    expect(updated.defaultUnit).toBe("ml");
    expect(updated.isStaple).toBe(true);
  });
});

describe("aliases", () => {
  it("adds and removes aliases that resolve", () => {
    const { ctx } = makeTestCtx();
    const ingredient = createIngredient(ctx, { name: "Cilantro" });
    const alias = addAlias(ctx, ingredient.id, "Coriander");

    expect(alias.alias).toBe("coriander");
    expect(findIngredientByName(ctx, "coriander")?.id).toBe(ingredient.id);

    removeAlias(ctx, ingredient.id, alias.id);
    expect(findIngredientByName(ctx, "coriander")).toBeNull();
    expectAppError(() => removeAlias(ctx, ingredient.id, alias.id), "not_found");
  });

  it("rejects aliases that duplicate the name or another alias", () => {
    const { ctx } = makeTestCtx();
    const first = createIngredient(ctx, { name: "Chickpea", aliases: ["garbanzo"] });
    const second = createIngredient(ctx, { name: "Fava bean" });

    expectAppError(() => addAlias(ctx, first.id, "Chickpea"), "conflict");
    expectAppError(() => addAlias(ctx, second.id, "GARBANZO"), "conflict");
    expectAppError(() => addAlias(ctx, "ing_missing", "bean"), "not_found");
  });
});

describe("archiveIngredient", () => {
  it("hides archived ingredients from the default list but keeps them resolvable", () => {
    const { ctx } = makeTestCtx();
    const ingredient = createIngredient(ctx, { name: "Radish" });

    const archived = archiveIngredient(ctx, ingredient.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(listIngredients(ctx)).toHaveLength(0);
    expect(listIngredients(ctx, { includeArchived: true })).toHaveLength(1);
    expect(findIngredientByName(ctx, "radish")?.id).toBe(ingredient.id);
    expectAppError(() => archiveIngredient(ctx, "ing_missing"), "not_found");
  });
});

describe("mergeIngredients", () => {
  function seed() {
    const { ctx } = makeTestCtx();
    const source = createIngredient(ctx, {
      name: "Canned tomato",
      category: "canned",
      aliases: ["tinned tomato"],
    });
    const target = createIngredient(ctx, { name: "Tomato", category: "produce" });

    const targetPantry = setStock(ctx, {
      ingredientId: target.id,
      qty: 14.5,
      unit: "oz",
      location: "pantry",
    });
    setStock(ctx, { ingredientId: source.id, qty: 2, unit: "can", location: "pantry" });
    setStock(ctx, { ingredientId: source.id, qty: 1, unit: "can", location: "fridge" });
    createConversion(ctx, {
      ingredientId: target.id,
      fromUnit: "can",
      toUnit: "oz",
      factor: 14.5,
    });
    createConversion(ctx, {
      ingredientId: source.id,
      fromUnit: "can",
      toUnit: "g",
      factor: 400,
    });

    ctx.db
      .insert(recipes)
      .values({
        id: "rcp_merge",
        householdId: ctx.householdId,
        title: "Tomato soup",
        slug: "tomato-soup",
        servings: 4,
      })
      .run();
    ctx.db
      .insert(recipeIngredients)
      .values({
        id: "ri_merge",
        householdId: ctx.householdId,
        recipeId: "rcp_merge",
        ingredientId: source.id,
        qty: 2,
        unit: "can",
        position: 0,
      })
      .run();
    ctx.db
      .insert(shoppingLists)
      .values({ id: "sl_merge", householdId: ctx.householdId, title: "Week" })
      .run();
    ctx.db
      .insert(shoppingListItems)
      .values({
        id: "sli_merge",
        householdId: ctx.householdId,
        shoppingListId: "sl_merge",
        ingredientId: source.id,
        name: source.name,
      })
      .run();
    ctx.db
      .insert(dietaryRules)
      .values({
        id: "rule_merge",
        householdId: ctx.householdId,
        scope: "ingredient",
        ingredientId: source.id,
        severity: "forbidden",
      })
      .run();

    return { ctx, source, target, targetPantry };
  }

  it("repoints everything, sums same-location stock and aliases the source name", () => {
    const { ctx, source, target, targetPantry } = seed();

    const merged = mergeIngredients(ctx, source.id, target.id);

    expect(merged.moved).toEqual({
      recipeIngredients: 1,
      pantryItems: 2,
      shoppingItems: 1,
      rules: 1,
      conversions: 1,
      aliases: 2,
    });

    // Source is gone, its names resolve to the target.
    expectAppError(() => getIngredient(ctx, source.id), "not_found");
    expect(findIngredientByName(ctx, "canned tomato")?.id).toBe(target.id);
    expect(findIngredientByName(ctx, "tinned tomatoes")?.id).toBe(target.id);

    const view = merged.ingredient;
    expect(view.aliases.map((alias) => alias.alias)).toEqual(["canned tomato", "tinned tomato"]);
    expect(view.conversions.map((row) => `${row.fromUnit}->${row.toUnit}`).sort()).toEqual([
      "can->g",
      "can->oz",
    ]);

    const pantry = view.pantry;
    expect(pantry).toHaveLength(2);
    expect(pantry.find((row) => row.location === "pantry")).toMatchObject({
      qty: 43.5,
      unit: "oz",
    });
    expect(pantry.find((row) => row.location === "fridge")).toMatchObject({
      qty: 1,
      unit: "can",
    });

    // Same-location merge keeps both ledger entries on the surviving row.
    const movements = listMovements(ctx, { pantryItemId: targetPantry.item.id });
    expect(movements).toHaveLength(2);
    expect(movements.every((movement) => movement.pantryItemId === targetPantry.item.id)).toBe(
      true,
    );

    const recipeRows = ctx.db.select().from(recipeIngredients).all();
    expect(recipeRows.map((row) => row.ingredientId)).toEqual([target.id]);

    const shoppingRows = ctx.db.select().from(shoppingListItems).all();
    expect(shoppingRows.map((row) => row.ingredientId)).toEqual([target.id]);

    const ruleRows = ctx.db.select().from(dietaryRules).all();
    expect(ruleRows.map((row) => row.ingredientId)).toEqual([target.id]);

    // Target is the only remaining ingredient (source deleted).
    expect(listIngredients(ctx).map((row) => row.id)).toEqual([target.id]);
    expect(listPantry(ctx).every((row) => row.ingredientId === target.id)).toBe(true);
  });

  it("rejects self-merges and unknown targets", () => {
    const { ctx, source, target } = seed();
    expectAppError(() => mergeIngredients(ctx, source.id, source.id), "validation");
    expectAppError(() => mergeIngredients(ctx, source.id, "ing_missing"), "not_found");
    expect(getIngredient(ctx, target.id)).toBeDefined();
  });
});
