import { afterEach, describe, expect, it } from "vitest";
import type { PantryItem } from "../stock";
import { activeSnoozes, pickDeck, readSnoozes, setSnooze, shuffled, snoozeUntil, summaryLine, type SweepAnswer } from "./sweep";

const item = (id: string) => ({ id, ingredient: { name: id } }) as unknown as PantryItem;
const NOW = new Date(2026, 10, 12, 9, 0);

describe("shuffled", () => {
  it("is a permutation that follows the random source and leaves the input alone", () => {
    const input = [1, 2, 3, 4];
    expect(shuffled(input, () => 0)).toEqual([2, 3, 4, 1]);
    expect(shuffled(input, () => 0.999)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4]);
    expect([...shuffled([5, 6, 7, 8, 9])].sort()).toEqual([5, 6, 7, 8, 9]);
  });
});

describe("snoozes", () => {
  afterEach(() => localStorage.clear());

  it("snoozes 7 days for low and out, 3 for have", () => {
    expect(snoozeUntil("low", "2026-11-12")).toBe("2026-11-19");
    expect(snoozeUntil("out", "2026-11-12")).toBe("2026-11-19");
    expect(snoozeUntil("have", "2026-11-12")).toBe("2026-11-15");
  });

  it("drops entries that ended today or earlier, and malformed ones", () => {
    expect(activeSnoozes({ a: "2026-11-12", b: "2026-11-13", c: "soon", d: "2026-01-01" }, "2026-11-12")).toEqual({ b: "2026-11-13" });
  });

  it("prunes expired entries from storage on read and sets and clears one", () => {
    localStorage.setItem("pantrypal.sweep.snooze", JSON.stringify({ old: "2026-11-01", kept: "2026-11-20" }));
    expect(readSnoozes("2026-11-12")).toEqual({ kept: "2026-11-20" });
    expect(JSON.parse(localStorage.getItem("pantrypal.sweep.snooze") ?? "")).toEqual({ kept: "2026-11-20" });
    setSnooze("x", "2999-01-01");
    expect(Object.keys(readSnoozes()).sort()).toEqual(["kept", "x"]);
    setSnooze("x", undefined);
    expect(Object.keys(readSnoozes())).toEqual(["kept"]);
  });

  it("survives garbage in storage", () => {
    localStorage.setItem("pantrypal.sweep.snooze", "[1,");
    expect(readSnoozes()).toEqual({});
    localStorage.setItem("pantrypal.sweep.snooze", "[]");
    expect(readSnoozes()).toEqual({});
  });
});

describe("pickDeck", () => {
  const items = [item("a"), item("b"), item("c")];

  it("leaves out items snoozed past today and shuffles the rest", () => {
    const deck = pickDeck(items, { a: "2026-11-13", b: "2026-11-12" }, NOW, (list) => list.reverse());
    expect(deck.map((i) => i.id)).toEqual(["c", "b"]);
  });

  it("keeps everything when nothing is snoozed and does not change the input", () => {
    expect(pickDeck(items, {}, NOW, (list) => list)).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("summaryLine", () => {
  const answer = (choice: SweepAnswer["choice"], listed = choice === "low" || choice === "out"): SweepAnswer => ({ id: choice, choice, listed });

  it("counts swept things and the ones that went on the list", () => {
    expect(summaryLine([answer("have"), answer("low"), answer("out"), answer("out", false)])).toBe(
      "Swept 4 things. 2 went on your shopping list.",
    );
  });

  it("handles one thing, nothing listed and nothing swept", () => {
    expect(summaryLine([answer("have")])).toBe("Swept 1 thing. Nothing went on your shopping list.");
    expect(summaryLine([])).toBe("Nothing swept this time. Come back whenever you like.");
  });

  it("does not count skips", () => {
    expect(summaryLine([answer("skip"), answer("have")])).toBe("Swept 1 thing. Nothing went on your shopping list.");
    expect(summaryLine([answer("skip")])).toBe("Nothing swept this time. Come back whenever you like.");
  });
});
