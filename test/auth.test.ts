import { describe, expect, it } from "vitest";
import { listTokens, revokeToken } from "../src/auth/tokens.js";
import { makeTestApp } from "./helpers.js";

describe("public endpoints", () => {
  it("serves /health without a token", async () => {
    const { app } = makeTestApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, version: expect.any(String) });
  });

  it("serves /openapi.json without a token and documents bearer auth", async () => {
    const { app } = makeTestApp();
    const response = await app.request("/openapi.json");

    expect(response.status).toBe(200);
    const doc = (await response.json()) as {
      openapi: string;
      info: { title: string };
      components: { securitySchemes: Record<string, { type: string; scheme?: string }> };
    };
    expect(doc.info.title).toBe("PantryPal");
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });
});

describe("bearer authentication", () => {
  it("rejects a request without a token", async () => {
    const { app } = makeTestApp();
    const response = await app.request("/api/v1/ingredients");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("rejects a malformed token", async () => {
    const { app } = makeTestApp();
    const response = await app.request("/api/v1/ingredients", {
      headers: { authorization: "Bearer nope" },
    });

    expect(response.status).toBe(401);
  });

  it("rejects a revoked token and accepts the other token", async () => {
    const { app, db, ctx, token } = makeTestApp();
    const active = listTokens(db, ctx.householdId)[0]!;
    revokeToken(db, ctx.householdId, active.id);

    const response = await app.request("/api/v1/ingredients", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  });

  it("lets a valid token reach /api/v1 (unknown route → 404, not 401)", async () => {
    const { request } = makeTestApp();
    const { status } = await request("GET", "/api/v1/does-not-exist");

    expect(status).toBe(404);
  });

  it("requires auth for the MCP endpoint", async () => {
    const { app } = makeTestApp();
    const response = await app.request("/mcp", { method: "POST" });

    expect(response.status).toBe(401);
  });
});
