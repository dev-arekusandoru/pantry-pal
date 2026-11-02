import type { Db } from "./db/client.js";

/** Request/service context: database handle, household scope and clock. */
export interface Ctx {
  db: Db;
  householdId: string;
  now(): Date;
}

/** Build a context for a household. Tests inject a fixed clock. */
export function makeCtx(db: Db, householdId: string, now: () => Date = () => new Date()): Ctx {
  return { db, householdId, now };
}
