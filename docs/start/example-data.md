# Example data

The repository includes `seed/example.json`, a synthetic household snapshot. Use it to try the web app, API, or MCP tools before you enter your own food.

The file contains a household, ingredients, unit conversions, pantry stock, dietary rules, recipes, one meal plan, and one completed shopping list. The plan uses the week of 2026-02-02, so it is a sample, not the current week. See [`seed/FORMAT.md`](../../seed/FORMAT.md) for every field. This is a one-time import, not a backup or sync format.

The Compose commands below use the default stack. If you run the base file only, add `-f docker-compose.yml` to each Compose command.

## Before you load

- Use a fresh database. The seed creates the household from the file.
- If a household exists but has no ingredients or recipes, the seed updates its name, timezone, and settings from the file and adds the sample members. It never clears existing food.
- The seed refuses to run when the household already has ingredients or recipes. `--force` skips that check only. It does not replace or merge data safely.

For the import rules and `--force` behavior, see [Data import](../reference/import.md).

## Load the sample in Docker

```sh
docker compose exec pantrypal node dist/cli.js seed seed/example.json
```

The image includes the file at `/app/seed/example.json`. The container working directory is `/app`, so the relative path works. The command prints a summary and any warnings.

The seed creates the household but no API token. Create one for the API or MCP:

```sh
docker compose exec pantrypal node dist/cli.js token create --name demo
```

With the default Compose stack, open [http://127.0.0.1:8787](http://127.0.0.1:8787). Network trust lets the web app use the API. MCP always needs the token. See [Connect an AI assistant](../connect/setup.md).

## Load the sample from source

```sh
pnpm cli seed seed/example.json
```

Run the command from the repository root. The default database is `./data/pantrypal.db`. Use `--db` or `PANTRYPAL_DB_PATH` to choose another database.

## Start over with an empty database

The seed is not a reset tool. To remove the sample, preserve the old data directory and create a new one:

```sh
docker compose stop pantrypal
mv data "data.example-$(date +%F-%H%M%S)"
mkdir data
sudo chown -R 1000:1000 data
docker compose up -d --force-recreate
```

This keeps the old directory until you decide you do not need it. Do not delete it in place. Then create a household or load another seed.

## After the sample

Use the web app or API to change stock, recipes, and plans. See [Pantry](../use/pantry.md), [Recipes](../use/recipes.md), [Meal plans](../use/meal-plans.md), and [Shopping](../use/shopping.md). To import your own data, see [Data import](../reference/import.md).
