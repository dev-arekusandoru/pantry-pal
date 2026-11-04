import type { components, paths } from "@/api";
import type { EmojiCode } from "@/ui/emoji";
import { addDays, daysBetween, weekdayName } from "./dates";

export type PlanView = paths["/plans/current"]["get"]["responses"][200]["content"]["application/json"];
export type PlanDay = PlanView["days"][number];
export type Slot = PlanDay["meals"]["dinner"][number];
export type CookEvent = PlanView["cookEvents"][number];
export type PrepTask = PlanView["prepTasks"][number];
export type MealType = components["schemas"]["MealType"];
export type RecipeSummary = components["schemas"]["RecipeSummary"];
export type AvailabilityLine = components["schemas"]["AvailabilityLine"];

export const CORE_MEALS: readonly MealType[] = ["breakfast", "lunch", "dinner"];
const MEAL_ORDER: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  dessert: "Dessert",
};

export const MEAL_EMOJI: Record<MealType, EmojiCode> = {
  breakfast: "1F373",
  lunch: "1F96A",
  dinner: "1F35D",
  snack: "1F34E",
  dessert: "1F370",
};

export interface MealGroup {
  mealType: MealType;
  slots: Slot[];
}

/** Breakfast, lunch and dinner always show (empty ones offer "Plan something"); snack and dessert only when planned. */
export function mealGroups(day: PlanDay): MealGroup[] {
  return MEAL_ORDER.filter((m) => CORE_MEALS.includes(m) || day.meals[m].length > 0).map((mealType) => ({
    mealType,
    slots: day.meals[mealType],
  }));
}

function allSlots(plan: PlanView): Slot[] {
  return plan.days.flatMap((d) => MEAL_ORDER.flatMap((m) => d.meals[m]));
}

function slotsFedBy(plan: PlanView, cookEventId: string): Slot[] {
  return allSlots(plan).filter((s) => s.cookEventId === cookEventId);
}

/** "Mon dinner" */
export function slotName(slot: Slot): string {
  return `${weekdayName(slot.date, "short")} ${slot.mealType}`;
}

/**
 * Small line under a slot's title: where leftovers come from, or which meals a
 * cook night also feeds. Null when there is nothing to say.
 */
export function slotNote(slot: Slot, plan: PlanView): string | null {
  const cook = slot.cookEvent;
  if (slot.kind !== "meal" || !cook) return null;
  const fed = slotsFedBy(plan, cook.id);
  if (slot.isLeftover) {
    // The earliest meal a cook feeds is the first time it is eaten, not a leftover.
    const first = fed[0];
    return first?.id === slot.id ? `Made ${weekdayName(cook.cookDate)}` : `Leftovers from ${weekdayName(cook.cookDate)}`;
  }
  const later = fed.filter((s) => s.id !== slot.id);
  if (later.length === 0) return null;
  if (later.length <= 2) return `Also feeds ${later.map(slotName).join(" and ")}`;
  return `Also feeds ${later.length} more meals`;
}

export type SlotState = "planned" | "done" | "skipped";

/** Done/skipped styling applies to the cook night; leftovers of a finished cook are still to be eaten. */
export function slotState(slot: Slot): SlotState {
  const status = slot.cookEvent?.status;
  if (status === "skipped") return "skipped";
  if (status === "done" && !slot.isLeftover) return "done";
  return "planned";
}

export interface SwapPlan {
  canSwap: boolean;
  /** The slot's cook feeds other meals and can still change: ask "just this" or "and leftovers". */
  askScope: boolean;
  /** Every slot the cook feeds, for the scope description. */
  fed: Slot[];
}

/** Mirrors the server's swap rules (a done cook only detaches its leftover slots). */
export function swapPlanFor(slot: Slot, plan: PlanView): SwapPlan {
  const cook = slot.cookEvent;
  if (!cook) return { canSwap: true, askScope: false, fed: [] };
  const view = plan.cookEvents.find((c) => c.id === cook.id);
  const fed = slotsFedBy(plan, cook.id);
  if (cook.status === "done") return { canSwap: slot.isLeftover, askScope: false, fed };
  return { canSwap: true, askScope: cook.status === "planned" && (view?.fedSlots ?? fed.length) > 1, fed };
}

/** Today's dinner: a planned meal first, then whatever else is there. */
export function tonightSlot(plan: PlanView, today: string): Slot | null {
  const dinners = plan.days.find((d) => d.date === today)?.meals.dinner ?? [];
  return dinners.find((s) => s.kind === "meal") ?? dinners[0] ?? null;
}

const NUDGE_WINDOW_PAST_DAYS = 3;
const NUDGE_WINDOW_AHEAD_DAYS = 7;

/** Query window for prep tasks worth nudging about. */
export function nudgeWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -NUDGE_WINDOW_PAST_DAYS), to: addDays(today, NUDGE_WINDOW_AHEAD_DAYS) };
}

/**
 * The prep task to nudge about: due today or later first (soonest), then the
 * most recently overdue. Done tasks are ignored. `rest` counts the others.
 */
export function pickNextPrep(tasks: readonly PrepTask[], today: string): { next: PrepTask; rest: number } | null {
  const open = tasks.filter((t) => !t.done);
  const byOrder = (a: PrepTask, b: PrepTask) => a.position - b.position;
  const upcoming = open.filter((t) => t.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || byOrder(a, b));
  const overdue = open.filter((t) => t.dueDate < today).sort((a, b) => b.dueDate.localeCompare(a.dueDate) || byOrder(a, b));
  const next = upcoming[0] ?? overdue[0];
  return next ? { next, rest: open.length - 1 } : null;
}

/** "Due today", "Due tomorrow", "Due Thursday", "Overdue since Sunday". */
export function prepDueLabel(task: PrepTask, today: string): string {
  const diff = daysBetween(today, task.dueDate);
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff > 1) return `Due ${weekdayName(task.dueDate)}`;
  if (diff === -1) return "Was due yesterday";
  return `Overdue since ${weekdayName(task.dueDate)}`;
}

/** How many non-optional ingredients the pantry already covers. */
export function pantryCoverage(
  ingredients: ReadonlyArray<{ ingredientId: string; optional: boolean }>,
  availability: ReadonlyMap<string, AvailabilityLine>,
): { have: number; total: number } {
  const required = ingredients.filter((i) => !i.optional);
  const have = required.filter((i) => {
    const line = availability.get(i.ingredientId);
    if (!line || line.onHandStatus === "out") return false;
    // Stock that is already committed to other planned cooks does not count.
    return line.available === null || line.available > 0;
  }).length;
  return { have, total: required.length };
}
