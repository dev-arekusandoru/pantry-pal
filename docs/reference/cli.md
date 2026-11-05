# CLI commands

Run the CLI from the repository root. It uses the database directly; it does
not call the HTTP API or need a bearer token.

| Setup | Command prefix |
| --- | --- |
| Source checkout | `pnpm cli` |
| Built app | `node dist/cli.js` |
| Docker Compose | `docker compose exec pantrypal node dist/cli.js` |

Use one prefix with the commands below.

## Commands

| Command | Purpose |
| --- | --- |
| `--help` | Show command help |
| `migrate` | Apply pending database migrations |
| `household init --name "Our House" --timezone Europe/London` | Create the instance's household |
| `household show` | Show the household |
| `token create --name assistant` | Create a token; copy the secret now |
| `token list` | List token IDs and usage, without secrets |
| `token revoke TOKEN_ID` | Revoke a token by its ID, not its secret |
| `seed seed/example.json` | Import a household snapshot |

`--timezone` is optional when you create a household. The default is UTC.
An instance supports one household. A second `household init` fails.

## Select a database

The path is chosen in this order:

1. `--db PATH`.
2. `PANTRYPAL_DB_PATH`.
3. `./data/pantrypal.db`.

For example:

```sh
pnpm cli --db /tmp/pantrypal-demo.db household show
```

The container sets `PANTRYPAL_DB_PATH=/data/pantrypal.db`. Use the same database
path for the CLI and server. Each command that opens the database applies pending
migrations first. Help does not open the database.

## Import guard

`seed` refuses to run if the household has ingredients or recipes.
`--force` skips this guard. It does not clear, replace, or merge existing data;
name conflicts can still fail. Back up before any import.

See [Data import](import.md) and [Access and security](../host/security.md).
