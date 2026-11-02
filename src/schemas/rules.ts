import { z } from "@hono/zod-openapi";
import { RULE_SCOPES, RULE_SEVERITIES } from "../db/schema.js";
import { ingredientCategorySchema, spiceLevelSchema } from "./recipes.js";

export const ruleScopeSchema = z
  .enum(RULE_SCOPES)
  .openapi("RuleScope", {
    description:
      'What the rule targets: "ingredient", "category", "recipe", "tag" or "keyword".',
  });

export const ruleSeveritySchema = z
  .enum(RULE_SEVERITIES)
  .openapi("RuleSeverity", {
    description:
      '"forbidden" (hard ban unless a condition note applies), "avoid" or "limit".',
  });

const ruleFields = {
  scope: ruleScopeSchema,
  ingredientId: z
    .string()
    .nullable()
    .describe("scope=ingredient: existing ingredient id (alternative to `ingredient`)."),
  ingredient: z
    .string()
    .describe("scope=ingredient: ingredient name; resolved and created when unknown."),
  recipeId: z.string().nullable().describe("scope=recipe: the recipe id to exclude."),
  targetText: z
    .string()
    .nullable()
    .describe("scope=category: category name; scope=tag: tag; scope=keyword: substring."),
  severity: ruleSeveritySchema,
  conditionNote: z
    .string()
    .nullable()
    .describe(
      'Condition the agent must judge, e.g. "ok if a minor ingredient" / "except tuna and salmon".',
    ),
  reason: z.string().nullable().describe('Why the rule exists ("allergy", "dislike").'),
  memberId: z
    .string()
    .nullable()
    .describe("Household member this applies to; null = whole household."),
} as const;

export const createRuleSchema = z
  .object(ruleFields)
  .partial()
  .extend({
    scope: ruleScopeSchema,
    severity: ruleSeveritySchema,
  })
  .openapi("CreateDietaryRuleInput");

export const updateRuleSchema = z
  .object(ruleFields)
  .partial()
  .openapi("UpdateDietaryRuleInput");

export const dietaryRuleSchema = z
  .object({
    id: z.string(),
    householdId: z.string(),
    scope: ruleScopeSchema,
    ingredientId: z.string().nullable(),
    recipeId: z.string().nullable(),
    targetText: z.string().nullable(),
    severity: ruleSeveritySchema,
    conditionNote: z.string().nullable(),
    reason: z.string().nullable(),
    memberId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("DietaryRule");

export const ruleListSchema = z
  .object({ items: z.array(dietaryRuleSchema) })
  .openapi("DietaryRuleList");

export const listRulesQuerySchema = z.object({
  scope: ruleScopeSchema.optional(),
  severity: ruleSeveritySchema.optional(),
  memberId: z.string().optional().describe("Only rules for this household member."),
});

export const ruleViolationSchema = z
  .object({
    ruleId: z.string(),
    severity: ruleSeveritySchema,
    scope: ruleScopeSchema,
    matched: z
      .string()
      .describe("The text that matched: an ingredient name, tag, recipe title or original line."),
    conditionNote: z
      .string()
      .nullable()
      .describe("When set, the caller must judge whether the exception applies."),
    reason: z.string().nullable(),
  })
  .openapi("RuleViolation");

export const spiceCheckSchema = z
  .object({
    recipeLevel: spiceLevelSchema,
    householdLevel: spiceLevelSchema,
    exceeds: z.boolean(),
  })
  .openapi("SpiceCheck");

export const ruleCheckSchema = z
  .object({
    recipeId: z.string(),
    ok: z
      .boolean()
      .describe(
        "False only when a forbidden rule matched without a condition note; conditional violations are reported for the agent to judge.",
      ),
    violations: z.array(ruleViolationSchema),
    spice: spiceCheckSchema.optional(),
  })
  .openapi("RecipeRuleCheck");

export const checkIngredientsInputSchema = z
  .object({
    names: z
      .array(z.string().min(1))
      .min(1)
      .describe("Ingredient names to check before creating them."),
  })
  .openapi("CheckIngredientsInput");

export const ingredientCheckSchema = z
  .object({
    name: z.string(),
    ingredientId: z.string().nullable(),
    category: ingredientCategorySchema.nullable(),
    ok: z.boolean(),
    violations: z.array(ruleViolationSchema),
  })
  .openapi("IngredientRuleCheck");

export const checkIngredientsResultSchema = z
  .object({
    ok: z.boolean(),
    items: z.array(ingredientCheckSchema),
  })
  .openapi("CheckIngredientsResult");

export const ruleIdParamSchema = z.object({
  id: z.string().min(1).describe("Rule id."),
});

export const deleteRuleResultSchema = z
  .object({ deleted: z.boolean(), id: z.string() })
  .openapi("DeleteDietaryRuleResult");
