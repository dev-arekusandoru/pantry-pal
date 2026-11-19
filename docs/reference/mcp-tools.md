# MCP tool reference

PantryPal registers 36 MCP tools. The `tools/list` request returns each tool's
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
| Household | [`household.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/mcp/tools/household.ts) | [`household.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/schemas/household.ts) |
| Ingredients, units, pantry | [`pantry.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/mcp/tools/pantry.ts) | [`ingredients.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/schemas/ingredients.ts), [`pantry.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/schemas/pantry.ts) |
| Recipes and rules | [`recipes.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/mcp/tools/recipes.ts) | [`recipes.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/schemas/recipes.ts), [`rules.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/schemas/rules.ts) |
| Nutrition | [`nutrition.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/mcp/tools/nutrition.ts) | [`nutrition.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/schemas/nutrition.ts) |
| Plans and cooking | [`planning.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/mcp/tools/planning.ts) | [`plans.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/schemas/plans.ts) |
| Shopping | [`shopping.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/mcp/tools/shopping.ts) | [`shopping.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/src/schemas/shopping.ts) |

## Shared rules

- IDs are prefixed strings such as `ing_`, `rcp_`, `plan_`, `ce_`, and `sl_`.
  They are stable. Pass them between calls.
- An ingredient reference has exactly one of `ingredientId`, `ingredient` (an
  existing name or alias), or `fdcId` with optional `name` and `category`. Names
  resolve through canonical names, aliases, and simple plurals. Prefer an ID when
  you have one. `fdcId` uses the household ingredient that already links to that
  USDA food, or creates a linked one. See
  [Ingredient references](rest-api.md#ingredient-references).
- An unknown `ingredient` name never creates an ingredient. It fails with
  `unprocessable`. `details.unresolved` lists each name with up to 5
  `suggestions` and sometimes a `hint`. Shopping item names may instead become
  free text. Do not invent an ID.
- A null quantity is unknown, not zero. Read the stock status as well.
- A unit that the ingredient does not accept, on a recipe line, a pantry write, a
  shopping item, or a stock unit, fails with `unprocessable`. `details.unresolvedUnits`
  lists each unit with `suggestions` and a `hint`. Call `ingredient_measures` with
  `set`, or use a suggested unit, then send the request again. Nothing is written
  by the failed request.
- Every ingredient has one stock unit. Pantry amounts, par levels, and shopping
  amounts are stored in it, and a write in another unit is converted. See
  [Units and measures](../use/units.md).
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
| `ingredient_search` | Find ingredients by name, alias, or category. Returns IDs, stock, aliases, the stock unit, and measures. With `ingredientId` or `ingredient`, returns one ingredient with `usage`: recipes, the pantry row, items on open shopping lists, and dietary rules, plus `review`. | `query`, `category`, `includeArchived`; `ingredientId` or `ingredient` for one ingredient. |
| `find_ingredient` | Search household ingredients and USDA foods together. Read-only. Start here. | `query`; `limit`. Returns `ingredients[]` (with `linked`, `fdcId`, `needsReview`, `score`) and `foods[]` (`fdcId`, `description`, `suggestedName`, `ingredientId` or `null`). |
| `create_custom_ingredient` | Create an ingredient with no USDA food. Last resort: use it only when `find_ingredient` and `search_foods` find nothing. It always sets `needsReview`. | `name`, `category`, `aliases`, `stockUnit`, `parQty`, `parUnit`. |
| `review_ingredients` | List ingredients that need review, accept one, or split one. | `action` `list`, `accept`, or `split`; `ingredientId` or `ingredient`; `main` and `alternatives` (references) for split. |
| `ingredient_upsert` | Create, update, alias, or merge an ingredient. A create needs `fdcId`; use `create_custom_ingredient` for a custom one. | `action` `create`, `update`, `alias`, or `merge`; `ingredientId` or `ingredient`; `name`; `fdcId` for create; `defaultPortion`; `category`; `stockUnit`; `parQty` (in the stock unit); `parUnit` (optional unit of `parQty`); `aliases`; `removeAliases`; `imageUrl` (icon name, `http(s)` link, or `null`; see [Ingredient icons](../use/icons.md)); `intoId` for merge. |
| `list_icons` | List the bundled ingredient icon names that `imageUrl` accepts. Read-only. | `query` (substring filter), `limit` (default 100). |
| `ingredient_measures` | List, set, or delete the weight of one unit of an ingredient, in grams. `list` returns the effective measures: the USDA portions (`source` `usda`, or `usda_estimated` when borrowed from a similar food) replaced by your own (`user`). `set` makes your measure; a new unit such as `handful` is valid for the ingredient from then on. `delete` removes your measure. Mass units (`g`, `kg`, `oz`, `lb`) are fixed. | `action` `list`, `set`, or `delete`; `ingredientId` or `ingredient`; `unit`; `grams` for set; `note`. |

## Pantry and availability

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `pantry_query` | Read current stock. One pantry row, one ingredient's detail, or a filtered list. | `pantryItemId`; or `ingredientId` or `ingredient`; or `category`, `status`, `staleDays`, `query`. |
| `pantry_update` | Apply stock changes or act on one pantry row. | `action` `bulk`, `verify`, or `delete`; `lines[]` for bulk with `op` `set` or `adjust`, an ingredient reference, `qty` or `delta`, `unit`, `qtyApprox`, `reason`; `pantryItemId`. |
| `pantry_history` | Read stock movements, newest first, with the reason and resulting quantity. | `pantryItemId`, `ingredientId` or `ingredient`, `refType`, `refId`, `limit` (maximum 200), `before`. |
| `availability` | Compare stock on hand with demand from planned cooks. Read-only. | `mealPlanId`, `from`, `to`, `includeOptional`. |

`pantry_update` with `action: "bulk"` applies every line atomically. If one line
fails, no line changes. Each line takes an ingredient
reference. No pantry tool creates an ingredient from a name; use `fdcId` in the
line to create a linked one.

## Recipes and rules

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `recipe_search` | Search recipes without loading their steps. | `query`, `status`, `tags[]`, `mealType`, `ingredientId`, `maxTotalMinutes`, `limit`, `offset`. |
| `recipe_get` | Read one recipe by ID or slug, including ingredients, steps with their ingredient links, times, nutrition, notes, cook stats, and cook-event count. | `idOrSlug`; optional `servings` to add a scaled ingredient list. |
| `recipe_save` | Create a recipe or patch an existing one. | `id` to update or omit to create; `title`; `servings`; `ingredients[]` (each with a reference, optional `alternatives[]`, `qty`, `qtyMax`, `unit`, `prepNote`); `steps[]` with optional `links[]` (`ingredientIndex`, `qty`); optional recipe fields such as times, meal types, tags, equipment, nutrition, and notes; `statusNote`. |
| `recipe_set_status` | Move a recipe through its status values and write a history event. | `recipeId` (ID or slug); `status` `want_to_try`, `rotation`, `never`, or `archived`; `rating`; `note`. |
| `recipe_check` | Check a stored recipe or loose ingredient names against dietary rules. | `recipeId` (ID or slug) or `ingredients[]`. |
| `rules_list` | List dietary rules. | `scope`, `severity`, `memberId`. |
| `rules_manage` | Create, update, or delete a dietary rule. | `action` `create`, `update`, or `delete`; `ruleId`; `scope`; `severity`; `ingredientId`, `ingredient`, or `fdcId` with `name`; `recipeId`; or `targetText`; `conditionNote`, `reason`, `memberId`. |

`recipe_save` treats `ingredients` and `steps` as the full list when present.
A step `links` entry uses `ingredientIndex` in the submitted `ingredients` array
(or the stored line order when only `steps` are patched). `qty` is in the linked
line's unit; `null` means the whole line.
`recipe_check` returns `ok: false` only for an unconditional forbidden match.
A violation with a `conditionNote` is a judgement call for the agent.

## Recommended agent flow

1. Call `find_ingredient` for each name.
2. If an ingredient matches, use its `ingredientId`.
3. If only a food matches, send its `fdcId` in the recipe or pantry line.
4. Put extra choices in `alternatives`, cooking notes in `prepNote`, and a size
   in `unit` (for example `large`).
5. Call `create_custom_ingredient` last, and only when no USDA food fits.
6. Call `review_ingredients` with `action: "list"` to find work that needs a
   person's decision.

## Nutrition

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `get_recipe_nutrition` | Read calories, protein, carbs, fat, fiber, sugar, and sodium (mg) for a recipe, whole and per serving. Each ingredient line has a status and its matched USDA food. Read-only. | `idOrSlug`. |
| `search_foods` | Search the bundled USDA foods by name, best match first. Nutrients are for 100 g. Read-only. | `query`; optional `limit` (1 to 50, default 10). |
| `set_ingredient_nutrition` | Choose the USDA food that an ingredient uses. Returns the ingredient with its `nutrition`. | `ingredientId` or `ingredient`; `mode` `auto` or `manual`; `fdcId` for `manual` (a number from `search_foods`, or `null` to clear the match for good). |

Optional lines are not counted. A line with no quantity, no food, or no gram
conversion stays blank. A blank `no_conversion` line has a `hint`; add a measure
with `ingredient_measures` to count it. Check `missingLines` and each line `status` before you
quote a total. The match applies to the ingredient in every recipe. See
[Nutrition](../use/nutrition.md) and the
[REST API](rest-api.md#recipe-nutrition).

## Plans and cooking

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `plan_get` | Read a week plan with cooks, slots, prep tasks, warnings, and status. | `plan`: plan ID, `weekStart` date, or `current` (default). |
| `plan_create` | Create a plan with cooks, slots, and prep tasks in one transaction. | `weekStart`; `title`, `status`, `notes`; `cookEvents[]` with optional `key`; `slots[]` with `cookEventKey` or `cookEventId`; `prepTasks[]`. |
| `plan_set_slots` | Replace slots for one or more date and meal groups. | `planId`; `ops[]` with `date`, `mealType`, and `spec`: one spec, or an array for several dishes at one meal. `spec.kind` is `cook`, `leftover`, `freeform`, `skip`, or `clear`. |
| `plan_swap_meal` | Put a different recipe on one meal slot. | `planId`; `slotId` or `date` and `mealType`; `recipeId` or `recipe`; `scope` `this` or `with_leftovers`. |
| `plan_dishes` | Add a dish to a meal, or remove one dish. | `action` `add` or `remove`; `planId`; for add: `date`, `mealType`, `recipeId` or `recipe`, optional `servings`; for remove: `slotId`. |
| `plan_update` | Change plan fields, or add, update, or delete a cook event. | `action` `update`, `add_cook`, `update_cook`, or `delete_cook`; `planId`; `cookEventId`; `title`, `status`, `notes`; `recipeId` or `recipe`; `cookDate`; `plannedServings`; `actualServings`; `label`; `rating`; `force`. |
| `prep_tasks` | List, add, update, complete, or delete prep tasks. | `action` `list`, `add`, `update`, `complete`, or `delete`; `planId`; `prepTaskId`; `dueDate`; `description`; `cookEventId`; `position`; `from`, `to`, `includeDone`. |
| `cook_complete` | Complete, skip, reopen, or undo a cook. | `action` `complete`, `skip`, `reopen`, or `undo`; `cookEventId`; `actualServings`; `rating`; `notes`; `decrementPantry`; `note` for skip. |
| `cook_history` | Read recent cooks with their recipe, servings, rating, notes, and pantry movements. | `planId`, `from`, `to`, `status`, `recipeId`, `limit`. |

`plan_swap_meal` and `plan_dishes` return `shoppingListStale`. `scope: "this"`
changes only the target meal; `scope: "with_leftovers"` changes the cook and
every slot it feeds. When `shoppingListStale` is `true`, regenerate an open
shopping list for that plan.

A meal can hold several dishes, for example a protein and a side. Each dish has
its own cook. `plan_dishes` with `action: "add"` keeps the other dishes and
replaces a `skip` slot. `action: "remove"` also deletes the dish's planned cook
when no other meal uses it. It cannot remove the cook night of a done or skipped
cook. When a meal has more than one dish, `plan_swap_meal` needs `slotId`.

`cook_complete` with `action: "complete"` decrements pantry stock. `reopen` and
`undo` restore stock.

## Shopping

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `shopping_generate` | Create or refresh a list from plan demand minus stock on hand. | `mealPlanId`; `listId` to refresh an existing list; `title`. |
| `shopping_get` | Read one list with items and counts, or list summaries. | `shoppingListId`; without it, `status` and `mealPlanId`; `includeChecked`. |
| `shopping_update` | Change list fields, items, or check-off state. | `action` `update_list`, `add_items`, `update_item`, `delete_item`, or `check`; `shoppingListId`; `title`, `notes`, `status`; `items[]`; `itemId`; item fields; `checks[]`. |
| `shopping_complete` | Turn checked purchases into pantry movements and close the list. | `shoppingListId`; `received[]`; `onlyChecked`; `recordPurchases`; `completedAt`. |

`shopping_complete` writes stock by default. Set `recordPurchases: false` only
when the pantry already reflects that trip. It also sets each received
ingredient's purchase date and, when the ingredient has a shelf life, its expiry
date.

## Related pages

- [MCP setup](../connect/setup.md)
- [Common tasks](../connect/tasks.md)
- [REST API](rest-api.md)
