import { createRoute, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { ZodType } from "zod";
import type { AppEnv } from "../../auth/middleware.js";
import {
  createRecipeSchema,
  deleteRecipeResultSchema,
  idOrSlugParamSchema,
  recipeSearchResultSchema,
  recipeStatusHistorySchema,
  recipeViewSchema,
  scaleRecipeQuerySchema,
  scaledIngredientsResultSchema,
  searchRecipesQuerySchema,
  setRecipeStatusResultSchema,
  setRecipeStatusSchema,
  updateRecipeSchema,
} from "../../schemas/recipes.js";
import { ruleCheckSchema } from "../../schemas/rules.js";
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  listStatusHistory,
  resolveRecipeId,
  scaleRecipeIngredients,
  searchRecipes,
  setRecipeStatus,
  updateRecipe,
  type SearchRecipesInput,
} from "../../services/recipes.js";
import { checkRecipe } from "../../services/rules.js";

const json = <T extends ZodType>(schema: T) => ({ "application/json": { schema } });

const listRecipesRoute = createRoute({
  method: "get",
  path: "/recipes",
  tags: ["recipes"],
  summary: "Search recipes",
  description:
    "Full-text-ish search over title/description/tags with filters. Returns summaries without steps.",
  request: { query: searchRecipesQuerySchema },
  responses: {
    200: {
      description: "Matching recipes",
      content: json(recipeSearchResultSchema),
    },
  },
});

const listRecipesHandler: RouteHandler<typeof listRecipesRoute, AppEnv> = (c) => {
  const { tags, ...rest } = c.req.valid("query");
  const input: SearchRecipesInput = rest;
  if (tags !== undefined) {
    input.tags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");
  }
  return c.json(searchRecipes(c.var.ctx, input), 200);
};

const createRecipeRoute = createRoute({
  method: "post",
  path: "/recipes",
  tags: ["recipes"],
  summary: "Create a recipe",
  description:
    "Creates the recipe with ordered ingredients and steps. Ingredient names are resolved and created when unknown; units are normalized.",
  request: {
    body: { content: json(createRecipeSchema), required: true },
  },
  responses: {
    201: {
      description: "Created recipe",
      content: json(recipeViewSchema),
    },
  },
});

const createRecipeHandler: RouteHandler<typeof createRecipeRoute, AppEnv> = (c) =>
  c.json(createRecipe(c.var.ctx, c.req.valid("json")), 201);

const getRecipeRoute = createRoute({
  method: "get",
  path: "/recipes/{idOrSlug}",
  tags: ["recipes"],
  summary: "Get a recipe",
  description: "Full recipe with ingredients, steps and cook stats.",
  request: { params: idOrSlugParamSchema },
  responses: {
    200: { description: "Recipe", content: json(recipeViewSchema) },
  },
});

const getRecipeHandler: RouteHandler<typeof getRecipeRoute, AppEnv> = (c) =>
  c.json(getRecipe(c.var.ctx, c.req.valid("param").idOrSlug), 200);

const updateRecipeRoute = createRoute({
  method: "patch",
  path: "/recipes/{idOrSlug}",
  tags: ["recipes"],
  summary: "Update a recipe",
  description:
    "Patch scalar fields. When `ingredients` or `steps` are present they replace the FULL list in one transaction.",
  request: {
    params: idOrSlugParamSchema,
    body: { content: json(updateRecipeSchema), required: true },
  },
  responses: {
    200: { description: "Updated recipe", content: json(recipeViewSchema) },
  },
});

const updateRecipeHandler: RouteHandler<typeof updateRecipeRoute, AppEnv> = (c) =>
  c.json(
    updateRecipe(c.var.ctx, c.req.valid("param").idOrSlug, c.req.valid("json")),
    200,
  );

const deleteRecipeRoute = createRoute({
  method: "delete",
  path: "/recipes/{idOrSlug}",
  tags: ["recipes"],
  summary: "Delete a recipe",
  description:
    "Hard-deletes the recipe. Conflicts when cook events reference it; archive it instead.",
  request: { params: idOrSlugParamSchema },
  responses: {
    200: { description: "Deleted", content: json(deleteRecipeResultSchema) },
  },
});

const deleteRecipeHandler: RouteHandler<typeof deleteRecipeRoute, AppEnv> = (c) =>
  c.json(deleteRecipe(c.var.ctx, c.req.valid("param").idOrSlug), 200);

const setRecipeStatusRoute = createRoute({
  method: "post",
  path: "/recipes/{idOrSlug}/status",
  tags: ["recipes"],
  summary: "Set recipe status",
  description:
    "Updates the recipe status (and optional rating) and appends a status event. Accepts an id or slug.",
  request: {
    params: idOrSlugParamSchema,
    body: { content: json(setRecipeStatusSchema), required: true },
  },
  responses: {
    200: { description: "Updated recipe and event", content: json(setRecipeStatusResultSchema) },
  },
});

const setRecipeStatusHandler: RouteHandler<typeof setRecipeStatusRoute, AppEnv> = (c) =>
  c.json(
    setRecipeStatus(
      c.var.ctx,
      resolveRecipeId(c.var.ctx, c.req.valid("param").idOrSlug),
      c.req.valid("json"),
    ),
    200,
  );

const statusHistoryRoute = createRoute({
  method: "get",
  path: "/recipes/{idOrSlug}/status-history",
  tags: ["recipes"],
  summary: "Recipe status history",
  description: "Status events, newest first. Accepts a recipe id or slug.",
  request: { params: idOrSlugParamSchema },
  responses: {
    200: { description: "Status events", content: json(recipeStatusHistorySchema) },
  },
});

const statusHistoryHandler: RouteHandler<typeof statusHistoryRoute, AppEnv> = (c) =>
  c.json(
    listStatusHistory(c.var.ctx, resolveRecipeId(c.var.ctx, c.req.valid("param").idOrSlug)),
    200,
  );

const checkRecipeRoute = createRoute({
  method: "get",
  path: "/recipes/{idOrSlug}/check",
  tags: ["recipes"],
  summary: "Check a recipe against dietary rules",
  description:
    "Returns matching rule violations and spice mismatch. `ok` is false only for unconditional forbidden matches; conditional violations are reported for the agent to judge. Accepts a recipe id or slug.",
  request: { params: idOrSlugParamSchema },
  responses: {
    200: { description: "Rule check", content: json(ruleCheckSchema) },
  },
});

const checkRecipeHandler: RouteHandler<typeof checkRecipeRoute, AppEnv> = (c) =>
  c.json(checkRecipe(c.var.ctx, resolveRecipeId(c.var.ctx, c.req.valid("param").idOrSlug)), 200);

const scaledIngredientsRoute = createRoute({
  method: "get",
  path: "/recipes/{idOrSlug}/scaled",
  tags: ["recipes"],
  summary: "Scale recipe ingredients",
  description:
    "Scales ingredient quantities to the requested servings. Scaling-exempt and unmeasured ingredients stay untouched. Accepts a recipe id or slug.",
  request: { params: idOrSlugParamSchema, query: scaleRecipeQuerySchema },
  responses: {
    200: { description: "Scaled ingredients", content: json(scaledIngredientsResultSchema) },
  },
});

const scaledIngredientsHandler: RouteHandler<typeof scaledIngredientsRoute, AppEnv> = (c) =>
  c.json(
    {
      items: scaleRecipeIngredients(
        c.var.ctx,
        resolveRecipeId(c.var.ctx, c.req.valid("param").idOrSlug),
        c.req.valid("query").servings,
      ),
    },
    200,
  );

export function registerRecipeRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listRecipesRoute, listRecipesHandler);
  app.openapi(createRecipeRoute, createRecipeHandler);
  app.openapi(getRecipeRoute, getRecipeHandler);
  app.openapi(updateRecipeRoute, updateRecipeHandler);
  app.openapi(deleteRecipeRoute, deleteRecipeHandler);
  app.openapi(setRecipeStatusRoute, setRecipeStatusHandler);
  app.openapi(statusHistoryRoute, statusHistoryHandler);
  app.openapi(checkRecipeRoute, checkRecipeHandler);
  app.openapi(scaledIngredientsRoute, scaledIngredientsHandler);
}
