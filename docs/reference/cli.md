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
| `household init --name "Our House" --timezone Europe/London` | Create an empty household |
| `household show` | Show a household |
| `account create --email you@example.com --household "Our House"` | Create an account and a new household |
| `account create --email you@example.com --household-id HH_ID` | Create an account for an existing household |
| `account reset-password you@example.com` | Set a new password and end that account's sessions |
| `account list` | List accounts and their households |
| `token create --name assistant` | Create a token; copy the secret now |
| `token list` | List token IDs and usage, without secrets |
| `token revoke TOKEN_ID` | Revoke a token by its ID, not its secret |
| `seed seed/example.json` | Import a household snapshot |

`--timezone` is optional when you create a household. The default is UTC.

`account create` asks for the password twice. Pipe it instead on a headless
host:

```sh
printf '%s\n' "$PANTRYPAL_NEW_PASSWORD" | pnpm cli account create \
  --email you@example.com --household "Our House" --password-stdin
```

`account reset-password` also accepts `--password-stdin`.

## Select a household

`household show`, `token create`, `token list`, `token revoke`, and `seed` need a
household. Choose it in one of these ways:

1. `--household-id HH_ID`.
2. `--email you@example.com` for the household owned by that account.
3. Nothing, when the instance has exactly one household.

With more than one household and no selector, the command fails and asks for one.

## Migrate a single-household install

Older versions had one household and an optional shared password. After you
upgrade:

1. Find the household id: `pnpm cli household show`.
2. Create the owner account for it:

   ```sh
   pnpm cli account create --email you@example.com --household-id hh_...
   ```

3. Remove the old shared-password and network-trust variables from your `.env`
   or Compose environment; they no longer do anything. Set
   `PANTRYPAL_SIGNUP=closed` if no one else should sign up.
4. Restart the app and sign in. The household's data, tokens, and members stay
   with the household.

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
