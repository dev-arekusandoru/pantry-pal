import { describe, expect, it } from "vitest";
import { pickDefaultList, setChecked, type ShoppingDetail, type ShoppingItem, type ShoppingList } from "./cart";

const item = (id: string, checkedAt: string | null = null): ShoppingItem => ({
  id,
  householdId: "h",
  shoppingListId: "l",
  ingredientId: null,
  name: id,
  imageUrl: null,
  category: "produce",
  qty: 1,
  unit: null,
  purposeNote: null,
  needsCheck: false,
  source: "manual",
  note: null,
  checkedAt,
  actualQty: null,
  actualUnit: null,
  substituteIngredientId: null,
  position: 0,
  createdAt: "",
});

const list = (id: string, status: ShoppingList["status"], mealPlanId: string | null): ShoppingList => ({
  id,
  householdId: "h",
  mealPlanId,
  title: id,
  status,
  notes: null,
  createdAt: "",
  updatedAt: "",
  completedAt: null,
  stale: false,
});

describe("setChecked", () => {
  const items = [item("a"), item("b", "t")];
  const detail: ShoppingDetail = {
    list: list("l", "draft", null),
    items,
    groups: [{ category: "produce", items }],
    counts: { total: 2, checked: 1, remaining: 1, needsCheck: 0 },
    runningLow: [],
  };

  it("checks an item in items and groups and recomputes counts", () => {
    const next = setChecked(detail, "a", "now");
    expect(next.items[0]?.checkedAt).toBe("now");
    expect(next.groups[0]?.items[0]?.checkedAt).toBe("now");
    expect(next.counts).toEqual({ total: 2, checked: 2, remaining: 0, needsCheck: 0 });
    expect(detail.items[0]?.checkedAt).toBeNull();
  });

  it("unchecks", () => {
    expect(setChecked(detail, "b", null).counts.checked).toBe(0);
  });
});

describe("pickDefaultList", () => {
  const lists = [
    list("newest", "draft", "other"),
    list("plan-draft", "draft", "p1"),
    list("plan-shop", "shopping", "p1"),
    list("old-done", "done", "p1"),
  ];
  it("prefers the plan's shopping list, then its draft", () => {
    expect(pickDefaultList(lists, "p1")?.id).toBe("plan-shop");
    expect(pickDefaultList(lists.filter((l) => l.id !== "plan-shop"), "p1")?.id).toBe("plan-draft");
  });
  it("uses the newest open list only when there is no plan", () => {
    expect(pickDefaultList(lists, null)?.id).toBe("newest");
    expect(pickDefaultList([list("d", "done", "p1")], "p1")?.id).toBe("d");
  });
  it("never falls back to another plan's list", () => {
    expect(pickDefaultList([list("old", "draft", "p0")], "p1")).toBeUndefined();
  });
});
