import type { components } from "@/api";

export type ShoppingDetail = components["schemas"]["ShoppingListDetail"];
export type ShoppingItem = components["schemas"]["ShoppingListItem"];
export type ShoppingList = components["schemas"]["ShoppingList"];

/** Return `detail` with one item checked (ISO time) or unchecked (null), counts recomputed. */
export function setChecked(detail: ShoppingDetail, itemId: string, checkedAt: string | null): ShoppingDetail {
  const patch = (item: ShoppingItem): ShoppingItem => (item.id === itemId ? { ...item, checkedAt } : item);
  const items = detail.items.map(patch);
  const checked = items.filter((i) => i.checkedAt !== null).length;
  return {
    ...detail,
    items,
    groups: detail.groups.map((g) => ({ ...g, items: g.items.map(patch) })),
    counts: { ...detail.counts, total: items.length, checked, remaining: items.length - checked },
  };
}

/** `detail` with every item removed: counts zeroed, groups empty, the list itself untouched. */
export function cleared(detail: ShoppingDetail): ShoppingDetail {
  return {
    ...detail,
    items: [],
    groups: [],
    counts: { total: 0, checked: 0, remaining: 0, needsCheck: 0 },
  };
}

/** Still-to-get items first, then the ones in the cart; server order kept within each. */
export function uncheckedFirst(items: readonly ShoppingItem[]): ShoppingItem[] {
  return [...items.filter((i) => i.checkedAt === null), ...items.filter((i) => i.checkedAt !== null)];
}

/** The list to show when the URL doesn't name one: this week's plan list, else the newest open list. */
export function pickDefaultList(lists: readonly ShoppingList[], planId: string | null): ShoppingList | undefined {
  const open = lists.filter((l) => l.status !== "done");
  const forPlan = planId === null ? [] : open.filter((l) => l.mealPlanId === planId);
  return forPlan.find((l) => l.status === "shopping") ?? forPlan[0] ?? open[0];
}

const AISLE_LABELS: Record<string, string> = {
  produce: "Produce",
  protein: "Meat and fish",
  dairy: "Dairy",
  bakery: "Bakery",
  pantry: "Pantry",
  baking: "Baking",
  spice: "Spices",
  canned: "Canned",
  condiment: "Condiments",
  frozen: "Frozen",
  beverage: "Drinks",
  other: "Other",
};

export function aisleLabel(category: string): string {
  return AISLE_LABELS[category] ?? category;
}
