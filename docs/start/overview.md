# Overview

PantryPal keeps a household's food stock, recipes, meal plans, and shopping lists
in one place. Run it on your server. Use the web app or connect an AI assistant
through MCP.

## What you can do

| Task | Guide |
| --- | --- |
| Record food amounts and storage locations | [Pantry](../use/pantry.md) |
| Scale recipes and follow cooking steps | [Recipes](../use/recipes.md) |
| Arrange meals, leftovers, and prep tasks | [Meal plans](../use/meal-plans.md) |
| Build a list from your plan and stock | [Shopping](../use/shopping.md) |
| Check recipes against household preferences | [Dietary rules](../use/dietary-rules.md) |
| Let an assistant read and change household data | [MCP setup](../connect/setup.md) |

The guides mark tasks that need the API or MCP rather than the web app.

## Limits

- One household per instance. No separate users or access roles.
- One server process per SQLite database. Store the database on a local disk.
- The web app can use one shared password. Everyone with the password has full
  access. API and MCP clients use bearer tokens.
- Local and private installs can run without a password on a trusted network.
  Public installs need HTTPS and the password.
- No built-in HTTPS or database encryption. Protect the host and network.
- An unknown stock amount is not zero. Some amounts need a kitchen check.

Start with [Install](install.md). Read [Access and security](../host/security.md)
before you allow remote access. For internet access, use
[Cloudflare Tunnel](../host/tunnel.md).
