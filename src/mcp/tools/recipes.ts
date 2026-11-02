import { z } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "../../context.js";
import { AppError } from "../../lib/errors.js";
import {
  createRecipeSchema,
  mealTypeSchema,
  recipeStatusSchema,
  setRecipeStatusSchema,
} from "../../schemas/recipes.js";
import { createRuleSchema, ruleScopeSchema, ruleSeveritySchema } from "../../schemas/rules.js";
import {
  createRecipe,
  getRecipe,
  scaleRecipeIngredients,
  searchRecipes,
  setRecipeStatus,
  updateRecipe,
} from "../../services/recipes.js";
import {
  checkIngredients,
  checkRecipe,
  createRule,
  deleteRule,
  listRules,
  updateRule,
} from "../../services/rules.js";
import { requireArg, tool } from "./util.js";

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

const recipeSearchInput = z.object({
  query: z.string().optional().describe("Substring over title, description and tags."),
  status: recipeStatusSchema.optional(),
  tags: z.array(z.string()).optional().describe("A recipe must carry at least one of these tags."),
  mealType: mealTypeSchema.optional(),
  ingredientId: z.string().optional().describe("Only recipes using this ingredient."),
  maxTotalMinutes: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Maximum total time; recipes without time data are excluded."),
  limit: z.number().int().min(1).max(200).optional().describe("Page size (default 50)."),
  offset: z.number().int().min(0).optional(),
});

const recipeGetInput = z.object({
  idOrSlug: z.string().min(1).describe("Recipe id (rcp_…) or slug."),
  servings: z
    .number()
    .positive()
    .optional()
    .describe("Also return the ingredient list scaled to this many servings."),
});

const recipeSaveInput = z
  .object({
    id: z.string().optional().describe("Existing recipe id; omit to create a new recipe."),
    ...createRecipeSchema.shape,
    title: z.string().min(1).optional().describe("Recipe title (required when creating)."),
  })
  .describe(
    "Create (no `id`) or patch (with `id`) a recipe, including its ingredient lines and steps. `ingredients`/`steps` replace the full list.",
  );

const recipeSetStatusInput = z.object({
  recipeId: z.string().min(1).describe("Recipe id (rcp_…)."),
  ...setRecipeStatusSchema.shape,
});

const recipeCheckInput = z.object({
  recipeId: z.string().optional().describe("Check a stored recipe."),
  ingredients: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("Check loose ingredient names before creating them."),
});

// ---------------------------------------------------------------------------
// Dietary rules
// ---------------------------------------------------------------------------

const rulesListInput = z.object({
  scope: ruleScopeSchema.optional(),
  severity: ruleSeveritySchema.optional(),
  memberId: z.string().optional().describe("Only rules for this household member."),
});

const { scope: ruleScopeField, severity: ruleSeverityField, ...ruleTargetFields } =
  createRuleSchema.shape;

const rulesManageInput = z
  .object({
    action: z.enum(["create", "update", "delete"]).describe("Manage dietary rules."),
    ruleId: z.string().optional().describe("Rule id (rule_…) for update/delete."),
    scope: ruleScopeField.optional(),
    severity: ruleSeverityField.optional(),
    ...ruleTargetFields,
  })
  .describe(
    "Targets depend on scope: ingredient (id or name, created when unknown), recipe (recipeId), category/tag/keyword (targetText). Condition notes are judgement calls for the agent.",
  );

export function registerRecipeTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "recipe_search",
    {
      title: "Search recipes",
      description:
        "Find recipes by title/description/tag, status, meal type, ingredient or maximum total time. Returns summaries without steps.",
      inputSchema: recipeSearchInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof recipeSearchInput>) => searchRecipes(ctx, args)),
  );

  server.registerTool(
    "recipe_get",
    {
      title: "Get recipe",
      description:
        "One recipe by id or slug with structured ingredients (nested ingredient ids), ordered steps, times, nutrition, notes and cook stats. Pass `servings` to also get the scaled ingredient list.",
      inputSchema: recipeGetInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof recipeGetInput>) => {
      const recipe = getRecipe(ctx, args.idOrSlug);
      if (args.servings === undefined) return { recipe };
      return { recipe, scaled: scaleRecipeIngredients(ctx, recipe.id, args.servings) };
    }),
  );

  server.registerTool(
    "recipe_save",
    {
      title: "Create or update recipe",
      description:
        "Create a recipe (no `id`; `title` required) or patch one (`id`). Ingredient names resolve through names/aliases/plurals and are created when unknown.",
      inputSchema: recipeSaveInput,
    },
    tool((args: z.infer<typeof recipeSaveInput>) => {
      if (args.id !== undefined) return { recipe: updateRecipe(ctx, args.id, args) };
      const title = args.title?.trim() ?? "";
      if (title === "") {
        throw new AppError("validation", "`title` is required when creating a recipe");
      }
      return { recipe: createRecipe(ctx, { ...args, title }) };
    }),
  );

  server.registerTool(
    "recipe_set_status",
    {
      title: "Set recipe status",
      description:
        "Move a recipe through want_to_try / rotation / never / archived with an optional rating and note; the change is appended to the status history.",
      inputSchema: recipeSetStatusInput,
    },
    tool((args: z.infer<typeof recipeSetStatusInput>) => {
      const { recipeId, ...input } = args;
      return setRecipeStatus(ctx, recipeId, input);
    }),
  );

  server.registerTool(
    "recipe_check",
    {
      title: "Check recipe against rules",
      description:
        "Check a recipe (`recipeId`) or loose ingredient names (`ingredients`) against dietary rules. `ok` is false only for unconditional forbidden matches; violations with a conditionNote are judgement calls you must explain.",
      inputSchema: recipeCheckInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof recipeCheckInput>) => {
      if (args.recipeId !== undefined) return checkRecipe(ctx, args.recipeId);
      if (args.ingredients !== undefined) return checkIngredients(ctx, args.ingredients);
      throw new AppError("validation", "Provide `recipeId` or `ingredients`");
    }),
  );

  server.registerTool(
    "rules_list",
    {
      title: "List dietary rules",
      description:
        "Dietary rules with scope (ingredient/category/recipe/tag/keyword), severity, condition notes, reason and member scope.",
      inputSchema: rulesListInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof rulesListInput>) => listRules(ctx, args)),
  );

  server.registerTool(
    "rules_manage",
    {
      title: "Manage dietary rules",
      description:
        "Create (`scope`+`severity` required), update (`ruleId` + fields) or delete (`ruleId`) a dietary rule.",
      inputSchema: rulesManageInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof rulesManageInput>) => {
      switch (args.action) {
        case "create":
          return {
            rule: createRule(ctx, {
              ...args,
              scope: requireArg(args.scope, "scope"),
              severity: requireArg(args.severity, "severity"),
            }),
          };
        case "update":
          return { rule: updateRule(ctx, requireArg(args.ruleId, "ruleId"), args) };
        case "delete":
          return deleteRule(ctx, requireArg(args.ruleId, "ruleId"));
      }
    }),
  );
}
