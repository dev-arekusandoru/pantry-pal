# PantryPal — v1 Implementation Plan

Open-source, self-hosted backend for household food state (pantry, recipes, rules, meal plans,
shopping). One service exposes a REST API and an MCP endpoint over HTTP; a web frontend comes later
on the same REST API.

## Decisions

| Area | Choice |
|---|---|
| Stack | Node 22, pnpm, TypeScript, Hono, Drizzle ORM, SQLite (better-sqlite3, WAL) |
| Validation | Zod schemas shared by REST handlers and MCP tool inputs |
| Transports | REST `/api/v1/*` and MCP Streamable HTTP `/mcp`, same process |
| Auth | Bearer API tokens (hashed in DB, created via CLI); OAuth later |
| Tenancy | One household per instance; `household_id` on every root table |
| Inventory | Completing a cook auto-decrements pantry |
| Recipes | Every meal is a recipe, including simple breakfasts (scrambled eggs). Structured ingredients + full instructions + source URL |
| Migration | One-off curated seed from Chef's six markdown files; DB authoritative afterwards. No generic importer |
| Deploy | Docker image + `docker-compose.yml`; data in one volume |
| License | MIT |

## Architecture

```
REST (Hono routes) ─┐
                    ├─> services/ (business logic, Zod in/out) ─> db/ (Drizzle, SQLite)
MCP  (/mcp tools)  ─┘
```

- Services are the only layer that touches the DB. REST and MCP are thin adapters over them, so MCP
  does not call the HTTP API.
- All quantity math (scaling, unit conversion, demand, availability) lives in services. Agents never
  do arithmetic.
- Planning intelligence (which meals to pick) stays in the agent. The server stores the plan,
  validates it and computes the math.

## Layout

```
src/
  db/schema.ts, db/migrations/
  services/{pantry,ingredients,recipes,rules,plans,cooking,shopping,units}.ts
  api/routes/*.ts          # REST adapters
  mcp/server.ts, mcp/tools/*.ts
  auth/                    # token middleware
  cli.ts                   # token create/revoke, migrate, seed
seed/chef-2026-11.json     # curated from "original chef docs/"
test/
```

## Schema (v1)

Every root table has `household_id`. Timestamps are ISO UTC. Quantities are `qty REAL NULL` +
`unit TEXT`.

- **household**: name, default_servings, settings_json (spice level, batch sizes, etc.)
- **api_token**: name, token_hash, last_used_at, revoked_at
- **ingredient**: canonical_name, category, default_unit, is_staple, par_qty, par_unit, notes, archived_at
- **ingredient_alias**: ingredient_id, alias (unique per household, lowercase)
- **unit_conversion**: ingredient_id NULL (= global), from_unit, to_unit, factor
- **pantry_item**: ingredient_id, location (pantry/fridge/freezer), qty NULL, unit, qty_approx bool,
  status (on_hand/low/out/unknown), raw_text, last_verified_at, note.
  Unique on (ingredient_id, location).
- **stock_movement** (append-only): pantry_item_id, kind (`set` | `delta`), qty, unit,
  reason (purchase/cook/waste/adjust/import), ref_type, ref_id, created_at.
  `pantry_item` is the cached projection. A `set` row handles "on hand" and other unknown amounts.
- **recipe**: title, source_url, servings, prep_minutes, cook_minutes, instructions_json (ordered
  steps), image_url, spice_level, tags_json, status (want_to_try/rotation/never/archived), rating, notes
- **recipe_ingredient**: recipe_id, ingredient_id, qty, unit, prep_note, optional, scaling_exempt,
  group_label, sort_order
- **recipe_status_event**: recipe_id, status, rating, note, at
- **dietary_rule**: scope (ingredient/category/recipe/tag/freeform), target_id NULL, target_text,
  severity (forbidden/avoid/limit), condition_note
- **meal_plan**: week_start (Monday), status (draft/active/archived), notes
- **cook_event**: meal_plan_id, recipe_id, cook_date, planned_servings, actual_servings, label,
  status (planned/done/skipped), completed_at
- **meal_slot**: meal_plan_id, date, meal_type, kind (meal/freeform/skip), cook_event_id NULL,
  servings, label. One cook_event can feed many slots (chili feeds 3 lunches). Slots dated after
  the cook are leftovers, so no separate leftover kind is needed. The cook date can fall outside
  the plan week (chili cooked Sun Nov 1 for the Nov 2 week). Freeform slots ("fridge clean-out")
  have no cook_event.
- **prep_task**: meal_plan_id, due_date, description, cook_event_id NULL, done_at
- **shopping_list**: meal_plan_id NULL, status (draft/shopping/done), created_at, completed_at
- **shopping_list_item**: list_id, ingredient_id NULL, freeform_text, qty, unit, purpose_note,
  source (generated/manual), checked_at, actual_qty, actual_unit

No reservation table. Committed stock = planned cook_events × scaled recipe ingredients. Available
= on hand − committed. Both are computed, so swapping a meal can't leave stale reservations behind.

## Core computations

- **Resolve ingredient**: name → alias/canonical match; unknown names are returned as candidates and
  are never auto-created silently.
- **Convert**: per-ingredient conversion first, then global. If no conversion exists, the result is
  "incomparable" and is never guessed.
- **Demand(plan)**: sum of scaled recipe_ingredients for planned cook_events (`scaling_exempt` items
  are not scaled).
- **Shopping generate**: demand − available, grouped by ingredient. Unknown or incomparable stock
  goes to a "check pantry" bucket. Manual items are kept on regenerate.
- **Shopping complete**: checked items → `delta` purchase movements.
- **Cook complete**: scaled ingredients → `delta` cook movements (clamped at 0, unknowns left
  untouched); sets actual_servings. If the recipe has no ingredients yet, it completes with a
  warning and nothing is decremented.
- **Rule check(recipe)**: returns matching rules with their condition_note. The agent decides
  conditional cases.

## REST API (`/api/v1`)

`ingredients`, `pantry` (+ `/movements`, `/adjust`, `/set`), `recipes` (+ `/status`, `/check`),
`rules`, `plans` (+ `/slots`, `/cook-events/:id/complete`, `/prep-tasks`), `shopping-lists`
(+ `/generate`, `/items`, `/complete`), `household`. OpenAPI generated from Zod.

## MCP tools (~15, compact JSON with ids + labels)

`pantry_query`, `pantry_update` (set/adjust, bulk lines), `ingredient_resolve`,
`recipe_search`, `recipe_get`, `recipe_save` (create/update incl. ingredients + steps),
`recipe_set_status`, `rules_list`, `rules_manage`, `plan_get`, `plan_set_slots`,
`cook_complete`, `shopping_generate`, `shopping_get`, `shopping_update` (check/add/complete),
`household_prefs`.

## Milestones

1. **Skeleton**: pnpm project, lint/format, Vitest, Drizzle + migrations, Hono app, token auth +
   CLI, health endpoint, Dockerfile/compose.
2. **Ingredients + pantry + ledger**: services, REST, tests for set/delta projection and conversions.
3. **Recipes + rules**: structured ingredients, instructions, status history, rule check.
4. **Plans + cook events**: slots, leftovers, prep tasks, cook-complete decrement.
5. **Shopping**: demand, availability, generate/check/complete.
6. **Seed**: curated JSON + `cli seed` loading through services (see Seed mapping). It needs the
   plan and shopping tables, so it comes after them.
7. **MCP**: Streamable HTTP endpoint with bearer auth; wire up Chef and run one real week end to end.
8. **Docs**: README, self-hosting guide, MCP client config examples.

v1 is done when Chef runs one full week (plan → shopping list → purchase → cooks) against the
service with no markdown files.

## Seed mapping (from `original chef docs/`)

- **Household**: 2 people, spice level mild (heat added after), lunch batch 6 servings, dinner 4
  servings, cook-once-eat-twice dinners.
- **Pantry**: one ingredient per line; the pantry.md "notes" column becomes the ingredient
  category. Clean numbers are parsed (`3 lb`, `2 x 14.5 oz cans` → 2 can + 14.5 oz/can conversion).
  "on hand" → qty NULL, status on_hand. Allocation parentheticals ("chili 2 + b&b 1") are dropped,
  because commitments are computed. "Salt, black pepper" becomes two items. The "Common spices" and
  "Tomatoes" summary lines are dropped. Original line kept in `raw_text`. One `set`/import movement
  per item.
- **Recipes**: 5 lunch/dinner recipes + breakfasts (overnight oats, eggs & toast, pancakes) as
  stubs: title, URL where known, status want_to_try, no ingredients. Chef fills ingredients via
  `recipe_save`. Rotation and want-to-try files are empty.
- **Rules**: no mushrooms (forbidden); no pork, all cuts (forbidden); seafood except tuna/salmon
  (forbidden, condition); mayo (avoid, "minor role ok"); beef only as ground beef (forbidden for
  non-ground beef cuts); pot roast recipe excluded. "Keep mild" goes in household settings, not
  rules.
- **Plan Nov 2–8**: all cook events planned (chili Sun Nov 1 not yet cooked); grid → slots;
  overnight oats cook_event the night before; prep schedule → prep_tasks.
- **Shopping list Nov 2–8**: imported as `done`, items checked, with **no** purchase movements
  (the pantry snapshot already includes them). Items marked "on hand" are skipped.

## Known v1 limitation

Shopping generation and cook decrement only become useful once Chef has saved structured
ingredients for each recipe. Getting that done is the first step of the end-to-end trial week.
