import { describe, expect, it } from "vitest";
import type { App } from "../src/api/app.js";
import { makeTestApp } from "./helpers.js";

/** Every tool the server must expose, by name. */
const TOOL_NAMES = [
  "household_get",
  "household_update",
  "ingredient_search",
  "ingredient_upsert",
  "unit_conversions",
  "pantry_query",
  "pantry_update",
  "pantry_history",
  "recipe_search",
  "recipe_get",
  "recipe_save",
  "recipe_set_status",
  "recipe_check",
  "rules_list",
  "rules_manage",
  "plan_get",
  "plan_create",
  "plan_set_slots",
  "plan_update",
  "prep_tasks",
  "cook_complete",
  "cook_history",
  "availability",
  "shopping_generate",
  "shopping_get",
  "shopping_update",
  "shopping_complete",
];

interface JsonRpcError {
  code: number;
  message: string;
}

interface ToolCallResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

interface JsonRpcEnvelope<T> {
  jsonrpc?: string;
  id?: number;
  result?: T;
  error?: JsonRpcError;
}

interface RpcOptions {
  method?: "POST" | "GET";
  token?: string;
  body?: unknown;
}

async function rpc<T>(
  app: App,
  options: RpcOptions,
): Promise<{ status: number; body: JsonRpcEnvelope<T> | null }> {
  const method = options.method ?? "POST";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;

  const response = await app.request("/mcp", {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? null : (JSON.parse(text) as JsonRpcEnvelope<T>),
  };
}

function initialize() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0.0.0" },
    },
  };
}

/** Call a tool and parse the JSON payload the server put in the text block. */
async function callTool(
  app: App,
  token: string,
  name: string,
  args: unknown,
): Promise<{ result: ToolCallResult; payload: unknown }> {
  const { status, body } = await rpc<ToolCallResult>(app, {
    token,
    body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } },
  });

  expect(status).toBe(200);
  const result = body?.result;
  expect(result).toBeDefined();
  const text = result!.content[0]?.text;
  expect(typeof text).toBe("string");
  return { result: result!, payload: JSON.parse(text!) };
}

describe("MCP endpoint", () => {
  it("serves initialize and advertises the server in stateless mode", async () => {
    const { app, token } = makeTestApp();

    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initialize()),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = (await response.json()) as JsonRpcEnvelope<{
      protocolVersion: string;
      instructions?: string;
      serverInfo: { name: string; version: string };
    }>;
    expect(body.result?.serverInfo.name).toBe("pantrypal");
    expect(body.result?.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.result?.protocolVersion).toBe("2025-06-18");
    expect(body.result?.instructions).toContain("quantity math");
  });

  it("lists every tool", async () => {
    const { app, token } = makeTestApp();
    await rpc(app, { token, body: initialize() });

    const { status, body } = await rpc<{ tools: { name: string; annotations?: Record<string, boolean> }[] }>(
      app,
      { token, body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } },
    );

    expect(status).toBe(200);
    const names = (body?.result?.tools ?? []).map((tool) => tool.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());

    const byName = new Map((body?.result?.tools ?? []).map((tool) => [tool.name, tool]));
    expect(byName.get("pantry_query")?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get("pantry_update")?.annotations).toMatchObject({ destructiveHint: true });
  });

  it("reflects stock math through pantry_update and pantry_query", async () => {
    const { app, token } = makeTestApp();

    const update = await callTool(app, token, "pantry_update", {
      action: "bulk",
      lines: [
        { op: "set", ingredient: "Chicken breast", qty: 2, unit: "lb", reason: "purchase" },
        { op: "adjust", ingredient: "Chicken breast", delta: -8, unit: "oz", reason: "cook" },
      ],
    });
    expect(update.result.isError).toBeUndefined();

    const query = await callTool(app, token, "pantry_query", { query: "chicken" });
    const payload = query.payload as {
      items: { qty: number | null; unit: string | null; ingredient: { name: string } }[];
    };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.ingredient.name).toBe("Chicken breast");
    expect(payload.items[0]?.qty).toBe(1.5);
    expect(payload.items[0]?.unit).toBe("lb");
  });

  it("returns an AppError as an isError body with the domain code", async () => {
    const { app, token } = makeTestApp();

    const { result, payload } = await callTool(app, token, "recipe_get", {
      idOrSlug: "rcp_missing",
    });

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ error: { code: "not_found" } });
  });

  it("rejects unauthenticated requests and non-POST methods", async () => {
    const { app, token } = makeTestApp();

    const anonymous = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initialize()),
    });
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });

    const get = await rpc(app, { method: "GET", token });
    expect(get.status).toBe(405);
  });
});
