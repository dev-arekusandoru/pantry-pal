# Configuration

PantryPal reads its settings from environment variables. It has no configuration file. Settings that belong to the household, such as the timezone and default servings, are stored in the database. Change those in the web app or API.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PANTRYPAL_DB_PATH` | `./data/pantrypal.db`; image: `/data/pantrypal.db` | SQLite file. The parent directory is created if needed. Use the same path for the server and the CLI. |
| `PORT` | Source: `4787`; image: `8787` | HTTP listen port. |
| `HOST` | `0.0.0.0` | HTTP bind address. `127.0.0.1` accepts only local connections. |
| `PANTRYPAL_PASSWORD` | Unset; off | Shared browser password. Enables `/auth/*` and makes `/api/v1` accept the session cookie. Bearer tokens still work. Changing it invalidates all browser sessions. |
| `PANTRYPAL_REQUIRE_PASSWORD` | Off | `1` or `true` makes startup fail when `PANTRYPAL_PASSWORD` is unset. Use it for any public deployment. |
| `PANTRYPAL_TRUST_NETWORK` | Off; the Compose override sets `1` | `1` or `true` lets `/api/v1` requests without an `Authorization` header act as the household. Ignored when `PANTRYPAL_PASSWORD` is set. `/mcp` always needs a token. |
| `PANTRYPAL_WEB_DIR` | `web/dist` under the app root | Built web app directory. If it has no `index.html`, the server serves the API only and writes a log line. |

No other variables are required for normal use. The tunnel stack also reads `CLOUDFLARE_TUNNEL_TOKEN` from `.env`; the app does not read that variable.

## Authentication modes

- With `PANTRYPAL_PASSWORD` set, the browser uses `/auth/login`. `/api/v1` accepts a bearer token or a valid session cookie. Anonymous network trust is disabled, even if `PANTRYPAL_TRUST_NETWORK=1`.
- Without a password, `PANTRYPAL_TRUST_NETWORK=1` lets `/api/v1` requests without a token act as the household. The web app has no login and relies on this mode or a proxy.
- `/mcp` always requires a bearer token. It never accepts a browser session or network trust.
- A sent `Authorization` header is always checked first. An invalid token returns `401`, even with a valid session cookie.

Use `PANTRYPAL_REQUIRE_PASSWORD=1` on a public instance so a missing password stops startup. See [Access and security](security.md).

## Set values

For Compose, edit the `environment` block. With the default stack, `docker-compose.override.yml` sets `PANTRYPAL_TRUST_NETWORK` and the port binding. Change those values in the override; the base file is merged under it. Run `docker compose up -d` after a change so Compose recreates the container. `docker compose restart` keeps the old environment.

For the tunnel stack, edit `.env` at the repository root. Compose reads it for interpolation, and `docker-compose.tunnel.yml` passes the values into the container. See [Public access with Cloudflare Tunnel](tunnel.md).

For a source run, set the variables in the shell before `pnpm start`:

```sh
HOST=127.0.0.1 PORT=8787 PANTRYPAL_TRUST_NETWORK=0 pnpm start
```

To use browser login from source instead:

```sh
HOST=127.0.0.1 PANTRYPAL_PASSWORD='a long random password' PANTRYPAL_REQUIRE_PASSWORD=1 pnpm start
```

A plain source run does not read `.env`. Export the variable first, or use `node --env-file=.env dist/server.js`.

Use `docker compose config` to see the merged Compose settings, including the override.

## Ports and addresses

The default stack publishes `127.0.0.1:8787` on the host. The left side is the host address and port. The right side is the container port. The tunnel stack publishes no ports; Cloudflare reaches it over a private Compose network. See [Public access with Cloudflare Tunnel](tunnel.md). To use host port 9000, edit the `ports` entry in `docker-compose.override.yml`:

```yaml
ports: !override
  - "127.0.0.1:9000:8787"
```

Open `http://127.0.0.1:9000`. Change only the host side unless you also change `PORT`.

If you change `PORT` in the container, update both the mapping and the environment. For example, `PORT=9000` with `127.0.0.1:8787:9000`. The image healthcheck reads `PORT`.

Keep `HOST=0.0.0.0` inside the container. Docker forwards the published port to the container network. Set `HOST=127.0.0.1` only for a source run that should accept local connections.

The base file without the override publishes `8787` on all interfaces. See [Install PantryPal](../start/install.md) and [Access and security](security.md).

## Data directory

Compose bind-mounts `./data` to `/data`. The database uses WAL, so the directory can contain `pantrypal.db`, `pantrypal.db-wal`, and `pantrypal.db-shm`. Keep the directory on a local filesystem. SQLite locking over NFS or SMB is not reliable.

The image runs as uid 1000. The host directory must be writable by that user. See [Install PantryPal](../start/install.md).

Back up the whole directory, not one file. See [Backups and restore](backups.md).

## Web app

The image includes the built web app. The server serves it at `/`, with a fallback to `index.html` for client routes. The `/auth` endpoints, `/api`, `/mcp`, `/health`, and `/openapi.json` are handled before the web app.

For a source run, `pnpm build` builds the web app as well as the server. `pnpm build:server` builds only the server. Use `PANTRYPAL_WEB_DIR` to serve a build from another directory.

## Migrations

Pending migrations run automatically when the server starts and before every CLI command that opens the database. There is no separate migrate step or setting. See [Update PantryPal](updates.md).
