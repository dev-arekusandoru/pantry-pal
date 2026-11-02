import { and, asc, eq } from "drizzle-orm";
import type { Ctx } from "../context.js";
import type { Db } from "../db/client.js";
import { householdMembers, households, type HouseholdSettings } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

export type Household = typeof households.$inferSelect;
export type HouseholdMember = typeof householdMembers.$inferSelect;

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

// ---------------------------------------------------------------------------
// Household updates
// ---------------------------------------------------------------------------

export interface UpdateHouseholdInput {
  name?: string;
  timezone?: string;
  /** Merged over the existing settings (partial update). */
  settings?: Partial<HouseholdSettings>;
}

/** Update the household; `settings` is merged key-by-key, not replaced. */
export function updateHousehold(ctx: Ctx, input: UpdateHouseholdInput): Household {
  const existing = getHousehold(ctx.db, ctx.householdId);

  const values: Partial<typeof households.$inferInsert> = { updatedAt: nowIso(ctx) };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name === "") {
      throw new AppError("validation", "Household name cannot be empty");
    }
    values.name = name;
  }
  if (input.timezone !== undefined) {
    const timezone = input.timezone.trim();
    if (timezone === "") {
      throw new AppError("validation", "Timezone cannot be empty");
    }
    values.timezone = timezone;
  }
  if (input.settings !== undefined) {
    values.settings = { ...existing.settings, ...input.settings };
  }

  return ctx.db
    .update(households)
    .set(values)
    .where(eq(households.id, ctx.householdId))
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Household members
// ---------------------------------------------------------------------------

export interface CreateMemberInput {
  name: string;
  notes?: string | null;
}

export interface UpdateMemberInput {
  name?: string;
  notes?: string | null;
}

export function listMembers(ctx: Ctx): { items: HouseholdMember[] } {
  const items = ctx.db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.householdId, ctx.householdId))
    .orderBy(asc(householdMembers.createdAt), asc(householdMembers.id))
    .all();
  return { items };
}

export function getMember(ctx: Ctx, id: string): HouseholdMember {
  const row = ctx.db
    .select()
    .from(householdMembers)
    .where(
      and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.id, id)),
    )
    .get();
  if (!row) throw new AppError("not_found", `Household member not found: ${id}`, { id });
  return row;
}

export function createMember(ctx: Ctx, input: CreateMemberInput): HouseholdMember {
  const name = input.name.trim();
  if (name === "") {
    throw new AppError("validation", "Member name is required");
  }

  const timestamp = nowIso(ctx);
  return ctx.db
    .insert(householdMembers)
    .values({
      id: newId("mem"),
      householdId: ctx.householdId,
      name,
      notes: input.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()
    .get();
}

export function updateMember(ctx: Ctx, id: string, patch: UpdateMemberInput): HouseholdMember {
  const existing = getMember(ctx, id);

  const values: Partial<typeof householdMembers.$inferInsert> = { updatedAt: nowIso(ctx) };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name === "") {
      throw new AppError("validation", "Member name cannot be empty");
    }
    values.name = name;
  }
  if (patch.notes !== undefined) values.notes = patch.notes;

  return ctx.db
    .update(householdMembers)
    .set(values)
    .where(
      and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.id, existing.id)),
    )
    .returning()
    .get();
}

export function deleteMember(ctx: Ctx, id: string): { deleted: true; id: string } {
  const existing = getMember(ctx, id);
  ctx.db
    .delete(householdMembers)
    .where(
      and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.id, existing.id)),
    )
    .run();
  return { deleted: true as const, id: existing.id };
}
