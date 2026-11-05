# PantryPal

Self-hosted household food backend: pantry inventory, recipes, dietary rules, weekly meal plans,
cook events and shopping lists. One process serves a REST API at `/api/v1` and an MCP endpoint at
`/mcp` (Streamable HTTP), both over the same service layer, both authenticated with bearer tokens.
The database is a single SQLite file, so the whole system is a container plus a volume.

PantryPal is driven by an AI agent (a weekly planning loop over MCP) or by the bundled web app,
without either surface re-implementing food math.

## Features

- **Pantry ledger.** Every stock change is an append-only `stock_movement`; `pantry_item` is the
  cached projection. Amounts can be exact, approximate ("~2.5 lb") or unknown ("on hand"). Per
  location (pantry, fridge, freezer, counter), with purchased/opened/expiry dates and par levels.
- **Ingredients & units.** Canonical names with aliases, categories, default units and locations,
  shelf life, staple flags. Unit conversion per ingredient (e.g. `1 can = 14.5 oz`) falls back to
  household-global rules; incomparable units are reported instead of guessed.
- **Recipes.** Structured ingredients (ranges, optional, scaling-exempt items, prep notes, groups),
  ordered steps, yield, times, cuisine, meal types, tags, equipment, nutrition, storage notes and
  leftover lifetime. Status workflow (`want_to_try` / `rotation` / `never` / `archived`) with history.
  Recipes scale to any serving count server-side.
- **Dietary rules.** Scoped to an ingredient, category, recipe, tag or keyword; severity
  `forbidden` / `avoid` / `limit`; optional condition note for judgment calls; optionally scoped to
  a single household member. `recipe_check` returns the rules a recipe hits. Keyword rules match
  whole words, case-insensitively and plural-tolerantly (`ham` covers "diced ham" and "hams" but not
  "hamburger"); they never match inside a longer word.
- **Meal plans.** Weekly plans with dated slots (breakfast/lunch/dinner/…), cook events that may feed
  several slots (batch cooking and leftovers), freeform slots, and prep tasks.
- **Shopping lists.** Generated from plan demand minus stock already on hand, with manual items kept
  across regeneration, aisle categories, in-store check-off, and completion that turns purchases
  into pantry movements.
- **Cook completion.** Finishing a cook event scales the recipe to what was actually eaten and
  decrements the pantry in one transaction, recording the movements.
- **MCP server.** Same operations as the REST API, shaped for agents (compact JSON with ids and
  labels), so a client can plan a week, buy, cook and update stock without any custom code.
- **OpenAPI.** Generated from the Zod route definitions at `/openapi.json`.
- **Web app.** Mobile-first UI served by the same process: week plan with meal swapping, shopping
  check-off, pantry editing, recipes with scaling and cook mode. Built with React and Vite; see
  [docs/FRONTEND.md](docs/FRONTEND.md).

## Quick start (Docker)

```sh
docker compose up -d --build

# Create the household (one per instance) and an API token.
docker compose exec pantrypal node dist/cli.js household init --name "Our House" --timezone America/New_York
docker compose exec pantrypal node dist/cli.js token create --name chef
```

The token is printed once; store it somewhere safe. Then:

```sh
export PANTRYPAL_TOKEN=<token>
curl -s http://localhost:8787/health
curl -s -H "Authorization: Bearer $PANTRYPAL_TOKEN" http://localhost:8787/api/v1/household
```

`docker-compose.yml` maps port `8787` and mounts `./data` at `/data`, which is where
`PANTRYPAL_DB_PATH` points. See [docs/self-hosting.md](docs/self-hosting.md) for backups, TLS and
upgrades, and [docs/mcp.md](docs/mcp.md) to connect an MCP client.

### Importing the example data set

`seed/example.json` is a complete synthetic household state (ingredients, conversions, pantry,
rules, 8 recipes with full ingredients and steps, one week plan, one shopping list). After
`household init`, load it instead of starting empty:

```sh
docker compose exec pantrypal node dist/cli.js seed seed/example.json
```

## Local development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm cli household init --name "Our House"
pnpm cli token create --name chef
pnpm dev                     # http://localhost:4787
```

Other useful commands:

```sh
pnpm test                    # vitest
pnpm typecheck               # tsc --noEmit
pnpm build && pnpm start     # compiled output in dist/
pnpm db:generate             # drizzle-kit migrations after editing src/db/schema.ts
```

The CLI (`pnpm cli …`) runs pending migrations first: `migrate`, `household init|show`,
`token create|list|revoke`, `seed <file.json> [--force]`. Pass `--db <path>` to override the
database file.

## Configuration

`PANTRYPAL_DB_PATH`, `PORT`, `HOST`, `PANTRYPAL_TRUST_NETWORK` and `PANTRYPAL_WEB_DIR` are
documented in [docs/self-hosting.md](docs/self-hosting.md#environment-variables). Pending
migrations run automatically at startup and in every CLI command; there is no separate migrate step.

## Authentication

All of `/api/v1/*` and `/mcp` require `Authorization: Bearer <token>`. Tokens are created with the
CLI, stored as SHA-256 hashes with a short prefix for identification, and can be revoked at any
time (`pnpm cli token revoke <id>`). `GET /health` is public. One token belongs to one household;
this is a single-household-per-instance design.

**Network trust (opt-in, for the web app).** With `PANTRYPAL_TRUST_NETWORK=1`, `/api/v1/*` requests
that send no `Authorization` header act as the instance's single household, so the browser UI needs
no login: anyone who can reach the port is in. A token that is sent is still verified (an invalid one
is a 401), `/mcp` always requires a token, and the default is off. Only enable it on a private
network, for example behind `tailscale serve`; see [docs/self-hosting.md](docs/self-hosting.md#web-app-and-network-trust).
If the instance has no household yet, those requests get a 503 with code `unavailable`.

## REST API

Base path `/api/v1`, JSON in and out, camelCase fields. Errors are
`{"error": {"code", "message", "details?"}}` with codes `not_found`, `conflict`, `validation`,
`unprocessable`, `unauthorized`, `unavailable`. Lists are `{"items": [...]}`. `/openapi.json` is the authoritative
reference — it is generated from the route definitions; the table below is the map.

| Group | Endpoints (base) | Highlights |
|---|---|---|
| Household | `/household`, `/household/members` | Name, timezone, settings (servings, spice level, week start, planning notes); members with notes |
| Ingredients | `/ingredients`, `/ingredients/{id}/aliases`, `/ingredients/{id}/merge` | Search/list, create/update, aliases, merging duplicates |
| Units | `/units/convert`, `/unit-conversions` | Unit normalization and conversion checks; per-ingredient and global conversion factors |
| Pantry | `/pantry`, `/pantry/movements`, `/pantry/availability`, `/pantry/set`, `/pantry/adjust`, `/pantry/bulk`, `/pantry/{id}` (GET/PATCH/DELETE) | Stock per location, ledger history, available = on hand − committed; deleting a row takes its movement history with it |
| Recipes | `/recipes`, `/recipes/{idOrSlug}`, `/recipes/{idOrSlug}/status`, `/recipes/{idOrSlug}/status-history`, `/recipes/{idOrSlug}/check`, `/recipes/{idOrSlug}/scaled` | Full recipes with ingredients + steps, status history, rule check, scaling to servings |
| Rules | `/rules`, `/rules/check-ingredients` | CRUD over ingredient/category/recipe/tag/keyword rules, optionally member-scoped |
| Plans | `/plans`, `/plans/{id}/slots`, `/plans/{id}/swap`, `/plans/{id}/cook-events`, `/plans/{id}/prep-tasks`, `/plans/{id}/demand`, `/cook-events`, `/cook-events/{id}/complete`, `/cook-events/{id}/undo` | Weekly grid, cook events feeding multiple slots, one-call meal swap, demand, prep schedule, cook completion and undo, ad-hoc cooks outside any plan (`POST /cook-events`, optionally completed at once) |
| Shopping lists | `/shopping-lists`, `/shopping-lists/generate`, `/shopping-lists/{id}/items` (POST add, DELETE clear), `/shopping-lists/{id}/check`, `/shopping-lists/{id}/complete` | Generate from a plan, clear or check items off in store, complete into purchases; lists carry `stale` when the plan changed after generation |

## MCP

The MCP server is mounted at `/mcp` using Streamable HTTP (`POST` for requests, `GET` for the
event stream, `DELETE` to end a session) with the same bearer token. A client that can reach the
server can run the entire planning loop: search recipes, check them against dietary rules, write the
plan, generate the shopping list, check items off, and record cooks that decrement the pantry.

Client configuration and the tool catalog live in [docs/mcp.md](docs/mcp.md).

## Data model in brief

`src/db/schema.ts` is the source of truth; every table below `household` carries `household_id` and
every query filters by it. Timestamps are ISO-8601 UTC, dates are `YYYY-MM-DD`, quantities are a
nullable real plus a normalized unit string (nullable = unknown amount).

- **Ledger, not guesses.** `stock_movement` is append-only (`set` for "this is what's there",
  `delta` for purchases, cooks, waste) and records the resulting `qty_after` / `status_after`.
  `pantry_item` holds the current projection per `(ingredient, location)`.
- **No reservations table.** Committed stock is computed from planned cook events × scaled recipe
  ingredients, so replacing or moving a meal cannot leave a stale reservation behind. Availability =
  on hand − committed; incomparable units are surfaced as "check the pantry", never guessed.
- **Leftovers are just slots.** A cook event can feed several meal slots on later dates; a slot dated
  after its cook is leftovers. There is no separate leftover entity, and the cook date may fall
  outside the plan week (Sunday batch cooking for the week ahead).
- **Recipes are structured.** `recipe_ingredient` (ranges, optional, scaling-exempt) and
  `recipe_step` rows keep full fidelity, with `recipe_status_event` as the status/rating history.
- **Counts in, arithmetic out.** Any numeric result an agent needs (scaling, conversions, demand,
  availability, shopping deltas) is computed by the services, never by the client.

## Seeding from JSON

The `seed` command imports a JSON snapshot through the service layer (no raw SQL), for moving an
existing household in or starting from the synthetic example:

```sh
pnpm cli seed seed/example.json
```

It is a one-time import: it refuses to run when the household already has data, resolves all
ingredient/recipe/cook-event references by name or key first and aborts on anything unresolved, and
creates one `import` movement per pantry row. The format, field semantics and loader rules are
documented in [seed/FORMAT.md](seed/FORMAT.md).

## Development notes

- Services in `src/services/` are the only code that touches the database; REST routes and MCP tools
  are thin adapters over them, so behavior is identical on both surfaces.
- Tests use an in-memory database and an injected clock (`test/helpers.ts`), so time-dependent
  behavior is deterministic.
- Schema changes go through `src/db/schema.ts` + `pnpm db:generate`; migrations apply automatically
  on startup.

## License

MIT — see [LICENSE](LICENSE).

Bundled assets: all emoji art is designed by [OpenMoji](https://openmoji.org) – the open-source
emoji and icon project. License: CC BY-SA 4.0 (full text in
[`web/public/openmoji/LICENSE.txt`](web/public/openmoji/LICENSE.txt)). UI icons are
[Phosphor](https://phosphoricons.com), licensed MIT.
