# Self-hosting PantryPal

PantryPal is one Node process, one HTTP port and one SQLite file. It has no external services to
run: no Postgres, no Redis, no queue. That makes self-hosting mostly a matter of giving it a
directory it can write to and putting TLS in front of it.

## Requirements

- Docker with Compose (or Node 22+ and pnpm if you prefer to run it without a container)
- A writable directory for the database
- A domain + TLS termination if MCP clients or a browser will connect from another machine

## Run with Docker Compose

```sh
git clone https://github.com/<you>/pantrypal.git
cd pantrypal
docker compose up -d --build
docker compose exec pantrypal node dist/cli.js household init --name "Our House" --timezone America/New_York
docker compose exec pantrypal node dist/cli.js token create --name chef
```

`docker-compose.yml` publishes `8787`, sets `PANTRYPAL_DB_PATH=/data/pantrypal.db`, and bind-mounts
`./data` at `/data`.

The container runs as the unprivileged `node` user (uid 1000). If your host user has a different
uid, make the data directory writable by uid 1000:

```sh
mkdir -p data && sudo chown -R 1000:1000 data
```

### Without Compose

```sh
docker build -t pantrypal:dev .
docker run -d --name pantrypal \
  -p 8787:8787 \
  -v "$PWD/data:/data" \
  -e PANTRYPAL_DB_PATH=/data/pantrypal.db \
  --restart unless-stopped \
  pantrypal:dev
```

Then run the same CLI commands with `docker exec pantrypal node dist/cli.js …`.

### Without Docker

```sh
pnpm install
PANTRYPAL_DB_PATH=/srv/pantrypal/pantrypal.db pnpm build
PANTRYPAL_DB_PATH=/srv/pantrypal/pantrypal.db node dist/cli.js household init --name "Our House"
PANTRYPAL_DB_PATH=/srv/pantrypal/pantrypal.db node dist/cli.js token create --name chef
PANTRYPAL_DB_PATH=/srv/pantrypal/pantrypal.db node dist/server.js
```

Use a process supervisor (systemd, runit, s6) to keep it running; the server handles `SIGTERM` and
closes the database cleanly.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PANTRYPAL_DB_PATH` | `./data/pantrypal.db` (image: `/data/pantrypal.db`) | SQLite file; its directory is created on start |
| `PORT` | `8787` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `PANTRYPAL_TRUST_NETWORK` | unset (off) | `1` or `true` lets `/api/v1/*` requests without a token act as the household (see below). Never applies to `/mcp` |
| `PANTRYPAL_WEB_DIR` | `web/dist` under the app root | Directory of the built web app served at `/`. If it has no `index.html`, only the API is served and the startup log says so |

## Web app and network trust

The server serves the web app at `/` (client routes fall back to `index.html`; `/api`, `/mcp`,
`/health` and `/openapi.json` are never shadowed). Hashed files under `/assets/` are cached for a
year; `index.html` is always revalidated.

The browser calls `/api/v1/*` same-origin and has no login, so run it with
`PANTRYPAL_TRUST_NETWORK=1`: requests without an `Authorization` header then act as the household.
**Anyone who can reach the port can read and change your data**, so only turn this on when the port
is reachable only by people you trust, such as a tailnet:

```sh
# on the host; gives you https://<box>.<tailnet>.ts.net (HTTPS is needed for the cook-mode wake lock)
tailscale serve --bg 8787
```

Bind the published port to loopback as shown under [Reverse proxy and TLS](#reverse-proxy-and-tls)
so only the proxy reaches it. A request that does send a token is still verified (a bad token is a
401), `/mcp` always requires a token, and the flag is off by default. If the database has no
household yet, trusted requests get a `503` with code `unavailable`; run `household init` first.

## Volumes and backups

Everything durable is in the SQLite database plus its WAL sidecars (`pantrypal.db`,
`pantrypal.db-wal`, `pantrypal.db-shm`). Keep `/data` on a real filesystem — not on a network share
SQLite cannot lock reliably.

### Consistent copy (preferred)

Stop the container first; the server checkpoints and closes the database on shutdown:

```sh
docker compose stop pantrypal
tar -czf "pantrypal-backup-$(date +%F).tar.gz" data/
docker compose start pantrypal
```

### Online backup

To avoid downtime, let SQLite copy itself. The runtime image ships `better-sqlite3`, which has a
built-in online backup API:

```sh
docker compose exec pantrypal node -e "
  const Database = require('better-sqlite3');
  const db = new Database(process.env.PANTRYPAL_DB_PATH, { readonly: true });
  db.backup('/data/pantrypal-backup.db').then(() => { db.close(); process.exit(0); });
"
docker compose cp pantrypal:/data/pantrypal-backup.db ./pantrypal-backup.db
```

If you have the `sqlite3` CLI on the host, `sqlite3 /path/pantrypal.db ".backup '/path/copy.db'"`
against a live file is equivalent. Never copy only the `.db` file while WAL sidecars are present and
the server is running — you may capture a torn state.

### Restore

```sh
docker compose stop pantrypal
rm -f data/pantrypal.db data/pantrypal.db-wal data/pantrypal.db-shm
cp pantrypal-backup.db data/pantrypal.db
sudo chown 1000:1000 data/pantrypal.db
docker compose start pantrypal
```

## Reverse proxy and TLS

MCP clients (Claude, IDE agents, scripts) talk to `/mcp` over the network with a bearer token in a
header, so expose the service over HTTPS and do not send tokens over plain HTTP beyond localhost.
Bind the published port to loopback so only the proxy can reach it — edit the mapping in
`docker-compose.yml`:

```yaml
    ports:
      - "127.0.0.1:8787:8787"
```

```caddyfile
# Caddyfile — provisions and renews the certificate automatically
food.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
}
```

Caddy passes the `Authorization` header through untouched, which is all PantryPal needs. Keep
request bodies unmodified; MCP Streamable HTTP uses POST bodies and can hold an SSE stream open, so
disable proxy buffering if you use nginx instead:

```nginx
location / {
	proxy_pass http://127.0.0.1:8787;
	proxy_http_version 1.1;
	proxy_set_header Host $host;
	proxy_set_header Authorization $http_authorization;
	proxy_buffering off;
	proxy_read_timeout 3600s;
}
```

Verify with:

```sh
curl https://food.example.com/health
curl -H "Authorization: Bearer $PANTRYPAL_TOKEN" https://food.example.com/api/v1/household
```

## Token management

Tokens are the only authentication mechanism in v1 (OAuth is on the backlog). Rules of thumb:

- One token per client (laptop agent, phone shortcut, web frontend) so revoking one does not break
  the others. Name them accordingly.
- The secret is shown once at creation; only a SHA-256 hash and a prefix are stored.
- A token is scoped to the household that created it. Rotate by creating a new token, deploying it,
  then revoking the old one.

```sh
docker compose exec pantrypal node dist/cli.js token list
docker compose exec pantrypal node dist/cli.js token create --name claude-desktop
docker compose exec pantrypal node dist/cli.js token revoke tok_xxxxxxxxxxxx
```

`token list` shows `lastUsedAt`, which is handy for spotting tokens nobody has touched. Do not put
tokens in URLs or commit them to a repository; the CLI writes them to stdout only.

## Upgrades

```sh
docker compose stop pantrypal
tar -czf "pantrypal-backup-$(date +%F).tar.gz" data/   # always: migrations are forward-only
git pull
docker compose up -d --build
docker compose logs -f pantrypal
```

Pending migrations run automatically on startup (and before every CLI command), in order, from the
`drizzle/` folder baked into the image. There is no separate migrate step. If a release needs manual
intervention it will say so in its release notes; otherwise the new container simply opens the
existing database and upgrades it.

Rolling back an image does not roll back the schema: restore the backup you took above.

## Operations

| Task | Command |
|---|---|
| Logs | `docker compose logs -f pantrypal` |
| Health | `curl localhost:8787/health` (public, returns `{ok, version}`) |
| Container health | `docker inspect --format '{{.State.Health.Status}}' pantrypal` (image has a `HEALTHCHECK` on `/health`) |
| OpenAPI document | `curl localhost:8787/openapi.json` |
| Shell in the container | `docker compose exec pantrypal sh` |

There is no metrics endpoint and no admin UI in v1. The SQLite file is small (a household state is
well under a few MB) and the process is idle when nobody is calling it.
