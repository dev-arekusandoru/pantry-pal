import { z } from "@hono/zod-openapi";
import { spiceLevelSchema } from "./recipes.js";

export const householdSettingsSchema = z
  .object({
    defaultServings: z.number().positive().describe("Servings used when a recipe is planned without an explicit amount."),
    spiceLevel: spiceLevelSchema.describe("Household heat tolerance."),
    lunchBatchServings: z.number().positive().describe("Batch-cooked lunch size."),
    dinnerServings: z.number().positive().describe("Dinner cook size (cook once, eat twice)."),
    weekStartsOn: z.number().int().min(0).max(6).describe("1 = Monday (ISO)."),
    unitSystem: z.enum(["us", "metric"]).describe("Preferred unit system for display."),
    planningNotes: z.string().nullable().describe("Free-form planning guidance for agents."),
  })
  .openapi("HouseholdSettings");

export const householdSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    timezone: z.string().describe("IANA timezone, e.g. Europe/Berlin."),
    settings: householdSettingsSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Household");

export const updateHouseholdSchema = z
  .object({
    name: z.string().min(1).optional().describe("Household display name."),
    timezone: z.string().min(1).optional().describe("IANA timezone."),
    settings: householdSettingsSchema
      .partial()
      .optional()
      .describe("Partial settings; provided keys are merged over the current settings."),
  })
  .openapi("UpdateHouseholdInput");

export const householdMemberSchema = z
  .object({
    id: z.string(),
    householdId: z.string(),
    name: z.string(),
    notes: z.string().nullable().describe("Free-text dietary notes."),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("HouseholdMember");

export const createMemberSchema = z
  .object({
    name: z.string().min(1).describe("Member display name."),
    notes: z.string().nullable().optional().describe('Dietary notes, e.g. "no mushrooms".'),
  })
  .openapi("CreateHouseholdMemberInput");

export const updateMemberSchema = z
  .object({
    name: z.string().min(1).optional().describe("Member display name."),
    notes: z.string().nullable().optional().describe("Dietary notes."),
  })
  .openapi("UpdateHouseholdMemberInput");

export const householdMemberListSchema = z
  .object({ items: z.array(householdMemberSchema) })
  .openapi("HouseholdMemberList");

export const memberIdParamSchema = z.object({
  id: z.string().min(1).describe("Household member id."),
});

export const deleteMemberResultSchema = z
  .object({ deleted: z.boolean(), id: z.string() })
  .openapi("DeleteHouseholdMemberResult");
