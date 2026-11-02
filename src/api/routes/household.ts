import { createRoute, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { ZodType } from "zod";
import type { AppEnv } from "../../auth/middleware.js";
import {
  createMemberSchema,
  deleteMemberResultSchema,
  householdMemberListSchema,
  householdMemberSchema,
  householdSchema,
  memberIdParamSchema,
  updateHouseholdSchema,
  updateMemberSchema,
} from "../../schemas/household.js";
import {
  createMember,
  deleteMember,
  getHousehold,
  listMembers,
  updateHousehold,
  updateMember,
} from "../../services/households.js";

const json = <T extends ZodType>(schema: T) => ({ "application/json": { schema } });

const getHouseholdRoute = createRoute({
  method: "get",
  path: "/household",
  tags: ["household"],
  summary: "Get the household",
  description: "Single household of this instance, including its settings.",
  responses: {
    200: { description: "Household", content: json(householdSchema) },
  },
});

const getHouseholdHandler: RouteHandler<typeof getHouseholdRoute, AppEnv> = (c) =>
  c.json(getHousehold(c.var.ctx.db, c.var.ctx.householdId), 200);

const updateHouseholdRoute = createRoute({
  method: "patch",
  path: "/household",
  tags: ["household"],
  summary: "Update the household",
  description: "`settings` is merged key-by-key over the current settings.",
  request: {
    body: { content: json(updateHouseholdSchema), required: true },
  },
  responses: {
    200: { description: "Updated household", content: json(householdSchema) },
  },
});

const updateHouseholdHandler: RouteHandler<typeof updateHouseholdRoute, AppEnv> = (c) =>
  c.json(updateHousehold(c.var.ctx, c.req.valid("json")), 200);

const listMembersRoute = createRoute({
  method: "get",
  path: "/household/members",
  tags: ["household"],
  summary: "List household members",
  responses: {
    200: { description: "Members", content: json(householdMemberListSchema) },
  },
});

const listMembersHandler: RouteHandler<typeof listMembersRoute, AppEnv> = (c) =>
  c.json(listMembers(c.var.ctx), 200);

const createMemberRoute = createRoute({
  method: "post",
  path: "/household/members",
  tags: ["household"],
  summary: "Create a household member",
  request: {
    body: { content: json(createMemberSchema), required: true },
  },
  responses: {
    201: { description: "Created member", content: json(householdMemberSchema) },
  },
});

const createMemberHandler: RouteHandler<typeof createMemberRoute, AppEnv> = (c) =>
  c.json(createMember(c.var.ctx, c.req.valid("json")), 201);

const updateMemberRoute = createRoute({
  method: "patch",
  path: "/household/members/{id}",
  tags: ["household"],
  summary: "Update a household member",
  request: {
    params: memberIdParamSchema,
    body: { content: json(updateMemberSchema), required: true },
  },
  responses: {
    200: { description: "Updated member", content: json(householdMemberSchema) },
  },
});

const updateMemberHandler: RouteHandler<typeof updateMemberRoute, AppEnv> = (c) =>
  c.json(updateMember(c.var.ctx, c.req.valid("param").id, c.req.valid("json")), 200);

const deleteMemberRoute = createRoute({
  method: "delete",
  path: "/household/members/{id}",
  tags: ["household"],
  summary: "Delete a household member",
  description: "Rules scoped to the member are removed with it.",
  request: { params: memberIdParamSchema },
  responses: {
    200: { description: "Deleted", content: json(deleteMemberResultSchema) },
  },
});

const deleteMemberHandler: RouteHandler<typeof deleteMemberRoute, AppEnv> = (c) =>
  c.json(deleteMember(c.var.ctx, c.req.valid("param").id), 200);

export function registerHouseholdRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getHouseholdRoute, getHouseholdHandler);
  app.openapi(updateHouseholdRoute, updateHouseholdHandler);
  app.openapi(listMembersRoute, listMembersHandler);
  app.openapi(createMemberRoute, createMemberHandler);
  app.openapi(updateMemberRoute, updateMemberHandler);
  app.openapi(deleteMemberRoute, deleteMemberHandler);
}
