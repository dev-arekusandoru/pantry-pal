import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { accounts, householdBilling, households, subscriptions } from "../db/schema.js";
import { deleteHousehold } from "../services/households.js";
import type { Mailer } from "../email/mailer.js";
import { deletionWarningEmail } from "../email/templates.js";
import type { Billing } from "./service.js";
import { DAY_MS, LOCK_DELETE_DAYS, refreshLock } from "./state.js";

export const FIRST_WARNING_DAY = 23;
export const FINAL_WARNING_DAY = 29;
const JOB_INTERVAL_MS = 60 * 60_000;

export interface LifecycleDeps {
  db: Db;
  billing: Billing;
  mailer: Mailer;
  publicUrl: string;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface LifecycleResult {
  warned: Array<{ householdId: string; day: 23 | 29 }>;
  deleted: string[];
}

/**
 * One pass of the lock/deletion job. Idempotent: every step checks its own mark.
 *
 * 1. Align every household's `locked_at` with its entitlement.
 * 2. Locked, non-exempt households with an account: email at day 23 and day 29,
 *    delete at day 30.
 *
 * A household is deleted only after the final warning went out and at least 24 hours
 * passed since. If mail was down on day 29, the warning goes out late and deletion
 * waits for it. A household without an account cannot be warned and is never deleted.
 *
 * Deletion removes the household's Polar customer first (this is the only place a
 * household is deleted). If that fails, the household stays and the next run retries.
 */
export async function runLifecycle(deps: LifecycleDeps): Promise<LifecycleResult> {
  const { db, mailer, publicUrl } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? ((message: string) => console.log(`[pantrypal] ${message}`));
  const result: LifecycleResult = { warned: [], deleted: [] };

  for (const row of db.select({ id: households.id }).from(households).all()) {
    refreshLock(db, row.id, now);
  }
  deps.billing.pruneEvents(db);

  const locked = db
    .select({
      householdId: householdBilling.householdId,
      lockedAt: householdBilling.lockedAt,
      warnedDay23At: householdBilling.warnedDay23At,
      warnedDay29At: householdBilling.warnedDay29At,
      email: accounts.email,
    })
    .from(householdBilling)
    .innerJoin(accounts, eq(accounts.householdId, householdBilling.householdId))
    .where(and(isNotNull(householdBilling.lockedAt), eq(householdBilling.exempt, false)))
    .all();

  for (const row of locked) {
    const lockedAt = Date.parse(row.lockedAt!);
    const age = now.getTime() - lockedAt;
    const deleteDue = lockedAt + LOCK_DELETE_DAYS * DAY_MS;

    if (
      now.getTime() >= deleteDue &&
      row.warnedDay29At !== null &&
      now.getTime() >= Date.parse(row.warnedDay29At) + DAY_MS
    ) {
      // Polar first: if it fails the household stays, so the next hourly run retries.
      // Deleting the customer cancels its subscriptions. That is safe: only locked,
      // non-exempt households reach this point, so they have no active plan.
      try {
        await deps.billing.deleteCustomer(db, row.householdId);
      } catch (error) {
        log(`deleting the Polar customer of household ${row.householdId} failed, will retry: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      deleteHousehold(db, row.householdId);
      result.deleted.push(row.householdId);
      log(`deleted household ${row.householdId} (locked since ${row.lockedAt})`);
      continue;
    }

    const final = age >= FINAL_WARNING_DAY * DAY_MS && row.warnedDay29At === null;
    const first = !final && age >= FIRST_WARNING_DAY * DAY_MS && age < FINAL_WARNING_DAY * DAY_MS && row.warnedDay23At === null;
    if (!final && !first) continue;

    // Late final warning: deletion happens at least a day after it, so say that date.
    const deleteAt = new Date(final ? Math.max(deleteDue, now.getTime() + DAY_MS) : deleteDue);
    const daysLeft = final ? 1 : Math.max(2, Math.ceil((deleteAt.getTime() - now.getTime()) / DAY_MS));
    const neverSubscribed =
      db.select({ id: subscriptions.id }).from(subscriptions)
        .where(eq(subscriptions.householdId, row.householdId)).get() === undefined;
    try {
      await mailer.send(deletionWarningEmail(row.email, `${publicUrl}/`, deleteAt, daysLeft, neverSubscribed));
    } catch (error) {
      log(`deletion warning to household ${row.householdId} failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const marks = final
      ? { warnedDay29At: now.toISOString(), ...(row.warnedDay23At === null ? { warnedDay23At: now.toISOString() } : {}) }
      : { warnedDay23At: now.toISOString() };
    db.update(householdBilling).set(marks).where(eq(householdBilling.householdId, row.householdId)).run();
    result.warned.push({ householdId: row.householdId, day: final ? 29 : 23 });
  }
  return result;
}

/** Run the job now and then hourly. Returns a function that stops it. */
export function startLifecycleJob(deps: LifecycleDeps): () => void {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    runLifecycle(deps)
      .catch((error: unknown) => {
        console.error("[pantrypal] lock/deletion job failed:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, JOB_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
