import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Ctx } from "../context.js";
import {
  cookEvents,
  ingredients,
  mealPlans,
  shoppingListItems,
  shoppingLists,
  stockMovements,
  type IngredientCategory,
  type ShoppingListStatus,
  type StorageLocation,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import {
  availabilityFor,
  categoryRank,
  computeDemand,
  normalizeUnitLoose,
  roundQty,
  type AvailabilityLine,
  type DemandLine,
  type DemandUse,
} from "./demand.js";
import { findIngredientByName } from "./ingredients.js";
import { applyMovement } from "./pantry.js";
import { convert } from "./units.js";

export type ShoppingListRow = typeof shoppingLists.$inferSelect;
/** A list as exposed to callers: the row without internals, plus the derived `stale` flag. */
export type ShoppingList = Omit<ShoppingListRow, "planFingerprint"> & {
  /**
   * True when the list is bound to a plan, not completed, and the plan's planned
   * cooks (set, recipes or servings) changed since the list was last generated.
   */
  stale: boolean;
};
export type ShoppingListItem = typeof shoppingListItems.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
type Ingredient = typeof ingredients.$inferSelect;

export interface ShoppingListGroup {
  category: IngredientCategory;
  items: ShoppingListItem[];
}

export interface ShoppingListCounts {
  total: number;
  checked: number;
  remaining: number;
  needsCheck: number;
}

export interface ShoppingListDetail {
  list: ShoppingList;
  /** Items after the `includeChecked` filter. */
  items: ShoppingListItem[];
  groups: ShoppingListGroup[];
  /** Counts always cover every item on the list. */
  counts: ShoppingListCounts;
}

/** Units that are bought as whole things; needs are rounded up to an integer. */
const COUNT_UNITS: Record<string, true> = {
  count: true,
  can: true,
  jar: true,
  bag: true,
  bunch: true,
  head: true,
  clove: true,
  sprig: true,
  stalk: true,
  package: true,
  bottle: true,
  box: true,
  slice: true,
  piece: true,
  dozen: true,
  fillet: true,
  stick: true,
  carton: true,
};

/** Round a shopping need up: whole units for countable items, 2 decimals otherwise. */
export function roundNeed(qty: number, unit: string | null): number {
  const clean = roundQty(qty);
  if (unit !== null && COUNT_UNITS[unit] === true) return Math.ceil(clean - 1e-9);
  return Math.ceil(clean * 100 - 1e-9) / 100;
}

/**
 * "Slow Cooker Chili 2 lb + Ground Beef & Broccoli 1 lb": one part per recipe
 * and unit, summing repeat cooks of the same recipe.
 */
export function purposeNoteFor(uses: DemandUse[]): string | null {
  interface Part {
    recipeTitle: string;
    qty: number | null;
    unit: string | null;
  }
  const parts = new Map<string, Part>();
  for (const use of uses) {
    const key = `${use.recipeId}\u0000${use.unit ?? ""}`;
    const existing = parts.get(key);
    if (!existing) {
      parts.set(key, { recipeTitle: use.recipeTitle, qty: use.qty, unit: use.unit });
    } else if (use.qty !== null) {
      existing.qty = (existing.qty ?? 0) + use.qty;
    }
  }

  const rendered: string[] = [];
  for (const part of parts.values()) {
    if (part.qty === null) {
      rendered.push(part.recipeTitle);
      continue;
    }
    const qtyText = String(roundQty(part.qty, 2));
    const amount = part.unit === null ? qtyText : `${qtyText} ${part.unit}`;
    rendered.push(`${part.recipeTitle} ${amount}`);
  }
  return rendered.length === 0 ? null : rendered.join(" + ");
}

function compareItems(a: ShoppingListItem, b: ShoppingListItem): number {
  const byCategory = categoryRank(a.category) - categoryRank(b.category);
  if (byCategory !== 0) return byCategory;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

function txCtx(ctx: Ctx, tx: unknown): Ctx {
  return { db: tx as Ctx["db"], householdId: ctx.householdId, now: ctx.now };
}

/** An explicit ISO-8601 timestamp from the caller, else the current clock. */
function timestampOrNow(ctx: Ctx, value: string | undefined): string {
  if (value === undefined) return nowIso(ctx);
  if (Number.isNaN(Date.parse(value))) {
    throw new AppError("validation", `Expected an ISO-8601 timestamp, got "${value}"`, { value });
  }
  return value;
}

function loadPlan(ctx: Ctx, mealPlanId: string): typeof mealPlans.$inferSelect {
  const plan = ctx.db
    .select()
    .from(mealPlans)
    .where(and(eq(mealPlans.householdId, ctx.householdId), eq(mealPlans.id, mealPlanId)))
    .get();
  if (!plan) {
    throw new AppError("not_found", `Meal plan not found: ${mealPlanId}`, { mealPlanId });
  }
  return plan;
}

function defaultListTitle(plan: typeof mealPlans.$inferSelect): string {
  return `Shopping — week of ${plan.weekStart}`;
}

function loadList(ctx: Ctx, listId: string): ShoppingListRow {
  const list = ctx.db
    .select()
    .from(shoppingLists)
    .where(
      and(eq(shoppingLists.householdId, ctx.householdId), eq(shoppingLists.id, listId)),
    )
    .get();
  if (!list) {
    throw new AppError("not_found", `Shopping list not found: ${listId}`, { listId });
  }
  return list;
}

function loadItem(ctx: Ctx, listId: string, itemId: string): ShoppingListItem {
  const item = ctx.db
    .select()
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.householdId, ctx.householdId),
        eq(shoppingListItems.shoppingListId, listId),
        eq(shoppingListItems.id, itemId),
      ),
    )
    .get();
  if (!item) {
    throw new AppError("not_found", `Shopping item not found: ${itemId}`, { itemId });
  }
  return item;
}

function listItems(ctx: Ctx, listId: string): ShoppingListItem[] {
  return ctx.db
    .select()
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.householdId, ctx.householdId),
        eq(shoppingListItems.shoppingListId, listId),
      ),
    )
    .orderBy(asc(shoppingListItems.position), asc(shoppingListItems.name))
    .all();
}

function assertMutable(list: ShoppingListRow): void {
  if (list.status === "done") {
    throw new AppError("conflict", "Shopping list is already completed", { listId: list.id });
  }
}

/**
 * Hash of what shopping demand depends on: each cook of the plan that has not
 * been skipped (completed cooks stay in, so finishing a cook is not a change)
 * with its recipe and planned servings. Dates and slot layout don't change what
 * must be bought, so moving leftovers around never marks a list stale.
 */
function planFingerprint(ctx: Ctx, planId: string): string {
  const rows = ctx.db
    .select({
      id: cookEvents.id,
      recipeId: cookEvents.recipeId,
      plannedServings: cookEvents.plannedServings,
    })
    .from(cookEvents)
    .where(
      and(
        eq(cookEvents.householdId, ctx.householdId),
        eq(cookEvents.mealPlanId, planId),
        ne(cookEvents.status, "skipped"),
      ),
    )
    .orderBy(asc(cookEvents.id))
    .all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/** Row → exposed list; `fingerprints` caches plan fingerprints across one call. */
function toListView(
  ctx: Ctx,
  row: ShoppingListRow,
  fingerprints: Map<string, string> = new Map(),
): ShoppingList {
  const { planFingerprint: generatedFingerprint, ...rest } = row;
  let stale = false;
  if (row.mealPlanId !== null && row.status !== "done" && generatedFingerprint !== null) {
    let current = fingerprints.get(row.mealPlanId);
    if (current === undefined) {
      current = planFingerprint(ctx, row.mealPlanId);
      fingerprints.set(row.mealPlanId, current);
    }
    stale = current !== generatedFingerprint;
  }
  return { ...rest, stale };
}

/** True when any open list generated from this plan is out of date with it. */
export function planHasStaleShoppingList(ctx: Ctx, planId: string): boolean {
  const rows = ctx.db
    .select()
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.householdId, ctx.householdId),
        eq(shoppingLists.mealPlanId, planId),
        ne(shoppingLists.status, "done"),
      ),
    )
    .all();
  const cache = new Map<string, string>();
  return rows.some((row) => toListView(ctx, row, cache).stale);
}

function buildDetail(ctx: Ctx, listId: string, includeChecked: boolean): ShoppingListDetail {
  const list = toListView(ctx, loadList(ctx, listId));
  const all = listItems(ctx, listId);
  const items = includeChecked ? all : all.filter((item) => item.checkedAt === null);

  const groupsById = new Map<IngredientCategory, ShoppingListItem[]>();
  for (const item of items) {
    const bucket = groupsById.get(item.category);
    if (bucket) bucket.push(item);
    else groupsById.set(item.category, [item]);
  }
  const groups = [...groupsById.entries()]
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
    .map(([category, groupItems]) => ({ category, items: groupItems }));

  const checked = all.filter((item) => item.checkedAt !== null).length;
  const counts: ShoppingListCounts = {
    total: all.length,
    checked,
    remaining: all.length - checked,
    needsCheck: all.filter((item) => item.needsCheck).length,
  };

  return { list, items, groups, counts };
}

/** Renumber positions so items read in aisle → name order. */
function reorderItems(ctx: Ctx, listId: string): void {
  const sorted = [...listItems(ctx, listId)].sort(compareItems);
  sorted.forEach((item, index) => {
    if (item.position !== index) {
      ctx.db
        .update(shoppingListItems)
        .set({ position: index })
        .where(eq(shoppingListItems.id, item.id))
        .run();
    }
  });
}

export interface ListShoppingListsInput {
  status?: ShoppingListStatus;
  mealPlanId?: string;
}

/** Shopping lists, newest first. */
export function listShoppingLists(
  ctx: Ctx,
  input: ListShoppingListsInput = {},
): { items: ShoppingList[] } {
  const conditions: SQL[] = [eq(shoppingLists.householdId, ctx.householdId)];
  if (input.status !== undefined) conditions.push(eq(shoppingLists.status, input.status));
  if (input.mealPlanId !== undefined) {
    conditions.push(eq(shoppingLists.mealPlanId, input.mealPlanId));
  }

  const rows = ctx.db
    .select()
    .from(shoppingLists)
    .where(and(...conditions))
    .orderBy(desc(shoppingLists.createdAt), desc(sql`${shoppingLists}.rowid`))
    .all();
  const cache = new Map<string, string>();
  return { items: rows.map((row) => toListView(ctx, row, cache)) };
}

/** A list with its items grouped by aisle, plus checked/remaining counts. */
export function getShoppingList(
  ctx: Ctx,
  listId: string,
  options: { includeChecked?: boolean } = {},
): ShoppingListDetail {
  return buildDetail(ctx, listId, options.includeChecked ?? true);
}

export interface AddItemInput {
  /** Existing ingredient id (ing_…). */
  ingredientId?: string;
  /** Ingredient name to resolve; unknown names become free-text items. */
  ingredient?: string;
  /** Display name, or the free-text item name when nothing resolves. */
  name?: string;
  qty?: number | null;
  unit?: string | null;
  note?: string;
  purposeNote?: string;
  category?: IngredientCategory;
  needsCheck?: boolean;
}

interface ResolvedItemTarget {
  ingredientId: string | null;
  name: string;
  category: IngredientCategory;
  defaultUnit: string | null;
}

function resolveItemTarget(ctx: Ctx, input: AddItemInput): ResolvedItemTarget {
  const lookupName = (input.ingredient ?? input.name ?? "").trim();
  const displayName = (input.name ?? input.ingredient ?? "").trim();
  // A linked item displays the canonical ingredient name; `name` only overrides it explicitly.
  const explicitName = input.name?.trim() ?? "";

  if (input.ingredientId !== undefined) {
    const ingredient = ctx.db
      .select()
      .from(ingredients)
      .where(
        and(
          eq(ingredients.householdId, ctx.householdId),
          eq(ingredients.id, input.ingredientId),
        ),
      )
      .get();
    if (!ingredient) {
      throw new AppError("not_found", `Ingredient not found: ${input.ingredientId}`, {
        ingredientId: input.ingredientId,
      });
    }
    return {
      ingredientId: ingredient.id,
      name: explicitName === "" ? ingredient.name : explicitName,
      category: input.category ?? ingredient.category,
      defaultUnit: ingredient.defaultUnit,
    };
  }

  if (lookupName === "") {
    throw new AppError("validation", "Item name or ingredient is required");
  }

  const ingredient = findIngredientByName(ctx, lookupName);
  if (ingredient) {
    return {
      ingredientId: ingredient.id,
      name: explicitName === "" ? ingredient.name : explicitName,
      category: input.category ?? ingredient.category,
      defaultUnit: ingredient.defaultUnit,
    };
  }

  return {
    ingredientId: null,
    name: displayName,
    category: input.category ?? "other",
    defaultUnit: null,
  };
}

function nextPosition(items: ShoppingListItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.position + 1), 0);
}

function insertItem(
  ctx: Ctx,
  listId: string,
  input: AddItemInput,
  position: number,
  timestamp: string,
): ShoppingListItem {
  const target = resolveItemTarget(ctx, input);
  const qty = input.qty ?? null;
  const unit =
    input.unit !== undefined && input.unit !== null
      ? normalizeUnitLoose(input.unit)
      : qty === null
        ? null
        : normalizeUnitLoose(target.defaultUnit);

  return ctx.db
    .insert(shoppingListItems)
    .values({
      id: newId("sli"),
      householdId: ctx.householdId,
      shoppingListId: listId,
      ingredientId: target.ingredientId,
      name: target.name,
      category: target.category,
      qty,
      unit,
      purposeNote: input.purposeNote ?? null,
      needsCheck: input.needsCheck ?? false,
      source: "manual",
      note: input.note ?? null,
      position,
      createdAt: timestamp,
    })
    .returning()
    .get();
}

export interface CreateShoppingListInput {
  title?: string;
  notes?: string;
  mealPlanId?: string;
  items?: AddItemInput[];
}

/** Create a manual or plan-bound list (status draft). */
export function createShoppingList(
  ctx: Ctx,
  input: CreateShoppingListInput = {},
): ShoppingListDetail {
  return ctx.db.transaction((tx) => {
    const scoped = txCtx(ctx, tx);
    const plan = input.mealPlanId === undefined ? null : loadPlan(scoped, input.mealPlanId);
    const requestedTitle = input.title?.trim();
    const timestamp = nowIso(scoped);

    const list = scoped.db
      .insert(shoppingLists)
      .values({
        id: newId("sl"),
        householdId: ctx.householdId,
        mealPlanId: plan?.id ?? null,
        title:
          requestedTitle === undefined || requestedTitle === ""
            ? plan === null
              ? "Shopping list"
              : defaultListTitle(plan)
            : requestedTitle,
        status: "draft",
        notes: input.notes ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
      .get();

    if (input.items !== undefined && input.items.length > 0) {
      addItems(scoped, list.id, input.items);
    }
    return buildDetail(scoped, list.id, true);
  });
}

export interface UpdateShoppingListInput {
  title?: string;
  notes?: string | null;
  /** Only draft ⇄ shopping; completion goes through completeShoppingList. */
  status?: "draft" | "shopping";
}

export function updateShoppingList(
  ctx: Ctx,
  listId: string,
  input: UpdateShoppingListInput,
): ShoppingListDetail {
  const list = loadList(ctx, listId);
  assertMutable(list);

  const patch: Partial<typeof shoppingLists.$inferInsert> = { updatedAt: nowIso(ctx) };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title === "") throw new AppError("validation", "List title cannot be empty");
    patch.title = title;
  }
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.status !== undefined && input.status !== list.status) {
    const allowed =
      (list.status === "draft" && input.status === "shopping") ||
      (list.status === "shopping" && input.status === "draft");
    if (!allowed) {
      throw new AppError(
        "conflict",
        `Cannot change shopping list status from ${list.status} to ${input.status}`,
        { from: list.status, to: input.status },
      );
    }
    patch.status = input.status;
  }

  ctx.db.update(shoppingLists).set(patch).where(eq(shoppingLists.id, listId)).run();
  return getShoppingList(ctx, listId);
}

export function deleteShoppingList(ctx: Ctx, listId: string): { deleted: true; id: string } {
  loadList(ctx, listId);
  ctx.db.delete(shoppingListItems).where(eq(shoppingListItems.shoppingListId, listId)).run();
  ctx.db.delete(shoppingLists).where(eq(shoppingLists.id, listId)).run();
  return { deleted: true, id: listId };
}

/** Add manual items. Names resolve to ingredients when possible, otherwise stay free text. */
export function addItems(
  ctx: Ctx,
  listId: string,
  items: AddItemInput[],
): { items: ShoppingListItem[] } {
  if (items.length === 0) return { items: [] };
  const list = loadList(ctx, listId);
  assertMutable(list);

  const inserted = ctx.db.transaction((tx) => {
    const scoped = txCtx(ctx, tx);
    const timestamp = nowIso(scoped);
    let position = nextPosition(listItems(scoped, listId));
    const rows: ShoppingListItem[] = [];
    for (const input of items) {
      rows.push(insertItem(scoped, listId, input, position, timestamp));
      position += 1;
    }
    return rows;
  });

  return { items: inserted };
}

export interface UpdateItemInput {
  name?: string;
  category?: IngredientCategory;
  qty?: number | null;
  unit?: string | null;
  note?: string | null;
  purposeNote?: string | null;
  needsCheck?: boolean;
  actualQty?: number | null;
  actualUnit?: string | null;
  /** Ingredient name or id that replaced this item ("shallot" for "onion"). */
  substituteIngredient?: string | null;
}

function resolveIngredientRef(ctx: Ctx, ref: string): Ingredient {
  const trimmed = ref.trim();
  if (trimmed === "") throw new AppError("validation", "Ingredient reference is required");

  if (trimmed.startsWith("ing_")) {
    const byId = ctx.db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.householdId, ctx.householdId), eq(ingredients.id, trimmed)))
      .get();
    if (byId) return byId;
  }

  const byName = findIngredientByName(ctx, trimmed);
  if (byName) return byName;

  throw new AppError("unprocessable", `Unknown ingredient: ${trimmed}`, {
    unresolved: [trimmed],
  });
}

export function updateItem(
  ctx: Ctx,
  listId: string,
  itemId: string,
  input: UpdateItemInput,
): ShoppingListItem {
  const list = loadList(ctx, listId);
  assertMutable(list);
  loadItem(ctx, listId, itemId);

  const patch: Partial<typeof shoppingListItems.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name === "") throw new AppError("validation", "Item name cannot be empty");
    patch.name = name;
  }
  if (input.category !== undefined) patch.category = input.category;
  if (input.qty !== undefined) patch.qty = input.qty;
  if (input.unit !== undefined) patch.unit = normalizeUnitLoose(input.unit);
  if (input.note !== undefined) patch.note = input.note;
  if (input.purposeNote !== undefined) patch.purposeNote = input.purposeNote;
  if (input.needsCheck !== undefined) patch.needsCheck = input.needsCheck;
  if (input.actualQty !== undefined) patch.actualQty = input.actualQty;
  if (input.actualUnit !== undefined) patch.actualUnit = normalizeUnitLoose(input.actualUnit);
  if (input.substituteIngredient !== undefined) {
    patch.substituteIngredientId =
      input.substituteIngredient === null || input.substituteIngredient.trim() === ""
        ? null
        : resolveIngredientRef(ctx, input.substituteIngredient).id;
  }

  if (Object.keys(patch).length === 0) return loadItem(ctx, listId, itemId);

  return ctx.db
    .update(shoppingListItems)
    .set(patch)
    .where(eq(shoppingListItems.id, itemId))
    .returning()
    .get();
}

export function deleteItem(
  ctx: Ctx,
  listId: string,
  itemId: string,
): { deleted: true; id: string } {
  const list = loadList(ctx, listId);
  assertMutable(list);
  loadItem(ctx, listId, itemId);
  ctx.db.delete(shoppingListItems).where(eq(shoppingListItems.id, itemId)).run();
  return { deleted: true, id: itemId };
}

/**
 * Remove every item from an open list — generated or manual, checked or not.
 * The list itself survives with its plan binding and fingerprint untouched, so
 * the `stale` flag keeps telling the truth (a later regenerate repopulates it
 * from current demand either way). Nothing is written to stock.
 */
export function clearItems(ctx: Ctx, listId: string): ShoppingListDetail {
  const list = loadList(ctx, listId);
  assertMutable(list);

  ctx.db.transaction((tx) => {
    const scoped = txCtx(ctx, tx);
    scoped.db
      .delete(shoppingListItems)
      .where(
        and(
          eq(shoppingListItems.householdId, ctx.householdId),
          eq(shoppingListItems.shoppingListId, listId),
        ),
      )
      .run();
    scoped.db
      .update(shoppingLists)
      .set({ updatedAt: nowIso(scoped) })
      .where(eq(shoppingLists.id, listId))
      .run();
  });

  return getShoppingList(ctx, listId);
}

export interface CheckItemInput {
  itemId: string;
  checked: boolean;
  /** When the item was checked (ISO-8601; defaults to now). Ignored when unchecking. */
  checkedAt?: string;
  /** What was actually put in the cart (defaults to the planned qty when checked). */
  actualQty?: number | null;
  actualUnit?: string | null;
  substituteIngredient?: string | null;
}

export function checkItems(
  ctx: Ctx,
  listId: string,
  items: CheckItemInput[],
): { items: ShoppingListItem[] } {
  const list = loadList(ctx, listId);
  assertMutable(list);
  if (items.length === 0) return { items: [] };

  const updated = ctx.db.transaction((tx) => {
    const scoped = txCtx(ctx, tx);
    const timestamp = nowIso(scoped);
    const rows: ShoppingListItem[] = [];

    for (const change of items) {
      const item = loadItem(scoped, listId, change.itemId);
      const patch: Partial<typeof shoppingListItems.$inferInsert> = {};

      if (change.checked) {
        // Re-checking keeps the original moment unless the caller says otherwise.
        patch.checkedAt =
          change.checkedAt === undefined
            ? (item.checkedAt ?? timestamp)
            : timestampOrNow(scoped, change.checkedAt);

        const actualQty =
          change.actualQty !== undefined
            ? change.actualQty
            : (item.actualQty ?? item.qty);
        const actualUnit =
          change.actualUnit !== undefined
            ? normalizeUnitLoose(change.actualUnit)
            : (item.actualUnit ?? item.unit);
        patch.actualQty = actualQty;
        patch.actualUnit = actualUnit;
      } else {
        patch.checkedAt = null;
        if (change.actualQty !== undefined) patch.actualQty = change.actualQty;
        if (change.actualUnit !== undefined) {
          patch.actualUnit = normalizeUnitLoose(change.actualUnit);
        }
      }

      if (change.substituteIngredient !== undefined) {
        patch.substituteIngredientId =
          change.substituteIngredient === null ||
          change.substituteIngredient.trim() === ""
            ? null
            : resolveIngredientRef(scoped, change.substituteIngredient).id;
      }

      rows.push(
        scoped.db
          .update(shoppingListItems)
          .set(patch)
          .where(eq(shoppingListItems.id, item.id))
          .returning()
          .get(),
      );
    }
    return rows;
  });

  return { items: updated };
}

export interface ReceivedItemInput {
  itemId: string;
  /** Overrides the item's actual/planned quantity. */
  qty?: number | null;
  unit?: string | null;
  location?: StorageLocation;
}

export interface CompleteShoppingListInput {
  received?: ReceivedItemInput[];
  /** Default true: only checked items become stock. */
  onlyChecked?: boolean;
  /**
   * Default true: checked items write purchase movements. `false` marks the list
   * done without touching stock or item quantities — for lists whose purchases
   * the pantry already reflects (e.g. imported history).
   */
  recordPurchases?: boolean;
  /** Completion time (ISO-8601; defaults to now). */
  completedAt?: string;
}

export interface SkippedShoppingItem {
  itemId: string;
  name: string;
  reason: "free_text";
}

export interface CompleteShoppingListResult {
  list: ShoppingList;
  movements: StockMovement[];
  skipped: SkippedShoppingItem[];
  /** `applyMovement` warnings (e.g. incomparable units), prefixed with the item name. */
  warnings: string[];
}

/**
 * Convert a shopping trip into stock: checked items write `delta` purchase
 * movements (actual qty, received override, or planned qty). Unknown amounts
 * (null qty) mark the pantry item as present with an unknown quantity.
 *
 * `recordPurchases: false` completes the list without touching stock or item
 * quantities — for trips the pantry already reflects (e.g. imported history).
 */
export function completeShoppingList(
  ctx: Ctx,
  listId: string,
  input: CompleteShoppingListInput = {},
): CompleteShoppingListResult {
  return ctx.db.transaction((tx) => {
    const scoped = txCtx(ctx, tx);
    const list = loadList(scoped, listId);
    if (list.status === "done") {
      throw new AppError("conflict", "Shopping list is already completed", { listId });
    }

    const recordPurchases = input.recordPurchases ?? true;
    const onlyChecked = input.onlyChecked ?? true;
    const timestamp = timestampOrNow(scoped, input.completedAt);
    const movements: StockMovement[] = [];
    const skipped: SkippedShoppingItem[] = [];
    const warnings: string[] = [];

    if (recordPurchases) {
      const items = listItems(scoped, listId);
      const knownIds = new Set(items.map((item) => item.id));
      const receivedById = new Map<string, ReceivedItemInput>();
      for (const received of input.received ?? []) {
        if (!knownIds.has(received.itemId)) {
          throw new AppError("not_found", `Shopping item not found: ${received.itemId}`, {
            itemId: received.itemId,
          });
        }
        receivedById.set(received.itemId, received);
      }

      for (const item of items) {
        if (onlyChecked && item.checkedAt === null) continue;

        const targetIngredientId = item.substituteIngredientId ?? item.ingredientId;
        if (targetIngredientId === null) {
          skipped.push({ itemId: item.id, name: item.name, reason: "free_text" });
          continue;
        }

        const received = receivedById.get(item.id);
        const qty =
          received !== undefined && received.qty !== undefined
            ? received.qty
            : (item.actualQty ?? item.qty);
        const unit =
          received !== undefined && received.unit !== undefined
            ? normalizeUnitLoose(received.unit)
            : (item.actualUnit ?? item.unit);
        const location = received?.location;

        const movement =
          qty === null || qty === undefined
            ? applyMovement(scoped, {
                ingredientId: targetIngredientId,
                ...(location === undefined ? {} : { location }),
                kind: "set",
                qty: null,
                unit: unit ?? null,
                status: "on_hand",
                reason: "purchase",
                refType: "shopping_list",
                refId: listId,
              })
            : applyMovement(scoped, {
                ingredientId: targetIngredientId,
                ...(location === undefined ? {} : { location }),
                kind: "delta",
                qty,
                unit: unit ?? null,
                reason: "purchase",
                refType: "shopping_list",
                refId: listId,
              });
        movements.push(movement.movement);
        if (movement.warning !== undefined) {
          warnings.push(`${item.name}: ${movement.warning}`);
        }

        const patch: Partial<typeof shoppingListItems.$inferInsert> = {
          checkedAt: item.checkedAt ?? timestamp,
        };
        if (received !== undefined) {
          if (received.qty !== undefined) patch.actualQty = received.qty;
          if (received.unit !== undefined) {
            patch.actualUnit = normalizeUnitLoose(received.unit);
          }
        }
        scoped.db
          .update(shoppingListItems)
          .set(patch)
          .where(eq(shoppingListItems.id, item.id))
          .run();
      }
    }

    const updated = scoped.db
      .update(shoppingLists)
      .set({ status: "done", completedAt: timestamp, updatedAt: timestamp })
      .where(eq(shoppingLists.id, listId))
      .returning()
      .get();

    return { list: toListView(scoped, updated), movements, skipped, warnings };
  });
}

interface ShoppingCandidate {
  ingredientId: string;
  name: string;
  category: IngredientCategory;
  qty: number | null;
  unit: string | null;
  purposeNote: string | null;
  needsCheck: boolean;
}

function stapleCandidate(
  ctx: Ctx,
  ingredient: Ingredient,
  line: AvailabilityLine,
): ShoppingCandidate | null {
  const parQty = ingredient.parQty;
  const parUnit = normalizeUnitLoose(ingredient.parUnit);
  const baseUnit = parUnit ?? line.unit;

  if (parQty === null) {
    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      category: ingredient.category,
      qty: null,
      unit: baseUnit,
      purposeNote: "staple restock",
      needsCheck: false,
    };
  }

  if (line.onHand === null) {
    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      category: ingredient.category,
      qty: roundQty(parQty),
      unit: baseUnit,
      purposeNote: "staple restock",
      needsCheck: false,
    };
  }

  const onHandInPar = convert(ctx, line.onHand, line.unit, baseUnit, ingredient.id);
  if (onHandInPar === null) {
    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      category: ingredient.category,
      qty: roundQty(parQty),
      unit: baseUnit,
      purposeNote: "staple restock",
      needsCheck: true,
    };
  }

  const need = parQty - onHandInPar;
  if (need <= 0) return null;
  return {
    ingredientId: ingredient.id,
    name: ingredient.name,
    category: ingredient.category,
    qty: roundNeed(need, baseUnit),
    unit: baseUnit,
    purposeNote: "staple restock",
    needsCheck: false,
  };
}

function mergeNote(existing: string | null, addition: string | null): string | null {
  if (addition === null) return existing;
  if (existing === null || existing === "") return addition;
  if (existing.includes(addition)) return existing;
  return `${existing}; ${addition}`;
}

export interface GenerateShoppingListInput {
  mealPlanId: string;
  /** Regenerate into an existing draft/shopping list instead of creating one. */
  listId?: string;
  title?: string;
  /** Add low/out staples with a "staple restock" note (default true). */
  includeStaples?: boolean;
}

/**
 * Turn plan demand minus stock into a shopping list. Regeneration replaces only
 * generated, unchecked items; manual and already-checked items survive.
 */
export function generateShoppingList(
  ctx: Ctx,
  input: GenerateShoppingListInput,
): ShoppingListDetail {
  if (input.mealPlanId.trim() === "") {
    throw new AppError("validation", "mealPlanId is required");
  }
  const plan = loadPlan(ctx, input.mealPlanId);
  const includeStaples = input.includeStaples ?? true;

  const fingerprint = planFingerprint(ctx, plan.id);
  const demand = computeDemand(ctx, { mealPlanId: plan.id });
  const availability = availabilityFor(ctx, demand);
  const demandById = new Map<string, DemandLine>(demand.map((line) => [line.ingredientId, line] as const));

  const ingredientIds = availability.map((line) => line.ingredientId);
  const ingredientRows: Ingredient[] =
    ingredientIds.length === 0
      ? []
      : ctx.db
          .select()
          .from(ingredients)
          .where(
            and(
              eq(ingredients.householdId, ctx.householdId),
              inArray(ingredients.id, ingredientIds),
            ),
          )
          .all();
  const ingredientById = new Map(ingredientRows.map((row) => [row.id, row] as const));

  const candidates: ShoppingCandidate[] = [];
  const candidateIds = new Set<string>();

  for (const line of availability) {
    const ingredient = ingredientById.get(line.ingredientId);
    if (!ingredient) continue;

    const demandLine = demandById.get(line.ingredientId);
    if (demandLine === undefined) continue;

    const hasUnconvertible = demandLine.unconvertible.length > 0;
    const note = purposeNoteFor(demandLine.uses);

    if (line.onHand === null) {
      // Stock present but amount unknown → check the pantry, don't trust the number.
      if (line.committed === null && !hasUnconvertible) continue;
      candidates.push({
        ingredientId: ingredient.id,
        name: ingredient.name,
        category: ingredient.category,
        qty: line.committed === null ? null : roundNeed(line.committed, line.unit),
        unit: line.unit,
        purposeNote: mergeNote(note, "check the pantry (stock quantity unknown)"),
        needsCheck: true,
      });
      candidateIds.add(ingredient.id);
      continue;
    }

    if (line.committed === null) {
      // Only unmeasured ("to taste") or unconvertible demand.
      if (hasUnconvertible) {
        candidates.push({
          ingredientId: ingredient.id,
          name: ingredient.name,
          category: ingredient.category,
          qty: null,
          unit: line.unit,
          purposeNote: mergeNote(note, "units don't convert; check the pantry"),
          needsCheck: true,
        });
        candidateIds.add(ingredient.id);
      }
      continue;
    }

    if (hasUnconvertible) {
      candidates.push({
        ingredientId: ingredient.id,
        name: ingredient.name,
        category: ingredient.category,
        qty: roundNeed(line.committed, line.unit),
        unit: line.unit,
        purposeNote: mergeNote(note, "some units don't convert; check the pantry"),
        needsCheck: true,
      });
      candidateIds.add(ingredient.id);
      continue;
    }

    const need = line.committed - line.onHand;
    if (need > 0) {
      candidates.push({
        ingredientId: ingredient.id,
        name: ingredient.name,
        category: ingredient.category,
        qty: roundNeed(need, line.unit),
        unit: line.unit,
        purposeNote: note,
        needsCheck: false,
      });
      candidateIds.add(ingredient.id);
    }
  }

  if (includeStaples) {
    for (const line of availability) {
      if (candidateIds.has(line.ingredientId)) continue;
      if (line.onHandStatus !== "low" && line.onHandStatus !== "out") continue;
      const ingredient = ingredientById.get(line.ingredientId);
      if (!ingredient || !ingredient.isStaple) continue;
      const candidate = stapleCandidate(ctx, ingredient, line);
      if (candidate !== null) {
        candidates.push(candidate);
        candidateIds.add(ingredient.id);
      }
    }
  }

  return ctx.db.transaction((tx) => {
    const scoped = txCtx(ctx, tx);
    const timestamp = nowIso(scoped);

    let list = input.listId === undefined ? null : loadList(scoped, input.listId);
    if (list !== null) {
      assertMutable(list);
      scoped.db
        .update(shoppingLists)
        .set({
          mealPlanId: plan.id,
          planFingerprint: fingerprint,
          ...(input.title === undefined || input.title.trim() === ""
            ? {}
            : { title: input.title.trim() }),
          updatedAt: timestamp,
        })
        .where(eq(shoppingLists.id, list.id))
        .run();
      list = loadList(scoped, list.id);
    } else {
      const requestedTitle = input.title?.trim();
      list = scoped.db
        .insert(shoppingLists)
        .values({
          id: newId("sl"),
          householdId: ctx.householdId,
          mealPlanId: plan.id,
          planFingerprint: fingerprint,
          title:
            requestedTitle === undefined || requestedTitle === ""
              ? defaultListTitle(plan)
              : requestedTitle,
          status: "draft",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning()
        .get();
    }
    const listId = list.id;

    // Replace only what a previous generation added and nobody has bought yet.
    scoped.db
      .delete(shoppingListItems)
      .where(
        and(
          eq(shoppingListItems.householdId, ctx.householdId),
          eq(shoppingListItems.shoppingListId, listId),
          eq(shoppingListItems.source, "generated"),
          isNull(shoppingListItems.checkedAt),
        ),
      )
      .run();

    const existing = listItems(scoped, listId);
    const existingByIngredient = new Map<string, ShoppingListItem>();
    for (const item of existing) {
      if (item.ingredientId !== null) existingByIngredient.set(item.ingredientId, item);
    }

    let position = nextPosition(existing);
    for (const candidate of candidates) {
      const existingItem = existingByIngredient.get(candidate.ingredientId);
      if (existingItem !== undefined) {
        // Manual/checked item for the same ingredient: keep it, merge the why.
        const merged = mergeNote(existingItem.purposeNote, candidate.purposeNote);
        if (merged !== existingItem.purposeNote) {
          scoped.db
            .update(shoppingListItems)
            .set({ purposeNote: merged })
            .where(eq(shoppingListItems.id, existingItem.id))
            .run();
        }
        continue;
      }

      scoped.db
        .insert(shoppingListItems)
        .values({
          id: newId("sli"),
          householdId: ctx.householdId,
          shoppingListId: listId,
          ingredientId: candidate.ingredientId,
          name: candidate.name,
          category: candidate.category,
          qty: candidate.qty,
          unit: candidate.unit,
          purposeNote: candidate.purposeNote,
          needsCheck: candidate.needsCheck,
          source: "generated",
          position,
          createdAt: timestamp,
        })
        .run();
      position += 1;
    }

    reorderItems(scoped, listId);
    return buildDetail(scoped, listId, true);
  });
}
