# Data import

Import a JSON snapshot with the CLI. This is a one-time load, not a sync tool or
backup format. Use [database backups](../host/backups.md) for restore.

## Load a file

Back up your database first. Run from the repository root:

```sh
pnpm cli seed path/to/household.json
```

For Docker, copy the file into the container first:

```sh
docker compose cp path/to/household.json pantrypal:/tmp/household.json
docker compose exec pantrypal node dist/cli.js seed /tmp/household.json
```

The CLI validates the file. It creates a household if none exists. If one exists,
the import updates its name, timezone, and settings from the file. Members are
added alongside existing members.

The load uses one transaction for the food data. If that transaction fails,
those changes roll back. A household created before the load can remain.

## Format

Use [the format reference](../../seed/FORMAT.md) for fields and allowed values.
Use [`seed/example.json`](../../seed/example.json) as a complete example.

- Include all eight top-level sections, even when an array is empty.
- Refer to ingredients by declared names, not database IDs.
- Refer to recipes and cooks by the keys in the file.
- Use `YYYY-MM-DD` dates and UTC timestamps.
- Use `null` for an unknown amount, not zero.
- Declare every referenced ingredient, recipe, and cook.

The normal load requires no existing ingredients or recipes. `--force` only
skips that check. It is not an overwrite option.

To try the sample safely, follow [Example data](../start/example-data.md).
