import { z } from "zod";
import type { PolarConfig } from "../config.js";

/** Polar API version pinned on every request (docs: "Pin a version in every production integration"). */
export const POLAR_API_VERSION = "2026-10";

const BASE_URLS = {
  production: "https://api.polar.sh/v1",
  sandbox: "https://sandbox-api.polar.sh/v1",
} as const;

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** The Polar API answered with an error or could not be reached. */
export class PolarApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "PolarApiError";
    this.status = status;
  }
}

const timestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "not a timestamp")
  .transform((value) => new Date(value).toISOString());

const subscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  recurring_interval: z.string().nullish(),
  current_period_end: timestamp.nullish(),
  trial_end: timestamp.nullish(),
  cancel_at_period_end: z.boolean().default(false),
  ends_at: timestamp.nullish(),
  created_at: timestamp,
  modified_at: timestamp.nullish(),
  customer_id: z.string().min(1),
  customer: z.object({ external_id: z.string().nullish() }).nullish(),
});

/** The fields of a Polar subscription this app uses. Timestamps are normalized ISO strings. */
export interface PolarSubscription {
  id: string;
  status: string;
  /** `month` or `year`; null for any other Polar interval. */
  interval: "month" | "year" | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  endsAt: string | null;
  /** `modified_at`, or `created_at` when Polar never modified the subscription. */
  modifiedAt: string;
  customerId: string;
  /** Our household id, set as the customer's external id at checkout. */
  externalCustomerId: string | null;
}

/** Parse a Polar subscription object; null when it lacks the fields we need. */
export function parsePolarSubscription(raw: unknown): PolarSubscription | null {
  const parsed = subscriptionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  const interval = s.recurring_interval === "month" || s.recurring_interval === "year" ? s.recurring_interval : null;
  return {
    id: s.id,
    status: s.status,
    interval,
    currentPeriodEnd: s.current_period_end ?? null,
    trialEnd: s.trial_end ?? null,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    endsAt: s.ends_at ?? null,
    modifiedAt: s.modified_at ?? s.created_at,
    customerId: s.customer_id,
    externalCustomerId: s.customer?.external_id ?? null,
  };
}

const productSchema = z.object({
  prices: z.array(
    z.object({
      amount_type: z.string().optional(),
      is_archived: z.boolean().optional(),
      price_amount: z.number().int().nonnegative().optional(),
      price_currency: z.string().optional(),
    }),
  ),
});

/** The one recurring fixed price of a product, in minor units (cents). */
export interface PolarPrice {
  amount: number;
  currency: string;
}

export interface CheckoutInput {
  productId: string;
  externalCustomerId: string;
  customerEmail: string;
  successUrl: string;
  returnUrl: string;
}

export interface PolarClient {
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  createCustomerSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** Every subscription of the customer with this external id, any status. */
  listSubscriptions(externalCustomerId: string): Promise<PolarSubscription[]>;
  /** The product's current fixed price, or null when it has none. */
  getProductPrice(productId: string): Promise<PolarPrice | null>;
  /**
   * Delete the customer and anonymize its personal data (Polar `DELETE /customers/{id}` or
   * `/customers/external/{external_id}`, `anonymize=true`). This also cancels active
   * subscriptions. A customer that does not exist (404) counts as deleted.
   */
  deleteCustomer(ref: { customerId: string } | { externalId: string }): Promise<void>;
}

export function createPolarClient(config: PolarConfig, fetchImpl: typeof fetch = fetch): PolarClient {
  const base = BASE_URLS[config.server];

  async function request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          Accept: "application/json",
          "Polar-Version": POLAR_API_VERSION,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PolarApiError(
        `Polar request failed: ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`,
        null,
      );
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new PolarApiError(`Polar returned ${response.status} for ${method} ${path}: ${detail}`, response.status);
    }
    return response.status === 204 ? null : response.json();
  }

  const urlOf = (raw: unknown, field: string): string => {
    const value = (raw as Record<string, unknown> | null)?.[field];
    if (typeof value !== "string" || value === "") {
      throw new PolarApiError(`Polar response has no ${field}`, null);
    }
    return value;
  };

  return {
    async createCheckout(input) {
      const raw = await request("POST", "/checkouts/", {
        products: [input.productId],
        external_customer_id: input.externalCustomerId,
        customer_email: input.customerEmail,
        success_url: input.successUrl,
        return_url: input.returnUrl,
      });
      return { url: urlOf(raw, "url") };
    },

    async createCustomerSession(input) {
      const raw = await request("POST", "/customer-sessions/", {
        customer_id: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: urlOf(raw, "customer_portal_url") };
    },

    async listSubscriptions(externalCustomerId) {
      const found: PolarSubscription[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const query = new URLSearchParams({
          external_customer_id: externalCustomerId,
          page: String(page),
          limit: String(PAGE_SIZE),
        });
        const raw = (await request("GET", `/subscriptions/?${query}`)) as {
          items?: unknown[];
          pagination?: { max_page?: number };
        };
        for (const item of raw.items ?? []) {
          const subscription = parsePolarSubscription(item);
          if (subscription !== null) found.push(subscription);
        }
        if (page >= (raw.pagination?.max_page ?? 0)) break;
      }
      return found;
    },

    async getProductPrice(productId) {
      const parsed = productSchema.safeParse(await request("GET", `/products/${encodeURIComponent(productId)}`));
      if (!parsed.success) throw new PolarApiError("Polar product response has an unexpected shape", null);
      const price = parsed.data.prices.find(
        (p) =>
          p.is_archived !== true &&
          (p.amount_type === undefined || p.amount_type === "fixed") &&
          p.price_amount !== undefined &&
          p.price_currency !== undefined,
      );
      return price === undefined ? null : { amount: price.price_amount!, currency: price.price_currency! };
    },

    async deleteCustomer(ref) {
      const path =
        "customerId" in ref
          ? `/customers/${encodeURIComponent(ref.customerId)}`
          : `/customers/external/${encodeURIComponent(ref.externalId)}`;
      try {
        await request("DELETE", `${path}?anonymize=true`);
      } catch (error) {
        if (error instanceof PolarApiError && error.status === 404) return;
        throw error;
      }
    },
  };
}
