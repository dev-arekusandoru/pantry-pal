import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, households, sessions } from "../db/schema.js";

/**
 * Browser sessions backed by the `session` table.
 *
 * The cookie holds a random opaque value; only its SHA-256 hash is stored, so a
 * database copy cannot be replayed as a cookie. Logout deletes the row, and
 * changing a password deletes that account's rows, so copies stop working.
 */

/**
 * Name of the browser session cookie. The `__Host-` prefix makes browsers reject
 * cookies with a `Domain` attribute or another path, preventing a sibling/parent
 * domain from planting or shadowing the session cookie.
 */
export const SESSION_COOKIE_NAME = "__Host-pantrypal_session";

/** Browser sessions last 30 days. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface CreatedSession {
  /** Opaque cookie value. */
  value: string;
  maxAge: number;
  expiresAt: Date;
}

export function hashSessionId(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Create a session row and return the cookie value for the browser. */
export function createSession(db: Db, accountId: string, now: Date): CreatedSession {
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const value = randomBytes(32).toString("base64url");

  db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run();
  db.insert(sessions)
    .values({ id: hashSessionId(value), accountId, expiresAt: expiresAt.toISOString() })
    .run();

  return { value, maxAge: SESSION_TTL_SECONDS, expiresAt };
}

export interface SessionInfo {
  account: { id: string; email: string };
  household: { id: string; name: string };
}

/** Resolve a cookie value to its account and household, or `null` when unknown/expired. */
export function resolveSession(db: Db, value: string, now: Date): SessionInfo | null {
  if (value === "") return null;
  const row = db
    .select({
      accountId: accounts.id,
      email: accounts.email,
      householdId: households.id,
      householdName: households.name,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .innerJoin(households, eq(households.id, accounts.householdId))
    .where(and(eq(sessions.id, hashSessionId(value)), gt(sessions.expiresAt, now.toISOString())))
    .get();
  if (!row) return null;
  return {
    account: { id: row.accountId, email: row.email },
    household: { id: row.householdId, name: row.householdName },
  };
}

/** Delete the session for a cookie value, if any. */
export function deleteSession(db: Db, value: string): void {
  db.delete(sessions).where(eq(sessions.id, hashSessionId(value))).run();
}

/** Delete every session of an account (password change, account removal). */
export function deleteAccountSessions(db: Db, accountId: string): void {
  db.delete(sessions).where(eq(sessions.accountId, accountId)).run();
}
