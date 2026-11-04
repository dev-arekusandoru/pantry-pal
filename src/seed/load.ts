import type { Ctx } from "../context.js";
import { AppError } from "../lib/errors.js";
import {
  parseSeed,
  type SeedData,
  type SeedPlan,
  type SeedRule,
  type SeedShoppingList,
} from "../schemas/seed.js";
import { createMember, listMembers, updateHousehold } from "../services/households.js";
import { createIngredient, listIngredients, normalizeName } from "../services/ingredients.js";
import { applyMovement, updatePantryItem } from "../services/pantry.js";
import { createPlan } from "../services/plans.js";
import { createRecipe, searchRecipes } from "../services/recipes.js";
import { createRule } from "../services/rules.js";
import {
  addItems,
  checkItems,
  completeShoppingList,
  createShoppingList,
  updateShoppingList,
} from "../services/shopping.js";
import { createConversion } from "../services/units.js";

/** Note written to the status event recorded while seeding a recipe. */
const SEED_NOTE = "Seeded from example.json";

export interface SeedResult {
  summary: Record<string, number>;
  warnings: string[];
}

export interface LoadSeedOptions {
  /** Load even though the household already has ingredients/recipes. */
  force?: boolean;
}

/**
 * Apply a seed file (see `seed/FORMAT.md`) through the service layer in one
 * transaction. Ingredients resolve by declared name, recipes by seed `key`,
 * cook events by their per-plan `key`; nothing is created implicitly.
 */
export function loadSeed(ctx: Ctx, data: unknown, options: LoadSeedOptions = {}): SeedResult {
  const seed = parseSeed(data);
  assertHouseholdIsEmpty(ctx, options.force === true);
  assertReferencesResolve(seed);

  return ctx.db.transaction((tx) => {
    const t: Ctx = { ...ctx, db: tx as unknown as Ctx["db"] };
    const summary: Record<string, number> = {};
    const warnings: string[] = [];
    const ingredientIds = new Map<string, string>();
    const recipeIds = new Map<string, string>();
    const planIds = new Map<string, string>();

    const ingredientIdOf = (name: string): string => {
      const id = ingredientIds.get(normalizeName(name));
      if (id === undefined) {
        throw new AppError("validation", `Seed references an undeclared ingredient: ${name}`, {
          unresolved: [name],
        });
      }
      return id;
    };
    const recipeIdOf = (key: string): string => {
      const id = recipeIds.get(key);
      if (id === undefined) {
        throw new AppError("validation", `Seed references an unknown recipe: ${key}`, {
          unresolved: [key],
        });
      }
      return id;
    };

    // 1. Household + members.
    const existingMembers = listMembers(t).items.length;
    updateHousehold(t, {
      name: seed.household.name,
      timezone: seed.household.timezone,
      settings: seed.household.settings,
    });
    if (existingMembers > 0) {
      warnings.push(
        `Household already had ${existingMembers} member(s); the seeded members were added alongside them.`,
      );
    }
    for (const member of seed.household.members) {
      createMember(t, { name: member.name, notes: member.notes });
    }
    summary.householdMembers = seed.household.members.length;

    // 2. Ingredients + aliases (aliases are inserted by the service).
    let aliasCount = 0;
    for (const input of seed.ingredients) {
      const created = createIngredient(t, {
        name: input.name,
        category: input.category,
        defaultUnit: input.defaultUnit,
        defaultLocation: input.defaultLocation,
        isStaple: input.isStaple,
        aliases: input.aliases,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.shelfLifeDays === undefined ? {} : { shelfLifeDays: input.shelfLifeDays }),
        ...(input.parQty === undefined ? {} : { parQty: input.parQty }),
        ...(input.parUnit === undefined ? {} : { parUnit: input.parUnit }),
      });
      ingredientIds.set(normalizeName(input.name), created.id);
      aliasCount += input.aliases.length;
    }
    summary.ingredients = seed.ingredients.length;
    summary.ingredientAliases = aliasCount;

    // 3. Unit conversions.
    for (const input of seed.unitConversions) {
      createConversion(t, {
        ingredientId: input.ingredient == null ? null : ingredientIdOf(input.ingredient),
        fromUnit: input.fromUnit,
        toUnit: input.toUnit,
        factor: input.factor,
        ...(input.note === undefined ? {} : { note: input.note }),
      });
    }
    summary.unitConversions = seed.unitConversions.length;

    // 4. Pantry snapshot: one `set`/`import` movement per row, no purchases.
    for (const row of seed.pantry) {
      const applied = applyMovement(t, {
        ingredientId: ingredientIdOf(row.ingredient),
        location: row.location,
        kind: "set",
        qty: row.qty,
        unit: row.unit,
        reason: "import",
        refType: "seed",
        refId: null,
        note: row.note ?? null,
        qtyApprox: row.qtyApprox,
        rawText: row.rawText,
        // An unknown amount is "present": the seed states the expected status
        // because the ledger alone cannot tell present-unknown from unknown.
        ...(row.qty === null ? { status: row.status } : {}),
      });
      if (applied.item.status !== row.status) {
        throw new AppError(
          "validation",
          `Pantry status mismatch for ${row.ingredient}: seed says ${row.status}, the ledger computed ${applied.item.status}`,
          { ingredient: row.ingredient, expected: row.status, actual: applied.item.status },
        );
      }
      // The ledger stores `note` on the movement; the item keeps its own copy.
      if (row.note != null) updatePantryItem(t, applied.item.id, { note: row.note });
    }
    summary.pantryItems = seed.pantry.length;
    summary.stockMovements = seed.pantry.length;

    // 5. Rules that do not need a recipe id (ingredient/category/tag/keyword).
    const createSeedRule = (rule: SeedRule): void => {
      const common = {
        scope: rule.scope,
        severity: rule.severity,
        conditionNote: rule.conditionNote ?? null,
        reason: rule.reason,
      };
      if (rule.scope === "ingredient") {
        createRule(t, { ...common, ingredientId: ingredientIdOf(rule.ingredient ?? "") });
      } else if (rule.scope === "recipe") {
        createRule(t, { ...common, recipeId: recipeIdOf(rule.recipe ?? "") });
      } else {
        createRule(t, { ...common, targetText: rule.targetText ?? "" });
      }
    };
    for (const rule of seed.rules) {
      if (rule.scope !== "recipe") createSeedRule(rule);
    }
    summary.dietaryRules = seed.rules.length;

    // 6. Recipes, then recipe-scoped rules (they need the recipe ids).
    let ingredientLines = 0;
    let steps = 0;
    for (const input of seed.recipes) {
      const created = createRecipe(t, {
        title: input.title,
        slug: input.key,
        description: input.description,
        sourceUrl: input.sourceUrl,
        sourceName: input.sourceName,
        author: input.author,
        imageUrl: input.imageUrl,
        servings: input.servings,
        yieldText: input.yieldText,
        prepMinutes: input.prepMinutes,
        cookMinutes: input.cookMinutes,
        totalMinutes: input.totalMinutes,
        spiceLevel: input.spiceLevel,
        cuisine: input.cuisine,
        mealTypes: input.mealTypes,
        tags: input.tags,
        equipment: input.equipment,
        nutrition: input.nutrition,
        storageNotes: input.storageNotes,
        leftoverDays: input.leftoverDays,
        notes: input.notes,
        status: input.status,
        rating: input.rating,
        statusNote: SEED_NOTE,
        ingredients: input.ingredients.map((line) => ({
          ingredientId: ingredientIdOf(line.ingredient),
          qty: line.qty,
          qtyMax: line.qtyMax ?? null,
          unit: line.unit,
          prepNote: line.prepNote,
          originalText: line.originalText,
          optional: line.optional ?? false,
          scalingExempt: line.scalingExempt ?? false,
          groupLabel: line.groupLabel ?? null,
        })),
        steps: input.steps.map((step) => ({
          text: step.text,
          groupLabel: step.groupLabel ?? null,
          durationMinutes: step.durationMinutes ?? null,
        })),
      });
      recipeIds.set(input.key, created.id);
      ingredientLines += input.ingredients.length;
      steps += input.steps.length;
    }
    for (const rule of seed.rules) {
      if (rule.scope === "recipe") createSeedRule(rule);
    }
    summary.recipes = seed.recipes.length;
    summary.recipeIngredients = ingredientLines;
    summary.recipeSteps = steps;

    // 7. Plans: cook events (keyed), slots, prep tasks.
    let cookEvents = 0;
    let slots = 0;
    let prepTasks = 0;
    for (const input of seed.plans) {
      const plan = createPlan(t, toCreatePlanInput(input, recipeIdOf, warnings));
      planIds.set(input.weekStart, plan.id);
      cookEvents += input.cookEvents.length;
      slots += input.slots.length;
      prepTasks += input.prepTasks.length;
    }
    summary.mealPlans = seed.plans.length;
    summary.cookEvents = cookEvents;
    summary.mealSlots = slots;
    summary.prepTasks = prepTasks;

    // 8. Historical shopping list: no purchase movements (the pantry snapshot
    // already includes these purchases).
    let listItems = 0;
    for (const input of seed.shoppingLists) {
      listItems += importShoppingList(t, input, planIds, ingredientIdOf);
    }
    summary.shoppingLists = seed.shoppingLists.length;
    summary.shoppingListItems = listItems;

    return { summary, warnings };
  });
}

function assertHouseholdIsEmpty(ctx: Ctx, force: boolean): void {
  if (force) return;
  const recipeCount = searchRecipes(ctx, { limit: 1 }).total;
  const ingredientCount = listIngredients(ctx, { includeArchived: true }).length;

  if (recipeCount > 0 || ingredientCount > 0) {
    throw new AppError(
      "conflict",
      `Household already has data (${ingredientCount} ingredient(s), ${recipeCount} recipe(s)); the seed is a one-time import`,
      { ingredients: ingredientCount, recipes: recipeCount, hint: "Pass { force: true } to load anyway." },
    );
  }
}

/** Every name/key used anywhere must be declared in the file itself. */
function assertReferencesResolve(seed: SeedData): void {
  const declaredIngredients = new Set(seed.ingredients.map((row) => normalizeName(row.name)));
  const declaredRecipes = new Set(seed.recipes.map((row) => row.key));
  const declaredWeeks = new Set(seed.plans.map((row) => row.weekStart));

  const unresolvedIngredients = new Set<string>();
  const unknownRecipes = new Set<string>();
  const unknownPlans = new Set<string>();
  const unknownCookEvents = new Set<string>();

  const checkIngredient = (name: string | undefined): void => {
    if (name !== undefined && !declaredIngredients.has(normalizeName(name))) {
      unresolvedIngredients.add(name);
    }
  };
  const checkRecipe = (key: string | undefined): void => {
    if (key !== undefined && !declaredRecipes.has(key)) unknownRecipes.add(key);
  };

  for (const row of seed.unitConversions) checkIngredient(row.ingredient ?? undefined);
  for (const row of seed.pantry) checkIngredient(row.ingredient);
  for (const rule of seed.rules) {
    checkIngredient(rule.ingredient);
    checkRecipe(rule.recipe);
  }
  for (const recipe of seed.recipes) {
    for (const line of recipe.ingredients) checkIngredient(line.ingredient);
  }

  for (const list of seed.shoppingLists) {
    for (const item of list.items) checkIngredient(item.ingredient);
    if (list.plan !== null && !declaredWeeks.has(list.plan)) unknownPlans.add(list.plan);
  }

  for (const plan of seed.plans) {
    const keys = new Set(plan.cookEvents.map((event) => event.key));
    for (const event of plan.cookEvents) checkRecipe(event.recipe);
    for (const slot of plan.slots) {
      if (slot.cookEvent !== undefined && !keys.has(slot.cookEvent)) {
        unknownCookEvents.add(`${plan.weekStart}/${slot.cookEvent}`);
      }
    }
    for (const task of plan.prepTasks) {
      if (task.cookEvent !== undefined && !keys.has(task.cookEvent)) {
        unknownCookEvents.add(`${plan.weekStart}/${task.cookEvent}`);
      }
    }
  }

  if (unresolvedIngredients.size > 0) {
    throw new AppError("validation", "Seed references undeclared ingredients", {
      unresolved: [...unresolvedIngredients],
    });
  }
  if (unknownRecipes.size > 0) {
    throw new AppError("validation", "Seed references unknown recipe keys", {
      unresolved: [...unknownRecipes],
    });
  }
  if (unknownPlans.size > 0) {
    throw new AppError("validation", "Seed references unknown plans", {
      unresolved: [...unknownPlans],
    });
  }
  if (unknownCookEvents.size > 0) {
    throw new AppError("validation", "Seed references unknown cook event keys", {
      unresolved: [...unknownCookEvents],
    });
  }
}

function toCreatePlanInput(
  plan: SeedPlan,
  recipeIdOf: (key: string) => string,
  warnings: string[],
): Parameters<typeof createPlan>[1] {
  const ignoredStatuses = plan.cookEvents.filter((event) => event.status !== "planned");
  if (ignoredStatuses.length > 0) {
    warnings.push(
      `Plan ${plan.weekStart}: cook events are created as "planned"; ignored seed status(es) ${ignoredStatuses
        .map((event) => `${event.key}=${event.status}`)
        .join(", ")}.`,
    );
  }

  return {
    weekStart: plan.weekStart,
    title: plan.title,
    status: plan.status,
    notes: plan.notes,
    cookEvents: plan.cookEvents.map((event) => ({
      key: event.key,
      recipeId: recipeIdOf(event.recipe),
      cookDate: event.cookDate,
      plannedServings: event.plannedServings,
      label: event.label ?? null,
    })),
    slots: plan.slots.map((slot) => ({
      date: slot.date,
      mealType: slot.mealType,
      kind: slot.kind,
      ...(slot.cookEvent === undefined ? {} : { cookEventKey: slot.cookEvent }),
      servings: slot.servings ?? null,
      label: slot.label ?? null,
      notes: slot.notes ?? null,
    })),
    prepTasks: plan.prepTasks.map((task) => ({
      dueDate: task.dueDate,
      description: task.description,
      ...(task.cookEvent === undefined ? {} : { cookEventKey: task.cookEvent }),
    })),
  };
}

/** Returns the number of items written. */
function importShoppingList(
  ctx: Ctx,
  list: SeedShoppingList,
  planIds: Map<string, string>,
  ingredientIdOf: (name: string) => string,
): number {
  const planId = list.plan === null ? undefined : planIds.get(list.plan);
  const created = createShoppingList(ctx, {
    title: list.title,
    notes: list.notes ?? undefined,
    ...(planId === undefined ? {} : { mealPlanId: planId }),
  });

  const listId = created.list.id;
  const added = addItems(
    ctx,
    listId,
    list.items.map((item) => ({
      ...(item.ingredient === undefined ? {} : { ingredientId: ingredientIdOf(item.ingredient) }),
      ...(item.name === undefined ? {} : { name: item.name }),
      category: item.category,
      qty: item.qty,
      unit: item.unit,
      purposeNote: item.purposeNote ?? undefined,
      note: item.note ?? undefined,
    })),
  ).items;

  const toCheck = added.filter((_, index) => list.items[index]?.checked === true);
  if (list.status === "done") {
    const completedAt = list.completedAt;
    if (completedAt === null) {
      throw new AppError("validation", "A done shopping list needs completedAt", {
        title: list.title,
      });
    }
    if (toCheck.length > 0) {
      checkItems(
        ctx,
        listId,
        toCheck.map((row) => ({ itemId: row.id, checked: true, checkedAt: completedAt })),
      );
    }
    // The pantry snapshot already includes the trip: complete without movements.
    completeShoppingList(ctx, listId, { recordPurchases: false, completedAt });
  } else {
    if (toCheck.length > 0) {
      checkItems(
        ctx,
        listId,
        toCheck.map((row) => ({ itemId: row.id, checked: true })),
      );
    }
    if (list.status === "shopping") {
      updateShoppingList(ctx, listId, { status: "shopping" });
    }
  }

  return list.items.length;
}
