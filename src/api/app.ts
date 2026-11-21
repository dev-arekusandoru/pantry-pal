import { OpenAPIHono, type Hook } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createAccessGate } from "../access.js";
import { createAuthMiddleware, type AppEnv } from "../auth/middleware.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { SESSION_COOKIE_NAME } from "../auth/session.js";
import { registerBillingRoutes } from "../billing/routes.js";
import type { Db } from "../db/client.js";
import { accessPolicy, SELF_HOST, type Hosted } from "../hosted.js";
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
  /** Clock used for request contexts and session expiry (tests inject a fixed one). */
  now?: () => Date;
  /**
   * MCP mount point overrides (tests or alternate transports). Defaults to the
   * Streamable HTTP handler in `src/mcp/mount.ts`.
   */
  mountMcp?: (app: App, deps: McpDeps) => void;
  /** Whether `POST /auth/signup` accepts new accounts. Default true. */
  signupOpen?: boolean;
  /** Email and billing services of the hosted version. Omit for a self-hosted instance (no paywall, no verification). */
  hosted?: Hosted;
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
  const hosted = options.hosted ?? SELF_HOST;
  const policy = accessPolicy(hosted);
  const gated = policy.emailOn || policy.billingOn;

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

  // Everything below /api/v1 requires a bearer token or a browser session.
  const api = new OpenAPIHono<AppEnv>({ defaultHook });
  for (const register of routeRegistrars) register(api);

  const auth = createAuthMiddleware(db, now);
  app.use("/api/v1", auth);
  app.use("/api/v1/*", auth);
  // Hosted: a locked household (no plan, or unverified email past the grace period) gets 402.
  if (gated) {
    const gate = createAccessGate(db, policy, now);
    app.use("/api/v1", gate);
    app.use("/api/v1/*", gate);
  }
  app.route("/api/v1", api);

  // Account endpoints. Live outside /api/v1 because they must stay public.
  registerAuthRoutes(app, {
    db,
    now,
    signupOpen: options.signupOpen ?? true,
    hosted,
  });
  registerBillingRoutes(app, { db, now, hosted });

  // MCP transport shares the same service layer but accepts bearer tokens only.
  const mcpAuth = createAuthMiddleware(db, now, { allowSession: false });
  app.use("/mcp", mcpAuth);
  app.use("/mcp/*", mcpAuth);
  if (gated) {
    const gate = createAccessGate(db, policy, now);
    app.use("/mcp", gate);
    app.use("/mcp/*", gate);
  }
  mountMcp(app, { db, now });

  // Public endpoints.
  app.openapi(healthRoute, healthHandler);

  // Components cannot be passed to doc31 config (the generator owns them), so
  // the auth schemes are registered on the registry instead.
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "API token created with `pantrypal token create --name <name>`.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: SESSION_COOKIE_NAME,
    description:
      "Browser session cookie set by POST /auth/signup or POST /auth/login. Valid for 30 days; logout or a password reset invalidates it. Never accepted by /mcp.",
  });

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Rakumi",
      version: packageVersion(),
      description:
        "Self-hosted household pantry, recipe, meal-plan and shopping backend. /api/v1 accepts a bearer API token or the browser session cookie issued by POST /auth/login; each account owns one household. /mcp is bearer-only.",
    },
    tags: [{ name: "meta", description: "Health and API metadata" }],
    security: [{ bearerAuth: [] }, { sessionCookie: [] }],
  });

  if (options.webDir !== undefined) app.use("*", createWebMiddleware(options.webDir));

  return app;
}
