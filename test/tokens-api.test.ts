import { describe, expect, it } from "vitest";
import { makeAuthApp, sessionCookie, type AuthTestApp } from "./helpers.js";

const ORIGIN = "http://localhost";

interface Created {
  id: string;
  token: string;
}

async function signup(app: AuthTestApp, email: string) {
  const res = await app.request("POST", "/auth/signup", {
    body: { email, password: "correct horse battery candle", householdName: email },
    headers: { origin: ORIGIN },
  });
  expect(res.status).toBe(201);
  return sessionCookie(res);
}

const create = (app: AuthTestApp, cookie: string, name = "Agent") =>
  app.request<Created>("POST", "/api/v1/tokens", { cookie, body: { name }, headers: { origin: ORIGIN } });

describe("token management API", () => {
  it("rejects bearer callers on every route", async () => {
    const app = makeAuthApp();
    const cookie = await signup(app, "a@example.com");
    const { body } = await create(app, cookie);

    for (const [method, path, reqBody] of [
      ["GET", "/api/v1/tokens", undefined],
      ["POST", "/api/v1/tokens", { name: "x" }],
      ["DELETE", `/api/v1/tokens/${body.id}`, undefined],
    ] as const) {
      const res = await app.request<{ error: { code: string } }>(method, path, {
        token: body.token,
        ...(reqBody ? { body: reqBody } : {}),
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
    }
  });

  it("shows the secret once, scopes to the household and the token works", async () => {
    const app = makeAuthApp();
    const cookieA = await signup(app, "a@example.com");
    const cookieB = await signup(app, "b@example.com");
    const created = await create(app, cookieA);
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^pp_/);

    const list = await app.request<{ items: Array<Record<string, unknown>> }>("GET", "/api/v1/tokens", {
      cookie: cookieA,
    });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: created.body.id, name: "Agent", lastUsedAt: null });
    expect(JSON.stringify(list.body)).not.toContain(created.body.token);
    expect(list.body.items[0]).not.toHaveProperty("tokenHash");

    const other = await app.request<{ items: unknown[] }>("GET", "/api/v1/tokens", { cookie: cookieB });
    expect(other.body.items).toEqual([]);
    const foreign = await app.request("DELETE", `/api/v1/tokens/${created.body.id}`, {
      cookie: cookieB,
      headers: { origin: ORIGIN },
    });
    expect(foreign.status).toBe(404);

    expect((await app.request("GET", "/api/v1/household", { token: created.body.token })).status).toBe(200);
    const mcp = await app.app.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${created.body.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    });
    expect(mcp.status).toBe(200);

    const revoked = await app.request("DELETE", `/api/v1/tokens/${created.body.id}`, {
      cookie: cookieA,
      headers: { origin: ORIGIN },
    });
    expect(revoked.status).toBe(204);
    expect((await app.request("GET", "/api/v1/household", { token: created.body.token })).status).toBe(401);
    const after = await app.request<{ items: unknown[] }>("GET", "/api/v1/tokens", { cookie: cookieA });
    expect(after.body.items).toEqual([]);
  });
});
