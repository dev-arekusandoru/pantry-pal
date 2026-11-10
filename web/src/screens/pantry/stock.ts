import type { components } from "@/api";
import { CATEGORY_ORDER } from "../aisles";

export type PantryItem = components["schemas"]["PantryItem"];
export type PantryStatus = PantryItem["status"];
export type PantryCategory = PantryItem["ingredient"]["category"];

/** How much one tap on +/- changes a measured item, by unit. Anything unlisted (cans, jars, bunches, ...) steps by 1. */
const STEPS: Record<string, number> = {
  lb: 0.5,
  kg: 0.5,
  l: 0.5,
  cup: 0.5,
  gallon: 0.5,
  g: 50,
  ml: 50,
};

export function stepFor(unit: string | null): number {
  return (unit !== null ? STEPS[unit] : undefined) ?? 1;
}

/** Body for `POST /pantry/set` that re-adds a removed row where it was, with its amount. */
export function restoreBody(item: PantryItem) {
  return {
    ingredientId: item.ingredientId,
    qty: item.qty,
    unit: item.unit,
    qtyApprox: item.qtyApprox,
    status: item.status,
  };
}

/** Days before the expiry date that count as "soon". */
const EXPIRING_SOON_DAYS = 3;

/** `expired`, `soon` (0-3 days), or null when the date is missing or further away. */
export function expiryState(expiresOn: string | null, today = new Date().toISOString().slice(0, 10)): "expired" | "soon" | null {
  if (expiresOn === null) return null;
  const days = Math.round(
    (new Date(`${expiresOn}T00:00:00.000Z`).getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) / 86_400_000,
  );
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "soon";
  return null;
}

export const STATUS_LABEL: Record<PantryStatus, string> = {
  on_hand: "On hand",
  low: "Running low",
  out: "Out",
  unknown: "Not sure",
};

/** Case-insensitive name filter, grouped by ingredient category in aisle order, each group sorted by name. */
export function groupByCategory(
  items: readonly PantryItem[],
  query: string,
  category: PantryCategory | "all",
): Array<{ category: PantryCategory; items: PantryItem[] }> {
  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (category === "all" || i.ingredient.category === category) &&
      (q === "" || i.ingredient.name.toLowerCase().includes(q)),
  );
  return CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: shown
      .filter((i) => i.ingredient.category === cat)
      .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name)),
  })).filter((g) => g.items.length > 0);
}
