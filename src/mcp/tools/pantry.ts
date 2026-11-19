import { z } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "../../context.js";
import { AppError } from "../../lib/errors.js";
import { ICON_NAMES } from "../../lib/icons.js";
import {
  createIngredientSchema,
  ingredientCategorySchema,
  ingredientRefSchema,
} from "../../schemas/ingredients.js";
import {
  bulkStockSchema,
  listPantryQuerySchema,
  movementRefTypeSchema,
} from "../../schemas/pantry.js";
import {
  acceptIngredient,
  addAlias,
  createIngredient,
  findIngredientCandidates,
  getIngredient,
  getIngredientDetail,
  listIngredients,
  listIngredientsForReview,
  mergeIngredients,
  removeAlias,
  splitIngredient,
  updateIngredient,
} from "../../services/ingredients.js";
import {
  bulkUpdate,
  deletePantryItem,
  getPantryItem,
  listMovements,
  listPantry,
  verifyItem,
} from "../../services/pantry.js";
import { deleteMeasure, listMeasures, setMeasure } from "../../services/units.js";
import { requireArg, requireIngredientId, tool } from "./util.js";

// ---------------------------------------------------------------------------
// Ingredients and units
// ---------------------------------------------------------------------------

const ingredientSearchInput = z.object({
  ingredientId: z
    .string()
    .optional()
    .describe(
      "Return one ingredient's detail instead of a list: the ingredient plus where it is used (recipes, pantry, open shopping list items, dietary rules) and why it needs review.",
    ),
  ingredient: z.string().optional().describe("Ingredient name or alias (alternative to `ingredientId`) for the detail."),
  query: z
    .string()
    .optional()
    .describe("Case-insensitive substring matched against the name or any alias."),
  category: ingredientCategorySchema.optional(),
  includeArchived: z.boolean().optional().describe("Include archived ingredients (default false)."),
});

const iconListInput = z.object({
  query: z
    .string()
    .optional()
    .describe("Case-insensitive substring matched against icon names, e.g. \"tomato\"."),
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe("Maximum icon names to return (default 100)."),
});

const findIngredientInput = z.object({
  query: z.string().min(1).describe('What you need, e.g. "yellow onion" or "olive oil".'),
  limit: z.number().int().min(1).max(25).optional().describe("Maximum per list (default 10)."),
});

const { custom: _customFlag, name: _createName, ...createFields } = createIngredientSchema.shape;

const customIngredientInput = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Name of ONE ingredient. No quantities, sizes (large), preparation (chopped), commas or \"x or y\"; those belong on the recipe line.",
    ),
  description: createFields.description,
  category: createFields.category,
  aliases: createFields.aliases,
  stockUnit: createFields.stockUnit,
  imageUrl: createFields.imageUrl,
  shelfLifeDays: createFields.shelfLifeDays,
  parQty: createFields.parQty,
  parUnit: createFields.parUnit,
  notes: createFields.notes,
});

const reviewInput = z.object({
  action: z
    .enum(["list", "accept", "split"])
    .describe(
      "list = ingredients to review with reasons and suggestions; accept = keep a custom ingredient as it is; split = turn an ingredient that names several into real ones.",
    ),
  ingredientId: z.string().optional().describe("Ingredient id for accept/split."),
  ingredient: z.string().optional().describe("Ingredient name (alternative to `ingredientId`)."),
  main: ingredientRefSchema
    .optional()
    .describe("split: becomes the ingredient of every recipe line that used this one."),
  alternatives: z
    .array(ingredientRefSchema)
    .optional()
    .describe("split: become alternatives of those lines."),
});

const ingredientUpsertInput = z
  .object({
    action: z
      .enum(["create", "update", "alias", "merge"])
      .describe(
        "create a LINKED ingredient (needs `fdcId`), update one, manage its aliases, or merge two into one.",
      ),
    ingredientId: z.string().optional().describe("Existing ingredient id for update/alias/merge."),
    ingredient: z
      .string()
      .optional()
      .describe("Ingredient name (alternative to `ingredientId`) for update/alias/merge."),
    ...createFields,
    name: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Canonical name; with `fdcId` it defaults to a name derived from the USDA description. Renames must pass the naming rules.",
      ),
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
    'Create a linked ingredient (`fdcId` from find_ingredient or search_foods; no custom ingredients here, see create_custom_ingredient) or update one: category, icon (`imageUrl`: a bundled icon name from list_icons, an http(s) URL, or null for automatic), stock unit (the one unit pantry amounts, par and shopping quantities are stored in; changing it converts them), aliases, shelf life, par level and notes; merge folds a duplicate into another.',
  );

const ingredientMeasuresInput = z.object({
  action: z
    .enum(["list", "set", "delete"])
    .describe("list = the ingredient's measures; set = create or change your measure for a unit; delete = remove your measure."),
  ingredientId: z.string().optional().describe("Ingredient id."),
  ingredient: z.string().optional().describe("Ingredient name (alternative to `ingredientId`)."),
  unit: z
    .string()
    .min(1)
    .optional()
    .describe('Unit for set/delete, e.g. "cup", "clove", "can" or a new one like "handful".'),
  grams: z.number().positive().optional().describe("set: weight of ONE unit in grams."),
  note: z.string().nullish().describe("set: optional note."),
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
  status: listPantryQuerySchema.shape.status,
  staleDays: listPantryQuerySchema.shape.staleDays,
  query: listPantryQuerySchema.shape.query,
});

const pantryUpdateInput = z.object({
  action: z
    .enum(["bulk", "verify", "delete"])
    .describe("bulk applies set/adjust lines; verify and delete act on one pantry row."),
  lines: bulkStockSchema.shape.lines.optional(),
  pantryItemId: z.string().optional().describe("Pantry row id (pi_…) for verify/delete."),
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
        "List ingredients by name/alias/category with ids, stock units, aliases, measures and current stock. Pass ingredientId (or ingredient) for one ingredient's detail with its usage (recipes, pantry, open shopping list items, dietary rules). To pick the ingredient for a recipe line, pantry line or rule, use find_ingredient first.",
      inputSchema: ingredientSearchInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof ingredientSearchInput>) => {
      if (args.ingredientId !== undefined || args.ingredient !== undefined) {
        return { ingredient: getIngredientDetail(ctx, requireIngredientId(ctx, args)) };
      }
      return {
        items: listIngredients(ctx, {
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.category === undefined ? {} : { category: args.category }),
          includeArchived: args.includeArchived === true,
        }),
      };
    }),
  );

  server.registerTool(
    "find_ingredient",
    {
      title: "Find an ingredient",
      description:
        "ALWAYS call this before using an ingredient name you are not sure exists. Returns existing household `ingredients` that match (use their `id` as `ingredientId`, or their exact name) and USDA `foods` (use `fdcId` and `suggestedName` as `name` to create a linked ingredient in the same recipe/pantry/rule call). Put \"x or y\" in `alternatives`, sizes in the line `unit` (large), preparation in `prepNote`: never in the name.",
      inputSchema: findIngredientInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof findIngredientInput>) =>
      findIngredientCandidates(ctx, args.query, args.limit),
    ),
  );

  server.registerTool(
    "create_custom_ingredient",
    {
      title: "Create a custom ingredient (last resort)",
      description:
        "Creates an ingredient with NO USDA food (no nutrition). LAST RESORT: only after find_ingredient and search_foods returned nothing usable. Never for combinations or alternatives (\"milk or water\": use recipe `alternatives`), sizes (\"large egg\": use the unit), or preparation (\"chopped onion\": use prepNote). The ingredient is flagged for review by a person.",
      inputSchema: customIngredientInput,
    },
    tool((args: z.infer<typeof customIngredientInput>) => ({
      ingredient: createIngredient(ctx, { ...args, custom: true, needsReview: true }),
    })),
  );

  server.registerTool(
    "review_ingredients",
    {
      title: "Review ingredients",
      description:
        "action=list: ingredients that need attention (unlinked, custom and not yet accepted, or with a name that breaks the naming rules) with reasons and suggestions. action=accept: keep a custom ingredient as it is. action=split: an ingredient that names several (\"Milk or water\") becomes `main` plus `alternatives` on every recipe line that used it, and is archived. To link a food use set_ingredient_nutrition; to rename use ingredient_upsert; to fold a duplicate use ingredient_upsert merge.",
      inputSchema: reviewInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof reviewInput>) => {
      switch (args.action) {
        case "list":
          return { items: listIngredientsForReview(ctx) };
        case "accept":
          return { ingredient: acceptIngredient(ctx, requireIngredientId(ctx, args)) };
        case "split":
          return splitIngredient(ctx, requireIngredientId(ctx, args), {
            main: requireArg(args.main, "main"),
            ...(args.alternatives === undefined ? {} : { alternatives: args.alternatives }),
          });
      }
    }),
  );

  server.registerTool(
    "list_icons",
    {
      title: "List bundled ingredient icons",
      description:
        "Names accepted in an ingredient's `imageUrl`. Use one for a bundled icon, an http(s) URL for a custom image, or null for automatic matching.",
      inputSchema: iconListInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof iconListInput>) => {
      const query = args.query?.trim().toLowerCase() ?? "";
      const names = query === "" ? ICON_NAMES : ICON_NAMES.filter((name) => name.includes(query));
      return { total: names.length, items: names.slice(0, args.limit ?? 100) };
    }),
  );

  server.registerTool(
    "ingredient_upsert",
    {
      title: "Create, update or merge ingredient",
      description:
        "action=create (a linked ingredient: `fdcId` required, `name` optional; without it the call is 422 with suggestions), update (by ingredientId/ingredient; includes `defaultPortion`, the food portion a plain count means), alias (add `aliases`, remove `removeAliases`) or merge (source → `intoId`). Names hold one ingredient only: no quantities, sizes, preparation or \"x or y\". Duplicate names are a conflict.",
      inputSchema: ingredientUpsertInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof ingredientUpsertInput>) => {
      switch (args.action) {
        case "create": {
          return { ingredient: createIngredient(ctx, args) };
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
    "ingredient_measures",
    {
      title: "Ingredient measures",
      description:
        "What one unit of an ingredient weighs, in grams. `list` returns the effective measures: the linked USDA food's portions (source usda, or usda_estimated when borrowed from a similar food) overridden by yours (source user). `set` creates or changes your measure for a unit (1 cup = 30 g also gives the density, so every volume unit converts; 1 handful = 25 g makes \"handful\" a valid unit for this ingredient); mass units (g, kg, oz, lb) are fixed. `delete` removes your measure; the USDA one shows again. A recipe, pantry or shopping write with a unit the ingredient does not accept is a 422 with suggestions; add the measure, then retry. Every ingredient has ONE stock unit: pantry amounts, par and shopping quantities are converted into it.",
      inputSchema: ingredientMeasuresInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof ingredientMeasuresInput>) => {
      const id = requireIngredientId(ctx, args);
      switch (args.action) {
        case "list":
          return { items: listMeasures(ctx, id) };
        case "set":
          return {
            measure: setMeasure(ctx, id, requireArg(args.unit, "unit"), {
              grams: requireArg(args.grams, "grams"),
              ...(args.note === undefined ? {} : { note: args.note }),
            }),
          };
        case "delete": {
          const unit = requireArg(args.unit, "unit");
          deleteMeasure(ctx, id, unit);
          return { deleted: true, ingredientId: id, unit };
        }
      }
    }),
  );

  server.registerTool(
    "pantry_query",
    {
      title: "Query pantry stock",
      description:
        "Current stock per ingredient with status, approximate/unknown flags, dates and notes. Pass pantryItemId for one row, or ingredientId/ingredient for one ingredient's detail; otherwise filter the list.",
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
        'action=bulk applies `set`/`adjust` lines atomically (each line names an ingredient by `ingredientId`, an existing `ingredient` name, or `fdcId` (+ `name`) for a new linked one; unknown names create nothing: 422 listing all of them with suggestions. Call find_ingredient first), action=verify stamps lastVerifiedAt, action=delete removes the row and its movements.',
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
