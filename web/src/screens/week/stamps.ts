import type { PalMood } from "@/ui";
import { slotState, tonightDinner, type PlanView } from "./model";

export type StampState = "cooked" | "today" | "missed" | "ahead" | "free";

export interface Stamp {
  date: string;
  state: StampState;
}

/** One stamp per plan day: a dinner cooked that day earns it. Past days without one are "missed" quietly. */
export function weekStamps(plan: PlanView, today: string): Stamp[] {
  return plan.days.map((day) => {
    const dinners = day.meals.dinner;
    const cooked = dinners.some((s) => slotState(s) === "done");
    const state: StampState = cooked
      ? "cooked"
      : day.date === today
        ? "today"
        : day.date < today
          ? dinners.length > 0 && dinners.some((s) => s.kind === "meal" && !s.isLeftover)
            ? "missed"
            : "free"
          : "ahead";
    return { date: day.date, state };
  });
}

/** What Pal feels and says, from tonight's dinner and the stamp count. */
export function palSays(plan: PlanView, today: string, stamps: readonly Stamp[]): { mood: PalMood; line: string } {
  const cooked = stamps.filter((s) => s.state === "cooked").length;
  const [main] = tonightDinner(plan, today);
  if (stamps.find((s) => s.date === today)?.state === "cooked") {
    return { mood: "cheer", line: `Dinner is done! That is ${cooked} of ${stamps.length} this week.` };
  }
  if (main?.kind === "meal" && !main.isLeftover) {
    return { mood: "hungry", line: `I am hungry for ${main.cookEvent?.recipeTitle ?? "dinner"}. Shall we cook?` };
  }
  if (!main) return { mood: "sleepy", line: "No dinner is planned for tonight. Pick one when you are ready." };
  return { mood: "happy", line: `${cooked} of ${stamps.length} dinners cooked this week.` };
}
