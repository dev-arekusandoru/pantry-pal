/** Pure helpers for units and measures: error details, labels and matching what someone types. */

import { ApiError } from "@/api/errors";
import type { components } from "@/api/schema";

export type Measure = components["schemas"]["Measure"];

/** One unit the server could not accept for an ingredient, with the ways to fix it. */
export interface UnresolvedUnit {
  unit: string;
  ingredientId: string;
  ingredientName: string;
  suggestions: string[];
  hint: string;
}

function isUnresolvedUnit(entry: unknown): entry is UnresolvedUnit {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "unit" in entry &&
    typeof entry.unit === "string" &&
    "ingredientId" in entry &&
    typeof entry.ingredientId === "string" &&
    "suggestions" in entry &&
    Array.isArray(entry.suggestions)
  );
}

/** The `unresolvedUnits` list of a 422 "unknown unit" answer; empty for any other error. */
export function unresolvedUnits(error: unknown): UnresolvedUnit[] {
  if (!(error instanceof ApiError) || error.status !== 422) return [];
  const details = error.details;
  if (typeof details !== "object" || details === null || !("unresolvedUnits" in details)) return [];
  const list = details.unresolvedUnits;
  if (!Array.isArray(list)) return [];
  return list.filter(isUnresolvedUnit);
}

/** Two units that do not convert for one ingredient: the 422 of a stock unit change or a pantry write. */
export interface ConversionProblem {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  toUnit: string;
}

export function conversionProblem(error: unknown): ConversionProblem | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const details = error.details;
  if (
    typeof details === "object" &&
    details !== null &&
    "ingredientId" in details &&
    typeof details.ingredientId === "string" &&
    "ingredientName" in details &&
    typeof details.ingredientName === "string" &&
    "unit" in details &&
    typeof details.unit === "string" &&
    "toUnit" in details &&
    typeof details.toUnit === "string"
  ) {
    return { ingredientId: details.ingredientId, ingredientName: details.ingredientName, unit: details.unit, toUnit: details.toUnit };
  }
  return null;
}

/** One unit problem ready to show: what failed, the units to use instead, and which unit could get a measure. */
export interface UnitProblem {
  unit: string;
  ingredientId: string;
  ingredientName: string;
  message: string;
  /** Units that would work now. */
  suggestions: string[];
}

/**
 * The unit problems an error carries: unknown units (422 `unresolvedUnits`) or two
 * units that do not convert (422 with `unit` and `toUnit`). Empty for any other error.
 */
export function unitProblems(error: unknown): UnitProblem[] {
  const unresolved = unresolvedUnits(error);
  if (unresolved.length > 0) {
    return unresolved.map((problem) => ({
      unit: problem.unit,
      ingredientId: problem.ingredientId,
      ingredientName: problem.ingredientName,
      message: `"${unitText(problem.unit)}" is not a unit that ${problem.ingredientName} has yet.`,
      suggestions: problem.suggestions.slice(0, 6),
    }));
  }
  const conversion = conversionProblem(error);
  if (conversion === null) return [];
  return [
    {
      unit: conversion.unit,
      ingredientId: conversion.ingredientId,
      ingredientName: conversion.ingredientName,
      message: `${conversion.ingredientName} has no weight for ${unitText(conversion.unit)}, so it cannot turn ${unitText(conversion.unit)} into ${unitText(conversion.toUnit)}.`,
      suggestions: [conversion.toUnit],
    },
  ];
}

/** Plain sentence for a toast: the problems, with the way out. */
export function unitProblemsText(problems: readonly UnitProblem[]): string {
  return problems
    .map((problem) => {
      const options = problem.suggestions.map(unitText);
      return `${problem.message} Add a measure for ${unitText(problem.unit)}${options.length > 0 ? `, or use ${options.join(", ")}` : ""}.`;
    })
    .join(" ");
}

/** Display text for a normalized unit: "fl_oz" shows as "fl oz". */
export function unitText(unit: string): string {
  return unit === "fl_oz" ? "fl oz" : unit;
}

const ALIASES: Record<string, string> = {
  tablespoon: "tbsp",
  tbs: "tbsp",
  teaspoon: "tsp",
  pound: "lb",
  lbs: "lb",
  ounce: "oz",
  gram: "g",
  kilogram: "kg",
  kilo: "kg",
  liter: "l",
  litre: "l",
  milliliter: "ml",
  millilitre: "ml",
  "fl oz": "fl_oz",
  floz: "fl_oz",
  "fluid ounce": "fl_oz",
  pt: "pint",
  qt: "quart",
  gal: "gallon",
  c: "cup",
  each: "count",
  whole: "count",
  pkg: "package",
  pack: "package",
};

/**
 * The listed unit that typed text means ("Cups" -> "cup"), or null when the
 * ingredient has no such unit. The server normalizes the same way; this only
 * decides whether to offer "Add a measure".
 */
export function matchUnit(text: string, units: readonly string[]): string | null {
  const key = text.trim().toLowerCase().replaceAll(".", "").replace(/\s+/g, " ");
  if (key === "") return null;
  const candidates = [key, ALIASES[key], key.endsWith("es") ? key.slice(0, -2) : undefined, key.endsWith("s") ? key.slice(0, -1) : undefined];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const direct = units.find((unit) => unit === candidate || unitText(unit) === candidate);
    if (direct !== undefined) return direct;
    const alias = ALIASES[candidate];
    if (alias !== undefined && units.includes(alias)) return alias;
  }
  return null;
}

export const SOURCE_LABEL: Record<Measure["source"], string> = {
  usda: "USDA",
  usda_estimated: "Estimated",
  user: "Yours",
};

/** "30 g", "0.5 g", "425 g": grams of one unit. */
export function formatGramsOf(grams: number): string {
  return `${Number(grams.toFixed(grams >= 10 ? 0 : 1))} g`;
}
