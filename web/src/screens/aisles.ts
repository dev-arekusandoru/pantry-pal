import type { components } from "@/api";

export type IngredientCategory = components["schemas"]["PantryItem"]["ingredient"]["category"];

/** Same order the server uses for demand and shopping output. */
export const CATEGORY_ORDER: readonly IngredientCategory[] = [
  "produce",
  "protein",
  "dairy",
  "bakery",
  "pantry",
  "baking",
  "spice",
  "canned",
  "condiment",
  "frozen",
  "beverage",
  "other",
];

export function categoryRank(category: IngredientCategory): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

const AISLE_LABELS: Record<IngredientCategory, string> = {
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
  return AISLE_LABELS[category as IngredientCategory] ?? category;
}
