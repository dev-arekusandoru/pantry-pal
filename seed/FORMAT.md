# PantryPal seed format (`seed/chef-2026-11.json`)

One-time curated import of the household's food state as it existed on **2026-11-01**, distilled from
`original chef docs/` plus the five recipe pages linked from `meal-plan.md`. The database becomes
authoritative after the import; this file is not a sync format.

The loader (`cli seed`, milestone 6) reads this JSON and applies it **through the service layer**
(`households`, `ingredients`, `pantry`, `rules`, `recipes`, `plans`, `shopping`), not with raw SQL.
Anything the services would reject is a bug in the seed, not something to force in.

## Ground rules

- **References are names/keys, never database ids.** Ingredients are referenced by their exact
  `name` (the same string declared in `ingredients[]`, case-sensitive). Recipes are referenced by
  `key` (the slug written to `recipe.slug`). Cook events are referenced by `key`, which is unique
  within its plan.
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
| `qty` | number \| null | `null` = present but amount unknown ("on hand"). |
| `unit` | unit \| null | Required when `qty` is non-null; `null` with `qty: null`. |
| `qtyApprox` | boolean | True for parsed estimates (`~2.5 lb`, `~10 cloves`). |
| `status` | enum `pantryStatus` | Expected status after import. This seed uses `on_hand` everywhere. |
| `rawText` | string | Original pantry.md line, verbatim (load-bearing for provenance). |
| `note` | string \| null | Parsing/context note ("allocation parenthetical dropped", "small jar"). |

### `rules[]` (required)

| Field | Type | Notes |
|---|---|---|
| `scope` | enum `ruleScope` | `ingredient`, `category`, `recipe`, `tag`, `keyword`. |
| `ingredient` | string | Required for `scope: "ingredient"`; must resolve. |
| `recipe` | string | Required for `scope: "recipe"`; recipe `key`. |
| `targetText` | string | Required for `category` (category name), `tag`, and `keyword` (case-insensitive substring). |
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
| `weekStart` | date | First day of the plan week (Monday); unique per household. |
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
| `cookDate` | date | May fall outside the plan week (Sun Nov 1 for the Nov 2 week; overnight oats are dated the evening before the breakfast). |
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

### Validation (before any write)

1. Parse JSON; validate all enums, unit names, date formats, positive numbers, and unique keys
   (ingredient names, recipe `key`, `(ingredient, location)`, per-plan cook-event `key`).
2. Resolve every ingredient reference (recipes, pantry, shopping items, conversions,
   ingredient-scoped rules) against `ingredients[]`; every recipe/cook-event reference by key.
   Abort with `AppError("validation", …, { unresolved })` if anything is missing.
3. Refuse to run against a household that already has data (seed is a one-time import). Use a
   separate `seed` subcommand, not an upsert.

### Create order

All steps run inside one synchronous `ctx.db.transaction`:

1. **Household** — insert `household` with `settings` and `members` (ids `hh_…`, `mem_…`).
2. **Ingredients + aliases** — insert in array order (`ing_…`); then one alias row (`ali_…`) per
   alias. Normalize names/aliases the same way the service does (`normalizedName`).
3. **Unit conversions** — after ingredients exist (`uc_…`); `ingredient: null` → global row.
4. **Pantry** — for each row call `applyMovement(ctx, { ingredientId, location, kind: "set",
   qty, unit, reason: "import", refType: "seed", refId: null, note })`. The service upserts the
   `pantry_item`, copies `rawText` (loader writes it on the item) and `note`, keeps `qtyApprox`,
   writes the `stock_movement` (`mv_…`, `qtyAfter`, `statusAfter`) and recomputes status. Because
   no row sets `parQty`, `qty > 0` → `on_hand`, `qty = 0` → `out`, `qty = null` → `on_hand`
   per the "unknown amount" rule. Repeat the row's `status` afterward only as an assertion; a
   mismatch is a seed bug.
5. **Rules** — after ingredients and recipes exist (`rule_…`), so ingredient/recipe scopes resolve.
6. **Recipes** — insert `recipe` (`rcp_…`), then its `recipe_ingredient` (`ri_…`) and
   `recipe_step` (`rs_…`) rows with positions from array order. Also insert one
   `recipe_status_event` (`rse_…`) carrying the recipe's `status`, note
   `"Seeded from chef-2026-11.json"`. Recipes before plans because cook events reference them.
7. **Plans** — insert `meal_plan` (`plan_…`); then `cook_event` rows (`ce_…`, status from JSON);
   then `meal_slot` (`slot_…`, resolving cook-event keys); then `prep_task` (`prep_…`).
8. **Shopping lists** — insert `shopping_list` (`sl_…`, resolve `plan` to the meal plan) and
   `shopping_list_item` (`sli_…`) rows in array order.

### Pantry history

Each pantry row produces exactly **one** `stock_movement`:
`kind = "set"`, `reason = "import"`, `refType = "seed"`, `refId = null`, quantity/unit from the row
(`null` allowed), note from the row. This is a snapshot import, not purchasing history; do not
fabricate purchase movements.

### Shopping lists

The single list is historical (`status: "done"`, `completedAt` set) and was bought on 2026-11-01
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

## Mapping notes baked into this seed

- Pantry **allocation parentheticals** ("(chili 2 + beef & broccoli 1)") are dropped from `qty`;
  commitments are computed by the services. The original line is preserved in `rawText`.
- `~2.5 lb` → `qty: 2.5, qtyApprox: true`; `1–2 heads (~10 cloves)` → `10 clove,
  qtyApprox: true`; `4 x 6 oz (1.5 lb)` → `4 count` plus `count → oz` and `count → lb`
  conversions; `2 (14.5 oz) cans` → `2 can` plus a `can → oz` conversion.
- `on hand` → `qty: null, unit: null, status: "on_hand"`.
- "Salt, black pepper" is split into two pantry rows.
- Pantry "notes" column drives the ingredient category/staple flag: `staple` → pantry/condiment with
  `isStaple: true`, `baking` → `baking`, `spice` → `spice`, plus the obvious `protein`, `produce`,
  `dairy`, `canned` mappings.
- Location rule: raw proteins, dairy, and produce that needs refrigeration → `fridge`; onions,
  garlic, potatoes, and shelf-stable goods → `pantry`.
- Recipes: the five linked lunch/dinner pages are transcribed with their real ingredients, steps,
  times, servings, image, and nutrition. Plan-level adaptations (mild tomatoes, side red pepper
  flakes) live in `notes`, not in the ingredient quantities. Breakfasts were authored for this
  household (no source URL). Any reconstruction is flagged in the recipe's `notes` with
  `"Ingredients reconstructed; verify against source"`.
- Rules encode the never-use list (mushrooms; pork/bacon/sausage/ham/prosciutto/pancetta; seafood
  except tuna/salmon; mayonnaise only in a minor role; beef only as ground beef; no pot roast).
  "Keep it mild" is a household setting (`spiceLevel: "mild"`), not a rule.
- All planned meals are `cook_status = planned`; no cook event has happened yet.

## Contents of this seed

| Section | Count |
|---|---|
| household members | 2 |
| ingredients | 65 |
| unit conversions | 16 |
| pantry rows | 46 |
| rules | 11 |
| recipes | 8 (5 sourced + 3 authored breakfasts) |
| plans | 1 (week 2026-11-02, 12 cook events, 21 slots, 7 prep tasks) |
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
