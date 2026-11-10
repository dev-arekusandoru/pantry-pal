import { describe, expect, it } from "vitest";
import { expiryState, groupByCategory, restoreBody, stepFor, type PantryCategory, type PantryItem } from "./stock";

const item = (name: string, category: PantryCategory): PantryItem =>
  ({ id: name, ingredient: { id: name, name, category } }) as PantryItem;

describe("stepFor", () => {
  it("uses fine steps for bulk units and 1 for everything countable", () => {
    expect(stepFor("lb")).toBe(0.5);
    expect(stepFor("g")).toBe(50);
    expect(stepFor("can")).toBe(1);
    expect(stepFor("count")).toBe(1);
    expect(stepFor(null)).toBe(1);
  });
});

describe("groupByCategory", () => {
  const items = [item("Rice", "pantry"), item("Milk", "dairy"), item("Beans", "pantry"), item("Peas", "frozen")];
  it("groups in aisle order, sorted by name", () => {
    const groups = groupByCategory(items, "", "all");
    expect(groups.map((g) => g.category)).toEqual(["dairy", "pantry", "frozen"]);
    expect(groups[1]?.items.map((i) => i.ingredient.name)).toEqual(["Beans", "Rice"]);
  });
  it("filters by text and category", () => {
    expect(groupByCategory(items, "RI", "all").flatMap((g) => g.items.map((i) => i.id))).toEqual(["Rice"]);
    expect(groupByCategory(items, "", "dairy").map((g) => g.category)).toEqual(["dairy"]);
  });
});

describe("expiryState", () => {
  it("flags expired and three-day dates, not later ones", () => {
    expect(expiryState("2026-11-08", "2026-11-09")).toBe("expired");
    expect(expiryState("2026-11-09", "2026-11-09")).toBe("soon");
    expect(expiryState("2026-11-12", "2026-11-09")).toBe("soon");
    expect(expiryState("2026-11-13", "2026-11-09")).toBeNull();
    expect(expiryState(null, "2026-11-09")).toBeNull();
  });
});

describe("restoreBody", () => {
  it("re-adds a measured row with its amount and unit", () => {
    const yogurt = { ...item("Yogurt", "dairy"), ingredientId: "ing_yogurt", qty: 500, unit: "g", qtyApprox: true, status: "on_hand" } as PantryItem;
    expect(restoreBody(yogurt)).toEqual({
      ingredientId: "ing_yogurt",
      qty: 500,
      unit: "g",
      qtyApprox: true,
      status: "on_hand",
    });
  });

  it("keeps an unmeasured item unmeasured with its status", () => {
    const rice = { ...item("Rice", "pantry"), ingredientId: "ing_rice", qty: null, unit: null, qtyApprox: false, status: "unknown" } as PantryItem;
    expect(restoreBody(rice)).toEqual({
      ingredientId: "ing_rice",
      qty: null,
      unit: null,
      qtyApprox: false,
      status: "unknown",
    });
  });
});
