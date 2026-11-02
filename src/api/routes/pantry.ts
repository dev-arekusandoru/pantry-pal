import { createRoute, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { AppEnv } from "../../auth/middleware.js";
import {
  adjustStockSchema,
  bulkResultSchema,
  bulkStockSchema,
  listMovementsQuerySchema,
  listPantryQuerySchema,
  movementListSchema,
  movementResultSchema,
  pantryItemViewSchema,
  pantryListSchema,
  pantryParamsSchema,
  setStockSchema,
  updatePantryItemSchema,
} from "../../schemas/pantry.js";
import {
  adjustStock,
  bulkUpdate,
  deletePantryItem,
  getPantryItem,
  listMovements,
  listPantry,
  setStock,
  updatePantryItem,
  verifyItem,
} from "../../services/pantry.js";

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

const listPantryRoute = createRoute({
  method: "get",
  path: "/pantry",
  tags: ["pantry"],
  summary: "List pantry stock",
  description: "Pantry rows sorted by ingredient category then name.",
  request: { query: listPantryQuerySchema },
  responses: {
    200: {
      description: "Pantry rows",
      content: { "application/json": { schema: pantryListSchema } },
    },
  },
});

const listPantryHandler: RouteHandler<typeof listPantryRoute, AppEnv> = (c) => {
  const query = c.req.valid("query");
  const items = listPantry(c.var.ctx, {
    ...(query.category === undefined ? {} : { category: query.category }),
    ...(query.location === undefined ? {} : { location: query.location }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.staleDays === undefined ? {} : { staleDays: query.staleDays }),
    ...(query.query === undefined ? {} : { query: query.query }),
  });
  return c.json({ items }, 200);
};

// ---------------------------------------------------------------------------
// Static sub-resources (registered before /pantry/{id})
// ---------------------------------------------------------------------------

const listMovementsRoute = createRoute({
  method: "get",
  path: "/pantry/movements",
  tags: ["pantry"],
  summary: "List stock movements",
  description: "Ledger entries newest first.",
  request: { query: listMovementsQuerySchema },
  responses: {
    200: {
      description: "Movements",
      content: { "application/json": { schema: movementListSchema } },
    },
  },
});

const listMovementsHandler: RouteHandler<typeof listMovementsRoute, AppEnv> = (c) => {
  const query = c.req.valid("query");
  const items = listMovements(c.var.ctx, {
    ...(query.pantryItemId === undefined ? {} : { pantryItemId: query.pantryItemId }),
    ...(query.ingredientId === undefined ? {} : { ingredientId: query.ingredientId }),
    ...(query.refType === undefined ? {} : { refType: query.refType }),
    ...(query.refId === undefined ? {} : { refId: query.refId }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.before === undefined ? {} : { before: query.before }),
  });
  return c.json({ items }, 200);
};

const setStockRoute = createRoute({
  method: "post",
  path: "/pantry/set",
  tags: ["pantry"],
  summary: "Set stock for an ingredient",
  description:
    "Absolute quantity. Unknown ingredient names are created; the ledger records a `set` movement.",
  request: {
    body: { content: { "application/json": { schema: setStockSchema } }, required: true },
  },
  responses: {
    200: {
      description: "Updated item and movement",
      content: { "application/json": { schema: movementResultSchema } },
    },
  },
});

const setStockHandler: RouteHandler<typeof setStockRoute, AppEnv> = (c) =>
  c.json(setStock(c.var.ctx, c.req.valid("json")), 200);

const adjustStockRoute = createRoute({
  method: "post",
  path: "/pantry/adjust",
  tags: ["pantry"],
  summary: "Adjust stock by a delta",
  description:
    "Relative change. Deltas are converted into the item unit when possible and clamped at 0; " +
    "unknown quantities stay unknown. Negative deltas require an existing ingredient.",
  request: {
    body: { content: { "application/json": { schema: adjustStockSchema } }, required: true },
  },
  responses: {
    200: {
      description: "Updated item and movement",
      content: { "application/json": { schema: movementResultSchema } },
    },
  },
});

const adjustStockHandler: RouteHandler<typeof adjustStockRoute, AppEnv> = (c) =>
  c.json(adjustStock(c.var.ctx, c.req.valid("json")), 200);

const bulkStockRoute = createRoute({
  method: "post",
  path: "/pantry/bulk",
  tags: ["pantry"],
  summary: "Apply many stock lines atomically",
  description: "All lines succeed or none are applied; results are returned in input order.",
  request: {
    body: { content: { "application/json": { schema: bulkStockSchema } }, required: true },
  },
  responses: {
    200: {
      description: "Per-line results",
      content: { "application/json": { schema: bulkResultSchema } },
    },
  },
});

const bulkStockHandler: RouteHandler<typeof bulkStockRoute, AppEnv> = (c) =>
  c.json({ results: bulkUpdate(c.var.ctx, c.req.valid("json").lines) }, 200);

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

const getPantryItemRoute = createRoute({
  method: "get",
  path: "/pantry/{id}",
  tags: ["pantry"],
  summary: "Get a pantry row",
  request: { params: pantryParamsSchema },
  responses: {
    200: {
      description: "Pantry row with ingredient",
      content: { "application/json": { schema: pantryItemViewSchema } },
    },
  },
});

const getPantryItemHandler: RouteHandler<typeof getPantryItemRoute, AppEnv> = (c) =>
  c.json(getPantryItem(c.var.ctx, c.req.valid("param").id), 200);

const updatePantryItemRoute = createRoute({
  method: "patch",
  path: "/pantry/{id}",
  tags: ["pantry"],
  summary: "Update pantry metadata",
  description: "Move a row to another location, edit notes/dates/status. Quantities go through the ledger.",
  request: {
    params: pantryParamsSchema,
    body: {
      content: { "application/json": { schema: updatePantryItemSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated pantry row",
      content: { "application/json": { schema: pantryItemViewSchema } },
    },
  },
});

const updatePantryItemHandler: RouteHandler<typeof updatePantryItemRoute, AppEnv> = (c) =>
  c.json(
    updatePantryItem(c.var.ctx, c.req.valid("param").id, c.req.valid("json")),
    200,
  );

const deletePantryItemRoute = createRoute({
  method: "delete",
  path: "/pantry/{id}",
  tags: ["pantry"],
  summary: "Delete a pantry row",
  description: "Also removes its movement history (the row is the ledger subject).",
  request: { params: pantryParamsSchema },
  responses: { 204: { description: "Pantry row deleted" } },
});

const deletePantryItemHandler: RouteHandler<typeof deletePantryItemRoute, AppEnv> = (c) => {
  deletePantryItem(c.var.ctx, c.req.valid("param").id);
  return c.body(null, 204);
};

const verifyItemRoute = createRoute({
  method: "post",
  path: "/pantry/{id}/verify",
  tags: ["pantry"],
  summary: "Mark a pantry row as verified",
  description: "Sets lastVerifiedAt and records a `verify` movement with the current quantity.",
  request: { params: pantryParamsSchema },
  responses: {
    200: {
      description: "Verified item and movement",
      content: { "application/json": { schema: movementResultSchema } },
    },
  },
});

const verifyItemHandler: RouteHandler<typeof verifyItemRoute, AppEnv> = (c) =>
  c.json(verifyItem(c.var.ctx, c.req.valid("param").id), 200);

export function registerPantryRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listPantryRoute, listPantryHandler);
  app.openapi(listMovementsRoute, listMovementsHandler);
  app.openapi(setStockRoute, setStockHandler);
  app.openapi(adjustStockRoute, adjustStockHandler);
  app.openapi(bulkStockRoute, bulkStockHandler);
  app.openapi(getPantryItemRoute, getPantryItemHandler);
  app.openapi(updatePantryItemRoute, updatePantryItemHandler);
  app.openapi(deletePantryItemRoute, deletePantryItemHandler);
  app.openapi(verifyItemRoute, verifyItemHandler);
}
