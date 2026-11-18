import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, households } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { createHousehold, getHousehold, type Household } from "../services/households.js";
import { hashPassword, verifyPassword } from "./password.js";
import { deleteAccountSessions } from "./session.js";

export type Account = typeof accounts.$inferSelect;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getAccountByEmail(db: Db, email: string): Account | undefined {
  return db.select().from(accounts).where(eq(accounts.email, normalizeEmail(email))).get();
}

export function getAccount(db: Db, id: string): Account {
  const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!row) throw new AppError("not_found", `Account not found: ${id}`, { id });
  return row;
}

export interface AccountSummary {
  id: string;
  email: string;
  householdId: string;
  householdName: string;
  createdAt: string;
}

export function listAccounts(db: Db): AccountSummary[] {
  return db
    .select({
      id: accounts.id,
      email: accounts.email,
      householdId: households.id,
      householdName: households.name,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .innerJoin(households, eq(households.id, accounts.householdId))
    .orderBy(accounts.createdAt, accounts.id)
    .all();
}

export interface CreateAccountInput {
  /** Either create a household with this name… */
  householdName?: string;
  /** …or attach the account to an existing one. */
  householdId?: string;
}

export interface CreatedAccount {
  account: Account;
  household: Household;
}

/** Create an account and its household atomically. */
export function createAccount(
  db: Db,
  email: string,
  password: string,
  input: CreateAccountInput,
): CreatedAccount {
  const normalized = normalizeEmail(email);
  if (getAccountByEmail(db, normalized)) {
    throw new AppError("conflict", "An account with this email already exists");
  }
  if (
    input.householdId !== undefined &&
    db.select().from(accounts).where(eq(accounts.householdId, input.householdId)).get() !== undefined
  ) {
    throw new AppError("conflict", "That household already has an account");
  }

  // Better SQLite transactions are synchronous, and the household helpers only
  // need this same connection.
  return db.transaction((tx) => {
    const handle = tx as unknown as Db;
    const household =
      input.householdId === undefined
        ? createHousehold(handle, { name: input.householdName ?? "" })
        : getHousehold(handle, input.householdId);

    const account = handle
      .insert(accounts)
      .values({
        id: newId("acc"),
        email: normalized,
        passwordHash: hashPassword(password),
        householdId: household.id,
      })
      .returning()
      .get();

    return { account, household };
  });
}

/** Verify credentials; returns the account only when the password matches. */
export function authenticate(db: Db, email: string, password: string): Account | null {
  const account = getAccountByEmail(db, email);
  if (!account) return null;
  return verifyPassword(account.passwordHash, password) ? account : null;
}

/** Set a new password and end every existing session of the account. */
export function resetPassword(db: Db, email: string, password: string): Account {
  const account = getAccountByEmail(db, email);
  if (!account) throw new AppError("not_found", `Account not found: ${normalizeEmail(email)}`);
  const updated = db
    .update(accounts)
    .set({ passwordHash: hashPassword(password) })
    .where(eq(accounts.id, account.id))
    .returning()
    .get();
  deleteAccountSessions(db, account.id);
  return updated;
}
