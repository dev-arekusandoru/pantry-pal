import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createToken } from "../src/auth/tokens.js";
import { markEmailVerified } from "../src/auth/accounts.js";
import { accounts, householdBilling } from "../src/db/schema.js";
import { setExempt } from "../src/billing/state.js";
import { makeAuthApp } from "./helpers.js";
import {
  DAY_MS,
  makeHostedApp,
  ORIGIN,
  polarSubscription,
  tokenFrom,
  type HostedTestApp,
} from "./hosted-helpers.js";

interface SessionBody {
  authenticated: boolean;
  account?: { email: string; emailVerified: boolean; verifyBy: string | null };
  features: { email: boolean; billing: boolean };
  access?: { status: string; reason?: string };
  billing: null | {
    status: string;
    interval: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    exempt: boolean;
    deleteAt: string | null;
    plans: Array<{ interval: string; price: string }>;
  };
}

const post = (app: HostedTestApp, path: string, cookie: string, body?: unknown) =>
  app.request("POST", path, { cookie, headers: { origin: ORIGIN }, ...(body === undefined ? {} : { body }) });

async function subscribe(
  app: HostedTestApp,
  householdId: string,
  overrides: Record<string, unknown>,
  type = "subscription.updated",
) {
  const result = await app.webhook({ type, data: polarSubscription(householdId, overrides) });
  expect(result.status).toBe(202);
}

describe("subscription status to access", () => {
  const cases: Array<[status: string, ok: boolean]> = [
    ["trialing", true],
    ["active", true],
    ["past_due", false],
    ["canceled", false],
    ["unpaid", false],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["paused", false],
    ["trial_ended", false],
  ];
  for (const [status, ok] of cases) {
    it(`${status} ${ok ? "grants" : "does not grant"} access`, async () => {
      const app = makeHostedApp({ email: true });
      const { cookie, householdId } = await app.signup();
      await subscribe(app, householdId, { status });

      const api = await app.request("GET", "/api/v1/household", { cookie });
      expect(api.status).toBe(ok ? 200 : 402);
      const session = await app.request<SessionBody>("GET", "/auth/session", { cookie });
      expect(session.body.access).toEqual(ok ? { status: "ok" } : { status: "locked", reason: "subscription_required" });
      expect(session.body.billing?.status).toBe(status);
    });
  }

  it("keeps access for active + cancel at period end until it ends", async () => {
    const app = makeHostedApp();
    const { cookie, householdId } = await app.signup();
    await subscribe(app, householdId, {
      status: "active",
      cancel_at_period_end: true,
      current_period_end: "2026-11-20T12:00:00.000000Z",
      ends_at: "2026-11-20T12:00:00.000000Z",
    });

    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);
    const before = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(before.body.billing).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: "2026-11-20T12:00:00.000Z",
    });

    // The period ended and the revoke webhook is late: access still stops on time.
    app.setNow(new Date("2026-11-20T12:00:01.000Z"));
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(402);

    // The revoke webhook then states the same.
    await subscribe(app, householdId, { status: "canceled", modified_at: "2026-11-20T12:00:02.000000Z" }, "subscription.revoked");
    const after = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(after.body.billing).toMatchObject({ status: "canceled", cancelAtPeriodEnd: false });
  });

  it("describes a trial in the session", async () => {
    const app = makeHostedApp();
    const { cookie, householdId } = await app.signup();
    await subscribe(app, householdId, { status: "trialing", recurring_interval: "year" });
    const session = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(session.body.billing).toMatchObject({
      status: "trialing",
      interval: "year",
      trialEndsAt: "2026-11-15T12:00:00.000Z",
      exempt: false,
      deleteAt: null,
    });
  });
});

describe("402 gate", () => {
  it("locks a new household under billing for sessions, tokens and MCP", async () => {
    const app = makeHostedApp();
    const { cookie, householdId } = await app.signup();
    const { token } = createToken(app.db, householdId, "t");
    const body = { error: { code: "subscription_required", message: expect.any(String) } };

    const session = await app.request("GET", "/api/v1/household", { cookie });
    expect(session.status).toBe(402);
    expect(session.body).toEqual(body);
    expect((await app.request("GET", "/api/v1/household", { token })).status).toBe(402);
    expect((await app.request("POST", "/mcp", { token, body: { jsonrpc: "2.0", id: 1, method: "ping" } })).status).toBe(402);
    expect((await app.request("GET", "/api/v1/recipes", { cookie })).status).toBe(402);
  });

  it("still answers 401 for requests without credentials", async () => {
    const app = makeHostedApp();
    expect((await app.request("GET", "/api/v1/household")).status).toBe(401);
    expect((await app.request("POST", "/mcp", { body: {} })).status).toBe(401);
  });

  it("opens API, token and MCP once a plan starts", async () => {
    const app = makeHostedApp();
    const { cookie, householdId } = await app.signup();
    const { token } = createToken(app.db, householdId, "t");
    await subscribe(app, householdId, { status: "trialing" }, "subscription.created");

    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);
    expect((await app.request("GET", "/api/v1/household", { token })).status).toBe(200);
    const mcp = await app.request("POST", "/mcp", {
      token,
      body: { jsonrpc: "2.0", id: 1, method: "ping" },
      headers: { accept: "application/json, text/event-stream" },
    });
    expect(mcp.status).not.toBe(402);
  });

  it("never gates /auth or /billing", async () => {
    const app = makeHostedApp();
    const { cookie } = await app.signup();
    expect((await app.request("GET", "/auth/session", { cookie })).status).toBe(200);
    expect((await post(app, "/billing/portal", cookie)).status).toBe(409);
    expect((await app.request("POST", "/auth/logout", { cookie, headers: { origin: ORIGIN } })).status).toBe(204);
  });

  it("does not lock an exempt household", async () => {
    const app = makeHostedApp();
    const { cookie, householdId } = await app.signup();
    setExempt(app.db, householdId, true, app.now());
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);
    const session = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(session.body.billing).toMatchObject({ exempt: true, deleteAt: null });
  });

  it("leaves a self-hosted instance (billing and email off) unaffected", async () => {
    const app = makeAuthApp();
    const signup = await app.request<{ household: { id: string } }>("POST", "/auth/signup", {
      body: { email: "a@b.co", password: "correct horse battery", householdName: "H" },
      headers: { origin: ORIGIN },
    });
    const cookie = signup.headers.get("set-cookie")!.split(";")[0]!;
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);

    // Far in the future: still open.
    const late = makeAuthApp({ now: new Date("2031-01-01T00:00:00.000Z") });
    const second = await late.request("POST", "/auth/signup", {
      body: { email: "c@d.co", password: "correct horse battery", householdName: "H" },
      headers: { origin: ORIGIN },
    });
    expect(second.status).toBe(201);
    const session = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(session.body).toMatchObject({
      features: { email: false, billing: false },
      access: { status: "ok" },
      billing: null,
      account: { emailVerified: true, verifyBy: null },
    });
    for (const path of ["/billing/checkout", "/billing/portal", "/billing/sync", "/billing/webhook"]) {
      expect((await app.request("POST", path, { cookie, headers: { origin: ORIGIN } })).status).toBe(404);
    }
  });
});

describe("email verification grace", () => {
  it("gives 7 days of access, then locks with email_unverified until verified", async () => {
    const app = makeHostedApp({ billing: false });
    const { cookie } = await app.signup();

    const first = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(first.body.account).toMatchObject({ emailVerified: false, verifyBy: "2026-11-08T12:00:00.000Z" });
    expect(first.body.billing).toBeNull();
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);

    app.setNow(new Date(Date.parse("2026-11-08T12:00:00.000Z") - 1000));
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);

    app.setNow(new Date("2026-11-08T12:00:00.000Z"));
    const locked = await app.request("GET", "/api/v1/household", { cookie });
    expect(locked.status).toBe(402);
    expect(locked.body).toEqual({ error: { code: "email_unverified", message: expect.any(String) } });
    const session = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(session.body.access).toEqual({ status: "locked", reason: "email_unverified" });

    // The signup link (valid 48 h) is expired; ask for a new one.
    expect((await post(app, "/auth/verify-email/send", cookie)).status).toBe(204);
    const link = tokenFrom(app.mailer.sent[1]);
    expect((await app.request("POST", "/auth/verify-email", { body: { token: link }, headers: { origin: ORIGIN } })).status).toBe(204);
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);
    const verified = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(verified.body.account).toMatchObject({ emailVerified: true, verifyBy: null });
  });

  it("reports email_unverified before subscription_required once the grace ends", async () => {
    const app = makeHostedApp();
    const { cookie } = await app.signup();
    const early = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(early.body.access).toEqual({ status: "locked", reason: "subscription_required" });
    app.setNow(new Date(app.now().getTime() + 8 * DAY_MS));
    const session = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(session.body.access).toEqual({ status: "locked", reason: "email_unverified" });
  });

  it("does not lock an account that was verified before email was turned on", async () => {
    const app = makeHostedApp({ billing: false });
    const { cookie } = await app.signup();
    const account = app.db.select().from(accounts).get()!;
    markEmailVerified(app.db, account.id, app.now());
    app.setNow(new Date(app.now().getTime() + 10 * DAY_MS));
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);
  });
});

describe("billing endpoints", () => {
  it("creates a checkout for the household with a pinned API version", async () => {
    const app = makeHostedApp();
    const { cookie, householdId, email } = await app.signup();

    const response = await post(app, "/billing/checkout", cookie, { interval: "year" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://sandbox.polar.test/checkout/chk_1" });
    const call = app.polar.calls.find((c) => c.method === "POST" && c.url.endsWith("/checkouts/"))!;
    expect(call.url.startsWith("https://sandbox-api.polar.sh/v1/")).toBe(true);
    expect(call.headers["Polar-Version"]).toBe("2026-10");
    expect(call.headers.Authorization).toBe("Bearer polar_oat_test_token");
    expect(call.body).toEqual({
      products: ["prod-year"],
      external_customer_id: householdId,
      customer_email: email,
      success_url: "https://app.rakumi.test/?checkout={CHECKOUT_ID}",
      return_url: "https://app.rakumi.test/",
    });
  });

  it("validates the interval and requires a session and same origin", async () => {
    const app = makeHostedApp();
    const { cookie } = await app.signup();
    expect((await post(app, "/billing/checkout", cookie, { interval: "week" })).status).toBe(400);
    expect((await app.request("POST", "/billing/checkout", { body: { interval: "month" }, headers: { origin: ORIGIN } })).status).toBe(401);
    expect((await app.request("POST", "/billing/checkout", { cookie, body: { interval: "month" }, headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("answers 409 for checkout when the household is already entitled", async () => {
    const app = makeHostedApp();
    const { cookie, householdId } = await app.signup();
    await subscribe(app, householdId, { status: "active" });
    const response = await post(app, "/billing/checkout", cookie, { interval: "month" });
    expect(response.status).toBe(409);
  });

  it("opens the customer portal once Polar knows the customer", async () => {
    const app = makeHostedApp();
    const { cookie, householdId } = await app.signup();
    expect((await post(app, "/billing/portal", cookie)).status).toBe(409);

    await subscribe(app, householdId, { status: "canceled" });
    const response = await post(app, "/billing/portal", cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ url: "https://sandbox.polar.test/portal/abc" });
    const call = app.polar.calls.find((c) => c.url.endsWith("/customer-sessions/"))!;
    expect(call.body).toEqual({ customer_id: "cus_1", return_url: "https://app.rakumi.test/" });
  });

  it("sync reads the subscriptions from Polar and unlocks the household", async () => {
    const app = makeHostedApp();
    const { cookie, householdId } = await app.signup();
    app.polar.subscriptions.push(polarSubscription(householdId, { status: "trialing" }));
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(402);

    const response = await post(app, "/billing/sync", cookie);

    expect(response.status).toBe(204);
    expect((await app.request("GET", "/api/v1/household", { cookie })).status).toBe(200);
    const call = app.polar.calls.find((c) => c.url.includes("/subscriptions/"))!;
    expect(new URL(call.url).searchParams.get("external_customer_id")).toBe(householdId);
    const lock = app.db.select().from(householdBilling).where(eq(householdBilling.householdId, householdId)).get();
    expect(lock?.lockedAt).toBeNull();
  });

  it("answers 503 when Polar fails", async () => {
    const app = makeHostedApp();
    const { cookie } = await app.signup();
    app.polar.failWith = 500;
    const response = await post(app, "/billing/sync", cookie);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("polar_oat");
  });

  it("lists plan prices from the Polar products", async () => {
    const app = makeHostedApp();
    const { cookie } = await app.signup();
    const session = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(session.body.billing?.plans).toEqual([
      { interval: "month", price: "$3.99" },
      { interval: "year", price: "$39" },
    ]);
    await app.request("GET", "/auth/session", { cookie });
    expect(app.polar.calls.filter((c) => c.url.includes("/products/"))).toHaveLength(2);
  });

  it("returns empty plans when Polar cannot be reached", async () => {
    const app = makeHostedApp();
    const { cookie } = await app.signup();
    app.polar.failWith = 500;
    const session = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(session.status).toBe(200);
    expect(session.body.billing?.plans).toEqual([]);
  });

  it("sets deleteAt to the lock start plus 30 days", async () => {
    const app = makeHostedApp();
    const { cookie } = await app.signup();
    const session = await app.request<SessionBody>("GET", "/auth/session", { cookie });
    expect(session.body.billing).toMatchObject({ status: "none", deleteAt: "2026-12-01T12:00:00.000Z" });
  });
});
