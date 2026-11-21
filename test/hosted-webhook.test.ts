import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { billingEvents, householdBilling, subscriptions } from "../src/db/schema.js";
import { WEBHOOK_TOLERANCE_SECONDS } from "../src/billing/webhook.js";
import {
  makeHostedApp,
  polarSubscription,
  signWebhook,
  POLAR_CONFIG,
  type HostedTestApp,
} from "./hosted-helpers.js";

function rows(app: HostedTestApp, householdId: string) {
  return app.db.select().from(subscriptions).where(eq(subscriptions.householdId, householdId)).all();
}

async function postRaw(app: HostedTestApp, body: string, headers: Record<string, string>) {
  const response = await app.app.request("/billing/webhook", { method: "POST", headers, body });
  return response.status;
}

describe("webhook signature", () => {
  it("accepts a Standard Webhooks signature and stores the subscription", async () => {
    const app = makeHostedApp();
    const { householdId } = await app.signup();

    const result = await app.webhook({ type: "subscription.created", data: polarSubscription(householdId) });

    expect(result.status).toBe(202);
    expect(rows(app, householdId)).toMatchObject([
      { id: "sub_1", status: "trialing", interval: "month", cancelAtPeriodEnd: false },
    ]);
    const billing = app.db.select().from(householdBilling).where(eq(householdBilling.householdId, householdId)).get();
    expect(billing).toMatchObject({ polarCustomerId: "cus_1", lockedAt: null });
  });

  it("accepts the older Polar HMAC scheme (key = bytes of the whole secret)", async () => {
    const app = makeHostedApp();
    const { householdId } = await app.signup();
    const body = JSON.stringify({ type: "subscription.created", data: polarSubscription(householdId) });
    const timestamp = Math.floor(app.now().getTime() / 1000);

    const status = await postRaw(app, body, signWebhook(body, { id: "evt_legacy", timestamp, scheme: "polar" }));

    expect(status).toBe(202);
    expect(rows(app, householdId)).toHaveLength(1);
  });

  it("rejects a wrong secret with 403 and changes nothing", async () => {
    const app = makeHostedApp();
    const { householdId } = await app.signup();
    const body = JSON.stringify({ type: "subscription.created", data: polarSubscription(householdId) });
    const timestamp = Math.floor(app.now().getTime() / 1000);
    const wrong = `whsec_${Buffer.from("some-other-secret").toString("base64")}`;

    const status = await postRaw(app, body, signWebhook(body, { id: "evt_bad", timestamp, secret: wrong }));

    expect(status).toBe(403);
    expect(rows(app, householdId)).toHaveLength(0);
    expect(app.db.select().from(billingEvents).all()).toHaveLength(0);
  });

  it("rejects a body changed after signing", async () => {
    const app = makeHostedApp();
    const { householdId } = await app.signup();
    const body = JSON.stringify({ type: "subscription.created", data: polarSubscription(householdId) });
    const timestamp = Math.floor(app.now().getTime() / 1000);
    const headers = signWebhook(body, { id: "evt_tamper", timestamp });

    expect(await postRaw(app, body.replace("trialing", "active"), headers)).toBe(403);
    expect(rows(app, householdId)).toHaveLength(0);
  });

  it("rejects missing signature headers", async () => {
    const app = makeHostedApp();
    expect(await postRaw(app, "{}", { "content-type": "application/json" })).toBe(403);
  });

  it("rejects a stale or future timestamp even with a valid signature", async () => {
    const app = makeHostedApp();
    const { householdId } = await app.signup();
    const nowSeconds = Math.floor(app.now().getTime() / 1000);
    const event = { type: "subscription.created", data: polarSubscription(householdId) };

    const stale = await app.webhook(event, { timestamp: nowSeconds - WEBHOOK_TOLERANCE_SECONDS - 1 });
    const future = await app.webhook(event, { timestamp: nowSeconds + WEBHOOK_TOLERANCE_SECONDS + 1 });
    const edge = await app.webhook(event, { timestamp: nowSeconds - WEBHOOK_TOLERANCE_SECONDS + 5 });

    expect(stale.status).toBe(403);
    expect(future.status).toBe(403);
    expect(edge.status).toBe(202);
  });

  it("answers 404 when billing is off", async () => {
    const app = makeHostedApp({ billing: false });
    const body = "{}";
    const timestamp = Math.floor(app.now().getTime() / 1000);
    expect(await postRaw(app, body, signWebhook(body, { id: "e", timestamp, secret: POLAR_CONFIG.webhookSecret }))).toBe(404);
  });
});

describe("webhook handling", () => {
  it("ignores a duplicate event id", async () => {
    const app = makeHostedApp();
    const { householdId } = await app.signup();
    await app.webhook(
      { type: "subscription.active", data: polarSubscription(householdId, { status: "active" }) },
      { id: "evt_same" },
    );

    // Same id, different (newer) content: Polar redelivery must not be applied twice.
    const again = await app.webhook(
      {
        type: "subscription.revoked",
        data: polarSubscription(householdId, { status: "canceled", modified_at: "2026-11-02T00:00:00.000000Z" }),
      },
      { id: "evt_same" },
    );

    expect(again.status).toBe(202);
    expect(rows(app, householdId)[0]?.status).toBe("active");
    expect(app.db.select().from(billingEvents).all()).toHaveLength(1);
  });

  it("ignores an update older than the stored one (out of order)", async () => {
    const app = makeHostedApp();
    const { householdId } = await app.signup();
    await app.webhook({
      type: "subscription.revoked",
      data: polarSubscription(householdId, { status: "canceled", modified_at: "2026-11-05T10:00:00.000000Z" }),
    });

    await app.webhook({
      type: "subscription.active",
      data: polarSubscription(householdId, { status: "active", modified_at: "2026-11-05T09:00:00.000000Z" }),
    });

    expect(rows(app, householdId)[0]).toMatchObject({ status: "canceled" });
  });

  it("applies a newer update over an older one", async () => {
    const app = makeHostedApp();
    const { householdId } = await app.signup();
    await app.webhook({ type: "subscription.created", data: polarSubscription(householdId) });
    await app.webhook({
      type: "subscription.active",
      data: polarSubscription(householdId, { status: "active", modified_at: "2026-11-15T12:00:00.000000Z" }),
    });
    expect(rows(app, householdId)[0]).toMatchObject({ status: "active" });
  });

  it("acknowledges events for an unknown household without storing them", async () => {
    const app = makeHostedApp();
    const result = await app.webhook({ type: "subscription.created", data: polarSubscription("hh_missing") });
    expect(result.status).toBe(202);
    expect(app.db.select().from(subscriptions).all()).toHaveLength(0);
  });

  it("acknowledges other event types without storing anything", async () => {
    const app = makeHostedApp();
    const result = await app.webhook({ type: "order.created", data: {} });
    expect(result.status).toBe(202);
    expect(app.db.select().from(billingEvents).all()).toHaveLength(0);
  });

  it("locks when access is lost and unlocks when it returns", async () => {
    const app = makeHostedApp();
    const { householdId } = await app.signup();
    const lockedAt = () =>
      app.db.select().from(householdBilling).where(eq(householdBilling.householdId, householdId)).get()?.lockedAt;
    expect(lockedAt()).toBe(app.now().toISOString());

    await app.webhook({ type: "subscription.created", data: polarSubscription(householdId) });
    expect(lockedAt()).toBeNull();

    app.setNow(new Date("2026-11-20T00:00:00.000Z"));
    await app.webhook({
      type: "subscription.past_due",
      data: polarSubscription(householdId, { status: "past_due", modified_at: "2026-11-20T00:00:00.000000Z" }),
    });
    expect(lockedAt()).toBe("2026-11-20T00:00:00.000Z");

    app.setNow(new Date("2026-11-21T00:00:00.000Z"));
    await app.webhook({
      type: "subscription.active",
      data: polarSubscription(householdId, { status: "active", modified_at: "2026-11-21T00:00:00.000000Z" }),
    });
    expect(lockedAt()).toBeNull();
  });
});
