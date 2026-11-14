import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { client, errorMessage, qk, unwrap } from "@/api";
import type { PlanView } from "../model";
import type { Draft } from "./draft";
import { initialDraft } from "./model";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** How long the draft stops changing before it is sent. */
const SAVE_DELAY_MS = 700;

/**
 * Everything a save changes, as a string that stays the same across refetches:
 * server ids are left out because a saved draft comes back with new ones.
 */
export function draftSignature(draft: Draft): string {
  // Sorted: the server rebuilds the week in date order, so a reloaded plan lists
  // eats in a different order than the draft that was typed. Empty cooks are not
  // saved, so they do not count either.
  const meals = draft.batches
    .filter((b) => b.eats.length > 0)
    .map((b) =>
      JSON.stringify([
        b.recipeId,
        b.cookDate,
        b.servings,
        b.eats.map((e) => [e.date, e.mealType, e.servings]).sort(),
      ]),
    )
    .sort();
  const notes = draft.notes
    .map((n) => JSON.stringify([n.date, n.mealType, n.kind, n.label]))
    .sort();
  return JSON.stringify([meals, notes]);
}

/** True when the draft differs from the plan last loaded from the server. */
export function draftChanged(draft: Draft, plan: PlanView): boolean {
  // Same normalization as the planner draft, so opening Plan mode is not a change.
  return draftSignature(draft) !== draftSignature(initialDraft(plan));
}

/** Autosave the planner draft; `retry` sends it again after an error. */
export function useSaveDraft(plan: PlanView, draft: Draft) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const savedOnce = useRef(false);
  const latest = useRef({ plan, draft });
  latest.current = { plan, draft };

  const signature = draftSignature(draft);
  const baseline = draftSignature(initialDraft(plan));
  const dirty = signature !== baseline;

  useEffect(() => {
    if (!dirty) {
      if (savedOnce.current) setStatus("saved");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { plan: p, draft: d } = latest.current;
      if (!draftChanged(d, p)) return;
      setStatus("saving");
      setError(null);
      try {
        await unwrap(
          client.POST("/plans/{id}/draft", {
            params: { path: { id: p.id } },
            body: {
              batches: d.batches.filter((b) => b.eats.length > 0).map((b) => ({
                id: b.id,
                recipeId: b.recipeId,
                cookDate: b.cookDate,
                servings: b.servings,
                eats: b.eats.map((e) => ({
                  id: e.id,
                  date: e.date,
                  mealType: e.mealType,
                  servings: e.servings,
                })),
              })),
              notes: d.notes.map((n) => ({
                id: n.id,
                date: n.date,
                mealType: n.mealType,
                kind: n.kind,
                label: n.label,
              })),
            },
          }),
        );
        savedOnce.current = true;
        // Refetch the week so the plan holds the saved ids; the draft stays on screen.
        for (const root of [qk.plans, qk.shoppingLists, qk.pantry, qk.cookEvents]) {
          void queryClient.invalidateQueries({ queryKey: root });
        }
        if (!cancelled) setStatus("saved");
      } catch (cause) {
        if (!cancelled) {
          setStatus("error");
          setError(errorMessage(cause));
        }
      }
    }, SAVE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dirty, signature, baseline, attempt, plan.id, queryClient]);

  return {
    status,
    error,
    retry: () => setAttempt((n) => n + 1),
  };
}
