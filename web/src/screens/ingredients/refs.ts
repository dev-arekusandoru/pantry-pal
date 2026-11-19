/** Pure helpers for choosing, naming and reporting ingredients. */

import { ApiError } from "@/api/errors";
import type { components } from "@/api/schema";

export type IngredientCategory = components["schemas"]["IngredientCategory"];

/** An ingredient the household already has: what the picker hands back. */
export interface IngredientPick {
  id: string;
  name: string;
}

/** One name the server could not resolve, with the ways to fix it. */
export interface UnresolvedName {
  name: string;
  suggestions: Array<components["schemas"]["IngredientSuggestion"]>;
  hint?: string;
}

/** Shapes of the `details` the server attaches to ingredient errors. A missing field fails the checks below. */
interface ErrorDetails {
  unresolved?: unknown;
  reason?: unknown;
  hint?: unknown;
  ingredientId?: unknown;
  name?: unknown;
  fdcId?: unknown;
}

function detailsOf(error: unknown, status: number): ErrorDetails | null {
  if (!(error instanceof ApiError) || error.status !== status) return null;
  return typeof error.details === "object" && error.details !== null ? (error.details as ErrorDetails) : null;
}

/** The `unresolved` list of a 422 "unknown ingredient" answer; empty for any other error. */
export function unresolvedNames(error: unknown): UnresolvedName[] {
  const list = detailsOf(error, 422)?.unresolved;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry): entry is UnresolvedName =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as UnresolvedName).name === "string" &&
      Array.isArray((entry as UnresolvedName).suggestions),
  );
}

/** Why a name broke the naming rules (422 on create or rename), or null for any other error. */
export function nameProblem(error: unknown): { reason: string; hint: string } | null {
  const details = detailsOf(error, 422);
  if (details === null) return null;
  const { reason, hint } = details;
  return typeof reason === "string" && typeof hint === "string" ? { reason, hint } : null;
}

/** "Contains "or". Use the main ingredient and add the others as alternatives." */
export function nameProblemText(problem: { reason: string; hint: string }): string {
  const reason = problem.reason.trim();
  const first = reason === "" ? "" : `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`;
  return [first, problem.hint.trim()]
    .filter((part) => part !== "")
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");
}

/**
 * Message for a failed save that may carry a naming or "unknown ingredient"
 * problem; falls back to the server message.
 */
export function ingredientErrorMessage(error: unknown, fallback: string): string {
  const unresolved = unresolvedNames(error);
  if (unresolved.length > 0) {
    return unresolved
      .map((entry) => {
        const hint = entry.hint === undefined ? "" : ` ${entry.hint}`;
        return `"${entry.name}" is not an ingredient yet. Pick it from the list, or add it first.${hint}`;
      })
      .join(" ");
  }
  const problem = nameProblem(error);
  if (problem !== null) return nameProblemText(problem);
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/** The ingredient a 409 "already linked" answer points at, or null. */
export function conflictingIngredient(error: unknown): IngredientPick | null {
  const details = detailsOf(error, 409);
  if (details === null) return null;
  const { ingredientId, name, fdcId } = details;
  if (typeof ingredientId !== "string" || typeof name !== "string" || typeof fdcId !== "number") return null;
  return { id: ingredientId, name };
}

/** "Milk (or Water)" for a line with stand-ins; just the name without them. Names stay in Title Case. */
export function withAlternatives(name: string, alternatives: ReadonlyArray<{ name: string }>): string {
  if (alternatives.length === 0) return name;
  return `${name} (or ${alternatives.map((alternative) => alternative.name).join(" or ")})`;
}

/**
 * The pieces of a name written as a choice: "Milk or water" -> ["Milk", "water"].
 * Used to start a split. One piece (or none) means the name is not a choice.
 */
export function splitNameParts(name: string): string[] {
  return name
    .split(/\s+(?:and\/or|or)\s+|\s*[/&+,;]\s*/i)
    .map((part) => part.replace(/[()[\]]/g, "").trim())
    .filter((part) => part !== "");
}
