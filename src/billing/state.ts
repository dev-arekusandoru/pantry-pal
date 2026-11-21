import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { householdBilling, subscriptions } from "../db/schema.js";
import type { PolarSubscription } from "./polar.js";

/** A household whose billing lock lasts this long is deleted. */
export const LOCK_DELETE_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type BillingRow = typeof householdBilling.$inferSelect;

/** Whether a stored subscription gives access at `now`: trialing or active, and not past its end. */
export function subscriptionGrantsAccess(row: SubscriptionRow, now: Date): boolean {
  if (row.status !== "trialing" && row.status !== "active") return false;
  // An `active` subscription that cancels at period end keeps access until `ends_at`.
  return row.endsAt === null || Date.parse(row.endsAt) > now.getTime();
}

export function getBillingRow(db: Db, householdId: string): BillingRow | undefined {
  return db.select().from(householdBilling).where(eq(householdBilling.householdId, householdId)).get();
}

export function ensureBillingRow(db: Db, householdId: string): BillingRow {
  db.insert(householdBilling).values({ householdId }).onConflictDoNothing().run();
  return getBillingRow(db, householdId)!;
}

export function listSubscriptions(db: Db, householdId: string): SubscriptionRow[] {
  return db.select().from(subscriptions).where(eq(subscriptions.householdId, householdId)).all();
}

/** Entitled = exempt, or any subscription that grants access. */
export function isEntitled(db: Db, householdId: string, now: Date): boolean {
  if (getBillingRow(db, householdId)?.exempt === true) return true;
  return listSubscriptions(db, householdId).some((row) => subscriptionGrantsAccess(row, now));
}

/**
 * Align `locked_at` with entitlement: set it (once) when access is missing, clear it
 * and the warning marks when access is back. Safe to call at any time.
 */
export function refreshLock(db: Db, householdId: string, now: Date): void {
  const row = ensureBillingRow(db, householdId);
  if (isEntitled(db, householdId, now)) {
    if (row.lockedAt !== null || row.warnedDay23At !== null || row.warnedDay29At !== null) {
      db.update(householdBilling)
        .set({ lockedAt: null, warnedDay23At: null, warnedDay29At: null, updatedAt: now.toISOString() })
        .where(eq(householdBilling.householdId, householdId))
        .run();
    }
    return;
  }
  if (row.lockedAt === null) {
    db.update(householdBilling)
      .set({ lockedAt: now.toISOString(), updatedAt: now.toISOString() })
      .where(eq(householdBilling.householdId, householdId))
      .run();
  }
}

/** Mark a household exempt (never locked, never deleted) or not. Turning it off does not start a lock; `refreshLock` does. */
export function setExempt(db: Db, householdId: string, exempt: boolean, now: Date): void {
  ensureBillingRow(db, householdId);
  db.update(householdBilling)
    .set({ exempt, updatedAt: now.toISOString() })
    .where(eq(householdBilling.householdId, householdId))
    .run();
}

export function recordPolarCustomer(db: Db, householdId: string, customerId: string): void {
  ensureBillingRow(db, householdId);
  db.update(householdBilling)
    .set({ polarCustomerId: customerId })
    .where(eq(householdBilling.householdId, householdId))
    .run();
}

/**
 * Store a Polar subscription for a household. An update older than the stored one
 * (by Polar `modified_at`) is ignored, so webhooks that arrive out of order cannot
 * undo newer state. Returns whether the row changed.
 */
export function upsertSubscription(
  db: Db,
  householdId: string,
  incoming: PolarSubscription,
  now: Date,
): boolean {
  const existing = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, incoming.id))
    .get();
  if (existing !== undefined) {
    if (existing.householdId !== householdId) return false;
    if (Date.parse(incoming.modifiedAt) < Date.parse(existing.polarModifiedAt)) return false;
  }
  const values = {
    householdId,
    status: incoming.status,
    interval: incoming.interval,
    currentPeriodEnd: incoming.currentPeriodEnd,
    trialEnd: incoming.trialEnd,
    cancelAtPeriodEnd: incoming.cancelAtPeriodEnd,
    endsAt: incoming.endsAt,
    polarModifiedAt: incoming.modifiedAt,
    updatedAt: now.toISOString(),
  };
  db.insert(subscriptions)
    .values({ id: incoming.id, ...values })
    .onConflictDoUpdate({ target: subscriptions.id, set: values })
    .run();
  recordPolarCustomer(db, householdId, incoming.customerId);
  return true;
}

const STATUS_RANK: Record<string, number> = { active: 0, trialing: 1, past_due: 2, unpaid: 3 };

/** The subscription the UI should describe: one that grants access, else past due, else the latest. */
export function mostRelevantSubscription(rows: SubscriptionRow[], now: Date): SubscriptionRow | null {
  const ranked = [...rows].sort((a, b) => {
    const grantsA = subscriptionGrantsAccess(a, now) ? 0 : 1;
    const grantsB = subscriptionGrantsAccess(b, now) ? 0 : 1;
    if (grantsA !== grantsB) return grantsA - grantsB;
    const rankA = STATUS_RANK[a.status] ?? 4;
    const rankB = STATUS_RANK[b.status] ?? 4;
    if (rankA !== rankB) return rankA - rankB;
    return Date.parse(b.polarModifiedAt) - Date.parse(a.polarModifiedAt);
  });
  return ranked[0] ?? null;
}

export interface BillingSummary {
  status: string;
  interval: "month" | "year" | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  exempt: boolean;
  deleteAt: string | null;
}

/** The `billing` object of `GET /auth/session`, minus `plans`. */
export function summarizeBilling(db: Db, householdId: string, now: Date): BillingSummary {
  const row = getBillingRow(db, householdId);
  const exempt = row?.exempt === true;
  const rows = listSubscriptions(db, householdId);
  const entitled = exempt || rows.some((r) => subscriptionGrantsAccess(r, now));
  const sub = mostRelevantSubscription(rows, now);

  let deleteAt: string | null = null;
  if (!entitled) {
    const lockedAt = row?.lockedAt != null ? Date.parse(row.lockedAt) : now.getTime();
    deleteAt = new Date(lockedAt + LOCK_DELETE_DAYS * DAY_MS).toISOString();
  }

  return {
    status: sub?.status ?? "none",
    interval: sub?.interval === "month" || sub?.interval === "year" ? sub.interval : null,
    trialEndsAt: sub?.trialEnd ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: sub !== null && subscriptionGrantsAccess(sub, now) && sub.cancelAtPeriodEnd,
    exempt,
    deleteAt,
  };
}
