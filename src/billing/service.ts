import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { billingEvents, households } from "../db/schema.js";
import type { PolarConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import {
  createPolarClient,
  parsePolarSubscription,
  PolarApiError,
  type PolarClient,
  type PolarPrice,
} from "./polar.js";
import {
  DAY_MS,
  getBillingRow,
  isEntitled,
  refreshLock,
  summarizeBilling,
  upsertSubscription,
  type BillingSummary,
} from "./state.js";
import { verifyWebhookSignature, type WebhookHeaders } from "./webhook.js";

export type Interval = "month" | "year";
export interface Plan {
  interval: Interval;
  price: string;
}

const PLANS_TTL_MS = 10 * 60_000;
const PLANS_RETRY_MS = 30_000;
const EVENT_RETENTION_DAYS = 30;

/** `$3.99`, `$39`: whole amounts drop the cents. */
export function formatPrice(price: PolarPrice): string {
  const whole = price.amount % 100 === 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: price.currency.toUpperCase(),
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(price.amount / 100);
  } catch {
    return `${(price.amount / 100).toFixed(whole ? 0 : 2)} ${price.currency.toUpperCase()}`;
  }
}

export interface BillingOptions {
  config: PolarConfig;
  publicUrl: string;
  now?: () => Date;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Replaces the whole Polar client (tests that do not need HTTP). */
  client?: PolarClient;
}

export type WebhookOutcome = "applied" | "ignored" | "duplicate";

/** Polar billing: checkout, portal, sync, webhook handling and cached plan prices. */
export class Billing {
  readonly publicUrl: string;
  private readonly config: PolarConfig;
  private readonly polar: PolarClient;
  private readonly now: () => Date;
  private plansCache: { plans: Plan[]; at: number } | null = null;
  private plansRefresh: Promise<void> | null = null;
  private plansFailedAt = 0;

  constructor(options: BillingOptions) {
    this.config = options.config;
    this.publicUrl = options.publicUrl;
    this.now = options.now ?? (() => new Date());
    this.polar = options.client ?? createPolarClient(options.config, options.fetch);
  }

  /** Prices of the monthly and yearly products, cached for 10 minutes. Stale data is served while it refreshes. */
  async plans(): Promise<Plan[]> {
    const cache = this.plansCache;
    const age = cache === null ? Infinity : Date.now() - cache.at;
    if (cache !== null && age < PLANS_TTL_MS) return cache.plans;
    if (cache === null && Date.now() - this.plansFailedAt < PLANS_RETRY_MS) return [];
    const refresh = this.refreshPlans();
    if (cache !== null) return cache.plans;
    await refresh;
    return this.plansCache?.plans ?? [];
  }

  private refreshPlans(): Promise<void> {
    this.plansRefresh ??= (async () => {
      try {
        const [monthly, yearly] = await Promise.all([
          this.polar.getProductPrice(this.config.productMonthly),
          this.polar.getProductPrice(this.config.productYearly),
        ]);
        const plans: Plan[] = [];
        if (monthly !== null) plans.push({ interval: "month", price: formatPrice(monthly) });
        if (yearly !== null) plans.push({ interval: "year", price: formatPrice(yearly) });
        this.plansCache = { plans, at: Date.now() };
      } catch (error) {
        this.plansFailedAt = Date.now();
        console.error("[pantrypal] could not read Polar plan prices:", error instanceof Error ? error.message : error);
      } finally {
        this.plansRefresh = null;
      }
    })();
    return this.plansRefresh;
  }

  async summary(db: Db, householdId: string): Promise<BillingSummary & { plans: Plan[] }> {
    const plans = await this.plans();
    return { ...summarizeBilling(db, householdId, this.now()), plans };
  }

  /** Create a Polar checkout. 409 when the household already has access. */
  async checkout(db: Db, householdId: string, email: string, interval: Interval): Promise<{ url: string }> {
    if (isEntitled(db, householdId, this.now())) {
      throw new AppError("conflict", "This household already has a plan");
    }
    const productId = interval === "year" ? this.config.productYearly : this.config.productMonthly;
    return this.call(() =>
      this.polar.createCheckout({
        productId,
        externalCustomerId: householdId,
        customerEmail: email,
        successUrl: `${this.publicUrl}/?checkout={CHECKOUT_ID}`,
        returnUrl: `${this.publicUrl}/`,
      }),
    );
  }

  /** Create a customer portal session. 409 when the household has no Polar customer yet. */
  async portal(db: Db, householdId: string): Promise<{ url: string }> {
    const customerId = getBillingRow(db, householdId)?.polarCustomerId ?? null;
    if (customerId === null) throw new AppError("conflict", "This household has no billing account yet");
    return this.call(() => this.polar.createCustomerSession({ customerId, returnUrl: `${this.publicUrl}/` }));
  }

  /** Re-read the household's subscriptions from Polar and store them. */
  async sync(db: Db, householdId: string): Promise<void> {
    const remote = await this.call(() => this.polar.listSubscriptions(householdId));
    const now = this.now();
    db.transaction((tx) => {
      const handle = tx as unknown as Db;
      for (const subscription of remote) {
        // The customer was found by this household's external id, so the rows belong to it.
        upsertSubscription(handle, householdId, subscription, now);
      }
      refreshLock(handle, householdId, now);
    });
  }

  /**
   * Delete the household's Polar customer and anonymize its personal data. Uses the stored
   * customer id; without one it falls back to the external id (the household id), which
   * covers a checkout whose webhook never arrived. A customer Polar does not know counts
   * as deleted. Throws `PolarApiError` on any other failure, so the caller can retry.
   */
  async deleteCustomer(db: Db, householdId: string): Promise<void> {
    const customerId = getBillingRow(db, householdId)?.polarCustomerId ?? null;
    await this.polar.deleteCustomer(customerId === null ? { externalId: householdId } : { customerId });
  }

  /**
   * Verify and apply a webhook. Throws `WebhookVerificationError` on a bad or stale
   * signature. Duplicate event ids and out-of-order updates change nothing.
   */
  handleWebhook(db: Db, rawBody: string, headers: WebhookHeaders): WebhookOutcome {
    const now = this.now();
    verifyWebhookSignature(rawBody, headers, this.config.webhookSecret, now.getTime());
    const eventId = headers.id!;

    let event: { type?: unknown; data?: unknown };
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      return "ignored";
    }
    if (typeof event.type !== "string" || !event.type.startsWith("subscription.")) return "ignored";

    return db.transaction((tx) => {
      const handle = tx as unknown as Db;
      if (handle.select().from(billingEvents).where(eq(billingEvents.id, eventId)).get() !== undefined) {
        return "duplicate" as const;
      }
      const subscription = parsePolarSubscription(event.data);
      const householdId = subscription?.externalCustomerId ?? null;
      let outcome: WebhookOutcome = "ignored";
      if (
        subscription !== null &&
        householdId !== null &&
        handle.select().from(households).where(eq(households.id, householdId)).get() !== undefined
      ) {
        upsertSubscription(handle, householdId, subscription, now);
        refreshLock(handle, householdId, now);
        outcome = "applied";
      }
      handle.insert(billingEvents).values({ id: eventId, receivedAt: now.toISOString() }).run();
      return outcome;
    });
  }

  /** Forget webhook event ids older than the retention window. */
  pruneEvents(db: Db): void {
    const cutoff = new Date(this.now().getTime() - EVENT_RETENTION_DAYS * DAY_MS).toISOString();
    db.delete(billingEvents).where(lt(billingEvents.receivedAt, cutoff)).run();
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof PolarApiError) {
        console.error("[pantrypal]", error.message);
        throw new AppError("unavailable", "Billing is not available now. Try again soon.");
      }
      throw error;
    }
  }
}
