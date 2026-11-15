import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, client, errorMessage, qk, unwrap } from "@/api";
import type { PlanView } from "../model";
import type { Draft } from "./draft";
import { initialDraft } from "./model";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

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

/** The plan row for a week that had none: created by the first real edit, never by opening Plan mode. */
async function ensurePlanId(plan: PlanView): Promise<string> {
  if (plan.id) return plan.id;
  try {
    return (await unwrap(client.POST("/plans", { body: { weekStart: plan.weekStart, status: "active" } }))).id;
  } catch (cause) {
    // Created meanwhile (an earlier save, or another device).
    if (cause instanceof ApiError && cause.status === 409) {
      return (await unwrap(client.GET("/plans/{idOrWeekStart}", { params: { path: { idOrWeekStart: plan.weekStart } } }))).id;
    }
    throw cause;
  }
}

/** What the planner shows and does about autosave. */
export interface SaveDraftState {
  status: SaveStatus;
  error: string | null;
  retry: () => void;
  /** After a conflict: drop unsaved edits and take the plan as it is on the server. */
  loadLatest: () => void;
  /** After a conflict: keep the unsaved edits and save them over the server's version. */
  keepMine: () => void;
}

/**
 * Autosave the planner draft; `retry` sends it again after an error. Leaving the planner flushes a pending edit.
 * When the week changes elsewhere (MCP, another device), a clean draft follows it; a draft with unsaved edits
 * stops saving (`conflict`) until the user picks `loadLatest` or `keepMine`, so a stale tab never overwrites it.
 */
export function useSaveDraft(plan: PlanView, draft: Draft, reset: (draft: Draft) => void): SaveDraftState {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const savedOnce = useRef(false);
  const pending = useRef(false);
  const latest = useRef({ plan, draft });
  latest.current = { plan, draft };

  const signature = draftSignature(draft);
  const baseline = draftSignature(initialDraft(plan));
  const dirty = signature !== baseline;
  const [conflict, setConflict] = useState(false);
  const synced = useRef(baseline);
  const sent = useRef(new Set<string>());
  const conflictRef = useRef(false);
  conflictRef.current = conflict;

  /** Sends the latest draft; `live` says whether this planner is still showing the result. */
  const send = async (live: () => boolean) => {
    const { plan: p, draft: d } = latest.current;
    if (conflictRef.current || !draftChanged(d, p)) return;
    if (live()) {
      setStatus("saving");
      setError(null);
    }
    try {
      const id = await ensurePlanId(p);
      await unwrap(
        client.POST("/plans/{id}/draft", {
          params: { path: { id } },
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
      sent.current.add(draftSignature(d));
      // Refetch the week so the plan holds the saved ids; the draft stays on screen.
      for (const root of [qk.plans, qk.shoppingLists, qk.pantry, qk.cookEvents]) {
        void queryClient.invalidateQueries({ queryKey: root });
      }
      if (live()) setStatus("saved");
    } catch (cause) {
      if (live()) {
        setStatus("error");
        setError(errorMessage(cause));
      }
    }
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (baseline === synced.current) return;
    const previous = synced.current;
    synced.current = baseline;
    if (sent.current.has(baseline)) return; // our own save coming back
    const mine = draftSignature(latest.current.draft);
    if (mine === baseline) return;
    if (mine === previous) reset(initialDraft(latest.current.plan)); // nothing unsaved: follow the new plan
    else setConflict(true);
  }, [baseline, reset]);

  useEffect(() => {
    if (!dirty || conflict) {
      pending.current = false;
      if (savedOnce.current) setStatus("saved");
      return;
    }
    let cancelled = false;
    pending.current = true;
    const timer = setTimeout(() => {
      pending.current = false;
      void sendRef.current(() => !cancelled);
    }, SAVE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dirty, conflict, signature, baseline, attempt, plan.id]);

  // Week swipes and "Done" unmount the planner: an edit still waiting out the delay is sent now, not lost.
  useEffect(
    () => () => {
      if (pending.current) void sendRef.current(() => false);
    },
    [],
  );

  return {
    status: conflict ? "conflict" : status,
    error,
    retry: () => setAttempt((n) => n + 1),
    loadLatest: () => {
      reset(initialDraft(latest.current.plan));
      setConflict(false);
    },
    keepMine: () => setConflict(false),
  };
}
