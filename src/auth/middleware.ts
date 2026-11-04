import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import { households } from "../db/schema.js";
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

export interface AuthMiddlewareOptions {
  /**
   * Network-trust mode: a request with no `Authorization` header acts as the
   * instance's single household. A header that is present is still verified.
   */
  trustNetwork?: boolean;
}

/**
 * Bearer auth middleware. Missing/invalid/revoked tokens get a 401 JSON error;
 * valid tokens get a context scoped to their household. With `trustNetwork`, a
 * request without any `Authorization` header gets the single household's context
 * (or a 503 when the instance has no household yet).
 */
export function createAuthMiddleware(
  db: Db,
  now: () => Date = () => new Date(),
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header("authorization");

    if (options.trustNetwork === true && (header === undefined || header.trim() === "")) {
      const household = db.select({ id: households.id }).from(households).limit(1).get();
      if (!household) {
        return c.json(
          {
            error: {
              code: "unavailable" as const,
              message:
                "PANTRYPAL_TRUST_NETWORK is on but no household exists yet. Run `pantrypal household init --name <name>` first.",
            },
          },
          503,
        );
      }
      c.set("ctx", makeCtx(db, household.id, now));
      await next();
      return;
    }

    const token = extractBearerToken(header);
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
