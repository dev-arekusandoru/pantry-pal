import { addDays, daysBetween } from "../dates";
import type { MealType, PlanView, RecipeSummary } from "../model";

/** What the hosting page passes the planner. */
export interface PlannerProps {
  plan: PlanView;
  /** Recipe drawer source; undefined while loading. */
  recipes: Map<string, RecipeSummary> | undefined;
  today: string;
}

/** One eating occasion fed by a batch. */
export interface DraftEat {
  id: string;
  date: string;
  mealType: MealType;
  /** Servings eaten here; null = the household default. */
  servings: number | null;
}

/** A cook (one recipe, one cook day) and the eats it feeds. */
export interface DraftBatch {
  id: string;
  recipeId: string;
  title: string;
  /** May fall before the plan week (Sunday batch for a Monday-start week). Never after the first eat. */
  cookDate: string;
  servings: number;
  /** True once someone typed a servings number; auto-sum stops. */
  servingsSet: boolean;
  /** Stable 0..5 colour index so a batch's cook chip and eat chips match. */
  hue: number;
  eats: DraftEat[];
}

/** Freeform ("Eat out") or skip, placed in one meal cell. */
export interface DraftNote {
  id: string;
  date: string;
  mealType: MealType;
  kind: "freeform" | "skip";
  label: string;
}

export interface Draft {
  weekStart: string;
  /** The 7 plan dates. */
  days: string[];
  batches: DraftBatch[];
  notes: DraftNote[];
}

/** Servings per eat when a slot has none. */
export const DEFAULT_EAT_SERVINGS = 2;

let seq = 0;
const newId = (prefix: string) => `${prefix}-draft-${++seq}`;

/** Snapshot the real plan into a local draft. Variants edit drafts only; nothing is saved. */
export function draftFromPlan(plan: PlanView): Draft {
  const days = plan.days.map((d) => d.date);
  const batches = plan.cookEvents
    .filter((c) => c.status !== "skipped")
    .map<DraftBatch>((c, i) => ({
      id: c.id,
      recipeId: c.recipeId,
      title: c.recipeTitle,
      cookDate: c.cookDate,
      servings: c.plannedServings,
      servingsSet: true,
      hue: i % 6,
      eats: [],
    }));
  const byId = new Map(batches.map((b) => [b.id, b]));
  const notes: DraftNote[] = [];
  for (const day of plan.days) {
    for (const [mealType, slots] of Object.entries(day.meals) as [MealType, typeof day.meals.dinner][]) {
      for (const s of slots) {
        const batch = s.cookEventId ? byId.get(s.cookEventId) : undefined;
        if (s.kind === "meal" && batch) {
          batch.eats.push({ id: s.id, date: s.date, mealType, servings: s.servings });
        } else if (s.kind !== "meal") {
          notes.push({ id: s.id, date: s.date, mealType, kind: s.kind, label: s.label ?? (s.kind === "skip" ? "Skip" : "") });
        }
      }
    }
  }
  return { weekStart: plan.weekStart, days, batches, notes };
}

const eatTotal = (eats: DraftEat[]) => eats.reduce((n, e) => n + (e.servings ?? DEFAULT_EAT_SERVINGS), 0);
const firstEat = (eats: DraftEat[]) => eats.reduce<string | null>((min, e) => (min === null || e.date < min ? e.date : min), null);

function withBatch(draft: Draft, id: string, fn: (b: DraftBatch) => DraftBatch | null): Draft {
  const batches = draft.batches.flatMap((b) => {
    if (b.id !== id) return [b];
    const next = fn(b);
    if (!next || next.eats.length === 0) return [];
    return [{ ...next, servings: next.servingsSet ? next.servings : eatTotal(next.eats) }];
  });
  return { ...draft, batches };
}

/** Drop a recipe on a meal cell: a new batch cooked that day, eaten there. Stacks with what's already in the cell. */
export function addBatch(draft: Draft, recipe: { id: string; title: string }, date: string, mealType: MealType): Draft {
  const eats = [{ id: newId("eat"), date, mealType, servings: null }];
  const hue = draft.batches.length % 6;
  const batch: DraftBatch = { id: newId("cook"), recipeId: recipe.id, title: recipe.title, cookDate: date, servings: eatTotal(eats), servingsSet: false, hue, eats };
  return { ...draft, batches: [...draft.batches, batch] };
}

/** Another eat of an existing batch (drag a batch onto a cell). Pulls the cook day earlier when needed. */
export function addEat(draft: Draft, batchId: string, date: string, mealType: MealType): Draft {
  return withBatch(draft, batchId, (b) => ({
    ...b,
    cookDate: date < b.cookDate ? date : b.cookDate,
    eats: [...b.eats, { id: newId("eat"), date, mealType, servings: null }],
  }));
}

/** Move one eat. Only that eat moves; the cook day moves earlier if the eat lands before it. */
export function moveEat(draft: Draft, batchId: string, eatId: string, date: string, mealType: MealType): Draft {
  return withBatch(draft, batchId, (b) => ({
    ...b,
    cookDate: date < b.cookDate ? date : b.cookDate,
    eats: b.eats.map((e) => (e.id === eatId ? { ...e, date, mealType } : e)),
  }));
}

/**
 * Move the cook day. Default: eats stay, and a cook day after the first eat is refused (returns the draft unchanged).
 * `whole`: shift every eat by the same number of days; eats that would leave the week are refused.
 */
export function moveCook(draft: Draft, batchId: string, date: string, whole = false): Draft {
  const b = draft.batches.find((x) => x.id === batchId);
  if (!b) return draft;
  if (!whole) {
    const first = firstEat(b.eats);
    return first !== null && date > first ? draft : withBatch(draft, batchId, (x) => ({ ...x, cookDate: date }));
  }
  const shift = daysBetween(b.cookDate, date);
  const eats = b.eats.map((e) => ({ ...e, date: addDays(e.date, shift) }));
  if (eats.some((e) => !draft.days.includes(e.date))) return draft;
  return withBatch(draft, batchId, (x) => ({ ...x, cookDate: date, eats }));
}

/** The X on an eat. Removing the last eat removes the batch. */
export function removeEat(draft: Draft, batchId: string, eatId: string): Draft {
  return withBatch(draft, batchId, (b) => ({ ...b, eats: b.eats.filter((e) => e.id !== eatId) }));
}

export function removeBatch(draft: Draft, batchId: string): Draft {
  return withBatch(draft, batchId, () => null);
}

/** Typed servings; null returns to the auto sum of eats. */
export function setServings(draft: Draft, batchId: string, servings: number | null): Draft {
  return withBatch(draft, batchId, (b) => (servings === null ? { ...b, servingsSet: false } : { ...b, servings, servingsSet: true }));
}

export function addNote(draft: Draft, kind: DraftNote["kind"], label: string, date: string, mealType: MealType): Draft {
  return { ...draft, notes: [...draft.notes, { id: newId("note"), date, mealType, kind, label }] };
}

export function moveNote(draft: Draft, noteId: string, date: string, mealType: MealType): Draft {
  return { ...draft, notes: draft.notes.map((n) => (n.id === noteId ? { ...n, date, mealType } : n)) };
}
