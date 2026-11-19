import { and, asc, eq, inArray, isNotNull, isNull, like, ne, or, sql } from "drizzle-orm";
import type { Ctx } from "../context.js";
import type { Db } from "../db/client.js";
import {
  dietaryRules,
  ingredientAliases,
  ingredients,
  pantryItems,
  recipeIngredientAlternatives,
  recipeIngredients,
  recipes,
  shoppingListItems,
  shoppingLists,
  stockMovements,
  type IngredientCategory,
  type PantryStatus,
  type RuleSeverity,
  type ShoppingListStatus,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { normalizeImageUrl } from "../lib/icons.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { titleCaseName } from "../lib/titleCase.js";
import { autoMatchFood, getFood, searchFoods, type FoodPortion, type Nutrients } from "./foods.js";
import {
  lintIngredientName,
  nameWords,
  searchTextFor,
  splitAlternatives,
  suggestedNameForFood,
} from "./ingredientNames.js";
import {
  convert,
  convertOrThrow,
  converterFor,
  effectiveMeasures,
  moveMeasures,
  unitsForPicker,
  validateUnits,
  type Measure,
} from "./units.js";

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

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export type Suggestion =
  | { kind: "ingredient"; ingredientId: string; name: string; score: number }
  | { kind: "food"; fdcId: number; description: string; suggestedName: string; score: number };

const DEFAULT_SUGGESTIONS = 5;
const MIN_INGREDIENT_SCORE = 0.5;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Word-overlap similarity (Dice) of two word lists, 0..1. */
function wordSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const inB = new Set(b);
  const shared = new Set(a.filter((word) => inB.has(word))).size;
  return (2 * shared) / (new Set(a).size + inB.size);
}

interface RankedIngredient {
  row: Ingredient;
  aliases: string[];
  score: number;
}

/** Household ingredients (not archived) that look like `text`, best first. */
function rankIngredients(ctx: Ctx, text: string, excludeId?: string): RankedIngredient[] {
  const query = nameWords(text);
  if (query.length === 0) return [];
  const needle = normalizeName(searchTextFor(text));

  const rows = ctx.db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), isNull(ingredients.archivedAt)))
    .all();
  const aliasesById = new Map<string, string[]>();
  for (const alias of ctx.db
    .select({ ingredientId: ingredientAliases.ingredientId, alias: ingredientAliases.alias })
    .from(ingredientAliases)
    .where(eq(ingredientAliases.householdId, ctx.householdId))
    .all()) {
    const list = aliasesById.get(alias.ingredientId);
    if (list) list.push(alias.alias);
    else aliasesById.set(alias.ingredientId, [alias.alias]);
  }

  const ranked: RankedIngredient[] = [];
  for (const row of rows) {
    if (row.id === excludeId) continue;
    const aliases = aliasesById.get(row.id) ?? [];
    let score = 0;
    for (const candidate of [row.name, ...aliases]) {
      score = Math.max(score, wordSimilarity(query, nameWords(candidate)));
      if (needle.length >= 3 && normalizeName(candidate).includes(needle)) score = Math.max(score, 0.7);
    }
    if (score >= MIN_INGREDIENT_SCORE) ranked.push({ row, aliases, score: round3(score) });
  }
  return ranked.sort(
    (a, b) => b.score - a.score || a.row.normalizedName.localeCompare(b.row.normalizedName),
  );
}

/** Household ingredients linked to a USDA food, oldest first, archived last. */
function ingredientsLinkedTo(ctx: Ctx, fdcId: number): Ingredient[] {
  return ctx.db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.nutritionFdcId, fdcId)))
    .orderBy(asc(sql`${ingredients.archivedAt} is not null`), asc(ingredients.createdAt), asc(ingredients.id))
    .all();
}

function suggestForPart(ctx: Ctx, text: string, limit: number, excludeId?: string): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (suggestion: Suggestion): void => {
    const key = suggestion.kind === "ingredient" ? suggestion.ingredientId : `food:${suggestion.fdcId}`;
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push(suggestion);
  };

  const ingredientLimit = Math.max(1, Math.ceil(limit * 0.6));
  for (const { row, score } of rankIngredients(ctx, text, excludeId).slice(0, ingredientLimit)) {
    add({ kind: "ingredient", ingredientId: row.id, name: row.name, score });
  }

  const query = searchTextFor(text);
  if (query === "") return out;
  for (const match of searchFoods(query, limit + 3)) {
    // A food the household already links to is suggested as that ingredient.
    const linked = ingredientsLinkedTo(ctx, match.food.fdcId).find(
      (row) => row.archivedAt === null && row.id !== excludeId,
    );
    if (linked) {
      add({ kind: "ingredient", ingredientId: linked.id, name: linked.name, score: match.score });
      continue;
    }
    add({
      kind: "food",
      fdcId: match.food.fdcId,
      description: match.food.description,
      suggestedName: suggestedNameForFood(match.food.description),
      score: match.score,
    });
  }
  return out;
}

/**
 * Up to `limit` (default 5) ways to resolve a name: household ingredients first, then USDA
 * foods. A name with alternatives ("milk or water") gets suggestions for each part.
 */
export function suggestForName(
  ctx: Ctx,
  name: string,
  options: { limit?: number; excludeId?: string } = {},
): Suggestion[] {
  const limit = Math.max(1, options.limit ?? DEFAULT_SUGGESTIONS);
  const parts = splitAlternatives(name);
  if (parts.length === 1) return suggestForPart(ctx, name, limit, options.excludeId);

  const perPart = Math.max(2, Math.ceil(limit / parts.length));
  const lists = parts.map((part) => suggestForPart(ctx, part, perPart, options.excludeId));
  const merged: Suggestion[] = [];
  const seen = new Set<string>();
  for (let i = 0; merged.length < limit && lists.some((list) => i < list.length); i++) {
    for (const list of lists) {
      const suggestion = list[i];
      if (suggestion === undefined) continue;
      const key =
        suggestion.kind === "ingredient" ? suggestion.ingredientId : `food:${suggestion.fdcId}`;
      if (seen.has(key) || merged.length >= limit) continue;
      seen.add(key);
      merged.push(suggestion);
    }
  }
  return merged;
}

export interface IngredientMatch {
  id: string;
  name: string;
  category: IngredientCategory;
  stockUnit: string | null;
  defaultPortion: string | null;
  aliases: string[];
  /** Linked to a USDA food (false = custom). */
  linked: boolean;
  fdcId: number | null;
  needsReview: boolean;
  score: number;
}

export interface FoodMatchView {
  fdcId: number;
  description: string;
  suggestedName: string;
  score: number;
  /** The household ingredient already linked to this food, if any. */
  ingredientId: string | null;
}

/** Existing household ingredients and USDA foods that match a query (for choosing a reference). */
export function findIngredientCandidates(
  ctx: Ctx,
  query: string,
  limit = 10,
): { ingredients: IngredientMatch[]; foods: FoodMatchView[] } {
  const text = query.trim();
  if (text === "") throw new AppError("validation", "query is required");
  const found = rankIngredients(ctx, text).slice(0, limit);
  const foods = searchFoods(searchTextFor(text) || text, limit).map((match): FoodMatchView => ({
    fdcId: match.food.fdcId,
    description: match.food.description,
    suggestedName: suggestedNameForFood(match.food.description),
    score: match.score,
    ingredientId:
      ingredientsLinkedTo(ctx, match.food.fdcId).find((row) => row.archivedAt === null)?.id ?? null,
  }));
  return {
    ingredients: found.map(({ row, aliases, score }) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      stockUnit: row.stockUnit,
      defaultPortion: row.defaultPortion,
      aliases,
      linked: row.nutritionFdcId !== null,
      fdcId: row.nutritionFdcId,
      needsReview: row.needsReview,
      score,
    })),
    foods,
  };
}

// ---------------------------------------------------------------------------
// References (recipe lines, alternatives, pantry lines, dietary rules)
// ---------------------------------------------------------------------------

/** Exactly one of `ingredientId`, `ingredient` or `fdcId` names the ingredient. */
export interface IngredientRefInput {
  /** An existing ingredient. */
  ingredientId?: string | undefined;
  /** An existing ingredient name or alias. Never creates. */
  ingredient?: string | undefined;
  /** A USDA food: reuses the household ingredient linked to it, else creates one. */
  fdcId?: number | undefined;
  /** Name for an ingredient created from `fdcId` (default: derived from the USDA description). */
  name?: string | undefined;
  /** Category for an ingredient created from `fdcId` (default other). */
  category?: IngredientCategory | undefined;
}

export interface UnresolvedIngredient {
  name: string;
  suggestions: Suggestion[];
  hint?: string;
}

function unresolvedEntry(ctx: Ctx, name: string): UnresolvedIngredient {
  const lint = lintIngredientName(name);
  return {
    name,
    suggestions: suggestForName(ctx, name),
    ...(lint.ok ? {} : { hint: `${lint.reason}. ${lint.hint}` }),
  };
}

function unresolvedError(entries: UnresolvedIngredient[]): AppError {
  const names = entries.map((entry) => `"${entry.name}"`).join(", ");
  const hints = entries
    .filter((entry) => entry.hint !== undefined)
    .map((entry) => `"${entry.name}": ${entry.hint}`)
    .join(" ");
  return new AppError(
    "unprocessable",
    `Unknown ingredient${entries.length === 1 ? "" : "s"}: ${names}. ` +
      "Use an existing ingredient (ingredientId or its exact name), or a USDA food (fdcId with name) to create one." +
      (hints === "" ? "" : ` ${hints}`),
    { unresolved: entries },
  );
}

function invalidNameError(name: string, lint: { reason: string; hint: string }): AppError {
  return new AppError(
    "unprocessable",
    `Invalid ingredient name "${name}": ${lint.reason}. ${lint.hint}`,
    { name, reason: lint.reason, hint: lint.hint },
  );
}

function displayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** The household ingredient for a USDA food: the one already linked to it, else a new linked one. */
function ingredientForFood(ctx: Ctx, ref: IngredientRefInput & { fdcId: number }): Ingredient {
  const linked = ingredientsLinkedTo(ctx, ref.fdcId);
  if (linked.length > 0) {
    const wanted = ref.name === undefined ? null : normalizeName(ref.name);
    return linked.find((row) => row.normalizedName === wanted) ?? (linked[0] as Ingredient);
  }
  return insertIngredient(ctx, {
    fdcId: ref.fdcId,
    ...(ref.name === undefined ? {} : { name: ref.name }),
    ...(ref.category === undefined ? {} : { category: ref.category }),
  });
}

/**
 * Resolve ingredient references, in order, without creating free-text ingredients.
 * Every unknown name of the request is collected first and reported in one `unprocessable`
 * error (`details.unresolved`), each with suggestions. Run inside a transaction: foods
 * referenced by `fdcId` are created as linked ingredients while resolving.
 */
export function resolveIngredientRefs(ctx: Ctx, refs: IngredientRefInput[]): Ingredient[] {
  const resolved: Array<Ingredient | null> = [];
  const unresolved = new Map<string, UnresolvedIngredient>();

  refs.forEach((ref, index) => {
    const byId = ref.ingredientId !== undefined && ref.ingredientId !== "";
    const byName = ref.ingredient !== undefined && ref.ingredient.trim() !== "";
    const byFood = ref.fdcId !== undefined;
    if (Number(byId) + Number(byName) + Number(byFood) !== 1) {
      throw new AppError(
        "validation",
        "Each ingredient reference needs exactly one of `ingredientId`, `ingredient` or `fdcId`",
        { index },
      );
    }
    if (byId) {
      resolved.push(requireIngredient(ctx, ref.ingredientId as string));
    } else if (byName) {
      const found = findIngredientByName(ctx, ref.ingredient as string);
      if (found) {
        resolved.push(found);
      } else {
        const name = displayName(ref.ingredient as string);
        const key = normalizeName(name);
        if (!unresolved.has(key)) unresolved.set(key, unresolvedEntry(ctx, name));
        resolved.push(null);
      }
    } else {
      resolved.push(ingredientForFood(ctx, ref as IngredientRefInput & { fdcId: number }));
    }
  });

  if (unresolved.size > 0) throw unresolvedError([...unresolved.values()]);
  return resolved as Ingredient[];
}

/** One reference; see {@link resolveIngredientRefs}. */
export function resolveIngredientRef(ctx: Ctx, ref: IngredientRefInput): Ingredient {
  return resolveIngredientRefs(ctx, [ref])[0] as Ingredient;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface IngredientAliasView {
  id: string;
  alias: string;
  createdAt: string;
}

export interface IngredientStockView {
  id: string;
  qty: number | null;
  unit: string | null;
  qtyApprox: boolean;
  status: PantryStatus;
}

export interface IngredientNutritionView {
  source: "auto" | "manual";
  fdcId: number | null;
  description: string | null;
  per100g: Nutrients | null;
  /** Portions of the linked food; `defaultPortion` is one of these labels. */
  portions: FoodPortion[];
}

/** Ingredient row plus its aliases, measures, pantry stock and USDA match. */
export interface IngredientView
  extends Omit<Ingredient, "householdId" | "nutritionFdcId" | "nutritionSource"> {
  /** null = no USDA food matched (never matched, or auto-match found nothing confident). */
  nutrition: IngredientNutritionView | null;
  aliases: IngredientAliasView[];
  /** What one unit weighs: the linked food's measures, overridden by the household's own. */
  measures: Measure[];
  /** Valid units for pickers: the stock unit first, then the measures, then the built-in units. */
  units: string[];
  pantry: IngredientStockView[];
}

function nutritionView(row: Ingredient): IngredientNutritionView | null {
  if (row.nutritionSource === null) return null;
  const food = row.nutritionFdcId === null ? null : getFood(row.nutritionFdcId);
  if (row.nutritionSource === "auto" && food === null) return null;
  return {
    source: row.nutritionSource,
    fdcId: food?.fdcId ?? null,
    description: food?.description ?? null,
    per100g: food?.per100g ?? null,
    portions: food?.portions ?? [],
  };
}

export function ingredientView(ctx: Ctx, row: Ingredient): IngredientView {
  const {
    householdId: _householdId,
    nutritionFdcId: _nutritionFdcId,
    nutritionSource: _nutritionSource,
    ...rest
  } = row;

  const aliases = ctx.db
    .select({
      id: ingredientAliases.id,
      alias: ingredientAliases.alias,
      createdAt: ingredientAliases.createdAt,
    })
    .from(ingredientAliases)
    .where(
      and(
        eq(ingredientAliases.householdId, ctx.householdId),
        eq(ingredientAliases.ingredientId, row.id),
      ),
    )
    .orderBy(asc(ingredientAliases.alias))
    .all();

  const pantry = ctx.db
    .select({
      id: pantryItems.id,
      qty: pantryItems.qty,
      unit: pantryItems.unit,
      qtyApprox: pantryItems.qtyApprox,
      status: pantryItems.status,
    })
    .from(pantryItems)
    .where(
      and(eq(pantryItems.householdId, ctx.householdId), eq(pantryItems.ingredientId, row.id)),
    )
    .all();

  const measures = effectiveMeasures(ctx, row);
  return {
    ...rest,
    nutrition: nutritionView(row),
    aliases,
    measures,
    units: unitsForPicker(row.stockUnit, measures),
    pantry,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Run `fn` in a transaction (nested calls use SQLite savepoints). */
function withTx<T>(ctx: Ctx, fn: (tx: Ctx) => T): T {
  return ctx.db.transaction((tx) => fn({ ...ctx, db: tx as unknown as Ctx["db"] }));
}

export function requireIngredient(ctx: Ctx, id: string): Ingredient {
  const row = ctx.db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, id)))
    .get();
  if (!row) throw new AppError("not_found", `Ingredient not found: ${id}`);
  return row;
}

function findAliasRow(
  ctx: Ctx,
  alias: string,
): typeof ingredientAliases.$inferSelect | null {
  return (
    ctx.db
      .select()
      .from(ingredientAliases)
      .where(
        and(
          eq(ingredientAliases.householdId, ctx.householdId),
          eq(ingredientAliases.alias, alias),
        ),
      )
      .get() ?? null
  );
}

interface StockInput {
  stockUnit?: string | null | undefined;
  parQty?: number | null | undefined;
  /** Unit `parQty` is written in; it is converted into the stock unit (par is stored in it). */
  parUnit?: string | null | undefined;
}

/**
 * The stock unit and par an ingredient ends up with after `input`. A par written in another unit
 * is converted into the stock unit; the first par unit sets the stock unit. Changing the stock unit
 * converts the par and the pantry row into the new unit, or fails with a 422 and nothing changes.
 */
function resolveStock(
  ctx: Ctx,
  row: Ingredient,
  input: StockInput,
): { stockUnit: string | null; parQty: number | null } {
  const [stockInput = null, parUnit = null] = validateUnits(ctx, [
    { ingredientId: row.id, unit: input.stockUnit },
    { ingredientId: row.id, unit: input.parUnit },
  ]);
  const newPar = input.parQty === undefined ? undefined : requireParQty(input.parQty);
  let stockUnit = input.stockUnit === undefined ? row.stockUnit : (stockInput ?? null);
  let parQty = newPar === undefined ? row.parQty : newPar;

  if (parUnit !== null) {
    if (newPar === undefined || newPar === null) {
      throw new AppError("validation", "parUnit needs parQty: send both");
    }
    if (stockUnit === null) stockUnit = parUnit;
  }

  if (stockUnit !== row.stockUnit && stockUnit !== null) {
    if (newPar === undefined && parQty !== null) {
      parQty = convertOrThrow(ctx, parQty, row.stockUnit, stockUnit, row.id, "the par level");
    }
    const stocked = ctx.db
      .select()
      .from(pantryItems)
      .where(and(eq(pantryItems.householdId, ctx.householdId), eq(pantryItems.ingredientId, row.id)))
      .all();
    for (const item of stocked) {
      if (item.unit === stockUnit) continue;
      const qty =
        item.qty === null
          ? null
          : convertOrThrow(ctx, item.qty, item.unit, stockUnit, row.id, "the amount in the pantry");
      ctx.db
        .update(pantryItems)
        .set({
          qty,
          unit: stockUnit,
          status:
            item.qty === null ? item.status : statusFor(ctx, { ...row, stockUnit, parQty }, qty, stockUnit),
          updatedAt: nowIso(ctx),
        })
        .where(eq(pantryItems.id, item.id))
        .run();
    }
  }
  if (newPar !== undefined && newPar !== null && parUnit !== null && stockUnit !== null) {
    parQty = convertOrThrow(ctx, newPar, parUnit, stockUnit, row.id, "the par level");
  }
  return { stockUnit, parQty };
}

function requireParQty(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(raw) || raw < 0) {
    throw new AppError("validation", "parQty must be a non-negative number");
  }
  return raw;
}

function statusFor(
  ctx: Ctx,
  ingredient: Pick<Ingredient, "id" | "parQty" | "stockUnit">,
  qty: number | null,
  unit: string | null,
): PantryStatus {
  if (qty === null) return "unknown";
  if (qty <= 0) return "out";
  if (ingredient.parQty !== null) {
    // Par is in the stock unit.
    const par = convert(ctx, ingredient.parQty, ingredient.stockUnit, unit, ingredient.id);
    if (par !== null && qty <= par) return "low";
  }
  return "on_hand";
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ListIngredientsOptions {
  /** Case-insensitive substring matched against the name or any alias. */
  query?: string;
  category?: IngredientCategory;
  includeArchived?: boolean;
}

/** Ingredients with their aliases, conversions and pantry stock, sorted by name. */
export function listIngredients(
  ctx: Ctx,
  options: ListIngredientsOptions = {},
): IngredientView[] {
  const conditions = [eq(ingredients.householdId, ctx.householdId)];
  if (options.includeArchived !== true) conditions.push(isNull(ingredients.archivedAt));
  if (options.category !== undefined) conditions.push(eq(ingredients.category, options.category));

  const search = options.query?.trim() ?? "";
  if (search !== "") {
    const pattern = `%${normalizeName(search)}%`;
    const aliasMatches = ctx.db
      .select({ id: ingredientAliases.ingredientId })
      .from(ingredientAliases)
      .where(
        and(
          eq(ingredientAliases.householdId, ctx.householdId),
          like(ingredientAliases.alias, pattern),
        ),
      )
      .all()
      .map((row) => row.id);

    const nameMatch = like(ingredients.normalizedName, pattern);
    const match =
      aliasMatches.length > 0
        ? or(nameMatch, inArray(ingredients.id, aliasMatches))
        : nameMatch;
    if (match !== undefined) conditions.push(match);
  }

  const rows = ctx.db
    .select()
    .from(ingredients)
    .where(and(...conditions))
    .orderBy(asc(ingredients.normalizedName))
    .all();
  return rows.map((row) => ingredientView(ctx, row));
}

/** One ingredient with nested aliases, conversions and pantry stock. */
export function getIngredient(ctx: Ctx, id: string): IngredientView {
  return ingredientView(ctx, requireIngredient(ctx, id));
}

// ---------------------------------------------------------------------------
// Create / update / archive
// ---------------------------------------------------------------------------

export interface CreateIngredientInput {
  /** Required for a custom ingredient; derived from the USDA description when `fdcId` is set. */
  name?: string;
  description?: string | null;
  category?: IngredientCategory;
  aliases?: string[];
  /** The one unit the ingredient is stocked in. Unset: the first pantry write or par unit sets it. */
  stockUnit?: string | null;
  imageUrl?: string | null;
  shelfLifeDays?: number | null;
  parQty?: number | null;
  /** Par amount, in the stock unit. */
  parUnit?: string | null;
  notes?: string | null;
  /** Link the new ingredient to this USDA food (a linked ingredient). */
  fdcId?: number | null;
  /** Create an ingredient with no USDA food (last resort). Exclusive with `fdcId`. */
  custom?: boolean;
  /** Portion label of the linked food that a plain count means (e.g. "large" for eggs). */
  defaultPortion?: string | null;
  /** Custom only: flag the ingredient for review (default true; web sessions and the seed pass false). */
  needsReview?: boolean;
  /** Skip the conflict when another ingredient already links this food (the seed links "Red onion" and "Yellow onion" to one food). */
  allowSharedFood?: boolean;
}

/** The label as the food spells it, or a validation error when the food has no such portion. */
function checkDefaultPortion(fdcId: number | null, label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null;
  const wanted = label.trim().toLowerCase();
  if (wanted === "") return null;
  const food = fdcId === null ? null : getFood(fdcId);
  if (food === null) {
    throw new AppError("validation", "defaultPortion needs an ingredient linked to a USDA food", {
      defaultPortion: label,
    });
  }
  const portion = food.portions.find((item) => item.label.trim().toLowerCase() === wanted);
  if (!portion) {
    throw new AppError("validation", `The linked food has no portion "${label}"`, {
      defaultPortion: label,
      portions: food.portions.map((item) => item.label),
    });
  }
  return portion.label;
}

/** Insert an ingredient row: a linked one (`fdcId`) or a custom one. Lint and conflicts are checked. */
function insertIngredient(ctx: Ctx, input: CreateIngredientInput): Ingredient {
  const fdcId = input.fdcId ?? null;
  const food = fdcId === null ? null : getFood(fdcId);
  if (fdcId !== null && food === null) {
    throw new AppError("not_found", `Unknown USDA food: ${fdcId}`, { fdcId });
  }

  const supplied = input.name === undefined ? "" : titleCaseName(input.name);
  const name = supplied !== "" ? supplied : food === null ? "" : titleCaseName(suggestedNameForFood(food.description));
  if (name === "") throw new AppError("validation", "Ingredient name is required");
  const lint = lintIngredientName(name);
  if (!lint.ok) throw invalidNameError(name, lint);

  const normalized = normalizeName(name);
  const clash = findByNormalizedName(ctx, normalized);
  if (clash) {
    throw new AppError("conflict", `Ingredient already exists: ${name}`, {
      ingredientId: clash.id,
      name: clash.name,
      linkedFdcId: clash.nutritionFdcId,
    });
  }

  const timestamp = nowIso(ctx);
  return ctx.db
    .insert(ingredients)
    .values({
      id: newId("ing"),
      householdId: ctx.householdId,
      name,
      normalizedName: normalized,
      description: input.description ?? null,
      category: input.category ?? "other",
      stockUnit: null,
      imageUrl: normalizeImageUrl(input.imageUrl),
      shelfLifeDays: input.shelfLifeDays ?? null,
      notes: input.notes ?? null,
      // A deliberate choice: renaming never re-matches (a custom has no food, a linked one keeps its food).
      nutritionFdcId: fdcId,
      nutritionSource: "manual",
      defaultPortion: checkDefaultPortion(fdcId, input.defaultPortion),
      needsReview: fdcId === null && (input.needsReview ?? true),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()
    .get();
}

function createIngredientIn(ctx: Ctx, input: CreateIngredientInput): IngredientView {
  const fdcId = input.fdcId ?? null;
  if (fdcId !== null && input.custom === true) {
    throw new AppError("validation", "Send `fdcId` or `custom: true`, not both");
  }
  if (fdcId === null && input.custom !== true) {
    const name = input.name === undefined ? "" : displayName(input.name);
    if (name === "") throw new AppError("validation", "Ingredient name is required");
    throw unresolvedError([unresolvedEntry(ctx, name)]);
  }

  if (fdcId !== null && input.allowSharedFood !== true) {
    const existing = ingredientsLinkedTo(ctx, fdcId).find((row) => row.archivedAt === null);
    if (existing) {
      throw new AppError(
        "conflict",
        `USDA food ${fdcId} is already linked to the ingredient "${existing.name}"`,
        { ingredientId: existing.id, name: existing.name, fdcId },
      );
    }
  }

  const row = settleStock(ctx, insertIngredient(ctx, input), input);
  const seen = new Set<string>();
  for (const raw of input.aliases ?? []) {
    const alias = normalizeName(raw);
    if (alias === "" || seen.has(alias)) continue;
    seen.add(alias);
    addAliasIn(ctx, row.id, raw);
  }
  return ingredientView(ctx, row);
}

/**
 * Create an ingredient (aliases included): linked to a USDA food (`fdcId`) or, as a last
 * resort, custom (`custom: true`). Without either the call is `unprocessable` with suggestions.
 * Duplicate names/aliases are a conflict; names must pass the name lint.
 */
export function createIngredient(ctx: Ctx, input: CreateIngredientInput): IngredientView {
  return withTx(ctx, (tx) => createIngredientIn(tx, input));
}

export interface UpdateIngredientInput {
  name?: string;
  description?: string | null;
  category?: IngredientCategory;
  stockUnit?: string | null;
  imageUrl?: string | null;
  shelfLifeDays?: number | null;
  parQty?: number | null;
  parUnit?: string | null;
  notes?: string | null;
  /** Portion label of the linked food a plain count means; null clears it. */
  defaultPortion?: string | null;
}

/** Shopping items keep a copy of the ingredient name; follow a rename unless the item has its own text. */
function renameShoppingItems(ctx: Ctx, row: Ingredient, name: string): void {
  const items = ctx.db
    .select({ id: shoppingListItems.id, name: shoppingListItems.name })
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.householdId, ctx.householdId),
        eq(shoppingListItems.ingredientId, row.id),
      ),
    )
    .all();
  const ids = items.filter((item) => normalizeName(item.name) === row.normalizedName).map((item) => item.id);
  if (ids.length === 0) return;
  ctx.db
    .update(shoppingListItems)
    .set({ name })
    .where(and(eq(shoppingListItems.householdId, ctx.householdId), inArray(shoppingListItems.id, ids)))
    .run();
}

function updateIngredientIn(
  ctx: Ctx,
  id: string,
  input: UpdateIngredientInput,
): IngredientView {
  const row = requireIngredient(ctx, id);
  const patch: Partial<typeof ingredients.$inferInsert> = {};

  if (input.name !== undefined) {
    const name = titleCaseName(input.name);
    const normalized = normalizeName(name);
    if (normalized === "") throw new AppError("validation", "Ingredient name is required");
    // Existing bad names stay as they are; only a new name has to pass the lint (a case-only change is not new).
    const renamed = normalized !== row.normalizedName;
    if (renamed) {
      const lint = lintIngredientName(name);
      if (!lint.ok) throw invalidNameError(name, lint);
    }
    const clash = findByNormalizedName(ctx, normalized);
    if (clash && clash.id !== row.id) {
      throw new AppError("conflict", `Ingredient already exists: ${name}`, {
        ingredientId: clash.id,
        name: clash.name,
      });
    }
    patch.name = name;
    patch.normalizedName = normalized;
    if (renamed && row.nutritionSource !== "manual") {
      patch.nutritionFdcId = autoMatchFood(name)?.fdcId ?? null;
      patch.nutritionSource = "auto";
      if (patch.nutritionFdcId !== null) patch.needsReview = false;
    }
  }
  if (input.description !== undefined) patch.description = input.description;
  if (input.category !== undefined) patch.category = input.category;
  if (input.imageUrl !== undefined) patch.imageUrl = normalizeImageUrl(input.imageUrl);
  if (input.shelfLifeDays !== undefined) patch.shelfLifeDays = input.shelfLifeDays;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.stockUnit !== undefined || input.parQty !== undefined || input.parUnit !== undefined) {
    const stock = resolveStock(ctx, row, input);
    patch.stockUnit = stock.stockUnit;
    patch.parQty = stock.parQty;
  }

  const fdcId = patch.nutritionFdcId === undefined ? row.nutritionFdcId : patch.nutritionFdcId;
  if (input.defaultPortion !== undefined) {
    patch.defaultPortion = checkDefaultPortion(fdcId, input.defaultPortion);
  } else if (patch.nutritionFdcId !== undefined && row.defaultPortion !== null) {
    // A new food may not have the portion the old one had.
    const food = fdcId === null ? null : getFood(fdcId);
    const wanted = row.defaultPortion.toLowerCase();
    if (!food?.portions.some((portion) => portion.label.toLowerCase() === wanted)) {
      patch.defaultPortion = null;
    }
  }

  if (Object.keys(patch).length === 0) return ingredientView(ctx, row);

  patch.updatedAt = nowIso(ctx);
  const updated = ctx.db
    .update(ingredients)
    .set(patch)
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, row.id)))
    .returning()
    .get();
  if (patch.name !== undefined && patch.name !== row.name) renameShoppingItems(ctx, row, patch.name);
  return ingredientView(ctx, updated);
}

/** Partial update; renaming keeps `normalizedName` in sync. */
export function updateIngredient(
  ctx: Ctx,
  id: string,
  input: UpdateIngredientInput,
): IngredientView {
  return withTx(ctx, (tx) => updateIngredientIn(tx, id, input));
}

/** Soft-delete: sets `archivedAt`. History keeps resolving the ingredient. */
export function archiveIngredient(ctx: Ctx, id: string): IngredientView {
  return withTx(ctx, (tx) => {
    const row = requireIngredient(tx, id);
    if (row.archivedAt !== null) return ingredientView(tx, row);
    const updated = tx.db
      .update(ingredients)
      .set({ archivedAt: nowIso(tx), updatedAt: nowIso(tx) })
      .where(and(eq(ingredients.householdId, tx.householdId), eq(ingredients.id, id)))
      .returning()
      .get();
    return ingredientView(tx, updated);
  });
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

function addAliasIn(ctx: Ctx, ingredientId: string, rawAlias: string): IngredientAliasView {
  const ingredient = requireIngredient(ctx, ingredientId);
  const alias = normalizeName(rawAlias);
  if (alias === "") throw new AppError("validation", "Alias is required");
  if (alias === ingredient.normalizedName) {
    throw new AppError("conflict", `Alias duplicates the ingredient name: ${alias}`);
  }
  if (findAliasRow(ctx, alias)) {
    throw new AppError("conflict", `Alias already in use: ${alias}`);
  }
  if (findByNormalizedName(ctx, alias)) {
    throw new AppError("conflict", `Alias conflicts with an ingredient name: ${alias}`);
  }

  return ctx.db
    .insert(ingredientAliases)
    .values({
      id: newId("ali"),
      householdId: ctx.householdId,
      ingredientId: ingredient.id,
      alias,
      createdAt: nowIso(ctx),
    })
    .returning({ id: ingredientAliases.id, alias: ingredientAliases.alias, createdAt: ingredientAliases.createdAt })
    .get();
}

/** Add an alternate name; collisions with names or other aliases are a conflict. */
export function addAlias(ctx: Ctx, ingredientId: string, alias: string): IngredientAliasView {
  return withTx(ctx, (tx) => addAliasIn(tx, ingredientId, alias));
}

/** Remove one of an ingredient's aliases. */
export function removeAlias(ctx: Ctx, ingredientId: string, aliasId: string): void {
  const result = ctx.db
    .delete(ingredientAliases)
    .where(
      and(
        eq(ingredientAliases.householdId, ctx.householdId),
        eq(ingredientAliases.id, aliasId),
        eq(ingredientAliases.ingredientId, ingredientId),
      ),
    )
    .run();
  if (result.changes === 0) {
    throw new AppError("not_found", `Alias not found: ${aliasId}`);
  }
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeIngredientsResult {
  ingredient: IngredientView;
  moved: {
    recipeIngredients: number;
    pantryItems: number;
    shoppingItems: number;
    rules: number;
    measures: number;
    aliases: number;
  };
}

/** After recipe lines moved from `sourceId` to `targetId`: no alternative may equal its line's main or repeat. */
function repointAlternatives(tx: Ctx, sourceId: string, targetId: string): void {
  const lineIds = (ingredientId: string): string[] =>
    tx.db
      .select({ id: recipeIngredients.id })
      .from(recipeIngredients)
      .where(
        and(
          eq(recipeIngredients.householdId, tx.householdId),
          eq(recipeIngredients.ingredientId, ingredientId),
        ),
      )
      .all()
      .map((row) => row.id);

  // Lines whose main is now the target cannot also list it as an alternative.
  const targetLines = lineIds(targetId);
  if (targetLines.length > 0) {
    tx.db
      .delete(recipeIngredientAlternatives)
      .where(
        and(
          eq(recipeIngredientAlternatives.ingredientId, targetId),
          inArray(recipeIngredientAlternatives.recipeIngredientId, targetLines),
        ),
      )
      .run();
  }

  const asAlternative = tx.db
    .select()
    .from(recipeIngredientAlternatives)
    .where(eq(recipeIngredientAlternatives.ingredientId, sourceId))
    .all();
  for (const row of asAlternative) {
    const duplicate =
      tx.db
        .select({ id: recipeIngredientAlternatives.id })
        .from(recipeIngredientAlternatives)
        .where(
          and(
            eq(recipeIngredientAlternatives.recipeIngredientId, row.recipeIngredientId),
            eq(recipeIngredientAlternatives.ingredientId, targetId),
          ),
        )
        .get() !== undefined;
    const isMain = targetLines.includes(row.recipeIngredientId);
    if (duplicate || isMain) {
      tx.db.delete(recipeIngredientAlternatives).where(eq(recipeIngredientAlternatives.id, row.id)).run();
    } else {
      tx.db
        .update(recipeIngredientAlternatives)
        .set({ ingredientId: targetId })
        .where(eq(recipeIngredientAlternatives.id, row.id))
        .run();
    }
  }
}

/**
 * Move `source`'s pantry rows to `target`: one row per ingredient, so amounts are summed when
 * the units convert and the ledger history follows. Returns how many source rows moved.
 */
function movePantryRows(tx: Ctx, source: Ingredient, target: Ingredient, timestamp: string): number {
  // Pantry: one row per ingredient; sum when the units match, otherwise keep the target's row.
  const sourceRows = tx.db
    .select()
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.householdId, tx.householdId),
        eq(pantryItems.ingredientId, source.id),
      ),
    )
    .all();
  const targetRows = tx.db
    .select()
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.householdId, tx.householdId),
        eq(pantryItems.ingredientId, target.id),
      ),
    )
    .all();
  const dst = targetRows[0];

  let pantryItemsMoved = 0;
  for (const src of sourceRows) {
    if (!dst) {
      // The row follows the ingredient into its stock unit when the units compare; otherwise it
      // keeps its own unit and the review list flags it.
      const stock = target.stockUnit ?? source.stockUnit ?? src.unit;
      const set: Partial<typeof pantryItems.$inferInsert> = { ingredientId: target.id, updatedAt: timestamp };
      if (src.qty !== null && src.unit !== stock) {
        const converted =
          convert(tx, src.qty, src.unit, stock, target.id) ?? convert(tx, src.qty, src.unit, stock, source.id);
        if (converted !== null) {
          set.qty = converted;
          set.unit = stock;
        }
      }
      tx.db.update(pantryItems).set(set).where(eq(pantryItems.id, src.id)).run();
      if (target.stockUnit === null && stock !== null) {
        target.stockUnit = stock;
        tx.db.update(ingredients).set({ stockUnit: stock }).where(eq(ingredients.id, target.id)).run();
      }
      pantryItemsMoved += 1;
      continue;
    }

    let qty = dst.qty;
    let unit = dst.unit;
    let changed = false;
    if (qty === null && src.qty !== null) {
      qty = src.qty;
      unit = src.unit;
      changed = true;
    } else if (qty !== null && src.qty !== null) {
      // The source's own measures are still in scope here (they move to the
      // target later), so a measure defined only on the source is still usable.
      const converted =
        convert(tx, src.qty, src.unit, unit, target.id) ??
        convert(tx, src.qty, src.unit, unit, source.id);
      if (converted === null) {
        throw new AppError(
          "unprocessable",
          `Cannot merge ${source.name} into ${target.name}: ${src.qty} ${src.unit ?? "unit"} is not convertible to ${unit ?? "unit"}`,
          {
            ingredient: target.id,
            source: source.id,
            fromUnit: src.unit,
            toUnit: unit,
          },
        );
      }
      qty = qty + converted;
      changed = true;
    }
    const status = changed ? statusFor(tx, target, qty, unit) : dst.status;
    tx.db
      .update(pantryItems)
      .set({ qty, unit, status, updatedAt: timestamp })
      .where(eq(pantryItems.id, dst.id))
      .run();
    // Keep the ledger history on the surviving row (movements cascade-delete).
    tx.db
      .update(stockMovements)
      .set({ pantryItemId: dst.id })
      .where(eq(stockMovements.pantryItemId, src.id))
      .run();
    tx.db.delete(pantryItems).where(eq(pantryItems.id, src.id)).run();
    pantryItemsMoved += 1;
  }

  return pantryItemsMoved;
}

/**
 * Fold `sourceId` into `targetId` in one transaction: recipe ingredients, pantry
 * stock (summed when the units match), shopping items, rules and conversions
 * move over; the source name becomes an alias of the target and the source row
 * is deleted.
 */
export function mergeIngredients(
  ctx: Ctx,
  sourceId: string,
  targetId: string,
): MergeIngredientsResult {
  if (sourceId === targetId) {
    throw new AppError("validation", "Cannot merge an ingredient into itself");
  }
  return withTx(ctx, (tx) => {
    const source = requireIngredient(tx, sourceId);
    const target = requireIngredient(tx, targetId);
    const timestamp = nowIso(tx);

    // Keep the target's USDA match; carry the source's over when the target has none.
    if (target.nutritionFdcId === null && source.nutritionFdcId !== null) {
      target.nutritionFdcId = source.nutritionFdcId;
      target.nutritionSource = source.nutritionSource;
      target.needsReview = false;
      tx.db
        .update(ingredients)
        .set({
          nutritionFdcId: source.nutritionFdcId,
          nutritionSource: source.nutritionSource,
          needsReview: false,
          updatedAt: timestamp,
        })
        .where(and(eq(ingredients.householdId, tx.householdId), eq(ingredients.id, target.id)))
        .run();
    }

    const recipeIngredientsMoved = tx.db
      .update(recipeIngredients)
      .set({ ingredientId: target.id })
      .where(
        and(
          eq(recipeIngredients.householdId, tx.householdId),
          eq(recipeIngredients.ingredientId, source.id),
        ),
      )
      .run().changes;
    repointAlternatives(tx, source.id, target.id);

    const pantryItemsMoved = movePantryRows(tx, source, target, timestamp);

    const shoppingItemsMoved = tx.db
      .update(shoppingListItems)
      .set({ ingredientId: target.id })
      .where(
        and(
          eq(shoppingListItems.householdId, tx.householdId),
          eq(shoppingListItems.ingredientId, source.id),
        ),
      )
      .run().changes;
    tx.db
      .update(shoppingListItems)
      .set({ substituteIngredientId: target.id })
      .where(
        and(
          eq(shoppingListItems.householdId, tx.householdId),
          eq(shoppingListItems.substituteIngredientId, source.id),
        ),
      )
      .run();

    const rulesMoved = tx.db
      .update(dietaryRules)
      .set({ ingredientId: target.id, updatedAt: timestamp })
      .where(
        and(
          eq(dietaryRules.householdId, tx.householdId),
          eq(dietaryRules.ingredientId, source.id),
        ),
      )
      .run().changes;

    const measuresMoved = moveMeasures(tx, source.id, target.id);

    const sourceAliases = tx.db
      .select()
      .from(ingredientAliases)
      .where(
        and(
          eq(ingredientAliases.householdId, tx.householdId),
          eq(ingredientAliases.ingredientId, source.id),
        ),
      )
      .all();
    let aliasesMoved = 0;
    for (const row of sourceAliases) {
      const owner = findAliasRow(tx, row.alias);
      if ((owner && owner.id !== row.id) || row.alias === target.normalizedName) {
        tx.db.delete(ingredientAliases).where(eq(ingredientAliases.id, row.id)).run();
        continue;
      }
      tx.db
        .update(ingredientAliases)
        .set({ ingredientId: target.id })
        .where(eq(ingredientAliases.id, row.id))
        .run();
      aliasesMoved += 1;
    }

    if (
      source.normalizedName !== target.normalizedName &&
      findAliasRow(tx, source.normalizedName) === null
    ) {
      tx.db
        .insert(ingredientAliases)
        .values({
          id: newId("ali"),
          householdId: tx.householdId,
          ingredientId: target.id,
          alias: source.normalizedName,
          createdAt: timestamp,
        })
        .run();
      aliasesMoved += 1;
    }

    tx.db
      .delete(ingredients)
      .where(and(eq(ingredients.householdId, tx.householdId), eq(ingredients.id, source.id)))
      .run();

    return {
      ingredient: ingredientView(tx, target),
      moved: {
        recipeIngredients: recipeIngredientsMoved,
        pantryItems: pantryItemsMoved,
        shoppingItems: shoppingItemsMoved,
        rules: rulesMoved,
        measures: measuresMoved,
        aliases: aliasesMoved,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export type ReviewReason = "unlinked" | "lint" | "custom_unreviewed" | "unit";

export interface ReviewItem {
  ingredient: IngredientView;
  reasons: ReviewReason[];
  /** Why the name fails the lint (when `reasons` has "lint"). */
  lint?: { reason: string; hint: string };
  /** The units a recipe line or pantry row uses that convert to neither grams nor the stock unit (when `reasons` has "unit"). */
  units?: string[];
  /** Ways to fix an unlinked or badly named ingredient: existing ingredients and USDA foods. */
  suggestions: Suggestion[];
}

interface UsedUnits {
  recipe: Set<string | null>;
  pantry: Set<string | null>;
}

/** The units recipe lines and pantry rows use, per ingredient (one ingredient, or all of the household). */
function loadUsedUnits(ctx: Ctx, ingredientId?: string): Map<string, UsedUnits> {
  const used = new Map<string, UsedUnits>();
  const entry = (id: string): UsedUnits => {
    let item = used.get(id);
    if (!item) {
      item = { recipe: new Set(), pantry: new Set() };
      used.set(id, item);
    }
    return item;
  };
  const lines = ctx.db
    .selectDistinct({ ingredientId: recipeIngredients.ingredientId, unit: recipeIngredients.unit })
    .from(recipeIngredients)
    .where(
      and(
        eq(recipeIngredients.householdId, ctx.householdId),
        isNotNull(recipeIngredients.qty),
        ingredientId === undefined ? undefined : eq(recipeIngredients.ingredientId, ingredientId),
      ),
    )
    .all();
  for (const line of lines) entry(line.ingredientId).recipe.add(line.unit);
  const stock = ctx.db
    .selectDistinct({ ingredientId: pantryItems.ingredientId, unit: pantryItems.unit })
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.householdId, ctx.householdId),
        isNotNull(pantryItems.qty),
        ingredientId === undefined ? undefined : eq(pantryItems.ingredientId, ingredientId),
      ),
    )
    .all();
  for (const item of stock) entry(item.ingredientId).pantry.add(item.unit);
  return used;
}

/**
 * Units in use that nothing converts: a recipe line unit that reaches neither grams nor the stock
 * unit (so no nutrition, no pantry comparison), or a pantry row that is not in, or convertible
 * into, the stock unit.
 */
function badUnitsFor(ctx: Ctx, row: Ingredient, used: UsedUnits | undefined): string[] {
  if (used === undefined) return [];
  const converter = converterFor(ctx, row.id);
  const bad = new Set<string>();
  for (const unit of used.recipe) {
    if (converter(1, unit, "g") !== null) continue;
    if (converter(1, unit, row.stockUnit ?? "count") !== null) continue;
    bad.add(unit ?? "count");
  }
  if (row.stockUnit !== null) {
    for (const unit of used.pantry) {
      if (converter(1, unit, row.stockUnit) === null) bad.add(unit ?? "count");
    }
  }
  return [...bad];
}

/** The review entry for an ingredient, or null when nothing needs attention. */
function reviewItemFor(ctx: Ctx, row: Ingredient, used?: UsedUnits): ReviewItem | null {
  const lint = lintIngredientName(row.name);
  const units = badUnitsFor(ctx, row, used ?? loadUsedUnits(ctx, row.id).get(row.id));
  if (!row.needsReview && lint.ok && units.length === 0) return null;

  const reasons: ReviewReason[] = [];
  if (row.nutritionFdcId === null && (row.needsReview || !lint.ok)) reasons.push("unlinked");
  if (!lint.ok) reasons.push("lint");
  if (row.needsReview) reasons.push("custom_unreviewed");
  if (units.length > 0) reasons.push("unit");
  return {
    ingredient: ingredientView(ctx, row),
    reasons,
    ...(lint.ok ? {} : { lint: { reason: lint.reason, hint: lint.hint } }),
    ...(units.length === 0 ? {} : { units }),
    suggestions:
      reasons.includes("unlinked") || !lint.ok
        ? suggestForName(ctx, row.name, { excludeId: row.id })
        : [],
  };
}

/** Write the resolved stock unit and par of a new ingredient; returns the stored row. */
function settleStock(ctx: Ctx, row: Ingredient, input: StockInput): Ingredient {
  if (input.stockUnit === undefined && input.parQty === undefined && input.parUnit === undefined) return row;
  const stock = resolveStock(ctx, row, input);
  return ctx.db
    .update(ingredients)
    .set({ stockUnit: stock.stockUnit, parQty: stock.parQty })
    .where(eq(ingredients.id, row.id))
    .returning()
    .get();
}

/**
 * Ingredients a person should look at: flagged for review (customs made over the API/MCP,
 * unlinked legacy rows) or with a name that fails the name lint. Archived ones are skipped.
 * Accepting an ingredient clears the flag; a lint problem stays until the name is fixed.
 */
export function listIngredientsForReview(ctx: Ctx): ReviewItem[] {
  const rows = ctx.db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.householdId, ctx.householdId), isNull(ingredients.archivedAt)))
    .orderBy(asc(ingredients.normalizedName))
    .all();
  const used = loadUsedUnits(ctx);
  return rows.flatMap((row) => {
    const item = reviewItemFor(ctx, row, used.get(row.id) ?? { recipe: new Set(), pantry: new Set() });
    return item === null ? [] : [item];
  });
}

/** Accept an ingredient as it is: clears the review flag. */
export function acceptIngredient(ctx: Ctx, id: string): IngredientView {
  const row = requireIngredient(ctx, id);
  if (!row.needsReview) return ingredientView(ctx, row);
  const updated = ctx.db
    .update(ingredients)
    .set({ needsReview: false, updatedAt: nowIso(ctx) })
    .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, row.id)))
    .returning()
    .get();
  return ingredientView(ctx, updated);
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

export interface SplitIngredientInput {
  /** Becomes the main ingredient of every recipe line that used the split ingredient. */
  main: IngredientRefInput;
  /** Become alternatives of those lines. */
  alternatives?: IngredientRefInput[];
}

export interface SplitIngredientResult {
  /** The archived ingredient that was split. */
  source: IngredientView;
  main: IngredientView;
  alternatives: IngredientView[];
  moved: {
    /** Recipe lines whose main ingredient was the source. */
    recipeLines: number;
    /** Recipe lines that listed the source as an alternative. */
    alternativeLines: number;
    pantryItems: number;
    shoppingItems: number;
  };
}

/** Add alternatives to a line, skipping its main ingredient and ones it already has. */
function appendAlternatives(tx: Ctx, lineId: string, mainId: string, ids: string[]): void {
  const existing = tx.db
    .select({ ingredientId: recipeIngredientAlternatives.ingredientId, position: recipeIngredientAlternatives.position })
    .from(recipeIngredientAlternatives)
    .where(eq(recipeIngredientAlternatives.recipeIngredientId, lineId))
    .all();
  const have = new Set(existing.map((row) => row.ingredientId));
  have.add(mainId);
  let position = existing.reduce((max, row) => Math.max(max, row.position), -1);
  for (const ingredientId of ids) {
    if (have.has(ingredientId)) continue;
    have.add(ingredientId);
    position += 1;
    tx.db
      .insert(recipeIngredientAlternatives)
      .values({
        id: newId("ria"),
        householdId: tx.householdId,
        recipeIngredientId: lineId,
        ingredientId,
        position,
      })
      .run();
  }
}

/**
 * Split an ingredient that names several ("Milk or water") into real ones. Every recipe line
 * that used it gets `main` as its ingredient and `alternatives` as alternatives; lines that
 * listed it as an alternative get all of them as alternatives. Pantry stock and shopping items
 * move to `main`. The split ingredient is archived. Unknown names are `unprocessable`.
 */
export function splitIngredient(
  ctx: Ctx,
  id: string,
  input: SplitIngredientInput,
): SplitIngredientResult {
  return withTx(ctx, (tx) => {
    const source = requireIngredient(tx, id);
    const resolved = resolveIngredientRefs(tx, [input.main, ...(input.alternatives ?? [])]);
    const main = resolved[0] as Ingredient;
    if (main.id === source.id) {
      throw new AppError("validation", "The main ingredient must differ from the ingredient being split");
    }
    const alternativeRows: Ingredient[] = [];
    for (const row of resolved.slice(1)) {
      if (row.id === main.id || row.id === source.id) continue;
      if (!alternativeRows.some((item) => item.id === row.id)) alternativeRows.push(row);
    }
    const replacement = [main, ...alternativeRows];
    const timestamp = nowIso(tx);

    const lines = tx.db
      .select({ id: recipeIngredients.id })
      .from(recipeIngredients)
      .where(
        and(
          eq(recipeIngredients.householdId, tx.householdId),
          eq(recipeIngredients.ingredientId, source.id),
        ),
      )
      .all();
    for (const line of lines) {
      tx.db
        .update(recipeIngredients)
        .set({ ingredientId: main.id })
        .where(eq(recipeIngredients.id, line.id))
        .run();
      tx.db
        .delete(recipeIngredientAlternatives)
        .where(
          and(
            eq(recipeIngredientAlternatives.recipeIngredientId, line.id),
            eq(recipeIngredientAlternatives.ingredientId, main.id),
          ),
        )
        .run();
      appendAlternatives(tx, line.id, main.id, alternativeRows.map((row) => row.id));
    }

    const asAlternative = tx.db
      .select()
      .from(recipeIngredientAlternatives)
      .where(
        and(
          eq(recipeIngredientAlternatives.householdId, tx.householdId),
          eq(recipeIngredientAlternatives.ingredientId, source.id),
        ),
      )
      .all();
    for (const row of asAlternative) {
      const line = tx.db
        .select({ ingredientId: recipeIngredients.ingredientId })
        .from(recipeIngredients)
        .where(eq(recipeIngredients.id, row.recipeIngredientId))
        .get();
      tx.db.delete(recipeIngredientAlternatives).where(eq(recipeIngredientAlternatives.id, row.id)).run();
      if (line) {
        appendAlternatives(tx, row.recipeIngredientId, line.ingredientId, replacement.map((item) => item.id));
      }
    }

    const pantryItemsMoved = movePantryRows(tx, source, main, timestamp);
    const shoppingItemsMoved = tx.db
      .update(shoppingListItems)
      .set({ ingredientId: main.id })
      .where(
        and(
          eq(shoppingListItems.householdId, tx.householdId),
          eq(shoppingListItems.ingredientId, source.id),
        ),
      )
      .run().changes;
    tx.db
      .update(shoppingListItems)
      .set({ substituteIngredientId: main.id })
      .where(
        and(
          eq(shoppingListItems.householdId, tx.householdId),
          eq(shoppingListItems.substituteIngredientId, source.id),
        ),
      )
      .run();

    const archived = tx.db
      .update(ingredients)
      .set({ archivedAt: timestamp, needsReview: false, updatedAt: timestamp })
      .where(and(eq(ingredients.householdId, tx.householdId), eq(ingredients.id, source.id)))
      .returning()
      .get();

    return {
      source: ingredientView(tx, archived),
      main: ingredientView(tx, requireIngredient(tx, main.id)),
      alternatives: alternativeRows.map((row) => ingredientView(tx, requireIngredient(tx, row.id))),
      moved: {
        recipeLines: lines.length,
        alternativeLines: asAlternative.length,
        pantryItems: pantryItemsMoved,
        shoppingItems: shoppingItemsMoved,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Detail and usage
// ---------------------------------------------------------------------------

export interface IngredientRecipeUsage {
  id: string;
  slug: string;
  title: string;
  /** Recipe lines that use the ingredient, as the main ingredient or as an alternative. */
  lines: number;
  asMain: number;
  asAlternative: number;
}

export interface IngredientShoppingUsage {
  itemId: string;
  listId: string;
  listTitle: string;
  listStatus: ShoppingListStatus;
  name: string;
  qty: number | null;
  unit: string | null;
  checked: boolean;
}

export interface IngredientRuleUsage {
  id: string;
  severity: RuleSeverity;
  reason: string | null;
  conditionNote: string | null;
  /** null = the whole household. */
  memberId: string | null;
}

/** Where an ingredient is used: recipes, pantry, open shopping lists and dietary rules. */
export interface IngredientUsage {
  recipes: IngredientRecipeUsage[];
  pantryItem: IngredientStockView | null;
  /** Items of shopping lists that are not done. */
  shoppingItems: IngredientShoppingUsage[];
  /** Dietary rules for this ingredient (scope ingredient). */
  rules: IngredientRuleUsage[];
}

export interface IngredientDetail extends IngredientView {
  usage: IngredientUsage;
  /** Why the ingredient needs attention; null when it does not. */
  review: Omit<ReviewItem, "ingredient"> | null;
}

function recipeUsage(ctx: Ctx, ingredientId: string): IngredientRecipeUsage[] {
  const main = ctx.db
    .select({ id: recipes.id, slug: recipes.slug, title: recipes.title, lines: sql<number>`count(*)` })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(
      and(
        eq(recipeIngredients.householdId, ctx.householdId),
        eq(recipeIngredients.ingredientId, ingredientId),
      ),
    )
    .groupBy(recipes.id)
    .all();
  const alternative = ctx.db
    .select({ id: recipes.id, slug: recipes.slug, title: recipes.title, lines: sql<number>`count(*)` })
    .from(recipeIngredientAlternatives)
    .innerJoin(recipeIngredients, eq(recipeIngredients.id, recipeIngredientAlternatives.recipeIngredientId))
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(
      and(
        eq(recipeIngredientAlternatives.householdId, ctx.householdId),
        eq(recipeIngredientAlternatives.ingredientId, ingredientId),
      ),
    )
    .groupBy(recipes.id)
    .all();

  const byRecipe = new Map<string, IngredientRecipeUsage>();
  for (const row of main) {
    byRecipe.set(row.id, { id: row.id, slug: row.slug, title: row.title, lines: row.lines, asMain: row.lines, asAlternative: 0 });
  }
  for (const row of alternative) {
    const entry = byRecipe.get(row.id);
    if (entry) {
      entry.asAlternative = row.lines;
      entry.lines += row.lines;
    } else {
      byRecipe.set(row.id, { id: row.id, slug: row.slug, title: row.title, lines: row.lines, asMain: 0, asAlternative: row.lines });
    }
  }
  return [...byRecipe.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function shoppingUsage(ctx: Ctx, ingredientId: string): IngredientShoppingUsage[] {
  return ctx.db
    .select({
      itemId: shoppingListItems.id,
      listId: shoppingLists.id,
      listTitle: shoppingLists.title,
      listStatus: shoppingLists.status,
      name: shoppingListItems.name,
      qty: shoppingListItems.qty,
      unit: shoppingListItems.unit,
      checkedAt: shoppingListItems.checkedAt,
    })
    .from(shoppingListItems)
    .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingListItems.shoppingListId))
    .where(
      and(
        eq(shoppingListItems.householdId, ctx.householdId),
        eq(shoppingListItems.ingredientId, ingredientId),
        ne(shoppingLists.status, "done"),
      ),
    )
    .orderBy(asc(shoppingLists.createdAt), asc(shoppingListItems.position))
    .all()
    .map(({ checkedAt, ...item }) => ({ ...item, checked: checkedAt !== null }));
}

/** One ingredient with its usage (recipes, pantry, open shopping items, rules) and review state. */
export function getIngredientDetail(ctx: Ctx, id: string): IngredientDetail {
  const row = requireIngredient(ctx, id);
  const view = ingredientView(ctx, row);
  const rules = ctx.db
    .select({
      id: dietaryRules.id,
      severity: dietaryRules.severity,
      reason: dietaryRules.reason,
      conditionNote: dietaryRules.conditionNote,
      memberId: dietaryRules.memberId,
    })
    .from(dietaryRules)
    .where(
      and(
        eq(dietaryRules.householdId, ctx.householdId),
        eq(dietaryRules.scope, "ingredient"),
        eq(dietaryRules.ingredientId, row.id),
      ),
    )
    .all();
  const review = row.archivedAt === null ? reviewItemFor(ctx, row) : null;
  return {
    ...view,
    usage: {
      recipes: recipeUsage(ctx, row.id),
      pantryItem: view.pantry[0] ?? null,
      shoppingItems: shoppingUsage(ctx, row.id),
      rules,
    },
    review:
      review === null
        ? null
        : {
            reasons: review.reasons,
            ...(review.lint === undefined ? {} : { lint: review.lint }),
            ...(review.units === undefined ? {} : { units: review.units }),
            suggestions: review.suggestions,
          },
  };
}

export interface IngredientUsageCount {
  ingredientId: string;
  recipes: number;
  pantry: number;
  shopping: number;
  rules: number;
}

/**
 * Use counts for every ingredient that is used somewhere (recipe line or alternative,
 * pantry row, open shopping item, ingredient rule). Ingredients that are not listed are unused.
 */
export function listIngredientUsageCounts(ctx: Ctx): IngredientUsageCount[] {
  const counts = new Map<string, IngredientUsageCount>();
  const entry = (ingredientId: string): IngredientUsageCount => {
    let item = counts.get(ingredientId);
    if (!item) {
      item = { ingredientId, recipes: 0, pantry: 0, shopping: 0, rules: 0 };
      counts.set(ingredientId, item);
    }
    return item;
  };

  const mainRows = ctx.db
    .selectDistinct({ ingredientId: recipeIngredients.ingredientId, recipeId: recipeIngredients.recipeId })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.householdId, ctx.householdId))
    .all();
  const alternativeRows = ctx.db
    .selectDistinct({
      ingredientId: recipeIngredientAlternatives.ingredientId,
      recipeId: recipeIngredients.recipeId,
    })
    .from(recipeIngredientAlternatives)
    .innerJoin(recipeIngredients, eq(recipeIngredients.id, recipeIngredientAlternatives.recipeIngredientId))
    .where(eq(recipeIngredientAlternatives.householdId, ctx.householdId))
    .all();
  const recipesOf = new Map<string, Set<string>>();
  for (const row of [...mainRows, ...alternativeRows]) {
    const seen = recipesOf.get(row.ingredientId) ?? new Set<string>();
    seen.add(row.recipeId);
    recipesOf.set(row.ingredientId, seen);
  }
  for (const [ingredientId, seen] of recipesOf) entry(ingredientId).recipes = seen.size;

  const pantryRows = ctx.db
    .select({ ingredientId: pantryItems.ingredientId, count: sql<number>`count(*)` })
    .from(pantryItems)
    .where(eq(pantryItems.householdId, ctx.householdId))
    .groupBy(pantryItems.ingredientId)
    .all();
  for (const row of pantryRows) entry(row.ingredientId).pantry += row.count;

  const shoppingRows = ctx.db
    .select({ ingredientId: shoppingListItems.ingredientId, count: sql<number>`count(*)` })
    .from(shoppingListItems)
    .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingListItems.shoppingListId))
    .where(and(eq(shoppingListItems.householdId, ctx.householdId), ne(shoppingLists.status, "done")))
    .groupBy(shoppingListItems.ingredientId)
    .all();
  for (const row of shoppingRows) if (row.ingredientId !== null) entry(row.ingredientId).shopping += row.count;

  const ruleRows = ctx.db
    .select({ ingredientId: dietaryRules.ingredientId, count: sql<number>`count(*)` })
    .from(dietaryRules)
    .where(and(eq(dietaryRules.householdId, ctx.householdId), eq(dietaryRules.scope, "ingredient")))
    .groupBy(dietaryRules.ingredientId)
    .all();
  for (const row of ruleRows) if (row.ingredientId !== null) entry(row.ingredientId).rules += row.count;

  return [...counts.values()];
}

// ---------------------------------------------------------------------------
// Title Case migration
// ---------------------------------------------------------------------------

/**
 * One-time cleanup, safe to run at every start: store every ingredient name (all households)
 * in Title Case, and let shopping items that carry the old name follow. Only the display `name`
 * changes. `normalized_name` is lowercase already, so a case-only change cannot collide with
 * another ingredient; a row whose normalized name would change is skipped. Returns how many
 * ingredients changed.
 */
export function titleCaseIngredientNames(db: Db): number {
  const rows = db
    .select({ id: ingredients.id, name: ingredients.name, normalizedName: ingredients.normalizedName })
    .from(ingredients)
    .all();
  const changes = rows.flatMap((row) => {
    const name = titleCaseName(row.name);
    return name !== row.name && normalizeName(name) === row.normalizedName ? [{ ...row, next: name }] : [];
  });
  if (changes.length === 0) return 0;

  db.transaction((tx) => {
    for (const change of changes) {
      tx.update(ingredients).set({ name: change.next }).where(eq(ingredients.id, change.id)).run();
      const items = tx
        .select({ id: shoppingListItems.id, name: shoppingListItems.name })
        .from(shoppingListItems)
        .where(eq(shoppingListItems.ingredientId, change.id))
        .all();
      const ids = items.filter((item) => normalizeName(item.name) === change.normalizedName).map((item) => item.id);
      if (ids.length > 0) {
        tx.update(shoppingListItems).set({ name: change.next }).where(inArray(shoppingListItems.id, ids)).run();
      }
    }
  });
  return changes.length;
}
