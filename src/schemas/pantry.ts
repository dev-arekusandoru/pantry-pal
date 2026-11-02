import { z } from "@hono/zod-openapi";
import {
  MOVEMENT_KINDS,
  MOVEMENT_REASONS,
  MOVEMENT_REF_TYPES,
} from "../db/schema.js";
import {
  ingredientCategorySchema,
  pantryStatusSchema,
  storageLocationSchema,
} from "./ingredients.js";

export const movementKindSchema = z
  .enum(MOVEMENT_KINDS)
  .describe("set = absolute quantity, delta = relative change.");

export const movementReasonSchema = z
  .enum(MOVEMENT_REASONS)
  .describe("purchase, cook, waste, adjust, import or verify.");

export const movementRefTypeSchema = z
  .enum(MOVEMENT_REF_TYPES)
  .describe("What produced the movement: cook_event, shopping_list, manual or seed.");

export const pantryItemViewSchema = z
  .object({
    id: z.string().describe("Pantry item id (pi_...)."),
    ingredientId: z.string().describe("Ingredient id (ing_...)."),
    ingredient: z.object({
      id: z.string(),
      name: z.string(),
      category: ingredientCategorySchema,
    }),
    location: storageLocationSchema,
    qty: z.number().nullable().describe("Cached quantity; null = present but unknown."),
    unit: z.string().nullable().describe("Normalized unit."),
    qtyApprox: z.boolean(),
    status: pantryStatusSchema,
    rawText: z.string().nullable().describe('Original free text, e.g. "1 small jar".'),
    note: z.string().nullable(),
    purchasedOn: z.string().nullable().describe("YYYY-MM-DD."),
    openedOn: z.string().nullable().describe("YYYY-MM-DD."),
    expiresOn: z.string().nullable().describe("YYYY-MM-DD."),
    lastVerifiedAt: z.string().nullable().describe("ISO timestamp of the last verify."),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("PantryItem");

export const pantryListSchema = z
  .object({ items: z.array(pantryItemViewSchema) })
  .openapi("PantryItemList");

export const stockMovementSchema = z
  .object({
    id: z.string().describe("Movement id (mv_...)."),
    pantryItemId: z.string(),
    kind: movementKindSchema,
    qty: z.number().nullable().describe("Recorded amount, in the recorded unit."),
    unit: z.string().nullable(),
    reason: movementReasonSchema,
    refType: movementRefTypeSchema.nullable(),
    refId: z.string().nullable(),
    note: z.string().nullable(),
    qtyAfter: z.number().nullable().describe("Item quantity after this movement."),
    statusAfter: pantryStatusSchema.describe("Item status after this movement."),
    createdAt: z.string(),
  })
  .openapi("StockMovement");

export const stockMovementViewSchema = stockMovementSchema
  .extend({
    ingredientId: z.string(),
    ingredientName: z.string(),
    location: storageLocationSchema,
  })
  .openapi("StockMovementView");

export const movementListSchema = z
  .object({ items: z.array(stockMovementViewSchema) })
  .openapi("StockMovementList");

export const movementResultSchema = z
  .object({
    item: pantryItemViewSchema,
    movement: stockMovementSchema,
    warning: z.string().optional().describe('e.g. "units not comparable".'),
  })
  .openapi("MovementResult");

export const bulkResultSchema = z
  .object({ results: z.array(movementResultSchema) })
  .openapi("BulkMovementResult");

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const ingredientRefFields = {
  ingredientId: z
    .string()
    .optional()
    .describe("Existing ingredient id; wins over `ingredient`."),
  ingredient: z
    .string()
    .optional()
    .describe("Ingredient name; resolved through names, aliases and plurals."),
  category: ingredientCategorySchema
    .optional()
    .describe("Category used when the ingredient has to be created."),
} as const;

export const setStockSchema = z
  .object({
    ...ingredientRefFields,
    qty: z.number().nullable().describe("Absolute quantity; null = present but unknown."),
    unit: z.string().nullish().describe('Unit, e.g. "lb", "g", "can".'),
    location: storageLocationSchema.optional(),
    status: pantryStatusSchema
      .optional()
      .describe("Overrides the computed status for this set."),
    note: z.string().nullish(),
    expiresOn: z.string().nullish().describe("YYYY-MM-DD."),
    openedOn: z.string().nullish().describe("YYYY-MM-DD."),
    purchasedOn: z.string().nullish().describe("YYYY-MM-DD."),
    qtyApprox: z.boolean().optional().describe("True when the quantity is an estimate."),
    rawText: z.string().nullish(),
    reason: movementReasonSchema.optional().describe('Defaults to "adjust".'),
    refType: movementRefTypeSchema.optional(),
    refId: z.string().optional(),
  })
  .openapi("SetStock");

export const adjustStockSchema = z
  .object({
    ...ingredientRefFields,
    delta: z.number().describe("Relative change (negative consumes)."),
    unit: z.string().nullish().describe("Unit of the delta; defaults to the item unit."),
    location: storageLocationSchema.optional(),
    note: z.string().nullish(),
    reason: movementReasonSchema.optional().describe('Defaults to "adjust".'),
    refType: movementRefTypeSchema.optional(),
    refId: z.string().optional(),
  })
  .openapi("AdjustStock");

export const bulkStockSchema = z
  .object({
    lines: z
      .array(
        z.discriminatedUnion("op", [
          setStockSchema.extend({ op: z.literal("set") }),
          adjustStockSchema.extend({ op: z.literal("adjust") }),
        ]),
      )
      .describe("Applied atomically in order; one failure rolls back every line."),
  })
  .openapi("BulkStock");

export const updatePantryItemSchema = z
  .object({
    location: storageLocationSchema.optional().describe("Moving stock to another location."),
    note: z.string().nullish(),
    expiresOn: z.string().nullish().describe("YYYY-MM-DD."),
    openedOn: z.string().nullish().describe("YYYY-MM-DD."),
    purchasedOn: z.string().nullish().describe("YYYY-MM-DD."),
    rawText: z.string().nullish(),
    status: pantryStatusSchema.optional(),
    qtyApprox: z.boolean().optional(),
  })
  .openapi("UpdatePantryItem");

export const listPantryQuerySchema = z.object({
  category: ingredientCategorySchema.optional(),
  location: storageLocationSchema.optional(),
  status: pantryStatusSchema.optional(),
  staleDays: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Only items never verified or verified more than N days ago."),
  query: z
    .string()
    .optional()
    .describe("Case-insensitive substring matched against the ingredient name or an alias."),
});

export const listMovementsQuerySchema = z.object({
  pantryItemId: z.string().optional(),
  ingredientId: z.string().optional(),
  refType: movementRefTypeSchema.optional(),
  refId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional().describe("Defaults to 50."),
  before: z
    .string()
    .optional()
    .describe("Only movements created strictly before this ISO timestamp."),
});

export const pantryParamsSchema = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "pi_5c9x1v" }),
});
