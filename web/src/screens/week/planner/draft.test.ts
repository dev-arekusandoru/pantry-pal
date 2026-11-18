import { describe, expect, it } from "vitest";
import { addBatch, addEat, moveCook, moveEat, removeEat, setServings, type Draft } from "./draft";

const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
const empty: Draft = { weekStart: days[0]!, days, batches: [], notes: [] };
const chili = { id: "r1", title: "Chili" };

function batchOn(date: string) {
  const d = addBatch(empty, chili, date, "dinner");
  return { d, b: d.batches[0]! };
}

describe("planner draft rules", () => {
  it("auto-sums servings over eats until typed", () => {
    const { d, b } = batchOn(days[1]!);
    const two = addEat(d, b.id, days[3]!, "lunch");
    expect(two.batches[0]!.servings).toBe(4);
    const typed = setServings(two, b.id, 10);
    expect(addEat(typed, b.id, days[4]!, "lunch").batches[0]!.servings).toBe(10);
  });

  it("pulls the cook day earlier when an eat moves before it", () => {
    const { d, b } = batchOn(days[3]!);
    const moved = moveEat(d, b.id, b.eats[0]!.id, days[1]!, "dinner");
    expect(moved.batches[0]!.cookDate).toBe(days[1]);
  });

  it("refuses a cook day after the first eat; whole-batch moves shift eats", () => {
    const { d, b } = batchOn(days[1]!);
    expect(moveCook(d, b.id, days[2]!)).toBe(d);
    expect(moveCook(d, b.id, "2026-11-08").batches[0]!.cookDate).toBe("2026-11-08");
    const whole = moveCook(d, b.id, days[2]!, true).batches[0]!;
    expect(whole.eats[0]!.date).toBe(days[2]);
    expect(moveCook(d, b.id, "2026-11-16", true)).toBe(d);
  });

  it("removes the batch with its last eat", () => {
    const { d, b } = batchOn(days[1]!);
    expect(removeEat(d, b.id, b.eats[0]!.id).batches).toEqual([]);
  });
});
