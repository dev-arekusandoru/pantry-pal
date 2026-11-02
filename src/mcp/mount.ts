import type { OpenAPIHono } from "@hono/zod-openapi";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AppEnv } from "../auth/middleware.js";
import type { Db } from "../db/client.js";
import { createMcpServer } from "./server.js";

/** Dependencies available to the MCP transport. */
export interface McpDeps {
  db: Db;
  now: () => Date;
}

/** JSON-RPC style rejection for methods the stateless endpoint does not serve. */
function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST with a JSON-RPC request." },
      id: null,
    }),
    {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "application/json" },
    },
  );
}

/**
 * Mount the MCP server (Streamable HTTP at `/mcp`).
 *
 * The endpoint is STATELESS: every POST gets a fresh `McpServer` + transport
 * bound to the authenticated request's context, so no session id is issued and
 * no server state survives between requests (the database is the state). JSON
 * responses are enabled so plain request/response clients work; GET (SSE) and
 * DELETE (session end) are meaningless without sessions and answer 405.
 *
 * Auth middleware already runs for `/mcp`, so `c.var.ctx` is always set here.
 */
export function mountMcp(app: OpenAPIHono<AppEnv>, _deps: McpDeps): void {
  app.all("/mcp", async (c) => {
    if (c.req.method !== "POST") return methodNotAllowed();

    const server = createMcpServer(c.var.ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
