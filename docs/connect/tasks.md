# Common MCP tasks

These tasks show the usual tool order. Every tool takes one JSON object. Use the
IDs returned by earlier calls; do not build IDs yourself.

The server does the arithmetic: unit conversion, recipe scaling, plan demand,
availability, and shopping quantities. Send ingredient names, amounts, and
choices. Do not send converted or summed quantities.

For inputs, see [MCP tool reference](../reference/mcp-tools.md). For client
setup, see [MCP setup](setup.md).

## Start with the household

1. Call `household_get` to read the timezone, default servings, spice level,
   batch sizes, week start, unit system, and planning notes.
2. Call `rules_list` to read dietary rules before you choose recipes.

## Plan a week

1. Call `household_get` if you do not already have the settings.
2. Call `recipe_search` with `status: "rotation"` for trusted meals. Try
   `status: "want_to_try"` for new ones.
3. Call `recipe_get` for each candidate. Pass `servings` to get a scaled
   ingredient list.
4. Call `recipe_check` for each recipe. A violation with a condition note is a
   judgement call. Explain the choice to the user.
5. Call `pantry_query` for the ingredients you expect to use, or `availability`
   for an existing plan. An unknown amount means "check the kitchen"; it does
   not mean zero.
6. Call `plan_create` with `weekStart`, cook events, slots, and prep tasks. Give
   each new cook a `key`, then point slots at it with `cookEventKey`. This makes
   one cook feed several later meals as leftovers.
7. For a change after the plan exists, call `plan_swap_meal`. Read the returned
   `shoppingListStale` value and regenerate an open list when it is `true`.

`weekStart` must be the household's week start day. Use `plan_set_slots` to
replace one or more date and meal groups.

## Change pantry stock

Use `pantry_update` with `action: "bulk"` for one or more stock lines. The lines
apply in order and all succeed or all fail.

Recount example:

```json
{
  "action": "bulk",
  "lines": [
    {
      "op": "set",
      "ingredient": "Chicken breast",
      "qty": 2,
      "unit": "lb",
      "location": "fridge",
      "qtyApprox": true,
      "reason": "adjust"
    }
  ]
}
```

Purchase example:

```json
{
  "action": "bulk",
  "lines": [
    {
      "op": "adjust",
      "ingredient": "Chicken breast",
      "delta": 1.5,
      "unit": "lb",
      "location": "fridge",
      "reason": "purchase"
    }
  ]
}
```

Use `op: "set"` for a recount. Use `op: "adjust"` for a known change, such as a
purchase or waste. To mark a row as checked, call `pantry_update` with
`action: "verify"` and the pantry row ID.

## Record a cook

1. Find the cook event with `plan_get` or `cook_history`.
2. Call `cook_complete` with `action: "complete"`, the cook event ID, actual
   servings, and a rating. By default, this writes the pantry movements for the
   scaled ingredients.
3. Do not also call `pantry_update` for the same ingredients.

Use `action: "skip"` when a planned cook did not happen. Use `action: "reopen"`
to return a completed cook to planned and restore stock. Use `action: "undo"` to
reverse a completed cook; this also deletes an ad-hoc cook that no plan
references.

Check the result with `pantry_history` and `refType: "cook_event"`.

## Shop from a plan

1. Call `shopping_generate` with the meal plan ID.
2. Call `shopping_get` with the shopping list ID to review items and quantities.
3. Change the list with `shopping_update`: add items, edit items, or check items
   off with `action: "check"`.
4. When the trip is done, call `shopping_complete`. Checked items become pantry
   purchase movements.

If the plan changed after the list was generated, call `shopping_generate`
again. `clear_items` removes the list items but does not change the pantry.

## Add a recipe

1. Call `ingredient_search` for each ingredient. Reuse existing ingredients.
2. Call `ingredient_upsert` with `action: "create"` for a genuinely new
   ingredient.
3. Call `recipe_save` with `title`, `servings`, the ingredient lines, and the
   ordered steps.
4. Call `unit_conversions` with `action: "create"` when a package unit such as
   `can` must compare to a pantry unit.
5. Call `recipe_check`, then `recipe_set_status` with `want_to_try` or
   `rotation`.

`recipe_save` creates unknown ingredient names. Search first to avoid near
duplicates. Pass `statusNote` to record why a status or rating changed.

## Safety on writes

Some tools that can delete or overwrite data have a destructive annotation.
Read tools have a read-only annotation. Check annotations with `tools/list`.

- Confirm destructive actions with the user first. This includes delete, merge,
  `clear_items`, `undo`, and deleting a cook or plan.
- A timeout does not tell you whether a write reached the server. Read the
  current state or history before you retry. Repeating an `adjust` line doubles
  the change; a `set` line is safer for a recount.
- Do not decrement stock after `cook_complete` or add stock after
  `shopping_complete`; those tools already write the movements.
- Do not edit stock to hide a wrong cook or shopping record. Use `reopen`,
  `undo`, or a correcting movement with a clear `reason`.
- Unknown ingredient names fail with `unprocessable` unless the action creates
  ingredients. Use `ingredient_search` first.
- `qty: null` means an unknown amount, not zero. Read the stock status as well.
- Keep movement `reason` values accurate: `purchase`, `cook`, `waste`, `adjust`,
  `verify`, or `import`.

Tool errors return the same error body as the REST API:
`{"error": {"code", "message", "details?"}}`. Use the code, not the message
text, to decide what to do.
