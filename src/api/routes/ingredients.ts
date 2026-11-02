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
  ingredientAliasSchema,
  ingredientListSchema,
  ingredientParamsSchema,
  ingredientViewSchema,
  listConversionsQuerySchema,
  listIngredientsQuerySchema,
  mergeIngredientSchema,
  mergeResultSchema,
  unitConversionSchema,
  updateIngredientSchema,
} from "../../schemas/ingredients.js";
import {
  addAlias,
  archiveIngredient,
  createIngredient,
  getIngredient,
  listIngredients,
  mergeIngredients,
  removeAlias,
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
  description: "Creates the ingredient and its aliases. Duplicate names or aliases return 409.",
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
  c.json(createIngredient(c.var.ctx, c.req.valid("json")), 201);

const getIngredientRoute = createRoute({
  method: "get",
  path: "/ingredients/{id}",
  tags: ["ingredients"],
  summary: "Get an ingredient",
  request: { params: ingredientParamsSchema },
  responses: {
    200: {
      description: "Ingredient with aliases, conversions and pantry stock",
      content: { "application/json": { schema: ingredientViewSchema } },
    },
  },
});

const getIngredientHandler: RouteHandler<typeof getIngredientRoute, AppEnv> = (c) =>
  c.json(getIngredient(c.var.ctx, c.req.valid("param").id), 200);

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
  app.openapi(getIngredientRoute, getIngredientHandler);
  app.openapi(updateIngredientRoute, updateIngredientHandler);
  app.openapi(archiveIngredientRoute, archiveIngredientHandler);
  app.openapi(addAliasRoute, addAliasHandler);
  app.openapi(removeAliasRoute, removeAliasHandler);
  app.openapi(mergeIngredientsRoute, mergeIngredientsHandler);
  app.openapi(listConversionsRoute, listConversionsHandler);
  app.openapi(createConversionRoute, createConversionHandler);
  app.openapi(deleteConversionRoute, deleteConversionHandler);
  app.openapi(convertUnitRoute, convertUnitHandler);
}
