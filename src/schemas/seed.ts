import { z } from "@hono/zod-openapi";
import {
  COOK_STATUSES,
  INGREDIENT_CATEGORIES,
  MEAL_TYPES,
  PANTRY_STATUSES,
  PLAN_STATUSES,
  RECIPE_STATUSES,
  RULE_SCOPES,
  RULE_SEVERITIES,
  SHOPPING_LIST_STATUSES,
  SLOT_KINDS,
  SPICE_LEVELS,
  STORAGE_LOCATIONS,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { isIsoDate } from "../lib/time.js";
import { normalizeName } from "../services/ingredients.js";
import { normalizeUnit } from "../services/units.js";
import { householdSettingsSchema } from "./household.js";
import { nutritionSchema } from "./recipes.js";

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

const text = z.string().trim().min(1);
const nullableText = z.string().nullable();

const seedDateSchema = text.refine(isIsoDate, { message: "Expected a valid YYYY-MM-DD date" });

const seedTimestampSchema = text.refine(
  (value) => !Number.isNaN(Date.parse(value)) && value.includes("T"),
  { message: "Expected an ISO-8601 timestamp" },
);

/** Units must be understood by `normalizeUnit()`; the loader aborts otherwise. */
const unitSchema = text.refine((value) => normalizeUnit(value) !== null, {
  message: "Unknown unit",
});
const nullableUnitSchema = unitSchema.nullable();

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const seedHouseholdSchema = z
  .object({
    name: text,
    timezone: text,
    settings: householdSettingsSchema,
    members: z.array(
      z.object({ name: text, notes: nullableText }).strict(),
    ),
  })
  .strict();

export const seedIngredientSchema = z
  .object({
    name: text,
    category: z.enum(INGREDIENT_CATEGORIES),
    defaultUnit: nullableUnitSchema,
    defaultLocation: z.enum(STORAGE_LOCATIONS),
    isStaple: z.boolean(),
    aliases: z.array(text),
    description: z.string().optional(),
    shelfLifeDays: z.number().int().nonnegative().optional(),
    parQty: z.number().finite().nonnegative().optional(),
    parUnit: unitSchema.optional(),
  })
  .strict();

export const seedUnitConversionSchema = z
  .object({
    ingredient: text.nullable().optional(),
    fromUnit: unitSchema,
    toUnit: unitSchema,
    factor: z.number().finite().positive(),
    note: nullableText.optional(),
  })
  .strict();

export const seedPantryRowSchema = z
  .object({
    ingredient: text,
    location: z.enum(STORAGE_LOCATIONS),
    qty: z.number().finite().nonnegative().nullable(),
    unit: nullableUnitSchema,
    qtyApprox: z.boolean(),
    status: z.enum(PANTRY_STATUSES),
    rawText: text,
    note: nullableText.optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    if ((row.qty === null) !== (row.unit === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message: "unit must be null exactly when qty is null",
      });
    }
  });

export const seedRuleSchema = z
  .object({
    scope: z.enum(RULE_SCOPES),
    ingredient: text.optional(),
    recipe: text.optional(),
    targetText: text.optional(),
    severity: z.enum(RULE_SEVERITIES),
    conditionNote: nullableText.optional(),
    reason: z.string().trim().min(1),
  })
  .strict()
  .superRefine((rule, ctx) => {
    const require = (field: "ingredient" | "recipe" | "targetText") => {
      if (rule[field] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for scope "${rule.scope}"`,
        });
      }
    };
    if (rule.scope === "ingredient") require("ingredient");
    else if (rule.scope === "recipe") require("recipe");
    else require("targetText");
  });

export const seedRecipeIngredientSchema = z
  .object({
    ingredient: text,
    qty: z.number().finite().nonnegative().nullable(),
    qtyMax: z.number().finite().nonnegative().optional(),
    unit: nullableUnitSchema,
    prepNote: nullableText,
    originalText: text,
    optional: z.boolean().optional(),
    scalingExempt: z.boolean().optional(),
    groupLabel: text.optional(),
  })
  .strict()
  .superRefine((line, ctx) => {
    if ((line.qty === null) !== (line.unit === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message: "unit must be null exactly when qty is null",
      });
    }
    if (line.qty !== null && line.qtyMax !== undefined && line.qtyMax < line.qty) {
      ctx.addIssue({
        code: "custom",
        path: ["qtyMax"],
        message: "qtyMax must be greater than or equal to qty",
      });
    }
  });

export const seedRecipeStepSchema = z
  .object({
    text,
    groupLabel: text.optional(),
    durationMinutes: z.number().int().nonnegative().optional(),
  })
  .strict();

export const seedRecipeSchema = z
  .object({
    key: text,
    title: text,
    description: nullableText,
    sourceUrl: nullableText,
    sourceName: nullableText,
    author: nullableText,
    imageUrl: nullableText,
    servings: z.number().finite().positive(),
    yieldText: nullableText,
    prepMinutes: z.number().int().nonnegative().nullable(),
    cookMinutes: z.number().int().nonnegative().nullable(),
    totalMinutes: z.number().int().nonnegative().nullable(),
    spiceLevel: z.enum(SPICE_LEVELS).nullable(),
    cuisine: nullableText,
    mealTypes: z.array(z.enum(MEAL_TYPES)).min(1),
    tags: z.array(text),
    equipment: z.array(text),
    nutrition: nutritionSchema.nullable(),
    storageNotes: nullableText,
    leftoverDays: z.number().int().nonnegative().nullable(),
    status: z.enum(RECIPE_STATUSES),
    rating: z.number().int().min(1).max(5).nullable(),
    notes: nullableText,
    ingredients: z.array(seedRecipeIngredientSchema),
    steps: z.array(seedRecipeStepSchema),
  })
  .strict();

export const seedCookEventSchema = z
  .object({
    key: text,
    recipe: text,
    cookDate: seedDateSchema,
    plannedServings: z.number().finite().positive(),
    label: nullableText.optional(),
    status: z.enum(COOK_STATUSES),
  })
  .strict();

export const seedSlotSchema = z
  .object({
    date: seedDateSchema,
    mealType: z.enum(MEAL_TYPES),
    kind: z.enum(SLOT_KINDS),
    cookEvent: text.optional(),
    servings: z.number().finite().positive().nullable().optional(),
    label: nullableText.optional(),
    notes: nullableText.optional(),
  })
  .strict()
  .superRefine((slot, ctx) => {
    if (slot.kind === "meal" && slot.cookEvent === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["cookEvent"],
        message: 'a "meal" slot requires a cookEvent key',
      });
    }
    if (slot.kind !== "meal" && slot.cookEvent !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["cookEvent"],
        message: `a "${slot.kind}" slot cannot reference a cook event`,
      });
    }
  });

export const seedPrepTaskSchema = z
  .object({
    dueDate: seedDateSchema,
    description: text,
    cookEvent: text.optional(),
  })
  .strict();

export const seedPlanSchema = z
  .object({
    weekStart: seedDateSchema,
    title: nullableText,
    status: z.enum(PLAN_STATUSES),
    notes: nullableText,
    cookEvents: z.array(seedCookEventSchema),
    slots: z.array(seedSlotSchema),
    prepTasks: z.array(seedPrepTaskSchema),
  })
  .strict();

export const seedShoppingItemSchema = z
  .object({
    ingredient: text.optional(),
    name: text.optional(),
    category: z.enum(INGREDIENT_CATEGORIES),
    qty: z.number().finite().nonnegative().nullable(),
    unit: nullableUnitSchema,
    purposeNote: nullableText.optional(),
    checked: z.boolean(),
    note: nullableText.optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.ingredient === undefined && item.name === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["ingredient"],
        message: "a shopping item needs an ingredient or a free-text name",
      });
    }
    if ((item.qty === null) !== (item.unit === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message: "unit must be null exactly when qty is null",
      });
    }
  });

export const seedShoppingListSchema = z
  .object({
    title: text,
    plan: seedDateSchema.nullable(),
    status: z.enum(SHOPPING_LIST_STATUSES),
    completedAt: seedTimestampSchema.nullable(),
    notes: nullableText,
    items: z.array(seedShoppingItemSchema),
  })
  .strict()
  .superRefine((list, ctx) => {
    if (list.status === "done" && list.completedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: 'a "done" shopping list needs completedAt',
      });
    }
  });

// ---------------------------------------------------------------------------
// Whole file
// ---------------------------------------------------------------------------

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    else seen.add(value);
  }
  return [...repeated];
}

export const seedSchema = z
  .object({
    household: seedHouseholdSchema,
    ingredients: z.array(seedIngredientSchema),
    unitConversions: z.array(seedUnitConversionSchema),
    pantry: z.array(seedPantryRowSchema),
    rules: z.array(seedRuleSchema),
    recipes: z.array(seedRecipeSchema),
    plans: z.array(seedPlanSchema),
    shoppingLists: z.array(seedShoppingListSchema),
  })
  .strict()
  .superRefine((seed, ctx) => {
    const addDuplicateIssues = (values: string[], path: (string | number)[], label: string) => {
      for (const duplicate of duplicates(values)) {
        ctx.addIssue({ code: "custom", path, message: `Duplicate ${label}: ${duplicate}` });
      }
    };

    const normalizedNames = seed.ingredients.map((ingredient) => normalizeName(ingredient.name));
    addDuplicateIssues(normalizedNames, ["ingredients"], "ingredient name");

    const declared = new Set(normalizedNames);
    const aliases = seed.ingredients.flatMap((ingredient) =>
      ingredient.aliases.map((alias) => normalizeName(alias)),
    );
    addDuplicateIssues(aliases, ["ingredients"], "ingredient alias");
    for (const alias of aliases) {
      if (declared.has(alias)) {
        ctx.addIssue({
          code: "custom",
          path: ["ingredients"],
          message: `Alias "${alias}" collides with an ingredient name`,
        });
      }
    }

    addDuplicateIssues(
      seed.unitConversions.map(
        (row) =>
          `${row.ingredient === null || row.ingredient === undefined ? "*" : normalizeName(row.ingredient)}|${row.fromUnit}|${row.toUnit}`,
      ),
      ["unitConversions"],
      "unit conversion",
    );

    addDuplicateIssues(
      seed.pantry.map((row) => `${normalizeName(row.ingredient)}|${row.location}`),
      ["pantry"],
      "pantry row",
    );

    addDuplicateIssues(
      seed.recipes.map((recipe) => recipe.key),
      ["recipes"],
      "recipe key",
    );

    addDuplicateIssues(
      seed.plans.map((plan) => plan.weekStart),
      ["plans"],
      "plan weekStart",
    );

    seed.plans.forEach((plan, index) => {
      addDuplicateIssues(
        plan.cookEvents.map((event) => event.key),
        ["plans", index, "cookEvents"],
        "cook event key",
      );
    });
  });

export type SeedData = z.infer<typeof seedSchema>;
export type SeedRule = z.infer<typeof seedRuleSchema>;
export type SeedPlan = z.infer<typeof seedPlanSchema>;
export type SeedShoppingList = z.infer<typeof seedShoppingListSchema>;

/** Validate a parsed seed file; throws `validation` with the Zod issues. */
export function parseSeed(data: unknown): SeedData {
  const result = seedSchema.safeParse(data);
  if (!result.success) {
    throw new AppError("validation", "Seed data failed validation", { issues: result.error.issues });
  }
  return result.data;
}
