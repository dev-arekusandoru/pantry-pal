import { ingredientEmoji, type EmojiCode } from "@/ui";
import { weekdayName } from "../dates";
import type { MealType, RecipeSummary } from "../model";
import { DEFAULT_EAT_SERVINGS, draftFromPlan, type PlannerProps, type Draft, type DraftBatch, type DraftEat, type DraftNote } from "./draft";

/** Anything that can be dragged, or picked up with "Place" and put down with a tap. */
export type Item =
  | { type: "recipe"; recipe: RecipeSummary }
  | { type: "note"; key: string; kind: DraftNote["kind"]; label: string; icon: EmojiCode }
  | { type: "eat"; batchId: string; eatId: string }
  | { type: "cook"; batchId: string }
  | { type: "placed-note"; noteId: string };

export type Target = { type: "meal"; date: string; meal: MealType } | { type: "cook"; date: string };

/** An empty slot is a blank cell, not a card: skips and "Unplanned" placeholders from the real plan are dropped. */
export function initialDraft(plan: PlannerProps["plan"]): Draft {
  const d = draftFromPlan(plan);
  return { ...d, notes: d.notes.filter((n) => n.kind !== "skip" && n.label.trim().toLowerCase() !== "unplanned") };
}

/** Some icon files read as blanks at chip size (pancake is a plain disc); those titles get a clearer icon. */
const RECIPE_ICONS: Record<string, EmojiCode> = { pancakes: "croissant" };
export const recipeIcon = (title: string): EmojiCode => RECIPE_ICONS[title.toLowerCase()] ?? ingredientEmoji(title);

const NOTE_ICONS: Record<string, EmojiCode> = { "Eat out": "french-fries", "Fridge clean-out": "milk" };
export const noteIcon = (n: { kind: DraftNote["kind"]; label: string }): EmojiCode => (n.kind === "skip" ? "empty-bowl" : (NOTE_ICONS[n.label] ?? "clay-pot"));

export function sameItem(a: Item, b: Item): boolean {
  switch (a.type) {
    case "recipe":
      return b.type === "recipe" && b.recipe.id === a.recipe.id;
    case "note":
      return b.type === "note" && b.key === a.key;
    case "eat":
      return b.type === "eat" && b.eatId === a.eatId;
    case "cook":
      return b.type === "cook" && b.batchId === a.batchId;
    case "placed-note":
      return b.type === "placed-note" && b.noteId === a.noteId;
  }
}

export function itemName(item: Item, d: Draft): string {
  switch (item.type) {
    case "recipe":
      return item.recipe.title;
    case "note":
      return item.label || "Write your own";
    case "eat":
    case "cook":
      return d.batches.find((b) => b.id === item.batchId)?.title ?? "this meal";
    case "placed-note":
      return d.notes.find((n) => n.id === item.noteId)?.label ?? "this note";
  }
}

export const firstEatDate = (b: DraftBatch): string => b.eats.reduce((m, e) => (e.date < m ? e.date : m), b.eats[0]?.date ?? b.cookDate);

/** "feeds Tue·Wed·Thu" */
export function feedsLine(b: DraftBatch): string {
  const days = [...new Set(b.eats.map((e) => e.date))].sort();
  return `feeds ${days.map((d) => weekdayName(d, "short")).join("·")}`;
}

const autoServings = (eats: DraftEat[]) => eats.reduce((n, e) => n + (e.servings ?? DEFAULT_EAT_SERVINGS), 0);

/** Undo for a removed batch. */
export function restoreBatch(d: Draft, batch: DraftBatch): Draft {
  if (d.batches.some((b) => b.id === batch.id)) return d;
  return { ...d, batches: [...d.batches, { ...batch, servings: batch.servingsSet ? batch.servings : autoServings(batch.eats) }] };
}

/** Undo for a removed eat. */
export function restoreEat(d: Draft, batch: DraftBatch, eat: DraftEat): Draft {
  if (!d.batches.some((b) => b.id === batch.id)) return restoreBatch(d, { ...batch, eats: [eat] });
  return {
    ...d,
    batches: d.batches.map((b) => {
      if (b.id !== batch.id) return b;
      const eats = [...b.eats, eat];
      return { ...b, eats, servings: b.servingsSet ? b.servings : autoServings(eats) };
    }),
  };
}
