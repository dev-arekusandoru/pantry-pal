import { z } from "@hono/zod-openapi";
import {
  INGREDIENT_CATEGORIES,
  MOVEMENT_KINDS,
  MOVEMENT_REASONS,
  MOVEMENT_REF_TYPES,
  PANTRY_STATUSES,
  SHOPPING_ITEM_SOURCES,
  SHOPPING_LIST_STATUSES,
  STORAGE_LOCATIONS,
} from "../db/schema.js";

/** Fresh identifier schema per field. */
const id = () => z.string().min(1).describe("Prefixed identifier.");

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .describe("Calendar date (YYYY-MM-DD).");

export const ingredientCategorySchema = z
  .enum(INGREDIENT_CATEGORIES)
  .describe("Ingredient aisle/category, also used to order shopping items.");

export const pantryStatusSchema = z
  .enum(PANTRY_STATUSES)
  .describe(
    "Stock status: on_hand (above par), low (below par), out (zero), unknown (amount not counted).",
  );

export const shoppingListStatusSchema = z
  .enum(SHOPPING_LIST_STATUSES)
  .describe("draft → shopping → done.");

export const shoppingItemSourceSchema = z
  .enum(SHOPPING_ITEM_SOURCES)
  .describe("generated = came from plan demand; manual = added by a person.");

export const storageLocationSchema = z
  .enum(STORAGE_LOCATIONS)
  .describe("Where the purchased stock is stored.");

// ---------------------------------------------------------------------------
// Demand
// ---------------------------------------------------------------------------

export const demandUseSchema = z
  .object({
    cookEventId: id().describe("Planned cook that needs this ingredient."),
    recipeId: id(),
    recipeTitle: z.string(),
    cookDate: isoDateSchema,
    qty: z.number().nullable().describe("Recipe quantity before unit conversion."),
    unit: z.string().nullable().describe("Covered recipe line unit."),
    optional: z.boolean().describe("Recipe marks this ingredient optional."),
  })
  .openapi("DemandUse");

export const unconvertibleDemandSchema = z
  .object({
    qty: z.number().nullable(),
    unit: z.string().nullable(),
    recipeTitle: z.string(),
  })
  .openapi("UnconvertibleDemand");

export const demandLineSchema = z
  .object({
    ingredientId: id(),
    ingredientName: z.string(),
    category: ingredientCategorySchema,
    unit: z
      .string()
      .nullable()
      .describe(
        "Target unit: pantry stock unit, else ingredient default unit, else the most common line unit.",
      ),
    qty: z
      .number()
      .nullable()
      .describe(
        "Total needed in `unit` (sum of converted lines); null when no line carried a quantity.",
      ),
    qtyMax: z
      .number()
      .optional()
      .describe('Total upper bound when any line used a range ("1-2 heads").'),
    unconvertible: z
      .array(unconvertibleDemandSchema)
      .describe("Lines that could not be expressed in `unit` (mass vs volume vs count)."),
    uses: z.array(demandUseSchema).describe("Every planned cook that contributes to this line."),
  })
  .openapi("DemandLine");

export const availabilityLineSchema = z
  .object({
    ingredientId: id(),
    ingredientName: z.string(),
    category: ingredientCategorySchema,
    unit: z.string().nullable().describe("Unit shared by onHand, committed, available."),
    onHand: z
      .number()
      .nullable()
      .describe("Stock summed across locations; null when any amount is unknown."),
    onHandStatus: pantryStatusSchema,
    committed: z
      .number()
      .nullable()
      .describe("Planned demand in `unit`; null when demand has no comparable qty."),
    available: z
      .number()
      .nullable()
      .describe("onHand - committed; null when the two sides are not comparable."),
    comparable: z.boolean(),
    committedBy: z
      .array(demandUseSchema)
      .describe("Planned cooks that make up `committed`."),
  })
  .openapi("AvailabilityLine");

export const demandInputSchema = z
  .object({
    mealPlanId: id().optional().describe("Limit demand to one meal plan."),
    from: isoDateSchema.optional().describe("Inclusive lower bound on cookDate."),
    to: isoDateSchema.optional().describe("Inclusive upper bound on cookDate."),
    includeOptional: z
      .boolean()
      .optional()
      .describe("Include optional recipe ingredients (default false)."),
  })
  .openapi("DemandInput");

export const demandQuerySchema = z.object({
  from: isoDateSchema.optional().describe("Inclusive lower bound on cookDate."),
  to: isoDateSchema.optional().describe("Inclusive upper bound on cookDate."),
  includeOptional: z
    .enum(["true", "false"])
    .optional()
    .describe("Include optional recipe ingredients (default false)."),
});

export const availabilityQuerySchema = z.object({
  mealPlanId: id().optional().describe("Limit committed demand to one meal plan."),
});

export const demandResponseSchema = z.object({ items: z.array(demandLineSchema) });
export const availabilityResponseSchema = z.object({ items: z.array(availabilityLineSchema) });

export const mealPlanIdParamsSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: "id", in: "path" }, description: "Meal plan id." }),
});

// ---------------------------------------------------------------------------
// Shopping lists
// ---------------------------------------------------------------------------

export const shoppingListSchema = z
  .object({
    id: id(),
    householdId: id(),
    mealPlanId: z.string().nullable(),
    title: z.string(),
    status: shoppingListStatusSchema,
    notes: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .openapi("ShoppingList");

export const shoppingItemSchema = z
  .object({
    id: id(),
    householdId: id(),
    shoppingListId: id(),
    ingredientId: z.string().nullable().describe("Linked ingredient; null for free-text items."),
    name: z.string(),
    category: ingredientCategorySchema,
    qty: z.number().nullable(),
    unit: z.string().nullable(),
    purposeNote: z
      .string()
      .nullable()
      .describe('Why it is on the list (planned cooks or "staple restock").'),
    needsCheck: z
      .boolean()
      .describe("Pantry stock unknown or units incomparable: check before buying."),
    source: shoppingItemSourceSchema,
    note: z.string().nullable(),
    checkedAt: z.string().nullable(),
    actualQty: z.number().nullable(),
    actualUnit: z.string().nullable(),
    substituteIngredientId: z.string().nullable(),
    position: z.number().int(),
    createdAt: z.string(),
  })
  .openapi("ShoppingListItem");

export const shoppingListDetailSchema = z
  .object({
    list: shoppingListSchema,
    items: z.array(shoppingItemSchema),
    groups: z.array(
      z.object({ category: ingredientCategorySchema, items: z.array(shoppingItemSchema) }),
    ),
    counts: z.object({
      total: z.number().int(),
      checked: z.number().int(),
      remaining: z.number().int(),
      needsCheck: z.number().int(),
    }),
  })
  .openapi("ShoppingListDetail");

export const addItemSchema = z
  .object({
    ingredientId: z.string().optional().describe("Existing ingredient id (ing_…)."),
    ingredient: z
      .string()
      .optional()
      .describe(
        "Ingredient name; resolved against names and aliases. Unknown names become free-text items.",
      ),
    name: z
      .string()
      .optional()
      .describe("Display name, or the free-text item name when nothing resolves."),
    qty: z.number().nullable().optional().describe("Quantity to buy."),
    unit: z.string().nullable().optional().describe("Unit for `qty`."),
    note: z.string().optional().describe("Free-form note for the shopper."),
    purposeNote: z.string().optional(),
    category: ingredientCategorySchema.optional(),
    needsCheck: z.boolean().optional(),
  })
  .openapi("AddShoppingItem");

export const createShoppingListInputSchema = z
  .object({
    title: z.string().optional(),
    notes: z.string().optional(),
    mealPlanId: z.string().optional().describe("Bind the list to a meal plan."),
    items: z.array(addItemSchema).optional(),
  })
  .openapi("CreateShoppingListInput");

export const updateShoppingListInputSchema = z
  .object({
    title: z.string().optional(),
    notes: z.string().nullable().optional(),
    status: z
      .enum(["draft", "shopping"])
      .optional()
      .describe('draft → shopping (or back); "done" comes from completing the list.'),
  })
  .openapi("UpdateShoppingListInput");

export const generateShoppingListInputSchema = z
  .object({
    mealPlanId: z.string().describe("Meal plan whose planned cooks drive the list."),
    listId: z
      .string()
      .optional()
      .describe("Regenerate into this existing draft/shopping list."),
    title: z.string().optional(),
    includeStaples: z
      .boolean()
      .optional()
      .describe('Add low/out staples as "staple restock" items (default true).'),
  })
  .openapi("GenerateShoppingListInput");

export const updateShoppingItemInputSchema = z
  .object({
    name: z.string().optional(),
    category: ingredientCategorySchema.optional(),
    qty: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    purposeNote: z.string().nullable().optional(),
    needsCheck: z.boolean().optional(),
    actualQty: z.number().nullable().optional(),
    actualUnit: z.string().nullable().optional(),
    substituteIngredient: z
      .string()
      .nullable()
      .optional()
      .describe("Ingredient name or id actually bought instead."),
  })
  .openapi("UpdateShoppingItemInput");

export const checkItemSchema = z.object({
  itemId: id(),
  checked: z.boolean(),
  actualQty: z.number().nullable().optional(),
  actualUnit: z.string().nullable().optional(),
  substituteIngredient: z.string().nullable().optional(),
});

export const checkItemsInputSchema = z
  .object({ items: z.array(checkItemSchema).min(1) })
  .openapi("CheckShoppingItemsInput");

export const completeShoppingListInputSchema = z
  .object({
    received: z
      .array(
        z.object({
          itemId: id(),
          qty: z.number().nullable().optional(),
          unit: z.string().nullable().optional(),
          location: storageLocationSchema.optional(),
        }),
      )
      .optional()
      .describe("Per-item overrides for what actually came home."),
    onlyChecked: z
      .boolean()
      .optional()
      .describe("Default true: only checked items become stock."),
  })
  .openapi("CompleteShoppingListInput");

export const stockMovementSchema = z
  .object({
    id: id(),
    householdId: id(),
    pantryItemId: id(),
    kind: z.enum(MOVEMENT_KINDS),
    qty: z.number().nullable(),
    unit: z.string().nullable(),
    reason: z.enum(MOVEMENT_REASONS),
    refType: z.enum(MOVEMENT_REF_TYPES).nullable(),
    refId: z.string().nullable(),
    note: z.string().nullable(),
    qtyAfter: z.number().nullable(),
    statusAfter: pantryStatusSchema,
    createdAt: z.string(),
  })
  .openapi("StockMovement");

export const skippedShoppingItemSchema = z.object({
  itemId: id(),
  name: z.string(),
  reason: z.enum(["free_text"]),
});

export const completeShoppingListResponseSchema = z.object({
  list: shoppingListSchema,
  movements: z.array(stockMovementSchema),
  skipped: z.array(skippedShoppingItemSchema),
});

export const listShoppingListsQuerySchema = z.object({
  status: shoppingListStatusSchema.optional(),
  mealPlanId: z.string().optional(),
});

export const getShoppingListQuerySchema = z.object({
  includeChecked: z
    .enum(["true", "false"])
    .optional()
    .describe("Include checked items in items/groups (default true)."),
});

export const shoppingListParamsSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: "id", in: "path" }, description: "Shopping list id." }),
});

export const shoppingItemParamsSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: "id", in: "path" }, description: "Shopping list id." }),
  itemId: z
    .string()
    .min(1)
    .openapi({ param: { name: "itemId", in: "path" }, description: "Shopping list item id." }),
});

export const shoppingListsResponseSchema = z.object({ items: z.array(shoppingListSchema) });
export const addItemsInputSchema = z
  .object({ items: z.array(addItemSchema).min(1) })
  .openapi("AddShoppingItemsInput");
export const addItemsResponseSchema = z.object({ items: z.array(shoppingItemSchema) });
export const deleteResponseSchema = z.object({ deleted: z.literal(true), id: z.string() });

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(["not_found", "conflict", "validation", "unprocessable", "unauthorized"]),
    message: z.string(),
  }),
});
