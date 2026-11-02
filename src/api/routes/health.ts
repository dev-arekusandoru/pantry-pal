import { readFileSync } from "node:fs";
import path from "node:path";
import { createRoute, z, type OpenAPIHono, type RouteHandler } from "@hono/zod-openapi";
import type { AppEnv } from "../../auth/middleware.js";
import { packageRoot } from "../../db/client.js";

let cachedVersion: string | undefined;

/** Version from the package manifest (works from src and dist). */
export function packageVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const raw = readFileSync(path.join(packageRoot(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    cachedVersion = typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
});

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["meta"],
  summary: "Liveness probe",
  description: "Public endpoint; requires no authentication.",
  responses: {
    200: {
      description: "Service is running",
      content: { "application/json": { schema: healthResponseSchema } },
    },
  },
});

export const healthHandler: RouteHandler<typeof healthRoute, AppEnv> = (c) =>
  c.json({ ok: true, version: packageVersion() }, 200);

export function registerHealthRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(healthRoute, healthHandler);
}
