# MCP server

PantryPal exposes a [Model Context Protocol](https://modelcontextprotocol.io) server over
**Streamable HTTP** at `/mcp`, in the same process as the REST API and over the same service layer.
There is no separate MCP process and no stdio transport to proxy — an agent that can reach the URL
and send a bearer token can operate the household.

## Endpoint

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mcp` | JSON-RPC requests (initialize, tools/list, tools/call). Responses are plain JSON. |
| `GET` | `/mcp` | `405`: the endpoint is stateless, so there is no server-to-client SSE stream. |
| `DELETE` | `/mcp` | `405`: the endpoint is stateless, so there is no session to end. |

Headers:

```
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json, text/event-stream
```

The endpoint is **stateless**: no `Mcp-Session-Id` is issued and every request is independent
(each POST builds a fresh server bound to the token's household, and the database is the state).
JSON responses are enabled, so simple request/response clients work without SSE parsing.
`Accept` must still list both `application/json` and `text/event-stream`, as the Streamable HTTP
spec requires. `GET /health` needs no token; `/mcp` always needs one, and so does `/api/v1/*` unless
the request carries a valid browser session (password mode) or the operator runs the web app's
`PANTRYPAL_TRUST_NETWORK=1` mode (which never applies to `/mcp`). Tokens are created with the CLI
(`token create --name <client>`) — see [self-hosting.md](self-hosting.md#token-management).

Smoke test without an MCP client:

```sh
curl -s https://food.example.com/mcp \
  -H "Authorization: Bearer $PANTRYPAL_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-11-25",
        "capabilities":{},
        "clientInfo":{"name":"curl","version":"0"}}}'
```

## Client configuration

Claude Desktop / Claude Code style (`mcpServers`), for a server behind TLS:

```json
{
  "mcpServers": {
    "pantrypal": {
      "type": "http",
      "url": "https://food.example.com/mcp",
      "headers": {
        "Authorization": "Bearer REPLACE_WITH_TOKEN"
      }
    }
  }
}
```

For local development the URL is `http://localhost:4787/mcp`. If your client does not expand
environment variables, paste the token literally and keep that file private. With the Claude Code
CLI:

```sh
claude mcp add --transport http pantrypal https://food.example.com/mcp \
  --header "Authorization: Bearer $PANTRYPAL_TOKEN"
```

Any other MCP client that supports Streamable HTTP works the same way: give it the endpoint URL and
the bearer header. Clients that only speak stdio can bridge with
`npx mcp-remote https://food.example.com/mcp --header "Authorization: Bearer $PANTRYPAL_TOKEN"`.

## Tools

All tools take JSON objects and return compact JSON with stable ids plus human labels, so an agent
can pass ids between calls without re-reading everything. Tools that do several unrelated things
take an `action` field (the action list is in the tables below); tools that read stock, plans or
recipes are annotated read-only, and tools that can delete data are annotated destructive.
Money-and-math-shaped work — scaling, unit conversion, demand, availability, shopping deltas — is
done by the server; agents send numbers and choices, not arithmetic. Ingredient references accept
an id or a name (names, aliases and simple plurals resolve), and unknown names are reported as
unresolved candidates rather than silently created, unless the call asks for creation.

### Household

| Tool | Actions | Purpose |
|---|---|---|
| `household_get` | — | Household name, timezone, settings (default servings, spice level, batch sizes, week start, unit system, planning notes) and members. |
| `household_update` | `members[]`: `upsert` / `delete` | Update name, timezone or settings (merged key-by-key) and create/update/delete members. |

### Ingredients and units

| Tool | Actions | Purpose |
|---|---|---|
| `ingredient_search` | — | Search ingredients by name/alias/category, returning ids, default units and locations, staple flags, aliases, conversions and current stock. |
| `ingredient_upsert` | `create` / `update` / `alias` / `merge` | Create or update an ingredient (category, default unit/location, aliases, shelf life, par level), add/remove aliases, or fold a duplicate into another ingredient. |
| `unit_conversions` | `list` / `create` / `delete` | Custom conversions such as `1 can = 15 oz`, per ingredient or household-global, used when comparing recipe lines to stock. |

### Pantry

| Tool | Actions | Purpose |
|---|---|---|
| `pantry_query` | — | Current stock per ingredient and location, with status, approximate/unknown flags, dates and notes. Pass a pantry row id for one row, or an ingredient id/name for that ingredient's detail; otherwise filter the list. |
| `pantry_update` | `bulk` / `verify` / `move` / `delete` | `bulk` applies atomic `set`/`adjust` lines (purchase, cook, waste, adjust) per ingredient and location; `verify` stamps a row as checked, `move` changes its location, `delete` removes it with its movements. |
| `pantry_history` | — | Stock movements for an ingredient, pantry row or causing cook/shopping event: what changed, why, and the resulting quantity/status. |
| `availability` | — | Per-ingredient availability (on hand, committed by planned cooks, remaining, comparable flag) plus the aggregated demand lines, for one plan or all planned cooks. |

### Recipes and rules

| Tool | Actions | Purpose |
|---|---|---|
| `recipe_search` | — | Find recipes by title/description/tag, status, meal type, ingredient or maximum total time. |
| `recipe_get` | — | One recipe by id or slug with structured ingredients, ordered steps, times, nutrition and notes; pass `servings` to include the scaled ingredient list. |
| `recipe_save` | `create` / `update` | Create a recipe (no `id`, `title` required) or patch one (`id` or slug), including ingredient lines (qty/unit/ranges/optional) and steps. `statusNote` on a patch is recorded on the status-history event written when the status or rating changes. |
| `recipe_set_status` | — | Move a recipe (id or slug) through `want_to_try` / `rotation` / `never` / `archived` with an optional rating and note. |
| `recipe_check` | — | Check a stored recipe (`recipeId`, id or slug) or loose ingredient names (`ingredients`) against dietary rules; returns matching rules with their condition notes so the agent can judge exceptions. |
| `rules_list` | — | List dietary rules (ingredient/category/recipe/tag/keyword scope, severity, condition notes, member scope). |
| `rules_manage` | `create` / `update` / `delete` | Manage dietary rules; targets depend on scope (ingredient id or name, recipe id, category/tag/keyword text). An update that passes `ingredient` retargets an ingredient rule to that name (created when unknown). |

### Plans and cooking

| Tool | Actions | Purpose |
|---|---|---|
| `plan_get` | — | Read a week plan by id, `weekStart` or `"current"`: cook events, slot grid (including leftovers and freeform slots), prep tasks, warnings and status. |
| `plan_create` | — | Create a week plan for a `weekStart` with title, notes, status, cook events, slots and prep tasks in one transaction. |
| `plan_set_slots` | — | Replace the slot grid for one or more date+mealType groups; slots reference cook events, so one batch can feed several meals. |
| `plan_swap_meal` | — | Put a different recipe on one meal slot (`slotId`, or `date` + `mealType` for a day with no slot). `scope: "with_leftovers"` changes the cook that feeds the slot, so every slot it feeds changes; `scope: "this"` changes only this meal, and a slot that shares its cook becomes its own cook. A slot without a cook gets a new one; a cook that is already done can't be swapped. Returns the updated `plan` and `shoppingListStale` (true when an open shopping list for the plan no longer matches it, so regenerate it with `shopping_generate`). |
| `plan_update` | `update` / `add_cook` / `update_cook` / `delete_cook` | Update plan metadata, or add/reschedule/retarget/remove cook events (recipe, cook date, planned servings, label, rating). |
| `prep_tasks` | `list` / `add` / `update` / `complete` / `delete` | List (optionally by plan/date, including done), add, edit, complete or remove prep tasks. |
| `cook_complete` | `complete` / `skip` / `reopen` / `undo` | Complete a cook: records actual servings, rating and notes and decrements the pantry by the scaled ingredients; skip records it as not cooked; reopen restores stock; undo restores stock and deletes an ad-hoc cook no plan references. |
| `cook_history` | — | Recent cook events with recipe, date, servings, rating and notes, each with the pantry movements it produced (ingredient name, quantity, unit, resulting stock). |

### Shopping

| Tool | Actions | Purpose |
|---|---|---|
| `shopping_generate` | — | Create or refresh a shopping list for a plan: demand minus stock on hand, with a "check the pantry" bucket for unknown/incomparable amounts. |
| `shopping_get` | — | With a list id: the list with items, quantities, aisle categories, check-off state and provenance notes. Without: all list summaries. |
| `shopping_update` | `update_list` / `add_items` / `update_item` / `delete_item` / `clear_items` / `check` | Update list fields, add manual items (kept across regeneration), edit or delete items, clear every item off a list, and check items off with actual quantities/substitutes. |
| `shopping_complete` | — | Close the list and turn checked purchases into pantry movements. |

Errors come back as tool errors whose text is the same JSON shape as the REST API
(`{"error": {"code", "message", "details?"}}`), so a client can distinguish `not_found`,
`conflict`, `validation`, `unprocessable` and `unauthorized` and react accordingly.

## Agent workflows

### Weekly planning loop

1. **Decide the week.** `household_get` for servings, spice level and planning notes; `plan_get` for
   the previous week's plan and what was actually cooked.
2. **Pick meals.** `recipe_search` (rotation first, then `want_to_try`), `recipe_get` for the full
   ingredient list, and `recipe_check` on each candidate. Rules with a `conditionNote` are judgment
   calls: apply them or skip the recipe, and explain the choice to the user.
3. **Check stock.** `availability` for the candidate plan, or `pantry_query` for specific
   ingredients. Unknown amounts are "look in the fridge", not zero.
4. **Write the plan.** `plan_create`, then `plan_set_slots` with the grid. Batch cooking is expressed
   as one cook event plus several slots on later dates; the cook date may be before the plan week.
5. **Shop.** `shopping_generate` for the plan week, review the list with `shopping_get`, adjust with
   `shopping_update` (substitutions, manual items), and check items off in the store.
6. **Record the trip.** `shopping_complete` converts purchases into stock movements, so the pantry
   matches the kitchen.
7. **Cook.** After each meal, `cook_complete` with actual servings (leftover servings stay in the
   fridge as planned slots) and a rating. `cook_history` closes the loop next week.

### Adding a recipe from a URL

MCP clients with web access do the extraction; PantryPal only stores structured data.

1. Fetch the page and read the recipe (ingredients, steps, yield, times, image, source URL).
2. Map each ingredient line to a canonical name. Use `ingredient_search` to reuse existing
   ingredients instead of creating near-duplicates; `ingredient_upsert` for genuinely new ones.
3. Call `recipe_save` with `title`, `servings` (the yield the quantities are written for), optional
   `yieldText`, `times`, `imageUrl`, `sourceUrl`, `mealTypes`, `tags`, `equipment`, `nutrition`,
   `storageNotes`, and the ingredient lines (`qty`, `unit`, `qtyMax` for ranges, `prepNote`,
   `optional`, `scalingExempt` for salt/spices/to-taste) plus ordered `steps`.
4. Add any needed unit conversions with `unit_conversions` (`action: "create"`) if a package unit
   (can, jar, bunch) must compare to the pantry unit.
5. `recipe_check` to confirm it does not violate a rule, then `recipe_set_status` to
   `want_to_try` (or straight to `rotation` if the household already trusts it).

Mark reconstructed or uncertain lines in the recipe `notes` instead of guessing quantities.

### Pantry updates

- Bulk "what I bought": `pantry_update` with `action: "bulk"` and `adjust` lines per ingredient and
  location.
- Recount ("there are about 2 lb of chicken left"): `pantry_update` with `action: "bulk"` and a
  `set` line; keep the approximate flag when the amount is an estimate, and pass `qty: null` when it
  is present but unmeasured.
- Use `reason` consistently (`purchase`, `cook`, `waste`, `adjust`, `verify`) — that is what
  `pantry_history` and later analytics are built on.
- Do not decrement stock manually after cooking if you called `cook_complete`; that tool already
  applies the scaled ingredients.
