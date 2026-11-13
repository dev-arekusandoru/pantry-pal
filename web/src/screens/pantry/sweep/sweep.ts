import type { PantryItem } from "../stock";

export const SWEEP_SECONDS = 60;

export type SweepChoice = "have" | "low" | "out";

export interface SweepAnswer {
  id: string;
  choice: SweepChoice;
  /** False once the add to the shopping list failed, so the summary stays honest. */
  listed: boolean;
}

/** Never-checked items first, then the longest since checked; ties by name. */
export function sweepOrder(items: readonly PantryItem[]): PantryItem[] {
  const checked = (i: PantryItem) => i.lastVerifiedAt ?? "";
  return [...items].sort(
    (a, b) => (checked(a) < checked(b) ? -1 : checked(a) > checked(b) ? 1 : 0) || a.ingredient.name.localeCompare(b.ingredient.name),
  );
}

export function summaryLine(answers: readonly SweepAnswer[]): string {
  const swept = answers.length;
  if (swept === 0) return "Nothing swept this time. Come back whenever you like.";
  const listed = answers.filter((a) => a.listed).length;
  const sweptText = `Swept ${swept} ${swept === 1 ? "thing" : "things"}.`;
  return listed === 0 ? `${sweptText} Nothing went on your shopping list.` : `${sweptText} ${listed} went on your shopping list.`;
}
