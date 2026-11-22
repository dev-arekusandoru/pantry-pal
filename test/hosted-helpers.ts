import { createHmac } from "node:crypto";
import { Billing } from "../src/billing/service.js";
import type { PolarConfig } from "../src/config.js";
import type { Email, Mailer } from "../src/email/mailer.js";
import type { Hosted } from "../src/hosted.js";
import { makeAuthApp, sessionCookie, type AuthTestApp } from "./helpers.js";

export const ORIGIN = "http://localhost";
export const PUBLIC_URL = "https://app.rakumi.test";
export const PASSWORD = "correct horse battery candle";
export const DAY_MS = 24 * 60 * 60 * 1000;

/** In-memory mailer: records every email instead of sending it. */
export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  failing = false;

  async send(email: Email): Promise<void> {
    if (this.failing) throw new Error("smtp down");
    this.sent.push(email);
  }

  to(address: string): Email[] {
    return this.sent.filter((email) => email.to === address);
  }
}

/** The `token=` value of the first link in an email's text part. */
export function tokenFrom(email: Email | undefined): string {
  const match = /[?&]token=([^\s&]+)/.exec(email?.text ?? "");
  if (!match) throw new Error("no token link in email");
  return decodeURIComponent(match[1]!);
}

export const POLAR_CONFIG: PolarConfig = {
  server: "sandbox",
  accessToken: "polar_oat_test_token",
  // Standard Webhooks secret: whsec_ + base64 key bytes.
  webhookSecret: `whsec_${Buffer.from("standard-webhooks-test-key-bytes").toString("base64")}`,
  productMonthly: "prod-month",
  productYearly: "prod-year",
};

export interface FakePolarCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

export interface FakePolar {
  fetch: typeof fetch;
  calls: FakePolarCall[];
  /** Subscription objects (Polar shape) the list endpoint returns for their `customer.external_id`. */
  subscriptions: Record<string, unknown>[];
  /** Make every request answer this status. */
  failWith: number | null;
}

const PRICES: Record<string, { amount: number; currency: string }> = {
  "prod-month": { amount: 399, currency: "usd" },
  "prod-year": { amount: 3900, currency: "usd" },
};

/** Injected `fetch` that answers like the Polar API, enough for the billing code. */
export function makeFakePolar(): FakePolar {
  const polar: FakePolar = {
    calls: [],
    subscriptions: [],
    failWith: null,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      polar.calls.push({ method, url: url.toString(), headers: init?.headers as Record<string, string>, body });
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
      if (polar.failWith !== null) return json({ detail: "boom" }, polar.failWith);

      const path = url.pathname.replace(/^\/v1/, "");
      if (method === "GET" && path.startsWith("/products/")) {
        const price = PRICES[decodeURIComponent(path.slice("/products/".length))];
        if (!price) return json({ detail: "not found" }, 404);
        return json({
          prices: [
            { amount_type: "fixed", is_archived: false, price_amount: price.amount, price_currency: price.currency },
          ],
        });
      }
      if (method === "POST" && path === "/checkouts/") {
        return json({ id: "chk_1", url: "https://sandbox.polar.test/checkout/chk_1" }, 201);
      }
      if (method === "POST" && path === "/customer-sessions/") {
        return json({ customer_portal_url: "https://sandbox.polar.test/portal/abc" }, 201);
      }
      if (method === "GET" && path === "/subscriptions/") {
        const external = url.searchParams.get("external_customer_id");
        const items = polar.subscriptions.filter(
          (s) => (s.customer as { external_id?: string } | undefined)?.external_id === external,
        );
        return json({ items, pagination: { total_count: items.length, max_page: items.length === 0 ? 0 : 1 } });
      }
      if (method === "DELETE" && (/^\/customers\/[^/]+$/.test(path) || /^\/customers\/external\/[^/]+$/.test(path))) {
        return new Response(null, { status: 204 });
      }
      return json({ detail: "unexpected" }, 500);
    }) as typeof fetch,
  };
  return polar;
}

/** A Polar subscription object as the API and webhooks send it. */
export function polarSubscription(
  householdId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "sub_1",
    created_at: "2026-11-01T12:00:00.000000Z",
    modified_at: "2026-11-01T12:00:00.000000Z",
    status: "trialing",
    recurring_interval: "month",
    current_period_start: "2026-11-01T12:00:00.000000Z",
    current_period_end: "2026-12-01T12:00:00.000000Z",
    trial_start: "2026-11-01T12:00:00.000000Z",
    trial_end: "2026-11-15T12:00:00.000000Z",
    cancel_at_period_end: false,
    ends_at: null,
    customer_id: "cus_1",
    product_id: "prod-month",
    customer: { id: "cus_1", external_id: householdId },
    ...overrides,
  };
}

/**
 * Sign a webhook body. `standard` = Standard Webhooks (key = base64-decoded part after
 * `whsec_`); `polar` = Polar's original HMAC (key = UTF-8 bytes of the whole secret).
 */
export function signWebhook(
  body: string,
  options: { id: string; timestamp: number; secret?: string; scheme?: "standard" | "polar" },
): Record<string, string> {
  const secret = options.secret ?? POLAR_CONFIG.webhookSecret;
  const key =
    (options.scheme ?? "standard") === "standard"
      ? Buffer.from(secret.slice("whsec_".length), "base64")
      : Buffer.from(secret, "utf8");
  const signature = createHmac("sha256", key)
    .update(`${options.id}.${options.timestamp}.${body}`)
    .digest("base64");
  return {
    "webhook-id": options.id,
    "webhook-timestamp": String(options.timestamp),
    "webhook-signature": `v1,${signature}`,
    "content-type": "application/json",
  };
}

export interface HostedTestApp extends AuthTestApp {
  mailer: MemoryMailer;
  polar: FakePolar;
  hosted: Hosted;
  billing: Billing | null;
  setNow(date: Date): void;
  /** Sign up through the API; returns the session cookie and household id. */
  signup(email?: string): Promise<{ cookie: string; householdId: string; email: string }>;
  /** POST a signed webhook event. */
  webhook(
    event: { type: string; data: Record<string, unknown> },
    overrides?: { id?: string; timestamp?: number; headers?: Record<string, string> },
  ): Promise<{ status: number }>;
}

let eventCounter = 0;

/** Hosted app with an in-memory mailer and a fake Polar. */
export function makeHostedApp(
  options: { now?: Date; email?: boolean; billing?: boolean } = {},
): HostedTestApp {
  let clock = options.now ?? new Date("2026-11-01T12:00:00.000Z");
  const now = () => clock;
  const mailer = new MemoryMailer();
  const polar = makeFakePolar();
  const emailOn = options.email ?? true;
  const billingOn = options.billing ?? true;
  const billing = billingOn
    ? new Billing({ config: POLAR_CONFIG, publicUrl: PUBLIC_URL, now, fetch: polar.fetch })
    : null;
  const hosted: Hosted = { publicUrl: PUBLIC_URL, mailer: emailOn ? mailer : null, billing };
  const app = makeAuthApp({ now, hosted });

  async function signup(email = "cook@example.com") {
    const response = await app.request<{ household: { id: string } }>("POST", "/auth/signup", {
      body: { email, password: PASSWORD, householdName: "Test Kitchen" },
      headers: { origin: ORIGIN },
    });
    if (response.status !== 201) throw new Error(`signup failed: ${response.status}`);
    return { cookie: sessionCookie(response), householdId: response.body.household.id, email };
  }

  async function webhook(
    event: { type: string; data: Record<string, unknown> },
    overrides: { id?: string; timestamp?: number; headers?: Record<string, string> } = {},
  ) {
    const body = JSON.stringify({ ...event, timestamp: clock.toISOString(), api_version: "2026-10" });
    eventCounter += 1;
    const headers = signWebhook(body, {
      id: overrides.id ?? `evt_${eventCounter}`,
      timestamp: overrides.timestamp ?? Math.floor(clock.getTime() / 1000),
    });
    const response = await app.app.request("/billing/webhook", {
      method: "POST",
      headers: { ...headers, ...overrides.headers },
      body,
    });
    return { status: response.status };
  }

  return {
    ...app,
    mailer,
    polar,
    hosted,
    billing,
    setNow: (date) => {
      clock = date;
    },
    signup,
    webhook,
  };
}
