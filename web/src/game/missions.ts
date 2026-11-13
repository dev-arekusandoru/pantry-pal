import { useCallback, useEffect, useState } from "react";
import type { DoneCook } from "./history";
import { addDays } from "@/screens/week/dates";
import { slotState, type PlanView } from "@/screens/week/model";

export interface WeekMission {
  id: "dinners" | "new" | "prep";
  title: string;
  hint: string;
  done: boolean;
  progress: number;
  target: number;
}

/** Derives this week's gentle checklist from the plan and completed-cook history. */
export function weekMissions(plan: PlanView, history: readonly DoneCook[], today: string): WeekMission[] {
  const weekEnd = addDays(plan.weekStart, 7);
  const homeDinnerDays = plan.days.filter((day) =>
    day.meals.dinner.some((slot) => slot.kind === "meal" && !slot.isLeftover),
  );
  const cookedDinners = homeDinnerDays.filter((day) =>
    day.meals.dinner.some((slot) => slot.kind === "meal" && !slot.isLeftover && slotState(slot) === "done"),
  ).length;
  const missions: WeekMission[] = [];

  if (homeDinnerDays.length > 0) {
    const nightsLeft = plan.days.filter((day) => day.date >= today).length;
    const needed = homeDinnerDays.length - cookedDinners;
    const hint = needed > nightsLeft
      ? `${needed} more ${needed === 1 ? "dinner" : "dinners"}, ${nightsLeft} ${nightsLeft === 1 ? "night" : "nights"} left. You can do it.`
      : "";
    missions.push({
      id: "dinners",
      title: `Cook ${homeDinnerDays.length} dinners at home`,
      hint,
      done: cookedDinners >= homeDinnerDays.length,
      progress: cookedDinners,
      target: homeDinnerDays.length,
    });
  }

  const plannedCooks = plan.cookEvents.filter(
    (cook) => cook.cookDate >= plan.weekStart && cook.cookDate < weekEnd && cook.status !== "skipped",
  );
  if (plannedCooks.length > 0) {
    const previouslyCooked = new Set(history.filter((cook) => cook.cookDate < plan.weekStart).map((cook) => cook.recipeId));
    const isNew = plannedCooks.some(
      (cook) => cook.status === "done" && !previouslyCooked.has(cook.recipeId),
    );
    missions.push({ id: "new", title: "Try something new", hint: "", done: isNew ? true : false, progress: isNew ? 1 : 0, target: 1 });
  }

  if (plan.prepTasks.length > 0) {
    const completed = plan.prepTasks.filter((task) => task.done).length;
    missions.push({
      id: "prep",
      title: "Finish the week's prep",
      hint: "",
      done: completed === plan.prepTasks.length,
      progress: completed,
      target: plan.prepTasks.length,
    });
  }

  return missions;
}

function readTreat(weekStart: string): boolean {
  try {
    return localStorage.getItem(`pantrypal.treat.${weekStart}`) === "used";
  } catch {
    return false;
  }
}

/** Tracks a cosmetic, per-browser treat use for one plan week. */
export function useTreat(weekStart: string, earned: boolean): { earned: boolean; spent: boolean; spend: () => void } {
  const [state, setState] = useState(() => ({ weekStart, spent: readTreat(weekStart) }));
  useEffect(() => setState({ weekStart, spent: readTreat(weekStart) }), [weekStart]);
  const spend = useCallback(() => {
    if (!earned || (state.weekStart === weekStart && state.spent)) return;
    try {
      localStorage.setItem(`pantrypal.treat.${weekStart}`, "used");
      setState({ weekStart, spent: true });
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }, [earned, state, weekStart]);
  return { earned, spent: state.weekStart === weekStart && state.spent, spend };
}
