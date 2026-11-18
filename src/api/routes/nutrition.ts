import { createRoute, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { ZodType } from "zod";
import type { AppEnv } from "../../auth/middleware.js";
import { ingredientParamsSchema, ingredientViewSchema } from "../../schemas/ingredients.js";
import {
  foodListSchema,
  recipeNutritionSchema,
  searchFoodsQuerySchema,
  setIngredientNutritionSchema,
} from "../../schemas/nutrition.js";
import { idOrSlugParamSchema } from "../../schemas/recipes.js";
import {
  getRecipeNutrition,
  searchFoodList,
  setIngredientNutrition,
} from "../../services/nutrition.js";

const json = <T extends ZodType>(schema: T) => ({ "application/json": { schema } });

const searchFoodsRoute = createRoute({
  method: "get",
  path: "/nutrition/foods",
  tags: ["nutrition"],
  summary: "Search USDA foods",
  description:
    "Search the bundled USDA FoodData Central foods by name, best match first. Nutrients are per 100 g (sodium in mg).",
  request: { query: searchFoodsQuerySchema },
  responses: { 200: { description: "Matching foods", content: json(foodListSchema) } },
});

const searchFoodsHandler: RouteHandler<typeof searchFoodsRoute, AppEnv> = (c) => {
  const { q, limit } = c.req.valid("query");
  return c.json({ items: searchFoodList(q, limit) }, 200);
};

const setIngredientNutritionRoute = createRoute({
  method: "put",
  path: "/ingredients/{id}/nutrition",
  tags: ["nutrition"],
  summary: "Set an ingredient's USDA food",
  description:
    'mode "auto" re-runs the name match; mode "manual" pins `fdcId` (null clears the match and stops auto-matching).',
  request: {
    params: ingredientParamsSchema,
    body: { content: json(setIngredientNutritionSchema), required: true },
  },
  responses: { 200: { description: "Updated ingredient", content: json(ingredientViewSchema) } },
});

const setIngredientNutritionHandler: RouteHandler<typeof setIngredientNutritionRoute, AppEnv> = (
  c,
) =>
  c.json(
    setIngredientNutrition(c.var.ctx, c.req.valid("param").id, c.req.valid("json")),
    200,
  );

const recipeNutritionRoute = createRoute({
  method: "get",
  path: "/recipes/{idOrSlug}/nutrition",
  tags: ["nutrition"],
  summary: "Get recipe nutrition",
  description:
    "Calories, protein, carbs, fat, fiber, sugar and sodium for the whole recipe and per serving. Optional lines are excluded; lines without a USDA match, quantity or gram conversion stay blank and are reported per line.",
  request: { params: idOrSlugParamSchema },
  responses: { 200: { description: "Recipe nutrition", content: json(recipeNutritionSchema) } },
});

const recipeNutritionHandler: RouteHandler<typeof recipeNutritionRoute, AppEnv> = (c) =>
  c.json(getRecipeNutrition(c.var.ctx, c.req.valid("param").idOrSlug), 200);

export function registerNutritionRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(searchFoodsRoute, searchFoodsHandler);
  app.openapi(setIngredientNutritionRoute, setIngredientNutritionHandler);
  app.openapi(recipeNutritionRoute, recipeNutritionHandler);
}
