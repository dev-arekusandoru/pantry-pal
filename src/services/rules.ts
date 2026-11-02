import { and, asc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../context.js";
import {
  dietaryRules,
  householdMembers,
  households,
  ingredientAliases,
  ingredients,
  recipeIngredients,
  recipes,
  type IngredientCategory,
  type RuleScope,
  type RuleSeverity,
  type SpiceLevel,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { findIngredientByName, resolveIngredient } from "./ingredients.js";

export type DietaryRule = typeof dietaryRules.$inferSelect;

export interface RuleInput {
  scope: RuleScope;
  /** scope=ingredient: existing ingredient id (alternative to `ingredient`). */
  ingredientId?: string | null;
  /** scope=ingredient: ingredient name, resolved (created when unknown). */
  ingredient?: string;
  /** scope=recipe: recipe id. */
  recipeId?: string | null;
  /** scope=category/tag/keyword. */
  targetText?: string | null;
  severity: RuleSeverity;
  conditionNote?: string | null;
  reason?: string | null;
  memberId?: string | null;
}

export type UpdateRuleInput = Partial<RuleInput>;

export interface ListRulesInput {
  scope?: RuleScope;
  severity?: RuleSeverity;
  memberId?: string;
}

export interface RuleViolation {
  ruleId: string;
  severity: RuleSeverity;
  scope: RuleScope;
  /** The text that matched (ingredient name, tag, recipe title, original line…). */
  matched: string;
  conditionNote: string | null;
  reason: string | null;
}

export interface SpiceCheck {
  recipeLevel: SpiceLevel;
  householdLevel: SpiceLevel;
  exceeds: boolean;
}

export interface RuleCheckResult {
  recipeId: string;
  ok: boolean;
  violations: RuleViolation[];
  spice?: SpiceCheck;
}

export interface IngredientCheckResult {
  name: string;
  ingredientId: string | null;
  category: IngredientCategory | null;
  ok: boolean;
  violations: RuleViolation[];
}

export interface CheckIngredientsResult {
  ok: boolean;
  items: IngredientCheckResult[];
}

const SPICE_RANK: Record<SpiceLevel, number> = { none: 0, mild: 1, medium: 2, hot: 3 };

/** Conditional forbidden matches must be judged by the caller; blank notes do not count. */
function violationsOk(violations: RuleViolation[]): boolean {
  return violations.every(
    (violation) =>
      violation.severity !== "forbidden" ||
      (violation.conditionNote !== null && violation.conditionNote.trim() !== ""),
  );
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

interface NormalizedTarget {
  ingredientId: string | null;
  recipeId: string | null;
  targetText: string | null;
}

function requireIngredient(ctx: Ctx, id: string): string {
  const row = ctx.db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, id)))
    .get();
  if (!row) throw new AppError("not_found", `Ingredient not found: ${id}`, { ingredientId: id });
  return row.id;
}

function requireRecipe(ctx: Ctx, id: string): string {
  const row = ctx.db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.householdId, ctx.householdId), eq(recipes.id, id)))
    .get();
  if (!row) throw new AppError("not_found", `Recipe not found: ${id}`, { recipeId: id });
  return row.id;
}

function requireMember(ctx: Ctx, id: string): string {
  const row = ctx.db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.id, id)))
    .get();
  if (!row) {
    throw new AppError("not_found", `Household member not found: ${id}`, { memberId: id });
  }
  return row.id;
}

function normalizeTarget(
  ctx: Ctx,
  scope: RuleScope,
  fields: {
    ingredientId?: string | null;
    ingredient?: string;
    recipeId?: string | null;
    targetText?: string | null;
  },
): NormalizedTarget {
  switch (scope) {
    case "ingredient": {
      const id = fields.ingredientId ?? null;
      if (id !== null && id !== "") {
        return { ingredientId: requireIngredient(ctx, id), recipeId: null, targetText: null };
      }
      const name = fields.ingredient?.trim() ?? "";
      if (name === "") {
        throw new AppError(
          "validation",
          "Ingredient rules need `ingredientId` or `ingredient` (name)",
          { scope },
        );
      }
      // create: true so a ban can be recorded before the ingredient is ever used.
      const ingredient = resolveIngredient(ctx, name, { create: true });
      return { ingredientId: ingredient.id, recipeId: null, targetText: null };
    }
    case "recipe": {
      const id = fields.recipeId ?? null;
      if (id === null || id === "") {
        throw new AppError("validation", "Recipe rules need `recipeId`", { scope });
      }
      return { ingredientId: null, recipeId: requireRecipe(ctx, id), targetText: null };
    }
    case "category":
    case "tag":
    case "keyword": {
      const text = fields.targetText?.trim() ?? "";
      if (text === "") {
        throw new AppError("validation", `${scope} rules need \`targetText\``, { scope });
      }
      return { ingredientId: null, recipeId: null, targetText: text };
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listRules(ctx: Ctx, input: ListRulesInput = {}): { items: DietaryRule[] } {
  const conditions = [eq(dietaryRules.householdId, ctx.householdId)];
  if (input.scope !== undefined) conditions.push(eq(dietaryRules.scope, input.scope));
  if (input.severity !== undefined) conditions.push(eq(dietaryRules.severity, input.severity));
  if (input.memberId !== undefined) conditions.push(eq(dietaryRules.memberId, input.memberId));

  const items = ctx.db
    .select()
    .from(dietaryRules)
    .where(and(...conditions))
    .orderBy(asc(dietaryRules.createdAt), asc(dietaryRules.id))
    .all();
  return { items };
}

export function getRule(ctx: Ctx, id: string): DietaryRule {
  const row = ctx.db
    .select()
    .from(dietaryRules)
    .where(and(eq(dietaryRules.householdId, ctx.householdId), eq(dietaryRules.id, id)))
    .get();
  if (!row) throw new AppError("not_found", `Dietary rule not found: ${id}`, { id });
  return row;
}

export function createRule(ctx: Ctx, input: RuleInput): DietaryRule {
  const target = normalizeTarget(ctx, input.scope, input);
  const memberId = input.memberId ?? null;
  if (memberId !== null) requireMember(ctx, memberId);

  const timestamp = nowIso(ctx);
  return ctx.db
    .insert(dietaryRules)
    .values({
      id: newId("rule"),
      householdId: ctx.householdId,
      scope: input.scope,
      ingredientId: target.ingredientId,
      recipeId: target.recipeId,
      targetText: target.targetText,
      severity: input.severity,
      conditionNote: input.conditionNote ?? null,
      reason: input.reason ?? null,
      memberId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()
    .get();
}

export function updateRule(ctx: Ctx, id: string, patch: UpdateRuleInput): DietaryRule {
  const existing = getRule(ctx, id);
  const scope = patch.scope ?? existing.scope;

  const target = normalizeTarget(ctx, scope, {
    ingredientId: patch.ingredientId !== undefined ? patch.ingredientId : existing.ingredientId,
    ...(patch.ingredient === undefined ? {} : { ingredient: patch.ingredient }),
    recipeId: patch.recipeId !== undefined ? patch.recipeId : existing.recipeId,
    targetText: patch.targetText !== undefined ? patch.targetText : existing.targetText,
  });

  const memberId = patch.memberId !== undefined ? patch.memberId : existing.memberId;
  if (memberId !== null) requireMember(ctx, memberId);

  return ctx.db
    .update(dietaryRules)
    .set({
      scope,
      ingredientId: target.ingredientId,
      recipeId: target.recipeId,
      targetText: target.targetText,
      ...(patch.severity === undefined ? {} : { severity: patch.severity }),
      ...(patch.conditionNote === undefined ? {} : { conditionNote: patch.conditionNote }),
      ...(patch.reason === undefined ? {} : { reason: patch.reason }),
      memberId,
      updatedAt: nowIso(ctx),
    })
    .where(and(eq(dietaryRules.householdId, ctx.householdId), eq(dietaryRules.id, existing.id)))
    .returning()
    .get();
}

export function deleteRule(ctx: Ctx, id: string): { deleted: true; id: string } {
  const existing = getRule(ctx, id);
  ctx.db
    .delete(dietaryRules)
    .where(and(eq(dietaryRules.householdId, ctx.householdId), eq(dietaryRules.id, existing.id)))
    .run();
  return { deleted: true as const, id: existing.id };
}

// ---------------------------------------------------------------------------
// Rule checking
// ---------------------------------------------------------------------------

interface RecipeIngredientFact {
  ingredientId: string;
  name: string;
  category: IngredientCategory;
  originalText: string | null;
}

function aliasesByIngredient(ctx: Ctx, ingredientIds: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (ingredientIds.length === 0) return result;

  const rows = ctx.db
    .select({ ingredientId: ingredientAliases.ingredientId, alias: ingredientAliases.alias })
    .from(ingredientAliases)
    .where(
      and(
        eq(ingredientAliases.householdId, ctx.householdId),
        inArray(ingredientAliases.ingredientId, ingredientIds),
      ),
    )
    .all();

  for (const row of rows) {
    const list = result.get(row.ingredientId);
    if (list === undefined) result.set(row.ingredientId, [row.alias]);
    else list.push(row.alias);
  }
  return result;
}

/** Escape every regex metacharacter so keyword text matches literally. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word pattern for a keyword.
 *
 * The keyword (possibly multi-word, e.g. "pot roast") must sit on word
 * boundaries: it never matches inside a longer word ("ham" ≠ "hamburger",
 * "graham"). Words of a multi-word keyword may be separated by any run of
 * non-alphanumeric characters (space, hyphen, comma…), which also makes
 * hyphen/punctuation act as a boundary ("pork-free" matches "pork"). The last
 * word tolerates a trailing "s"/"es" unless it already ends in "s", so
 * "mushroom" matches "mushrooms" and "Cremini mushrooms".
 */
function keywordPattern(needle: string): RegExp | null {
  const words = needle
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
  const lastWord = words[words.length - 1];
  if (lastWord === undefined) return null;
  const body = [...words.slice(0, -1).map(escapeRegex), escapeRegex(lastWord)].join(
    "[^\\p{L}\\p{N}]+",
  );
  const tail = /s$/i.test(lastWord) ? "" : "(?:es|s)?";
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${tail}(?![\\p{L}\\p{N}])`, "iu");
}

/** First haystack containing the keyword as a whole word (case-insensitive). */
function keywordMatch(needle: string, haystacks: Array<string | null>): string | null {
  const pattern = keywordPattern(needle);
  if (pattern === null) return null;
  for (const haystack of haystacks) {
    if (haystack !== null && pattern.test(haystack)) return haystack;
  }
  return null;
}

/** First matching fact for one rule, or null. */
function matchRecipeRule(
  rule: DietaryRule,
  recipe: { id: string; title: string; tags: string[] },
  facts: RecipeIngredientFact[],
  aliases: Map<string, string[]>,
): string | null {
  const target = rule.targetText?.trim() ?? "";
  switch (rule.scope) {
    case "ingredient": {
      const fact = facts.find((item) => item.ingredientId === rule.ingredientId);
      return fact ? fact.name : null;
    }
    case "category": {
      const category = target.toLowerCase();
      const fact = facts.find((item) => item.category.toLowerCase() === category);
      return fact ? fact.name : null;
    }
    case "tag": {
      const tag = target.toLowerCase();
      return recipe.tags.find((value) => value.toLowerCase() === tag) ?? null;
    }
    case "keyword": {
      const needle = target.toLowerCase();
      if (needle === "") return null;
      const haystacks: Array<string | null> = [recipe.title];
      for (const fact of facts) {
        haystacks.push(fact.name);
        for (const alias of aliases.get(fact.ingredientId) ?? []) haystacks.push(alias);
      }
      for (const fact of facts) haystacks.push(fact.originalText);
      return keywordMatch(needle, haystacks);
    }
    case "recipe":
      return rule.recipeId === recipe.id ? recipe.title : null;
  }
}

/**
 * Check a recipe against the household's dietary rules.
 *
 * Unconditional `forbidden` matches make `ok` false; violations carrying a
 * `conditionNote` are reported for the caller to judge and do not flip `ok`.
 */
export function checkRecipe(ctx: Ctx, recipeId: string): RuleCheckResult {
  const recipe = ctx.db
    .select({ id: recipes.id, title: recipes.title, tags: recipes.tags, spiceLevel: recipes.spiceLevel })
    .from(recipes)
    .where(and(eq(recipes.householdId, ctx.householdId), eq(recipes.id, recipeId)))
    .get();
  if (!recipe) {
    throw new AppError("not_found", `Recipe not found: ${recipeId}`, { recipeId });
  }

  const facts = ctx.db
    .select({
      ingredientId: ingredients.id,
      name: ingredients.name,
      category: ingredients.category,
      originalText: recipeIngredients.originalText,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
    .where(
      and(
        eq(recipeIngredients.householdId, ctx.householdId),
        eq(recipeIngredients.recipeId, recipe.id),
      ),
    )
    .orderBy(asc(recipeIngredients.position), asc(recipeIngredients.id))
    .all();

  const aliases = aliasesByIngredient(
    ctx,
    [...new Set(facts.map((fact) => fact.ingredientId))],
  );

  const rules = ctx.db
    .select()
    .from(dietaryRules)
    .where(eq(dietaryRules.householdId, ctx.householdId))
    .orderBy(asc(dietaryRules.createdAt), asc(dietaryRules.id))
    .all();

  const violations: RuleViolation[] = [];
  for (const rule of rules) {
    const matched = matchRecipeRule(rule, recipe, facts, aliases);
    if (matched === null) continue;
    violations.push({
      ruleId: rule.id,
      severity: rule.severity,
      scope: rule.scope,
      matched,
      conditionNote: rule.conditionNote,
      reason: rule.reason,
    });
  }

  const result: RuleCheckResult = {
    recipeId: recipe.id,
    ok: violationsOk(violations),
    violations,
  };

  if (recipe.spiceLevel !== null) {
    const household = ctx.db
      .select({ settings: households.settings })
      .from(households)
      .where(eq(households.id, ctx.householdId))
      .get();
    const householdLevel = household?.settings.spiceLevel ?? "medium";
    result.spice = {
      recipeLevel: recipe.spiceLevel,
      householdLevel,
      exceeds: SPICE_RANK[recipe.spiceLevel] > SPICE_RANK[householdLevel],
    };
  }

  return result;
}

/**
 * Check loose ingredient names before creating a recipe or shopping item
 * (e.g. an agent proposing ingredients that do not exist yet).
 */
export function checkIngredients(ctx: Ctx, names: string[]): CheckIngredientsResult {
  const cleaned = names.map((name) => name.trim()).filter((name) => name !== "");
  if (cleaned.length === 0) {
    throw new AppError("validation", "Provide at least one ingredient name");
  }

  const rules = ctx.db
    .select()
    .from(dietaryRules)
    .where(eq(dietaryRules.householdId, ctx.householdId))
    .orderBy(asc(dietaryRules.createdAt), asc(dietaryRules.id))
    .all();

  const items: IngredientCheckResult[] = cleaned.map((name) => {
    const ingredient = findIngredientByName(ctx, name);
    const aliases =
      ingredient === null
        ? []
        : ctx.db
            .select({ alias: ingredientAliases.alias })
            .from(ingredientAliases)
            .where(
              and(
                eq(ingredientAliases.householdId, ctx.householdId),
                eq(ingredientAliases.ingredientId, ingredient.id),
              ),
            )
            .all()
            .map((row) => row.alias);

    const category = ingredient?.category ?? null;
    const violations: RuleViolation[] = [];

    for (const rule of rules) {
      const target = rule.targetText?.trim() ?? "";
      let matched: string | null = null;

      if (rule.scope === "ingredient") {
        if (ingredient !== null && rule.ingredientId === ingredient.id) matched = ingredient.name;
      } else if (rule.scope === "category") {
        if (category !== null && target.toLowerCase() === category.toLowerCase()) {
          matched = ingredient === null ? name : ingredient.name;
        }
      } else if (rule.scope === "keyword") {
        const needle = target.toLowerCase();
        if (needle !== "") {
          matched = keywordMatch(
            needle,
            ingredient === null ? [name] : [ingredient.name, ...aliases],
          );
        }
      }
      // tag / recipe scopes do not apply to a bare ingredient name.

      if (matched === null) continue;
      violations.push({
        ruleId: rule.id,
        severity: rule.severity,
        scope: rule.scope,
        matched,
        conditionNote: rule.conditionNote,
        reason: rule.reason,
      });
    }

    return {
      name,
      ingredientId: ingredient?.id ?? null,
      category,
      ok: violationsOk(violations),
      violations,
    };
  });

  return { ok: items.every((item) => item.ok), items };
}
