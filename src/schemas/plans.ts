import { z } from "@hono/zod-openapi";
import {
  COOK_STATUSES,
  MEAL_TYPES,
  MOVEMENT_KINDS,
  MOVEMENT_REASONS,
  MOVEMENT_REF_TYPES,
  PANTRY_STATUSES,
  PLAN_STATUSES,
  SLOT_KINDS,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
  .openapi({ description: "Calendar date (YYYY-MM-DD).", example: "2026-11-02" });

export const mealTypeSchema = z
  .enum(MEAL_TYPES)
  .openapi({ description: "Eating occasion.", example: "dinner" });

export const planStatusSchema = z
  .enum(PLAN_STATUSES)
  .openapi({ description: "Plan lifecycle status.", example: "active" });

export const cookStatusSchema = z
  .enum(COOK_STATUSES)
  .openapi({ description: "Cook lifecycle status.", example: "planned" });

export const slotKindSchema = z
  .enum(SLOT_KINDS)
  .openapi({
    description:
      "meal = fed by a cook event; freeform = ad-hoc eating with a label; skip = intentionally no meal.",
    example: "meal",
  });

const servingsSchema = z.number().positive().openapi({ description: "Servings.", example: 2 });

const recipeRefShape = {
  recipeId: z.string().min(1).optional().describe("Recipe id. Takes precedence over `recipe`."),
  recipe: z
    .string()
    .min(1)
    .optional()
    .describe("Recipe slug or title, used when `recipeId` is not given."),
};

const servingsField = servingsSchema.optional();

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const createPlanCookEventSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Local key referenced by slots/prep tasks in the same createPlan call (wires leftovers to a new cook).",
      ),
    ...recipeRefShape,
    cookDate: isoDateSchema.describe(
      "Date the cooking happens. May fall outside the plan week (e.g. Sunday batch cook).",
    ),
    plannedServings: servingsField.describe(
      "Servings this cook yields. Defaults from household settings using the first meal it feeds (lunch → lunchBatchServings, dinner → dinnerServings, else defaultServings); defaultServings when no slot references it.",
    ),
    label: z.string().nullish().describe('Cook label, e.g. "Batch A".'),
    notes: z.string().nullish().describe("Free-form cook notes."),
  })
  .openapi({ description: "A cook planned inside a new week plan." });

export const createPlanSlotSchema = z
  .object({
    date: isoDateSchema.describe("Date of the eating occasion; must be inside the plan week."),
    mealType: mealTypeSchema,
    kind: slotKindSchema,
    cookEventId: z
      .string()
      .optional()
      .describe("Existing cook event id (an ad-hoc cook or one referenced by key in this call)."),
    cookEventKey: z
      .string()
      .optional()
      .describe("Key of a cook event created in the same createPlan call."),
    servings: z.number().positive().nullish().describe("Servings eaten in this slot."),
    label: z.string().nullish().describe("Display text for freeform/skip slots."),
    notes: z.string().nullish().describe("Free-form slot notes."),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Ordering within the same date+mealType (defaults to append)."),
  })
  .openapi({ description: "One eating occasion when creating a plan." });

export const createPlanPrepTaskSchema = z
  .object({
    dueDate: isoDateSchema.describe("Date the prep should be done."),
    description: z.string().min(1).describe('What to do, e.g. "Soak beans".'),
    cookEventId: z.string().optional().describe("Cook this prep is for."),
    cookEventKey: z
      .string()
      .optional()
      .describe("Key of a cook event created in the same createPlan call."),
    position: z.number().int().min(0).optional().describe("Ordering within the due date."),
  })
  .openapi({ description: "A prep task created with the plan." });

export const createPlanSchema = z
  .object({
    weekStart: isoDateSchema.describe(
      "First day of the plan week. Must fall on the household settings.weekStartsOn weekday (1 = Monday by default).",
    ),
    title: z.string().nullish().describe("Optional plan title."),
    status: planStatusSchema.optional().describe("Defaults to draft."),
    notes: z.string().nullish().describe("Free-form planning notes."),
    cookEvents: z.array(createPlanCookEventSchema).optional().describe("Cooks for this plan."),
    slots: z.array(createPlanSlotSchema).optional().describe("Meal slots for this plan."),
    prepTasks: z.array(createPlanPrepTaskSchema).optional().describe("Prep tasks for this plan."),
  })
  .openapi({ description: "Create a week plan with its cooks, slots and prep tasks in one transaction." });

export const updatePlanSchema = z
  .object({
    title: z.string().nullish().describe("New title; null clears it."),
    status: planStatusSchema.optional().describe("New plan status."),
    notes: z.string().nullish().describe("New notes; null clears them."),
  })
  .openapi({ description: "Update plan metadata." });

export const addSlotSchema = z
  .object({
    date: isoDateSchema.describe("Slot date inside the plan week."),
    mealType: mealTypeSchema,
    kind: slotKindSchema,
    cookEventId: z.string().nullish().describe("Required for kind=meal, forbidden otherwise."),
    servings: z.number().positive().nullish().describe("Servings eaten in this slot."),
    label: z.string().nullish().describe("Required for freeform slots."),
    notes: z.string().nullish(),
    position: z.number().int().min(0).optional().describe("Ordering within date+mealType."),
  })
  .openapi({ description: "Add one slot at the low level." });

export const updateSlotSchema = z
  .object({
    date: isoDateSchema.optional(),
    mealType: mealTypeSchema.optional(),
    kind: slotKindSchema.optional(),
    cookEventId: z.string().nullish().describe("Cook event id; cleared automatically for non-meal slots."),
    servings: z.number().positive().nullish(),
    label: z.string().nullish(),
    notes: z.string().nullish(),
    position: z.number().int().min(0).optional(),
  })
  .openapi({ description: "Patch one slot." });

const cookSlotSpecSchema = z
  .object({
    kind: z.literal("cook"),
    ...recipeRefShape,
    servings: z.number().positive().optional().describe("Servings eaten in this slot."),
    cookServings: z
      .number()
      .positive()
      .optional()
      .describe("Servings the new cook yields; defaults to `servings` or the meal-type default."),
    label: z.string().nullish().describe("Label for the new cook event."),
  })
  .openapi({ description: "Create a cook dated the same day and let it feed this slot." });

const leftoverSlotSpecSchema = z
  .object({
    kind: z.literal("leftover"),
    cookEventId: z.string().min(1).describe("Existing cook event to eat from."),
    servings: z.number().positive().optional().describe("Servings eaten from that cook."),
  })
  .openapi({ description: "Eat leftovers from an existing cook event." });

const freeformSlotSpecSchema = z
  .object({
    kind: z.literal("freeform"),
    label: z.string().min(1).describe('What is being eaten, e.g. "Fridge clean-out".'),
  })
  .openapi({ description: "Ad-hoc meal without a cook event." });

const skipSlotSpecSchema = z
  .object({
    kind: z.literal("skip"),
    label: z.string().nullish().describe('Optional reason, e.g. "Eating out".'),
  })
  .openapi({ description: "Intentionally no meal." });

const clearSlotSpecSchema = z
  .object({
    kind: z.literal("clear"),
  })
  .openapi({ description: "Remove the slots at this date+mealType." });

export const slotSpecSchema = z
  .discriminatedUnion("kind", [
    cookSlotSpecSchema,
    leftoverSlotSpecSchema,
    freeformSlotSpecSchema,
    skipSlotSpecSchema,
    clearSlotSpecSchema,
  ])
  .openapi({ description: "Replacement spec for one date+mealType group." });

export const setSlotsOpSchema = z
  .object({
    date: isoDateSchema.describe("Slot date inside the plan week."),
    mealType: mealTypeSchema,
    spec: slotSpecSchema,
  })
  .openapi({ description: "Replace the slots at one date+mealType." });

export const setSlotsSchema = z
  .object({
    ops: z.array(setSlotsOpSchema).min(1).describe("Replacement operations, applied in order."),
  })
  .openapi({ description: "Upsert meal slots for one or more date+mealType groups." });

export const addCookEventSchema = z
  .object({
    ...recipeRefShape,
    cookDate: isoDateSchema.describe("Date of the cook; may fall outside the plan week."),
    plannedServings: servingsField.describe("Defaults to the household defaultServings."),
    label: z.string().nullish().describe('Cook label, e.g. "Sunday prep".'),
    notes: z.string().nullish(),
  })
  .openapi({ description: "Add a cook event to an existing plan." });

export const updateCookEventSchema = z
  .object({
    cookDate: isoDateSchema.optional().describe("Reschedule the cook."),
    plannedServings: z.number().positive().optional().describe("Change the planned yield."),
    actualServings: z.number().positive().nullish().describe("Change/clear the actual yield."),
    ...recipeRefShape,
    label: z.string().nullish(),
    notes: z.string().nullish(),
    rating: z.number().int().min(1).max(5).nullish().describe("Post-cook rating (1-5)."),
  })
  .openapi({ description: "Reschedule a cook, change servings or swap its recipe." });

export const deleteCookEventQuerySchema = z.object({
  force: z
    .enum(["true", "false"])
    .optional()
    .describe("When true, slots referencing the cook become freeform 'unassigned'."),
});

export const completeCookEventSchema = z
  .object({
    actualServings: z
      .number()
      .positive()
      .optional()
      .describe("Servings actually produced; defaults to the planned servings."),
    rating: z.number().int().min(1).max(5).optional().describe("Post-cook rating (1-5)."),
    notes: z.string().optional().describe("Post-cook feedback."),
    decrementPantry: z
      .boolean()
      .optional()
      .describe("Decrement scaled recipe ingredients from pantry stock. Default true."),
  })
  .openapi({ description: "Complete a cook and decrement the pantry." });

export const skipCookEventSchema = z
  .object({
    note: z.string().optional().describe("Why the cook was skipped."),
  })
  .openapi({ description: "Skip a planned cook." });

export const addPrepTaskSchema = z
  .object({
    dueDate: isoDateSchema.describe("Date the prep should be done."),
    description: z.string().min(1).describe("What to do."),
    cookEventId: z.string().nullish().describe("Cook this prep is for."),
    position: z.number().int().min(0).optional().describe("Ordering within the due date."),
  })
  .openapi({ description: "Add a prep task to a plan." });

export const updatePrepTaskSchema = z
  .object({
    dueDate: isoDateSchema.optional(),
    description: z.string().min(1).optional(),
    cookEventId: z.string().nullish().describe("Cook this prep is for; null unlinks."),
    position: z.number().int().min(0).optional(),
  })
  .openapi({ description: "Patch a prep task." });

const booleanQuery = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));

export const listPlansQuerySchema = z.object({
  status: planStatusSchema.optional().describe("Filter by plan status."),
  from: isoDateSchema.optional().describe("Only plans whose week overlaps [from, to]."),
  to: isoDateSchema.optional().describe("Only plans whose week overlaps [from, to]."),
});

export const listCookEventsQuerySchema = z.object({
  planId: z.string().optional().describe("Only cooks of this plan."),
  from: isoDateSchema.optional().describe("Cook date lower bound (inclusive)."),
  to: isoDateSchema.optional().describe("Cook date upper bound (inclusive)."),
  status: cookStatusSchema.optional().describe("Filter by cook status."),
  recipeId: z.string().optional().describe("Only cooks of this recipe."),
  limit: z.coerce.number().int().min(1).max(500).optional().describe("Max results (default all)."),
});

export const listPrepTasksQuerySchema = z.object({
  planId: z.string().optional().describe("Only tasks of this plan."),
  from: isoDateSchema.optional().describe("Due date lower bound (inclusive)."),
  to: isoDateSchema.optional().describe("Due date upper bound (inclusive)."),
  includeDone: booleanQuery.describe("Include completed tasks. Default false."),
});

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export const cookEventSummarySchema = z.object({
  id: z.string(),
  recipeId: z.string(),
  recipeTitle: z.string(),
  cookDate: isoDateSchema,
  status: cookStatusSchema,
});

export const slotViewSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  mealPlanId: z.string(),
  date: isoDateSchema,
  mealType: mealTypeSchema,
  kind: slotKindSchema,
  cookEventId: z.string().nullable(),
  cookEvent: cookEventSummarySchema.nullable(),
  servings: z.number().nullable(),
  label: z.string().nullable(),
  notes: z.string().nullable(),
  position: z.number().int(),
  isLeftover: z.boolean().describe("True when the slot is dated after the cook that feeds it."),
});

export const cookEventViewSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  mealPlanId: z.string().nullable(),
  recipeId: z.string(),
  recipeTitle: z.string(),
  cookDate: isoDateSchema,
  plannedServings: z.number(),
  actualServings: z.number().nullable(),
  label: z.string().nullable(),
  status: cookStatusSchema,
  completedAt: z.string().nullable(),
  rating: z.number().int().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  fedSlots: z.number().int(),
  servingsAllocated: z.number(),
  servingsRemaining: z.number(),
});

export const prepTaskViewSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  mealPlanId: z.string(),
  dueDate: isoDateSchema,
  description: z.string(),
  cookEventId: z.string().nullable(),
  doneAt: z.string().nullable(),
  position: z.number().int(),
  done: z.boolean(),
});

export const planDaySchema = z.object({
  date: isoDateSchema,
  meals: z.object({
    breakfast: z.array(slotViewSchema),
    lunch: z.array(slotViewSchema),
    dinner: z.array(slotViewSchema),
    snack: z.array(slotViewSchema),
    dessert: z.array(slotViewSchema),
  }),
});

export const planViewSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  weekStart: isoDateSchema,
  title: z.string().nullable(),
  status: planStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  days: z.array(planDaySchema).describe("Seven days starting at weekStart."),
  cookEvents: z.array(cookEventViewSchema),
  prepTasks: z.array(prepTaskViewSchema),
  warnings: z.array(z.string()).describe("Human-readable planning warnings."),
});

export const planSummarySchema = z.object({
  id: z.string(),
  householdId: z.string(),
  weekStart: isoDateSchema,
  title: z.string().nullable(),
  status: planStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const listPlansResponseSchema = z.object({ items: z.array(planSummarySchema) });

export const listPrepTasksResponseSchema = z.object({ items: z.array(prepTaskViewSchema) });

export const setSlotsResultSchema = z.object({
  slots: z.array(slotViewSchema),
  deletedCookEventIds: z
    .array(z.string())
    .describe("Planned cook events deleted because the operation left them without slots."),
});

export const deleteCookEventResultSchema = z.object({
  id: z.string(),
  affectedSlotIds: z.array(z.string()),
});

export const idResultSchema = z.object({ id: z.string() });

export const stockMovementSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  pantryItemId: z.string(),
  kind: z.enum(MOVEMENT_KINDS),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  reason: z.enum(MOVEMENT_REASONS),
  refType: z.enum(MOVEMENT_REF_TYPES).nullable(),
  refId: z.string().nullable(),
  note: z.string().nullable(),
  qtyAfter: z.number().nullable(),
  statusAfter: z.enum(PANTRY_STATUSES),
  createdAt: z.string(),
});

export const cookEventMovementSchema = stockMovementSchema
  .extend({
    ingredientId: z.string(),
    ingredientName: z.string(),
  })
  .openapi("CookEventMovement");

export const cookEventHistoryItemSchema = cookEventViewSchema
  .extend({
    movements: z
      .array(cookEventMovementSchema)
      .optional()
      .describe("Pantry movements produced by this cook; present when movements are requested."),
  })
  .openapi("CookEventHistoryItem");

export const listCookEventsResponseSchema = z.object({
  items: z.array(cookEventHistoryItemSchema),
});

export const cookEventMutationResultSchema = z.object({
  cookEvent: cookEventViewSchema,
  movements: z.array(stockMovementSchema),
  warnings: z.array(z.string()),
});
