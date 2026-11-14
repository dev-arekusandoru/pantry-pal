import { describe, expect, it } from "vitest";
import type { PlanView } from "../model";
import { addBatch, addEat, moveEat, removeEat, setServings, type Draft } from "./draft";
import { draftChanged, draftSignature } from "./save";

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
