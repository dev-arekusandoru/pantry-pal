import { createRoute, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { ZodType } from "zod";
import type { AppEnv } from "../../auth/middleware.js";
import {
  checkIngredientsInputSchema,
  checkIngredientsResultSchema,
  createRuleSchema,
  deleteRuleResultSchema,
  dietaryRuleSchema,
  listRulesQuerySchema,
  ruleIdParamSchema,
  ruleListSchema,
  updateRuleSchema,
} from "../../schemas/rules.js";
import {
  checkIngredients,
  createRule,
  deleteRule,
  listRules,
  updateRule,
} from "../../services/rules.js";

const json = <T extends ZodType>(schema: T) => ({ "application/json": { schema } });

const listRulesRoute = createRoute({
  method: "get",
  path: "/rules",
  tags: ["rules"],
  summary: "List dietary rules",
  request: { query: listRulesQuerySchema },
  responses: {
    200: { description: "Dietary rules", content: json(ruleListSchema) },
  },
});

const listRulesHandler: RouteHandler<typeof listRulesRoute, AppEnv> = (c) =>
  c.json(listRules(c.var.ctx, c.req.valid("query")), 200);

const createRuleRoute = createRoute({
  method: "post",
  path: "/rules",
  tags: ["rules"],
  summary: "Create a dietary rule",
  description:
    "Targets depend on scope: ingredient (id or name, created when unknown), recipe (recipeId), category/tag/keyword (targetText).",
  request: {
    body: { content: json(createRuleSchema), required: true },
  },
  responses: {
    201: { description: "Created rule", content: json(dietaryRuleSchema) },
  },
});

const createRuleHandler: RouteHandler<typeof createRuleRoute, AppEnv> = (c) =>
  c.json(createRule(c.var.ctx, c.req.valid("json")), 201);

const updateRuleRoute = createRoute({
  method: "patch",
  path: "/rules/{id}",
  tags: ["rules"],
  summary: "Update a dietary rule",
  request: {
    params: ruleIdParamSchema,
    body: { content: json(updateRuleSchema), required: true },
  },
  responses: {
    200: { description: "Updated rule", content: json(dietaryRuleSchema) },
  },
});

const updateRuleHandler: RouteHandler<typeof updateRuleRoute, AppEnv> = (c) =>
  c.json(updateRule(c.var.ctx, c.req.valid("param").id, c.req.valid("json")), 200);

const deleteRuleRoute = createRoute({
  method: "delete",
  path: "/rules/{id}",
  tags: ["rules"],
  summary: "Delete a dietary rule",
  request: { params: ruleIdParamSchema },
  responses: {
    200: { description: "Deleted", content: json(deleteRuleResultSchema) },
  },
});

const deleteRuleHandler: RouteHandler<typeof deleteRuleRoute, AppEnv> = (c) =>
  c.json(deleteRule(c.var.ctx, c.req.valid("param").id), 200);

const checkIngredientsRoute = createRoute({
  method: "post",
  path: "/rules/check-ingredients",
  tags: ["rules"],
  summary: "Check ingredient names against dietary rules",
  description:
    "Pre-creation check: pass loose ingredient names (e.g. from a proposed recipe) and get per-name rule violations.",
  request: {
    body: { content: json(checkIngredientsInputSchema), required: true },
  },
  responses: {
    200: { description: "Per-ingredient checks", content: json(checkIngredientsResultSchema) },
  },
});

const checkIngredientsHandler: RouteHandler<typeof checkIngredientsRoute, AppEnv> = (c) =>
  c.json(checkIngredients(c.var.ctx, c.req.valid("json").names), 200);

export function registerRuleRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listRulesRoute, listRulesHandler);
  app.openapi(createRuleRoute, createRuleHandler);
  app.openapi(updateRuleRoute, updateRuleHandler);
  app.openapi(deleteRuleRoute, deleteRuleHandler);
  app.openapi(checkIngredientsRoute, checkIngredientsHandler);
}
