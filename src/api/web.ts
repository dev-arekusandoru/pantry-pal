import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import path from "node:path";
import type { MiddlewareHandler } from "hono";
import { packageRoot } from "../db/client.js";

/** Long-lived caching for fingerprinted Vite assets. */
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** Everything else (index.html, icons, manifest) must revalidate. */
const DEFAULT_CACHE_CONTROL = "no-cache";

/** Paths owned by the API; never answered by the web app. */
const RESERVED_PATHS = ["/api", "/mcp", "/health", "/openapi.json"];

/** Directory of the built web app: `PANTRYPAL_WEB_DIR`, else `web/dist` under the package root. */
export function defaultWebDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PANTRYPAL_WEB_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(packageRoot(), "web", "dist");
}

/** True when `dir` holds a built web app (an `index.html`). */
export function hasWebApp(dir: string): boolean {
  return existsSync(path.join(dir, "index.html"));
}

/**
 * Static file server for the built web app with an SPA fallback: a GET/HEAD that
 * accepts HTML and matches no file receives `index.html`. API, MCP, health and
 * OpenAPI paths are never handled here. Register it after every API route.
 */
export function createWebMiddleware(webDir: string): MiddlewareHandler {
  const root = path.resolve(webDir);
  const files = serveStatic({ root });
  const index = serveStatic({ root, path: "index.html" });

  return async (c, next) => {
    const requestPath = c.req.path;
    if (RESERVED_PATHS.some((p) => requestPath === p || requestPath.startsWith(`${p}/`))) {
      return next();
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();

    let fileMissing = false;
    let served = await files(c, async () => {
      fileMissing = true;
    });
    let cacheControl = requestPath.startsWith("/assets/")
      ? ASSET_CACHE_CONTROL
      : DEFAULT_CACHE_CONTROL;

    if (fileMissing) {
      const accept = c.req.header("accept") ?? "";
      if (!accept.includes("text/html")) return next();
      served = await index(c, next);
      cacheControl = DEFAULT_CACHE_CONTROL;
    }

    // serveStatic returns a fresh Response (it does not finalize the context).
    if (served instanceof Response) served.headers.set("Cache-Control", cacheControl);
    return served;
  };
}
