import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import type { Db } from "../db/client.js";
import { makeCtx, type Ctx } from "../context.js";
import { verifyToken } from "./tokens.js";

/** Hono environment for authenticated routes: `c.var.ctx` is always set. */
export type AppEnv = { Variables: { ctx: Ctx } };

/** Extract the token from `Authorization: Bearer <token>` (case-insensitive scheme). */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Bearer auth middleware. Missing/invalid/revoked tokens get a 401 JSON error;
 * valid tokens get a context scoped to their household.
 */
export function createAuthMiddleware(
  db: Db,
  now: () => Date = () => new Date(),
): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = extractBearerToken(c.req.header("authorization"));
    const verified = token ? verifyToken(db, token) : null;
    if (!verified) {
      return c.json(
        {
          error: {
            code: "unauthorized" as const,
            message: "Missing or invalid API token",
          },
        },
        401,
      );
    }

    c.set("ctx", makeCtx(db, verified.householdId, now));
    await next();
  });
}
