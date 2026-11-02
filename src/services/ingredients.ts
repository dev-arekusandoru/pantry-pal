import { and, eq } from "drizzle-orm";
import type { Ctx } from "../context.js";
import { ingredientAliases, ingredients, type IngredientCategory } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

export type Ingredient = typeof ingredients.$inferSelect;

/** Canonical lookup key: trimmed, lowercased, whitespace collapsed. */
export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Simple singular/plural candidates derived from a normalized name. */
function variantNames(normalized: string): string[] {
  const variants = new Set<string>();
  if (normalized.length > 3) {
    if (normalized.endsWith("es")) variants.add(normalized.slice(0, -2));
    if (normalized.endsWith("s")) variants.add(normalized.slice(0, -1));
  }
  variants.add(`${normalized}s`);
  variants.add(`${normalized}es`);
  variants.delete(normalized);
  return [...variants];
}

function findByNormalizedName(ctx: Ctx, normalized: string): Ingredient | null {
  const row = ctx.db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.normalizedName, normalized)))
    .get();
  return row ?? null;
}

function findByAlias(ctx: Ctx, alias: string): Ingredient | null {
  const link = ctx.db
    .select({ ingredientId: ingredientAliases.ingredientId })
    .from(ingredientAliases)
    .where(and(eq(ingredientAliases.householdId, ctx.householdId), eq(ingredientAliases.alias, alias)))
    .get();
  if (!link) return null;

  const row = ctx.db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, link.ingredientId)))
    .get();
  return row ?? null;
}

/**
 * Resolve an ingredient name without creating anything: exact normalized name,
 * then alias, then simple singular/plural variants of the name.
 * Archived ingredients still match (so history keeps resolving).
 */
export function findIngredientByName(ctx: Ctx, name: string): Ingredient | null {
  const normalized = normalizeName(name);
  if (normalized === "") return null;

  const direct = findByNormalizedName(ctx, normalized) ?? findByAlias(ctx, normalized);
  if (direct) return direct;

  for (const variant of variantNames(normalized)) {
    const match = findByNormalizedName(ctx, variant) ?? findByAlias(ctx, variant);
    if (match) return match;
  }
  return null;
}

export interface ResolveIngredientOptions {
  /** Create the ingredient when nothing matches. */
  create?: boolean;
  /** Category used when creating a new ingredient (defaults to "other"). */
  category?: IngredientCategory;
}

/**
 * Resolve a free-text ingredient name; with `create: true` a missing ingredient is
 * inserted (original casing, trimmed) and returned. Otherwise throws `unprocessable`
 * with `{ unresolved: [name] }`.
 */
export function resolveIngredient(
  ctx: Ctx,
  name: string,
  options: ResolveIngredientOptions = {},
): Ingredient {
  const displayName = name.trim().replace(/\s+/g, " ");
  const normalized = normalizeName(name);
  if (normalized === "") {
    throw new AppError("validation", "Ingredient name is required");
  }

  const existing = findIngredientByName(ctx, name);
  if (existing) return existing;

  if (!options.create) {
    throw new AppError("unprocessable", `Unknown ingredient: ${displayName}`, {
      unresolved: [displayName],
    });
  }

  const timestamp = nowIso(ctx);
  return ctx.db
    .insert(ingredients)
    .values({
      id: newId("ing"),
      householdId: ctx.householdId,
      name: displayName,
      normalizedName: normalized,
      category: options.category ?? "other",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()
    .get();
}
