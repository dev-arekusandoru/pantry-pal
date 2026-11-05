import { describe, expect, it } from "vitest";
import { createApp, type App } from "../src/api/app.js";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "../src/auth/session.js";
import { households } from "../src/db/schema.js";
import { makeTestCtx } from "./helpers.js";

const PASSWORD = "correct horse battery staple";
const DAY_MS = 24 * 60 * 60 * 1000;
const ORIGIN = "http://localhost";

interface PasswordAppOptions {
  password?: string;
  trustNetwork?: boolean;
  now?: () => Date;
}

function passwordApp(options: PasswordAppOptions = {}) {
  const context = makeTestCtx(options.now === undefined ? {} : { now: options.now });
  const app = createApp({
    db: context.db,
    now: context.ctx.now,
    browserPassword: options.password ?? PASSWORD,
    ...(options.trustNetwork === true ? { trustNetwork: true } : {}),
  });
  return { ...context, app };
}

function loginAt(app: App, url: string, password: string, headers: Record<string, string> = {}) {
  return app.request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ password }),
  });
}

function login(app: App, password: string, headers: Record<string, string> = {}) {
  return loginAt(app, "/auth/login", password, { origin: ORIGIN, ...headers });
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("expected a Set-Cookie header");
  const pair = setCookie.split(";")[0];
  if (pair === undefined) throw new Error("expected a cookie pair");
  return pair.trim();
}

async function loggedInCookie(app: App, password = PASSWORD): Promise<string> {
  const response = await login(app, password);
  expect(response.status).toBe(204);
  return sessionCookie(response);
}

function get(app: App, path: string, cookie?: string, extra: Record<string, string> = {}) {
  return app.request(path, {
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...extra,
    },
  });
}

describe("browser password sessions", () => {
  it("blocks anonymous /api/v1 access in password mode", async () => {
    const { app } = passwordApp();

    for (const path of ["/api/v1", "/api/v1/ingredients", "/api/v1/household"]) {
      const response = await get(app, path);
      expect(response.status, path).toBe(401);
    }
  });

  it("reports enabled/authenticated state without caching", async () => {
    const { app, household } = passwordApp();

    const anonymous = await get(app, "/auth/session");
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    await expect(anonymous.json()).resolves.toEqual({ enabled: true, authenticated: false });

    const cookie = await loggedInCookie(app);
    const authenticated = await get(app, "/auth/session", cookie);
    await expect(authenticated.json()).resolves.toEqual({ enabled: true, authenticated: true });

    const api = await get(app, "/api/v1/household", cookie);
    expect(api.status).toBe(200);
    expect(api.headers.get("cache-control")).toBe("no-store");
    await expect(api.json()).resolves.toMatchObject({ id: household.id });
  });

  it("sets a Secure, HttpOnly, SameSite=Lax 30-day cookie on correct login", async () => {
    const { app } = passwordApp();

    const response = await login(app, PASSWORD);
    expect(response.status).toBe(204);

    const raw = response.headers.get("set-cookie") ?? "";
    expect(raw).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(raw).toMatch(/;\s*HttpOnly/i);
    expect(raw).toMatch(/;\s*Secure/i);
    expect(raw).toMatch(/;\s*SameSite=Lax/i);
    expect(raw).toMatch(new RegExp(`;\\s*Max-Age=${SESSION_TTL_SECONDS}(?:;|$)`, "i"));
    expect(raw).toMatch(/;\s*Path=\/(?:;|$)/i);
  });

  it("rejects a wrong password with 401 and no cookie", async () => {
    const { app } = passwordApp();
    const response = await login(app, "wrong");

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects a tampered cookie", async () => {
    const { app } = passwordApp();
    const cookie = await loggedInCookie(app);
    const parts = cookie.split(".");
    parts[1] = String(Number(parts[1]) + 1);
    const tampered = parts.join(".");

    expect((await get(app, "/api/v1/household", tampered)).status).toBe(401);
    expect((await get(app, "/auth/session", tampered)).status).toBe(200);
    await expect((await get(app, "/auth/session", tampered)).json()).resolves.toMatchObject({
      authenticated: false,
    });
  });

  it("rejects an expired cookie", async () => {
    let clock = new Date("2026-11-01T12:00:00.000Z");
    const { app } = passwordApp({ now: () => clock });
    const cookie = await loggedInCookie(app);

    expect((await get(app, "/api/v1/household", cookie)).status).toBe(200);

    clock = new Date(clock.getTime() + 31 * DAY_MS);
    expect((await get(app, "/api/v1/household", cookie)).status).toBe(401);
  });

  it("invalidates every session when the password rotates", async () => {
    const context = makeTestCtx();
    const before = createApp({ db: context.db, now: context.ctx.now, browserPassword: "old-password" });
    const cookie = await loggedInCookie(before, "old-password");
    expect((await get(before, "/api/v1/household", cookie)).status).toBe(200);

    const after = createApp({ db: context.db, now: context.ctx.now, browserPassword: "new-password" });
    expect((await get(after, "/api/v1/household", cookie)).status).toBe(401);
    const fresh = await loggedInCookie(after, "new-password");
    expect((await get(after, "/api/v1/household", fresh)).status).toBe(200);
  });

  it("clears the cookie on logout", async () => {
    const { app } = passwordApp();
    const cookie = await loggedInCookie(app);

    const response = await app.request("/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
    });
    expect(response.status).toBe(204);
    const raw = response.headers.get("set-cookie") ?? "";
    expect(raw).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(raw).toMatch(/;\s*Max-Age=0(?:;|$)/i);

    const session = await get(app, "/auth/session", `${SESSION_COOKIE_NAME}=`);
    await expect(session.json()).resolves.toEqual({ enabled: true, authenticated: false });
  });
});

describe("session CSRF protection", () => {
  it("blocks cross-origin login and logout", async () => {
    const { app } = passwordApp();
    const cookie = await loggedInCookie(app);

    const crossLogin = await login(app, PASSWORD, { origin: "https://evil.example" });
    expect(crossLogin.status).toBe(403);
    expect(crossLogin.headers.get("set-cookie")).toBeNull();

    const crossLogout = await app.request("/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example", cookie },
    });
    expect(crossLogout.status).toBe(403);
  });

  it("rejects cross-site fetch metadata", async () => {
    const { app } = passwordApp();
    const response = await login(app, PASSWORD, { "sec-fetch-site": "cross-site" });
    expect(response.status).toBe(403);
  });

  it("requires an Origin header for login, logout and unsafe cookie requests", async () => {
    const { app } = passwordApp();
    const cookie = await loggedInCookie(app);

    expect((await login(app, PASSWORD, { origin: "" })).status).toBe(403);

    const logout = await app.request("/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
    });
    expect(logout.status).toBe(403);

    const write = await app.request("/api/v1/ingredients", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(write.status).toBe(403);
  });

  it("ignores spoofed forwarding headers", async () => {
    const { app } = passwordApp();

    const spoofedHost = await login(app, PASSWORD, {
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
    });
    expect(spoofedHost.status).toBe(403);

    const httpsOrigin = await login(app, PASSWORD, {
      origin: "https://localhost",
      "x-forwarded-proto": "https",
    });
    expect(httpsOrigin.status).toBe(204);
  });

  it("accepts https origins only for non-loopback hosts", async () => {
    const { app } = passwordApp();

    const plainHttp = await loginAt(app, "http://pantry.example/auth/login", PASSWORD, {
      origin: "http://pantry.example",
    });
    expect(plainHttp.status).toBe(403);

    const secure = await loginAt(app, "https://pantry.example/auth/login", PASSWORD, {
      origin: "https://pantry.example",
    });
    expect(secure.status).toBe(204);

    const localhost = await loginAt(app, "http://127.0.0.1:5173/auth/login", PASSWORD, {
      origin: "http://127.0.0.1:5173",
    });
    expect(localhost.status).toBe(204);
  });

  it("bounds the login request body", async () => {
    const { app } = passwordApp();
    const response = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ password: "x".repeat(5000) }),
    });
    expect(response.status).toBe(413);
  });

  it("requires JSON for login", async () => {
    const { app } = passwordApp();
    const response = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: "password=correct%20horse%20battery%20staple",
    });
    expect(response.status).toBe(415);
  });

  it("blocks cookie-authenticated unsafe API requests from another origin", async () => {
    const { app } = passwordApp();
    const cookie = await loggedInCookie(app);

    const cross = await app.request("/api/v1/ingredients", {
      method: "POST",
      headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ name: "evil" }),
    });
    expect(cross.status).toBe(403);

    const sameOrigin = await app.request("/api/v1/ingredients", {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(sameOrigin.status).not.toBe(403);
  });

  it("allows cookie-authenticated reads without an Origin header", async () => {
    const { app } = passwordApp();
    const cookie = await loggedInCookie(app);
    expect((await get(app, "/api/v1/household", cookie)).status).toBe(200);
  });
});

describe("login throttling", () => {
  it("answers 429 with Retry-After after repeated failures", async () => {
    const { app } = passwordApp();

    let throttled: Response | undefined;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const response = await login(app, `wrong-${attempt}`);
      if (response.status === 429) {
        throttled = response;
        break;
      }
      expect(response.status).toBe(401);
    }

    expect(throttled).toBeDefined();
    expect(Number(throttled?.headers.get("retry-after"))).toBeGreaterThan(0);
    await expect(throttled?.json()).resolves.toMatchObject({ error: { code: "rate_limited" } });

    // The throttle must not be bypassed by guessing the right password.
    expect((await login(app, PASSWORD)).status).toBe(429);
  });

  it("does not throttle a correct login before any failure", async () => {
    const { app } = passwordApp();
    expect((await login(app, PASSWORD)).status).toBe(204);
  });
});

describe("bearer coexistence and trust override", () => {
  it("keeps bearer tokens working in password mode", async () => {
    const { app, token, household } = passwordApp();

    const response = await app.request("/api/v1/household", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: household.id });
  });

  it("gives a sent (invalid) bearer token precedence over a valid cookie", async () => {
    const { app } = passwordApp();
    const cookie = await loggedInCookie(app);

    const response = await app.request("/api/v1/household", {
      headers: { authorization: "Bearer nope", cookie },
    });
    expect(response.status).toBe(401);
  });

  it("ignores trustNetwork while password mode is on", async () => {
    const { app, household } = passwordApp({ trustNetwork: true });

    expect((await get(app, "/api/v1/household")).status).toBe(401);

    const cookie = await loggedInCookie(app);
    const response = await get(app, "/api/v1/household", cookie);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: household.id });
  });

  it("never accepts a session cookie on /mcp", async () => {
    const { app } = passwordApp();
    const cookie = await loggedInCookie(app);

    const response = await app.request("/mcp", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  it("answers 503 for a valid session when no household exists", async () => {
    const { app, db } = passwordApp();
    const cookie = await loggedInCookie(app);
    db.delete(households).run();

    const response = await get(app, "/api/v1/household", cookie);
    expect(response.status).toBe(503);
  });
});

describe("password configuration", () => {
  it("disables browser login when no password is configured", async () => {
    const context = makeTestCtx();
    const app = createApp({ db: context.db, now: context.ctx.now });

    const session = await app.request("/auth/session");
    await expect(session.json()).resolves.toEqual({ enabled: false, authenticated: false });
    expect((await login(app, "anything")).status).toBe(404);
    expect((await get(app, "/api/v1/household")).status).toBe(401);
  });

  it("throws before the server binds when PANTRYPAL_REQUIRE_PASSWORD is on", () => {
    const context = makeTestCtx();
    expect(() =>
      createApp({ db: context.db, now: context.ctx.now, requirePassword: true }),
    ).toThrow(/PANTRYPAL_PASSWORD/);
  });
});
