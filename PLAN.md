# PantryPal — v1 implementation plan

Open-source, self-hosted backend for household food state (pantry, recipes, rules, meal plans,
shopping). One service exposes a REST API and an MCP endpoint over HTTP; a web frontend comes later
on the same REST API.

[`src/db/schema.ts`](src/db/schema.ts) is the source of truth for the data model. This document
explains the shape and the decisions behind it rather than restating every column.

## Decisions

| Area | Choice |
|---|---|
| Stack | Node 22, pnpm, TypeScript, Hono, Drizzle ORM, SQLite (better-sqlite3, WAL) |
| Validation | Zod schemas shared by REST handlers and MCP tool inputs |
| Transports | REST `/api/v1/*` and MCP Streamable HTTP `/mcp`, same process |
| Auth | Bearer API tokens (hashed in DB, created via CLI); OAuth later |
| Tenancy | One household per instance; `household_id` on every root table |
| Inventory | Completing a cook auto-decrements pantry |
| Recipes | Every meal is a recipe, including simple breakfasts; full structured data (ingredients, steps, nutrition, storage notes), not a link |
| Migration | One-off curated seed from the household's docs: `seed/chef-2026-11.json`. DB authoritative afterwards, no generic importer |
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
  services/{pantry,ingredients,recipes,rules,plans,cooking,demand,shopping,units}.ts
  api/routes/*.ts          # REST adapters
  mcp/server.ts, mcp/tools/*.ts
  auth/                    # token middleware
  cli.ts                   # token create/revoke, migrate, household init, seed
seed/chef-2026-11.json     # complete curated household snapshot
seed/FORMAT.md             # seed format + loader rules
test/
Dockerfile, docker-compose.yml, docs/   # deployment + MCP client docs
```

## Data model (v1)

Every table below `household` has `household_id`. Timestamps are ISO-8601 UTC, dates are
`YYYY-MM-DD`, and a quantity is `qty REAL NULL` + normalized `unit TEXT` (NULL quantity = present
but unmeasured).

- **household**: name, IANA timezone, `settings` JSON (default servings, spice level, lunch/dinner
  batch sizes, week start, unit system, free-form `planningNotes` for agents); **household_member**
  rows with display name and free-text dietary notes.
- **api_token**: name, identifying prefix, hash, `last_used_at`, `revoked_at`.
- **ingredient**: name + normalized name, description, image, category, default unit and location,
  shelf life, staple flag, par quantity/unit, notes, archive date; **ingredient_alias** (lowercase,
  unique per household); **unit_conversion** (per ingredient or household-global, one factor).
- **pantry_item**: cached projection per `(ingredient, location)`: qty, unit, approximate flag,
  status, raw text, note, purchased/opened/expiry dates, last verified.
- **stock_movement** (append-only): `set` or `delta`, qty/unit, reason
  (purchase/cook/waste/adjust/import/verify), reference type + id, note, and the resulting
  `qty_after`/`status_after`.
- **recipe**: title, slug, description, source URL/name, author, image, servings, yield text,
  prep/cook/total minutes, dish spice level, cuisine, meal types, tags, equipment, nutrition JSON,
  storage notes, leftover days, status, rating, notes. **recipe_ingredient**: qty with optional
  `qtyMax` range, unit, prep note, optional, scaling-exempt, group label, position.
  **recipe_step**: text, group label, duration hint, position. **recipe_status_event**: status
  history with rating and note.
- **dietary_rule**: scope `ingredient | category | recipe | tag | keyword`, severity
  `forbidden | avoid | limit`, condition note for judgment calls, reason, and an optional member
  scope (NULL = whole household).
- **meal_plan**: week start (Monday, unique per household), title, status, notes. **cook_event**:
  plan (NULL for ad-hoc cooks), recipe, cook date (may fall outside the plan week), planned and
  actual servings, label, status, completion time, rating, notes. **meal_slot**: date, meal type,
  kind (`meal | freeform | skip`), cook event, servings, label, notes. **prep_task**: due date,
  description, optional cook event, done time.
- **shopping_list**: optional plan, title, status (`draft | shopping | done`), notes, completion
  time. **shopping_list_item**: linked ingredient or free text, display name, aisle category,
  qty/unit, purpose note, `needsCheck`, source (`generated | manual`), checked time, actual
  qty/unit, substitute ingredient.

Consequences worth remembering:

- **Ledger first.** Every stock change is a `stock_movement`; `pantry_item` is only a projection, so
  "why is this here?" and "what did we waste?" are answerable from history.
- **No reservation table.** Committed stock is computed from planned cook events × scaled recipe
  ingredients; available = on hand − committed. Swapping or moving a meal cannot leave a stale
  reservation behind.
- **Leftovers are slots.** One cook event can feed several slots on later dates; a slot dated after
  its cook is leftovers. There is no separate leftover entity, and the cook date may precede the
  plan week.
- **Uncertainty is explicit.** Unknown amounts, approximate amounts, incomparable units and
  substitutions have their own fields (`qty NULL`, `qty_approx`, `needs_check`,
  `substitute_ingredient_id`) instead of being rounded into a number.
- **Member-scoped rules.** Dietary rules can apply to one household member, not just the household.

## Core computations

- **Resolve ingredient**: name → alias/canonical match. Unknown names are returned as candidates and
  are only created when the caller explicitly asks for creation.
- **Convert**: per-ingredient conversion first, then global, including the inverse direction. If no
  conversion exists, the result is "incomparable" and is never guessed across mass/volume/count.
- **Demand(plan)**: sum of scaled `recipe_ingredient` rows for planned cook events
  (`scaling_exempt` items are not scaled).
- **Scale recipe**: factor = servings / recipe.servings; exempt and unmeasured lines stay unscaled.
- **Shopping generate**: demand − available, grouped by ingredient. Unknown or incomparable stock
  goes to a "check pantry" bucket (`needs_check`). Manual items are kept on regenerate.
- **Shopping complete**: checked items → `delta` purchase movements, using actual qty/unit and
  recording substitutions.
- **Cook complete**: scaled ingredients → `delta` cook movements (clamped at 0, unknown amounts left
  untouched); records actual servings, rating and notes.
- **Rule check(recipe)**: returns matching rules with their `condition_note`. The agent decides
  conditional cases.

## REST API (`/api/v1`)

`household` (+ `/members`), `ingredients` (+ `/aliases`, `/merge`), `unit-conversions` and
`units/convert`, `pantry` (+ `/movements`, `/availability`, `/set`, `/adjust`, `/bulk`), `recipes`
(+ `/{idOrSlug}`, `/status`, `/check`, `/scaled`), `rules` (+ `/check-ingredients`), `plans`
(+ `/slots`, `/cook-events`, `/prep-tasks`, `/demand`), `cook-events/{id}/complete` and
`shopping-lists` (+ `/generate`, `/items`, `/check`, `/complete`). OpenAPI is generated from the Zod
route definitions at `/openapi.json`.

## MCP tools (~26, compact JSON with ids + labels)

Household: `household_get`, `household_update`. Ingredients: `ingredient_search`,
`ingredient_upsert`. Pantry: `pantry_query`, `pantry_update`, `pantry_history`, `availability`.
Recipes/rules: `recipe_search`, `recipe_get`, `recipe_save`, `recipe_set_status`, `recipe_check`,
`rules_list`, `rules_manage`. Plans/cooking: `plan_get`, `plan_create`, `plan_set_slots`,
`plan_update`, `prep_tasks`, `cook_complete`, `cook_history`. Shopping: `shopping_generate`,
`shopping_get`, `shopping_update`, `shopping_complete`. See [docs/mcp.md](docs/mcp.md) for the tool
contract and agent workflows.

## Milestones

1. **Skeleton** — done: pnpm project, Vitest, Drizzle schema + migrations, Hono app, bearer token
   auth + CLI, health endpoint, seed file, Dockerfile/compose, docs.
2. **Ingredients + pantry + ledger**: services, REST, tests for set/delta projection and conversions.
3. **Recipes + rules**: structured ingredients and steps, status history, rule check, scaling.
4. **Plans + cook events**: slots, leftovers, prep tasks, cook-complete decrement.
5. **Shopping**: demand, availability, generate/check/complete.
6. **Seed loader**: `cli seed` applying the curated JSON through the service layer.
7. **MCP**: Streamable HTTP endpoint with bearer auth; wire up an agent and run one real week end to
   end.
8. **Docs**: README, self-hosting guide, MCP client config examples — written alongside 1–7.

v1 is done when the household runs one full week (plan → shopping list → purchase → cooks) against
the service with no markdown files.

## Seed (`seed/chef-2026-11.json`)

One-time import of the household's state as of 2026-11-01, loaded through the service layer (never
raw SQL) by `pantrypal seed`. It is a complete snapshot, not stubs:

- household (2 members, mild spice level, batch sizes, planning notes) and 65 ingredients with
  categories, default units/locations, aliases and staples;
- 16 unit conversions that make recipe units comparable to pantry units (`can → oz`,
  `count → lb`, `head → clove`, `bunch → sprig`, …);
- 46 pantry rows with original text preserved, including approximate and unknown amounts;
- 11 dietary rules (never-use list, "beef only as ground beef", "mayo in a minor role only");
- 8 recipes with real ingredients, ordered steps, times, servings, images and nutrition: 5
  transcribed from source pages, 3 breakfasts authored for the household;
- one week plan (12 cook events, 21 slots, 7 prep tasks) with every cook event still `planned`;
- one completed shopping list (33 items) for the same week.

Import rules that matter: allocation parentheticals are dropped because commitments are computed
(the original line stays in `raw_text`); the shopping list is historical, so it creates no purchase
movements (the pantry snapshot already includes those purchases); "keep it mild" is a household
setting, not a rule. Format and loader semantics: [seed/FORMAT.md](seed/FORMAT.md).
