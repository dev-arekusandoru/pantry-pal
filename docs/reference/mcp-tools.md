# MCP tool reference

PantryPal registers 28 MCP tools. The `tools/list` request returns each tool's
full JSON Schema, generated from the Zod schemas in the source. Use this page to
choose a tool and see its main inputs. Use `tools/list` or the linked source
files for every field, default, and enum.

All tools take a JSON object. A successful call returns compact JSON in a text
content block. An error returns `isError: true` with this body in the text block:

```json
{"error": {"code": "not_found", "message": "...", "details": {}}}
```

The error codes and HTTP status equivalents are listed in the
[REST API reference](rest-api.md#errors).

Input schemas come from these files:

| Area | Tool handlers | Schemas |
| --- | --- | --- |
| Household | [`src/mcp/tools/household.ts`](../../src/mcp/tools/household.ts) | [`src/schemas/household.ts`](../../src/schemas/household.ts) |
| Ingredients, units, pantry | [`src/mcp/tools/pantry.ts`](../../src/mcp/tools/pantry.ts) | [`src/schemas/ingredients.ts`](../../src/schemas/ingredients.ts), [`src/schemas/pantry.ts`](../../src/schemas/pantry.ts) |
| Recipes and rules | [`src/mcp/tools/recipes.ts`](../../src/mcp/tools/recipes.ts) | [`src/schemas/recipes.ts`](../../src/schemas/recipes.ts), [`src/schemas/rules.ts`](../../src/schemas/rules.ts) |
| Plans and cooking | [`src/mcp/tools/planning.ts`](../../src/mcp/tools/planning.ts) | [`src/schemas/plans.ts`](../../src/schemas/plans.ts) |
| Shopping | [`src/mcp/tools/shopping.ts`](../../src/mcp/tools/shopping.ts) | [`src/schemas/shopping.ts`](../../src/schemas/shopping.ts) |

## Shared rules

- IDs are prefixed strings such as `ing_`, `rcp_`, `plan_`, `ce_`, and `sl_`.
  They are stable. Pass them between calls.
- Ingredient inputs accept `ingredientId` or an ingredient name in `ingredient`.
  Names resolve through canonical names, aliases, and simple plurals. Prefer an
  ID when you have one.
- An unknown `ingredient` reference fails with `unprocessable` unless that tool
  is defined to create it. Shopping item names may instead become free text. Do
  not invent an ID.
- A null quantity is unknown, not zero. Read the stock status as well.
- The server does unit conversion, recipe scaling, demand, and shopping
  arithmetic. Send source amounts and choices.
- Tools with an `action` field require it. The action values are listed below.
- Read tools are annotated `readOnlyHint`. Some data-changing tools also carry
  `destructiveHint`; use annotations as a warning, not as the only safety check.

## Household

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `household_get` | Read the household, settings, and members. | None. |
| `household_update` | Change household fields and add, update, or delete members. | `name`, `timezone`, `settings` (partial, merged), `members[]` with `action` `upsert` or `delete`, `memberId`, `name`, `notes`. |

## Ingredients and units

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `ingredient_search` | Find ingredients by name, alias, or category. Returns IDs, stock, aliases, conversions, and staple data. | `query`, `category`, `includeArchived`. |
| `ingredient_upsert` | Create, update, alias, or merge an ingredient. | `action` `create`, `update`, `alias`, or `merge`; `ingredientId` or `ingredient`; `name`; category and default unit or location; `aliases`; `removeAliases`; `intoId` for merge. |
| `unit_conversions` | List, create, or delete custom unit conversions such as `1 can = 15 oz`, per ingredient or household-global. | `action` `list`, `create`, or `delete`; `ingredientId`; `includeGlobal`; `conversionId`; `fromUnit`, `toUnit`, `factor`; `note`. |

## Pantry and availability

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `pantry_query` | Read current stock. One pantry row, one ingredient's detail, or a filtered list. | `pantryItemId`; or `ingredientId` or `ingredient`; or `category`, `location`, `status`, `staleDays`, `query`. |
| `pantry_update` | Apply stock changes or act on one pantry row. | `action` `bulk`, `verify`, `move`, or `delete`; `lines[]` for bulk with `op` `set` or `adjust`, an ingredient reference, `qty` or `delta`, `unit`, `location`, `qtyApprox`, `reason`; `pantryItemId`; `location`. |
| `pantry_history` | Read stock movements, newest first, with the reason and resulting quantity. | `pantryItemId`, `ingredientId` or `ingredient`, `refType`, `refId`, `limit` (maximum 200), `before`. |
| `availability` | Compare stock on hand with demand from planned cooks. Read-only. | `mealPlanId`, `from`, `to`, `includeOptional`. |

`pantry_update` with `action: "bulk"` applies every line atomically. If one line
fails, no line changes. A manual `set` or `adjust` with a positive amount can
create an unknown ingredient; the other pantry tools do not create ingredients.

## Recipes and rules

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `recipe_search` | Search recipes without loading their steps. | `query`, `status`, `tags[]`, `mealType`, `ingredientId`, `maxTotalMinutes`, `limit`, `offset`. |
| `recipe_get` | Read one recipe by ID or slug, including ingredients, steps, times, nutrition, notes, and cook stats. | `idOrSlug`; optional `servings` to add a scaled ingredient list. |
| `recipe_save` | Create a recipe or patch an existing one. | `id` to update or omit to create; `title`; `servings`; `ingredients[]`; `steps[]`; optional recipe fields such as times, meal types, tags, equipment, nutrition, and notes; `statusNote`. |
| `recipe_set_status` | Move a recipe through its status values and write a history event. | `recipeId` (ID or slug); `status` `want_to_try`, `rotation`, `never`, or `archived`; `rating`; `note`. |
| `recipe_check` | Check a stored recipe or loose ingredient names against dietary rules. | `recipeId` (ID or slug) or `ingredients[]`. |
| `rules_list` | List dietary rules. | `scope`, `severity`, `memberId`. |
| `rules_manage` | Create, update, or delete a dietary rule. | `action` `create`, `update`, or `delete`; `ruleId`; `scope`; `severity`; `ingredientId` or `ingredient`, `recipeId`, or `targetText`; `conditionNote`, `reason`, `memberId`. |

`recipe_save` treats `ingredients` and `steps` as the full list when present.
`recipe_check` returns `ok: false` only for an unconditional forbidden match.
A violation with a `conditionNote` is a judgement call for the agent.

## Plans and cooking

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `plan_get` | Read a week plan with cooks, slots, prep tasks, warnings, and status. | `plan`: plan ID, `weekStart` date, or `current` (default). |
| `plan_create` | Create a plan with cooks, slots, and prep tasks in one transaction. | `weekStart`; `title`, `status`, `notes`; `cookEvents[]` with optional `key`; `slots[]` with `cookEventKey` or `cookEventId`; `prepTasks[]`. |
| `plan_set_slots` | Replace slots for one or more date and meal groups. | `planId`; `ops[]` with `date`, `mealType`, and `spec.kind` `cook`, `leftover`, `freeform`, `skip`, or `clear`. |
| `plan_swap_meal` | Put a different recipe on one meal slot. | `planId`; `slotId` or `date` and `mealType`; `recipeId` or `recipe`; `scope` `this` or `with_leftovers`. |
| `plan_update` | Change plan fields, or add, update, or delete a cook event. | `action` `update`, `add_cook`, `update_cook`, or `delete_cook`; `planId`; `cookEventId`; `title`, `status`, `notes`; `recipeId` or `recipe`; `cookDate`; `plannedServings`; `actualServings`; `label`; `rating`; `force`. |
| `prep_tasks` | List, add, update, complete, or delete prep tasks. | `action` `list`, `add`, `update`, `complete`, or `delete`; `planId`; `prepTaskId`; `dueDate`; `description`; `cookEventId`; `position`; `from`, `to`, `includeDone`. |
| `cook_complete` | Complete, skip, reopen, or undo a cook. | `action` `complete`, `skip`, `reopen`, or `undo`; `cookEventId`; `actualServings`; `rating`; `notes`; `decrementPantry`; `note` for skip. |
| `cook_history` | Read recent cooks with their recipe, servings, rating, notes, and pantry movements. | `planId`, `from`, `to`, `status`, `recipeId`, `limit`. |

`plan_swap_meal` returns `shoppingListStale`. `scope: "this"` changes only the
target meal; `scope: "with_leftovers"` changes the cook and every slot it feeds.
When `shoppingListStale` is `true`, regenerate an open shopping list for that
plan. `cook_complete` with `action: "complete"` decrements pantry stock.
`reopen` and `undo` restore stock.

## Shopping

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `shopping_generate` | Create or refresh a list from plan demand minus stock on hand. | `mealPlanId`; `listId` to refresh an existing list; `title`; `includeStaples`. |
| `shopping_get` | Read one list with items and counts, or list summaries. | `shoppingListId`; without it, `status` and `mealPlanId`; `includeChecked`. |
| `shopping_update` | Change list fields, items, or check-off state. | `action` `update_list`, `add_items`, `update_item`, `delete_item`, `clear_items`, or `check`; `shoppingListId`; `title`, `notes`, `status`; `items[]`; `itemId`; item fields; `checks[]`. |
| `shopping_complete` | Turn checked purchases into pantry movements and close the list. | `shoppingListId`; `received[]`; `onlyChecked`; `recordPurchases`; `completedAt`. |

`shopping_complete` writes stock by default. Set `recordPurchases: false` only
when the pantry already reflects that trip. `clear_items` does not change the
pantry.

## Related pages

- [MCP setup](../connect/setup.md)
- [Common tasks](../connect/tasks.md)
- [REST API](rest-api.md)
