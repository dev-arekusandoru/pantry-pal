import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Ctx } from "../../context.js";
import { AppError, isAppError } from "../../lib/errors.js";
import { findIngredientByName, getIngredient, resolveIngredientRef } from "../../services/ingredients.js";

/** What every Rakumi tool returns: compact JSON in one text block. */
export type ToolResult = CallToolResult;

/** Serialise a successful tool result. */
export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) ?? "null" }] };
}

/** Serialise a domain error exactly like the REST API does, flagged as `isError`. */
export function errorResult(error: AppError): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(error.toBody()) ?? "null" }],
  };
}

/**
 * Wrap a tool handler: the return value becomes JSON text content, an
 * `AppError` becomes `{ isError: true }` with the shared error body, and any
 * other failure becomes an `internal` error body instead of leaking a stack.
 */
export function tool<Args = unknown>(
  run: (args: Args) => unknown,
): (args: Args) => ToolResult {
  return (args) => {
    try {
      return jsonResult(run(args));
    } catch (error) {
      if (isAppError(error)) return errorResult(error);
      const message = error instanceof Error ? error.message : String(error);
      return internalError(message);
    }
  };
}

function internalError(message: string): ToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify({ error: { code: "internal", message } }) ?? "null" },
    ],
  };
}

/** An ingredient reference accepted by the tools: id first, else a name. */
export interface IngredientRefArgs {
  ingredientId?: string;
  ingredient?: string;
}

/**
 * Resolve `ingredientId` or an ingredient name (names/aliases/plurals) to an
 * existing id. Unknown names are an `unprocessable` error with suggestions — tools never
 * create ingredients implicitly.
 */
export function requireIngredientId(ctx: Ctx, ref: IngredientRefArgs): string {
  if (ref.ingredientId !== undefined) return getIngredient(ctx, ref.ingredientId).id;
  const name = ref.ingredient?.trim() ?? "";
  if (name === "") {
    throw new AppError("validation", "Provide `ingredientId` or `ingredient`");
  }
  const found = findIngredientByName(ctx, name);
  // Unknown: resolving throws the shared 422 with suggestions.
  return found === null ? resolveIngredientRef(ctx, { ingredient: name }).id : found.id;
}

/** Require a field the flat `action` schema cannot mark as conditionally required. */
export function requireArg<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new AppError("validation", `\`${field}\` is required for this action`);
  }
  return value;
}
