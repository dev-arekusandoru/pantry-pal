import { describe, expect, it } from "vitest";
import { localToday, weekStartFor } from "./dates";
import { pantryCoverage, pickNextPrep, prepDueLabel, swapPlanFor, type AvailabilityLine, type PlanView, type PrepTask, type Slot } from "./model";

function task(id: string, dueDate: string, position = 0, done = false): PrepTask {
  return { id, dueDate, position, done, description: id } as PrepTask;
}

describe("dates", () => {
  it("uses the local calendar date, not UTC", () => {
    expect(localToday(new Date(2026, 10, 2, 23, 30))).toBe("2026-11-02");
    expect(localToday(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
  });

  it("finds the week start for any weekStartsOn", () => {
    expect(weekStartFor("2026-11-04", 1)).toBe("2026-11-02"); // Wed -> Mon
    expect(weekStartFor("2026-11-02", 1)).toBe("2026-11-02");
    expect(weekStartFor("2026-11-08", 1)).toBe("2026-11-02"); // Sun belongs to the Monday week
    expect(weekStartFor("2026-11-04", 0)).toBe("2026-11-01"); // Sunday start
  });
});

describe("pickNextPrep", () => {
  const today = "2026-11-03";

  it("prefers today/upcoming over overdue, soonest first", () => {
    const picked = pickNextPrep([task("old", "2026-11-01"), task("later", "2026-11-05"), task("now", "2026-11-03", 1)], today);
    expect(picked?.next.id).toBe("now");
    expect(picked?.rest).toBe(2);
  });

  it("falls back to the most recently overdue task and skips done ones", () => {
    const picked = pickNextPrep([task("a", "2026-10-31"), task("b", "2026-11-02"), task("c", "2026-11-03", 0, true)], today);
    expect(picked?.next.id).toBe("b");
  });

  it("returns null when nothing is open", () => {
    expect(pickNextPrep([task("c", "2026-11-03", 0, true)], today)).toBeNull();
  });

  it("labels due dates", () => {
    expect(prepDueLabel(task("a", "2026-11-03"), today)).toBe("Due today");
    expect(prepDueLabel(task("a", "2026-11-04"), today)).toBe("Due tomorrow");
    expect(prepDueLabel(task("a", "2026-11-02"), today)).toBe("Was due yesterday");
  });
});

describe("pantryCoverage", () => {
  const line = (over: Partial<AvailabilityLine>): AvailabilityLine =>
    ({ onHandStatus: "on_hand", available: 1, ...over }) as AvailabilityLine;
  const stock = new Map<string, AvailabilityLine>([
    ["rice", line({})],
    ["milk", line({ onHandStatus: "out", available: 0 })],
    ["salt", line({ onHandStatus: "unknown", available: null })],
    ["beef", line({ available: -2 })],
  ]);

  it("counts stocked, unmeasured, and uncommitted ingredients; ignores optional ones", () => {
    const ingredients = [
      { ingredientId: "rice", optional: false },
      { ingredientId: "milk", optional: false },
      { ingredientId: "salt", optional: false },
      { ingredientId: "beef", optional: false },
      { ingredientId: "basil", optional: false },
      { ingredientId: "parsley", optional: true },
    ];
    expect(pantryCoverage(ingredients, stock)).toEqual({ have: 2, total: 5 });
  });
});

describe("swapPlanFor", () => {
  function plan(cook: { status: "planned" | "done" | "skipped"; fedSlots: number }): { plan: PlanView; slot: Slot } {
    const slot = {
      id: "s1",
      cookEventId: "c1",
      isLeftover: false,
      cookEvent: { id: "c1", status: cook.status },
    } as Slot;
    const other = { ...slot, id: "s2", isLeftover: true } as Slot;
    const meals = { breakfast: [], lunch: [], dinner: [slot, ...(cook.fedSlots > 1 ? [other] : [])], snack: [], dessert: [] };
    return {
      slot,
      plan: { days: [{ date: "2026-11-02", meals }], cookEvents: [{ id: "c1", fedSlots: cook.fedSlots }] } as unknown as PlanView,
    };
  }

  it("asks for scope only when a planned cook feeds several meals", () => {
    const multi = plan({ status: "planned", fedSlots: 2 });
    expect(swapPlanFor(multi.slot, multi.plan)).toMatchObject({ canSwap: true, askScope: true });
    const single = plan({ status: "planned", fedSlots: 1 });
    expect(swapPlanFor(single.slot, single.plan)).toMatchObject({ canSwap: true, askScope: false });
  });

  it("blocks swapping the night of a finished cook", () => {
    const done = plan({ status: "done", fedSlots: 2 });
    expect(swapPlanFor(done.slot, done.plan).canSwap).toBe(false);
    const leftover = { ...done.slot, isLeftover: true } as Slot;
    expect(swapPlanFor(leftover, done.plan)).toMatchObject({ canSwap: true, askScope: false });
  });
});
