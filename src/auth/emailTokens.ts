import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, emailTokens, type EmailTokenPurpose } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import type { Account } from "./accounts.js";

/** Verification links work 48 hours, reset links 1 hour. Both work once. */
export const TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify: 48 * 60 * 60_000,
  reset: 60 * 60_000,
};

/** Per account and purpose: one new link per minute, five per day. */
const MIN_INTERVAL_MS = 60_000;
const DAILY_LIMIT = 5;
const DAY_MS = 24 * 60 * 60_000;

function hashEmailToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Create a single-use token and return the plaintext for the email link. Only its
 * hash is stored. A new reset token voids the older unused ones.
 */
export function issueEmailToken(
  db: Db,
  accountId: string,
  purpose: EmailTokenPurpose,
  now: Date,
): string {
  const token = randomBytes(32).toString("base64url");
  const nowIso = now.toISOString();
  if (purpose === "reset") {
    db.update(emailTokens)
      .set({ usedAt: nowIso })
      .where(
        and(eq(emailTokens.accountId, accountId), eq(emailTokens.purpose, "reset"), isNull(emailTokens.usedAt)),
      )
      .run();
  }
  db.insert(emailTokens)
    .values({
      id: newId("etk"),
      accountId,
      purpose,
      tokenHash: hashEmailToken(token),
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[purpose]).toISOString(),
      createdAt: nowIso,
    })
    .run();
  return token;
}

/**
 * Seconds to wait before this account may get another link of this purpose, or
 * null when it may. Counts every link ever issued, used or not.
 */
export function emailTokenRetryAfter(
  db: Db,
  accountId: string,
  purpose: EmailTokenPurpose,
  now: Date,
): number | null {
  const times = db
    .select({ createdAt: emailTokens.createdAt })
    .from(emailTokens)
    .where(and(eq(emailTokens.accountId, accountId), eq(emailTokens.purpose, purpose)))
    .all()
    .map((row) => Date.parse(row.createdAt))
    .filter((time) => now.getTime() - time < DAY_MS)
    .sort((a, b) => b - a);

  let waitMs = 0;
  const latest = times[0];
  if (latest !== undefined) waitMs = Math.max(waitMs, latest + MIN_INTERVAL_MS - now.getTime());
  if (times.length >= DAILY_LIMIT) {
    // The oldest link in the 5-link window leaves the 24-hour window first.
    waitMs = Math.max(waitMs, times[DAILY_LIMIT - 1]! + DAY_MS - now.getTime());
  }
  return waitMs > 0 ? Math.ceil(waitMs / 1000) : null;
}

/**
 * Use a token: it must exist, match the purpose, be unused and unexpired. The
 * update is atomic, so a token works once even under concurrent requests.
 * Returns the account, or null.
 */
export function consumeEmailToken(
  db: Db,
  token: string,
  purpose: EmailTokenPurpose,
  now: Date,
): Account | null {
  if (token === "") return null;
  const nowIso = now.toISOString();
  const used = db
    .update(emailTokens)
    .set({ usedAt: nowIso })
    .where(
      and(
        eq(emailTokens.tokenHash, hashEmailToken(token)),
        eq(emailTokens.purpose, purpose),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, nowIso),
      ),
    )
    .returning({ accountId: emailTokens.accountId })
    .get();
  if (used === undefined) return null;
  return db.select().from(accounts).where(eq(accounts.id, used.accountId)).get() ?? null;
}

/** Void every unused token of this purpose (after a successful reset). */
export function voidEmailTokens(db: Db, accountId: string, purpose: EmailTokenPurpose, now: Date): void {
  db.update(emailTokens)
    .set({ usedAt: now.toISOString() })
    .where(and(eq(emailTokens.accountId, accountId), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt)))
    .run();
}
