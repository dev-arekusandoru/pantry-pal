import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../auth/middleware.js";
import { AppError } from "../../lib/errors.js";
import {
  addCookEventSchema,
  addPrepTaskSchema,
  completeCookEventSchema,
  cookAdHocSchema,
  cookEventMutationResultSchema,
  cookEventViewSchema,
  createPlanSchema,
  deleteCookEventQuerySchema,
  deleteCookEventResultSchema,
  idResultSchema,
  listCookEventsQuerySchema,
  listCookEventsResponseSchema,
  listPlansQuerySchema,
  listPlansResponseSchema,
  listPrepTasksQuerySchema,
  listPrepTasksResponseSchema,
  planViewSchema,
  prepTaskViewSchema,
  setSlotsResultSchema,
  setSlotsSchema,
  skipCookEventSchema,
  slotViewSchema,
  swapMealResultSchema,
  swapMealSchema,
  updateCookEventSchema,
  updatePlanSchema,
  updatePrepTaskSchema,
  updateSlotSchema,
} from "../../schemas/plans.js";
import {
  addCookEvent,
  addPrepTask,
  completePrepTask,
  createPlan,
  deleteCookEvent,
  deletePlan,
  deletePrepTask,
  deleteSlot,
  getCurrentPlan,
  getPlan,
  listPlans,
  listPrepTasks,
  setSlots,
  swapMeal,
  updateCookEvent,
  updatePlan,
  updatePrepTask,
  updateSlot,
} from "../../services/plans.js";
import {
  completeCookEvent,
  cookAdHoc,
  listCookEvents,
  reopenCookEvent,
  skipCookEvent,
} from "../../services/cooking.js";

const planParam = z.object({ idOrWeekStart: z.string().describe("Plan id or weekStart date.") });
const planIdParam = z.object({ id: z.string().describe("Plan id.") });
const slotParam = z.object({
  id: z.string().describe("Plan id."),
  slotId: z.string().describe("Slot id."),
});
const cookEventParam = z.object({ id: z.string().describe("Cook event id.") });
const prepTaskParam = z.object({ id: z.string().describe("Prep task id.") });

/** JSON response declaration for a route. */
function jsonResponse<T extends z.ZodType>(schema: T, description = "OK") {
  return { description, content: { "application/json": { schema } } };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

const listPlansRoute = createRoute({
  method: "get",
  path: "/plans",
  tags: ["plans"],
  summary: "List week plans",
  request: { query: listPlansQuerySchema },
  responses: { 200: jsonResponse(listPlansResponseSchema) },
});

const createPlanRoute = createRoute({
  method: "post",
  path: "/plans",
  tags: ["plans"],
  summary: "Create a week plan",
  description:
    "Creates the plan, cook events, slots and prep tasks in one transaction. Use cook event keys to wire leftover slots to cooks created in the same call.",
  request: {
    body: { content: { "application/json": { schema: createPlanSchema } } },
  },
  responses: {
    201: jsonResponse(planViewSchema, "Plan created"),
    400: { description: "Invalid input" },
    409: { description: "A plan already exists for that week" },
  },
});

const currentPlanRoute = createRoute({
  method: "get",
  path: "/plans/current",
  tags: ["plans"],
  summary: "Plan for the week containing today",
  responses: {
    200: jsonResponse(planViewSchema),
    404: { description: "No plan for the current week" },
  },
});

const getPlanRoute = createRoute({
  method: "get",
  path: "/plans/{idOrWeekStart}",
  tags: ["plans"],
  summary: "Get a plan grid",
  request: { params: planParam },
  responses: { 200: jsonResponse(planViewSchema), 404: { description: "Plan not found" } },
});

const updatePlanRoute = createRoute({
  method: "patch",
  path: "/plans/{idOrWeekStart}",
  tags: ["plans"],
  summary: "Update plan metadata",
  request: {
    params: planParam,
    body: { content: { "application/json": { schema: updatePlanSchema } } },
  },
  responses: { 200: jsonResponse(planViewSchema), 404: { description: "Plan not found" } },
});

const deletePlanRoute = createRoute({
  method: "delete",
  path: "/plans/{idOrWeekStart}",
  tags: ["plans"],
  summary: "Delete a plan",
  request: { params: planParam },
  responses: { 200: jsonResponse(idResultSchema), 404: { description: "Plan not found" } },
});

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

const setSlotsRoute = createRoute({
  method: "post",
  path: "/plans/{id}/slots",
  tags: ["plans"],
  summary: "Set meal slots for date+mealType groups",
  description:
    "Replaces existing slots for each (date, mealType). Cook specs create a cook event dated that day; leftover specs link an existing cook; freeform/skip need no cook; clear removes the slots. Planned cook events left without slots are deleted and reported.",
  request: {
    params: planIdParam,
    body: { content: { "application/json": { schema: setSlotsSchema } } },
  },
  responses: {
    200: jsonResponse(setSlotsResultSchema),
    400: { description: "Invalid slot operation" },
    404: { description: "Plan not found" },
  },
});

const updateSlotRoute = createRoute({
  method: "patch",
  path: "/plans/{id}/slots/{slotId}",
  tags: ["plans"],
  summary: "Patch one slot",
  request: {
    params: slotParam,
    body: { content: { "application/json": { schema: updateSlotSchema } } },
  },
  responses: {
    200: jsonResponse(slotViewSchema),
    400: { description: "Invalid slot" },
    404: { description: "Plan or slot not found" },
  },
});

const deleteSlotRoute = createRoute({
  method: "delete",
  path: "/plans/{id}/slots/{slotId}",
  tags: ["plans"],
  summary: "Delete one slot",
  request: { params: slotParam },
  responses: { 200: jsonResponse(idResultSchema), 404: { description: "Plan or slot not found" } },
});

const swapMealRoute = createRoute({
  method: "post",
  path: "/plans/{id}/swap",
  tags: ["plans"],
  summary: "Swap the recipe on one meal slot",
  description:
    "One transaction. scope `with_leftovers` replaces the recipe of the cook that feeds the slot (every slot it feeds changes). scope `this` changes only this meal: a slot sharing its cook with other slots becomes its own cook dated that day. Slots without a cook get a new cook. Cooks already done can't be swapped. Returns the updated plan and whether an open shopping list for it is now stale.",
  request: {
    params: planIdParam,
    body: { content: { "application/json": { schema: swapMealSchema } } },
  },
  responses: {
    200: jsonResponse(swapMealResultSchema),
    400: { description: "Invalid swap (e.g. the cook is already done)" },
    404: { description: "Plan, slot or recipe not found" },
  },
});

// ---------------------------------------------------------------------------
// Cook events
// ---------------------------------------------------------------------------

const addCookEventRoute = createRoute({
  method: "post",
  path: "/plans/{id}/cook-events",
  tags: ["cooking"],
  summary: "Add a cook event to a plan",
  request: {
    params: planIdParam,
    body: { content: { "application/json": { schema: addCookEventSchema } } },
  },
  responses: {
    201: jsonResponse(cookEventViewSchema, "Cook event created"),
    400: { description: "Invalid input" },
  },
});

const cookAdHocRoute = createRoute({
  method: "post",
  path: "/cook-events",
  tags: ["cooking"],
  summary: "Record a cook outside any plan",
  description:
    "Creates a cook event with no meal plan. With `complete: true` it is completed in the same transaction (pantry decremented, same as completing a planned cook). Always returns `{ cookEvent, movements, warnings }`; movements and warnings are empty unless completed.",
  request: {
    body: { content: { "application/json": { schema: cookAdHocSchema } } },
  },
  responses: {
    201: jsonResponse(cookEventMutationResultSchema, "Cook recorded"),
    400: { description: "Invalid input" },
    404: { description: "Recipe not found" },
  },
});

const listCookEventsRoute = createRoute({
  method: "get",
  path: "/cook-events",
  tags: ["cooking"],
  summary: "List cook events (history)",
  request: { query: listCookEventsQuerySchema },
  responses: { 200: jsonResponse(listCookEventsResponseSchema) },
});

const updateCookEventRoute = createRoute({
  method: "patch",
  path: "/cook-events/{id}",
  tags: ["cooking"],
  summary: "Update a cook event",
  request: {
    params: cookEventParam,
    body: { content: { "application/json": { schema: updateCookEventSchema } } },
  },
  responses: {
    200: jsonResponse(cookEventViewSchema),
    400: { description: "Invalid input" },
    404: { description: "Cook event not found" },
  },
});

const deleteCookEventRoute = createRoute({
  method: "delete",
  path: "/cook-events/{id}",
  tags: ["cooking"],
  summary: "Delete a cook event",
  request: { params: cookEventParam, query: deleteCookEventQuerySchema },
  responses: {
    200: jsonResponse(deleteCookEventResultSchema),
    404: { description: "Cook event not found" },
    409: { description: "Slots reference the cook; retry with force=true" },
  },
});

const completeCookEventRoute = createRoute({
  method: "post",
  path: "/cook-events/{id}/complete",
  tags: ["cooking"],
  summary: "Complete a cook and decrement the pantry",
  request: {
    params: cookEventParam,
    body: {
      required: false,
      content: { "application/json": { schema: completeCookEventSchema } },
    },
  },
  responses: {
    200: jsonResponse(cookEventMutationResultSchema),
    404: { description: "Cook event not found" },
    409: { description: "Cook already completed or skipped" },
  },
});

const skipCookEventRoute = createRoute({
  method: "post",
  path: "/cook-events/{id}/skip",
  tags: ["cooking"],
  summary: "Skip a planned cook",
  request: {
    params: cookEventParam,
    body: {
      required: false,
      content: { "application/json": { schema: skipCookEventSchema } },
    },
  },
  responses: {
    200: jsonResponse(cookEventViewSchema),
    404: { description: "Cook event not found" },
    409: { description: "Cook already completed or skipped" },
  },
});

const reopenCookEventRoute = createRoute({
  method: "post",
  path: "/cook-events/{id}/reopen",
  tags: ["cooking"],
  summary: "Reopen a completed cook and restore stock",
  request: { params: cookEventParam },
  responses: {
    200: jsonResponse(cookEventMutationResultSchema),
    404: { description: "Cook event not found" },
    409: { description: "Cook is not completed" },
  },
});

// ---------------------------------------------------------------------------
// Prep tasks
// ---------------------------------------------------------------------------

const listPrepTasksRoute = createRoute({
  method: "get",
  path: "/prep-tasks",
  tags: ["prep"],
  summary: "List prep tasks",
  request: { query: listPrepTasksQuerySchema },
  responses: { 200: jsonResponse(listPrepTasksResponseSchema) },
});

const addPrepTaskRoute = createRoute({
  method: "post",
  path: "/plans/{id}/prep-tasks",
  tags: ["prep"],
  summary: "Add a prep task",
  request: {
    params: planIdParam,
    body: { content: { "application/json": { schema: addPrepTaskSchema } } },
  },
  responses: {
    201: jsonResponse(prepTaskViewSchema, "Prep task created"),
    400: { description: "Invalid input" },
    404: { description: "Plan not found" },
  },
});

const updatePrepTaskRoute = createRoute({
  method: "patch",
  path: "/prep-tasks/{id}",
  tags: ["prep"],
  summary: "Update a prep task",
  request: {
    params: prepTaskParam,
    body: { content: { "application/json": { schema: updatePrepTaskSchema } } },
  },
  responses: { 200: jsonResponse(prepTaskViewSchema), 404: { description: "Prep task not found" } },
});

const deletePrepTaskRoute = createRoute({
  method: "delete",
  path: "/prep-tasks/{id}",
  tags: ["prep"],
  summary: "Delete a prep task",
  request: { params: prepTaskParam },
  responses: { 200: jsonResponse(idResultSchema), 404: { description: "Prep task not found" } },
});

const completePrepTaskRoute = createRoute({
  method: "post",
  path: "/prep-tasks/{id}/complete",
  tags: ["prep"],
  summary: "Mark a prep task done",
  request: { params: prepTaskParam },
  responses: { 200: jsonResponse(prepTaskViewSchema), 404: { description: "Prep task not found" } },
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPlansRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listPlansRoute, (c) => c.json(listPlans(c.var.ctx, c.req.valid("query")), 200));

  app.openapi(createPlanRoute, (c) => c.json(createPlan(c.var.ctx, c.req.valid("json")), 201));

  app.openapi(currentPlanRoute, (c) => c.json(getCurrentPlan(c.var.ctx), 200));
  app.openapi(getPlanRoute, (c) => c.json(getPlan(c.var.ctx, c.req.valid("param").idOrWeekStart), 200));
  app.openapi(updatePlanRoute, (c) =>
    c.json(updatePlan(c.var.ctx, c.req.valid("param").idOrWeekStart, c.req.valid("json")), 200),
  );
  app.openapi(deletePlanRoute, (c) =>
    c.json(deletePlan(c.var.ctx, c.req.valid("param").idOrWeekStart), 200),
  );

  app.openapi(setSlotsRoute, (c) =>
    c.json(setSlots(c.var.ctx, c.req.valid("param").id, c.req.valid("json").ops), 200),
  );
  app.openapi(updateSlotRoute, (c) => {
    const { id: planId, slotId } = c.req.valid("param");
    assertSlotInPlan(planId, slotId, c.var.ctx);
    return c.json(updateSlot(c.var.ctx, slotId, c.req.valid("json")), 200);
  });
  app.openapi(deleteSlotRoute, (c) => {
    const { id: planId, slotId } = c.req.valid("param");
    assertSlotInPlan(planId, slotId, c.var.ctx);
    return c.json(deleteSlot(c.var.ctx, slotId), 200);
  });
  app.openapi(swapMealRoute, (c) => {
    const { id: planId } = c.req.valid("param");
    return c.json(swapMeal(c.var.ctx, planId, c.req.valid("json")), 200);
  });

  app.openapi(addCookEventRoute, (c) =>
    c.json(addCookEvent(c.var.ctx, c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.openapi(cookAdHocRoute, (c) => c.json(cookAdHoc(c.var.ctx, c.req.valid("json")), 201));
  app.openapi(listCookEventsRoute, (c) =>
    c.json(listCookEvents(c.var.ctx, c.req.valid("query")), 200),
  );
  app.openapi(updateCookEventRoute, (c) =>
    c.json(updateCookEvent(c.var.ctx, c.req.valid("param").id, c.req.valid("json")), 200),
  );
  app.openapi(deleteCookEventRoute, (c) => {
    const query = c.req.valid("query");
    return c.json(
      deleteCookEvent(c.var.ctx, c.req.valid("param").id, { force: query.force === "true" }),
      200,
    );
  });
  app.openapi(completeCookEventRoute, (c) =>
    c.json(
      completeCookEvent(c.var.ctx, c.req.valid("param").id, c.req.valid("json") ?? {}),
      200,
    ),
  );
  app.openapi(skipCookEventRoute, (c) =>
    c.json(skipCookEvent(c.var.ctx, c.req.valid("param").id, c.req.valid("json") ?? {}), 200),
  );
  app.openapi(reopenCookEventRoute, (c) =>
    c.json(reopenCookEvent(c.var.ctx, c.req.valid("param").id), 200),
  );

  app.openapi(listPrepTasksRoute, (c) =>
    c.json(listPrepTasks(c.var.ctx, c.req.valid("query")), 200),
  );
  app.openapi(addPrepTaskRoute, (c) =>
    c.json(addPrepTask(c.var.ctx, c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.openapi(updatePrepTaskRoute, (c) =>
    c.json(updatePrepTask(c.var.ctx, c.req.valid("param").id, c.req.valid("json")), 200),
  );
  app.openapi(deletePrepTaskRoute, (c) =>
    c.json(deletePrepTask(c.var.ctx, c.req.valid("param").id), 200),
  );
  app.openapi(completePrepTaskRoute, (c) =>
    c.json(completePrepTask(c.var.ctx, c.req.valid("param").id), 200),
  );
}

function assertSlotInPlan(
  planId: string,
  slotId: string,
  ctx: AppEnv["Variables"]["ctx"],
): void {
  const plan = getPlan(ctx, planId);
  const found = plan.days.some((day) =>
    Object.values(day.meals).some((slots) => slots.some((slot) => slot.id === slotId)),
  );
  if (!found) {
    throw new AppError("not_found", `Slot ${slotId} not found in plan ${planId}`, {
      planId,
      slotId,
    });
  }
}
