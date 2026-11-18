import { describe, expect, it } from "vitest";
import { resetPassword } from "../src/auth/accounts.js";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "../src/auth/session.js";
import { households } from "../src/db/schema.js";
import { makeAuthApp, sessionCookie, type AppResponse, type AuthTestApp } from "./helpers.js";

const PASSWORD = "correct horse battery candle";
const ORIGIN = "http://localhost";
const DAY_MS = 24 * 60 * 60 * 1000;

const credentials = {
  email: "cook@example.com",
  password: PASSWORD,
  householdName: "Test Kitchen",
};

interface SessionBody {
  account: { email: string };
  household: { id: string; name: string };
}

function signup(app: AuthTestApp, overrides: Record<string, unknown> = {}) {
  return app.request<SessionBody>("POST", "/auth/signup", {
    body: { ...credentials, ...overrides },
    headers: { origin: ORIGIN },
  });
}

function login(app: AuthTestApp, email: string, password: string) {
  return app.request("POST", "/auth/login", {
    body: { email, password },
    headers: { origin: ORIGIN },
  });
}

async function signedUp(app: AuthTestApp, overrides: Record<string, unknown> = {}) {
  const response = await signup(app, overrides);
  expect(response.status).toBe(201);
  return { cookie: sessionCookie(response), body: response.body };
}

describe("signup", () => {
  it("creates an account and household, signs in and returns the household", async () => {
    const app = makeAuthApp();
    const response = await signup(app);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      account: { email: credentials.email },
      household: { id: expect.stringMatching(/^hh_/), name: "Test Kitchen" },
    });

    const cookie = sessionCookie(response);

    const current = await app.request<{
      authenticated: boolean;
      account: { email: string };
      household: { id: string; name: string };
    }>("GET", "/auth/session", { cookie });
    expect(current.status).toBe(200);
    expect(current.headers.get("cache-control")).toBe("no-store");
    expect(current.body).toMatchObject({
      authenticated: true,
      account: { email: credentials.email },
      household: { name: "Test Kitchen" },
    });

    const household = await app.request<{ id: string }>("GET", "/api/v1/household", { cookie });
    expect(household.status).toBe(200);
    expect(household.body.id).toBe(response.body.household.id);
  });

  it("sets a 30-day Secure HttpOnly SameSite=Lax cookie", async () => {
    const app = makeAuthApp();
    const response = await signup(app);
    const raw = response.headers.get("set-cookie") ?? "";

    expect(raw).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(raw).toMatch(/;\s*HttpOnly/i);
    expect(raw).toMatch(/;\s*SameSite=Lax/i);
    expect(raw).toMatch(/;\s*Path=\/(?:;|$)/i);
    expect(raw).toMatch(new RegExp(`;\\s*Max-Age=${SESSION_TTL_SECONDS}(?:;|$)`, "i"));
    expect(raw).toMatch(/;\s*Secure/i);
  });

  it("marks the cookie Secure for a non-loopback host", async () => {
    const app = makeAuthApp();
    const response = await app.app.request("https://pantry.example/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://pantry.example" },
      body: JSON.stringify(credentials),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie") ?? "").toMatch(/;\s*Secure/i);
  });

  it("rejects a duplicate email, case-insensitively", async () => {
    const app = makeAuthApp();
    await signedUp(app);

    const duplicate = await signup(app, { email: "COOK@example.com" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ error: { code: "conflict" } });
  });

  it("reports a closed instance and refuses signup", async () => {
    const app = makeAuthApp({ signupOpen: false });

    const anonymous = await app.request("GET", "/auth/session");
    expect(anonymous.body).toEqual({ authenticated: false, signupOpen: false });

    const response = await signup(app);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "forbidden" } });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("validates email, password and household name", async () => {
    const app = makeAuthApp();
    for (const overrides of [
      { email: "not-an-email" },
      { password: "short" },
      { householdName: "   " },
    ]) {
      const response = await signup(app, overrides);
      expect(response.status, JSON.stringify(overrides)).toBe(400);
      expect(response.body).toMatchObject({ error: { code: "validation" } });
    }
  });

  it("bounds the request body", async () => {
    const app = makeAuthApp();
    const response = await app.request("POST", "/auth/signup", {
      body: { ...credentials, householdName: "x".repeat(9000) },
      headers: { origin: ORIGIN },
    });
    expect(response.status).toBe(413);
  });
});

describe("login", () => {
  it("signs in with the right password, ignoring email case", async () => {
    const app = makeAuthApp();
    const created = await signedUp(app);

    const response = await login(app, "COOK@example.com", PASSWORD);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      account: { email: credentials.email },
      household: created.body.household,
    });

    const cookie = sessionCookie(response);
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);
  });

  it("answers the same error for a wrong password and an unknown email", async () => {
    const app = makeAuthApp();
    await signedUp(app);

    const wrong = await login(app, credentials.email, "wrong password");
    const unknown = await login(app, "nobody@example.com", PASSWORD);

    for (const response of [wrong, unknown]) {
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: { code: "unauthorized" } });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(wrong.body).toEqual(unknown.body);
  });

  it("throttles repeated failures and does not let a correct guess through", async () => {
    const app = makeAuthApp();
    await signedUp(app);

    let throttled: AppResponse<unknown> | undefined;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const response = await login(app, credentials.email, `wrong-${attempt}`);
      if (response.status === 429) {
        throttled = response;
        break;
      }
      expect(response.status).toBe(401);
    }

    expect(throttled).toBeDefined();
    expect(Number(throttled?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(throttled?.body).toMatchObject({ error: { code: "rate_limited" } });
    expect((await login(app, credentials.email, PASSWORD)).status).toBe(429);
  });
});

describe("session lifecycle", () => {
  it("logout deletes the session and clears the cookie", async () => {
    const app = makeAuthApp();
    const { cookie } = await signedUp(app);

    const response = await app.request("POST", "/auth/logout", {
      cookie,
      headers: { origin: ORIGIN },
    });
    expect(response.status).toBe(204);

    const raw = response.headers.get("set-cookie") ?? "";
    expect(raw).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(raw).toMatch(/;\s*Max-Age=0(?:;|$)/i);

    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(401);
    expect((await app.request("GET", "/auth/session", { cookie })).body).toEqual({
      authenticated: false,
      signupOpen: true,
    });
  });

  it("rejects an expired session", async () => {
    let clock = new Date("2026-11-01T12:00:00.000Z");
    const app = makeAuthApp({ now: () => clock });
    const { cookie } = await signedUp(app);

    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);

    clock = new Date(clock.getTime() + 31 * DAY_MS);
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(401);
    expect((await app.request("GET", "/auth/session", { cookie })).body).toMatchObject({
      authenticated: false,
    });
  });

  it("ends every session when the password is reset", async () => {
    const app = makeAuthApp();
    const { cookie } = await signedUp(app);

    resetPassword(app.db, credentials.email, "a brand new password");

    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(401);
    expect((await login(app, credentials.email, PASSWORD)).status).toBe(401);
    expect((await login(app, credentials.email, "a brand new password")).status).toBe(200);
  });

  it("answers 401 when the account's household is gone", async () => {
    const app = makeAuthApp();
    const { cookie } = await signedUp(app);
    app.db.delete(households).run();

    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(401);
  });
});

describe("CSRF protection", () => {
  it("blocks cross-origin signup, login and logout", async () => {
    const app = makeAuthApp();
    const { cookie } = await signedUp(app);

    const crossSignup = await app.request("POST", "/auth/signup", {
      body: { ...credentials, email: "other@example.com" },
      headers: { origin: "https://evil.example" },
    });
    expect(crossSignup.status).toBe(403);
    expect(crossSignup.headers.get("set-cookie")).toBeNull();

    const crossLogin = await app.request("POST", "/auth/login", {
      body: { email: credentials.email, password: PASSWORD },
      headers: { origin: "https://evil.example" },
    });
    expect(crossLogin.status).toBe(403);

    const crossLogout = await app.request("POST", "/auth/logout", {
      cookie,
      headers: { origin: "https://evil.example" },
    });
    expect(crossLogout.status).toBe(403);
  });

  it("requires an Origin header", async () => {
    const app = makeAuthApp();

    expect(
      (await app.request("POST", "/auth/signup", { body: credentials })).status,
    ).toBe(403);
    expect(
      (
        await app.request("POST", "/auth/login", {
          body: { email: credentials.email, password: PASSWORD },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("POST", "/auth/signup", {
          body: credentials,
          headers: { origin: ORIGIN, "sec-fetch-site": "cross-site" },
        })
      ).status,
    ).toBe(403);
  });

  it("blocks cookie-authenticated unsafe API requests from another origin", async () => {
    const app = makeAuthApp();
    const { cookie } = await signedUp(app);

    const cross = await app.request("POST", "/api/v1/ingredients", {
      body: { name: "evil" },
      cookie,
      headers: { origin: "https://evil.example" },
    });
    expect(cross.status).toBe(403);

    const sameOrigin = await app.request("POST", "/api/v1/ingredients", {
      body: {},
      cookie,
      headers: { origin: ORIGIN },
    });
    expect(sameOrigin.status).not.toBe(403);
  });

  it("allows cookie reads without an Origin header", async () => {
    const app = makeAuthApp();
    const { cookie } = await signedUp(app);
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);
  });
});

describe("bearer and cookie coexistence", () => {
  it("gives a sent (invalid) bearer token precedence over a valid cookie", async () => {
    const app = makeAuthApp();
    const { cookie } = await signedUp(app);

    const response = await app.request("GET", "/api/v1/household", {
      cookie,
      token: "nope",
    });
    expect(response.status).toBe(401);
  });

  it("never accepts a session cookie on /mcp", async () => {
    const app = makeAuthApp();
    const { cookie } = await signedUp(app);

    const response = await app.request("POST", "/mcp", {
      cookie,
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.status).toBe(401);
  });
});
