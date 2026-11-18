import { z } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "../../context.js";
import { AppError } from "../../lib/errors.js";
import { getRecipeNutrition, searchFoodList, setIngredientNutrition } from "../../services/nutrition.js";
import { requireIngredientId, tool } from "./util.js";

const recipeNutritionInput = z.object({
  idOrSlug: z.string().min(1).describe("Recipe id (rcp_…) or slug."),
});

const searchFoodsInput = z.object({
  query: z.string().min(1).describe('Food name, e.g. "canned diced tomatoes".'),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum results (default 10)."),
});

const setNutritionInput = z.object({
  ingredientId: z.string().optional().describe("Ingredient id (ing_…)."),
  ingredient: z.string().optional().describe("Ingredient name or alias, when no id is given."),
  mode: z
    .enum(["auto", "manual"])
    .describe('"auto" re-runs the name match; "manual" pins `fdcId`.'),
  fdcId: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('USDA food id (from search_foods) for mode "manual"; null clears the match for good.'),
});

export function registerNutritionTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "get_recipe_nutrition",
    {
      title: "Get recipe nutrition",
      description:
        "Calories, protein, carbs, fat, fiber, sugar and sodium (mg) for a recipe, whole and per serving, from USDA FoodData Central. Optional lines are excluded. Lines without a food match, quantity or gram conversion stay blank; each line carries its status and matched food.",
      inputSchema: recipeNutritionInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof recipeNutritionInput>) => getRecipeNutrition(ctx, args.idOrSlug)),
  );

  server.registerTool(
    "search_foods",
    {
      title: "Search USDA foods",
      description:
        "Search the bundled USDA foods by name, best match first, with nutrients per 100 g, portions and a match score. Use the fdcId with set_ingredient_nutrition.",
      inputSchema: searchFoodsInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof searchFoodsInput>) => ({
      items: searchFoodList(args.query, args.limit),
    })),
  );

  server.registerTool(
    "set_ingredient_nutrition",
    {
      title: "Set ingredient USDA food",
      description:
        'Pick the USDA food an ingredient uses for nutrition. mode "auto" re-runs the name match; mode "manual" needs `fdcId` (null clears the match and stops auto-matching). Returns the ingredient with its nutrition.',
      inputSchema: setNutritionInput,
    },
    tool((args: z.infer<typeof setNutritionInput>) => {
      const id = requireIngredientId(ctx, args);
      if (args.mode === "auto") return setIngredientNutrition(ctx, id, { mode: "auto" });
      if (args.fdcId === undefined) {
        throw new AppError("validation", '`fdcId` is required for mode "manual" (null clears)');
      }
      return setIngredientNutrition(ctx, id, { mode: "manual", fdcId: args.fdcId });
    }),
  );
}
