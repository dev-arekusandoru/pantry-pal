import { describe, expect, it } from "vitest";
import { ingredientAliases } from "../src/db/schema.js";
import { AppError } from "../src/lib/errors.js";
import { newId } from "../src/lib/ids.js";
import {
  createMember,
  deleteMember,
  listMembers,
  updateHousehold,
  updateMember,
} from "../src/services/households.js";
import { findIngredientByName, resolveIngredient } from "../src/services/ingredients.js";
import { createRecipe } from "../src/services/recipes.js";
import {
  checkIngredients,
  checkRecipe,
  createRule,
  deleteRule,
  listRules,
  updateRule,
} from "../src/services/rules.js";
import { makeTestCtx } from "./helpers.js";

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

describe("rule targets", () => {
  it("resolves an ingredient name and creates it when unknown", () => {
    const { ctx } = makeTestCtx();

    const rule = createRule(ctx, {
      scope: "ingredient",
      ingredient: "Eggplant",
      severity: "forbidden",
      reason: "dislike",
    });

    expect(rule.ingredientId).not.toBeNull();
    expect(rule.recipeId).toBeNull();
    expect(rule.targetText).toBeNull();
    expect(findIngredientByName(ctx, "eggplant")?.id).toBe(rule.ingredientId);
  });

  it("validates scope against target", () => {
    const { ctx } = makeTestCtx();

    expectAppError(() => createRule(ctx, { scope: "tag", severity: "forbidden" }), "validation");
    expectAppError(
      () => createRule(ctx, { scope: "keyword", targetText: "   ", severity: "avoid" }),
      "validation",
    );
    expectAppError(
      () => createRule(ctx, { scope: "ingredient", severity: "forbidden" }),
      "validation",
    );
    expectAppError(() => createRule(ctx, { scope: "recipe", severity: "forbidden" }), "validation");
    expectAppError(
      () => createRule(ctx, { scope: "recipe", recipeId: "rcp_missing", severity: "forbidden" }),
      "not_found",
    );
  });
});

describe("rule CRUD", () => {
  it("updates targets, severity and condition notes", () => {
    const { ctx } = makeTestCtx();

    const rule = createRule(ctx, {
      scope: "tag",
      targetText: "spicy",
      severity: "avoid",
      conditionNote: "minor role ok",
    });

    const updated = updateRule(ctx, rule.id, {
      scope: "keyword",
      targetText: "sesame",
      severity: "forbidden",
      conditionNote: null,
    });

    expect(updated).toMatchObject({
      scope: "keyword",
      targetText: "sesame",
      severity: "forbidden",
      conditionNote: null,
      ingredientId: null,
      recipeId: null,
    });
  });

  it("lists with filters and deletes", () => {
    const { ctx } = makeTestCtx();

    const forbidden = createRule(ctx, { scope: "keyword", targetText: "pork", severity: "forbidden" });
    createRule(ctx, { scope: "keyword", targetText: "mayo", severity: "avoid" });

    expect(listRules(ctx).items).toHaveLength(2);
    expect(listRules(ctx, { severity: "forbidden" }).items.map((rule) => rule.id)).toEqual([
      forbidden.id,
    ]);
    expect(listRules(ctx, { scope: "keyword" }).items).toHaveLength(2);
    expect(listRules(ctx, { scope: "tag" }).items).toHaveLength(0);

    expect(deleteRule(ctx, forbidden.id)).toEqual({ deleted: true, id: forbidden.id });
    expect(listRules(ctx).items).toHaveLength(1);
    expectAppError(() => deleteRule(ctx, forbidden.id), "not_found");
  });
});

describe("checkRecipe", () => {
  it("matches ingredient rules by ingredient id", () => {
    const { ctx } = makeTestCtx();
    const mushroom = resolveIngredient(ctx, "Mushrooms", { create: true });

    const recipe = createRecipe(ctx, {
      title: "Risotto",
      ingredients: [
        { ingredient: "Mushrooms", qty: 200, unit: "g" },
        { ingredient: "Arborio rice", qty: 1, unit: "cup" },
      ],
    });
    const rule = createRule(ctx, {
      scope: "ingredient",
      ingredient: "mushroom",
      severity: "forbidden",
      reason: "allergy",
    });

    const check = checkRecipe(ctx, recipe.id);
    expect(check.recipeId).toBe(recipe.id);
    expect(check.ok).toBe(false);
    expect(check.violations).toHaveLength(1);
    expect(check.violations[0]).toEqual({
      ruleId: rule.id,
      severity: "forbidden",
      scope: "ingredient",
      matched: "Mushrooms",
      conditionNote: null,
      reason: "allergy",
    });
    expect(rule.ingredientId).toBe(mushroom.id);
  });

  it("matches category rules case-insensitively", () => {
    const { ctx } = makeTestCtx();

    const recipe = createRecipe(ctx, {
      title: "Pork Belly Buns",
      ingredients: [{ ingredient: "Pork belly", category: "protein", qty: 500, unit: "g" }],
    });
    createRule(ctx, { scope: "category", targetText: "PROTEIN", severity: "forbidden" });

    const check = checkRecipe(ctx, recipe.id);
    expect(check.ok).toBe(false);
    expect(check.violations[0]).toMatchObject({ scope: "category", matched: "Pork belly" });
  });

  it("matches keyword rules through ingredient aliases", () => {
    const { ctx } = makeTestCtx();
    const cremini = resolveIngredient(ctx, "Cremini caps", { create: true });
    ctx.db
      .insert(ingredientAliases)
      .values({
        id: newId("ali"),
        householdId: ctx.householdId,
        ingredientId: cremini.id,
        alias: "mushroom",
      })
      .run();

    const recipe = createRecipe(ctx, {
      title: "Caps Bake",
      ingredients: [{ ingredient: "Cremini caps", qty: 200, unit: "g" }],
    });
    createRule(ctx, { scope: "keyword", targetText: "mushroom", severity: "forbidden" });

    const check = checkRecipe(ctx, recipe.id);
    expect(check.ok).toBe(false);
    expect(check.violations[0]).toMatchObject({ scope: "keyword", matched: "mushroom" });
  });

  it("matches keyword rules against the original recipe line", () => {
    const { ctx } = makeTestCtx();

    const recipe = createRecipe(ctx, {
      title: "Stir Fry",
      ingredients: [
        {
          ingredient: "Rice noodles",
          qty: 200,
          unit: "g",
          originalText: "200 g rice noodles",
        },
        {
          ingredient: "Soy sauce",
          qty: 2,
          unit: "tbsp",
          originalText: "2 tbsp fish sauce",
        },
      ],
    });
    createRule(ctx, { scope: "keyword", targetText: "fish sauce", severity: "forbidden" });

    const check = checkRecipe(ctx, recipe.id);
    expect(check.violations[0]).toMatchObject({
      scope: "keyword",
      matched: "2 tbsp fish sauce",
    });
  });

  it("does not flag chili made with a hamburger meat alias as pork", () => {
    const { ctx } = makeTestCtx();
    const beef = resolveIngredient(ctx, "Ground beef", { create: true });
    ctx.db
      .insert(ingredientAliases)
      .values({
        id: newId("ali"),
        householdId: ctx.householdId,
        ingredientId: beef.id,
        alias: "hamburger meat",
      })
      .run();

    const chili = createRecipe(ctx, {
      title: "Weeknight Chili",
      ingredients: [{ ingredient: "Ground beef", qty: 500, unit: "g" }],
    });
    createRule(ctx, {
      scope: "keyword",
      targetText: "ham",
      severity: "forbidden",
      reason: "pork",
    });

    const check = checkRecipe(ctx, chili.id);
    expect(check.violations).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it("does not match keyword text inside longer words", () => {
    const { ctx } = makeTestCtx();
    createRule(ctx, { scope: "keyword", targetText: "ham", severity: "forbidden" });

    const result = checkIngredients(ctx, [
      "Hamburger meat",
      "Graham crackers",
      "Shallots",
      "Ground beef",
    ]);

    expect(result.ok).toBe(true);
    expect(result.items.map((item) => item.violations)).toEqual([[], [], [], []]);
  });

  it("matches keywords on word boundaries with plural tolerance", () => {
    const { ctx } = makeTestCtx();
    createRule(ctx, { scope: "keyword", targetText: "ham", severity: "forbidden" });

    const result = checkIngredients(ctx, ["Ham", "hams", "diced ham", "Ham steak"]);

    expect(result.items.map((item) => item.ok)).toEqual([false, false, false, false]);
    for (const item of result.items) {
      expect(item.violations[0]).toMatchObject({ scope: "keyword" });
    }
  });

  it("matches plural keyword forms on a word boundary", () => {
    const { ctx } = makeTestCtx();
    createRule(ctx, { scope: "keyword", targetText: "mushroom", severity: "forbidden" });

    const result = checkIngredients(ctx, ["Cremini mushrooms", "Mushrooms"]);

    expect(result.items.map((item) => item.ok)).toEqual([false, false]);
  });

  it("matches multi-word keywords across punctuation and allows a plural tail", () => {
    const { ctx } = makeTestCtx();
    createRule(ctx, { scope: "keyword", targetText: "pot roast", severity: "forbidden" });

    const result = checkIngredients(ctx, [
      "Sunday pot roast",
      "pot-roast",
      "potato roast",
      "pot roasts",
    ]);

    expect(result.items.map((item) => item.ok)).toEqual([false, false, true, false]);
  });

  it("treats hyphens and punctuation as word separators", () => {
    const { ctx } = makeTestCtx();
    createRule(ctx, { scope: "keyword", targetText: "pork", severity: "forbidden" });

    const result = checkIngredients(ctx, ["Pork-free stock", "popork"]);

    expect(result.items.map((item) => item.ok)).toEqual([false, true]);
  });

  it("escapes regex metacharacters in keyword rules", () => {
    const { ctx } = makeTestCtx();
    createRule(ctx, { scope: "keyword", targetText: "a.b", severity: "forbidden" });

    const result = checkIngredients(ctx, ["a.b marinade", "axb marinade"]);

    expect(result.items.map((item) => item.ok)).toEqual([false, true]);
  });

  it("matches tag and recipe rules", () => {
    const { ctx } = makeTestCtx();

    const recipe = createRecipe(ctx, {
      title: "Kung Pao Chicken",
      tags: ["Spicy", "takeout"],
      ingredients: [{ ingredient: "Chicken breast", category: "protein" }],
    });

    const tagRule = createRule(ctx, { scope: "tag", targetText: "spicy", severity: "avoid" });
    const recipeRule = createRule(ctx, {
      scope: "recipe",
      recipeId: recipe.id,
      severity: "forbidden",
      reason: "dislike",
    });

    const check = checkRecipe(ctx, recipe.id);
    expect(check.ok).toBe(false); // the unconditional recipe ban
    expect(check.violations).toHaveLength(2);
    expect(check.violations).toEqual(
      expect.arrayContaining([
        {
          ruleId: tagRule.id,
          severity: "avoid",
          scope: "tag",
          matched: "Spicy",
          conditionNote: null,
          reason: null,
        },
        {
          ruleId: recipeRule.id,
          severity: "forbidden",
          scope: "recipe",
          matched: "Kung Pao Chicken",
          conditionNote: null,
          reason: "dislike",
        },
      ]),
    );
  });

  it("reports conditional forbidden matches without flipping ok", () => {
    const { ctx } = makeTestCtx();

    const recipe = createRecipe(ctx, {
      title: "Pad Thai",
      ingredients: [
        { ingredient: "Rice noodles", qty: 200, unit: "g" },
        { ingredient: "Fish sauce", qty: 2, unit: "tbsp" },
      ],
    });
    const rule = createRule(ctx, {
      scope: "keyword",
      targetText: "fish sauce",
      severity: "forbidden",
      conditionNote: "ok as a minor ingredient",
    });

    const check = checkRecipe(ctx, recipe.id);
    expect(check.ok).toBe(true);
    expect(check.violations).toHaveLength(1);
    expect(check.violations[0]).toMatchObject({
      ruleId: rule.id,
      severity: "forbidden",
      matched: "Fish sauce",
      conditionNote: "ok as a minor ingredient",
    });
  });

  it("flags recipes hotter than the household tolerance", () => {
    const { ctx } = makeTestCtx({ settings: { spiceLevel: "mild" } });

    const hot = createRecipe(ctx, { title: "Hot Wings", spiceLevel: "hot" });
    const plain = createRecipe(ctx, { title: "Plain Rice", spiceLevel: "none" });
    const unknown = createRecipe(ctx, { title: "No Spice Set" });

    expect(checkRecipe(ctx, hot.id).spice).toEqual({
      recipeLevel: "hot",
      householdLevel: "mild",
      exceeds: true,
    });
    expect(checkRecipe(ctx, plain.id).spice).toMatchObject({ exceeds: false });
    expect(checkRecipe(ctx, unknown.id).spice).toBeUndefined();
  });

  it("rejects unknown recipes", () => {
    const { ctx } = makeTestCtx();
    expectAppError(() => checkRecipe(ctx, "rcp_missing"), "not_found");
  });
});

describe("checkIngredients", () => {
  it("checks known ingredients and proposed names before creation", () => {
    const { ctx } = makeTestCtx();
    const mushroom = resolveIngredient(ctx, "Mushrooms", { create: true });

    createRule(ctx, {
      scope: "ingredient",
      ingredientId: mushroom.id,
      severity: "forbidden",
      reason: "allergy",
    });
    createRule(ctx, { scope: "keyword", targetText: "oyster", severity: "avoid" });

    const result = checkIngredients(ctx, ["Mushrooms", "Chicken thighs", "Oyster sauce"]);

    expect(result.ok).toBe(false);
    expect(result.items).toHaveLength(3);

    const mushrooms = result.items[0]!;
    const chicken = result.items[1]!;
    const oyster = result.items[2]!;
    expect(mushrooms).toMatchObject({
      name: "Mushrooms",
      ingredientId: mushroom.id,
      category: "other",
      ok: false,
    });
    expect(mushrooms.violations[0]!).toMatchObject({
      scope: "ingredient",
      severity: "forbidden",
      matched: "Mushrooms",
      reason: "allergy",
    });

    expect(chicken).toMatchObject({ ingredientId: null, category: null, ok: true, violations: [] });

    expect(oyster).toMatchObject({ ingredientId: null, category: null, ok: true });
    expect(oyster.violations[0]!).toMatchObject({ scope: "keyword", matched: "Oyster sauce" });
  });

  it("requires at least one non-blank name", () => {
    const { ctx } = makeTestCtx();
    expectAppError(() => checkIngredients(ctx, []), "validation");
    expectAppError(() => checkIngredients(ctx, ["  "]), "validation");
  });
});

describe("household settings and members", () => {
  it("merges partial settings instead of replacing them", () => {
    const { ctx } = makeTestCtx({ settings: { spiceLevel: "mild" } });

    const updated = updateHousehold(ctx, { settings: { dinnerServings: 6 } });

    expect(updated.settings).toMatchObject({
      spiceLevel: "mild",
      dinnerServings: 6,
      defaultServings: 2,
    });
    expect(updateHousehold(ctx, { name: "  Renamed  " }).name).toBe("Renamed");
    expectAppError(() => updateHousehold(ctx, { name: "   " }), "validation");
  });

  it("creates, updates and deletes members, cascading member rules", () => {
    const { ctx } = makeTestCtx();

    const member = createMember(ctx, { name: "Robin", notes: "no mushrooms" });
    expect(listMembers(ctx).items).toHaveLength(1);
    expect(updateMember(ctx, member.id, { name: "Sam" }).name).toBe("Sam");

    const rule = createRule(ctx, {
      scope: "keyword",
      targetText: "mushroom",
      severity: "forbidden",
      memberId: member.id,
    });
    expect(rule.memberId).toBe(member.id);
    expect(listRules(ctx, { memberId: member.id }).items).toHaveLength(1);

    expect(deleteMember(ctx, member.id)).toEqual({ deleted: true, id: member.id });
    expect(listMembers(ctx).items).toHaveLength(0);
    expect(listRules(ctx).items).toHaveLength(0);
    expectAppError(() => updateMember(ctx, member.id, { name: "Gone" }), "not_found");
  });
});
