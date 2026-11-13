import { describe, expect, it } from "vitest";
import type { AvailabilityLine, PlanView, PrepTask, Slot } from "./model";
import { mealNow, shortLines, todayBrief } from "./today";

const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m);

function slot(title: string, extra: Partial<Slot> = {}): Slot {
  return { kind: "meal", isLeftover: false, cookEvent: { status: "planned", recipeTitle: title }, ...extra } as unknown as Slot;
}

const plan = {
  days: [
    {
      date: "2026-11-12",
      meals: {
        breakfast: [slot("Overnight Oats")],
        lunch: [slot("Chili", { isLeftover: true })],
        dinner: [slot("Salmon"), { kind: "skip", isLeftover: false, cookEvent: null } as unknown as Slot],
        snack: [],
        dessert: [],
      },
    },
  ],
} as unknown as PlanView;

const task = (id: string, dueDate: string, done = false) => ({ id, dueDate, done, position: 0, description: id }) as unknown as PrepTask;

describe("mealNow", () => {
  it("switches at 10:30 and 15:00", () => {
    expect([at(10, 29), at(10, 30), at(14, 59), at(15)].map(mealNow)).toEqual(["breakfast", "lunch", "lunch", "dinner"]);
  });
});

describe("todayBrief", () => {
  it("splits cooks from reheats, drops skips and features the current meal", () => {
    const brief = todayBrief(plan, "2026-11-12", at(19), []);
    expect(brief.cooks.map((c) => c.title)).toEqual(["Overnight Oats", "Salmon"]);
    expect(brief.reheats.map((c) => c.title)).toEqual(["Chili"]);
    expect(brief.featured.map((s) => s.cookEvent?.recipeTitle)).toEqual(["Salmon", undefined]);
  });

  it("keeps open prep due today or overdue and ignores later or done tasks", () => {
    const prep = [task("late", "2026-11-10"), task("now", "2026-11-12"), task("later", "2026-11-13"), task("done", "2026-11-12", true)];
    expect(todayBrief(plan, "2026-11-12", at(9), prep).prep.map((t) => t.id)).toEqual(["late", "now"]);
  });
});

describe("shortLines", () => {
  const line = (over: Partial<AvailabilityLine>) => ({ comparable: true, available: 1, committed: 1, onHandStatus: "on_hand", ...over }) as AvailabilityLine;
  it("counts negative availability and committed-but-out stock, not unknown amounts", () => {
    const lines = [line({ available: -2 }), line({ comparable: false, available: null, committed: 2, onHandStatus: "out" }), line({ available: null, comparable: false, onHandStatus: "unknown" }), line({})];
    expect(shortLines(lines)).toHaveLength(2);
  });
});
