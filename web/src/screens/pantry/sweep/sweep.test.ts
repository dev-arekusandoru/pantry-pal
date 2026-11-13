import { describe, expect, it } from "vitest";
import type { PantryItem } from "../stock";
import { summaryLine, sweepOrder, type SweepAnswer } from "./sweep";

const item = (name: string, lastVerifiedAt: string | null) =>
  ({ id: name, ingredient: { name }, lastVerifiedAt }) as unknown as PantryItem;

describe("sweepOrder", () => {
  it("puts never-checked items first, then the least recently checked, then by name", () => {
    const items = [item("rice", "2026-11-10T08:00:00.000Z"), item("salt", null), item("beans", "2026-10-01T08:00:00.000Z"), item("flour", null)];
    expect(sweepOrder(items).map((i) => i.id)).toEqual(["flour", "salt", "beans", "rice"]);
  });

  it("does not change the input", () => {
    const items = [item("b", null), item("a", null)];
    sweepOrder(items);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("summaryLine", () => {
  const answer = (choice: SweepAnswer["choice"], listed = choice !== "have"): SweepAnswer => ({ id: choice, choice, listed });

  it("counts swept things and the ones that went on the list", () => {
    expect(summaryLine([answer("have"), answer("low"), answer("out"), answer("out", false)])).toBe(
      "Swept 4 things. 2 went on your shopping list.",
    );
  });

  it("handles one thing, nothing listed and nothing swept", () => {
    expect(summaryLine([answer("have")])).toBe("Swept 1 thing. Nothing went on your shopping list.");
    expect(summaryLine([])).toBe("Nothing swept this time. Come back whenever you like.");
  });
});
