import { createRoute, z, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { AppEnv } from "../../auth/middleware.js";
import {
  addAliasSchema,
  aliasParamsSchema,
  conversionListSchema,
  conversionParamsSchema,
  convertUnitResultSchema,
  convertUnitSchema,
  createConversionSchema,
  createIngredientSchema,
  findIngredientsQuerySchema,
  findIngredientsResultSchema,
  ingredientAliasSchema,
  ingredientDetailSchema,
  ingredientListSchema,
  ingredientParamsSchema,
  ingredientViewSchema,
  ingredientUsageCountsSchema,
  listConversionsQuerySchema,
  listIngredientsQuerySchema,
  mergeIngredientSchema,
  mergeResultSchema,
  reviewListSchema,
  splitIngredientSchema,
  splitResultSchema,
  unitConversionSchema,
  updateIngredientSchema,
} from "../../schemas/ingredients.js";
import {
  acceptIngredient,
  addAlias,
  archiveIngredient,
  createIngredient,
  findIngredientCandidates,
  getIngredientDetail,
  listIngredients,
  listIngredientUsageCounts,
  listIngredientsForReview,
  mergeIngredients,
  removeAlias,
  splitIngredient,
  updateIngredient,
} from "../../services/ingredients.js";
import {
  convert,
  createConversion,
  deleteConversion,
  listConversions,
  normalizeUnit,
} from "../../services/units.js";

const aliasResultSchema = z
  .object({ alias: ingredientAliasSchema })
  .openapi("IngredientAliasResult");

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

const listIngredientsRoute = createRoute({
  method: "get",
  path: "/ingredients",
  tags: ["ingredients"],
  summary: "List ingredients",
  description: "Every ingredient with aliases, custom conversions and pantry stock.",
  request: { query: listIngredientsQuerySchema },
  responses: {
    200: {
      description: "Ingredients sorted by name",
      content: { "application/json": { schema: ingredientListSchema } },
    },
  },
});

const listIngredientsHandler: RouteHandler<typeof listIngredientsRoute, AppEnv> = (c) => {
  const query = c.req.valid("query");
  const items = listIngredients(c.var.ctx, {
    ...(query.query === undefined ? {} : { query: query.query }),
    ...(query.category === undefined ? {} : { category: query.category }),
    includeArchived: query.includeArchived === "true",
  });
  return c.json({ items }, 200);
};

const createIngredientRoute = createRoute({
  method: "post",
  path: "/ingredients",
  tags: ["ingredients"],
  summary: "Create an ingredient",
  description:
    "Creates a linked ingredient (`fdcId`: a USDA food; name derived when omitted; 409 if the household already links that food) " +
    "or, as a last resort, a custom one (`custom: true`; look at GET /ingredients/find first). " +
    "Without `fdcId` or `custom: true` the request is 422 with suggestions. " +
    "Names cannot hold quantities, sizes, preparation or \"x or y\" (422 with a hint). " +
    "Duplicate names or aliases return 409. Customs created with an API token are flagged for review (GET /ingredients/review); customs from the web app are not.",
  request: {
    body: {
      content: { "application/json": { schema: createIngredientSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Created ingredient",
      content: { "application/json": { schema: ingredientViewSchema } },
    },
  },
});

const createIngredientHandler: RouteHandler<typeof createIngredientRoute, AppEnv> = (c) =>
  c.json(
    createIngredient(c.var.ctx, {
      ...c.req.valid("json"),
      needsReview: c.var.authKind !== "session",
    }),
    201,
  );

const findIngredientsRoute = createRoute({
  method: "get",
  path: "/ingredients/find",
  tags: ["ingredients"],
  summary: "Find an ingredient or a USDA food",
  description:
    "Existing household ingredients that match a query, then bundled USDA foods with a suggested ingredient name. " +
    "Pick an existing ingredient (ingredientId), or a food (fdcId + suggestedName as name) to create a linked one.",
  request: { query: findIngredientsQuerySchema },
  responses: {
    200: {
      description: "Matching ingredients and foods",
      content: { "application/json": { schema: findIngredientsResultSchema } },
    },
  },
});

const findIngredientsHandler: RouteHandler<typeof findIngredientsRoute, AppEnv> = (c) => {
  const { query, limit } = c.req.valid("query");
  return c.json(findIngredientCandidates(c.var.ctx, query, limit), 200);
};

const reviewIngredientsRoute = createRoute({
  method: "get",
  path: "/ingredients/review",
  tags: ["ingredients"],
  summary: "Ingredients to review",
  description:
    "Ingredients flagged for review (customs created over the API, unlinked legacy ingredients) and ingredients whose name breaks the naming rules, " +
    "with the reasons and suggestions (existing ingredients, USDA foods). Fix one by linking a food (PUT /ingredients/{id}/nutrition), renaming, " +
    "merging, splitting or accepting it.",
  responses: {
    200: {
      description: "Ingredients to review",
      content: { "application/json": { schema: reviewListSchema } },
    },
  },
});

const reviewIngredientsHandler: RouteHandler<typeof reviewIngredientsRoute, AppEnv> = (c) =>
  c.json({ items: listIngredientsForReview(c.var.ctx) }, 200);

const acceptIngredientRoute = createRoute({
  method: "post",
  path: "/ingredients/{id}/review",
  tags: ["ingredients"],
  summary: "Accept a custom ingredient",
  description:
    "Clears the review flag: the custom ingredient is accepted as it is. A name that breaks the naming rules stays listed until it is renamed.",
  request: { params: ingredientParamsSchema },
  responses: {
    200: {
      description: "The ingredient",
      content: { "application/json": { schema: ingredientViewSchema } },
    },
  },
});

const acceptIngredientHandler: RouteHandler<typeof acceptIngredientRoute, AppEnv> = (c) =>
  c.json(acceptIngredient(c.var.ctx, c.req.valid("param").id), 200);

const splitIngredientRoute = createRoute({
  method: "post",
  path: "/ingredients/{id}/split",
  tags: ["ingredients"],
  summary: "Split an ingredient that names several",
  description:
    'For ingredients such as "Milk or water": every recipe line that used it gets `main` as its ingredient and `alternatives` as alternatives; ' +
    "lines that listed it as an alternative get all of them as alternatives. Pantry stock and shopping items move to `main`. " +
    "The split ingredient is archived. Unknown names are 422 with suggestions; use `fdcId` to create linked ingredients.",
  request: {
    params: ingredientParamsSchema,
    body: {
      content: { "application/json": { schema: splitIngredientSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The archived source, the main ingredient, the alternatives and moved-row counts",
      content: { "application/json": { schema: splitResultSchema } },
    },
  },
});

const splitIngredientHandler: RouteHandler<typeof splitIngredientRoute, AppEnv> = (c) =>
  c.json(splitIngredient(c.var.ctx, c.req.valid("param").id, c.req.valid("json")), 200);

const ingredientUsageRoute = createRoute({
  method: "get",
  path: "/ingredients/usage",
  tags: ["ingredients"],
  summary: "Ingredient use counts",
  description:
    "How often each ingredient is used: recipes, pantry rows, items on open shopping lists and dietary rules. " +
    "Ingredients that do not appear are unused.",
  responses: {
    200: {
      description: "Use counts",
      content: { "application/json": { schema: ingredientUsageCountsSchema } },
    },
  },
});

const ingredientUsageHandler: RouteHandler<typeof ingredientUsageRoute, AppEnv> = (c) =>
  c.json({ items: listIngredientUsageCounts(c.var.ctx) }, 200);

const getIngredientRoute = createRoute({
  method: "get",
  path: "/ingredients/{id}",
  tags: ["ingredients"],
  summary: "Get an ingredient",
  description:
    "The ingredient with aliases, conversions and pantry stock, plus where it is used (recipes, pantry, " +
    "items on open shopping lists, dietary rules) and why it needs attention, if it does.",
  request: { params: ingredientParamsSchema },
  responses: {
    200: {
      description: "Ingredient with usage",
      content: { "application/json": { schema: ingredientDetailSchema } },
    },
  },
});

const getIngredientHandler: RouteHandler<typeof getIngredientRoute, AppEnv> = (c) =>
  c.json(getIngredientDetail(c.var.ctx, c.req.valid("param").id), 200);

const updateIngredientRoute = createRoute({
  method: "patch",
  path: "/ingredients/{id}",
  tags: ["ingredients"],
  summary: "Update an ingredient",
  request: {
    params: ingredientParamsSchema,
    body: {
      content: { "application/json": { schema: updateIngredientSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated ingredient",
      content: { "application/json": { schema: ingredientViewSchema } },
    },
  },
});

const updateIngredientHandler: RouteHandler<typeof updateIngredientRoute, AppEnv> = (c) =>
  c.json(updateIngredient(c.var.ctx, c.req.valid("param").id, c.req.valid("json")), 200);

const archiveIngredientRoute = createRoute({
  method: "delete",
  path: "/ingredients/{id}",
  tags: ["ingredients"],
  summary: "Archive an ingredient",
  description:
    "Soft-deletes the ingredient (sets archivedAt). History and resolution keep working.",
  request: { params: ingredientParamsSchema },
  responses: {
    200: {
      description: "Archived ingredient",
      content: { "application/json": { schema: ingredientViewSchema } },
    },
  },
});

const archiveIngredientHandler: RouteHandler<typeof archiveIngredientRoute, AppEnv> = (c) =>
  c.json(archiveIngredient(c.var.ctx, c.req.valid("param").id), 200);

const addAliasRoute = createRoute({
  method: "post",
  path: "/ingredients/{id}/aliases",
  tags: ["ingredients"],
  summary: "Add an alias",
  request: {
    params: ingredientParamsSchema,
    body: {
      content: { "application/json": { schema: addAliasSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Created alias",
      content: { "application/json": { schema: aliasResultSchema } },
    },
  },
});

const addAliasHandler: RouteHandler<typeof addAliasRoute, AppEnv> = (c) =>
  c.json(
    { alias: addAlias(c.var.ctx, c.req.valid("param").id, c.req.valid("json").alias) },
    201,
  );

const removeAliasRoute = createRoute({
  method: "delete",
  path: "/ingredients/{id}/aliases/{aliasId}",
  tags: ["ingredients"],
  summary: "Remove an alias",
  request: { params: aliasParamsSchema },
  responses: { 204: { description: "Alias removed" } },
});

const removeAliasHandler: RouteHandler<typeof removeAliasRoute, AppEnv> = (c) => {
  const { id, aliasId } = c.req.valid("param");
  removeAlias(c.var.ctx, id, aliasId);
  return c.body(null, 204);
};

const mergeIngredientsRoute = createRoute({
  method: "post",
  path: "/ingredients/{id}/merge",
  tags: ["ingredients"],
  summary: "Merge an ingredient into another",
  description:
    "Repoints recipes, pantry stock, shopping items, rules and conversions to `intoId`, " +
    "turns the source name into an alias of the target and deletes the source.",
  request: {
    params: ingredientParamsSchema,
    body: {
      content: { "application/json": { schema: mergeIngredientSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Target ingredient and moved-row counts",
      content: { "application/json": { schema: mergeResultSchema } },
    },
  },
});

const mergeIngredientsHandler: RouteHandler<typeof mergeIngredientsRoute, AppEnv> = (c) =>
  c.json(
    mergeIngredients(c.var.ctx, c.req.valid("param").id, c.req.valid("json").intoId),
    200,
  );

// ---------------------------------------------------------------------------
// Unit conversions
// ---------------------------------------------------------------------------

const listConversionsRoute = createRoute({
  method: "get",
  path: "/unit-conversions",
  tags: ["units"],
  summary: "List custom unit conversions",
  request: { query: listConversionsQuerySchema },
  responses: {
    200: {
      description: "Stored conversions",
      content: { "application/json": { schema: conversionListSchema } },
    },
  },
});

const listConversionsHandler: RouteHandler<typeof listConversionsRoute, AppEnv> = (c) => {
  const query = c.req.valid("query");
  const items = listConversions(c.var.ctx, {
    ...(query.ingredientId === undefined ? {} : { ingredientId: query.ingredientId }),
    includeGlobal: query.includeGlobal === "true",
  });
  return c.json({ items }, 200);
};

const createConversionRoute = createRoute({
  method: "post",
  path: "/unit-conversions",
  tags: ["units"],
  summary: "Create a custom unit conversion",
  request: {
    body: {
      content: { "application/json": { schema: createConversionSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Created conversion",
      content: { "application/json": { schema: unitConversionSchema } },
    },
  },
});

const createConversionHandler: RouteHandler<typeof createConversionRoute, AppEnv> = (c) =>
  c.json(createConversion(c.var.ctx, c.req.valid("json")), 201);

const deleteConversionRoute = createRoute({
  method: "delete",
  path: "/unit-conversions/{id}",
  tags: ["units"],
  summary: "Delete a custom unit conversion",
  request: { params: conversionParamsSchema },
  responses: { 204: { description: "Conversion deleted" } },
});

const deleteConversionHandler: RouteHandler<typeof deleteConversionRoute, AppEnv> = (c) => {
  deleteConversion(c.var.ctx, c.req.valid("param").id);
  return c.body(null, 204);
};

const convertUnitRoute = createRoute({
  method: "post",
  path: "/units/convert",
  tags: ["units"],
  summary: "Convert a quantity between units",
  description:
    "Built-in mass/volume/count tables, then per-ingredient conversions, then household-global " +
    "conversions. Incomparable units return qty=null and comparable=false rather than a guess.",
  request: {
    body: {
      content: { "application/json": { schema: convertUnitSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Conversion result",
      content: { "application/json": { schema: convertUnitResultSchema } },
    },
  },
});

const convertUnitHandler: RouteHandler<typeof convertUnitRoute, AppEnv> = (c) => {
  const input = c.req.valid("json");
  const qty = convert(c.var.ctx, input.qty, input.from, input.to, input.ingredientId ?? null);
  return c.json(
    {
      qty,
      fromUnit: normalizeUnit(input.from),
      toUnit: normalizeUnit(input.to),
      comparable: qty !== null,
    },
    200,
  );
};

export function registerIngredientRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listIngredientsRoute, listIngredientsHandler);
  app.openapi(createIngredientRoute, createIngredientHandler);
  // Fixed paths before `/ingredients/{id}`.
  app.openapi(findIngredientsRoute, findIngredientsHandler);
  app.openapi(reviewIngredientsRoute, reviewIngredientsHandler);
  app.openapi(ingredientUsageRoute, ingredientUsageHandler);
  app.openapi(getIngredientRoute, getIngredientHandler);
  app.openapi(updateIngredientRoute, updateIngredientHandler);
  app.openapi(archiveIngredientRoute, archiveIngredientHandler);
  app.openapi(addAliasRoute, addAliasHandler);
  app.openapi(removeAliasRoute, removeAliasHandler);
  app.openapi(mergeIngredientsRoute, mergeIngredientsHandler);
  app.openapi(acceptIngredientRoute, acceptIngredientHandler);
  app.openapi(splitIngredientRoute, splitIngredientHandler);
  app.openapi(listConversionsRoute, listConversionsHandler);
  app.openapi(createConversionRoute, createConversionHandler);
  app.openapi(deleteConversionRoute, deleteConversionHandler);
  app.openapi(convertUnitRoute, convertUnitHandler);
}
