import { z } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "../../context.js";
import {
  addItemSchema,
  checkItemSchema,
  completeShoppingListInputSchema,
  generateShoppingListInputSchema,
  shoppingListStatusSchema,
  updateShoppingItemInputSchema,
} from "../../schemas/shopping.js";
import {
  addItems,
  checkItems,
  clearItems,
  completeShoppingList,
  deleteItem,
  generateShoppingList,
  getShoppingList,
  listShoppingLists,
  updateItem,
  updateShoppingList,
} from "../../services/shopping.js";
import { requireArg, tool } from "./util.js";

const shoppingGetInput = z.object({
  shoppingListId: z
    .string()
    .optional()
    .describe("List id (sl_…); omit to list every list instead of one detail."),
  status: shoppingListStatusSchema.optional(),
  mealPlanId: z.string().optional().describe("Only lists bound to this meal plan."),
  includeChecked: z.boolean().optional().describe("Include checked items (default true)."),
});

const shoppingUpdateInput = z
  .object({
    action: z
      .enum(["update_list", "add_items", "update_item", "delete_item", "clear_items", "check"])
      .describe("Manage a shopping list: its fields, its items, or their check-off state."),
    shoppingListId: z.string().min(1).describe("List id (sl_…)."),
    title: z.string().optional().describe("New list title (action=update_list)."),
    notes: z.string().nullish().describe("New list notes (action=update_list)."),
    status: z
      .enum(["draft", "shopping"])
      .optional()
      .describe('Draft ⇄ shopping; "done" comes from shopping_complete.'),
    items: z
      .array(addItemSchema)
      .min(1)
      .optional()
      .describe("Manual items to add (action=add_items)."),
    itemId: z.string().optional().describe("Item id (sli_…) for update/delete."),
    ...updateShoppingItemInputSchema.shape,
    checks: z
      .array(checkItemSchema)
      .min(1)
      .optional()
      .describe("Check/uncheck items, optionally recording what was actually taken (action=check)."),
  })
  .describe(
    "Update list fields, add/update/delete items, clear every item off the list, or check items off. Manual items survive regeneration; completed lists are immutable.",
  );

const shoppingCompleteInput = z.object({
  shoppingListId: z.string().min(1).describe("List id (sl_…)."),
  ...completeShoppingListInputSchema.shape,
});

export function registerShoppingTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "shopping_generate",
    {
      title: "Generate shopping list",
      description:
        "Create or refresh a shopping list for a plan: plan demand minus stock on hand, rounded to buyable amounts, with a needsCheck bucket for unknown/incomparable stock and low/out staples restocked.",
      inputSchema: generateShoppingListInputSchema,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof generateShoppingListInputSchema>) =>
      generateShoppingList(ctx, args),
    ),
  );

  server.registerTool(
    "shopping_get",
    {
      title: "Get shopping lists",
      description:
        "With `shoppingListId`: one list with items, aisle groups, provenance notes and counts. Without it: list summaries, newest first.",
      inputSchema: shoppingGetInput,
      annotations: { readOnlyHint: true },
    },
    tool((args: z.infer<typeof shoppingGetInput>) => {
      if (args.shoppingListId !== undefined) {
        return getShoppingList(ctx, args.shoppingListId, {
          ...(args.includeChecked === undefined ? {} : { includeChecked: args.includeChecked }),
        });
      }
      return listShoppingLists(ctx, {
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.mealPlanId === undefined ? {} : { mealPlanId: args.mealPlanId }),
      });
    }),
  );

  server.registerTool(
    "shopping_update",
    {
      title: "Update shopping list",
      description:
        "action=update_list (title/notes/status), add_items (resolves ingredient names; unknown names become free-text items), update_item, delete_item, clear_items (removes every item; the list itself and the pantry stay) or check (records actual quantities and substitutes).",
      inputSchema: shoppingUpdateInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof shoppingUpdateInput>) => {
      const listId = args.shoppingListId;
      switch (args.action) {
        case "update_list":
          return updateShoppingList(ctx, listId, {
            ...(args.title === undefined ? {} : { title: args.title }),
            ...(args.notes === undefined ? {} : { notes: args.notes }),
            ...(args.status === undefined ? {} : { status: args.status }),
          });
        case "add_items":
          return addItems(ctx, listId, requireArg(args.items, "items"));
        case "update_item":
          return { item: updateItem(ctx, listId, requireArg(args.itemId, "itemId"), args) };
        case "delete_item":
          return deleteItem(ctx, listId, requireArg(args.itemId, "itemId"));
        case "clear_items":
          return clearItems(ctx, listId);
        case "check":
          return checkItems(ctx, listId, requireArg(args.checks, "checks"));
      }
    }),
  );

  server.registerTool(
    "shopping_complete",
    {
      title: "Complete shopping trip",
      description:
        "Write purchase movements for checked items (actual, received override or planned quantity), mark the list done, and skip free-text items. `received` records what actually came home per item.",
      inputSchema: shoppingCompleteInput,
    },
    tool((args: z.infer<typeof shoppingCompleteInput>) => {
      const { shoppingListId, ...input } = args;
      return completeShoppingList(ctx, shoppingListId, input);
    }),
  );
}
