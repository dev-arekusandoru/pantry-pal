import { and, asc, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { Ctx } from "../context.js";
import {
  PLAN_STATUSES,
  cookEvents,
  mealPlans,
  mealSlots,
  prepTasks,
  recipes,
  type CookStatus,
  type HouseholdSettings,
  type MealType,
  type PlanStatus,
  type SlotKind,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import {
  addDays,
  daysBetween,
  isIsoDate,
  nowIso,
  todayIn,
  weekdayOf,
  weekStartFor,
} from "../lib/time.js";
import { getHousehold } from "./households.js";
import { getRecipe } from "./recipes.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type PlanRow = typeof mealPlans.$inferSelect;
export type CookEventRow = typeof cookEvents.$inferSelect;
export type SlotRow = typeof mealSlots.$inferSelect;
export type PrepTaskRow = typeof prepTasks.$inferSelect;

/** Recipe reference accepted by every plan input: id, or slug/title fallback. */
export interface RecipeRef {
  recipeId?: string;
  recipe?: string;
}

export interface CookEventSummary {
  id: string;
  recipeId: string;
  recipeTitle: string;
  cookDate: string;
  status: CookStatus;
}

/** One eating occasion as returned by {@link getPlan}. */
export interface SlotView {
  id: string;
  householdId: string;
  mealPlanId: string;
  date: string;
  mealType: MealType;
  kind: SlotKind;
  cookEventId: string | null;
  cookEvent: CookEventSummary | null;
  /** Servings eaten in this slot; null = not allocated yet. */
  servings: number | null;
  label: string | null;
  notes: string | null;
  position: number;
  /** True when the slot is dated after the cook that feeds it. */
  isLeftover: boolean;
}

/** A cook with its allocation summary. */
export interface CookEventView extends CookEventRow {
  recipeTitle: string;
  fedSlots: number;
  /** Sum of the servings of every slot fed by this cook. */
  servingsAllocated: number;
  /** (actualServings ?? plannedServings) - servingsAllocated. */
  servingsRemaining: number;
}

export interface PrepTaskView extends PrepTaskRow {
  done: boolean;
}

export type MealSlots = Record<MealType, SlotView[]>;

export interface PlanDay {
  date: string;
  meals: MealSlots;
}

export interface PlanView {
  id: string;
  householdId: string;
  weekStart: string;
  title: string | null;
  status: PlanStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  days: PlanDay[];
  cookEvents: CookEventView[];
  prepTasks: PrepTaskView[];
  warnings: string[];
}

export type PlanSummary = Pick<
  PlanRow,
  "id" | "householdId" | "weekStart" | "title" | "status" | "notes" | "createdAt" | "updatedAt"
>;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreatePlanCookEventInput extends RecipeRef {
  /** Local key referenced by slots and prep tasks in the same call. */
  key?: string;
  cookDate: string;
  /** Defaults from household settings and the first meal this cook feeds. */
  plannedServings?: number;
  label?: string | null;
  notes?: string | null;
}

export interface CreatePlanSlotInput {
  date: string;
  mealType: MealType;
  kind: SlotKind;
  cookEventId?: string;
  cookEventKey?: string;
  servings?: number | null;
  label?: string | null;
  notes?: string | null;
  position?: number;
}

export interface CreatePlanPrepTaskInput {
  dueDate: string;
  description: string;
  cookEventId?: string;
  cookEventKey?: string;
  position?: number;
}

export interface CreatePlanInput {
  weekStart: string;
  title?: string | null;
  status?: PlanStatus;
  notes?: string | null;
  cookEvents?: CreatePlanCookEventInput[];
  slots?: CreatePlanSlotInput[];
  prepTasks?: CreatePlanPrepTaskInput[];
}

export interface UpdatePlanInput {
  title?: string | null;
  status?: PlanStatus;
  notes?: string | null;
}

export interface ListPlansInput {
  status?: PlanStatus;
  /** Only plans whose week overlaps [from, to]. */
  from?: string;
  to?: string;
}

export interface AddSlotInput {
  date: string;
  mealType: MealType;
  kind: SlotKind;
  cookEventId?: string | null;
  servings?: number | null;
  label?: string | null;
  notes?: string | null;
  position?: number;
}

export interface UpdateSlotInput {
  date?: string;
  mealType?: MealType;
  kind?: SlotKind;
  cookEventId?: string | null;
  servings?: number | null;
  label?: string | null;
  notes?: string | null;
  position?: number;
}

/** Agent-facing slot replacement spec. */
export type SlotSpec =
  | {
      kind: "cook";
      recipeId?: string;
      recipe?: string;
      /** Servings eaten in this slot. */
      servings?: number;
      /** Servings the new cook yields (defaults to servings or the meal-type default). */
      cookServings?: number;
      label?: string | null;
    }
  | { kind: "leftover"; cookEventId: string; servings?: number }
  | { kind: "freeform"; label: string }
  | { kind: "skip"; label?: string | null }
  | { kind: "clear" };

export interface SetSlotsOp {
  date: string;
  mealType: MealType;
  spec: SlotSpec;
}

export interface SetSlotsResult {
  /** Slots currently present for the touched date/mealType groups. */
  slots: SlotView[];
  /** Planned cook events deleted because this operation left them without slots. */
  deletedCookEventIds: string[];
}

export interface AddCookEventInput extends RecipeRef {
  cookDate: string;
  plannedServings?: number;
  label?: string | null;
  notes?: string | null;
}

export interface UpdateCookEventInput extends RecipeRef {
  cookDate?: string;
  plannedServings?: number;
  actualServings?: number | null;
  label?: string | null;
  notes?: string | null;
  rating?: number | null;
}

export interface DeleteCookEventOptions {
  /** Unlink slots (turning them into freeform "unassigned") instead of rejecting. */
  force?: boolean;
}

export interface AddPrepTaskInput {
  dueDate: string;
  description: string;
  cookEventId?: string | null;
  position?: number;
}

export interface UpdatePrepTaskInput {
  dueDate?: string;
  description?: string;
  cookEventId?: string | null;
  position?: number;
}

export interface ListPrepTasksInput {
  planId?: string;
  from?: string;
  to?: string;
  /** Include completed tasks. Default false. */
  includeDone?: boolean;
}

export interface ListResult<T> {
  items: T[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface EventWithRecipe {
  event: CookEventRow;
  recipeTitle: string;
  leftoverDays: number | null;
}

interface EventStats {
  fedSlots: number;
  allocated: number;
}

const DAYS_PER_WEEK = 7;
/** Every meal bucket a day carries, in display order. */
function emptyMealSlots(): MealSlots {
  return { breakfast: [], lunch: [], dinner: [], snack: [], dessert: [] };
}

/** Context whose db is a transaction handle (better-sqlite3 transactions are sync). */
function withTx(ctx: Ctx, tx: unknown): Ctx {
  return { ...ctx, db: tx as Ctx["db"] };
}

function settingsOf(ctx: Ctx): HouseholdSettings {
  return getHousehold(ctx.db, ctx.householdId).settings;
}

function roundQty(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function assertIsoDate(value: string, field: string): void {
  if (!isIsoDate(value)) {
    throw new AppError("validation", `${field} must be a valid YYYY-MM-DD date`, {
      [field]: value,
    });
  }
}

function assertPositive(value: number | undefined | null, field: string): void {
  if (value === undefined || value === null) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError("validation", `${field} must be a positive number`, { [field]: value });
  }
}

function assertRating(value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new AppError("validation", "rating must be an integer between 1 and 5", { rating: value });
  }
}

function assertWithinWeek(date: string, weekStart: string): void {
  const end = addDays(weekStart, DAYS_PER_WEEK - 1);
  if (date < weekStart || date > end) {
    throw new AppError("validation", `Slot date ${date} is outside the plan week ${weekStart}..${end}`, {
      date,
      weekStart,
      weekEnd: end,
    });
  }
}

function defaultServingsForMeal(settings: HouseholdSettings, mealType: MealType | undefined): number {
  if (mealType === "lunch") return settings.lunchBatchServings;
  if (mealType === "dinner") return settings.dinnerServings;
  return settings.defaultServings;
}

interface ResolvedRecipe {
  id: string;
  title: string;
}

/** Resolve a recipe by id (via the recipes service) or slug/title. */
function resolveRecipeRef(ctx: Ctx, ref: RecipeRef): ResolvedRecipe {
  if (ref.recipeId !== undefined && ref.recipeId !== "") {
    const recipe = getRecipe(ctx, ref.recipeId);
    return { id: recipe.id, title: recipe.title };
  }
  const needle = ref.recipe?.trim();
  if (!needle) {
    throw new AppError("validation", "A recipe is required (recipeId or recipe)");
  }
  const row = ctx.db
    .select({ id: recipes.id, title: recipes.title })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, ctx.householdId),
        sql`(${recipes.slug} = ${needle} or lower(${recipes.title}) = lower(${needle}))`,
      ),
    )
    .orderBy(sql`case when ${recipes.slug} = ${needle} then 0 else 1 end`)
    .get();
  if (!row) {
    throw new AppError("not_found", `Recipe not found: ${needle}`, { recipe: needle });
  }
  return row;
}

function validateSlotShape(kind: SlotKind, cookEventId: string | null, label: string | null): void {
  if (kind === "meal" && !cookEventId) {
    throw new AppError("validation", "A meal slot requires a cook event", { kind });
  }
  if (kind !== "meal" && cookEventId) {
    throw new AppError("validation", `A ${kind} slot cannot reference a cook event`, { kind, cookEventId });
  }
  if (kind === "freeform" && !label?.trim()) {
    throw new AppError("validation", "A freeform slot requires a label", { kind });
  }
}

function assertCookEventUsable(ctx: Ctx, planId: string, cookEventId: string): CookEventRow {
  const row = ctx.db
    .select()
    .from(cookEvents)
    .where(and(eq(cookEvents.householdId, ctx.householdId), eq(cookEvents.id, cookEventId)))
    .get();
  if (!row) {
    throw new AppError("not_found", `Cook event not found: ${cookEventId}`, { id: cookEventId });
  }
  if (row.mealPlanId !== null && row.mealPlanId !== planId) {
    throw new AppError("validation", `Cook event ${cookEventId} belongs to another plan`, {
      id: cookEventId,
      mealPlanId: row.mealPlanId,
    });
  }
  return row;
}

function findPlanRow(ctx: Ctx, idOrWeekStart: string): PlanRow | null {
  const condition = isIsoDate(idOrWeekStart)
    ? eq(mealPlans.weekStart, idOrWeekStart)
    : eq(mealPlans.id, idOrWeekStart);
  return (
    ctx.db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.householdId, ctx.householdId), condition))
      .get() ?? null
  );
}

function requirePlanRow(ctx: Ctx, idOrWeekStart: string): PlanRow {
  const row = findPlanRow(ctx, idOrWeekStart);
  if (!row) {
    throw new AppError("not_found", `Plan not found: ${idOrWeekStart}`, { plan: idOrWeekStart });
  }
  return row;
}

function loadEventRows(ctx: Ctx, ids: string[]): EventWithRecipe[] {
  if (ids.length === 0) return [];
  return ctx.db
    .select({
      event: cookEvents,
      recipeTitle: recipes.title,
      leftoverDays: recipes.leftoverDays,
    })
    .from(cookEvents)
    .innerJoin(recipes, eq(recipes.id, cookEvents.recipeId))
    .where(and(eq(cookEvents.householdId, ctx.householdId), inArray(cookEvents.id, ids)))
    .orderBy(asc(cookEvents.cookDate), asc(cookEvents.createdAt))
    .all();
}

function loadPlanEventRows(ctx: Ctx, planId: string): EventWithRecipe[] {
  return ctx.db
    .select({
      event: cookEvents,
      recipeTitle: recipes.title,
      leftoverDays: recipes.leftoverDays,
    })
    .from(cookEvents)
    .innerJoin(recipes, eq(recipes.id, cookEvents.recipeId))
    .where(and(eq(cookEvents.householdId, ctx.householdId), eq(cookEvents.mealPlanId, planId)))
    .orderBy(asc(cookEvents.cookDate), asc(cookEvents.createdAt))
    .all();
}

function loadEventRow(ctx: Ctx, id: string): EventWithRecipe {
  const row = loadEventRows(ctx, [id])[0];
  if (!row) {
    throw new AppError("not_found", `Cook event not found: ${id}`, { id });
  }
  return row;
}

function summaryOf(row: EventWithRecipe): CookEventSummary {
  return {
    id: row.event.id,
    recipeId: row.event.recipeId,
    recipeTitle: row.recipeTitle,
    cookDate: row.event.cookDate,
    status: row.event.status,
  };
}

function toSlotView(row: SlotRow, event: EventWithRecipe | undefined): SlotView {
  const summary = event ? summaryOf(event) : null;
  return {
    id: row.id,
    householdId: row.householdId,
    mealPlanId: row.mealPlanId,
    date: row.date,
    mealType: row.mealType,
    kind: row.kind,
    cookEventId: row.cookEventId,
    cookEvent: summary,
    servings: row.servings,
    label: row.label,
    notes: row.notes,
    position: row.position,
    isLeftover: summary !== null && row.date > summary.cookDate,
  };
}

function toSlotViews(ctx: Ctx, rows: SlotRow[]): SlotView[] {
  const ids = [...new Set(rows.map((row) => row.cookEventId).filter((id): id is string => id !== null))];
  const events = new Map(loadEventRows(ctx, ids).map((row) => [row.event.id, row]));
  return rows.map((row) => toSlotView(row, row.cookEventId ? events.get(row.cookEventId) : undefined));
}

function toCookEventView(row: EventWithRecipe, stats: EventStats | undefined): CookEventView {
  const allocated = roundQty(stats?.allocated ?? 0);
  const yieldServings = row.event.actualServings ?? row.event.plannedServings;
  return {
    ...row.event,
    recipeTitle: row.recipeTitle,
    fedSlots: stats?.fedSlots ?? 0,
    servingsAllocated: allocated,
    servingsRemaining: roundQty(yieldServings - allocated),
  };
}

function eventStats(ctx: Ctx, eventId: string): EventStats | undefined {
  const row = ctx.db
    .select({
      fedSlots: sql<number>`count(*)`,
      allocated: sql<number | null>`sum(${mealSlots.servings})`,
    })
    .from(mealSlots)
    .where(and(eq(mealSlots.householdId, ctx.householdId), eq(mealSlots.cookEventId, eventId)))
    .get();
  if (!row || (row.fedSlots ?? 0) === 0) return undefined;
  return { fedSlots: row.fedSlots, allocated: row.allocated ?? 0 };
}

function toPrepTaskView(row: PrepTaskRow): PrepTaskView {
  return { ...row, done: row.doneAt !== null };
}

function nextSlotPosition(ctx: Ctx, planId: string, date: string, mealType: MealType): number {
  const row = ctx.db
    .select({ max: sql<number | null>`max(${mealSlots.position})` })
    .from(mealSlots)
    .where(
      and(
        eq(mealSlots.householdId, ctx.householdId),
        eq(mealSlots.mealPlanId, planId),
        eq(mealSlots.date, date),
        eq(mealSlots.mealType, mealType),
      ),
    )
    .get();
  return (row?.max ?? -1) + 1;
}

interface InsertSlotInput {
  date: string;
  mealType: MealType;
  kind: SlotKind;
  cookEventId?: string | null;
  servings?: number | null;
  label?: string | null;
  notes?: string | null;
  position?: number;
}

function insertSlotRow(
  ctx: Ctx,
  planId: string,
  weekStart: string,
  input: InsertSlotInput,
): string {
  assertIsoDate(input.date, "date");
  assertWithinWeek(input.date, weekStart);
  assertPositive(input.servings ?? undefined, "servings");
  const cookEventId = input.cookEventId ?? null;
  if (cookEventId !== null) assertCookEventUsable(ctx, planId, cookEventId);
  const label = input.label ?? null;
  validateSlotShape(input.kind, cookEventId, label);

  const id = newId("slot");
  ctx.db
    .insert(mealSlots)
    .values({
      id,
      householdId: ctx.householdId,
      mealPlanId: planId,
      date: input.date,
      mealType: input.mealType,
      kind: input.kind,
      cookEventId,
      servings: input.servings ?? null,
      label,
      notes: input.notes ?? null,
      position: input.position ?? nextSlotPosition(ctx, planId, input.date, input.mealType),
    })
    .run();
  return id;
}

function buildWarnings(
  slotRows: SlotRow[],
  events: Map<string, EventWithRecipe>,
  stats: Map<string, EventStats>,
): string[] {
  const warnings: string[] = [];

  for (const [eventId, stat] of stats) {
    const row = events.get(eventId);
    if (!row) continue;
    const yieldServings = row.event.actualServings ?? row.event.plannedServings;
    if (stat.allocated > yieldServings + 1e-9) {
      warnings.push(
        `Cook event ${eventId} (${row.event.cookDate}) feeds ${roundQty(stat.allocated)} servings but only yields ${roundQty(yieldServings)}.`,
      );
    }
  }

  for (const slot of slotRows) {
    if (slot.kind !== "meal") continue;
    const label = `Slot ${slot.id} (${slot.date} ${slot.mealType})`;
    if (!slot.cookEventId) {
      warnings.push(`${label} is a meal without a cook event.`);
      continue;
    }
    const row = events.get(slot.cookEventId);
    if (!row) {
      warnings.push(`${label} references a missing cook event ${slot.cookEventId}.`);
      continue;
    }
    if (row.event.status === "skipped") {
      warnings.push(`${label} references cook event ${row.event.id}, which is skipped.`);
    }
    if (slot.date < row.event.cookDate) {
      warnings.push(
        `${label} is dated before its cook event ${row.event.id} (${row.event.cookDate}).`,
      );
    } else if (
      slot.date > row.event.cookDate &&
      row.leftoverDays !== null &&
      daysBetween(row.event.cookDate, slot.date) > row.leftoverDays
    ) {
      warnings.push(
        `${label} eats leftovers from ${row.event.cookDate}, beyond the recipe's ${row.leftoverDays}-day leftover window.`,
      );
    }
  }

  return warnings;
}

function buildPlanView(ctx: Ctx, plan: PlanRow): PlanView {
  const slotRows = ctx.db
    .select()
    .from(mealSlots)
    .where(and(eq(mealSlots.householdId, ctx.householdId), eq(mealSlots.mealPlanId, plan.id)))
    .orderBy(asc(mealSlots.date), asc(mealSlots.position), asc(mealSlots.id))
    .all();

  const planEvents = loadPlanEventRows(ctx, plan.id);
  const planEventIds = new Set(planEvents.map((row) => row.event.id));
  const referencedIds = [
    ...new Set(
      slotRows
        .map((row) => row.cookEventId)
        .filter((id): id is string => id !== null && !planEventIds.has(id)),
    ),
  ];
  const allEvents = [...planEvents, ...loadEventRows(ctx, referencedIds)].sort((a, b) => {
    if (a.event.cookDate !== b.event.cookDate) return a.event.cookDate < b.event.cookDate ? -1 : 1;
    return a.event.createdAt < b.event.createdAt ? -1 : a.event.createdAt > b.event.createdAt ? 1 : 0;
  });
  const eventMap = new Map(allEvents.map((row) => [row.event.id, row]));

  const stats = new Map<string, EventStats>();
  for (const slot of slotRows) {
    if (!slot.cookEventId) continue;
    const current = stats.get(slot.cookEventId) ?? { fedSlots: 0, allocated: 0 };
    current.fedSlots += 1;
    current.allocated += slot.servings ?? 0;
    stats.set(slot.cookEventId, current);
  }

  const days: PlanDay[] = [];
  for (let i = 0; i < DAYS_PER_WEEK; i += 1) {
    const meals = emptyMealSlots();
    days.push({ date: addDays(plan.weekStart, i), meals });
  }
  const dayMap = new Map(days.map((day) => [day.date, day]));
  for (const slot of slotRows) {
    const day = dayMap.get(slot.date);
    if (!day) continue;
    day.meals[slot.mealType].push(toSlotView(slot, eventMap.get(slot.cookEventId ?? "")));
  }

  const prepRows = ctx.db
    .select()
    .from(prepTasks)
    .where(and(eq(prepTasks.householdId, ctx.householdId), eq(prepTasks.mealPlanId, plan.id)))
    .orderBy(asc(prepTasks.dueDate), asc(prepTasks.position), asc(prepTasks.id))
    .all();

  return {
    id: plan.id,
    householdId: plan.householdId,
    weekStart: plan.weekStart,
    title: plan.title,
    status: plan.status,
    notes: plan.notes,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    days,
    cookEvents: allEvents.map((row) => toCookEventView(row, stats.get(row.event.id))),
    prepTasks: prepRows.map(toPrepTaskView),
    warnings: buildWarnings(slotRows, eventMap, stats),
  };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * Create a week plan (one per weekStart) together with cook events, slots and prep
 * tasks in a single transaction. Cook events may be keyed so slots/prep tasks can
 * reference events created in the same call.
 */
export function createPlan(ctx: Ctx, input: CreatePlanInput): PlanView {
  assertIsoDate(input.weekStart, "weekStart");
  const settings = settingsOf(ctx);
  const expectedWeekday = ((Math.trunc(settings.weekStartsOn) % 7) + 7) % 7;
  if (weekdayOf(input.weekStart) !== expectedWeekday) {
    throw new AppError(
      "validation",
      `weekStart ${input.weekStart} does not align with the household week start (weekStartsOn=${expectedWeekday})`,
      { weekStart: input.weekStart, weekStartsOn: expectedWeekday },
    );
  }
  if (findPlanRow(ctx, input.weekStart)) {
    throw new AppError("conflict", `A plan already exists for week ${input.weekStart}`, {
      weekStart: input.weekStart,
    });
  }

  const cookEventsInput = input.cookEvents ?? [];
  const slotsInput = input.slots ?? [];
  const prepTasksInput = input.prepTasks ?? [];

  // Duplicate keys would make slot references ambiguous.
  const keys = new Set<string>();
  for (const event of cookEventsInput) {
    if (event.key === undefined) continue;
    if (keys.has(event.key)) {
      throw new AppError("validation", `Duplicate cook event key: ${event.key}`, { key: event.key });
    }
    keys.add(event.key);
  }
  for (const slot of slotsInput) {
    if (slot.cookEventKey !== undefined && !keys.has(slot.cookEventKey)) {
      throw new AppError("validation", `Unknown cook event key: ${slot.cookEventKey}`, {
        key: slot.cookEventKey,
      });
    }
  }
  for (const task of prepTasksInput) {
    if (task.cookEventKey !== undefined && !keys.has(task.cookEventKey)) {
      throw new AppError("validation", `Unknown cook event key: ${task.cookEventKey}`, {
        key: task.cookEventKey,
      });
    }
  }

  // First (earliest) meal a keyed cook feeds drives its default planned servings.
  const firstFed = new Map<string, { date: string; mealType: MealType }>();
  for (const slot of slotsInput) {
    if (slot.cookEventKey === undefined || slot.kind !== "meal") continue;
    const previous = firstFed.get(slot.cookEventKey);
    if (!previous || slot.date < previous.date) {
      firstFed.set(slot.cookEventKey, { date: slot.date, mealType: slot.mealType });
    }
  }

  const planId = ctx.db.transaction((tx) => {
    const t = withTx(ctx, tx);
    const timestamp = nowIso(t);
    const id = newId("plan");

    t.db
      .insert(mealPlans)
      .values({
        id,
        householdId: t.householdId,
        weekStart: input.weekStart,
        title: input.title ?? null,
        status: input.status ?? "draft",
        notes: input.notes ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    const keyMap = new Map<string, string>();
    for (const event of cookEventsInput) {
      assertIsoDate(event.cookDate, "cookDate");
      const recipe = resolveRecipeRef(t, event);
      const plannedServings =
        event.plannedServings ??
        defaultServingsForMeal(
          settings,
          event.key !== undefined ? firstFed.get(event.key)?.mealType : undefined,
        );
      assertPositive(plannedServings, "plannedServings");
      const eventId = newId("ce");
      t.db
        .insert(cookEvents)
        .values({
          id: eventId,
          householdId: t.householdId,
          mealPlanId: id,
          recipeId: recipe.id,
          cookDate: event.cookDate,
          plannedServings,
          label: event.label ?? null,
          status: "planned",
          notes: event.notes ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      if (event.key !== undefined) keyMap.set(event.key, eventId);
    }

    for (const slot of slotsInput) {
      const cookEventId =
        slot.cookEventKey !== undefined
          ? (keyMap.get(slot.cookEventKey) ?? null)
          : (slot.cookEventId ?? null);
      insertSlotRow(t, id, input.weekStart, {
        date: slot.date,
        mealType: slot.mealType,
        kind: slot.kind,
        cookEventId,
        servings: slot.servings ?? null,
        label: slot.label ?? null,
        notes: slot.notes ?? null,
        position: slot.position,
      });
    }

    for (const task of prepTasksInput) {
      addPrepTaskRow(t, id, {
        dueDate: task.dueDate,
        description: task.description,
        cookEventId:
          task.cookEventKey !== undefined
            ? (keyMap.get(task.cookEventKey) ?? null)
            : (task.cookEventId ?? null),
        position: task.position,
      });
    }

    return id;
  });

  return getPlan(ctx, planId);
}

/** Full plan grid for a plan id or weekStart date. */
export function getPlan(ctx: Ctx, idOrWeekStart: string): PlanView {
  return buildPlanView(ctx, requirePlanRow(ctx, idOrWeekStart));
}

/** Plan whose week contains "today" on the context clock; `not_found` when absent. */
export function getCurrentPlan(ctx: Ctx): PlanView {
  const settings = settingsOf(ctx);
  const weekStart = weekStartFor(todayIn(ctx), settings.weekStartsOn);
  const row = findPlanRow(ctx, weekStart);
  if (!row) {
    throw new AppError("not_found", `No plan for the current week (${weekStart})`, { weekStart });
  }
  return buildPlanView(ctx, row);
}

/** Plan summaries, newest week first. */
export function listPlans(ctx: Ctx, input: ListPlansInput = {}): ListResult<PlanSummary> {
  const conditions: SQL[] = [eq(mealPlans.householdId, ctx.householdId)];
  if (input.status !== undefined) conditions.push(eq(mealPlans.status, input.status));
  if (input.from !== undefined) {
    assertIsoDate(input.from, "from");
    conditions.push(sql`date(${mealPlans.weekStart}, '+6 days') >= ${input.from}`);
  }
  if (input.to !== undefined) {
    assertIsoDate(input.to, "to");
    conditions.push(sql`${mealPlans.weekStart} <= ${input.to}`);
  }

  const rows = ctx.db
    .select()
    .from(mealPlans)
    .where(and(...conditions))
    .orderBy(desc(mealPlans.weekStart))
    .all();

  return {
    items: rows.map((row) => ({
      id: row.id,
      householdId: row.householdId,
      weekStart: row.weekStart,
      title: row.title,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  };
}

/** Update plan metadata. `null` clears title/notes. */
export function updatePlan(ctx: Ctx, idOrWeekStart: string, input: UpdatePlanInput): PlanView {
  const plan = requirePlanRow(ctx, idOrWeekStart);
  if (input.status !== undefined) {
    if (!PLAN_STATUSES.includes(input.status)) {
      throw new AppError("validation", `Unknown plan status: ${input.status}`, {
        status: input.status,
      });
    }
  }
  ctx.db
    .update(mealPlans)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: nowIso(ctx),
    })
    .where(eq(mealPlans.id, plan.id))
    .run();
  return buildPlanView(ctx, requirePlanRow(ctx, plan.id));
}

/** Delete a plan; its cook events, slots and prep tasks cascade. */
export function deletePlan(ctx: Ctx, idOrWeekStart: string): { id: string } {
  const plan = requirePlanRow(ctx, idOrWeekStart);
  ctx.db.delete(mealPlans).where(eq(mealPlans.id, plan.id)).run();
  return { id: plan.id };
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** Low-level slot insert; returns the new slot view. */
export function addSlot(ctx: Ctx, planId: string, input: AddSlotInput): SlotView {
  const plan = requirePlanRow(ctx, planId);
  const id = insertSlotRow(ctx, plan.id, plan.weekStart, {
    date: input.date,
    mealType: input.mealType,
    kind: input.kind,
    cookEventId: input.cookEventId ?? null,
    servings: input.servings ?? null,
    label: input.label ?? null,
    notes: input.notes ?? null,
    position: input.position,
  });
  return slotView(ctx, id);
}

/** Low-level slot update. Changing away from `meal` clears the cook event. */
export function updateSlot(ctx: Ctx, slotId: string, input: UpdateSlotInput): SlotView {
  const row = requireSlotRow(ctx, slotId);
  const plan = requirePlanRow(ctx, row.mealPlanId);
  const kind = input.kind ?? row.kind;
  const next = {
    date: input.date ?? row.date,
    mealType: input.mealType ?? row.mealType,
    kind,
    cookEventId:
      input.cookEventId !== undefined ? input.cookEventId : kind === "meal" ? row.cookEventId : null,
    servings: input.servings !== undefined ? input.servings : row.servings,
    label: input.label !== undefined ? input.label : row.label,
    notes: input.notes !== undefined ? input.notes : row.notes,
    position: input.position ?? row.position,
  };

  assertIsoDate(next.date, "date");
  assertWithinWeek(next.date, plan.weekStart);
  assertPositive(next.servings ?? undefined, "servings");
  if (next.cookEventId !== null) assertCookEventUsable(ctx, plan.id, next.cookEventId);
  validateSlotShape(next.kind, next.cookEventId, next.label);

  ctx.db
    .update(mealSlots)
    .set({
      date: next.date,
      mealType: next.mealType,
      kind: next.kind,
      cookEventId: next.cookEventId,
      servings: next.servings ?? null,
      label: next.label,
      notes: next.notes,
      position: next.position,
    })
    .where(eq(mealSlots.id, row.id))
    .run();

  return slotView(ctx, row.id);
}

export function deleteSlot(ctx: Ctx, slotId: string): { id: string } {
  const row = requireSlotRow(ctx, slotId);
  ctx.db.delete(mealSlots).where(eq(mealSlots.id, row.id)).run();
  return { id: row.id };
}

function requireSlotRow(ctx: Ctx, slotId: string): SlotRow {
  const row = ctx.db
    .select()
    .from(mealSlots)
    .where(and(eq(mealSlots.householdId, ctx.householdId), eq(mealSlots.id, slotId)))
    .get();
  if (!row) throw new AppError("not_found", `Slot not found: ${slotId}`, { id: slotId });
  return row;
}

function slotView(ctx: Ctx, slotId: string): SlotView {
  const row = requireSlotRow(ctx, slotId);
  return toSlotView(row, row.cookEventId ? loadEventRow(ctx, row.cookEventId) : undefined);
}

/**
 * Replace the slots at each `(date, mealType)` with the agent-provided spec:
 * `cook` creates a cook event dated that day feeding the slot, `leftover` links an
 * existing cook event, `freeform`/`skip` need no cook, `clear` removes the slots.
 * Planned cook events this operation leaves without any slot are deleted.
 */
export function setSlots(ctx: Ctx, planId: string, ops: SetSlotsOp[]): SetSlotsResult {
  const plan = requirePlanRow(ctx, planId);
  if (ops.length === 0) {
    throw new AppError("validation", "At least one slot operation is required");
  }
  const settings = settingsOf(ctx);
  const touched = new Set(ops.map((op) => `${op.date}|${op.mealType}`));

  const deletedCookEventIds = ctx.db.transaction((tx) => {
    const t = withTx(ctx, tx);
    const timestamp = nowIso(t);
    const candidates = new Set<string>();

    for (const op of ops) {
      assertIsoDate(op.date, "date");
      assertWithinWeek(op.date, plan.weekStart);

      const existing = t.db
        .select()
        .from(mealSlots)
        .where(
          and(
            eq(mealSlots.householdId, t.householdId),
            eq(mealSlots.mealPlanId, plan.id),
            eq(mealSlots.date, op.date),
            eq(mealSlots.mealType, op.mealType),
          ),
        )
        .all();
      for (const row of existing) {
        if (row.cookEventId) candidates.add(row.cookEventId);
      }
      if (existing.length > 0) {
        t.db
          .delete(mealSlots)
          .where(
            and(
              eq(mealSlots.householdId, t.householdId),
              eq(mealSlots.mealPlanId, plan.id),
              eq(mealSlots.date, op.date),
              eq(mealSlots.mealType, op.mealType),
            ),
          )
          .run();
      }

      const spec = op.spec;
      switch (spec.kind) {
        case "clear":
          break;
        case "freeform":
          insertSlotRow(t, plan.id, plan.weekStart, {
            date: op.date,
            mealType: op.mealType,
            kind: "freeform",
            label: spec.label,
          });
          break;
        case "skip":
          insertSlotRow(t, plan.id, plan.weekStart, {
            date: op.date,
            mealType: op.mealType,
            kind: "skip",
            label: spec.label ?? null,
          });
          break;
        case "leftover": {
          assertPositive(spec.servings, "servings");
          assertCookEventUsable(t, plan.id, spec.cookEventId);
          insertSlotRow(t, plan.id, plan.weekStart, {
            date: op.date,
            mealType: op.mealType,
            kind: "meal",
            cookEventId: spec.cookEventId,
            servings: spec.servings ?? null,
          });
          break;
        }
        case "cook": {
          const recipe = resolveRecipeRef(t, spec);
          assertPositive(spec.servings, "servings");
          assertPositive(spec.cookServings, "cookServings");
          const plannedServings =
            spec.cookServings ??
            spec.servings ??
            defaultServingsForMeal(settings, op.mealType);
          assertPositive(plannedServings, "plannedServings");
          const eventId = newId("ce");
          t.db
            .insert(cookEvents)
            .values({
              id: eventId,
              householdId: t.householdId,
              mealPlanId: plan.id,
              recipeId: recipe.id,
              cookDate: op.date,
              plannedServings,
              label: spec.label ?? null,
              status: "planned",
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .run();
          insertSlotRow(t, plan.id, plan.weekStart, {
            date: op.date,
            mealType: op.mealType,
            kind: "meal",
            cookEventId: eventId,
            servings: spec.servings ?? null,
            position: 0,
          });
          break;
        }
        default: {
          const exhaustive: never = spec;
          throw new AppError("validation", `Unknown slot spec: ${JSON.stringify(exhaustive)}`);
        }
      }
    }

    const deleted: string[] = [];
    for (const eventId of candidates) {
      const remaining = t.db
        .select({ count: sql<number>`count(*)` })
        .from(mealSlots)
        .where(
          and(eq(mealSlots.householdId, t.householdId), eq(mealSlots.cookEventId, eventId)),
        )
        .get();
      if ((remaining?.count ?? 0) > 0) continue;
      const event = t.db
        .select()
        .from(cookEvents)
        .where(and(eq(cookEvents.householdId, t.householdId), eq(cookEvents.id, eventId)))
        .get();
      if (!event || event.status !== "planned" || event.mealPlanId !== plan.id) continue;
      t.db.delete(cookEvents).where(eq(cookEvents.id, eventId)).run();
      deleted.push(eventId);
    }

    return deleted;
  });

  const rows = ctx.db
    .select()
    .from(mealSlots)
    .where(and(eq(mealSlots.householdId, ctx.householdId), eq(mealSlots.mealPlanId, plan.id)))
    .orderBy(asc(mealSlots.date), asc(mealSlots.position), asc(mealSlots.id))
    .all()
    .filter((row) => touched.has(`${row.date}|${row.mealType}`));

  return { slots: toSlotViews(ctx, rows), deletedCookEventIds };
}

// ---------------------------------------------------------------------------
// Cook events
// ---------------------------------------------------------------------------

function toCookEventViewById(ctx: Ctx, eventId: string): CookEventView {
  return toCookEventView(loadEventRow(ctx, eventId), eventStats(ctx, eventId));
}

export function addCookEvent(
  ctx: Ctx,
  planId: string,
  input: AddCookEventInput,
): CookEventView {
  const plan = requirePlanRow(ctx, planId);
  assertIsoDate(input.cookDate, "cookDate");
  const recipe = resolveRecipeRef(ctx, input);
  const plannedServings = input.plannedServings ?? settingsOf(ctx).defaultServings;
  assertPositive(plannedServings, "plannedServings");

  const eventId = newId("ce");
  const timestamp = nowIso(ctx);
  ctx.db
    .insert(cookEvents)
    .values({
      id: eventId,
      householdId: ctx.householdId,
      mealPlanId: plan.id,
      recipeId: recipe.id,
      cookDate: input.cookDate,
      plannedServings,
      label: input.label ?? null,
      status: "planned",
      notes: input.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return toCookEventViewById(ctx, eventId);
}

/** Reschedule a cook, change its servings or swap its recipe. */
export function updateCookEvent(
  ctx: Ctx,
  cookEventId: string,
  input: UpdateCookEventInput,
): CookEventView {
  const event = requireCookEventRow(ctx, cookEventId);
  if (input.cookDate !== undefined) assertIsoDate(input.cookDate, "cookDate");
  assertPositive(input.plannedServings, "plannedServings");
  assertPositive(input.actualServings ?? undefined, "actualServings");
  assertRating(input.rating);

  const recipeChanged =
    (input.recipeId !== undefined && input.recipeId !== "") || input.recipe !== undefined;
  const recipe = recipeChanged ? resolveRecipeRef(ctx, input) : undefined;

  ctx.db
    .update(cookEvents)
    .set({
      ...(input.cookDate !== undefined ? { cookDate: input.cookDate } : {}),
      ...(input.plannedServings !== undefined ? { plannedServings: input.plannedServings } : {}),
      ...(input.actualServings !== undefined ? { actualServings: input.actualServings } : {}),
      ...(recipe !== undefined ? { recipeId: recipe.id } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.rating !== undefined ? { rating: input.rating } : {}),
      updatedAt: nowIso(ctx),
    })
    .where(eq(cookEvents.id, event.id))
    .run();

  return toCookEventViewById(ctx, event.id);
}

/**
 * Delete a cook event. Refuses with `conflict` when slots still reference it
 * unless `force`, in which case those slots become freeform "unassigned".
 */
export function deleteCookEvent(
  ctx: Ctx,
  cookEventId: string,
  options: DeleteCookEventOptions = {},
): { id: string; affectedSlotIds: string[] } {
  const event = requireCookEventRow(ctx, cookEventId);
  const slots = ctx.db
    .select({ id: mealSlots.id })
    .from(mealSlots)
    .where(and(eq(mealSlots.householdId, ctx.householdId), eq(mealSlots.cookEventId, event.id)))
    .all();

  if (slots.length > 0 && options.force !== true) {
    throw new AppError(
      "conflict",
      `Cook event ${event.id} still feeds ${slots.length} slot(s); pass force to unassign them`,
      { id: event.id, slotIds: slots.map((slot) => slot.id) },
    );
  }

  const affectedSlotIds = slots.map((slot) => slot.id);
  ctx.db.transaction((tx) => {
    const t = withTx(ctx, tx);
    if (affectedSlotIds.length > 0) {
      t.db
        .update(mealSlots)
        .set({ kind: "freeform", cookEventId: null, label: "unassigned" })
        .where(inArray(mealSlots.id, affectedSlotIds))
        .run();
    }
    t.db.delete(cookEvents).where(eq(cookEvents.id, event.id)).run();
  });

  return { id: event.id, affectedSlotIds };
}

export function getCookEvent(ctx: Ctx, cookEventId: string): CookEventView {
  requireCookEventRow(ctx, cookEventId);
  return toCookEventViewById(ctx, cookEventId);
}

function requireCookEventRow(ctx: Ctx, cookEventId: string): CookEventRow {
  const row = ctx.db
    .select()
    .from(cookEvents)
    .where(and(eq(cookEvents.householdId, ctx.householdId), eq(cookEvents.id, cookEventId)))
    .get();
  if (!row) {
    throw new AppError("not_found", `Cook event not found: ${cookEventId}`, { id: cookEventId });
  }
  return row;
}

// ---------------------------------------------------------------------------
// Prep tasks
// ---------------------------------------------------------------------------

function addPrepTaskRow(
  ctx: Ctx,
  planId: string,
  input: AddPrepTaskInput,
): PrepTaskRow {
  assertIsoDate(input.dueDate, "dueDate");
  const description = input.description.trim();
  if (description === "") {
    throw new AppError("validation", "Prep task description is required");
  }
  if (input.cookEventId !== undefined && input.cookEventId !== null) {
    assertCookEventUsable(ctx, planId, input.cookEventId);
  }
  const row: PrepTaskRow = {
    id: newId("prep"),
    householdId: ctx.householdId,
    mealPlanId: planId,
    dueDate: input.dueDate,
    description,
    cookEventId: input.cookEventId ?? null,
    doneAt: null,
    position: input.position ?? nextPrepPosition(ctx, planId, input.dueDate),
  };
  ctx.db.insert(prepTasks).values(row).run();
  return row;
}

function nextPrepPosition(ctx: Ctx, planId: string, dueDate: string): number {
  const row = ctx.db
    .select({ max: sql<number | null>`max(${prepTasks.position})` })
    .from(prepTasks)
    .where(
      and(
        eq(prepTasks.householdId, ctx.householdId),
        eq(prepTasks.mealPlanId, planId),
        eq(prepTasks.dueDate, dueDate),
      ),
    )
    .get();
  return (row?.max ?? -1) + 1;
}

export function addPrepTask(ctx: Ctx, planId: string, input: AddPrepTaskInput): PrepTaskView {
  const plan = requirePlanRow(ctx, planId);
  return toPrepTaskView(addPrepTaskRow(ctx, plan.id, input));
}

export function updatePrepTask(
  ctx: Ctx,
  prepTaskId: string,
  input: UpdatePrepTaskInput,
): PrepTaskView {
  const row = requirePrepTaskRow(ctx, prepTaskId);
  if (input.dueDate !== undefined) assertIsoDate(input.dueDate, "dueDate");
  if (input.description !== undefined && input.description.trim() === "") {
    throw new AppError("validation", "Prep task description is required");
  }
  if (input.cookEventId !== undefined && input.cookEventId !== null) {
    assertCookEventUsable(ctx, row.mealPlanId, input.cookEventId);
  }

  ctx.db
    .update(prepTasks)
    .set({
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.cookEventId !== undefined ? { cookEventId: input.cookEventId } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    })
    .where(eq(prepTasks.id, row.id))
    .run();

  return toPrepTaskView(requirePrepTaskRow(ctx, row.id));
}

export function completePrepTask(ctx: Ctx, prepTaskId: string): PrepTaskView {
  const row = requirePrepTaskRow(ctx, prepTaskId);
  if (row.doneAt === null) {
    ctx.db
      .update(prepTasks)
      .set({ doneAt: nowIso(ctx) })
      .where(eq(prepTasks.id, row.id))
      .run();
  }
  return toPrepTaskView(requirePrepTaskRow(ctx, row.id));
}

export function uncompletePrepTask(ctx: Ctx, prepTaskId: string): PrepTaskView {
  const row = requirePrepTaskRow(ctx, prepTaskId);
  if (row.doneAt !== null) {
    ctx.db.update(prepTasks).set({ doneAt: null }).where(eq(prepTasks.id, row.id)).run();
  }
  return toPrepTaskView(requirePrepTaskRow(ctx, row.id));
}

export function deletePrepTask(ctx: Ctx, prepTaskId: string): { id: string } {
  const row = requirePrepTaskRow(ctx, prepTaskId);
  ctx.db.delete(prepTasks).where(eq(prepTasks.id, row.id)).run();
  return { id: row.id };
}

export function listPrepTasks(
  ctx: Ctx,
  input: ListPrepTasksInput = {},
): ListResult<PrepTaskView> {
  const conditions: SQL[] = [eq(prepTasks.householdId, ctx.householdId)];
  if (input.planId !== undefined) conditions.push(eq(prepTasks.mealPlanId, input.planId));
  if (input.from !== undefined) {
    assertIsoDate(input.from, "from");
    conditions.push(gte(prepTasks.dueDate, input.from));
  }
  if (input.to !== undefined) {
    assertIsoDate(input.to, "to");
    conditions.push(sql`${prepTasks.dueDate} <= ${input.to}`);
  }
  if (input.includeDone !== true) {
    conditions.push(sql`${prepTasks.doneAt} is null`);
  }

  const rows = ctx.db
    .select()
    .from(prepTasks)
    .where(and(...conditions))
    .orderBy(asc(prepTasks.dueDate), asc(prepTasks.position), asc(prepTasks.id))
    .all();

  return { items: rows.map(toPrepTaskView) };
}

function requirePrepTaskRow(ctx: Ctx, prepTaskId: string): PrepTaskRow {
  const row = ctx.db
    .select()
    .from(prepTasks)
    .where(and(eq(prepTasks.householdId, ctx.householdId), eq(prepTasks.id, prepTaskId)))
    .get();
  if (!row) {
    throw new AppError("not_found", `Prep task not found: ${prepTaskId}`, { id: prepTaskId });
  }
  return row;
}
