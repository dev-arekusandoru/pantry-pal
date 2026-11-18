/** Pure helpers for the recipe nutrition panel: number formatting and line labels. */

import type { components } from "@/api/schema";

export type RecipeNutrition = components["schemas"]["RecipeNutrition"];
export type NutritionLine = components["schemas"]["RecipeNutritionLine"];
/** The schema marks the shared Nutrients type nullable; every place the panel reads it holds a value. */
export type Nutrients = NonNullable<components["schemas"]["Nutrients"]>;

/** Shown in place of a value the data does not have. */
export const NO_VALUE = "—";

/** 1240 -> "1240", 99.6 -> "100", null -> "—". Whole numbers: kcal and mg. */
export function formatWhole(value: number | null): string {
  return value === null ? NO_VALUE : String(Math.round(value));
}

/** 2.46 -> "2.5", 3 -> "3", 24.4 -> "24", null -> "—". One decimal under 10, whole from 10 up. */
export function formatGrams(value: number | null): string {
  if (value === null) return NO_VALUE;
  if (value >= 10) return String(Math.round(value));
  return String(Number(value.toFixed(1)));
}

/** "24 g" for macros; sodium is milligrams. Null stays a bare dash (no unit). */
export function formatNutrient(value: number | null, key: keyof Nutrients): string {
  if (value === null) return NO_VALUE;
  if (key === "calories") return `${formatWhole(value)} kcal`;
  if (key === "sodium") return `${formatWhole(value)} mg`;
  return `${formatGrams(value)} g`;
}

/** "Partial: 3 of 5 ingredients counted", or null when every counted line has data. */
export function partialLabel(countedLines: number, missingLines: number): string | null {
  if (missingLines <= 0) return null;
  const total = countedLines + missingLines;
  return `Partial: ${countedLines} of ${total} ${total === 1 ? "ingredient" : "ingredients"} counted`;
}

/** Short reason a line has no calories; null for a counted line. */
export function lineReason(line: Pick<NutritionLine, "status" | "unit">): string | null {
  switch (line.status) {
    case "ok":
      return null;
    case "optional":
      return "Optional, not counted";
    case "no_quantity":
      return "No amount, not counted";
    case "no_match":
      return "No matching food";
    case "no_conversion": {
      const unit = line.unit?.trim();
      return unit ? `Can't convert ${unit} to grams` : "Can't convert to grams";
    }
  }
}

/** Second line of a breakdown row: grams used, the reason it is blank, and the matched USDA food. */
export function lineDetail(line: Pick<NutritionLine, "status" | "unit" | "grams" | "food">): string {
  const parts: string[] = [];
  if (line.status === "ok" && line.grams !== null) parts.push(`${formatGrams(line.grams)} g`);
  const reason = lineReason(line);
  if (reason !== null) parts.push(reason);
  if (line.food !== null) parts.push(line.food.description);
  return parts.join(" · ");
}
