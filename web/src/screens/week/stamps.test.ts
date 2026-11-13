import { describe, expect, it } from "vitest";
import type { PlanView, Slot } from "./model";
import { palSays, weekStamps } from "./stamps";

function dinner(status: "planned" | "done", extra: Partial<Slot> = {}): Slot {
  return { kind: "meal", isLeftover: false, cookEvent: { status, recipeTitle: "Chili" }, ...extra } as unknown as Slot;
}

function plan(dinners: Record<string, Slot[]>): PlanView {
  return {
    days: Object.entries(dinners).map(([date, slots]) => ({ date, meals: { dinner: slots } })),
  } as unknown as PlanView;
}

const week = plan({
  "2026-11-09": [dinner("done")],
  "2026-11-10": [dinner("planned", { isLeftover: true })],
  "2026-11-11": [dinner("planned")],
  "2026-11-12": [],
});

describe("weekStamps", () => {
  it("stamps cooked dinners and marks tonight, quiet gaps and days ahead", () => {
    expect(weekStamps(week, "2026-11-11").map((s) => s.state)).toEqual(["cooked", "free", "today", "ahead"]);
  });

  it("calls a past planned dinner that was not cooked missed", () => {
    expect(weekStamps(plan({ "2026-11-09": [dinner("planned")] }), "2026-11-10")[0]?.state).toBe("missed");
  });
});

describe("palSays", () => {
  it("is hungry for a planned dinner and cheers once it is cooked", () => {
    expect(palSays(week, "2026-11-11", weekStamps(week, "2026-11-11")).mood).toBe("hungry");
    const done = plan({ "2026-11-11": [dinner("done")] });
    expect(palSays(done, "2026-11-11", weekStamps(done, "2026-11-11")).mood).toBe("cheer");
  });

  it("sleeps when nothing is planned for tonight", () => {
    expect(palSays(week, "2026-11-12", weekStamps(week, "2026-11-12")).mood).toBe("sleepy");
  });
});
