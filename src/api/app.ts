import { OpenAPIHono, type Hook } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createAuthMiddleware, type AppEnv } from "../auth/middleware.js";
import type { Db } from "../db/client.js";
import { isAppError } from "../lib/errors.js";
import { mountMcp as defaultMountMcp, type McpDeps } from "../mcp/mount.js";
import { routeRegistrars } from "./routes/index.js";
import { healthHandler, healthRoute, packageVersion } from "./routes/health.js";
import { createWebMiddleware } from "./web.js";

export type { AppEnv } from "../auth/middleware.js";

/** Fully configured Hono app (OpenAPI-aware). */
export type App = OpenAPIHono<AppEnv>;

export interface CreateAppOptions {
  db: Db;
  /** Clock used for request contexts (tests inject a fixed one). */
  now?: () => Date;
  /**
   * MCP mount point overrides (tests or alternate transports). Defaults to the
   * Streamable HTTP handler in `src/mcp/mount.ts`.
   */
  mountMcp?: (app: App, deps: McpDeps) => void;
  /**
   * Network-trust auth for `/api/v1/*` only: requests without an `Authorization`
   * header act as the instance's single household. Tokens that are sent are still
   * verified. Never applies to `/mcp`. Default false.
   */
  trustNetwork?: boolean;
  /** Directory of the built web app to serve at `/` (SPA fallback). Omit to serve none. */
  webDir?: string;
}

/**
 * Zod validation failures (body/query/params) become a 400 validation error
 * instead of the default 400 plain-text response.
 */
const defaultHook: Hook<unknown, AppEnv, string, void | Response> = (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "validation" as const,
          message: "Request validation failed",
          details: result.error.issues,
        },
      },
      400,
    );
  }
};

export function createApp(options: CreateAppOptions): App {
  const { db } = options;
  const now = options.now ?? (() => new Date());
  const mountMcp = options.mountMcp ?? defaultMountMcp;

  const app = new OpenAPIHono<AppEnv>({ defaultHook });

  app.onError((err, c) => {
    if (isAppError(err)) {
      return c.json(err.toBody(), err.status as ContentfulStatusCode);
    }
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    console.error("[pantrypal] unhandled error:", err);
    return c.json({ error: { code: "internal", message: "Internal server error" } }, 500);
  });

  // Everything below /api/v1 requires a bearer token (or network trust, when enabled).
  const api = new OpenAPIHono<AppEnv>({ defaultHook });
  for (const register of routeRegistrars) register(api);

  const auth = createAuthMiddleware(db, now);
  const apiAuth = options.trustNetwork === true
    ? createAuthMiddleware(db, now, { trustNetwork: true })
    : auth;
  app.use("/api/v1/*", apiAuth);
  app.route("/api/v1", api);

  // MCP transport shares the same auth and service layer.
  app.use("/mcp", auth);
  app.use("/mcp/*", auth);
  mountMcp(app, { db, now });

  // Public endpoints.
  app.openapi(healthRoute, healthHandler);

  // Components cannot be passed to doc31 config (the generator owns them), so
  // the bearer scheme is registered on the registry instead.
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "API token created with `pantrypal token create --name <name>`.",
  });

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "PantryPal",
      version: packageVersion(),
      description:
        "Self-hosted household pantry, recipe, meal-plan and shopping backend. All /api/v1 routes require a bearer API token, unless the server runs with PANTRYPAL_TRUST_NETWORK=1 (then requests without a token act as the household).",
    },
    tags: [{ name: "meta", description: "Health and API metadata" }],
    security: [{ bearerAuth: [] }],
  });

  if (options.webDir !== undefined) app.use("*", createWebMiddleware(options.webDir));

  return app;
}
