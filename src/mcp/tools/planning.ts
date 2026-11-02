import { z } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "../../context.js";
import {
  cookStatusSchema,
  createPlanSchema,
  isoDateSchema,
  planStatusSchema,
  setSlotsSchema,
} from "../../schemas/plans.js";
import { completeCookEvent, listCookEvents, reopenCookEvent, skipCookEvent } from "../../services/cooking.js";
import { computeAvailability, computeDemand } from "../../services/demand.js";
import {
  addCookEvent,
  addPrepTask,
  completePrepTask,
  createPlan,
  deleteCookEvent,
  deletePrepTask,
  getCurrentPlan,
  getPlan,
  listPrepTasks,
  setSlots,
  updateCookEvent,
  updatePlan,
  updatePrepTask,
} from "../../services/plans.js";
import { requireArg, tool } from "./util.js";

const planGetInput = z.object({
  plan: z
    .string()
    .optional()
    .describe('Plan id (plan_…), weekStart date (YYYY-MM-DD) or "current". Defaults to current.'),
});

const planSetSlotsInput = z.object({
  planId: z.string().min(1).describe("Plan id (plan_…)."),
  ops: setSlotsSchema.shape.ops,
});

const planUpdateInput = z
  .object({
    action: z
      .enum(["update", "add_cook", "update_cook", "delete_cook"])
      .describe("Change plan metadata or its cook events."),
    planId: z.string().optional().describe("Plan id (plan_…) for update/add_cook."),
    cookEventId: z.string().optional().describe("Cook event id (ce_…) for update_cook/delete_cook."),
    title: z.string().nullish().describe("New title; null clears it."),
    status: planStatusSchema.optional(),
    notes: z.string().nullish(),
    recipeId: z.string().optional().describe("Recipe id; takes precedence over `recipe`."),
    recipe: z.string().optional().describe("Recipe slug or title, used when `recipeId` is absent."),
    cookDate: isoDateSchema.optional().describe("Cook date; may fall outside the plan week."),
    plannedServings: z.number().positive().optional().describe("Servings the cook yields."),
    actualServings: z.number().positive().nullish().describe("Change/clear the actual yield."),
    label: z.string().nullish().describe('Cook label, e.g. "Batch A".'),
    rating: z.number().int().min(1).max(5).nullish().describe("Post-cook rating (1-5)."),
    force: z
      .boolean()
      .optional()
      .describe("delete_cook: turn referencing slots into freeform \"unassigned\" instead of failing."),
  })
  .describe("Update plan fields, or add/update/delete a cook event.");

const prepTasksInput = z.object({
  action: z.enum(["list", "add", "update", "complete", "delete"]).describe("Manage prep tasks."),
  planId: z.string().optional().describe("Plan id for list/add."),
  prepTaskId: z.string().optional().describe("Prep task id (prep_…) for update/complete/delete."),
  dueDate: isoDateSchema.optional().describe("Date the prep should be done."),
  description: z.string().min(1).optional().describe('What to do, e.g. "Soak beans".'),
  cookEventId: z.string().nullish().describe("Cook this prep is for; null unlinks."),
  position: z.number().int().min(0).optional().describe("Ordering within the due date."),
  from: isoDateSchema.optional().describe("list: due-date lower bound (inclusive)."),
  to: isoDateSchema.optional().describe("list: due-date upper bound (inclusive)."),
  includeDone: z.boolean().optional().describe("list: include completed tasks (default false)."),
});

const cookCompleteInput = z.object({
  action: z
    .enum(["complete", "skip", "reopen"])
    .describe("complete records the cook and decrements the pantry; reopen restores stock."),
  cookEventId: z.string().min(1).describe("Cook event id (ce_…)."),
  actualServings: z.number().positive().optional().describe("Servings actually produced."),
  rating: z.number().int().min(1).max(5).optional().describe("Post-cook rating (1-5)."),
  notes: z.string().optional().describe("Post-cook feedback."),
  decrementPantry: z
    .boolean()
    .optional()
    .describe("Decrement scaled recipe ingredients from stock. Default true."),
  note: z.string().optional().describe("Why the cook was skipped (action=skip)."),
});

const cookHistoryInput = z.object({
  planId: z.string().optional(),
  from: isoDateSchema.optional().describe("Cook date lower bound (inclusive)."),
  to: isoDateSchema.optional().describe("Cook date upper bound (inclusive)."),
  status: cookStatusSchema.optional(),
  recipeId: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional().describe("Max results (default all)."),
});

const availabilityInput = z.object({
  mealPlanId: z.string().optional().describe("Limit committed demand to one meal plan."),
  from: isoDateSchema.optional().describe("Demand: cook date lower bound (inclusive)."),
  to: isoDateSchema.optional().describe("Demand: cook date upper bound (inclusive)."),
  includeOptional: z.boolean().optional().describe("Demand: include optional ingredients."),
});

export function registerPlanningTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "plan_get",
    {
      title: "Get week plan",
      description:
        'Read a plan by id, weekStart date or "current": cook events, the slot grid (leftover slots point at their cook), prep tasks, warnings and status.',
      inputSchema: planGetInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof planGetInput>) => {
      const ref = args.plan ?? "current";
      return { plan: ref === "current" ? getCurrentPlan(ctx) : getPlan(ctx, ref) };
    }),
  );

  server.registerTool(
    "plan_create",
    {
      title: "Create week plan",
      description:
        "Create a week plan with cook events, slots and prep tasks in one transaction. `weekStart` must match the household week start; use cook event `key`s to wire leftover slots to cooks created in the same call.",
      inputSchema: createPlanSchema,
    },
    tool((args: z.infer<typeof createPlanSchema>) => ({ plan: createPlan(ctx, args) })),
  );

  server.registerTool(
    "plan_set_slots",
    {
      title: "Set meal slots",
      description:
        "Replace the slots at one or more date+mealType groups. spec.kind=cook creates a cook that day, leftover links an existing cook, freeform/skip need no cook, clear removes the slots.",
      inputSchema: planSetSlotsInput,
    },
    tool((args: z.infer<typeof planSetSlotsInput>) => setSlots(ctx, args.planId, args.ops)),
  );

  server.registerTool(
    "plan_update",
    {
      title: "Update plan or cook events",
      description:
        "action=update changes plan title/status/notes; add_cook creates a cook in the plan; update_cook reschedules it or changes servings/recipe/rating; delete_cook removes it (force unlinks its slots).",
      inputSchema: planUpdateInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof planUpdateInput>) => {
      switch (args.action) {
        case "update": {
          const planId = requireArg(args.planId, "planId");
          return {
            plan: updatePlan(ctx, planId, {
              ...(args.title === undefined ? {} : { title: args.title }),
              ...(args.status === undefined ? {} : { status: args.status }),
              ...(args.notes === undefined ? {} : { notes: args.notes }),
            }),
          };
        }
        case "add_cook": {
          const planId = requireArg(args.planId, "planId");
          return {
            cookEvent: addCookEvent(ctx, planId, {
              ...(args.recipeId === undefined ? {} : { recipeId: args.recipeId }),
              ...(args.recipe === undefined ? {} : { recipe: args.recipe }),
              cookDate: requireArg(args.cookDate, "cookDate"),
              ...(args.plannedServings === undefined
                ? {}
                : { plannedServings: args.plannedServings }),
              ...(args.label === undefined ? {} : { label: args.label }),
              ...(args.notes === undefined ? {} : { notes: args.notes }),
            }),
          };
        }
        case "update_cook":
          return {
            cookEvent: updateCookEvent(ctx, requireArg(args.cookEventId, "cookEventId"), {
              ...(args.recipeId === undefined ? {} : { recipeId: args.recipeId }),
              ...(args.recipe === undefined ? {} : { recipe: args.recipe }),
              ...(args.cookDate === undefined ? {} : { cookDate: args.cookDate }),
              ...(args.plannedServings === undefined
                ? {}
                : { plannedServings: args.plannedServings }),
              ...(args.actualServings === undefined
                ? {}
                : { actualServings: args.actualServings }),
              ...(args.label === undefined ? {} : { label: args.label }),
              ...(args.notes === undefined ? {} : { notes: args.notes }),
              ...(args.rating === undefined ? {} : { rating: args.rating }),
            }),
          };
        case "delete_cook": {
          const cookEventId = requireArg(args.cookEventId, "cookEventId");
          return {
            deleted: true,
            ...deleteCookEvent(ctx, cookEventId, { force: args.force === true }),
          };
        }
      }
    }),
  );

  server.registerTool(
    "prep_tasks",
    {
      title: "Prep tasks",
      description:
        "action=list (optionally by plan/date, includeDone), add (planId+dueDate+description), update, complete or delete a prep task.",
      inputSchema: prepTasksInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof prepTasksInput>) => {
      switch (args.action) {
        case "list":
          return listPrepTasks(ctx, {
            ...(args.planId === undefined ? {} : { planId: args.planId }),
            ...(args.from === undefined ? {} : { from: args.from }),
            ...(args.to === undefined ? {} : { to: args.to }),
            ...(args.includeDone === undefined ? {} : { includeDone: args.includeDone }),
          });
        case "add":
          return {
            prepTask: addPrepTask(ctx, requireArg(args.planId, "planId"), {
              dueDate: requireArg(args.dueDate, "dueDate"),
              description: requireArg(args.description, "description"),
              ...(args.cookEventId === undefined ? {} : { cookEventId: args.cookEventId }),
              ...(args.position === undefined ? {} : { position: args.position }),
            }),
          };
        case "update":
          return {
            prepTask: updatePrepTask(ctx, requireArg(args.prepTaskId, "prepTaskId"), {
              ...(args.dueDate === undefined ? {} : { dueDate: args.dueDate }),
              ...(args.description === undefined ? {} : { description: args.description }),
              ...(args.cookEventId === undefined ? {} : { cookEventId: args.cookEventId }),
              ...(args.position === undefined ? {} : { position: args.position }),
            }),
          };
        case "complete":
          return { prepTask: completePrepTask(ctx, requireArg(args.prepTaskId, "prepTaskId")) };
        case "delete":
          return deletePrepTask(ctx, requireArg(args.prepTaskId, "prepTaskId"));
      }
    }),
  );

  server.registerTool(
    "cook_complete",
    {
      title: "Complete, skip or reopen a cook",
      description:
        "action=complete marks the cook done with actual servings/rating and decrements the pantry by the scaled recipe ingredients; skip records it as not cooked; reopen returns it to planned and restores stock.",
      inputSchema: cookCompleteInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof cookCompleteInput>) => {
      switch (args.action) {
        case "complete":
          return completeCookEvent(ctx, args.cookEventId, {
            ...(args.actualServings === undefined ? {} : { actualServings: args.actualServings }),
            ...(args.rating === undefined ? {} : { rating: args.rating }),
            ...(args.notes === undefined ? {} : { notes: args.notes }),
            ...(args.decrementPantry === undefined
              ? {}
              : { decrementPantry: args.decrementPantry }),
          });
        case "skip":
          return {
            cookEvent: skipCookEvent(
              ctx,
              args.cookEventId,
              args.note === undefined ? {} : { note: args.note },
            ),
          };
        case "reopen":
          return reopenCookEvent(ctx, args.cookEventId);
      }
    }),
  );

  server.registerTool(
    "cook_history",
    {
      title: "Cook history",
      description:
        "Recent cook events with recipe, date, servings, rating, notes and their pantry movements, newest cook date first.",
      inputSchema: cookHistoryInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof cookHistoryInput>) =>
      listCookEvents(ctx, { ...args, includeMovements: true }),
    ),
  );

  server.registerTool(
    "availability",
    {
      title: "Stock availability vs planned demand",
      description:
        "Per-ingredient availability (on hand, committed by planned cooks, remaining, comparable flag) for a plan or all planned cooks, plus the aggregated demand lines that produced it. Read-only: nothing is reserved.",
      inputSchema: availabilityInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof availabilityInput>) => ({
      availability: computeAvailability(
        ctx,
        args.mealPlanId === undefined ? {} : { mealPlanId: args.mealPlanId },
      ),
      demand: computeDemand(ctx, {
        ...(args.mealPlanId === undefined ? {} : { mealPlanId: args.mealPlanId }),
        ...(args.from === undefined ? {} : { from: args.from }),
        ...(args.to === undefined ? {} : { to: args.to }),
        ...(args.includeOptional === undefined ? {} : { includeOptional: args.includeOptional }),
      }),
    })),
  );
}
