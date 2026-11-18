import { createContext, useContext } from "react";
import type { MealType, RecipeSummary } from "../model";
import type { Draft, DraftBatch, DraftEat, DraftNote } from "./draft";
import type { Item, Target } from "./model";

export interface Editing {
  batchId: string;
  /** "cook" or the id of the eat the popover hangs off. */
  key: string;
}

export interface GridCtx {
  draft: Draft;
  recipes: Map<string, RecipeSummary> | undefined;
  today: string;
  /** Batch whose chips are lit up (hover or focus). */
  hot: string | null;
  setHot: (id: string | null) => void;
  dragging: boolean;
  /** Tap-to-place selection. */
  selected: Item | null;
  editing: Editing | null;
  edit: (e: Editing | null) => void;
  /** Note being renamed in place; `fresh` = just placed, so cancelling removes it. */
  renaming: { id: string; fresh: boolean } | null;
  rename: (id: string) => void;
  commitRename: (id: string, label: string) => void;
  cancelRename: () => void;
  place: (item: Item, target: Target, shift: boolean) => void;
  removeEat: (b: DraftBatch, e: DraftEat) => void;
  removeBatch: (b: DraftBatch) => void;
  removeNote: (n: DraftNote) => void;
  setServings: (batchId: string, servings: number | null) => void;
  setCook: (batchId: string, date: string) => void;
  toggleEat: (b: DraftBatch, date: string, meal: MealType) => void;
  startMove: (item: Item) => void;
}

export const Ctx = createContext<GridCtx | null>(null);

export function useGrid(): GridCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useGrid outside Planner");
  return c;
}
