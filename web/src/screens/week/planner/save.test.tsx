import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PlanView } from "../model";
import { addBatch, addEat, moveEat, removeEat, setServings, type Draft } from "./draft";
import { initialDraft, emptyPlan } from "./model";
import { draftChanged, draftSignature, useSaveDraft } from "./save";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/api", async (orig) => ({ ...(await orig<typeof import("@/api")>()), client: { POST: post } }));

const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

/** The plan a server would return for a draft; ids differ from the draft's on purpose. */
function serverPlan(draft: Draft): PlanView {
  let n = 0;
  return {
    id: "plan-1",
    weekStart: draft.weekStart,
    days: days.map((date) => ({
      date,
      meals: Object.fromEntries(
        ["breakfast", "lunch", "dinner", "snack", "dessert"].map((mealType) => [
          mealType,
          [
            ...draft.batches.flatMap((b) =>
              b.eats
                .filter((e) => e.date === date && e.mealType === mealType)
                .map((e) => ({
                  id: `slot-${++n}`,
                  date,
                  mealType,
                  kind: "meal",
                  cookEventId: b.id,
                  servings: e.servings,
                })),
            ),
            ...draft.notes
              .filter((note) => note.date === date && note.mealType === mealType)
              .map((note) => ({
                id: `slot-${++n}`,
                date,
                mealType,
                kind: note.kind,
                cookEventId: null,
                label: note.label,
              })),
          ],
        ]),
      ),
    })),
    cookEvents: draft.batches.map((b) => ({
      id: b.id,
      recipeId: b.recipeId,
      recipeTitle: b.title,
      cookDate: b.cookDate,
      plannedServings: b.servings,
      status: "planned",
    })),
    prepTasks: [],
    warnings: [],
  } as unknown as PlanView;
}

const empty: Draft = { weekStart: days[0]!, days, batches: [], notes: [] };

function planned() {
  const d = addBatch(empty, { id: "r1", title: "Chili" }, days[1]!, "dinner");
  return addBatch(d, { id: "r2", title: "Soup" }, days[3]!, "lunch");
}

describe("draft save diff", () => {
  it("treats a saved draft as unchanged even when the server assigns new ids", () => {
    const draft = planned();
    const saved = draft.batches.map((b) => ({ ...b, id: `cook-${b.id}`, eats: b.eats.map((e) => ({ ...e, id: `slot-${e.id}` })) }));
    expect(draftChanged({ ...draft, batches: saved }, serverPlan(draft))).toBe(false);
  });

  it("sees a moved eat, a servings change and a removal", () => {
    const draft = planned();
    const plan = serverPlan(draft);
    const [first, second] = draft.batches;
    expect(draftChanged(moveEat(draft, first!.id, first!.eats[0]!.id, days[5]!, "dinner"), plan)).toBe(true);
    expect(draftChanged(setServings(draft, first!.id, 6), plan)).toBe(true);
    expect(draftChanged(removeEat(draft, second!.id, second!.eats[0]!.id), plan)).toBe(true);
  });

  it("ignores the order eats were added in and cooks with no meals", () => {
    const d = addBatch(empty, { id: "r1", title: "Chili" }, days[1]!, "dinner");
    const two = addEat(d, d.batches[0]!.id, days[3]!, "lunch");
    const [batch] = two.batches;
    const reversed: Draft = { ...two, batches: [{ ...batch!, eats: [...batch!.eats].reverse() }] };
    expect(draftSignature(reversed)).toBe(draftSignature(two));
    expect(draftChanged(reversed, serverPlan(two))).toBe(false);
    expect(draftSignature({ ...empty, batches: [{ ...batch!, eats: [] }] })).toBe(draftSignature(empty));
  });
});

describe("empty week", () => {
  it("opening Plan mode on a week with no plan is not a change, so nothing gets created", () => {
    const plan = emptyPlan("2027-03-01");
    expect(plan.id).toBe("");
    expect(plan.days).toHaveLength(7);
    expect(draftChanged(initialDraft(plan), plan)).toBe(false);
  });

  it("the first placed dish is a change", () => {
    const plan = emptyPlan("2027-03-01");
    const draft = addBatch(initialDraft(plan), { id: "r1", title: "Chili" }, "2027-03-01", "dinner");
    expect(draftChanged(draft, plan)).toBe(true);
  });
});

describe("useSaveDraft when the week changes elsewhere", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  const elsewhere = serverPlan(addBatch(empty, { id: "r9", title: "Tacos" }, days[2]!, "dinner"));

  function open(draft: Draft, plan: PlanView) {
    const reset = vi.fn();
    const hook = renderHook(({ d, p }) => useSaveDraft(p, d, reset), { wrapper, initialProps: { d: draft, p: plan } });
    return { hook, reset };
  }

  it("follows the new plan when nothing is unsaved", () => {
    const { hook, reset } = open(initialDraft(serverPlan(empty)), serverPlan(empty));
    hook.rerender({ d: initialDraft(serverPlan(empty)), p: elsewhere });
    expect(reset).toHaveBeenCalledOnce();
    expect(hook.result.current.status).not.toBe("conflict");
  });

  it("stops saving and asks when there are unsaved edits", async () => {
    post.mockClear();
    vi.useFakeTimers();
    const mine = addBatch(empty, { id: "r1", title: "Chili" }, days[1]!, "dinner");
    const { hook, reset } = open(mine, serverPlan(empty));
    hook.rerender({ d: mine, p: elsewhere });
    expect(hook.result.current.status).toBe("conflict");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(post).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    act(() => hook.result.current.loadLatest());
    expect(reset).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
