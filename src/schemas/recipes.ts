import { z } from "@hono/zod-openapi";
import {
  INGREDIENT_CATEGORIES,
  MEAL_TYPES,
  RECIPE_STATUSES,
  SPICE_LEVELS,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ingredientCategorySchema = z
  .enum(INGREDIENT_CATEGORIES)
  .openapi("IngredientCategory", { description: "Ingredient category." });

export const mealTypeSchema = z
  .enum(MEAL_TYPES)
  .openapi("MealType", { description: "Meal a recipe suits." });

export const recipeStatusSchema = z
  .enum(RECIPE_STATUSES)
  .openapi("RecipeStatus", {
    description:
      'Recipe lifecycle status: "want_to_try", "rotation" (household favorites), "never" or "archived".',
  });

export const spiceLevelSchema = z
  .enum(SPICE_LEVELS)
  .openapi("SpiceLevel", { description: "Heat level, ordered none < mild < medium < hot." });

export const nutritionSchema = z
  .object({
    calories: z.number().nonnegative().optional().describe("Energy per serving (kcal)."),
    proteinG: z.number().nonnegative().optional().describe("Protein per serving (g)."),
    carbsG: z.number().nonnegative().optional().describe("Carbohydrates per serving (g)."),
    fatG: z.number().nonnegative().optional().describe("Fat per serving (g)."),
    fiberG: z.number().nonnegative().optional().describe("Fiber per serving (g)."),
    sugarG: z.number().nonnegative().optional().describe("Sugar per serving (g)."),
    sodiumMg: z.number().nonnegative().optional().describe("Sodium per serving (mg)."),
  })
  .openapi("NutritionInfo", { description: "Per-serving nutrition estimate." });

// ---------------------------------------------------------------------------
// Recipe ingredient / step inputs
// ---------------------------------------------------------------------------

export const recipeIngredientInputSchema = z
  .object({
    ingredientId: z
      .string()
      .min(1)
      .optional()
      .describe("Existing ingredient id. Provide this or `ingredient` (name)."),
    ingredient: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Ingredient name. Resolved against existing ingredients, aliases and simple plural variants; created when unknown.",
      ),
    category: ingredientCategorySchema
      .optional()
      .describe(
        "Category used when the named ingredient has to be created (defaults to other).",
      ),
    qty: z
      .number()
      .nonnegative()
      .nullable()
      .optional()
      .describe("Quantity written for the recipe servings. Null/omitted = unmeasured (to taste)."),
    qtyMax: z
      .number()
      .nonnegative()
      .nullable()
      .optional()
      .describe('Upper bound of a range ("1-2 heads" => qty 1, qtyMax 2).'),
    unit: z
      .string()
      .nullable()
      .optional()
      .describe('Unit as written ("Tbsp", "pounds"); normalized to a canonical unit.'),
    prepNote: z.string().nullable().optional().describe('Preparation note, e.g. "diced".'),
    originalText: z
      .string()
      .nullable()
      .optional()
      .describe('Original recipe line, e.g. "1 large yellow onion, diced".'),
    optional: z.boolean().optional().describe("Ingredient is optional."),
    scalingExempt: z
      .boolean()
      .optional()
      .describe("Do not scale this ingredient with servings (salt, spices to taste)."),
    groupLabel: z
      .string()
      .nullable()
      .optional()
      .describe('Section header, e.g. "Sauce" or "Marinade".'),
  })
  .openapi("RecipeIngredientInput");

export const recipeStepInputSchema = z
  .object({
    text: z.string().min(1).describe("Instruction text."),
    groupLabel: z
      .string()
      .nullable()
      .optional()
      .describe('Section header, e.g. "Sauce" or "Assembly".'),
    durationMinutes: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .describe("Timer hint for cooking mode."),
    imageUrl: z.string().nullable().optional().describe("Illustration for this step."),
  })
  .openapi("RecipeStepInput");

// ---------------------------------------------------------------------------
// Recipe inputs
// ---------------------------------------------------------------------------

const recipeScalarFields = {
  title: z.string().min(1).describe("Recipe title."),
  slug: z
    .string()
    .min(1)
    .describe("URL-safe identifier. Derived from the title when omitted; suffixed -2, -3 on collision."),
  description: z.string().nullable().describe("Short description / summary."),
  sourceUrl: z.string().nullable().describe("URL the recipe was imported from."),
  sourceName: z.string().nullable().describe('Source label, e.g. "NYT Cooking".'),
  author: z.string().nullable().describe("Recipe author."),
  imageUrl: z.string().nullable().describe("Hero image URL."),
  servings: z
    .number()
    .positive()
    .describe("Servings the ingredient quantities are written for."),
  yieldText: z.string().nullable().describe('Human yield, e.g. "6 bowls".'),
  prepMinutes: z.number().int().nonnegative().nullable().describe("Active preparation time."),
  cookMinutes: z.number().int().nonnegative().nullable().describe("Cooking time."),
  totalMinutes: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Total time; derived from prep + cook when omitted on create."),
  spiceLevel: spiceLevelSchema.nullable().describe("Heat level of the dish."),
  cuisine: z.string().nullable().describe('Cuisine label, e.g. "Thai".'),
  mealTypes: z.array(mealTypeSchema).describe("Meals this recipe suits."),
  tags: z.array(z.string()).describe('Free-form tags, e.g. ["spicy", "one-pot"].'),
  equipment: z.array(z.string()).describe('Equipment needed, e.g. ["cast iron skillet"].'),
  nutrition: nutritionSchema.nullable().describe("Per-serving nutrition estimate."),
  storageNotes: z.string().nullable().describe("Storage / reheat guidance for leftovers."),
  leftoverDays: z.number().int().nonnegative().nullable().describe("Days leftovers keep in the fridge."),
  status: recipeStatusSchema.describe("Lifecycle status."),
  rating: z.number().int().min(1).max(5).nullable().describe("Household rating 1-5."),
  notes: z.string().nullable().describe("Free-form household notes."),
} as const;

export const createRecipeSchema = z
  .object(recipeScalarFields)
  .partial()
  .extend({
    title: z.string().min(1).describe("Recipe title."),
    statusNote: z
      .string()
      .optional()
      .describe(
        "Why the recipe starts in this status; stored as the note of the initial status history event.",
      ),
    servings: z
      .number()
      .positive()
      .optional()
      .describe("Servings the quantities are written for (defaults to household defaultServings)."),
    ingredients: z
      .array(recipeIngredientInputSchema)
      .optional()
      .describe("Ingredient list; positions follow array order."),
    steps: z
      .array(recipeStepInputSchema)
      .optional()
      .describe("Instruction steps; positions follow array order."),
  })
  .openapi("CreateRecipeInput");

export const updateRecipeSchema = z
  .object({
    ...recipeScalarFields,
    statusNote: z
      .string()
      .optional()
      .describe(
        "Why the status or rating changed; stored as the note of the status-history event the patch writes.",
      ),
    ingredients: z
      .array(recipeIngredientInputSchema)
      .optional()
      .describe("Replaces the FULL ingredient list when present."),
    steps: z
      .array(recipeStepInputSchema)
      .optional()
      .describe("Replaces the FULL step list when present."),
  })
  .partial()
  .openapi("UpdateRecipeInput");

export const setRecipeStatusSchema = z
  .object({
    status: recipeStatusSchema,
    rating: z.number().int().min(1).max(5).nullable().optional().describe("Household rating 1-5."),
    note: z.string().nullable().optional().describe("Why the status changed (shown in history)."),
  })
  .openapi("SetRecipeStatusInput");

// ---------------------------------------------------------------------------
// Recipe views
// ---------------------------------------------------------------------------

export const recipeSchema = z
  .object({
    id: z.string(),
    householdId: z.string(),
    title: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    sourceName: z.string().nullable(),
    author: z.string().nullable(),
    imageUrl: z.string().nullable(),
    servings: z.number(),
    yieldText: z.string().nullable(),
    prepMinutes: z.number().nullable(),
    cookMinutes: z.number().nullable(),
    totalMinutes: z.number().nullable(),
    spiceLevel: spiceLevelSchema.nullable(),
    cuisine: z.string().nullable(),
    mealTypes: z.array(mealTypeSchema),
    tags: z.array(z.string()),
    equipment: z.array(z.string()),
    nutrition: nutritionSchema.nullable(),
    storageNotes: z.string().nullable(),
    leftoverDays: z.number().nullable(),
    status: recipeStatusSchema,
    rating: z.number().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Recipe");

export const recipeIngredientSchema = z
  .object({
    id: z.string(),
    householdId: z.string(),
    recipeId: z.string(),
    ingredientId: z.string(),
    ingredient: z
      .object({
        id: z.string(),
        name: z.string(),
        category: ingredientCategorySchema,
      })
      .describe("Referenced ingredient."),
    qty: z.number().nullable(),
    qtyMax: z.number().nullable(),
    unit: z.string().nullable(),
    prepNote: z.string().nullable(),
    originalText: z.string().nullable(),
    optional: z.boolean(),
    scalingExempt: z.boolean(),
    groupLabel: z.string().nullable(),
    position: z.number(),
  })
  .openapi("RecipeIngredient");

export const recipeStepSchema = z
  .object({
    id: z.string(),
    householdId: z.string(),
    recipeId: z.string(),
    position: z.number(),
    groupLabel: z.string().nullable(),
    text: z.string(),
    durationMinutes: z.number().nullable(),
    imageUrl: z.string().nullable(),
  })
  .openapi("RecipeStep");

export const recipeStatsSchema = z
  .object({
    timesCooked: z.number(),
    lastCookedAt: z.string().nullable(),
  })
  .openapi("RecipeStats");

export const recipeViewSchema = recipeSchema
  .extend({
    ingredients: z.array(recipeIngredientSchema).describe("Ordered by position."),
    steps: z.array(recipeStepSchema).describe("Ordered by position."),
    stats: recipeStatsSchema,
  })
  .openapi("RecipeView");

export const recipeSummarySchema = recipeSchema
  .extend({
    ingredientCount: z.number(),
    timesCooked: z.number(),
    lastCookedAt: z.string().nullable(),
  })
  .openapi("RecipeSummary");

export const recipeSearchResultSchema = z
  .object({
    items: z.array(recipeSummarySchema),
    total: z.number().describe("Total matches before limit/offset."),
    limit: z.number(),
    offset: z.number(),
  })
  .openapi("RecipeSearchResult");

export const recipeStatusEventSchema = z
  .object({
    id: z.string(),
    householdId: z.string(),
    recipeId: z.string(),
    status: recipeStatusSchema,
    rating: z.number().nullable(),
    note: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("RecipeStatusEvent");

export const recipeStatusHistorySchema = z
  .object({ items: z.array(recipeStatusEventSchema) })
  .openapi("RecipeStatusHistory");

export const setRecipeStatusResultSchema = z
  .object({
    recipe: recipeViewSchema,
    event: recipeStatusEventSchema,
  })
  .openapi("SetRecipeStatusResult");

export const deleteRecipeResultSchema = z
  .object({ deleted: z.boolean(), id: z.string() })
  .openapi("DeleteRecipeResult");

export const scaledIngredientSchema = z
  .object({
    recipeIngredientId: z.string(),
    ingredientId: z.string(),
    ingredientName: z.string(),
    category: ingredientCategorySchema,
    qty: z.number().nullable(),
    qtyMax: z.number().nullable(),
    unit: z.string().nullable(),
    optional: z.boolean(),
    scalingExempt: z.boolean(),
    prepNote: z.string().nullable(),
  })
  .openapi("ScaledIngredient");

export const scaledIngredientsResultSchema = z
  .object({ items: z.array(scaledIngredientSchema) })
  .openapi("ScaledIngredientsResult");

// ---------------------------------------------------------------------------
// Query / param schemas
// ---------------------------------------------------------------------------

export const searchRecipesQuerySchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Case-insensitive substring over title, description and tags."),
  status: recipeStatusSchema.optional(),
  tags: z.string().optional().describe("Comma-separated tags; a recipe must carry at least one."),
  mealType: mealTypeSchema.optional().describe("Only recipes suited to this meal."),
  ingredientId: z.string().optional().describe("Only recipes using this ingredient id."),
  maxTotalMinutes: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Maximum total time in minutes; recipes without time data are excluded."),
  limit: z.coerce.number().int().min(1).max(200).optional().describe("Page size (default 50, max 200)."),
  offset: z.coerce.number().int().min(0).optional().describe("Rows to skip."),
});

export const idOrSlugParamSchema = z.object({
  idOrSlug: z.string().min(1).describe("Recipe id or slug."),
});

export const scaleRecipeQuerySchema = z.object({
  servings: z.coerce.number().positive().describe("Target servings to scale to."),
});
