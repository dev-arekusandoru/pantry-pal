import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { ZodType } from "zod";
import type { AppEnv } from "../../auth/middleware.js";
import { createToken, listTokens, revokeToken } from "../../auth/tokens.js";
import { AppError } from "../../lib/errors.js";
import {
  apiTokenListSchema,
  createdTokenSchema,
  createTokenSchema,
  tokenIdParamSchema,
} from "../../schemas/tokens.js";

const json = <T extends ZodType>(schema: T) => ({ "application/json": { schema } });

const sessionOnly = "Needs a browser session; an API token gets 403 `forbidden`.";

/** A leaked token must not be able to mint or revoke tokens. */
function requireSession(c: { var: AppEnv["Variables"] }): void {
  if (c.var.authKind !== "session") {
    throw new AppError("forbidden", "API tokens can only be managed from a browser session");
  }
}

const listRoute = createRoute({
  method: "get",
  path: "/tokens",
  tags: ["tokens"],
  summary: "List API tokens",
  description: `Active tokens of the household, newest first. Never includes secrets. ${sessionOnly}`,
  responses: { 200: { description: "Tokens", content: json(apiTokenListSchema) } },
});

const createTokenRoute = createRoute({
  method: "post",
  path: "/tokens",
  tags: ["tokens"],
  summary: "Create an API token",
  description: `The \`token\` secret is in this response only. ${sessionOnly}`,
  request: { body: { content: json(createTokenSchema), required: true } },
  responses: { 201: { description: "Created token", content: json(createdTokenSchema) } },
});

const revokeRoute = createRoute({
  method: "delete",
  path: "/tokens/{id}",
  tags: ["tokens"],
  summary: "Revoke an API token",
  description: sessionOnly,
  request: { params: tokenIdParamSchema },
  responses: { 204: { description: "Revoked" } },
});

export function registerTokenRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listRoute, (c) => {
    requireSession(c);
    const items = listTokens(c.var.ctx.db, c.var.ctx.householdId).filter((t) => t.revokedAt === null);
    return c.json({ items }, 200);
  });
  app.openapi(createTokenRoute, (c) => {
    requireSession(c);
    return c.json(createToken(c.var.ctx.db, c.var.ctx.householdId, c.req.valid("json").name), 201);
  });
  app.openapi(revokeRoute, (c) => {
    requireSession(c);
    revokeToken(c.var.ctx.db, c.var.ctx.householdId, c.req.valid("param").id);
    return c.body(null, 204);
  });
}
