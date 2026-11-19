import { z } from "@hono/zod-openapi";
import { INGREDIENT_CATEGORIES, PANTRY_STATUSES, RULE_SEVERITIES, SHOPPING_LIST_STATUSES } from "../db/schema.js";
import { ingredientNutritionSchema } from "./nutrition.js";

export const ingredientCategorySchema = z
  .enum(INGREDIENT_CATEGORIES)
  .describe("Ingredient category used for grouping and shopping aisles.");

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
    qty: z.number().nullable().describe("Known quantity; null = present but unknown."),
    unit: z.string().nullable().describe("Normalized unit."),
    qtyApprox: z.boolean().describe("True when the quantity is an estimate."),
    status: pantryStatusSchema,
  })
  .openapi("IngredientStock");

export const measureSchema = z
  .object({
    unit: z.string().describe('Normalized unit, e.g. "cup", "clove", "can", "handful".'),
    grams: z.number().describe("Weight of ONE unit in grams."),
    source: z
      .enum(["usda", "usda_estimated", "user"])
      .describe(
        "usda = a portion of the linked USDA food; usda_estimated = a portion borrowed from a similar USDA food; user = your own measure (it overrides the USDA one for the same unit).",
      ),
    estimated: z.boolean().describe("True when the weight is borrowed from a similar food (source usda_estimated)."),
    label: z.string().nullable().describe('The USDA portion label ("cup, chopped"); null for your own measures.'),
    note: z.string().nullable(),
    usdaGrams: z
      .number()
      .nullable()
      .describe("On a user measure that overrides a USDA one: the USDA weight, so a client can offer a reset."),
  })
  .openapi("Measure");

export const ingredientSchema = z
  .object({
    id: z.string().describe("Ingredient id (ing_...)."),
    name: z.string().describe("Canonical display name."),
    normalizedName: z.string().describe("Lowercased uniqueness key."),
    description: z.string().nullable(),
    category: ingredientCategorySchema,
    stockUnit: z
      .string()
      .nullable()
      .describe(
        "The one unit this ingredient is stocked in. Pantry amounts, par and shopping quantities are stored in it. Null until the first pantry write sets it.",
      ),
    imageUrl: z
      .string()
      .nullable()
      .describe(
        'Bundled ingredient icon name (e.g. "garlic", see list_icons) or http(s) image URL; null = automatic icon.',
      ),
    shelfLifeDays: z.number().int().nullable().describe("Typical shelf life after purchase."),
    parQty: z.number().nullable().describe("Desired minimum stock, in the stock unit."),
    notes: z.string().nullable(),
    defaultPortion: z
      .string()
      .nullable()
      .describe(
        'Portion of the linked USDA food that a plain count means, e.g. "large" for eggs ("2" eggs = 2 large). Null for custom ingredients.',
      ),
    needsReview: z
      .boolean()
      .describe("True for custom ingredients nobody has accepted yet, and unlinked legacy ingredients."),
    archivedAt: z.string().nullable().describe("Set when the ingredient was archived."),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Ingredient");

export const ingredientViewSchema = ingredientSchema
  .extend({
    nutrition: ingredientNutritionSchema,
    aliases: z.array(ingredientAliasSchema),
    measures: z
      .array(measureSchema)
      .describe("What one unit weighs: the linked USDA food's measures, overridden by your own."),
    units: z
      .array(z.string())
      .describe("Valid units for pickers: the stock unit first, then the measures, then the built-in units."),
    pantry: z.array(ingredientStockSchema).describe("Stock rows for this ingredient."),
  })
  .openapi("IngredientView");

export const ingredientListSchema = z
  .object({ items: z.array(ingredientViewSchema) })
  .openapi("IngredientList");

export const suggestionSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ingredient"),
      ingredientId: z.string().describe("Existing household ingredient."),
      name: z.string(),
      score: z.number().describe("Match score 0..1."),
    }),
    z.object({
      kind: z.literal("food"),
      fdcId: z.number().int().describe("USDA food: send it as `fdcId` to create a linked ingredient."),
      description: z.string().describe("USDA description."),
      suggestedName: z.string().describe("Friendly name to send as `name`."),
      score: z.number().describe("Match score 0..1."),
    }),
  ])
  .openapi("IngredientSuggestion");

export const unresolvedIngredientSchema = z
  .object({
    name: z.string().describe("The name that matched no ingredient."),
    suggestions: z.array(suggestionSchema).describe("Up to 5: existing ingredients first, then USDA foods."),
    hint: z
      .string()
      .optional()
      .describe('Present when the name breaks the naming rules, e.g. "contains \"or\"" plus what to do.'),
  })
  .openapi("UnresolvedIngredient");

/** `details` of the 422 returned for unknown ingredient names. */
export const unresolvedDetailsSchema = z
  .object({ unresolved: z.array(unresolvedIngredientSchema) })
  .openapi("UnresolvedIngredientsDetails");

export const ingredientRefFields = {
  ingredientId: z.string().min(1).optional().describe("Existing ingredient id."),
  ingredient: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Existing ingredient name or alias (plural variants match). Never creates: an unknown name is a 422 with suggestions.",
    ),
  fdcId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "USDA food id (from GET /nutrition/foods or /ingredients/find). Uses the household ingredient already linked to this food, or creates one.",
    ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "With `fdcId` when it creates an ingredient: its name (default: derived from the USDA description). Ignored when one is reused.",
    ),
  category: ingredientCategorySchema
    .optional()
    .describe("With `fdcId` when it creates an ingredient: its category (default other)."),
} as const;

export const ingredientRefSchema = z
  .object(ingredientRefFields)
  .openapi("IngredientRef", {
    description: "Exactly one of `ingredientId`, `ingredient` or `fdcId` names the ingredient.",
  });

export const reviewReasonSchema = z
  .enum(["unlinked", "lint", "custom_unreviewed", "unit"])
  .describe(
    "unlinked = no USDA food; lint = the name breaks the naming rules; custom_unreviewed = nobody accepted this custom ingredient yet; unit = a recipe line or pantry row uses a unit that converts to neither grams nor the stock unit (add a measure).",
  );

export const reviewItemSchema = z
  .object({
    ingredient: ingredientViewSchema,
    reasons: z.array(reviewReasonSchema),
    lint: z
      .object({ reason: z.string(), hint: z.string() })
      .optional()
      .describe("Present when `reasons` has lint."),
    units: z
      .array(z.string())
      .optional()
      .describe("Present when `reasons` has unit: the units that do not convert."),
    suggestions: z.array(suggestionSchema).describe("Ways to fix it: existing ingredients and USDA foods."),
  })
  .openapi("IngredientReviewItem");

export const reviewListSchema = z
  .object({ items: z.array(reviewItemSchema) })
  .openapi("IngredientReviewList");

export const ingredientUsageSchema = z
  .object({
    recipes: z
      .array(
        z.object({
          id: z.string().describe("Recipe id (rec_...)."),
          slug: z.string(),
          title: z.string(),
          lines: z.number().int().describe("Recipe lines that use the ingredient."),
          asMain: z.number().int().describe("Lines where it is the main ingredient."),
          asAlternative: z.number().int().describe("Lines where it is an alternative."),
        }),
      )
      .describe("Recipes that use the ingredient, by title."),
    pantryItem: z
      .object({
        id: z.string().describe("Pantry item id (pi_...)."),
        qty: z.number().nullable().describe("Known quantity; null = present but unknown."),
        unit: z.string().nullable().describe("Normalized unit."),
        qtyApprox: z.boolean().describe("True when the quantity is an estimate."),
        status: pantryStatusSchema,
      })
      .nullable()
      .describe("The pantry row, or null when it is not stocked."),
    shoppingItems: z
      .array(
        z.object({
          itemId: z.string(),
          listId: z.string(),
          listTitle: z.string(),
          listStatus: z.enum(SHOPPING_LIST_STATUSES),
          name: z.string(),
          qty: z.number().nullable(),
          unit: z.string().nullable(),
          checked: z.boolean(),
        }),
      )
      .describe("Items on shopping lists that are not done."),
    rules: z
      .array(
        z.object({
          id: z.string(),
          severity: z.enum(RULE_SEVERITIES),
          reason: z.string().nullable(),
          conditionNote: z.string().nullable(),
          memberId: z.string().nullable().describe("null = the whole household."),
        }),
      )
      .describe("Dietary rules for this ingredient."),
  })
  .openapi("IngredientUsage");

export const ingredientDetailSchema = ingredientViewSchema
  .extend({
    usage: ingredientUsageSchema,
    review: z
      .object({
        reasons: z.array(reviewReasonSchema),
        lint: z.object({ reason: z.string(), hint: z.string() }).optional(),
        units: z
          .array(z.string())
          .optional()
          .describe("Present when `reasons` has unit: the units that do not convert."),
        suggestions: z.array(suggestionSchema),
      })
      .nullable()
      .describe("Why the ingredient needs attention; null when it does not."),
  })
  .openapi("IngredientDetail");

export const ingredientUsageCountsSchema = z
  .object({
    items: z.array(
      z.object({
        ingredientId: z.string(),
        recipes: z.number().int().describe("Recipes with a line or alternative for the ingredient."),
        pantry: z.number().int(),
        shopping: z.number().int().describe("Items on lists that are not done."),
        rules: z.number().int(),
      }),
    ),
  })
  .openapi("IngredientUsageCounts")
  .describe("Only ingredients that are used somewhere are listed; all others are unused.");

export const splitIngredientSchema = z
  .object({
    main: ingredientRefSchema.describe("Becomes the ingredient of every recipe line that used this one."),
    alternatives: z
      .array(ingredientRefSchema)
      .optional()
      .describe("Become alternatives of those lines."),
  })
  .openapi("SplitIngredient");

export const splitResultSchema = z
  .object({
    source: ingredientViewSchema.describe("The split ingredient, now archived."),
    main: ingredientViewSchema,
    alternatives: z.array(ingredientViewSchema),
    moved: z.object({
      recipeLines: z.number().int().describe("Recipe lines that used the split ingredient as the main one."),
      alternativeLines: z.number().int().describe("Recipe lines that listed it as an alternative."),
      pantryItems: z.number().int(),
      shoppingItems: z.number().int(),
    }),
  })
  .openapi("SplitIngredientResult");

export const findIngredientsQuerySchema = z.object({
  query: z.string().min(1).describe('What you are looking for, e.g. "yellow onion".'),
  limit: z.coerce.number().int().min(1).max(25).optional().describe("Maximum per list (default 10)."),
});

export const findIngredientsResultSchema = z
  .object({
    ingredients: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          category: ingredientCategorySchema,
          stockUnit: z.string().nullable(),
          defaultPortion: z.string().nullable(),
          aliases: z.array(z.string()),
          linked: z.boolean().describe("Linked to a USDA food (false = custom)."),
          fdcId: z.number().int().nullable(),
          needsReview: z.boolean(),
          score: z.number(),
        }),
      )
      .describe("Existing household ingredients that match, best first. Prefer these."),
    foods: z
      .array(
        z.object({
          fdcId: z.number().int(),
          description: z.string(),
          suggestedName: z.string(),
          score: z.number(),
          ingredientId: z
            .string()
            .nullable()
            .describe("The household ingredient already linked to this food, if any."),
        }),
      )
      .describe("USDA foods that match. Send `fdcId` (and `suggestedName` as `name`) to create a linked ingredient."),
  })
  .openapi("FindIngredientsResult");

export const mergeResultSchema = z
  .object({
    ingredient: ingredientViewSchema.describe("The surviving (target) ingredient."),
    moved: z.object({
      recipeIngredients: z.number().int(),
      pantryItems: z.number().int(),
      shoppingItems: z.number().int(),
      rules: z.number().int(),
      measures: z.number().int(),
      aliases: z.number().int(),
    }),
  })
  .openapi("MergeIngredientsResult");

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const createIngredientSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Canonical name, e.g. "Yellow onion". Required for a custom ingredient; with `fdcId` it defaults to a name derived from the USDA description. Names cannot hold quantities, sizes, preparation or "x or y".',
      ),
    fdcId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Create a linked ingredient for this USDA food (see GET /nutrition/foods). 409 when the household already has an ingredient linked to it.",
      ),
    custom: z
      .boolean()
      .optional()
      .describe(
        "true = create an ingredient with no USDA food. Last resort: look for a match first (GET /ingredients/find). Without `fdcId` or `custom: true` the request is 422 with suggestions. Customs created with an API token or over MCP are flagged for review.",
      ),
    defaultPortion: z
      .string()
      .nullish()
      .describe('Portion label of the linked food that a plain count means, e.g. "large". Needs `fdcId`.'),
    description: z.string().nullish(),
    category: ingredientCategorySchema.optional(),
    aliases: z
      .array(z.string().min(1))
      .optional()
      .describe('Alternate names ("onion", "yellow onions"); stored lowercase.'),
    stockUnit: z
      .string()
      .nullish()
      .describe(
        'The one unit the ingredient is stocked in, e.g. "g" or "can". It must be a built-in unit or one the ingredient has a measure for. Unset: the first pantry write sets it.',
      ),
    imageUrl: z
      .string()
      .nullish()
      .describe(
        'Icon: null/empty = automatic, a bundled icon name (e.g. "garlic", see list_icons), or an http(s) image URL.',
      ),
    shelfLifeDays: z.number().int().nonnegative().nullish(),
    parQty: z.number().nonnegative().nullish().describe("Desired minimum stock, in the stock unit."),
    parUnit: z
      .string()
      .nullish()
      .describe("Optional unit `parQty` is written in; it is converted into the stock unit."),
    notes: z.string().nullish(),
  })
  .openapi("CreateIngredient");

export const updateIngredientSchema = z
  .object({
    name: z.string().min(1).optional().describe("Renaming updates what aliases resolve to."),
    description: z.string().nullish(),
    category: ingredientCategorySchema.optional(),
    stockUnit: z
      .string()
      .nullish()
      .describe(
        "Changes the stock unit and converts the pantry amount and par into it; 422 when they do not convert. null clears it.",
      ),
    imageUrl: z
      .string()
      .nullish()
      .describe(
        'Icon: null/empty = automatic, a bundled icon name (e.g. "garlic", see list_icons), or an http(s) image URL.',
      ),
    shelfLifeDays: z.number().int().nonnegative().nullish(),
    parQty: z.number().nonnegative().nullish().describe("Desired minimum stock, in the stock unit."),
    parUnit: z
      .string()
      .nullish()
      .describe("Optional unit `parQty` is written in; it is converted into the stock unit."),
    notes: z.string().nullish(),
    defaultPortion: z
      .string()
      .nullish()
      .describe('Portion label of the linked food that a plain count means; null clears it.'),
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
// Measures and unit conversion
// ---------------------------------------------------------------------------

export const measureListSchema = z.object({ items: z.array(measureSchema) }).openapi("MeasureList");

export const setMeasureSchema = z
  .object({
    grams: z.number().positive().describe("Weight of ONE unit in grams."),
    note: z.string().nullish(),
  })
  .openapi("SetMeasure");

export const measureParamsSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "ing_2f7k9m" }),
  unit: z.string().min(1).openapi({ param: { name: "unit", in: "path" }, example: "cup" }),
});

export const unresolvedUnitsDetailsSchema = z
  .object({
    unresolvedUnits: z.array(
      z.object({
        unit: z.string().describe("The unit that is not valid for the ingredient."),
        ingredientId: z.string(),
        ingredientName: z.string(),
        suggestions: z.array(z.string()).describe("Close built-in units plus the ingredient's measures."),
        hint: z.string().describe("What to do: add a measure for the unit, or use a suggested one."),
      }),
    ),
  })
  .openapi("UnresolvedUnitsDetails", {
    description: "`details` of the 422 returned when a write uses a unit the ingredient does not accept.",
  });

export const convertUnitSchema = z
  .object({
    qty: z.number().describe("Amount in `from` units."),
    from: z.string().min(1).describe('Source unit, e.g. "cup".'),
    to: z.string().min(1).describe('Target unit, e.g. "ml".'),
    ingredientId: z
      .string()
      .optional()
      .describe("Use this ingredient's measures (USDA portions and your own) to cross families, e.g. cup → g or can → oz."),
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
