# Import format

This format holds a household snapshot. The example plan starts on **2026-02-02**.
Household names, stock, and dates are sample data. After import, the database
holds the current state. This file is not a sync or backup format.

See [Data import](import.md) for commands and safety checks.

## Ground rules

- **References use names or keys, not database IDs.** Ingredient references use
  `name` from `ingredients[]`; names are normalized before lookup. Recipes use
  `key`, which becomes `recipe.slug`. Cook-event keys are unique within a plan.
- **Field names mirror `src/db/schema.ts` columns in camelCase** (`weekStart`, `plannedServings`,
  `prepMinutes`, `qtyApprox`, `scalingExempt`, …). Fields that only exist in the seed
  (`key`, `household.members`, `plan` on a shopping list) are marked below.
- **Dates are `YYYY-MM-DD`**; timestamps are ISO-8601 UTC strings. Quantities are JSON numbers or
  `null` (unknown amount, e.g. "to taste" / "on hand").
- **Units are already normalized** to the names accepted by `normalizeUnit()`:
  `lb, oz, g, kg, ml, l, cup, tbsp, tsp, fl_oz, pint, quart, gallon, count` and the package/count
  units `can, jar, bag, bunch, head, clove, sprig, stalk, package, bottle, box, slice, piece`.
  The loader still runs `normalizeUnit()` on every unit and aborts on an unknown one.
- **Enums match `schema.ts` exactly**; see [Enumerations](#enumerations). The loader validates every
  enum value and aborts with `AppError("validation", …)` before writing anything.
- **Every ingredient used anywhere in the file is declared in `ingredients[]`**: recipe lines,
  pantry rows, shopping items, unit conversions, and ingredient-scoped rules. Unresolved names are a
  hard error (`{ unresolved: [names] }`), because the seed must not silently create shadow
  ingredients.

## Shape

```jsonc
{
  "household": { … },
  "ingredients": [ … ],
  "unitConversions": [ … ],
  "pantry": [ … ],
  "rules": [ … ],
  "recipes": [ … ],
  "plans": [ … ],
  "shoppingLists": [ … ]
}
```

All eight top-level keys are required; the arrays may be empty but are not omitted.

### `household` (required, object)

| Field | Type | Notes |
|---|---|---|
| `name` | string | `household.name`. |
| `timezone` | string | IANA zone, `household.timezone`. |
| `settings` | `HouseholdSettings` | Stored as `household.settings` JSON; all fields required. |
| `settings.defaultServings` | number | Default servings when a recipe is planned without one. |
| `settings.spiceLevel` | enum `spiceLevel` | Household heat tolerance. Mild here, so heat is added after cooking. |
| `settings.lunchBatchServings` | number | Batch-cooked lunch size (6 = 2 people × 3 days). |
| `settings.dinnerServings` | number | Dinner cook size (4 = cook once, eat twice). |
| `settings.weekStartsOn` | number | 1 = Monday (ISO). |
| `settings.unitSystem` | `"us" \| "metric"` | Display preference. |
| `settings.planningNotes` | string \| null | Free-form planning guidance for agents. |
| `members` | array | Created in order as `household_member` rows. |
| `members[].name` | string | Member display name. |
| `members[].notes` | string \| null | Free-text dietary notes; structured bans live in `rules`. |

### `ingredients[]` (required)

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Canonical display name; must be unique (case-insensitive). Referenced everywhere else by this string. |
| `category` | enum `ingredientCategory` | yes | |
| `defaultUnit` | unit \| null | yes | Used for stock/shopping when nothing else is specified. |
| `defaultLocation` | enum `storageLocation` | yes | |
| `isStaple` | boolean | yes | Expected to always be stocked. |
| `aliases` | string[] | yes | May be `[]`. Lowercased by the loader; must not collide with any alias or ingredient name. Each becomes an `ingredient_alias` row. |
| `description` | string | no | Optional prose description. |
| `shelfLifeDays` | integer | no | Typical shelf life once purchased. |
| `parQty` | number | no | Desired minimum stock. **Unset in this seed** so imported quantities cannot flip a row to `low`. |
| `parUnit` | unit | no | Unit for `parQty`. |

### `unitConversions[]` (required)

| Field | Type | Notes |
|---|---|---|
| `ingredient` | string \| null | Ingredient name, or `null`/omitted for a household-global conversion. |
| `fromUnit` | unit | |
| `toUnit` | unit | |
| `factor` | number | `1 fromUnit = factor toUnit`, stored as `unit_conversion.factor`. May be fractional. Must be `> 0`. |
| `note` | string \| null | Human explanation ("one 14.5 oz can"). |

Unique per `(ingredient, fromUnit, toUnit)`. The service already handles the inverse direction, so
only one direction is seeded. These rows are what make recipe units comparable to pantry units, e.g.
`can → oz` for canned tomatoes, `count → lb` for chicken breast, `head → clove` for garlic,
`head → cup` for broccoli, `clove → tsp` for minced garlic, `bunch → sprig` for dill.

### `pantry[]` (required)

One row per `(ingredient, location)`; the pair must be unique.

| Field | Type | Notes |
|---|---|---|
| `ingredient` | string | Declared ingredient name. |
| `location` | enum `storageLocation` | `pantry`, `fridge`, `freezer`, `counter`, `other`. |
| `qty` | number \| null | Unknown when `null`. Read `status` as well. |
| `unit` | unit \| null | Required when `qty` is non-null; `null` with `qty: null`. |
| `qtyApprox` | boolean | True for parsed estimates (`~2.5 lb`, `~10 cloves`). |
| `status` | enum `pantryStatus` | Expected status after import. This seed uses `on_hand` everywhere. |
| `rawText` | string | Free-text snapshot line, stored verbatim for provenance. |
| `note` | string \| null | Parsing/context note ("staple; amount not tracked"). |

### `rules[]` (required)

| Field | Type | Notes |
|---|---|---|
| `scope` | enum `ruleScope` | `ingredient`, `category`, `recipe`, `tag`, `keyword`. |
| `ingredient` | string | Required for `scope: "ingredient"`; must resolve. |
| `recipe` | string | Required for `scope: "recipe"`; recipe `key`. |
| `targetText` | string | Category name, tag, or keyword text. Keyword checks match whole words and ignore case. |
| `severity` | enum `ruleSeverity` | `forbidden`, `avoid`, `limit`. |
| `conditionNote` | string | Optional judgment call the agent must apply. |
| `reason` | string | Why the rule exists. |

Rules are household-wide (`memberId` null) in this seed.

### `recipes[]` (required)

Top-level recipe fields:

| Field | Type | Notes |
|---|---|---|
| `key` | string | Seed identity; written to `recipe.slug`. Unique, URL-safe. |
| `title` | string | |
| `description` | string \| null | |
| `sourceUrl` | string \| null | `null` for authored recipes. |
| `sourceName` | string \| null | Site/blog name. |
| `author` | string \| null | |
| `imageUrl` | string \| null | Hero image. |
| `servings` | number | Yield the ingredient quantities are written for. **Plan scaling is separate** (`plannedServings` may differ). |
| `yieldText` | string \| null | Human yield ("8 servings (about 12 cups)"). |
| `prepMinutes` | integer \| null | |
| `cookMinutes` | integer \| null | |
| `totalMinutes` | integer \| null | Includes passive time when the source does. |
| `spiceLevel` | enum `spiceLevel` \| null | Dish heat, not household preference. |
| `cuisine` | string \| null | |
| `mealTypes` | enum `mealType`[] | At least one. |
| `tags` | string[] | |
| `equipment` | string[] | |
| `nutrition` | object \| null | `{ calories?, proteinG?, carbsG?, fatG?, fiberG?, sugarG?, sodiumMg? }`, all numbers. |
| `storageNotes` | string \| null | Reheat/storage guidance. |
| `leftoverDays` | integer \| null | Days leftovers keep in the fridge. |
| `status` | enum `recipeStatus` | All recipes here are `want_to_try`. |
| `rating` | integer (1–5) \| null | |
| `notes` | string \| null | Household adaptations, source caveats, "ingredients reconstructed" flags. |
| `ingredients` | array | Ordered; loader sets `position` from array order. |
| `steps` | array | Ordered; loader sets `position` from array order. |

`ingredients[]` entries (written to `recipe_ingredient`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `ingredient` | string | yes | Must resolve to a declared ingredient. |
| `qty` | number \| null | yes | `null` = "to taste"/unmeasured. |
| `qtyMax` | number | no | Upper bound for ranges; `qty ≤ qtyMax`. |
| `unit` | unit \| null | yes | `null` iff `qty` is null. |
| `prepNote` | string \| null | yes (may be null) | "large, diced", "drained". |
| `originalText` | string | yes | Original recipe line, kept for fidelity. |
| `optional` | boolean | no (default `false`) | |
| `scalingExempt` | boolean | no (default `false`) | Salt/spices/to-taste items. |
| `groupLabel` | string | no | Section header ("Sauce", "For the Salmon"). |

`steps[]` entries (written to `recipe_step`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string | yes | Full instruction. |
| `groupLabel` | string | no | Section header. |
| `durationMinutes` | integer | no | Timer hint. |

### `plans[]` (required)

| Field | Type | Notes |
|---|---|---|
| `weekStart` | date | First day of the plan week; follows household settings. Unique per household. |
| `title` | string \| null | |
| `status` | enum `planStatus` | `active` here. |
| `notes` | string \| null | |
| `cookEvents` | array | Created before slots/prep tasks so references resolve. |
| `slots` | array | |
| `prepTasks` | array | |

`cookEvents[]`:

| Field | Type | Notes |
|---|---|---|
| `key` | string | Unique **within the plan**; referenced by `slots[].cookEvent` and `prepTasks[].cookEvent`. |
| `recipe` | string | Recipe `key`. |
| `cookDate` | date | May fall outside the plan week (Sun Feb 1 for the Feb 2 week; overnight oats are dated the evening before the breakfast). |
| `plannedServings` | number | May differ from `recipe.servings`; services scale. |
| `label` | string \| null | "Batch A - lunch (Mon-Wed)". |
| `status` | enum `cookStatus` | All `planned`; nothing has been cooked yet. |

`slots[]`:

| Field | Type | Notes |
|---|---|---|
| `date` | date | |
| `mealType` | enum `mealType` | |
| `kind` | enum `slotKind` | `meal` for a planned meal, `freeform` for "Leftovers / …". |
| `cookEvent` | string | Required iff `kind == "meal"`; forbidden for `freeform`/`skip`. Slots dated after the cook are leftovers — no separate leftover kind. |
| `servings` | number | Servings eaten in this slot (omitted/`null` for freeform). |
| `label` | string \| null | Display text for freeform slots. |
| `notes` | string \| null | "Leftovers from Monday." |

`prepTasks[]`:

| Field | Type | Notes |
|---|---|---|
| `dueDate` | date | |
| `description` | string | |
| `cookEvent` | string | Optional link; omitted when the task is not tied to a specific cook event. |

### `shoppingLists[]` (required)

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `plan` | date \| null | `weekStart` of the owning plan; resolves to `meal_plan_id`. |
| `status` | enum `shoppingListStatus` | `done` here. |
| `completedAt` | ISO timestamp \| null | Set on the list. |
| `notes` | string \| null | Provenance notes. |
| `items` | array | Ordered; loader sets `position`. |

`items[]`:

| Field | Type | Notes |
|---|---|---|
| `ingredient` | string | Linked item: resolves to an ingredient id. |
| `name` | string | Free-text item when `ingredient` is absent; defaults to the ingredient name. |
| `category` | enum `ingredientCategory` | Aisle grouping; defaults to the ingredient category. |
| `qty` | number \| null | |
| `unit` | unit \| null | |
| `purposeNote` | string \| null | "chili 2 lb + beef & broccoli 1 lb". |
| `checked` | boolean | `true` → `checkedAt = list.completedAt`, `actualQty/actualUnit` default to `qty/unit`. |
| `note` | string \| null | |

## Loader semantics

### Validation and writes

The CLI checks the JSON and schema before it creates a household.
The loader then checks existing data and resolves references.

Food data, household settings, and members load in one transaction through the
service layer. A failed load rolls back that transaction. A household created
by the CLI before the load can remain.

The load refuses a household that has ingredients or recipes. `--force` skips
that guard; it does not replace or merge data.

Ingredients load before recipes. Recipes load before rules and plans.
Shopping lists load last.

### Pantry history

Each pantry row produces exactly **one** `stock_movement`:
`kind = "set"`, `reason = "import"`, `refType = "seed"`, `refId = null`, quantity/unit from the row
(`null` allowed), note from the row. This is a snapshot import, not purchasing history; do not
fabricate purchase movements.

### Shopping lists

The single list is historical (`status: "done"`, `completedAt` set) and was bought on 2026-02-01
*after* the pantry was counted. The pantry snapshot in `pantry[]` **already includes these
purchases**, so the loader:

- creates the list and items with `source: "manual"`;
- sets `checkedAt = completedAt`, `actualQty = qty`, `actualUnit = unit` for `checked: true`;
- **does not** create purchase movements and does not adjust stock. Re-running purchase math would
  double-count everything.

The "Already on hand" section and the "Salt, black pepper — on hand" line are intentionally absent
from the items (nothing was bought), and the two summary pantry lines ("Common spices", "Tomatoes")
are absent from `pantry[]`.

### Timestamps and ids

`createdAt`/`updatedAt` come from `ctx.now()` (or DB default) during import; `completedAt` comes
from JSON. Ids are generated by `newId(prefix)` using the prefixes in the contract
(`hh, mem, ing, ali, uc, mv, rcp, ri, rs, rse, rule, plan, ce, slot, prep, sl, sli`). The seed does
not encode timestamps for individual rows.

## Notes on this example seed

- Identity fields are synthetic: household `Example Household`, members `Robin` and `Sam`, timezone
  `UTC`, and the week starting 2026-02-02. Stock levels and pantry notes are randomized; they are
  plausible but not derived from any real household.
- `rawText` is regenerated as `<ingredient> | <qty> <unit> | <category|staple> | 2026-02-01`, or
  `<ingredient> | on hand | …` for unknown amounts. It is provenance text, not parsed by the loader.
- `on hand` → `qty: null, unit: null, status: "on_hand"`; every pantry row is `on_hand` because no
  row sets `parQty`.
- Location rule: raw proteins, dairy, and refrigerated produce → `fridge`; onions, garlic, potatoes,
  and shelf-stable goods → `pantry`.
- Recipes: the lunch/dinner recipes are public blog recipes transcribed with their ingredients,
  steps, times, servings, image and nutrition. Breakfasts are authored (no source URL). Plan-level
  adaptations live in each recipe's `notes`, not in the ingredient quantities.
- Rules encode the household preferences (mushrooms; pork/bacon/sausage/ham/prosciutto/pancetta;
  seafood except tuna/salmon; mayonnaise only in a minor role; beef only as ground beef). "Keep it
  mild" is a household setting (`spiceLevel: "mild"`), not a rule.
- All planned meals are `cook_status = planned`; no cook event has happened yet.
- Recipe and shopping quantities describe the example plan's math; pantry stock is deliberately
  independent of them.

## Contents of this seed

| Section | Count |
|---|---|
| household members | 2 |
| ingredients | 65 |
| unit conversions | 16 |
| pantry rows | 46 |
| rules | 11 |
| recipes | 8 (5 sourced + 3 authored breakfasts) |
| plans | 1 (week 2026-02-02, 12 cook events, 21 slots, 7 prep tasks) |
| shopping lists | 1 (33 done items) |

## Enumerations

Copied from `src/db/schema.ts` for quick reference; the schema is the source of truth.

- `ingredientCategory`: produce, protein, dairy, bakery, pantry, baking, spice, canned, condiment,
  frozen, beverage, other
- `storageLocation`: pantry, fridge, freezer, counter, other
- `pantryStatus`: on_hand, low, out, unknown
- `movementKind`: set, delta
- `movementReason`: purchase, cook, waste, adjust, import, verify
- `movementRefType`: cook_event, shopping_list, manual, seed
- `recipeStatus`: want_to_try, rotation, never, archived
- `mealType`: breakfast, lunch, dinner, snack, dessert
- `spiceLevel`: none, mild, medium, hot
- `ruleScope`: ingredient, category, recipe, tag, keyword
- `ruleSeverity`: forbidden, avoid, limit
- `planStatus`: draft, active, archived
- `cookStatus`: planned, done, skipped
- `slotKind`: meal, freeform, skip
- `shoppingListStatus`: draft, shopping, done
- `shoppingItemSource`: generated, manual
