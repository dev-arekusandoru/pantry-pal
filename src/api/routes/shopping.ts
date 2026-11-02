import { createRoute, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { AppEnv } from "../../auth/middleware.js";
import {
  availabilityQuerySchema,
  availabilityResponseSchema,
  addItemsInputSchema,
  addItemsResponseSchema,
  checkItemsInputSchema,
  completeShoppingListInputSchema,
  completeShoppingListResponseSchema,
  createShoppingListInputSchema,
  deleteResponseSchema,
  demandQuerySchema,
  demandResponseSchema,
  errorResponseSchema,
  generateShoppingListInputSchema,
  getShoppingListQuerySchema,
  listShoppingListsQuerySchema,
  mealPlanIdParamsSchema,
  shoppingItemParamsSchema,
  shoppingItemSchema,
  shoppingListDetailSchema,
  shoppingListParamsSchema,
  shoppingListsResponseSchema,
  updateShoppingItemInputSchema,
  updateShoppingListInputSchema,
} from "../../schemas/shopping.js";
import {
  addItems,
  checkItems,
  completeShoppingList,
  createShoppingList,
  deleteItem,
  deleteShoppingList,
  generateShoppingList,
  getShoppingList,
  listShoppingLists,
  updateItem,
  updateShoppingList,
} from "../../services/shopping.js";
import { computeAvailability, computeDemand } from "../../services/demand.js";

const errorResponses = {
  400: {
    description: "Request validation failed",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  404: {
    description: "Not found",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  409: {
    description: "Conflict with the current list state",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  422: {
    description: "Unprocessable input (for example an unresolvable ingredient)",
    content: { "application/json": { schema: errorResponseSchema } },
  },
};

const TAG = "shopping";

// ---------------------------------------------------------------------------
// Demand & availability
// ---------------------------------------------------------------------------

export const demandRoute = createRoute({
  method: "get",
  path: "/plans/{id}/demand",
  tags: [TAG],
  summary: "Ingredient demand for a meal plan",
  description:
    "Aggregates the scaled ingredients of every planned cook event in the plan, converted to one target unit per ingredient. Optionally narrowed by cook date and optional ingredients.",
  request: { params: mealPlanIdParamsSchema, query: demandQuerySchema },
  responses: {
    200: {
      description: "Aggregated demand per ingredient",
      content: { "application/json": { schema: demandResponseSchema } },
    },
    ...errorResponses,
  },
});

const demandHandler: RouteHandler<typeof demandRoute, AppEnv> = (c) => {
  const { id } = c.req.valid("param");
  const query = c.req.valid("query");
  const items = computeDemand(c.get("ctx"), {
    mealPlanId: id,
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    ...(query.includeOptional === undefined
      ? {}
      : { includeOptional: query.includeOptional === "true" }),
  });
  return c.json({ items }, 200);
};

export const availabilityRoute = createRoute({
  method: "get",
  path: "/pantry/availability",
  tags: [TAG],
  summary: "Stock on hand versus planned commitments",
  description:
    "For every ingredient with pantry stock or planned demand: stock on hand (converted), the quantity committed to planned cooks, and what is left. Nothing is reserved or written.",
  request: { query: availabilityQuerySchema },
  responses: {
    200: {
      description: "Availability per ingredient",
      content: { "application/json": { schema: availabilityResponseSchema } },
    },
    ...errorResponses,
  },
});

const availabilityHandler: RouteHandler<typeof availabilityRoute, AppEnv> = (c) => {
  const query = c.req.valid("query");
  const items = computeAvailability(
    c.get("ctx"),
    query.mealPlanId === undefined ? {} : { mealPlanId: query.mealPlanId },
  );
  return c.json({ items }, 200);
};

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export const listShoppingListsRoute = createRoute({
  method: "get",
  path: "/shopping-lists",
  tags: [TAG],
  summary: "List shopping lists",
  request: { query: listShoppingListsQuerySchema },
  responses: {
    200: {
      description: "Shopping lists, newest first",
      content: { "application/json": { schema: shoppingListsResponseSchema } },
    },
    ...errorResponses,
  },
});

const listShoppingListsHandler: RouteHandler<typeof listShoppingListsRoute, AppEnv> = (c) => {
  const query = c.req.valid("query");
  const result = listShoppingLists(c.get("ctx"), {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.mealPlanId === undefined ? {} : { mealPlanId: query.mealPlanId }),
  });
  return c.json(result, 200);
};

export const createShoppingListRoute = createRoute({
  method: "post",
  path: "/shopping-lists",
  tags: [TAG],
  summary: "Create a shopping list",
  description: "Manual list (or a draft bound to a meal plan). Items may be added up front.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createShoppingListInputSchema } },
    },
  },
  responses: {
    201: {
      description: "Created list with items",
      content: { "application/json": { schema: shoppingListDetailSchema } },
    },
    ...errorResponses,
  },
});

const createShoppingListHandler: RouteHandler<typeof createShoppingListRoute, AppEnv> = (c) => {
  const body = c.req.valid("json");
  return c.json(createShoppingList(c.get("ctx"), body), 201);
};

export const generateShoppingListRoute = createRoute({
  method: "post",
  path: "/shopping-lists/generate",
  tags: [TAG],
  summary: "Generate a shopping list from plan demand",
  description:
    "Adds what the plan needs on top of stock. Unknown or incomparable stock becomes a needsCheck item; low/out staples are restocked. Regenerating replaces generated, unchecked items only.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: generateShoppingListInputSchema } },
    },
  },
  responses: {
    201: {
      description: "Generated (or regenerated) list with items",
      content: { "application/json": { schema: shoppingListDetailSchema } },
    },
    ...errorResponses,
  },
});

const generateShoppingListHandler: RouteHandler<typeof generateShoppingListRoute, AppEnv> = (c) => {
  const body = c.req.valid("json");
  return c.json(generateShoppingList(c.get("ctx"), body), 201);
};

export const getShoppingListRoute = createRoute({
  method: "get",
  path: "/shopping-lists/{id}",
  tags: [TAG],
  summary: "Get a shopping list",
  description: "List plus items grouped by category and checked/remaining counts.",
  request: { params: shoppingListParamsSchema, query: getShoppingListQuerySchema },
  responses: {
    200: {
      description: "List detail",
      content: { "application/json": { schema: shoppingListDetailSchema } },
    },
    ...errorResponses,
  },
});

const getShoppingListHandler: RouteHandler<typeof getShoppingListRoute, AppEnv> = (c) => {
  const { id } = c.req.valid("param");
  const query = c.req.valid("query");
  const detail = getShoppingList(c.get("ctx"), id, {
    ...(query.includeChecked === undefined
      ? {}
      : { includeChecked: query.includeChecked === "true" }),
  });
  return c.json(detail, 200);
};

export const updateShoppingListRoute = createRoute({
  method: "patch",
  path: "/shopping-lists/{id}",
  tags: [TAG],
  summary: "Update a shopping list",
  description: "Title, notes, or the draft ⇄ shopping status. Completed lists are immutable.",
  request: {
    params: shoppingListParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: updateShoppingListInputSchema } },
    },
  },
  responses: {
    200: {
      description: "Updated list detail",
      content: { "application/json": { schema: shoppingListDetailSchema } },
    },
    ...errorResponses,
  },
});

const updateShoppingListHandler: RouteHandler<typeof updateShoppingListRoute, AppEnv> = (c) => {
  const { id } = c.req.valid("param");
  return c.json(updateShoppingList(c.get("ctx"), id, c.req.valid("json")), 200);
};

export const deleteShoppingListRoute = createRoute({
  method: "delete",
  path: "/shopping-lists/{id}",
  tags: [TAG],
  summary: "Delete a shopping list",
  description: "Removes the list and its items. Stock movements already written are kept.",
  request: { params: shoppingListParamsSchema },
  responses: {
    200: {
      description: "Deleted",
      content: { "application/json": { schema: deleteResponseSchema } },
    },
    ...errorResponses,
  },
});

const deleteShoppingListHandler: RouteHandler<typeof deleteShoppingListRoute, AppEnv> = (c) => {
  const { id } = c.req.valid("param");
  return c.json(deleteShoppingList(c.get("ctx"), id), 200);
};

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const addItemsRoute = createRoute({
  method: "post",
  path: "/shopping-lists/{id}/items",
  tags: [TAG],
  summary: "Add manual items",
  description:
    "Resolves ingredient names (names and aliases); unknown names become free-text items without an ingredient.",
  request: {
    params: shoppingListParamsSchema,
    body: { required: true, content: { "application/json": { schema: addItemsInputSchema } } },
  },
  responses: {
    201: {
      description: "Added items",
      content: { "application/json": { schema: addItemsResponseSchema } },
    },
    ...errorResponses,
  },
});

const addItemsHandler: RouteHandler<typeof addItemsRoute, AppEnv> = (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  return c.json(addItems(c.get("ctx"), id, body.items), 201);
};

export const updateItemRoute = createRoute({
  method: "patch",
  path: "/shopping-lists/{id}/items/{itemId}",
  tags: [TAG],
  summary: "Update a shopping item",
  request: {
    params: shoppingItemParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: updateShoppingItemInputSchema } },
    },
  },
  responses: {
    200: {
      description: "Updated item",
      content: { "application/json": { schema: shoppingItemSchema } },
    },
    ...errorResponses,
  },
});

const updateItemHandler: RouteHandler<typeof updateItemRoute, AppEnv> = (c) => {
  const { id, itemId } = c.req.valid("param");
  return c.json(updateItem(c.get("ctx"), id, itemId, c.req.valid("json")), 200);
};

export const deleteItemRoute = createRoute({
  method: "delete",
  path: "/shopping-lists/{id}/items/{itemId}",
  tags: [TAG],
  summary: "Delete a shopping item",
  request: { params: shoppingItemParamsSchema },
  responses: {
    200: {
      description: "Deleted",
      content: { "application/json": { schema: deleteResponseSchema } },
    },
    ...errorResponses,
  },
});

const deleteItemHandler: RouteHandler<typeof deleteItemRoute, AppEnv> = (c) => {
  const { id, itemId } = c.req.valid("param");
  return c.json(deleteItem(c.get("ctx"), id, itemId), 200);
};

export const checkItemsRoute = createRoute({
  method: "post",
  path: "/shopping-lists/{id}/check",
  tags: [TAG],
  summary: "Check or uncheck items",
  description:
    "Checking records what was actually taken (defaults to the planned quantity) and can record a substitute ingredient.",
  request: {
    params: shoppingListParamsSchema,
    body: { required: true, content: { "application/json": { schema: checkItemsInputSchema } } },
  },
  responses: {
    200: {
      description: "Updated items",
      content: { "application/json": { schema: addItemsResponseSchema } },
    },
    ...errorResponses,
  },
});

const checkItemsHandler: RouteHandler<typeof checkItemsRoute, AppEnv> = (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  return c.json(checkItems(c.get("ctx"), id, body.items), 200);
};

export const completeShoppingListRoute = createRoute({
  method: "post",
  path: "/shopping-lists/{id}/complete",
  tags: [TAG],
  summary: "Complete a shopping trip",
  description:
    "Writes purchase movements for checked items (actual, received override, or planned quantity), marks the list done, and skips free-text items.",
  request: {
    params: shoppingListParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: completeShoppingListInputSchema } },
    },
  },
  responses: {
    200: {
      description: "Completed list, written movements and skipped items",
      content: { "application/json": { schema: completeShoppingListResponseSchema } },
    },
    ...errorResponses,
  },
});

const completeShoppingListHandler: RouteHandler<typeof completeShoppingListRoute, AppEnv> = (c) => {
  const { id } = c.req.valid("param");
  return c.json(completeShoppingList(c.get("ctx"), id, c.req.valid("json")), 200);
};

/**
 * Demand, availability and shopping-list routes.
 *
 * IMPORTANT: `/pantry/availability` is a static path under the `/pantry/:id`
 * namespace owned by the pantry routes. Hono matches whatever is registered
 * first, so this registrar MUST stay above `registerPantryRoutes` in
 * `src/api/routes/index.ts`.
 */
export function registerShoppingRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(demandRoute, demandHandler);
  app.openapi(availabilityRoute, availabilityHandler);
  app.openapi(listShoppingListsRoute, listShoppingListsHandler);
  app.openapi(createShoppingListRoute, createShoppingListHandler);
  app.openapi(generateShoppingListRoute, generateShoppingListHandler);
  app.openapi(getShoppingListRoute, getShoppingListHandler);
  app.openapi(updateShoppingListRoute, updateShoppingListHandler);
  app.openapi(deleteShoppingListRoute, deleteShoppingListHandler);
  app.openapi(addItemsRoute, addItemsHandler);
  app.openapi(updateItemRoute, updateItemHandler);
  app.openapi(deleteItemRoute, deleteItemHandler);
  app.openapi(checkItemsRoute, checkItemsHandler);
  app.openapi(completeShoppingListRoute, completeShoppingListHandler);
}
