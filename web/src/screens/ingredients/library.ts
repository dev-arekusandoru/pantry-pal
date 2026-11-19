/** Pure helpers for the ingredient library: filter chips, search and aisle groups. */

import { CATEGORY_ORDER } from "../aisles";
import type { IngredientView } from "./queries";

export const LIBRARY_FILTERS = ["all", "attention", "custom", "unused"] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

/** One ingredient with what the chips need to know about it. */
export interface LibraryRow {
  ingredient: IngredientView;
  /** Linked to a USDA food. A custom ingredient is not. */
  linked: boolean;
  attention: boolean;
  /** In no recipe, pantry row, open shopping list or rule. */
  unused: boolean;
}

export function buildRows(
  items: readonly IngredientView[],
  attentionIds: ReadonlySet<string>,
  usedIds: ReadonlySet<string>,
): LibraryRow[] {
  return items.map((ingredient) => ({
    ingredient,
    linked: ingredient.nutrition?.fdcId != null,
    attention: attentionIds.has(ingredient.id),
    unused: !usedIds.has(ingredient.id),
  }));
}

const MATCHES: Record<LibraryFilter, (row: LibraryRow) => boolean> = {
  all: () => true,
  attention: (row) => row.attention,
  custom: (row) => !row.linked,
  unused: (row) => row.unused,
};

export function countFilters(rows: readonly LibraryRow[]): Record<LibraryFilter, number> {
  return {
    all: rows.length,
    attention: rows.filter(MATCHES.attention).length,
    custom: rows.filter(MATCHES.custom).length,
    unused: rows.filter(MATCHES.unused).length,
  };
}

/** Rows that pass the chip and whose name or alias contains the search text. */
export function filterRows(rows: readonly LibraryRow[], filter: LibraryFilter, query: string): LibraryRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (!MATCHES[filter](row)) return false;
    if (needle === "") return true;
    return (
      row.ingredient.name.toLowerCase().includes(needle) ||
      row.ingredient.aliases.some((alias) => alias.alias.toLowerCase().includes(needle))
    );
  });
}

export interface AisleGroup {
  category: IngredientView["category"];
  rows: LibraryRow[];
}

/** Rows grouped by aisle in shopping order; empty aisles are left out. Rows keep their order inside a group. */
export function groupByAisle(rows: readonly LibraryRow[]): AisleGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((row) => row.ingredient.category === category),
  })).filter((group) => group.rows.length > 0);
}

/** The filter named in the URL, or `all` for anything else. */
export function parseFilter(value: unknown): LibraryFilter {
  return LIBRARY_FILTERS.find((filter) => filter === value) ?? "all";
}
