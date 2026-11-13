import { MEAL_LABEL, slotState, type AvailabilityLine, type MealType, type PlanView, type PrepTask, type Slot, type SlotState } from "./model";

export type CoreMeal = Extract<MealType, "breakfast" | "lunch" | "dinner">;

/** Breakfast until 10:30, lunch until 15:00, dinner after. Not editable yet. */
export function mealNow(now: Date): CoreMeal {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 10 * 60 + 30) return "breakfast";
  if (minutes < 15 * 60) return "lunch";
  return "dinner";
}

export interface TodayItem {
  slot: Slot;
  meal: MealType;
  title: string;
  state: SlotState;
}

export interface TodayBrief {
  /** The meal to feature right now. */
  meal: CoreMeal;
  mealLabel: string;
  /** Dishes planned for the featured meal (main first). Empty when nothing is planned. */
  featured: Slot[];
  /** Today's meals that need cooking (not leftovers, not skipped), in meal order. Done ones stay, marked `done`. */
  cooks: TodayItem[];
  /** Today's meals that only need reheating. */
  reheats: TodayItem[];
  /** Open prep tasks due today or overdue. */
  prep: PrepTask[];
}

const ORDER: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];

export function todayBrief(plan: PlanView, today: string, now: Date, prep: readonly PrepTask[]): TodayBrief {
  const meal = mealNow(now);
  const day = plan.days.find((d) => d.date === today);
  const items: TodayItem[] = day
    ? ORDER.flatMap((m) =>
        day.meals[m]
          .filter((s) => s.kind === "meal")
          .map((slot) => ({ slot, meal: m, title: slot.cookEvent?.recipeTitle ?? slot.label ?? "Something simple", state: slotState(slot) })),
      )
    : [];
  const featured = day?.meals[meal] ?? [];
  const main = featured.find((s) => s.kind === "meal") ?? featured[0];
  return {
    meal,
    mealLabel: MEAL_LABEL[meal],
    featured: main ? [main, ...featured.filter((s) => s !== main)] : [],
    cooks: items.filter((i) => !i.slot.isLeftover),
    reheats: items.filter((i) => i.slot.isLeftover),
    prep: prep.filter((t) => !t.done && t.dueDate <= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.position - b.position),
  };
}

/** Ingredients that planned cooks need and the pantry will not cover. Unknown amounts do not count. */
export function shortLines(lines: Iterable<AvailabilityLine>): AvailabilityLine[] {
  return [...lines].filter((l) => (l.comparable && l.available !== null && l.available < 0) || (l.committed !== null && l.committed > 0 && l.onHandStatus === "out"));
}
