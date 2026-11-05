import type { components } from "@/api";

export type PantryItem = components["schemas"]["PantryItem"];
export type PantryStatus = PantryItem["status"];
export type StorageLocation = PantryItem["location"];

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
    location: item.location,
    qty: item.qty,
    unit: item.unit,
    qtyApprox: item.qtyApprox,
    status: item.status,
  };
}

export const STATUS_LABEL: Record<PantryStatus, string> = {
  on_hand: "On hand",
  low: "Running low",
  out: "Out",
  unknown: "Not sure",
};

export const LOCATION_ORDER: readonly StorageLocation[] = ["fridge", "pantry", "freezer", "counter", "other"];

export const LOCATION_LABEL: Record<StorageLocation, string> = {
  fridge: "Fridge",
  pantry: "Pantry",
  freezer: "Freezer",
  counter: "Counter",
  other: "Other",
};

/** Case-insensitive name filter, grouped by location in shelf order, each shelf sorted by name. */
export function groupByLocation(
  items: readonly PantryItem[],
  query: string,
  location: StorageLocation | "all",
): Array<{ location: StorageLocation; items: PantryItem[] }> {
  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (i) => (location === "all" || i.location === location) && (q === "" || i.ingredient.name.toLowerCase().includes(q)),
  );
  return LOCATION_ORDER.map((loc) => ({
    location: loc,
    items: shown.filter((i) => i.location === loc).sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name)),
  })).filter((g) => g.items.length > 0);
}
