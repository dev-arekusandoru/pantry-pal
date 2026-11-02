import { describe, expect, it } from "vitest";
import type { Ctx } from "../src/context.js";
import type { ErrorCode } from "../src/lib/errors.js";
import { AppError } from "../src/lib/errors.js";
import {
  addPrepTask,
  addSlot,
  completePrepTask,
  createPlan,
  deleteCookEvent,
  deletePlan,
  deleteSlot,
  getCurrentPlan,
  getPlan,
  listPlans,
  listPrepTasks,
  setSlots,
  updatePlan,
  updateSlot,
} from "../src/services/plans.js";
import { createRecipe } from "../src/services/recipes.js";
import { skipCookEvent } from "../src/services/cooking.js";
import { makeTestCtx } from "./helpers.js";

function expectAppError(fn: () => unknown, code: ErrorCode): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe(code);
    return appError;
  }
  throw new Error(`Expected an AppError with code ${code}`);
}

function emptyRecipe(ctx: Ctx, title: string, leftoverDays?: number) {
  return createRecipe(ctx, {
    title,
    servings: 2,
    ...(leftoverDays === undefined ? {} : { leftoverDays }),
  });
}

describe("createPlan", () => {
  it("wires keyed cook events to leftover slots and builds the week grid", () => {
    const { ctx } = makeTestCtx();
    const chili = emptyRecipe(ctx, "Chili");

    const plan = createPlan(ctx, {
      weekStart: "2026-11-02",
      title: "Week of Nov 2",
      status: "active",
      cookEvents: [
        {
          key: "chili",
          recipeId: chili.id,
          cookDate: "2026-11-01",
          plannedServings: 4,
          label: "Sunday batch",
        },
      ],
      slots: [
        { date: "2026-11-02", mealType: "dinner", kind: "meal", cookEventKey: "chili", servings: 2 },
        { date: "2026-11-03", mealType: "lunch", kind: "meal", cookEventKey: "chili", servings: 2 },
        { date: "2026-11-04", mealType: "dinner", kind: "freeform", label: "Fridge clean-out" },
        { date: "2026-11-05", mealType: "dinner", kind: "skip", label: "Eating out" },
      ],
    });

    expect(plan.weekStart).toBe("2026-11-02");
    expect(plan.days).toHaveLength(7);
    expect(plan.days.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);

    expect(plan.cookEvents).toHaveLength(1);
    const event = plan.cookEvents[0]!;
    expect(event.recipeTitle).toBe("Chili");
    expect(event.status).toBe("planned");
    expect(event.plannedServings).toBe(4);
    expect(event.fedSlots).toBe(2);
    expect(event.servingsAllocated).toBe(4);
    expect(event.servingsRemaining).toBe(0);

    const dinner = plan.days[0]!.meals.dinner[0]!;
    expect(dinner.kind).toBe("meal");
    expect(dinner.cookEventId).toBe(event.id);
    expect(dinner.cookEvent?.recipeTitle).toBe("Chili");
    expect(dinner.isLeftover).toBe(true);
    expect(dinner.servings).toBe(2);

    const nextLunch = plan.days[1]!.meals.lunch[0]!;
    expect(nextLunch.isLeftover).toBe(true);
    expect(plan.days[2]!.meals.dinner[0]!.kind).toBe("freeform");
    expect(plan.days[2]!.meals.dinner[0]!.label).toBe("Fridge clean-out");
    expect(plan.days[3]!.meals.dinner[0]!.kind).toBe("skip");

    expect(plan.warnings).toEqual([]);
  });

  it("defaults planned servings from household settings and the first fed meal type", () => {
    const { ctx } = makeTestCtx({
      settings: { defaultServings: 3, lunchBatchServings: 6, dinnerServings: 5 },
    });
    const a = emptyRecipe(ctx, "Eggs");
    const b = emptyRecipe(ctx, "Salad");
    const c = emptyRecipe(ctx, "Pancakes");
    const d = emptyRecipe(ctx, "Soup");

    const plan = createPlan(ctx, {
      weekStart: "2026-11-02",
      cookEvents: [
        { key: "dinner", recipeId: a.id, cookDate: "2026-11-02", label: "dinner cook" },
        { key: "lunch", recipeId: b.id, cookDate: "2026-11-02", label: "lunch cook" },
        { key: "breakfast", recipeId: c.id, cookDate: "2026-11-02", label: "breakfast cook" },
        { key: "unfed", recipeId: d.id, cookDate: "2026-11-03", label: "unfed cook" },
      ],
      slots: [
        { date: "2026-11-02", mealType: "dinner", kind: "meal", cookEventKey: "dinner" },
        { date: "2026-11-02", mealType: "lunch", kind: "meal", cookEventKey: "lunch" },
        { date: "2026-11-02", mealType: "breakfast", kind: "meal", cookEventKey: "breakfast" },
      ],
    });

    const byLabel = new Map(plan.cookEvents.map((event) => [event.label, event]));
    expect(byLabel.get("dinner cook")?.plannedServings).toBe(5);
    expect(byLabel.get("lunch cook")?.plannedServings).toBe(6);
    expect(byLabel.get("breakfast cook")?.plannedServings).toBe(3);
    expect(byLabel.get("unfed cook")?.plannedServings).toBe(3);
  });

  it("rejects a weekStart that does not align with the household week start", () => {
    const { ctx } = makeTestCtx();
    expectAppError(() => createPlan(ctx, { weekStart: "2026-11-03" }), "validation");
  });

  it("rejects a second plan for the same week", () => {
    const { ctx } = makeTestCtx();
    createPlan(ctx, { weekStart: "2026-11-02" });
    expectAppError(() => createPlan(ctx, { weekStart: "2026-11-02" }), "conflict");
  });

  it("rejects slots with an unknown cook event key", () => {
    const { ctx } = makeTestCtx();
    expectAppError(
      () =>
        createPlan(ctx, {
          weekStart: "2026-11-02",
          slots: [
            { date: "2026-11-02", mealType: "dinner", kind: "meal", cookEventKey: "missing" },
          ],
        }),
      "validation",
    );
  });
});

describe("setSlots", () => {
  it("replaces the slots at a date+mealType and deletes orphaned planned cooks", () => {
    const { ctx } = makeTestCtx();
    const stew = emptyRecipe(ctx, "Stew");
    const plan = createPlan(ctx, { weekStart: "2026-11-02" });

    const created = setSlots(ctx, plan.id, [
      { date: "2026-11-02", mealType: "dinner", spec: { kind: "cook", recipeId: stew.id, servings: 2 } },
    ]);
    expect(created.slots).toHaveLength(1);
    const eventId = created.slots[0]!.cookEventId!;
    expect(eventId).toBeTruthy();
    expect(created.deletedCookEventIds).toEqual([]);

    const replaced = setSlots(ctx, plan.id, [
      { date: "2026-11-02", mealType: "dinner", spec: { kind: "freeform", label: "Takeout" } },
    ]);
    expect(replaced.deletedCookEventIds).toEqual([eventId]);
    expect(replaced.slots).toHaveLength(1);
    expect(replaced.slots[0]!.kind).toBe("freeform");
    expect(replaced.slots[0]!.label).toBe("Takeout");

    const view = getPlan(ctx, plan.id);
    expect(view.cookEvents).toHaveLength(0);
    expect(view.days[0]!.meals.dinner).toHaveLength(1);

    const cleared = setSlots(ctx, plan.id, [
      { date: "2026-11-02", mealType: "dinner", spec: { kind: "clear" } },
    ]);
    expect(cleared.slots).toHaveLength(0);
    expect(getPlan(ctx, plan.id).days[0]!.meals.dinner).toHaveLength(0);
  });

  it("links leftover slots to an existing cook event", () => {
    const { ctx } = makeTestCtx();
    const stew = emptyRecipe(ctx, "Stew");
    const plan = createPlan(ctx, { weekStart: "2026-11-02" });

    const created = setSlots(ctx, plan.id, [
      { date: "2026-11-02", mealType: "dinner", spec: { kind: "cook", recipeId: stew.id, servings: 2 } },
    ]);
    const eventId = created.slots[0]!.cookEventId!;

    const leftovers = setSlots(ctx, plan.id, [
      { date: "2026-11-03", mealType: "lunch", spec: { kind: "leftover", cookEventId: eventId, servings: 1 } },
    ]);
    expect(leftovers.slots[0]!.cookEventId).toBe(eventId);
    expect(leftovers.slots[0]!.isLeftover).toBe(true);
    expect(leftovers.slots[0]!.servings).toBe(1);
  });
});

describe("getPlan warnings", () => {
  it("flags over-allocation, expired leftovers, slots before their cook and skipped cooks", () => {
    const { ctx } = makeTestCtx();
    const stew = emptyRecipe(ctx, "Stew", 1);
    const roast = emptyRecipe(ctx, "Roast", 3);

    const plan = createPlan(ctx, {
      weekStart: "2026-11-02",
      cookEvents: [
        { key: "stew", recipeId: stew.id, cookDate: "2026-11-02", plannedServings: 2 },
        { key: "roast", recipeId: roast.id, cookDate: "2026-11-05", plannedServings: 2 },
      ],
      slots: [
        { date: "2026-11-02", mealType: "dinner", kind: "meal", cookEventKey: "stew", servings: 2 },
        { date: "2026-11-04", mealType: "lunch", kind: "meal", cookEventKey: "stew", servings: 1 },
        { date: "2026-11-03", mealType: "dinner", kind: "meal", cookEventKey: "roast", servings: 1 },
      ],
    });

    const warnings = plan.warnings.join("\n");
    expect(warnings).toContain("feeds 3 servings but only yields 2");
    expect(warnings).toContain("beyond the recipe's 1-day leftover window");
    expect(warnings).toContain("is dated before its cook event");

    const roastEvent = plan.cookEvents.find((event) => event.recipeTitle === "Roast")!;
    skipCookEvent(ctx, roastEvent.id);

    const skippedWarnings = getPlan(ctx, plan.id).warnings.join("\n");
    expect(skippedWarnings).toContain("which is skipped");
  });
});

describe("plan lookups", () => {
  it("finds the current plan by the household week start", () => {
    const { ctx } = makeTestCtx();
    const plan = createPlan(ctx, { weekStart: "2026-10-26" });

    expect(getCurrentPlan(ctx).id).toBe(plan.id);
    expect(getPlan(ctx, "2026-10-26").id).toBe(plan.id);
    expect(listPlans(ctx).items.map((item) => item.id)).toEqual([plan.id]);
  });

  it("throws not_found when the current week has no plan", () => {
    const { ctx } = makeTestCtx();
    expectAppError(() => getCurrentPlan(ctx), "not_found");
  });

  it("updates and deletes a plan", () => {
    const { ctx } = makeTestCtx();
    const plan = createPlan(ctx, { weekStart: "2026-11-02", title: "Old", notes: "notes" });

    const updated = updatePlan(ctx, plan.id, { title: "New", status: "active", notes: null });
    expect(updated.title).toBe("New");
    expect(updated.status).toBe("active");
    expect(updated.notes).toBeNull();

    deletePlan(ctx, plan.weekStart);
    expectAppError(() => getPlan(ctx, plan.id), "not_found");
    expect(listPlans(ctx).items).toHaveLength(0);
  });
});

describe("low-level slots", () => {
  it("validates slot kinds and clears the cook when switching away from meal", () => {
    const { ctx } = makeTestCtx();
    const plan = createPlan(ctx, { weekStart: "2026-11-02" });

    expectAppError(
      () => addSlot(ctx, plan.id, { date: "2026-11-02", mealType: "dinner", kind: "meal" }),
      "validation",
    );
    expectAppError(
      () =>
        addSlot(ctx, plan.id, {
          date: "2026-11-09",
          mealType: "dinner",
          kind: "freeform",
          label: "Outside the week",
        }),
      "validation",
    );

    const slot = addSlot(ctx, plan.id, {
      date: "2026-11-02",
      mealType: "dinner",
      kind: "freeform",
      label: "Takeout",
    });
    const updated = updateSlot(ctx, slot.id, { kind: "skip", label: "Eating out" });
    expect(updated.kind).toBe("skip");
    expect(updated.cookEventId).toBeNull();
    expect(updated.label).toBe("Eating out");

    deleteSlot(ctx, slot.id);
    expect(getPlan(ctx, plan.id).days[0]!.meals.dinner).toHaveLength(0);
  });
});

describe("cook event deletion", () => {
  it("rejects deleting a cooked event with slots, then unassigns them with force", () => {
    const { ctx } = makeTestCtx();
    const stew = emptyRecipe(ctx, "Stew");
    const plan = createPlan(ctx, {
      weekStart: "2026-11-02",
      cookEvents: [
        { key: "stew", recipeId: stew.id, cookDate: "2026-11-02", plannedServings: 2 },
      ],
      slots: [
        { date: "2026-11-02", mealType: "dinner", kind: "meal", cookEventKey: "stew", servings: 2 },
      ],
    });
    const eventId = plan.cookEvents[0]!.id;

    const error = expectAppError(() => deleteCookEvent(ctx, eventId), "conflict");
    expect(error.details?.slotIds).toHaveLength(1);

    const result = deleteCookEvent(ctx, eventId, { force: true });
    expect(result.affectedSlotIds).toHaveLength(1);

    const view = getPlan(ctx, plan.id);
    expect(view.cookEvents).toHaveLength(0);
    const slot = view.days[0]!.meals.dinner[0]!;
    expect(slot.kind).toBe("freeform");
    expect(slot.label).toBe("unassigned");
    expect(slot.cookEventId).toBeNull();
  });
});

describe("prep tasks", () => {
  it("creates, completes and filters prep tasks", () => {
    const { ctx } = makeTestCtx();
    const plan = createPlan(ctx, {
      weekStart: "2026-11-02",
      prepTasks: [{ dueDate: "2026-11-02", description: "Soak beans" }],
    });
    expect(plan.prepTasks).toHaveLength(1);
    expect(plan.prepTasks[0]!.done).toBe(false);

    const task = addPrepTask(ctx, plan.id, { dueDate: "2026-11-03", description: "Chop veg" });
    expect(listPrepTasks(ctx, { planId: plan.id }).items).toHaveLength(2);
    expect(listPrepTasks(ctx, { planId: plan.id, from: "2026-11-03" }).items).toHaveLength(1);

    const done = completePrepTask(ctx, task.id);
    expect(done.done).toBe(true);
    expect(done.doneAt).not.toBeNull();

    expect(listPrepTasks(ctx, { planId: plan.id }).items).toHaveLength(1);
    expect(listPrepTasks(ctx, { planId: plan.id, includeDone: true }).items).toHaveLength(2);
  });
});
