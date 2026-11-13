import { addDays, localToday } from "@/screens/week/dates";
import type { PantryItem } from "../stock";

export type SweepChoice = "have" | "low" | "out";

export interface SweepAnswer {
  id: string;
  choice: SweepChoice | "skip";
  /** False once the add to the shopping list failed, so the summary stays honest. */
  listed: boolean;
  /** The snooze this answer replaced, so undo can put it back. */
  previousSnooze?: string;
}

/** Days an item stays out of later sweeps after each answer. Skip leaves no snooze. */
export const SNOOZE_DAYS: Record<SweepChoice, number> = { have: 3, low: 7, out: 7 };

/** Pantry item id -> first local date (YYYY-MM-DD) it may show up in a sweep again. */
export type Snoozes = Record<string, string>;

const SNOOZE_KEY = "pantrypal.sweep.snooze";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const snoozeUntil = (choice: SweepChoice, today: string): string => addDays(today, SNOOZE_DAYS[choice]);

/** Entries still in force on `today`; expired and malformed ones are dropped. */
export function activeSnoozes(snoozes: Snoozes, today: string): Snoozes {
  return Object.fromEntries(Object.entries(snoozes).filter(([, until]) => DATE.test(until) && until > today));
}

export function readSnoozes(today = localToday()): Snoozes {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "{}");
    const stored = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Snoozes) : {};
    const active = activeSnoozes(stored, today);
    if (Object.keys(active).length !== Object.keys(stored).length) writeSnoozes(active);
    return active;
  } catch {
    return {};
  }
}

export function writeSnoozes(snoozes: Snoozes): void {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozes));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

/** Set (or, with `until` undefined, clear) one item's snooze. */
export function setSnooze(id: string, until: string | undefined): void {
  const { [id]: _old, ...rest } = readSnoozes();
  writeSnoozes(until === undefined ? rest : { ...rest, [id]: until });
}

/** Fisher-Yates on a copy. `random` is injectable so tests can fix the order. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Every item that is not snoozed on `now`'s date, in the order `shuffle` gives. */
export function pickDeck(
  items: readonly PantryItem[],
  snoozes: Snoozes,
  now: Date,
  shuffle: (items: PantryItem[]) => PantryItem[] = shuffled,
): PantryItem[] {
  const today = localToday(now);
  return shuffle(items.filter((item) => !((snoozes[item.id] ?? "") > today)));
}

export const answerCount = (answers: readonly SweepAnswer[]): number => answers.filter((a) => a.choice !== "skip").length;

export function summaryLine(answers: readonly SweepAnswer[]): string {
  const swept = answerCount(answers);
  if (swept === 0) return "Nothing swept this time. Come back whenever you like.";
  const listed = answers.filter((a) => a.listed).length;
  const sweptText = `Swept ${swept} ${swept === 1 ? "thing" : "things"}.`;
  return listed === 0 ? `${sweptText} Nothing went on your shopping list.` : `${sweptText} ${listed} went on your shopping list.`;
}
