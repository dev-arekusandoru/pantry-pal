import { describe, expect, it } from "vitest";
import type { DoneCook } from "./history";
import { weekMissions } from "./missions";
import type { PlanView, Slot } from "@/screens/week/model";

function dinner(status: "planned" | "done", extra: Partial<Slot> = {}): Slot {
  return { kind: "meal", isLeftover: false, cookEvent: { status, recipeTitle: "Chili" }, ...extra } as unknown as Slot;
}

function plan(overrides: Record<string, unknown> = {}): PlanView {
  return {
    weekStart: "2026-11-09",
    days: [
      { date: "2026-11-09", meals: { dinner: [dinner("done")] } },
      { date: "2026-11-10", meals: { dinner: [dinner("planned")] } },
      { date: "2026-11-11", meals: { dinner: [dinner("planned", { isLeftover: true })] } },
      { date: "2026-11-12", meals: { dinner: [dinner("planned")] } },
    ],
    cookEvents: [
      { recipeId: "new-recipe", cookDate: "2026-11-09", status: "done" },
      { recipeId: "old-recipe", cookDate: "2026-11-10", status: "planned" },
    ],
    prepTasks: [{ done: false }, { done: true }],
    ...overrides,
  } as unknown as PlanView;
}

const history: DoneCook[] = [
  { recipeId: "old-recipe", recipeTitle: "Soup", cookDate: "2026-11-01" },
];

describe("weekMissions", () => {
  it("counts cooked home dinners, flags a gentle at-risk nudge and recognizes a new recipe", () => {
    const missions = weekMissions(plan(), history, "2026-11-12");
    expect(missions).toEqual([
      { id: "dinners", title: "Cook 3 dinners at home", hint: "2 more dinners, 1 night left. You can do it.", done: false, progress: 1, target: 3 },
      { id: "new", title: "Try something new", hint: "", done: true, progress: 1, target: 1 },
      { id: "prep", title: "Finish the week's prep", hint: "", done: false, progress: 1, target: 2 },
    ]);
  });

  it("omits missions without home dinners, planned cooks or prep tasks", () => {
    expect(weekMissions(plan({
      days: [{ date: "2026-11-09", meals: { dinner: [dinner("planned", { isLeftover: true })] } }],
      cookEvents: [],
      prepTasks: [],
    }), history, "2026-11-09")).toEqual([]);
  });

  it("marks dinner and prep missions done without at-risk hints", () => {
    const result = weekMissions(plan({
      days: [
        { date: "2026-11-09", meals: { dinner: [dinner("done")] } },
        { date: "2026-11-10", meals: { dinner: [dinner("done")] } },
      ],
      prepTasks: [{ done: true }],
    }), history, "2026-11-09");
    expect(result[0]).toMatchObject({ done: true, progress: 2, target: 2, hint: "" });
    expect(result[2]).toMatchObject({ done: true, progress: 1, target: 1 });
  });
});
