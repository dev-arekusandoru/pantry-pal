import { afterEach, describe, expect, it, vi } from "vitest";
import { client, unwrap } from "./client";
import { connection } from "./connection";
import { ApiError, NetworkError } from "./errors";
import { shouldRetry } from "./queryClient";

afterEach(() => {
  vi.unstubAllGlobals();
  connection.markReachable();
});

function stubFetch(impl: (req: Request) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn((req: Request) => impl(req)));
}

describe("api client", () => {
  it("returns data and targets /api/v1", async () => {
    let url = "";
    stubFetch(async (req) => {
      url = new URL(req.url, "http://x").pathname;
      return Response.json({ household: { id: "h1" } });
    });
    const data = await unwrap(client.GET("/household"));
    expect(url).toBe("/api/v1/household");
    expect(data).toBeDefined();
  });

  it("throws ApiError with the server's code and message", async () => {
    stubFetch(async () => Response.json({ error: { code: "not_found", message: "No such recipe" } }, { status: 404 }));
    const err = await unwrap(client.GET("/household")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "not_found", message: "No such recipe" });
  });

  it("falls back to a generic ApiError for non-JSON failures", async () => {
    stubFetch(async () => new Response("boom", { status: 500 }));
    const err = await unwrap(client.GET("/household")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, code: "unknown" });
  });

  it("flags network failures and gateway errors as unreachable", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(unwrap(client.GET("/household"))).rejects.toBeInstanceOf(NetworkError);
    expect(connection.isUnreachable()).toBe(true);

    connection.markReachable();
    stubFetch(async () => new Response("", { status: 502 }));
    await expect(unwrap(client.GET("/household"))).rejects.toBeInstanceOf(NetworkError);
    expect(connection.isUnreachable()).toBe(true);

    stubFetch(async () => Response.json({}));
    await unwrap(client.GET("/household"));
    expect(connection.isUnreachable()).toBe(false);
  });
});

describe("shouldRetry", () => {
  it("does not retry 4xx, retries others twice", () => {
    expect(shouldRetry(0, new ApiError(404, "not_found", "x"))).toBe(false);
    expect(shouldRetry(0, new ApiError(500, "internal", "x"))).toBe(true);
    expect(shouldRetry(0, new NetworkError())).toBe(true);
    expect(shouldRetry(2, new NetworkError())).toBe(false);
  });
});
