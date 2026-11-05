# REST API

The JSON API is at `/api/v1`. It uses the same services as MCP.
The running server's `/openapi.json` describes every endpoint, input, and response.

## Connect

| Setup | Base URL |
| --- | --- |
| Docker Compose | `http://localhost:8787/api/v1` |
| Source checkout | `http://localhost:4787/api/v1` |

Send a bearer token:

```sh
curl -sS http://localhost:8787/api/v1/household \
  -H "Authorization: Bearer $PANTRYPAL_TOKEN"
```

See [CLI commands](cli.md) to create a token. On a trusted network, the operator
can allow requests without a token. See [Access and security](../host/security.md).
A token that is sent is still checked.

`GET /health` and `GET /openapi.json` are public. `/api/v1/health` uses API auth.

## Endpoint groups

Paths below are relative to `/api/v1`.

| Path | Tasks |
| --- | --- |
| `/household`, `/household/members` | Read and update settings and members |
| `/ingredients` | Find, create, update, archive, alias, and merge ingredients |
| `/unit-conversions`, `/units/convert` | Manage conversions and convert amounts |
| `/pantry` | Read stock, set amounts, record changes, and check availability |
| `/recipes` | Manage recipes, scale servings, check rules, and set status |
| `/rules` | Manage dietary rules and check ingredient lists |
| `/plans` | Manage week plans, meal slots, swaps, cooks, and prep tasks |
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
list detail returns `list`, `items`, `groups`, and `counts`.

Write and delete responses vary. Use the response schema for the endpoint.

## Errors

```json
{"error":{"code":"not_found","message":"Recipe not found","details":{}}}
```

`details` is optional. Use the code, not the message text, in client logic.

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `validation` | 400 | Invalid body, path, or query |
| `unauthorized` | 401 | Missing, invalid, or revoked token |
| `not_found` | 404 | No matching record in this household |
| `conflict` | 409 | A conflict with current data |
| `unprocessable` | 422 | Valid input that cannot be applied |
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

This writes [`web/openapi.json`](../../web/openapi.json) and
[`web/src/api/schema.d.ts`](../../web/src/api/schema.d.ts).
Do not edit those files by hand.

The web client uses `openapi-fetch`. Its base URL is `/api/v1`; its generated
paths omit that prefix. The OpenAPI document keeps the full paths and has no
`servers` entry. Set the base URL when you generate another client.

Next: [MCP tools](mcp-tools.md) · [Architecture](../develop/architecture.md)
