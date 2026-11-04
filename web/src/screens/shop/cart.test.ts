import { describe, expect, it } from "vitest";
import { cleared, pickDefaultList, setChecked, uncheckedFirst, type ShoppingDetail, type ShoppingItem, type ShoppingList } from "./cart";

const item = (id: string, checkedAt: string | null = null): ShoppingItem => ({
  id,
  householdId: "h",
  shoppingListId: "l",
  ingredientId: null,
  name: id,
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

describe("cleared", () => {
  const items = [item("a"), item("b", "t")];
  const detail: ShoppingDetail = {
    list: list("l", "shopping", "p1"),
    items,
    groups: [{ category: "produce", items }],
    counts: { total: 2, checked: 1, remaining: 1, needsCheck: 0 },
  };

  it("empties items, groups and counts but keeps the list untouched", () => {
    const next = cleared(detail);
    expect(next.items).toEqual([]);
    expect(next.groups).toEqual([]);
    expect(next.counts).toEqual({ total: 0, checked: 0, remaining: 0, needsCheck: 0 });
    expect(next.list).toBe(detail.list);
    expect(detail.items).toHaveLength(2);
  });
});

describe("uncheckedFirst", () => {
  it("moves checked items to the end, keeping order", () => {
    expect(uncheckedFirst([item("a", "t"), item("b"), item("c", "t"), item("d")]).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
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
  it("falls back to the newest open list, ignoring done ones", () => {
    expect(pickDefaultList(lists, null)?.id).toBe("newest");
    expect(pickDefaultList([list("d", "done", "p1")], "p1")).toBeUndefined();
  });
});
