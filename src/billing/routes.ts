import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { crossOriginBlock, noStore, notFound, rateLimited, readJson, validation } from "../auth/http.js";
import type { AppEnv } from "../auth/middleware.js";
import { clientAddress } from "../auth/middleware.js";
import { resolveSession, SESSION_COOKIE_NAME, type SessionInfo } from "../auth/session.js";
import { Throttle } from "../auth/throttle.js";
import type { Db } from "../db/client.js";
import type { Hosted } from "../hosted.js";
import type { Billing } from "./service.js";
import { WebhookVerificationError } from "./webhook.js";

export interface BillingRouteOptions {
  db: Db;
  now: () => Date;
  hosted: Hosted;
}

/**
 * Billing endpoints (`/billing/*`). They answer 404 `not_found` when billing is
 * off, need the session cookie (never a token) and are never gated by access.
 * The webhook is public and authenticated by its signature alone.
 */
export function registerBillingRoutes(app: OpenAPIHono<AppEnv>, options: BillingRouteOptions): void {
  const { db, now, hosted } = options;
  const throttle = new Throttle();
  const billing: Billing | null = hosted.billing;

  app.use(
    "/billing/webhook",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: { code: "validation" as const, message: "Request body too large" } }, 413),
    }),
  );
  for (const path of ["/billing/checkout", "/billing/portal", "/billing/sync"]) {
    app.use(
      path,
      bodyLimit({
        maxSize: 8192,
        onError: (c) => c.json({ error: { code: "validation" as const, message: "Request body too large" } }, 413),
      }),
    );
  }

  /** Common checks for the session routes; returns a response to stop, else the session. */
  function guard(c: Context<AppEnv>): { response: Response } | { session: SessionInfo; billing: Billing } {
    noStore(c);
    if (billing === null) return { response: notFound(c) };
    const blocked = crossOriginBlock(c);
    if (blocked) return { response: blocked };
    const value = getCookie(c, SESSION_COOKIE_NAME);
    const session = value === undefined ? null : resolveSession(db, value, now());
    if (session === null) {
      return { response: c.json({ error: { code: "unauthorized" as const, message: "Sign in first" } }, 401) };
    }
    // One shared limit per account keeps a signed-in user from exhausting the Polar API quota.
    const key = `billing:${session.account.id}:${clientAddress(c)}`;
    const retryAfter = throttle.retryAfterSeconds(key);
    if (retryAfter !== null) return { response: rateLimited(c, retryAfter) };
    throttle.record(key);
    return { session, billing };
  }

  app.post("/billing/checkout", async (c) => {
    const checked = guard(c);
    if ("response" in checked) return checked.response;
    const body = await readJson(c);
    if (body === null) return validation(c, "Expected a JSON object");
    const interval = body.interval;
    if (interval !== "month" && interval !== "year") return validation(c, 'interval must be "month" or "year"');
    const result = await checked.billing.checkout(
      db,
      checked.session.household.id,
      checked.session.account.email,
      interval,
    );
    return c.json({ url: result.url }, 200);
  });

  app.post("/billing/portal", async (c) => {
    const checked = guard(c);
    if ("response" in checked) return checked.response;
    const result = await checked.billing.portal(db, checked.session.household.id);
    return c.json({ url: result.url }, 200);
  });

  app.post("/billing/sync", async (c) => {
    const checked = guard(c);
    if ("response" in checked) return checked.response;
    await checked.billing.sync(db, checked.session.household.id);
    return c.body(null, 204);
  });

  app.post("/billing/webhook", async (c) => {
    if (billing === null) return notFound(c);
    const rawBody = await c.req.text();
    try {
      billing.handleWebhook(db, rawBody, {
        id: c.req.header("webhook-id"),
        timestamp: c.req.header("webhook-timestamp"),
        signature: c.req.header("webhook-signature"),
      });
    } catch (error) {
      if (error instanceof WebhookVerificationError) return c.body(null, 403);
      throw error;
    }
    return c.body(null, 202);
  });
}
