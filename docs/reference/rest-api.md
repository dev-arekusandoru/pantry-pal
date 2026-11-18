# REST API

The JSON API is at `/api/v1`. It uses the same services as MCP.
The running server's `/openapi.json` describes every endpoint, input, and response.

## Connect

| Setup | Base URL |
| --- | --- |
| Docker Compose | `http://localhost:8787/api/v1` |
| Source checkout | `http://localhost:4787/api/v1` |
| Cloudflare Tunnel | `https://pantry.example.com/api/v1` |

Send a bearer token:

```sh
curl -sS http://localhost:8787/api/v1/household \
  -H "Authorization: Bearer $PANTRYPAL_TOKEN"
```

Create a token in **Settings** > **API tokens**, or see [CLI commands](cli.md).

## Authentication

`/api/v1` checks credentials in this order:

1. If an `Authorization` header is present, it must be a valid bearer token. An
   invalid token returns `401`, even if the request also has a session cookie.
2. A valid browser session cookie authenticates the request as its account's
   household. Unsafe methods must also pass the same-origin check.
3. Otherwise the request returns `401`.

`/mcp` always needs a bearer token; it never accepts a session cookie. Each
account owns one household, so a token or session reaches exactly one household.
See [Access and security](../host/security.md).

### Account endpoints

These paths are outside `/api/v1`. They are public, but signup, login, and logout
require the app's own origin.

| Endpoint | Behavior |
| --- | --- |
| `POST /auth/signup` | JSON body `{"email", "password", "householdName"}`. `201`, sets the session cookie, and returns `{"account":{"email"},"household":{"id","name"}}`. `403 forbidden` when signup is closed or the request is cross-origin; `409 conflict` when the email already has an account; `400 validation` for a bad email, a password under 8 characters, or an empty household name; `429 rate_limited` when throttled. |
| `POST /auth/login` | JSON body `{"email", "password"}`. `200` with the same body and a new cookie; `401 unauthorized` on bad credentials (the same answer for an unknown email); `429` when throttled. |
| `POST /auth/logout` | `204`; deletes the session row and clears the cookie. |
| `GET /auth/session` | `{"authenticated":true,"account":{"email"},"household":{"id","name"}}`, or `{"authenticated":false,"signupOpen":boolean}`. Cache-Control is `no-store`. |

The cookie is `__Host-pantrypal_session`, valid for 30 days, `HttpOnly`,
`Secure`, `SameSite=Lax`, and scoped to `/`. Logout or a password reset
invalidates it. Login and signup accept JSON only, limit the body to 8 KiB
(`413`), and allow 10 attempts per 15 minutes per socket peer; behind a proxy,
clients may share the per-peer limit. Safe methods need no origin check; unsafe
cookie-authenticated requests need an `Origin` equal to `Host`, over HTTPS except
for loopback development. `X-Forwarded-Host` is ignored and
`Sec-Fetch-Site: cross-site` is rejected.

`GET /health` and `GET /openapi.json` are public. `/api/v1/health` uses API auth.

## Endpoint groups

Paths below are relative to `/api/v1`.

| Path | Tasks |
| --- | --- |
| `/household`, `/household/members` | Read and update settings and members |
| `/tokens` | List, create, and revoke API tokens. Needs a browser session; a bearer token gets `403`. The secret is only in the create response |
| `/ingredients` | Find, create, update, archive, alias, and merge ingredients; set an ingredient's USDA food |
| `/unit-conversions`, `/units/convert` | Manage conversions and convert amounts |
| `/pantry` | Read stock, set amounts, record changes, and check availability |
| `/recipes` | Manage recipes and step ingredient links, scale servings, read nutrition, check rules, and set status |
| `/nutrition` | Search the bundled USDA foods |
| `/rules` | Manage dietary rules and check ingredient lists |
| `/plans` | Manage week plans, meal slots, dishes, swaps, cooks, and prep tasks |
| `/cook-events` | Create, complete, reopen, and undo cooks |
| `/prep-tasks` | Update or complete prep tasks |
| `/shopping-lists` | Generate lists, check items, and record purchases |

## Conventions

- Send JSON bodies with `Content-Type: application/json`.
- Fields use camelCase. Dates use `YYYY-MM-DD`; timestamps use ISO 8601.
- Reuse returned IDs. Do not construct them.
- Boolean query values are `true` or `false`.
- An unknown stock amount is not zero. Check its status as well as its quantity.
- Use server calculations for conversions, servings, demand, and shopping amounts.

Most lists return `{"items": [...]}`. Recipes also return `total`, `limit`, and
`offset`. Pantry movements use `limit` and `before` for older entries. Shopping
list detail returns `list`, `items`, `groups`, `counts`, and `runningLow`.

### Recipe step links

Recipe create and update bodies accept `steps[].links`. Each link has an
`ingredientIndex` and an optional `qty`:

- `ingredientIndex` is the zero-based position in the same payload's
  `ingredients` array. When a patch sends only `steps`, it uses the stored line
  order.
- `qty` uses the linked line's unit. `null` or omitted means the whole line.
- The server rejects an index that does not point to a line of the same recipe.
- If `ingredients` is replaced without `steps`, the links are removed.

Recipe read returns the links on each step as `links[]`, with `ingredientName`,
`qty`, `unit`, `prepNote`, and `position`. The recipe also returns
`cookEventCount`; `DELETE /recipes/{idOrSlug}` conflicts when it is greater than
zero.

### Recipe nutrition

Nutrition comes from the bundled USDA FoodData Central data. See
[Nutrition](../use/nutrition.md) for what the web app shows.

| Endpoint | Purpose |
| --- | --- |
| `GET /recipes/{idOrSlug}/nutrition` | Calories, protein, carbs, fat, fiber, sugar, and sodium for the recipe and per serving, with one entry for each ingredient line. |
| `GET /nutrition/foods?q=&limit=` | Search USDA foods by name, best match first. `limit` is 1 to 50; the default is 10. |
| `PUT /ingredients/{id}/nutrition` | Set the ingredient's USDA food. Returns the ingredient. |

The recipe response has these fields:

- `total` and `perServing` hold `calories` (kcal), `protein`, `carbs`, `fat`,
  `fiber`, `sugar` (g), and `sodium` (mg). A value is `null` when no counted line
  has it. `perServing` is `null` when the recipe has no servings.
- `countedLines` and `missingLines` count the non-optional lines that have, and
  do not have, a calculated value.
- `source` names the dataset. `lines[]` has `qty`, `qtyMax`, `unit`, `grams`,
  the matched `food`, `nutrients`, and a `status`.

A line `status` is one of these. The server checks them in this order:

| `status` | Meaning |
| --- | --- |
| `optional` | The line is optional. It is not counted. |
| `no_quantity` | The line has no quantity. |
| `no_match` | The ingredient has no USDA food. |
| `no_conversion` | The amount cannot be turned into grams. |
| `ok` | The line is counted in the totals. |

A quantity range uses its middle. The server converts to grams with the
household unit conversions first, then with the portions of the USDA food.

Food search items have `fdcId`, `description`, `dataType`, `per100g`,
`portions`, and a `score` from 0 to 1. Nutrients are for 100 g.

`PUT /ingredients/{id}/nutrition` takes one of these bodies:

| Body | Effect |
| --- | --- |
| `{"mode": "auto"}` | Run the name match again. |
| `{"mode": "manual", "fdcId": 170000}` | Use this USDA food. An unknown `fdcId` returns `not_found`. |
| `{"mode": "manual", "fdcId": null}` | Clear the match. The ingredient is not matched again by itself. |

The ingredient view has a `nutrition` field: `null` when no food is matched, or
`{source, fdcId, description, per100g}`. `source` is `auto` or `manual`. After
a manual clear, `source` is `manual` and `fdcId` is `null`. The match belongs to
the ingredient, so it applies to every recipe that uses it.

Write and delete responses vary. Use the response schema for the endpoint.

## Errors

```json
{"error":{"code":"not_found","message":"Recipe not found","details":{}}}
```

`details` is optional. Use the code, not the message text, in client logic.

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `validation` | 400, 413 | Invalid body, path, or query; login body over 4 KiB |
| `unauthorized` | 401 | Missing, invalid, or revoked token; missing or invalid browser session; wrong password |
| `forbidden` | 403 | Cross-origin login, logout, or unsafe cookie request; token management with a bearer token |
| `not_found` | 404 | No matching record in this household, or browser login is not configured |
| `conflict` | 409 | A conflict with current data |
| `unsupported_media_type` | 415 | Login body is not `application/json` |
| `unprocessable` | 422 | Valid input that cannot be applied |
| `rate_limited` | 429 | Too many failed logins; retry after `Retry-After` seconds |
| `unavailable` | 503 | A required resource is not ready, such as the household |
| `internal` | 500 | Unexpected server error |

## OpenAPI

Download the schema from a running server:

```sh
curl -sS http://localhost:8787/openapi.json -o pantrypal-openapi.json
```

To update the committed schema and web client types from source:

```sh
pnpm openapi
```

This writes [`web/openapi.json`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/web/openapi.json) and
[`web/src/api/schema.d.ts`](https://github.com/dev-arekusandoru/pantry-pal/blob/main/web/src/api/schema.d.ts).
Do not edit those files by hand.

The web client uses `openapi-fetch`. Its base URL is `/api/v1`; its generated
paths omit that prefix. The OpenAPI document keeps the full paths and has no
`servers` entry. Set the base URL when you generate another client.

Next: [MCP tools](mcp-tools.md) · [Architecture](../develop/architecture.md)
