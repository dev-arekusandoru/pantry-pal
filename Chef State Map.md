# Chef Bot — State Map (for a real backend)

Source of truth today: 6 markdown files in `bots/cmvwy656govvvid93ovjowtyc/`
(pantry.md, shopping-list.md, meal-plan.md, rotation.md, want-to-try.md, never-use.md)
plus Chef's instructions describing the weekly workflow. No database, no IDs, no history.

This doc: what state actually exists, how it maps to tables, the tricky parts, and a
proposed MCP tool surface.

---

## 1. What the six files really hold

| File | Holds | Implicit structure |
|---|---|---|
| `pantry.md` | Current stock, grouped in 7 headings (Staples, Spices, Proteins, Produce, Dairy, Canned/jarred, Tomatoes) | `item \| qty \| note \| updated`. Free-text quantities, per-line updated date |
| `shopping-list.md` | One list per plan week, items with qty + "why" + ✅ purchased | Global `PURCHASED` flag in header; item state is the emoji |
| `meal-plan.md` | One week: household assumptions, 7×3 grid, batch/dinner recipe list w/ URLs, breakfast rotation, cook/prep schedule, rules/notes | Markdown table; slots reference recipe names or "leftover" |
| `rotation.md` | Liked recipes | `name \| servings \| notes \| link` (empty) |
| `want-to-try.md` | Candidate recipes not yet tried | `name \| source \| notes \| status` (empty) |
| `never-use.md` | Banned/limited ingredients + banned recipes | Two lists; some entries are conditional ("mayo unless minor role", "seafood except tuna/salmon") |

Everything else (spice level, no pork/mushrooms, beef only ground, 2 people, batch sizes,
"cook once, eat leftovers next day") lives in prose in `meal-plan.md` and Chef's
instructions — i.e. undocumented business rules, not data.

---

## 2. Entities

```
household ──< household_member
    │
    ├──< dietary_rule            (never-use, as rules with severity + scope)
    │
    ├──< ingredient ──< ingredient_alias
    │        │
    │        └──< pantry_item ──< stock_movement     (ledger)
    │                    │
    │                    └──< pantry_reservation     (committed to a planned meal)
    │
    ├──< recipe ──< recipe_ingredient >── ingredient
    │       │
    │       └──< recipe_status / rating history
    │
    ├──< meal_plan ──< meal_slot
    │        │             ├── recipe_id            (cook this)
    │        │             └── source_slot_id       (leftover of a prior cook)
    │        │
    │        ├──< cook_event ──< cook_event_ingredient
    │        ├──< prep_task
    │        └──< shopping_list ──< shopping_list_item >── ingredient
    │
    └──< unit_conversion        (oz/lb/cup/count/clove/head/can)
```

### Table sketch

**household** — id, name, default_servings, created_at
**household_member** — id, household_id, name, notes

**ingredient** — id, household_id, canonical_name, category (produce/protein/dairy/pantry/spice/canned/frozen/other), default_unit, is_staple, par_qty, par_unit, notes, is_archived
**ingredient_alias** — id, ingredient_id, alias (plural forms, "yellow onions" → onion)

**unit_conversion** — id, ingredient_id (nullable = global), from_unit, to_unit, factor, note (e.g. 1 can diced tomatoes = 14.5 oz). Needed because pantry mixes lb / oz / cups / counts / heads / cans.
Convenience: store `quantity numeric` + `unit text` and never force normalization; convert only when comparing.

**pantry_item** — id, household_id, ingredient_id, qty, unit, optional count_qty, location (fridge/freezer/pantry), status (on_hand / low / out / unknown), last_verified_at, note
Unique on (household_id, ingredient_id, unit, location) — or one row per ingredient if you don't want lots.
`status = unknown` matters: today's data says "on hand" with no number for ~20 items.

**stock_movement** (append-only ledger; the actual inventory truth) — id, pantry_item_id, delta_qty, unit, reason (purchase / cook / waste / adjust / restock), ref_type (cook_event | shopping_list | manual), ref_id, created_at
`pantry_item.qty` is then a cached sum. This gives you history, consumption-per-recipe, and "why is this here" — all impossible today.

**pantry_reservation** — id, pantry_item_id, meal_plan_id, cook_event_id, qty, unit, created_at
Needed because today's pantry lines already encode commitments: `Ground beef 3 lb (chili 2 + beef & broccoli 1)`. Stock and allocation are conflated; split them.

**recipe** — id, household_id, title, source_url, servings, prep_minutes, cook_minutes, instructions (optional text/json), image_url, spice_level, tags (quick, slow-cooker, sheet-pan…), notes, created_at
**recipe_ingredient** — id, recipe_id, ingredient_id, qty, unit, prep_note ("1 large, diced"), optional (bool), scaling_exempt (salt/spices), group_label (for marinade vs sauce)
**recipe_status** — recipe as a state machine: `want_to_try → rotation | never`, plus `archived`. Keep a `recipe_status_event` (recipe_id, status, at, note) if you want history; a single `status` column + `rated_at`/`rating` is enough for v1.

**never-use → dietary_rule** — id, household_id, scope (ingredient | ingredient_category | recipe), target_id / target_text, severity (forbidden | avoid | limit), condition_note ("allowed if minor role"), applies_to (both/all), created_at
This cleanly captures "seafood except tuna and salmon", "no pork", "mild only". `check_recipe()` runs planned recipes against it before cooking.

**meal_plan** — id, household_id, week_start_date (Monday), servings_defaults (lunch_batch_servings=6, dinner_servings=4), status (draft/active/archived), notes, created_at
**meal_slot** — id, meal_plan_id, date, meal_type (breakfast/lunch/dinner), slot_type (recipe | leftover | batch | freeform), recipe_id, source_cook_event_id, servings, label ("fridge clean-out"), sort_order
Leftovers must be a reference to the cook event, not a recipe name — that's what makes "cook once, eat twice" and pantry math work.

**cook_event** — id, meal_plan_id, recipe_id, cook_date, planned_servings, actual_servings, batch_label ("Batch A"), status (planned/done/skipped), completed_at
**prep_task** — id, meal_plan_id, due_date, description, linked_slot_id, done

**shopping_list** — id, meal_plan_id, status (draft/sent/purchased), created_at, purchased_at
**shopping_list_item** — id, shopping_list_id, ingredient_id, qty, unit, purpose_note ("chili 2 lb + beef & broccoli 1 lb"), is_checked, checked_at, substituted_for_ingredient_id, actual_qty, actual_unit
Today the purpose note is how the list stays intelligible — keep it as a derived text field, not the source of truth.

---

## 3. Derived workflows that define the API

1. **Generate week** — pick N rotation recipes + M new, check dietary rules, place into slots (cook/leftover pattern), write `meal_plan` + `meal_slot` + `cook_event`.
2. **Demand** — scale each recipe's `recipe_ingredient` to slot servings, sum by ingredient per date range.
3. **Generate shopping list** — `demand − pantry on-hand` grouped by ingredient; leftovers (unit mismatches) go to a "check pantry" bucket. This replaces the hand-written list entirely.
4. **Mark purchased** — writes `stock_movement(purchase)` and sets `pantry_item.qty`; optionally records actual qty vs planned.
5. **Complete cook** — decrement pantry by the cooked recipe's ingredients (scaled to actual servings), create leftovers (yielded servings) that dinner slots can point at.
6. **Pantry update** — manual adjust or "I bought X" sets stock + movement; `last_verified_at` drives staleness ("unknown since…").
7. **Swap meal** — mutate one `meal_slot`; reservations and shopping list recompute.

---

## 4. Tricky bits (decide these before schema freeze)

- **Units.** Mixed lb / oz / cups / counts / "1–2 heads" / "3 x 8 oz cans". Practical v1: keep `qty` + `unit` free-ish, add conversions only for the ~15 ingredients you actually compare (proteins, canned goods, dairy). Don't build a full unit algebra.
- **Ranges and approximations.** "1–2 heads", "~2.5 lb", "on hand". Add `qty_min` / `qty_max` or a `certainty` enum; don't pretend to 2 decimal places.
- **Stock vs. reservation.** Biggest modeling bug in the current files. Split (see `pantry_reservation`).
- **Leftover identity.** A cook event yields servings; slots consume them. Otherwise "leftovers" is a dangling string.
- **Household scope everywhere.** Even for one household, put `household_id` on every root table — cheap now, painful later.
- **Ingredient granularity.** Is "yellow onion" one ingredient with a variety attribute, or separate from "red onion"? Recommend: one `ingredient` per shopping-relevant thing, variety in the name; aliases for matching.
- **Recipe ingredient data quality.** You'll be entering/scraping ingredients anyway; store them structured at entry time or the shopping list can never be automatic.
- **History.** Ledger tables (`stock_movement`, `cook_event`, status events) are what make the frontend interesting later ("what do we actually eat", "what do we waste").

---

## 5. MCP tool surface (for Chef)

Read-mostly, few writes. Namespaced tools, all household-scoped via config.

**Pantry**
- `pantry_list(category?, status?, stale_days?)`
- `pantry_get(ingredient)`
- `pantry_adjust(ingredient, delta, unit, reason, note?)`
- `pantry_set(ingredient, qty, unit, status?, last_verified_at?)`
- `pantry_bulk_import(lines[])` — for receipts / "here's what I have"

**Recipes**
- `recipe_search(query?, status?, tags?)`
- `recipe_get(id)` — includes structured ingredients
- `recipe_create(title, source_url?, servings, ingredients[], tags?)`
- `recipe_set_status(id, status, rating?, note?)` — want_to_try / rotation / never
- `recipe_check(id)` → dietary-rule violations

**Planning**
- `plan_get_week(week_start?)`
- `plan_create_week(week_start, slots[] | auto: true, new_recipe_count?)`
- `plan_set_slot(plan_id, date, meal_type, spec)` — recipe | leftover(ticket) | freeform | skip
- `plan_swap(plan_id, date, meal_type, new_spec)`
- `cook_complete(cook_event_id, actual_servings?, note?)`
- `prep_list(plan_id)`, `prep_complete(task_id)`

**Shopping**
- `shopping_generate(plan_id)` — demand − stock
- `shopping_list(list_id, include_checked?)`
- `shopping_check(item_id, checked)`
- `shopping_complete(list_id, received[]?)` — writes purchases into pantry

**Rules & prefs**
- `rules_list()`, `rules_add(...)`, `rules_remove(id)`
- `prefs_get()`, `prefs_update(...)` — servings, spice level, household

**Meta**
- `state_import(files)` — one-time seed from the six markdown files
- `export_week(plan_id)` — markdown rendering, if Chef still wants to show a table

Principle: MCP returns compact JSON with IDs + human labels. Chef never does arithmetic on quantities; the server does demand/stock math.

---

## 6. Suggested build order

1. SQLite + FastAPI (or plain SQLModel) service on this box; single file DB, WAL.
2. `ingredient` + `pantry_item` + `stock_movement`; import `pantry.md` (parse the 4-field lines, keep raw text in `note`).
3. `recipe` + `recipe_ingredient`; seed `rotation` / `want-to-try` / `never-use`.
4. `meal_plan` / `meal_slot` / `cook_event`; import this week's plan.
5. Shopping generation (this is the first real payoff).
6. MCP server wrapping the same HTTP API (thin transport, not a second implementation).
7. Frontend: pantry table + "update stock" first, then week view.

---

## 7. Open questions

1. **Stack & hosting** — local SQLite service on this box, or Postgres in a container? Single household → SQLite is enough.
2. **One household or multi-tenant?** (I'd still add `household_id`.)
3. **Inventory discipline** — should completing a cook auto-decrement pantry, or is pantry manual-only for now? Biggest scope lever.
4. **Recipe detail** — store full instructions, or just structured ingredients + source URL?
5. **Migration** — OK to treat the six markdown files as a one-time import and then make the DB authoritative (Chef stops editing files)?
6. **Frontend scope v1** — pantry-only read/edit, or pantry + week plan?
