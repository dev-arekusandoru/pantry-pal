import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { households, type HouseholdSettings } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";

export type Household = typeof households.$inferSelect;

/** Per-instance defaults for a freshly created household. */
export const DEFAULT_HOUSEHOLD_SETTINGS: HouseholdSettings = {
  defaultServings: 2,
  spiceLevel: "medium",
  lunchBatchServings: 4,
  dinnerServings: 4,
  weekStartsOn: 1,
  unitSystem: "us",
  planningNotes: null,
};

export interface CreateHouseholdInput {
  name: string;
  timezone?: string;
  settings?: Partial<HouseholdSettings>;
}

/** Create the household row. Settings are merged over the defaults. */
export function createHousehold(db: Db, input: CreateHouseholdInput): Household {
  const name = input.name.trim();
  if (name === "") {
    throw new AppError("validation", "Household name is required");
  }

  return db
    .insert(households)
    .values({
      id: newId("hh"),
      name,
      timezone: input.timezone?.trim() || "UTC",
      settings: { ...DEFAULT_HOUSEHOLD_SETTINGS, ...(input.settings ?? {}) },
    })
    .returning()
    .get();
}

/** Fetch one household by id, or throw `not_found`. */
export function getHousehold(db: Db, id: string): Household {
  const row = db.select().from(households).where(eq(households.id, id)).get();
  if (!row) throw new AppError("not_found", `Household not found: ${id}`, { id });
  return row;
}

/**
 * The single household of this instance (PantryPal is one household per instance).
 * Throws `not_found` with an init hint when the database has not been set up yet.
 */
export function getSingleHousehold(db: Db): Household {
  const row = db.select().from(households).limit(1).get();
  if (!row) {
    throw new AppError("not_found", "No household configured", {
      hint: "Run `pantrypal household init --name <name>` to create one.",
    });
  }
  return row;
}
