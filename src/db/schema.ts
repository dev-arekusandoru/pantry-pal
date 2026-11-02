import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Conventions
 * - IDs: prefixed random strings (see src/lib/ids.ts), e.g. `rcp_8f3k2...`.
 * - Timestamps: ISO-8601 UTC strings (`createdAt`, `updatedAt`, `...At`).
 * - Calendar dates: `YYYY-MM-DD` strings (`...Date`, `...On`, `weekStart`).
 * - Quantities: `qty REAL NULL` + `unit TEXT NULL`; NULL qty = unknown amount.
 * - Every table carries `householdId` so every query is scoped with one predicate.
 */

const id = () => text("id").primaryKey();
const householdId = () =>
  text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" });
const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const updatedAt = () =>
  text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const bool = (name: string) => integer(name, { mode: "boolean" });
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

// ---------------------------------------------------------------------------
// Enumerations (kept as TS unions; validated by Zod at the edges)
// ---------------------------------------------------------------------------

export const INGREDIENT_CATEGORIES = [
  "produce",
  "protein",
  "dairy",
  "bakery",
  "pantry",
  "baking",
  "spice",
  "canned",
  "condiment",
  "frozen",
  "beverage",
  "other",
] as const;
export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export const STORAGE_LOCATIONS = ["pantry", "fridge", "freezer", "counter", "other"] as const;
export type StorageLocation = (typeof STORAGE_LOCATIONS)[number];

export const PANTRY_STATUSES = ["on_hand", "low", "out", "unknown"] as const;
export type PantryStatus = (typeof PANTRY_STATUSES)[number];

export const MOVEMENT_KINDS = ["set", "delta"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_REASONS = [
  "purchase",
  "cook",
  "waste",
  "adjust",
  "import",
  "verify",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export const MOVEMENT_REF_TYPES = ["cook_event", "shopping_list", "manual", "seed"] as const;
export type MovementRefType = (typeof MOVEMENT_REF_TYPES)[number];

export const RECIPE_STATUSES = ["want_to_try", "rotation", "never", "archived"] as const;
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "dessert"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const SPICE_LEVELS = ["none", "mild", "medium", "hot"] as const;
export type SpiceLevel = (typeof SPICE_LEVELS)[number];

export const RULE_SCOPES = ["ingredient", "category", "recipe", "tag", "keyword"] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

export const RULE_SEVERITIES = ["forbidden", "avoid", "limit"] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

export const PLAN_STATUSES = ["draft", "active", "archived"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const COOK_STATUSES = ["planned", "done", "skipped"] as const;
export type CookStatus = (typeof COOK_STATUSES)[number];

export const SLOT_KINDS = ["meal", "freeform", "skip"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export const SHOPPING_LIST_STATUSES = ["draft", "shopping", "done"] as const;
export type ShoppingListStatus = (typeof SHOPPING_LIST_STATUSES)[number];

export const SHOPPING_ITEM_SOURCES = ["generated", "manual"] as const;
export type ShoppingItemSource = (typeof SHOPPING_ITEM_SOURCES)[number];

export interface HouseholdSettings {
  /** Default servings when a recipe is planned without explicit servings. */
  defaultServings: number;
  /** Household-wide heat tolerance; recipes above it are flagged. */
  spiceLevel: SpiceLevel;
  /** Batch-cooked lunch size (e.g. 6 = 2 people x 3 days). */
  lunchBatchServings: number;
  /** Dinner cook size (e.g. 4 = cook once, eat twice). */
  dinnerServings: number;
  /** 1 = Monday (ISO). Plans are keyed by the first day of the week. */
  weekStartsOn: number;
  /** Preferred unit system for display. */
  unitSystem: "us" | "metric";
  /** Free-form planning guidance for agents ("cook once, leftovers next day"). */
  planningNotes: string | null;
}

export interface NutritionInfo {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
}

// ---------------------------------------------------------------------------
// Household & auth
// ---------------------------------------------------------------------------

export const households = sqliteTable("household", {
  id: id(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  settings: json<HouseholdSettings>("settings").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const householdMembers = sqliteTable(
  "household_member",
  {
    id: id(),
    householdId: householdId(),
    name: text("name").notNull(),
    /** Free-text dietary notes ("prefers ground beef only"). Structured bans live in dietary_rule. */
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("household_member_household_idx").on(t.householdId)],
);

export const apiTokens = sqliteTable(
  "api_token",
  {
    id: id(),
    householdId: householdId(),
    name: text("name").notNull(),
    /** First chars of the token for identification in listings (never the secret). */
    prefix: text("prefix").notNull(),
    /** SHA-256 hex of the full token. */
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [uniqueIndex("api_token_hash_uq").on(t.tokenHash)],
);

// ---------------------------------------------------------------------------
// Ingredients & units
// ---------------------------------------------------------------------------

export const ingredients = sqliteTable(
  "ingredient",
  {
    id: id(),
    householdId: householdId(),
    /** Canonical display name, e.g. "Yellow onion". Unique (case-insensitive) per household. */
    name: text("name").notNull(),
    /** Lowercased name used for uniqueness and matching. */
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    category: text("category").$type<IngredientCategory>().notNull().default("other"),
    /** Unit used for pantry stock and shopping when nothing else is specified. */
    defaultUnit: text("default_unit"),
    defaultLocation: text("default_location").$type<StorageLocation>().notNull().default("pantry"),
    imageUrl: text("image_url"),
    /** Typical shelf life once purchased, used to suggest expiry dates. */
    shelfLifeDays: integer("shelf_life_days"),
    /** Staples are expected to always be stocked (oil, salt, rice). */
    isStaple: bool("is_staple").notNull().default(false),
    /** Desired minimum stock; below it the item is "low". */
    parQty: real("par_qty"),
    parUnit: text("par_unit"),
    notes: text("notes"),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ingredient_name_uq").on(t.householdId, t.normalizedName)],
);

export const ingredientAliases = sqliteTable(
  "ingredient_alias",
  {
    id: id(),
    householdId: householdId(),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    /** Lowercased alias, e.g. "yellow onions", "onion". Unique per household. */
    alias: text("alias").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ingredient_alias_uq").on(t.householdId, t.alias),
    index("ingredient_alias_ingredient_idx").on(t.ingredientId),
  ],
);

export const unitConversions = sqliteTable(
  "unit_conversion",
  {
    id: id(),
    householdId: householdId(),
    /** NULL = applies to every ingredient (household-level custom unit). */
    ingredientId: text("ingredient_id").references(() => ingredients.id, { onDelete: "cascade" }),
    fromUnit: text("from_unit").notNull(),
    toUnit: text("to_unit").notNull(),
    /** 1 fromUnit = factor toUnit. */
    factor: real("factor").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("unit_conversion_uq").on(t.householdId, t.ingredientId, t.fromUnit, t.toUnit)],
);

// ---------------------------------------------------------------------------
// Pantry & ledger
// ---------------------------------------------------------------------------

export const pantryItems = sqliteTable(
  "pantry_item",
  {
    id: id(),
    householdId: householdId(),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    location: text("location").$type<StorageLocation>().notNull().default("pantry"),
    /** Cached projection of stock_movement. NULL = present but amount unknown. */
    qty: real("qty"),
    unit: text("unit"),
    /** True when qty is an estimate ("~2.5 lb"). */
    qtyApprox: bool("qty_approx").notNull().default(false),
    status: text("status").$type<PantryStatus>().notNull().default("unknown"),
    /** Original free-text description, e.g. "1 small jar (need 1/2 cup)". */
    rawText: text("raw_text"),
    note: text("note"),
    purchasedOn: text("purchased_on"),
    openedOn: text("opened_on"),
    expiresOn: text("expires_on"),
    lastVerifiedAt: text("last_verified_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pantry_item_uq").on(t.householdId, t.ingredientId, t.location)],
);

export const stockMovements = sqliteTable(
  "stock_movement",
  {
    id: id(),
    householdId: householdId(),
    pantryItemId: text("pantry_item_id")
      .notNull()
      .references(() => pantryItems.id, { onDelete: "cascade" }),
    /** `set` = absolute (qty may be NULL = unknown), `delta` = relative change. */
    kind: text("kind").$type<MovementKind>().notNull(),
    qty: real("qty"),
    unit: text("unit"),
    reason: text("reason").$type<MovementReason>().notNull(),
    refType: text("ref_type").$type<MovementRefType>(),
    refId: text("ref_id"),
    note: text("note"),
    /** Snapshot of pantry_item qty/status after this movement was applied. */
    qtyAfter: real("qty_after"),
    statusAfter: text("status_after").$type<PantryStatus>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_movement_item_idx").on(t.pantryItemId, t.createdAt),
    index("stock_movement_ref_idx").on(t.refType, t.refId),
  ],
);

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export const recipes = sqliteTable(
  "recipe",
  {
    id: id(),
    householdId: householdId(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    sourceUrl: text("source_url"),
    sourceName: text("source_name"),
    author: text("author"),
    imageUrl: text("image_url"),
    /** Servings the ingredient quantities are written for. */
    servings: real("servings").notNull(),
    /** Human yield text, e.g. "6 bowls" or "1 9x13 pan". */
    yieldText: text("yield_text"),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    totalMinutes: integer("total_minutes"),
    spiceLevel: text("spice_level").$type<SpiceLevel>(),
    cuisine: text("cuisine"),
    /** Meals this recipe suits (breakfast/lunch/dinner/...). */
    mealTypes: json<MealType[]>("meal_types").notNull().default(sql`'[]'`),
    tags: json<string[]>("tags").notNull().default(sql`'[]'`),
    equipment: json<string[]>("equipment").notNull().default(sql`'[]'`),
    nutrition: json<NutritionInfo>("nutrition"),
    /** Storage/reheat guidance for leftovers. */
    storageNotes: text("storage_notes"),
    /** How many days leftovers keep in the fridge. */
    leftoverDays: integer("leftover_days"),
    status: text("status").$type<RecipeStatus>().notNull().default("want_to_try"),
    /** 1..5 household rating. */
    rating: integer("rating"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("recipe_slug_uq").on(t.householdId, t.slug),
    index("recipe_status_idx").on(t.householdId, t.status),
  ],
);

export const recipeIngredients = sqliteTable(
  "recipe_ingredient",
  {
    id: id(),
    householdId: householdId(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    /** NULL qty = "to taste" / unmeasured. */
    qty: real("qty"),
    /** Upper bound for ranges ("1-2 heads"): qty=1, qtyMax=2. */
    qtyMax: real("qty_max"),
    unit: text("unit"),
    /** "large, diced", "drained". */
    prepNote: text("prep_note"),
    /** Original recipe line, e.g. "1 large yellow onion, diced". */
    originalText: text("original_text"),
    optional: bool("optional").notNull().default(false),
    /** Not scaled with servings (salt, spices "to taste"). */
    scalingExempt: bool("scaling_exempt").notNull().default(false),
    /** Section header, e.g. "Sauce", "Marinade". */
    groupLabel: text("group_label"),
    position: integer("position").notNull(),
  },
  (t) => [
    index("recipe_ingredient_recipe_idx").on(t.recipeId, t.position),
    index("recipe_ingredient_ingredient_idx").on(t.ingredientId),
  ],
);

export const recipeSteps = sqliteTable(
  "recipe_step",
  {
    id: id(),
    householdId: householdId(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    groupLabel: text("group_label"),
    text: text("text").notNull(),
    /** Timer hint for cooking mode. */
    durationMinutes: integer("duration_minutes"),
    imageUrl: text("image_url"),
  },
  (t) => [index("recipe_step_recipe_idx").on(t.recipeId, t.position)],
);

export const recipeStatusEvents = sqliteTable(
  "recipe_status_event",
  {
    id: id(),
    householdId: householdId(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    status: text("status").$type<RecipeStatus>().notNull(),
    rating: integer("rating"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("recipe_status_event_recipe_idx").on(t.recipeId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Dietary rules (never-use list)
// ---------------------------------------------------------------------------

export const dietaryRules = sqliteTable(
  "dietary_rule",
  {
    id: id(),
    householdId: householdId(),
    scope: text("scope").$type<RuleScope>().notNull(),
    /** scope=ingredient */
    ingredientId: text("ingredient_id").references(() => ingredients.id, { onDelete: "cascade" }),
    /** scope=recipe */
    recipeId: text("recipe_id").references(() => recipes.id, { onDelete: "cascade" }),
    /** scope=category: category name; scope=tag: tag; scope=keyword: case-insensitive substring. */
    targetText: text("target_text"),
    severity: text("severity").$type<RuleSeverity>().notNull(),
    /** Human condition/exception the agent must judge ("ok if minor role", "except tuna and salmon"). */
    conditionNote: text("condition_note"),
    /** Why the rule exists ("allergy", "dislike"). */
    reason: text("reason"),
    /** NULL = whole household. */
    memberId: text("member_id").references(() => householdMembers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("dietary_rule_household_idx").on(t.householdId)],
);

// ---------------------------------------------------------------------------
// Planning & cooking
// ---------------------------------------------------------------------------

export const mealPlans = sqliteTable(
  "meal_plan",
  {
    id: id(),
    householdId: householdId(),
    /** First day of the plan week (YYYY-MM-DD). */
    weekStart: text("week_start").notNull(),
    title: text("title"),
    status: text("status").$type<PlanStatus>().notNull().default("draft"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("meal_plan_week_uq").on(t.householdId, t.weekStart)],
);

export const cookEvents = sqliteTable(
  "cook_event",
  {
    id: id(),
    householdId: householdId(),
    /** NULL for ad-hoc cooks outside any plan. */
    mealPlanId: text("meal_plan_id").references(() => mealPlans.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "restrict" }),
    /** May fall outside the plan week (Sunday batch cook for a Monday-start week). */
    cookDate: text("cook_date").notNull(),
    plannedServings: real("planned_servings").notNull(),
    actualServings: real("actual_servings"),
    /** "Batch A", "Sunday prep". */
    label: text("label"),
    status: text("status").$type<CookStatus>().notNull().default("planned"),
    completedAt: text("completed_at"),
    /** Post-cook feedback. */
    rating: integer("rating"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("cook_event_plan_idx").on(t.mealPlanId),
    index("cook_event_date_idx").on(t.householdId, t.cookDate),
    index("cook_event_recipe_idx").on(t.recipeId),
  ],
);

export const mealSlots = sqliteTable(
  "meal_slot",
  {
    id: id(),
    householdId: householdId(),
    mealPlanId: text("meal_plan_id")
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    mealType: text("meal_type").$type<MealType>().notNull(),
    kind: text("kind").$type<SlotKind>().notNull(),
    /** kind=meal: the cook that feeds this slot. Slots dated after the cook are leftovers. */
    cookEventId: text("cook_event_id").references((): AnySQLiteColumn => cookEvents.id, {
      onDelete: "set null",
    }),
    /** Servings eaten in this slot. */
    servings: real("servings"),
    /** kind=freeform/skip display text ("Fridge clean-out"). */
    label: text("label"),
    notes: text("notes"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("meal_slot_plan_idx").on(t.mealPlanId, t.date, t.mealType),
    index("meal_slot_cook_idx").on(t.cookEventId),
  ],
);

export const prepTasks = sqliteTable(
  "prep_task",
  {
    id: id(),
    householdId: householdId(),
    mealPlanId: text("meal_plan_id")
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    dueDate: text("due_date").notNull(),
    description: text("description").notNull(),
    cookEventId: text("cook_event_id").references(() => cookEvents.id, { onDelete: "set null" }),
    doneAt: text("done_at"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("prep_task_plan_idx").on(t.mealPlanId, t.dueDate)],
);

// ---------------------------------------------------------------------------
// Shopping
// ---------------------------------------------------------------------------

export const shoppingLists = sqliteTable(
  "shopping_list",
  {
    id: id(),
    householdId: householdId(),
    mealPlanId: text("meal_plan_id").references(() => mealPlans.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status").$type<ShoppingListStatus>().notNull().default("draft"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: text("completed_at"),
  },
  (t) => [index("shopping_list_plan_idx").on(t.mealPlanId)],
);

export const shoppingListItems = sqliteTable(
  "shopping_list_item",
  {
    id: id(),
    householdId: householdId(),
    shoppingListId: text("shopping_list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    /** NULL for free-text items ("birthday candles"). */
    ingredientId: text("ingredient_id").references(() => ingredients.id, { onDelete: "set null" }),
    /** Display name; ingredient name for linked items. */
    name: text("name").notNull(),
    /** Aisle grouping; defaults to the ingredient category. */
    category: text("category").$type<IngredientCategory>().notNull().default("other"),
    qty: real("qty"),
    unit: text("unit"),
    /** Why it's on the list: "chili 2 lb + beef & broccoli 1 lb". Derived on generate. */
    purposeNote: text("purpose_note"),
    /** Stock is unknown or units can't be compared: check the pantry before buying. */
    needsCheck: bool("needs_check").notNull().default(false),
    source: text("source").$type<ShoppingItemSource>().notNull().default("manual"),
    note: text("note"),
    checkedAt: text("checked_at"),
    /** What was actually bought (defaults to qty/unit when checked). */
    actualQty: real("actual_qty"),
    actualUnit: text("actual_unit"),
    /** Bought something else instead. */
    substituteIngredientId: text("substitute_ingredient_id").references(() => ingredients.id, {
      onDelete: "set null",
    }),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("shopping_list_item_list_idx").on(t.shoppingListId, t.position)],
);
