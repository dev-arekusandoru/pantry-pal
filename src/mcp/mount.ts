import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../auth/middleware.js";
import type { Db } from "../db/client.js";

/** Dependencies available to the MCP transport. */
export interface McpDeps {
  db: Db;
  now: () => Date;
}

/**
 * MCP mount point (Streamable HTTP at `/mcp`).
 *
 * STUB: the MCP server is not implemented yet. A later agent replaces this
 * module with the real `@modelcontextprotocol/sdk` Streamable HTTP handler,
 * keeping the same `mountMcp(app, deps)` signature. Auth middleware already
 * runs for `/mcp`, so `c.var.ctx` is available inside the handler.
 */
export function mountMcp(app: OpenAPIHono<AppEnv>, _deps: McpDeps): void {
  app.all("/mcp", (c) =>
    c.json(
      {
        error: {
          code: "internal" as const,
          message: "MCP endpoint is not implemented yet",
        },
      },
      501,
    ),
  );
}
