# Dietary rules

Dietary rules tell an AI assistant which food to avoid for the household. They
are stored with the household and can be checked against recipes and ingredient
names.

There is no rules screen in the web app. Create, list, change, and delete rules
through an MCP client or the REST API.

Rules are guidance, not an allergy guarantee. See [Limits](#limits).

## What a rule contains

| Field | Meaning |
| --- | --- |
| `scope` | What the rule targets: `ingredient`, `category`, `recipe`, `tag`, or `keyword`. |
| Target | `ingredient` or `ingredientId` for an ingredient, `recipeId` for a recipe, or `targetText` for a category, tag, or keyword. |
| `severity` | `forbidden`, `avoid`, or `limit`. |
| `conditionNote` | An exception the assistant must judge, such as "ok if a minor ingredient". |
| `reason` | Why the rule exists, such as "allergy" or "dislike". |
| `memberId` | The household member it applies to. Null means the whole household. |

An ingredient rule can name an ingredient that does not exist yet. The server
creates the ingredient, so a ban can be recorded before the food is used.

## How matching works

| Scope | Matches |
| --- | --- |
| `ingredient` | That ingredient, by stored ID. |
| `category` | Any ingredient in that category. |
| `recipe` | That recipe. |
| `tag` | A recipe tag with the same text. |
| `keyword` | A whole-word match in the recipe title, ingredient names, aliases, or original ingredient lines. |

A keyword does not match inside a longer word. For example, `ham` does not match
`hamburger`. Multi-word keywords match across spaces or punctuation.

## Add rules

Ask the assistant, or call `rules_manage` directly. Create one ingredient ban:

```json
{
  "action": "create",
  "scope": "ingredient",
  "ingredient": "peanut",
  "severity": "forbidden",
  "reason": "allergy"
}
```

Create a keyword rule with an exception:

```json
{
  "action": "create",
  "scope": "keyword",
  "targetText": "sesame",
  "severity": "avoid",
  "reason": "dislike",
  "conditionNote": "ok if a minor ingredient"
}
```

Use `rules_list` to read the rules. Use `rules_manage` with `action: "update"` or
`action: "delete"` to change them. An update that passes `ingredient` moves an
ingredient rule to that name.

The REST endpoints are `GET /rules`, `POST /rules`, `PATCH /rules/{id}`, and
`DELETE /rules/{id}`. See the [REST API reference](../reference/rest-api.md).

## Check recipes and ingredients

Use `recipe_check` with a recipe ID or slug, or with loose ingredient names. The
result lists every matching rule, with its severity, reason, and condition note.

`ok` is false only when a `forbidden` rule matches and has no condition note.
Rules with a condition note are returned for the assistant to judge. `avoid` and
`limit` matches are reported but do not make `ok` false.

If the recipe has a spice level, the result also compares it with the household
spice level and reports `spice.exceeds`. This does not change `ok`.

For a stored recipe, the check covers all household rules. It does not filter by
`memberId`; the assistant uses the member field when it explains a result. For
loose ingredient names, tag and recipe rules do not apply.

The same check is available at `GET /recipes/{idOrSlug}/check`. Use
`POST /rules/check-ingredients` for loose names.

## Limits

- PantryPal is not a medical device and does not certify food as safe.
- A check only sees stored data: ingredient names, aliases, categories, tags,
  and recipe lines. It cannot read package labels or manufacturer warnings.
- Missing, vague, or misspelled ingredients can be missed. This includes lines
  such as "spices", "stock", or a brand name.
- Cross-contamination, "may contain" warnings, and changes to a product recipe
  are outside the data model.
- The app does not block or label a recipe that matches a rule. No warning
  appears on the recipe, week, or shopping screens. Only a client that asks for
  a check can act on the result.
- The household spice level is separate from rules. Set it through the API or
  MCP with `household_update`.

For a food allergy or a medical diet, read every label and confirm with a
qualified professional. Do not use a rule check as the only safeguard.

## Related pages

- [Common MCP tasks](../connect/tasks.md)
- [MCP tool reference](../reference/mcp-tools.md)
- [Recipes](recipes.md)
