import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { ingredients } from "../src/db/schema.js";
import { titleCaseName } from "../src/lib/titleCase.js";
import { autoMatchFood } from "../src/services/foods.js";
import {
  createIngredient,
  getIngredientDetail,
  titleCaseIngredientNames,
  updateIngredient,
  type IngredientDetail,
  type IngredientUsageCount,
} from "../src/services/ingredients.js";
import { applyMovement } from "../src/services/pantry.js";
import { createRecipe } from "../src/services/recipes.js";
import { createRule } from "../src/services/rules.js";
import { addItems, createShoppingList, getShoppingList } from "../src/services/shopping.js";
import { addIngredient, makeTestApp, makeTestCtx } from "./helpers.js";

const EGG = 171287;

describe("titleCaseName", () => {
  it.each([
    ["birria paste", "Birria Paste"],
    ["  sun-dried   tomatoes ", "Sun-Dried Tomatoes"],
    ["diced tomatoes with green chilies", "Diced Tomatoes with Green Chilies"],
    ["The Salt of the Earth", "The Salt of the Earth"],
    ["of mice and men", "Of Mice and Men"],
    ["bbq sauce", "Bbq Sauce"],
    ["BBQ sauce", "BBQ Sauce"],
    ["mcCormick pepper", "mcCormick Pepper"],
    ["ALL-PURPOSE FLOUR", "ALL-PURPOSE FLOUR"],
    ["mom's chili", "Mom's Chili"],
    ["jalapeño", "Jalapeño"],
    ["salt and pepper", "Salt and Pepper"],
    ["cream of tartar", "Cream of Tartar"],
  ])("%s → %s", (input, expected) => {
    expect(titleCaseName(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const name of ["birria paste", "BBQ sauce", "Cream of tartar", "sun-Dried tomatoes", "a taste of home"]) {
      const once = titleCaseName(name);
      expect(titleCaseName(once)).toBe(once);
    }
  });
});

describe("Title Case names", () => {
  it("applies on create (API and service) and rename, and follows the name in shopping items", async () => {
    const app = makeTestApp();
    const created = await app.request<{ id: string; name: string; normalizedName: string }>("POST", "/api/v1/ingredients", {
      name: "birria paste",
      custom: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Birria Paste");
    expect(created.body.normalizedName).toBe("birria paste");

    const list = createShoppingList(app.ctx, { title: "Run" });
    addItems(app.ctx, list.list.id, [{ ingredientId: created.body.id, qty: 1, unit: "jar" }]);
    expect(getShoppingList(app.ctx, list.list.id).items[0]!.name).toBe("Birria Paste");

    const renamed = await app.request<{ name: string }>("PATCH", `/api/v1/ingredients/${created.body.id}`, {
      name: "smoked birria paste",
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Smoked Birria Paste");
    expect(getShoppingList(app.ctx, list.list.id).items[0]!.name).toBe("Smoked Birria Paste");

    const linked = createIngredient(app.ctx, { fdcId: EGG, name: "free-range egg" });
    expect(linked.name).toBe("Free-Range Egg");
  });

  it("keeps a shopping item's own text on rename", () => {
    const { ctx } = makeTestCtx();
    const paste = addIngredient(ctx, "Birria paste");
    const list = createShoppingList(ctx, { title: "Run" });
    addItems(ctx, list.list.id, [{ ingredientId: paste.id, name: "the red jar", qty: 1 }]);
    updateIngredient(ctx, paste.id, { name: "red birria paste" });
    expect(getShoppingList(ctx, list.list.id).items[0]!.name).toBe("the red jar");
  });

  it("still lints the Title Case name", async () => {
    const app = makeTestApp();
    const response = await app.request<{ error: { details: { reason: string } } }>("POST", "/api/v1/ingredients", {
      name: "milk or water",
      custom: true,
    });
    expect(response.status).toBe(422);
  });
});

describe("titleCaseIngredientNames migration", () => {
  it("Title-Cases every household's names once, without touching normalized names", () => {
    const first = makeTestCtx();
    const second = makeTestCtx();
    for (const { ctx, db } of [first, second]) {
      const paste = addIngredient(ctx, "Birria paste");
      const soup = addIngredient(ctx, "Cream of tomato soup");
      const bad = addIngredient(ctx, "Plain");
      db.update(ingredients).set({ name: "birria paste" }).where(eq(ingredients.id, paste.id)).run();
      db.update(ingredients).set({ name: "cream OF tomato soup" }).where(eq(ingredients.id, soup.id)).run();
      db.update(ingredients)
        .set({ name: "Milk or water", normalizedName: "milk or water" })
        .where(eq(ingredients.id, bad.id))
        .run();
      const list = createShoppingList(ctx, { title: "Run" });
      addItems(ctx, list.list.id, [{ ingredientId: paste.id, qty: 1, unit: "jar" }]);
      db.update(ingredients).set({ name: "birria paste" }).where(eq(ingredients.id, paste.id)).run();
    }

    // Both households sit in one database only in production; here each test db is separate.
    expect(titleCaseIngredientNames(first.db)).toBe(3);
    expect(titleCaseIngredientNames(first.db)).toBe(0);
    expect(titleCaseIngredientNames(second.db)).toBe(3);

    const rows = first.db.select().from(ingredients).all().map((row) => [row.name, row.normalizedName]);
    expect(rows.sort()).toEqual(
      [
        ["Birria Paste", "birria paste"],
        ["Cream of Tomato Soup", "cream of tomato soup"],
        ["Milk or Water", "milk or water"],
      ].sort(),
    );
  });

  it("changes only the display name, so it cannot collide", () => {
    const { ctx, db } = makeTestCtx();
    const first = addIngredient(ctx, "Olive oil");
    const second = addIngredient(ctx, "Olive oils");
    db.update(ingredients).set({ name: "olive oil" }).where(eq(ingredients.id, first.id)).run();
    db.update(ingredients).set({ name: "OLIVE oils" }).where(eq(ingredients.id, second.id)).run();
    expect(titleCaseIngredientNames(db)).toBe(2);
    const names = db.select({ name: ingredients.name, key: ingredients.normalizedName }).from(ingredients).all();
    expect(new Set(names.map((row) => row.key)).size).toBe(2);
    expect(names.find((row) => row.key === "olive oil")?.name).toBe("Olive Oil");
  });
});

describe("ingredient detail and usage", () => {
  it("lists recipes, pantry, open shopping items and rules", async () => {
    const app = makeTestApp();
    const { ctx } = app;
    const milk = addIngredient(ctx, "Milk", { category: "dairy" });
    const water = addIngredient(ctx, "Water");
    const unused = addIngredient(ctx, "Saffron");

    const pancakes = createRecipe(ctx, {
      title: "Pancakes",
      servings: 2,
      ingredients: [
        { ingredientId: milk.id, qty: 1, unit: "cup" },
        { ingredientId: milk.id, qty: 1, unit: "tbsp" },
      ],
    });
    const soup = createRecipe(ctx, {
      title: "Soup",
      servings: 2,
      ingredients: [{ ingredientId: water.id, alternatives: [{ ingredientId: milk.id }], qty: 1, unit: "cup" }],
    });
    applyMovement(ctx, { ingredientId: milk.id, kind: "set", qty: 2, unit: "cup", reason: "purchase" });
    const open = createShoppingList(ctx, { title: "Open" });
    addItems(ctx, open.list.id, [{ ingredientId: milk.id, qty: 1, unit: "cup" }]);
    const done = createShoppingList(ctx, { title: "Old" });
    addItems(ctx, done.list.id, [{ ingredientId: milk.id, qty: 1, unit: "cup" }]);
    const rule = createRule(ctx, { scope: "ingredient", ingredientId: milk.id, severity: "avoid", reason: "dislike" });

    const response = await app.request<IngredientDetail>("GET", `/api/v1/ingredients/${milk.id}`);
    expect(response.status).toBe(200);
    const { usage } = response.body;
    expect(usage.recipes).toEqual([
      { id: pancakes.id, slug: pancakes.slug, title: "Pancakes", lines: 2, asMain: 2, asAlternative: 0 },
      { id: soup.id, slug: soup.slug, title: "Soup", lines: 1, asMain: 0, asAlternative: 1 },
    ]);
    expect(usage.pantryItem).toMatchObject({ qty: 2, unit: "cup", status: "on_hand" });
    expect(usage.shoppingItems.map((item) => [item.listTitle, item.name, item.qty, item.checked])).toEqual([
      ["Open", "Milk", 1, false],
      ["Old", "Milk", 1, false],
    ]);
    expect(usage.rules).toMatchObject([{ id: rule.id, severity: "avoid", reason: "dislike", memberId: null }]);
    expect(response.body.review).toBeNull();
    expect(response.body.aliases).toEqual([]);

    const empty = getIngredientDetail(ctx, unused.id);
    expect(empty.usage).toEqual({ recipes: [], pantryItem: null, shoppingItems: [], rules: [] });
  });

  it("explains why an ingredient needs attention", async () => {
    const app = makeTestApp();
    const custom = createIngredient(app.ctx, { name: "Birria paste", custom: true, needsReview: true });
    const response = await app.request<{ review: { reasons: string[]; suggestions: unknown[] } | null }>(
      "GET",
      `/api/v1/ingredients/${custom.id}`,
    );
    expect(response.body.review?.reasons).toEqual(["unlinked", "custom_unreviewed"]);
    expect(Array.isArray(response.body.review?.suggestions)).toBe(true);
  });

  it("counts use per ingredient and omits unused ones", async () => {
    const app = makeTestApp();
    const { ctx } = app;
    const milk = addIngredient(ctx, "Milk");
    const water = addIngredient(ctx, "Water");
    addIngredient(ctx, "Saffron");
    createRecipe(ctx, { title: "A", servings: 1, ingredients: [{ ingredientId: milk.id, qty: 1, unit: "cup" }] });
    createRecipe(ctx, {
      title: "B",
      servings: 1,
      ingredients: [
        { ingredientId: milk.id, qty: 1, unit: "cup" },
        { ingredientId: milk.id, qty: 2, unit: "cup" },
        { ingredientId: water.id, qty: 1, unit: "cup", alternatives: [{ ingredientId: milk.id }] },
      ],
    });
    const response = await app.request<{ items: IngredientUsageCount[] }>(
      "GET",
      "/api/v1/ingredients/usage",
    );
    expect(response.status).toBe(200);
    expect(response.body.items.map((item) => item.ingredientId).sort()).toEqual([milk.id, water.id].sort());
    expect(response.body.items.find((item) => item.ingredientId === milk.id)).toMatchObject({ recipes: 2, pantry: 0 });
  });
});

describe("auto-linked ingredients keep their food on case-only changes", () => {
  /** An ingredient whose auto link auto-matching would not reproduce: "Birria Paste" pinned to the egg food. */
  function autoLinkedPaste() {
    const { ctx, db } = makeTestCtx();
    const paste = addIngredient(ctx, "Birria paste");
    db.update(ingredients)
      .set({ name: "birria paste", nutritionFdcId: EGG, nutritionSource: "auto" })
      .where(eq(ingredients.id, paste.id))
      .run();
    return { ctx, db, id: paste.id };
  }

  const stored = (db: Db, id: string) =>
    db.select().from(ingredients).where(eq(ingredients.id, id)).get()!;

  it("the migration updates names only and never re-runs matching", () => {
    const { db, id } = autoLinkedPaste();
    expect(titleCaseIngredientNames(db)).toBe(1);
    expect(stored(db, id)).toMatchObject({ name: "Birria Paste", nutritionFdcId: EGG, nutritionSource: "auto" });
  });

  it("a case-only rename (including Title Case on save) does not re-match", () => {
    const { ctx, db, id } = autoLinkedPaste();
    updateIngredient(ctx, id, { name: "birria paste" });
    expect(stored(db, id)).toMatchObject({ name: "Birria Paste", nutritionFdcId: EGG, nutritionSource: "auto" });
    updateIngredient(ctx, id, { name: "BIRRIA Paste" });
    expect(stored(db, id)).toMatchObject({ nutritionFdcId: EGG, nutritionSource: "auto" });
  });

  it("a real rename of an auto-linked ingredient still re-matches", () => {
    const { ctx, db, id } = autoLinkedPaste();
    updateIngredient(ctx, id, { name: "Quinoa" });
    const row = stored(db, id);
    expect(row.nutritionSource).toBe("auto");
    expect(row.nutritionFdcId).toBe(autoMatchFood("Quinoa")?.fdcId ?? null);
    expect(row.nutritionFdcId).not.toBe(EGG);
  });
});
