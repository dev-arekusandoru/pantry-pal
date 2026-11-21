import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./auth/middleware.js";
import { isEntitled, DAY_MS } from "./billing/state.js";
import type { Db } from "./db/client.js";
import { accounts } from "./db/schema.js";

/** An unverified account has full access this long after it was created. */
export const VERIFY_GRACE_DAYS = 7;

export type LockReason = "subscription_required" | "email_unverified";
export type Access = { status: "ok" } | { status: "locked"; reason: LockReason };

/** Which hosted features are on. Both off = self-host: every household has access. */
export interface AccessPolicy {
  emailOn: boolean;
  billingOn: boolean;
}

/** When an unverified account loses access (null for a verified one or when email is off). */
export function verifyBy(
  policy: AccessPolicy,
  account: { createdAt: string; emailVerifiedAt: string | null },
): Date | null {
  if (!policy.emailOn || account.emailVerifiedAt !== null) return null;
  return new Date(Date.parse(account.createdAt) + VERIFY_GRACE_DAYS * DAY_MS);
}

/**
 * The one access function every gate uses.
 * 1. Email on, account unverified, 7 days after sign-up: `email_unverified`.
 *    Checked first, so a returning user is told to verify before anything else.
 * 2. Billing on and household not entitled: `subscription_required`.
 * 3. Otherwise `ok`.
 */
export function computeAccess(db: Db, policy: AccessPolicy, householdId: string, now: Date): Access {
  if (policy.emailOn) {
    const account = db.select().from(accounts).where(eq(accounts.householdId, householdId)).get();
    const deadline = account === undefined ? null : verifyBy(policy, account);
    if (deadline !== null && now.getTime() >= deadline.getTime()) {
      return { status: "locked", reason: "email_unverified" };
    }
  }
  if (policy.billingOn && !isEntitled(db, householdId, now)) {
    return { status: "locked", reason: "subscription_required" };
  }
  return { status: "ok" };
}

const MESSAGES: Record<LockReason, string> = {
  subscription_required: "Start your free trial to keep using Rakumi.",
  email_unverified: "Verify your email to keep using Rakumi.",
};

/** 402 for locked households. Runs after the auth middleware, so `c.var.ctx` is set. */
export function createAccessGate(
  db: Db,
  policy: AccessPolicy,
  now: () => Date,
): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const access = computeAccess(db, policy, c.var.ctx.householdId, now());
    if (access.status === "locked") {
      c.header("Cache-Control", "no-store");
      return c.json({ error: { code: access.reason, message: MESSAGES[access.reason] } }, 402);
    }
    await next();
  });
}
