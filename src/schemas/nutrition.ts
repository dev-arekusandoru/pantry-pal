import { z } from "@hono/zod-openapi";

export const nutrientsSchema = z
  .object({
    calories: z.number().nullable().describe("kcal."),
    protein: z.number().nullable().describe("Grams."),
    carbs: z.number().nullable().describe("Grams."),
    fat: z.number().nullable().describe("Grams."),
    fiber: z.number().nullable().describe("Grams."),
    sugar: z.number().nullable().describe("Grams."),
    sodium: z.number().nullable().describe("Milligrams."),
  })
  .openapi("Nutrients");

export const foodPortionSchema = z
  .object({
    label: z.string().describe('Portion label, e.g. "cup" or "medium".'),
    grams: z.number().describe("Grams in one such portion."),
    unit: z
      .string()
      .nullable()
      .describe('The app unit this portion measures ("cup", "tbsp", "large", "clove"...); null when the label names no unit.'),
    estimated: z.boolean().describe("True when the portion is borrowed from a similar USDA food, not measured on this one."),
  })
  .openapi("FoodPortion");

export const foodSchema = z
  .object({
    fdcId: z.number().int().describe("USDA FoodData Central id."),
    description: z.string().describe('USDA description, e.g. "Onions, raw".'),
    dataType: z.enum(["sr_legacy", "foundation"]),
    per100g: nutrientsSchema.describe("Nutrients per 100 g (sodium in mg)."),
    portions: z.array(foodPortionSchema),
    score: z.number().describe("Match score 0..1; higher is better."),
    suggestedName: z
      .string()
      .describe('Friendly ingredient name for this food, e.g. "Onion" for "Onions, raw". Pass it as `name` with `fdcId`.'),
  })
  .openapi("Food");

export const foodListSchema = z.object({ items: z.array(foodSchema) }).openapi("FoodList");

export const searchFoodsQuerySchema = z.object({
  q: z.string().min(1).describe("Food name to search for."),
  limit: z.coerce.number().int().min(1).max(50).optional().describe("Maximum results (default 10)."),
});

export const ingredientNutritionSchema = z
  .object({
    source: z.enum(["auto", "manual"]).describe("auto = matched by name, manual = user choice."),
    fdcId: z.number().int().nullable().describe("Matched USDA food; null = deliberately cleared."),
    description: z.string().nullable(),
    per100g: nutrientsSchema.nullable(),
    portions: z
      .array(foodPortionSchema)
      .describe("Portions of the linked food. `defaultPortion` is one of these labels."),
  })
  .nullable()
  .describe("USDA food matched to this ingredient; null = no match.")
  .openapi("IngredientNutrition");

export const setIngredientNutritionSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("auto").describe("Re-run the automatic name match.") }),
    z.object({
      mode: z.literal("manual"),
      fdcId: z
        .number()
        .int()
        .nullable()
        .describe("USDA food id to use; null clears the match and stops auto-matching."),
    }),
  ])
  .openapi("SetIngredientNutrition");

export const recipeNutritionLineSchema = z
  .object({
    recipeIngredientId: z.string(),
    ingredientId: z.string(),
    name: z.string(),
    qty: z.number().nullable(),
    qtyMax: z.number().nullable(),
    unit: z.string().nullable(),
    grams: z.number().nullable().describe("Grams used for this line (range midpoint)."),
    food: z
      .object({ fdcId: z.number().int(), description: z.string() })
      .nullable()
      .describe("Matched USDA food."),
    nutrients: nutrientsSchema.nullable().describe("Absolute amounts for this line."),
    status: z
      .enum(["ok", "optional", "no_match", "no_quantity", "no_conversion"])
      .describe(
        "ok = counted; optional = excluded; no_match = no USDA food; no_quantity = to taste; no_conversion = amount not convertible to grams.",
      ),
    hint: z
      .string()
      .optional()
      .describe('Present on no_conversion: what to add so the line counts, e.g. "Add a measure: 1 cup = ? g".'),
  })
  .openapi("RecipeNutritionLine");

export const recipeNutritionSchema = z
  .object({
    recipeId: z.string(),
    servings: z.number().nullable(),
    total: nutrientsSchema.describe("Whole-recipe sums of known values."),
    perServing: nutrientsSchema.nullable().describe("Total divided by servings."),
    countedLines: z.number().int().describe("Non-optional lines with status ok."),
    missingLines: z.number().int().describe("Non-optional lines that are not ok."),
    source: z.string().describe("Data source credit."),
    lines: z.array(recipeNutritionLineSchema),
  })
  .openapi("RecipeNutrition");
