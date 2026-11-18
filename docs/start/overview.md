# Overview

PantryPal keeps a household's food stock, recipes, meal plans, and shopping lists
in one place. Run it on your server. Use the web app or connect an AI assistant
through MCP.

## What you can do

| Task | Guide |
| --- | --- |
| Record food amounts and expiry dates | [Pantry](../use/pantry.md) |
| Scale recipes and follow cooking steps | [Recipes](../use/recipes.md) |
| Arrange meals, leftovers, and prep tasks | [Meal plans](../use/meal-plans.md) |
| Build a list from your plan and stock | [Shopping](../use/shopping.md) |
| Check recipes against household preferences | [Dietary rules](../use/dietary-rules.md) |
| Let an assistant read and change household data | [MCP setup](../connect/setup.md) |

The guides mark tasks that need the API or MCP rather than the web app.

## Limits

- Each account owns one household. There are no roles inside a household.
- One server process per SQLite database. Store the database on a local disk.
- The web app signs in with an account. API and MCP clients use bearer tokens
  that grant full access to their household.
- Public installs need HTTPS and, after you create your accounts,
  `PANTRYPAL_SIGNUP=closed`.
- No built-in HTTPS or database encryption. Protect the host and network.
- An unknown stock amount is not zero. Some amounts need a kitchen check.

Start with [Install](install.md). Read [Access and security](../host/security.md)
before you allow remote access. For internet access, use
[Cloudflare Tunnel](../host/tunnel.md).
