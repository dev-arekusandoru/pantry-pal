/** Pure helpers shared by the recipe box, recipe detail and cook mode. */

import type { components } from "@/api/schema";

export type MealType = components["schemas"]["MealType"];

const FRACTIONS: ReadonlyArray<readonly [number, string]> = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/** 1.5 -> "1½", 0.33 -> "⅓", 2 -> "2", 1.23 -> "1.23" (when no kitchen fraction is close). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac > 0.97) return String(whole + 1);
  if (frac < 0.03) return whole === 0 ? String(Number(n.toFixed(2))) : String(whole);
  let best: readonly [number, string] | undefined;
  for (const f of FRACTIONS) {
    if (best === undefined || Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
  }
  if (best !== undefined && Math.abs(best[0] - frac) <= 0.03) return `${whole > 0 ? whole : ""}${best[1]}`;
  return String(Number(n.toFixed(n < 10 ? 2 : 1)));
}

/** Units that read the same in singular and plural ("2 tbsp", "3 oz"). */
const INVARIANT_UNITS: Record<string, true> = {
  tbsp: true, tsp: true, oz: true, lb: true, lbs: true, g: true, kg: true, mg: true,
  ml: true, l: true, "fl oz": true, pt: true, qt: true, gal: true, pinch: true,
};
/** Units that carry no information in front of an ingredient name ("2 yellow onion"). */
const SILENT_UNITS: Record<string, true> = { count: true, each: true, whole: true, piece: true, pieces: true };

export function pluralizeUnit(unit: string, qty: number): string {
  const u = unit.trim();
  if (qty <= 1 || INVARIANT_UNITS[u.toLowerCase()] || !/^[a-z]+$/i.test(u)) return u;
  if (/(s|x|z|ch|sh)$/i.test(u)) return `${u}es`;
  return `${u}s`;
}

/** "1½ cups", "1–2 cloves", "2" (count), "" for unmeasured ingredients ("to taste"). */
export function formatAmount(qty: number | null, qtyMax: number | null, unit: string | null): string {
  if (qty === null) return "";
  const hasRange = qtyMax !== null && qtyMax > qty;
  const number = hasRange ? `${formatNumber(qty)}–${formatNumber(qtyMax)}` : formatNumber(qty);
  const u = unit?.trim() ?? "";
  if (u === "" || SILENT_UNITS[u.toLowerCase()]) return number;
  return `${number} ${pluralizeUnit(u, hasRange ? qtyMax : qty)}`;
}

/** 385 -> "6 hr 25 min", 55 -> "55 min", 60 -> "1 hr". */
export function formatMinutes(total: number | null | undefined): string | null {
  if (total === null || total === undefined || total <= 0) return null;
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Today as YYYY-MM-DD in the browser's timezone (the server defaults to the UTC date). */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type Have = "have" | "some" | "none" | "unknown";

interface AvailabilityLike {
  ingredientId: string;
  unit: string | null;
  onHand: number | null;
  onHandStatus: "on_hand" | "low" | "out" | "unknown";
}

const normUnit = (u: string | null) => (u ?? "").trim().toLowerCase();

/**
 * Do we have this ingredient? Compares quantities when the pantry line is in the
 * recipe's unit; otherwise (no common unit, no conversion on the client) falls
 * back to the pantry status. A missing line means nothing in stock.
 */
export function haveIngredient(
  need: { ingredientId: string; qty: number | null; unit: string | null },
  line: AvailabilityLike | undefined,
): Have {
  if (line === undefined) return "none";
  if (need.qty !== null && line.onHand !== null && normUnit(need.unit) === normUnit(line.unit)) {
    if (line.onHand >= need.qty - 1e-6) return "have";
    return line.onHand > 1e-6 ? "some" : "none";
  }
  switch (line.onHandStatus) {
    case "on_hand":
      return "have";
    case "low":
      return "some";
    case "out":
      return "none";
    default:
      return "unknown";
  }
}

const MEAL_EMOJI: Record<MealType, string> = {
  breakfast: "🥞",
  lunch: "🥗",
  dinner: "🍝",
  snack: "🍿",
  dessert: "🍰",
};

/** Placeholder emoji for a recipe without a (working) photo. */
export function recipeEmoji(mealTypes: ReadonlyArray<MealType>): string {
  const first = mealTypes.find((m) => m === "dinner") ?? mealTypes[0];
  return first ? MEAL_EMOJI[first] : "🍽️";
}

/** "2026-11-03" -> "Tue, Nov 3" without timezone drift. */
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export interface CookSearch {
  cookEvent?: string;
  servings?: number;
}

/** Shared `?cookEvent=<id>&servings=<n>` search validation for the recipe and cook routes. */
export function validateCookSearch(search: Record<string, unknown>): CookSearch {
  const cookEvent = typeof search.cookEvent === "string" && search.cookEvent !== "" ? search.cookEvent : undefined;
  const n = typeof search.servings === "string" ? Number(search.servings) : search.servings;
  const servings = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
  return {
    ...(cookEvent !== undefined ? { cookEvent } : {}),
    ...(servings !== undefined ? { servings } : {}),
  };
}
