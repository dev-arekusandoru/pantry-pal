import { z } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "../../context.js";
import { AppError } from "../../lib/errors.js";
import {
  createIngredientSchema,
  ingredientCategorySchema,
  storageLocationSchema,
} from "../../schemas/ingredients.js";
import {
  bulkStockSchema,
  listPantryQuerySchema,
  movementRefTypeSchema,
} from "../../schemas/pantry.js";
import {
  addAlias,
  createIngredient,
  getIngredient,
  listIngredients,
  mergeIngredients,
  removeAlias,
  updateIngredient,
} from "../../services/ingredients.js";
import {
  bulkUpdate,
  deletePantryItem,
  getPantryItem,
  listMovements,
  listPantry,
  updatePantryItem,
  verifyItem,
} from "../../services/pantry.js";
import {
  createConversion,
  deleteConversion,
  listConversions,
} from "../../services/units.js";
import { requireArg, requireIngredientId, tool } from "./util.js";

// ---------------------------------------------------------------------------
// Ingredients and units
// ---------------------------------------------------------------------------

const ingredientSearchInput = z.object({
  query: z
    .string()
    .optional()
    .describe("Case-insensitive substring matched against the name or any alias."),
  category: ingredientCategorySchema.optional(),
  includeArchived: z.boolean().optional().describe("Include archived ingredients (default false)."),
});

const ingredientUpsertInput = z
  .object({
    action: z
      .enum(["create", "update", "alias", "merge"])
      .describe("create a new ingredient, update one, manage its aliases, or merge two into one."),
    ingredientId: z.string().optional().describe("Existing ingredient id for update/alias/merge."),
    ingredient: z
      .string()
      .optional()
      .describe("Ingredient name (alternative to `ingredientId`) for update/alias/merge."),
    ...createIngredientSchema.shape,
    name: z.string().min(1).optional().describe("Canonical name (required when creating)."),
    removeAliases: z
      .array(z.string().min(1))
      .optional()
      .describe("Alias texts to remove (action=alias)."),
    intoId: z
      .string()
      .optional()
      .describe("Target ingredient id that survives the merge (action=merge)."),
  })
  .describe(
    "Create or update an ingredient with its category, default unit/location, aliases, shelf life, par level and notes; merge folds a duplicate into another.",
  );

const unitConversionsInput = z.object({
  action: z.enum(["list", "create", "delete"]).describe("Manage custom unit conversions."),
  ingredientId: z
    .string()
    .optional()
    .describe("Owning ingredient; omit for household-global conversions (list/create)."),
  includeGlobal: z
    .boolean()
    .optional()
    .describe("With ingredientId, also list household-global rows."),
  conversionId: z.string().optional().describe("Conversion id (uc_…) for delete."),
  fromUnit: z.string().min(1).optional().describe('Source unit, e.g. "can".'),
  toUnit: z.string().min(1).optional().describe('Target unit, e.g. "oz".'),
  factor: z.number().positive().optional().describe("1 fromUnit = factor toUnit."),
  note: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------

const pantryQueryInput = z.object({
  pantryItemId: z.string().optional().describe("Return exactly this pantry row (pi_…)."),
  ingredientId: z
    .string()
    .optional()
    .describe(
      "Return one ingredient's detail instead of a list; `ingredient` is the name alternative.",
    ),
  ingredient: z.string().optional().describe("Ingredient name (alternative to `ingredientId`)."),
  category: listPantryQuerySchema.shape.category,
  location: listPantryQuerySchema.shape.location,
  status: listPantryQuerySchema.shape.status,
  staleDays: listPantryQuerySchema.shape.staleDays,
  query: listPantryQuerySchema.shape.query,
});

const pantryUpdateInput = z.object({
  action: z
    .enum(["bulk", "verify", "move", "delete"])
    .describe("bulk applies set/adjust lines; verify, move and delete act on one pantry row."),
  lines: bulkStockSchema.shape.lines.optional(),
  pantryItemId: z.string().optional().describe("Pantry row id (pi_…) for verify/move/delete."),
  location: storageLocationSchema.optional().describe("New location for action=move."),
});

const pantryHistoryInput = z.object({
  pantryItemId: z.string().optional(),
  ingredientId: z.string().optional(),
  ingredient: z.string().optional(),
  refType: movementRefTypeSchema.optional().describe("Filter by cook_event/shopping_list/manual/seed."),
  refId: z.string().optional(),
  limit: z.number().int().positive().max(200).optional().describe("Defaults to 50."),
  before: z.string().optional().describe("Only movements created strictly before this ISO timestamp."),
});

export function registerPantryTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "ingredient_search",
    {
      title: "Search ingredients",
      description:
        "Find ingredients by name/alias/category. Returns ids, default units and locations, staple flags, aliases, custom conversions and current stock.",
      inputSchema: ingredientSearchInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof ingredientSearchInput>) =>
      ({
        items: listIngredients(ctx, {
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.category === undefined ? {} : { category: args.category }),
          includeArchived: args.includeArchived === true,
        }),
      }),
    ),
  );

  server.registerTool(
    "ingredient_upsert",
    {
      title: "Create, update or merge ingredient",
      description:
        "action=create (name required), update (by ingredientId/ingredient), alias (add `aliases`, remove `removeAliases`) or merge (source → `intoId`). Duplicate names are a conflict.",
      inputSchema: ingredientUpsertInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof ingredientUpsertInput>) => {
      switch (args.action) {
        case "create": {
          const name = requireArg(args.name, "name");
          return { ingredient: createIngredient(ctx, { ...args, name }) };
        }
        case "update": {
          const id = requireIngredientId(ctx, args);
          const ingredient = updateIngredient(ctx, id, args);
          for (const alias of args.aliases ?? []) addAlias(ctx, id, alias);
          return { ingredient: args.aliases === undefined ? ingredient : getIngredient(ctx, id) };
        }
        case "alias": {
          const id = requireIngredientId(ctx, args);
          const toRemove = args.removeAliases ?? [];
          const toAdd = args.aliases ?? [];
          if (toRemove.length === 0 && toAdd.length === 0) {
            throw new AppError("validation", "Provide `aliases` to add or `removeAliases` to remove");
          }
          const current = getIngredient(ctx, id);
          for (const text of toRemove) {
            const wanted = text.trim().toLowerCase();
            const alias = current.aliases.find((row) => row.alias === wanted);
            if (alias === undefined) {
              throw new AppError("not_found", `Alias not found: ${text}`, { ingredientId: id });
            }
            removeAlias(ctx, id, alias.id);
          }
          for (const text of toAdd) addAlias(ctx, id, text);
          return { ingredient: getIngredient(ctx, id) };
        }
        case "merge": {
          const sourceId = requireIngredientId(ctx, args);
          return mergeIngredients(ctx, sourceId, requireArg(args.intoId, "intoId"));
        }
      }
    }),
  );

  server.registerTool(
    "unit_conversions",
    {
      title: "Custom unit conversions",
      description:
        "List, create or delete custom conversions (e.g. 1 can = 15 oz) used when comparing recipe lines to pantry stock. Built-in mass/volume tables need no rows.",
      inputSchema: unitConversionsInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof unitConversionsInput>) => {
      switch (args.action) {
        case "list":
          return {
            items: listConversions(ctx, {
              ...(args.ingredientId === undefined ? {} : { ingredientId: args.ingredientId }),
              ...(args.includeGlobal === undefined ? {} : { includeGlobal: args.includeGlobal }),
            }),
          };
        case "create": {
          const conversion = createConversion(ctx, {
            ...(args.ingredientId === undefined ? {} : { ingredientId: args.ingredientId }),
            fromUnit: requireArg(args.fromUnit, "fromUnit"),
            toUnit: requireArg(args.toUnit, "toUnit"),
            factor: requireArg(args.factor, "factor"),
            ...(args.note === undefined ? {} : { note: args.note }),
          });
          return { conversion };
        }
        case "delete": {
          const id = requireArg(args.conversionId, "conversionId");
          deleteConversion(ctx, id);
          return { deleted: true, id };
        }
      }
    }),
  );

  server.registerTool(
    "pantry_query",
    {
      title: "Query pantry stock",
      description:
        "Current stock per ingredient and location with status, approximate/unknown flags, dates and notes. Pass pantryItemId for one row, or ingredientId/ingredient for one ingredient's detail; otherwise filter the list.",
      inputSchema: pantryQueryInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof pantryQueryInput>) => {
      if (args.pantryItemId !== undefined) {
        return { item: getPantryItem(ctx, args.pantryItemId) };
      }
      if (args.ingredientId !== undefined || args.ingredient !== undefined) {
        const id = requireIngredientId(ctx, args);
        return { ingredient: getIngredient(ctx, id) };
      }
      return {
        items: listPantry(ctx, {
          ...(args.category === undefined ? {} : { category: args.category }),
          ...(args.location === undefined ? {} : { location: args.location }),
          ...(args.status === undefined ? {} : { status: args.status }),
          ...(args.staleDays === undefined ? {} : { staleDays: args.staleDays }),
          ...(args.query === undefined ? {} : { query: args.query }),
        }),
      };
    }),
  );

  server.registerTool(
    "pantry_update",
    {
      title: "Update pantry stock",
      description:
        'action=bulk applies `set`/`adjust` lines atomically (ingredient refs accept names; unknown names on positive set/adjust are created), action=verify stamps lastVerifiedAt, action=move changes location, action=delete removes the row and its movements.',
      inputSchema: pantryUpdateInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof pantryUpdateInput>) => {
      switch (args.action) {
        case "bulk": {
          if (args.lines === undefined || args.lines.length === 0) {
            throw new AppError("validation", "Provide at least one stock line");
          }
          return { results: bulkUpdate(ctx, args.lines) };
        }
        case "verify":
          return verifyItem(ctx, requireArg(args.pantryItemId, "pantryItemId"));
        case "move":
          return {
            item: updatePantryItem(ctx, requireArg(args.pantryItemId, "pantryItemId"), {
              location: requireArg(args.location, "location"),
            }),
          };
        case "delete": {
          const id = requireArg(args.pantryItemId, "pantryItemId");
          deletePantryItem(ctx, id);
          return { deleted: true, id };
        }
      }
    }),
  );

  server.registerTool(
    "pantry_history",
    {
      title: "Pantry movement history",
      description:
        "Stock movements newest first: what changed, why, and the resulting quantity/status. Filter by pantry row, ingredient or the cook/shopping event that caused it.",
      inputSchema: pantryHistoryInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof pantryHistoryInput>) =>
      ({
        items: listMovements(ctx, {
          ...(args.pantryItemId === undefined ? {} : { pantryItemId: args.pantryItemId }),
          ...(args.ingredientId === undefined && args.ingredient === undefined
            ? {}
            : { ingredientId: requireIngredientId(ctx, args) }),
          ...(args.refType === undefined ? {} : { refType: args.refType }),
          ...(args.refId === undefined ? {} : { refId: args.refId }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.before === undefined ? {} : { before: args.before }),
        }),
      }),
    ),
  );
}
