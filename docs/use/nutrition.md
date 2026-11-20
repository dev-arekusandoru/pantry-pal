# Nutrition

Each recipe page has a **Nutrition** panel. It shows calories, protein, carbs,
fat, fiber, sugar, and sodium. Rakumi adds up the ingredient lines of the
recipe. It does not guess: a line it cannot calculate stays blank.

![Nutrition panel with calories, a partial count, the ingredient breakdown, and an Add measure button on a blank line](../images/nutrition.png)

## Read the panel

- **Per serving** is the default. **Whole recipe** shows the total for the
  recipe as written. The servings stepper does not change either number.
- Calories are in kcal. Sodium is in mg. The other nutrients are in grams.
- A dash means the data has no value for that nutrient.
- **Partial: 14 of 17 ingredients counted** appears when some lines are blank.
  The totals cover only the counted lines, so the true values are higher.
  Optional ingredients are never counted and are not part of this number.
- **Show ingredient breakdown** opens one row for each ingredient. A row shows
  the grams used, the calories, and the matched USDA food. A line that uses an
  estimated USDA size counts like any other line. Its grams come from a similar
  food. See [Estimated USDA sizes](units.md#estimated-usda-sizes). Tap the ingredient
  name to open its [ingredient page](ingredients.md#the-ingredient-page).

## Why a line is blank

| Row text | Meaning | What to do |
| --- | --- | --- |
| **No matching food** | The ingredient has no USDA food. | Choose a food. See [Change a food match](#change-a-food-match). A custom ingredient has no food by design. |
| **No amount, not counted** | The recipe line has no quantity, such as "salt, to taste". | Nothing. Rakumi does not guess an amount. |
| **Can't convert cup to grams** | The unit has no known gram weight for this ingredient. The row also shows a hint, such as **Add a measure: 1 cup = ? g**. | Tap **Add measure** on the row, enter the weight of one unit in grams, and tap **Save measure**. The line counts at once. See [Add a measure from a blank line](#add-a-measure-from-a-blank-line). |
| **Optional, not counted** | The line is marked optional. | Nothing. |

A quantity range, such as 1–2 cloves, uses the middle of the range.

### Add a measure from a blank line

A line with **Can't convert** has an **Add measure** button. A line with no unit
needs the weight of one piece, so its unit is `count`.

1. Tap **Show ingredient breakdown**.
2. On the blank row, tap **Add measure**. The sheet shows the unit, for example
   **1 count**.
3. In **Weight in grams**, enter the weight of one unit, and tap **Save measure**.

The measure belongs to the ingredient. Every recipe that uses the ingredient
counts the line now. The weight shows as **Yours** under **Measures** on the
[ingredient page](units.md#the-measures-section).

## Change a food match

An ingredient made from a USDA food uses that food. See
[Ingredients](ingredients.md#add-a-usda-food-as-an-ingredient). An older
ingredient can still carry an automatic match by name, and that match can be
wrong. A custom ingredient has no food.

1. Open the recipe and tap **Show ingredient breakdown**.
2. Tap **Change match** on the ingredient. The button reads **Find match** when
   the ingredient has no food.
3. Search by name. Each result shows its calories for 100 g. Tap a food to use it.

The same sheet has two more choices:

- **No match** leaves the ingredient out of the totals. Rakumi does not
  match it again by itself.
- **Auto match** runs the name match again and replaces your choice.

The match belongs to the ingredient, not the recipe. A change applies to every
recipe that uses the ingredient. Renaming an ingredient runs the automatic match
again only when its match is automatic. An ingredient made from a USDA food, a
custom ingredient, and an ingredient whose food you chose keep their setting. A
new name must follow the [naming rules](ingredients.md#naming-rules).

### Say what a plain count means

When the ingredient has a food with portions, the same sheet shows **A plain
count means**. It says which portion one count stands for. For "2" eggs, choose
`large` and each egg weighs the large portion. **Automatic** leaves the choice
to Rakumi. A size unit on the recipe line, such as `large`, uses the portion
of that size. See
[Sizes and default portion](ingredients.md#sizes-and-default-portion).

## Data source

The data comes from [USDA FoodData Central](https://fdc.nal.usda.gov/): SR Legacy
and Foundation Foods. It is public domain (CC0). The data file is part of
Rakumi, so nutrition works offline and sends nothing to USDA. The panel names
the dataset versions.

Values are estimates for raw or standard foods. Brands, cooking losses, and
your own measuring change the real numbers.

A recipe can also store a hand-entered `nutrition` estimate (see
[Import format](../reference/import-format.md)). The panel does not use it.

## Through the API or MCP

An API client or AI assistant can read nutrition and set matches too:

- Read a recipe: `GET /recipes/{idOrSlug}/nutrition` or `get_recipe_nutrition`.
- Search foods: `GET /nutrition/foods` or `search_foods`.
- Set or clear a match, or run the automatic match:
  `PUT /ingredients/{id}/nutrition` or `set_ingredient_nutrition`.

See the [REST API](../reference/rest-api.md#recipe-nutrition) and the
[MCP tool reference](../reference/mcp-tools.md#nutrition).
