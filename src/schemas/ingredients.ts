import { z } from "@hono/zod-openapi";
import {
  INGREDIENT_CATEGORIES,
  PANTRY_STATUSES,
  STORAGE_LOCATIONS,
} from "../db/schema.js";

export const ingredientCategorySchema = z
  .enum(INGREDIENT_CATEGORIES)
  .describe("Ingredient category used for grouping and shopping aisles.");

export const storageLocationSchema = z
  .enum(STORAGE_LOCATIONS)
  .describe("Where stock is kept: pantry, fridge, freezer, counter or other.");

export const pantryStatusSchema = z
  .enum(PANTRY_STATUSES)
  .describe("on_hand = stocked, low = at/below par, out = none left, unknown = present but unmeasured.");

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const ingredientAliasSchema = z
  .object({
    id: z.string().describe("Alias id (ali_...)."),
    alias: z.string().describe("Lowercased alternate name."),
    createdAt: z.string().describe("ISO timestamp."),
  })
  .openapi("IngredientAlias");

export const ingredientStockSchema = z
  .object({
    id: z.string().describe("Pantry item id (pi_...)."),
    location: storageLocationSchema,
    qty: z.number().nullable().describe("Known quantity; null = present but unknown."),
    unit: z.string().nullable().describe("Normalized unit."),
    qtyApprox: z.boolean().describe("True when the quantity is an estimate."),
    status: pantryStatusSchema,
  })
  .openapi("IngredientStock");

export const unitConversionSchema = z
  .object({
    id: z.string().describe("Conversion id (uc_...)."),
    ingredientId: z
      .string()
      .nullable()
      .describe("Owning ingredient; null = household-global conversion."),
    fromUnit: z.string().describe("Normalized source unit."),
    toUnit: z.string().describe("Normalized target unit."),
    factor: z.number().describe("1 fromUnit = factor toUnit."),
    note: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("UnitConversion");

export const ingredientSchema = z
  .object({
    id: z.string().describe("Ingredient id (ing_...)."),
    name: z.string().describe("Canonical display name."),
    normalizedName: z.string().describe("Lowercased uniqueness key."),
    description: z.string().nullable(),
    category: ingredientCategorySchema,
    defaultUnit: z.string().nullable().describe("Unit used for stock and shopping by default."),
    defaultLocation: storageLocationSchema,
    imageUrl: z.string().nullable(),
    shelfLifeDays: z.number().int().nullable().describe("Typical shelf life after purchase."),
    isStaple: z.boolean().describe("Always-stocked item (oil, salt, rice)."),
    parQty: z.number().nullable().describe("Desired minimum stock."),
    parUnit: z.string().nullable(),
    notes: z.string().nullable(),
    archivedAt: z.string().nullable().describe("Set when the ingredient was archived."),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Ingredient");

export const ingredientViewSchema = ingredientSchema
  .extend({
    aliases: z.array(ingredientAliasSchema),
    conversions: z.array(unitConversionSchema).describe("Custom conversions for this ingredient."),
    pantry: z.array(ingredientStockSchema).describe("Stock rows across locations."),
  })
  .openapi("IngredientView");

export const ingredientListSchema = z
  .object({ items: z.array(ingredientViewSchema) })
  .openapi("IngredientList");

export const mergeResultSchema = z
  .object({
    ingredient: ingredientViewSchema.describe("The surviving (target) ingredient."),
    moved: z.object({
      recipeIngredients: z.number().int(),
      pantryItems: z.number().int(),
      shoppingItems: z.number().int(),
      rules: z.number().int(),
      conversions: z.number().int(),
      aliases: z.number().int(),
    }),
  })
  .openapi("MergeIngredientsResult");

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const createIngredientSchema = z
  .object({
    name: z.string().min(1).describe('Canonical name, e.g. "Yellow onion".'),
    description: z.string().nullish(),
    category: ingredientCategorySchema.optional(),
    aliases: z
      .array(z.string().min(1))
      .optional()
      .describe('Alternate names ("onion", "yellow onions"); stored lowercase.'),
    defaultUnit: z
      .string()
      .nullish()
      .describe('Unit used for stock and shopping, e.g. "g" or "can".'),
    defaultLocation: storageLocationSchema.optional(),
    imageUrl: z.string().nullish(),
    shelfLifeDays: z.number().int().nonnegative().nullish(),
    isStaple: z.boolean().optional().describe("Always keep this stocked."),
    parQty: z.number().nonnegative().nullish().describe("Desired minimum stock."),
    parUnit: z.string().nullish().describe("Unit of parQty."),
    notes: z.string().nullish(),
  })
  .openapi("CreateIngredient");

export const updateIngredientSchema = z
  .object({
    name: z.string().min(1).optional().describe("Renaming updates what aliases resolve to."),
    description: z.string().nullish(),
    category: ingredientCategorySchema.optional(),
    defaultUnit: z.string().nullish(),
    defaultLocation: storageLocationSchema.optional(),
    imageUrl: z.string().nullish(),
    shelfLifeDays: z.number().int().nonnegative().nullish(),
    isStaple: z.boolean().optional(),
    parQty: z.number().nonnegative().nullish(),
    parUnit: z.string().nullish(),
    notes: z.string().nullish(),
  })
  .openapi("UpdateIngredient");

export const addAliasSchema = z
  .object({ alias: z.string().min(1).describe('Alternate name, e.g. "scallion".') })
  .openapi("AddIngredientAlias");

export const mergeIngredientSchema = z
  .object({
    intoId: z.string().min(1).describe("Target ingredient id that survives the merge."),
  })
  .openapi("MergeIngredient");

export const listIngredientsQuerySchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Case-insensitive substring matched against the name or any alias."),
  category: ingredientCategorySchema.optional(),
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .describe("Include archived ingredients (default false)."),
});

export const ingredientParamsSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ing_2f7k9m" }),
});

export const aliasParamsSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ing_2f7k9m" }),
  aliasId: z
    .string()
    .openapi({ param: { name: "aliasId", in: "path" }, example: "ali_7h2p4q" }),
});

// ---------------------------------------------------------------------------
// Unit conversions
// ---------------------------------------------------------------------------

export const createConversionSchema = z
  .object({
    ingredientId: z
      .string()
      .nullish()
      .describe("Owning ingredient; omit or null for a household-global conversion."),
    fromUnit: z.string().min(1).describe('Source unit, e.g. "can".'),
    toUnit: z.string().min(1).describe('Target unit, e.g. "oz".'),
    factor: z.number().positive().describe("1 fromUnit = factor toUnit."),
    note: z.string().nullish(),
  })
  .openapi("CreateUnitConversion");

export const conversionListSchema = z
  .object({ items: z.array(unitConversionSchema) })
  .openapi("UnitConversionList");

export const listConversionsQuerySchema = z.object({
  ingredientId: z.string().optional().describe("Restrict to one ingredient's conversions."),
  includeGlobal: z
    .enum(["true", "false"])
    .optional()
    .describe("With ingredientId, also include household-global rows."),
});

export const conversionParamsSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "uc_4m8n2p" }),
});

export const convertUnitSchema = z
  .object({
    qty: z.number().describe("Amount in `from` units."),
    from: z.string().min(1).describe('Source unit, e.g. "cup".'),
    to: z.string().min(1).describe('Target unit, e.g. "ml".'),
    ingredientId: z
      .string()
      .optional()
      .describe("Use this ingredient's custom conversions (e.g. can → oz)."),
  })
  .openapi("ConvertUnit");

export const convertUnitResultSchema = z
  .object({
    qty: z.number().nullable().describe("Converted amount; null when the units are incomparable."),
    fromUnit: z.string().nullable().describe("Normalized source unit."),
    toUnit: z.string().nullable().describe("Normalized target unit."),
    comparable: z.boolean().describe("False when no conversion path exists."),
  })
  .openapi("ConvertUnitResult");
