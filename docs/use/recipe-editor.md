# Create and edit recipes

The recipe editor writes a recipe, its ingredient lines, and its steps. It is
the only place where you change tags.

## Open the editor

- **New recipe**: on the Recipes tab, tap **New recipe**.
- **Edit recipe**: on a recipe page, tap **Edit recipe**.

The editor keeps the recipe status. To change the status, use the recipe page.
The recipe page shows tags but does not change them.

## Fill in the fields

| Field | Notes |
| --- | --- |
| **Title** | Required. |
| **Servings** | The yield the ingredient amounts are written for. |
| **Prep minutes** | Optional. |
| **Cook minutes** | Optional. |
| **Total minutes** | Optional. If you leave it empty, the server adds prep and cook. |
| **Meal types** | Breakfast, lunch, dinner, snack, dessert. |
| **Tags** | Tap **Add tag**. The input suggests tags that other recipes use. Tap `×` to remove a tag. |
| **Equipment** | A comma-separated list. |
| **Notes** | Free text. |
| **Source name**, **Source URL** | Where the recipe came from. |

## Add ingredient lines

Use **Add line** to add a line. Each line has:

- **Ingredient**: a search box. Choose an ingredient from **Your ingredients**
  or **USDA foods**, or add one with **Create custom…**. The editor does not
  make an ingredient from a typed name. See
  [Ingredients](ingredients.md#choose-an-ingredient). A line with no ingredient
  cannot save: the editor says **Pick an ingredient for line N.**
- **Add alternative**: after you choose an ingredient, add stand-ins with the
  same search box. The recipe page shows them as **Milk (or Water)**. Tap `×` to
  remove one. See [Alternatives](ingredients.md#alternatives).
- **Qty** and **Max qty**: a range uses both, for example 1 to 2 heads.
- **Unit**: for example `cup`, `tbsp`, `g`. The server normalizes the unit. The
  field suggests the sizes `small`, `medium`, `large`, `extra-large`, and
  `jumbo`. For "2 large eggs", enter Qty `2` and Unit `large`. See
  [Sizes and default portion](ingredients.md#sizes-and-default-portion).
- **Prep note**: for example `diced`.
- **Group**: a section header such as `Sauce`.
- **Optional**: the pantry check and the cook deduction ignore the line.
- **Does not scale**: the amount stays the same when servings change.

Use the arrows to reorder a line. Use the trash button to remove it.

## Add steps and step ingredients

Use **Add step** to add a step. Write the instruction and an optional duration
and group. Instruction fields grow to five lines; longer text scrolls within
the field.

To link an ingredient to a step:

1. Use the **Add ingredient to step** menu. It lists the lines that this step
   does not use yet.
2. Select a line.
3. In the new link row, type the amount this step uses, in the line's unit.
   Leave it empty to use the whole line.

The unit always comes from the ingredient line. A link has no unit of its own.

If the step amounts for one line do not add up to the line amount, the editor
shows a warning. The warning does not block saving.

## Save

Tap **Save recipe**. The app creates the recipe, or saves your changes, and opens
the recipe page.

## Step ingredient pills in cook mode

In cook mode, a step shows its linked ingredients as pills below the
instruction. A pill has:

- The ingredient name.
- The amount for the chosen servings, in the line's unit.
- The prep note.

A link with no amount uses the scaled amount of the whole line. A
scaling-exempt line keeps its written amount.

## Delete or archive

Use the action under the status control on the recipe page:

- **Delete recipe** shows when the recipe has no cook events. Confirm to remove
  the recipe.
- **Archive recipe** shows when the recipe has cook events. It sets the status
  to `archived` and keeps the cook history.

## Through the API, MCP, or an import

The API and MCP accept the same shape:

```jsonc
{
  "ingredients": [
    { "ingredientId": "ing_carrot", "qty": 4, "unit": "each" },
    { "ingredient": "Salt", "qty": 1, "unit": "tsp", "scalingExempt": true },
    { "fdcId": 171265, "name": "Milk", "qty": 1, "unit": "cup",
      "alternatives": [{ "ingredient": "Water" }] },
    { "ingredient": "Egg", "qty": 2, "unit": "large" }
  ],
  "steps": [
    { "text": "Cook the carrots.", "links": [{ "ingredientIndex": 0, "qty": 3 }] },
    { "text": "Season.", "links": [{ "ingredientIndex": 1, "qty": null }] }
  ]
}
```

- `ingredientIndex` is the zero-based position in the submitted `ingredients`
  array. When a patch sends only `steps`, the index uses the stored line order.
- `qty` uses the unit of the linked line. `null` means the whole line.
- The server rejects a link that does not point to a line of the same recipe.
- Replacing `ingredients` without `steps` removes the step links.

Read a recipe with `GET /recipes/{idOrSlug}` or `recipe_get`. Each line returns
`alternatives` with `ingredientId` and `name`. Each step returns `links` with
`ingredientName`, `qty`, `unit`, and `prepNote`.

A line must name an ingredient that exists, or a USDA food. A bare unknown name
returns `unprocessable` (422) with suggestions, and the recipe is not saved. See
[Ingredients](ingredients.md#through-the-api-or-mcp).

See the [REST API](../reference/rest-api.md), the
[MCP tool reference](../reference/mcp-tools.md), and
[Import format](../reference/import-format.md).
