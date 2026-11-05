# Self-hosting PantryPal

PantryPal is one Node process, one HTTP port and one SQLite file. It has no external services to
run: no Postgres, no Redis, no queue. That makes self-hosting mostly a matter of giving it a
directory it can write to and putting TLS in front of it.

## Requirements

- Docker with Compose (or Node 22+ and pnpm if you prefer to run it without a container)
- A writable directory for the database
- A domain + TLS termination if MCP clients or a browser will connect from another machine

Two deployment shapes are supported:

- **Local or private network** — `docker-compose.yml`, optionally with
  `PANTRYPAL_TRUST_NETWORK=1`. No login; only suitable when the port is reachable only by people
  you trust. This is what the quick start below uses.
- **Public production** — `docker-compose.tunnel.yml`, a Cloudflare Tunnel plus a shared browser
  password. No inbound ports, no port forwarding. This is the
  [recommended way to expose PantryPal](#public-deployment-with-cloudflare-tunnel-and-password-login)
  on the internet.

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

## Public deployment with Cloudflare Tunnel and password login

`docker-compose.tunnel.yml` is a standalone production stack:

- `pantrypal` builds the app and publishes **no host ports**.
- `cloudflared` runs a dashboard-managed Cloudflare Tunnel and reaches the app over the private
  compose network at `http://pantrypal:8787`.
- No `rakazo` (or any other pre-existing Docker) network is required, so this stack starts on any
  Docker host; `cloudflared` still needs outbound HTTPS to Cloudflare.
- The browser UI is protected by a shared password (`PANTRYPAL_PASSWORD`), independent of API/MCP
  bearer tokens.

It is deliberately a separate file: invoke it with `-f` so Compose reads it instead of the local
`docker-compose.yml` and does **not** merge `docker-compose.override.yml` (which enables network
trust and publishes a loopback port).

### 1. Create the tunnel in Cloudflare

You need a domain whose DNS is managed by Cloudflare. In the Cloudflare dashboard:

1. Go to **Zero Trust → Networks → Tunnels → Create a tunnel**, choose **Cloudflared**, and name it
   (for example `pantrypal`).
2. On the connector install screen, copy the **tunnel token**. Do not run the install command on the
   host — the container consumes the token instead.
3. Under **Public Hostnames → Add a public hostname**, set:
   - **Subdomain**: `pantry`
   - **Domain**: `casamuresan.com`
   - **Path**: leave empty
   - **Service type**: `HTTP`
   - **URL**: `pantrypal:8787`
4. Save. Cloudflare creates the DNS record and routes
   `https://pantry.casamuresan.com` to the container through the tunnel.

The public URL is HTTPS at the edge; traffic between `cloudflared` and PantryPal is plain HTTP
inside the private Docker network because the public hostname's service type is explicitly `HTTP`.
No zone-wide SSL/TLS encryption-mode change is needed for this origin. Keep the origin port
unpublished, do not add an `A`/`AAAA` record pointing at the host, and do not forward ports on the
router: `cloudflared` only makes outbound connections. `Always Use HTTPS` is a zone-wide setting; if
you want to force HTTPS for this hostname, use a hostname-scoped redirect rule instead of changing
the zone setting for every hostname.

**Do not put Cloudflare Access in front of this hostname.** PantryPal authenticates browsers itself,
and `/mcp` only understands `Authorization: Bearer` requests. An Access application would prompt or
block MCP clients before their bearer token is ever seen. The app-level password is the gate for the
browser UI; bearer tokens are the gate for API and MCP clients.

### 2. Configure secrets

From the repository root:

```sh
cp .env.example .env
chmod 600 .env
```

Edit `.env` and set both values:

```dotenv
PANTRYPAL_PASSWORD='a long random shared password'
CLOUDFLARE_TUNNEL_TOKEN='the token copied from the tunnel dashboard'
```

Generate the password with `openssl rand -base64 32`. Single quotes protect `$` from Compose
interpolation. `.env` is git-ignored; `.env.example` contains placeholders only and is safe to
commit. Never put real secrets in `docker-compose.tunnel.yml`.

### 3. Start the stack

If the local stack is running, stop it first so two processes do not open the same SQLite file. If
this host already has data, back it up while the app is stopped:

```sh
docker compose down                                    # stop the local stack; data/ is untouched
tar -czf "pantrypal-backup-$(date +%F).tar.gz" data/   # if this instance already has data
```

Then start the tunnel stack:

```sh
docker compose -f docker-compose.tunnel.yml up -d --build
```

Compose loads `.env` automatically. Both variables use `:?` interpolation, so if either is missing
the command aborts before creating a container. `PANTRYPAL_REQUIRE_PASSWORD=true` is also set, so
the server refuses to start rather than serving a password-less browser UI. Password mode overrides
`PANTRYPAL_TRUST_NETWORK`; the tunnel file sets it to `0` as well.

The tunnel stack bind-mounts the same `./data` directory, so an existing database is reused in
place. The directory must be writable by the container's `node` user (uid 1000):

```sh
mkdir -p data && sudo chown -R 1000:1000 data   # only if needed
```

### 4. Initialize a fresh instance

Skip this when `./data/pantrypal.db` already contains your household. For a brand-new database:

```sh
docker compose -f docker-compose.tunnel.yml exec pantrypal \
  node dist/cli.js household init --name "Our House" --timezone America/New_York

# One bearer token per MCP client. The secret is printed once.
docker compose -f docker-compose.tunnel.yml exec pantrypal \
  node dist/cli.js token create --name claude-desktop
```

Optionally import the synthetic example instead of starting empty:
`docker compose -f docker-compose.tunnel.yml exec pantrypal node dist/cli.js seed seed/example.json`.
Migrations run automatically on startup, so no separate migrate step is needed.

### 5. Verify the deployment

```sh
docker compose -f docker-compose.tunnel.yml ps          # both services running; pantrypal healthy
docker compose -f docker-compose.tunnel.yml logs -f cloudflared   # "Registered tunnel connection"
curl -fsS https://pantry.casamuresan.com/health                   # {"ok":true,...}
curl -fsS https://pantry.casamuresan.com/auth/session             # {"enabled":true,"authenticated":false}
```

Open `https://pantry.casamuresan.com/login` (or any app URL) in a browser and enter the password.
After login the household loads; the `__Host-pantrypal_session` cookie lasts 30 days, is `HttpOnly`
+ `Secure` (the public URL is HTTPS) and is scoped to `/`. Use **Settings → Log out** to verify that
logout clears the cookie and returns to the login screen; closing the tab is not logout. A wrong
password is rejected and repeated failures return `429`, so do not retry in a loop. Browser login is
the recommended verification path; scripting the password through `curl` risks leaking it in shell
history or the process list.

Bearer access stays independent of the browser password:

```sh
curl -fsS -H "Authorization: Bearer $PANTRYPAL_TOKEN" \
  https://pantry.casamuresan.com/api/v1/household
```

Point an MCP client at `https://pantry.casamuresan.com/mcp` with the same bearer token; see
[docs/mcp.md](mcp.md). The browser cookie is not accepted by `/mcp`.

### 6. Update and rotate

Always back up before an update, since migrations are forward-only:

```sh
docker compose -f docker-compose.tunnel.yml stop pantrypal
tar -czf "pantrypal-backup-$(date +%F).tar.gz" data/
git pull
docker compose -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.tunnel.yml logs -f pantrypal
```

Rotate the browser password by changing `PANTRYPAL_PASSWORD` in `.env` and recreating the app
container:

```sh
docker compose -f docker-compose.tunnel.yml up -d --force-recreate pantrypal
```

Every existing browser session is invalidated immediately; each device must log in with the new
password. Bearer tokens are unaffected. Rotate the tunnel token by updating
`CLOUDFLARE_TUNNEL_TOKEN` and running
`docker compose -f docker-compose.tunnel.yml up -d --force-recreate cloudflared`.

For backups, restores and other operations, use the same `-f docker-compose.tunnel.yml` prefix shown
above; plain `docker compose` commands target the local stack. Restoring is unchanged: stop
`pantrypal`, replace `data/pantrypal.db` (and remove its `-wal`/`-shm` sidecars), then start it
again. Do not delete `data/` during an upgrade — it holds the only copy of the household.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PANTRYPAL_DB_PATH` | `./data/pantrypal.db` (image: `/data/pantrypal.db`) | SQLite file; its directory is created on start |
| `PORT` | `8787` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `PANTRYPAL_PASSWORD` | unset (off) | Shared password for the browser UI. Enables `/auth/*` and session-protected `/api/v1/*`. Bearer tokens are unaffected |
| `PANTRYPAL_REQUIRE_PASSWORD` | unset (off) | `true` or `1` makes startup fail if `PANTRYPAL_PASSWORD` is unset, instead of serving a browser UI without login. Use in production |
| `PANTRYPAL_TRUST_NETWORK` | unset (off) | `1` or `true` lets `/api/v1/*` requests without a token act as the household (see below). Ignored when a password is configured. Never applies to `/mcp` |
| `PANTRYPAL_WEB_DIR` | `web/dist` under the app root | Directory of the built web app served at `/`. If it has no `index.html`, only the API is served and the startup log says so |
| `CLOUDFLARE_TUNNEL_TOKEN` | unset | **Compose-only** secret read by `docker-compose.tunnel.yml` for `cloudflared`; not read by the app |

## Web app authentication

The server serves the web app at `/` (client routes fall back to `index.html`; `/auth`, `/api`,
`/mcp`, `/health` and `/openapi.json` are never shadowed). Hashed files under `/assets/` are cached
for a year; `index.html` is always revalidated. With password mode enabled, any app URL shows the
login screen in place when the browser has no valid session; after login it returns to the URL you
opened.

### Password login

Set `PANTRYPAL_PASSWORD` to a long random shared password to enable browser login. There are no
usernames or per-person accounts. For any instance reachable by more than a trusted machine, also
set `PANTRYPAL_REQUIRE_PASSWORD=true` so the process fails at startup instead of silently serving a
UI without a login:

```sh
PANTRYPAL_PASSWORD='…' PANTRYPAL_REQUIRE_PASSWORD=true pnpm dev
```

The auth surface:

| Endpoint | Behavior |
|---|---|
| `GET /auth/session` | Public. `{"enabled": boolean, "authenticated": boolean}`; the UI uses it on boot |
| `POST /auth/login` | Body `{"password": "…"}`, JSON, same-origin. `204` and sets the session cookie on success; `401` on a wrong password; `429` (with `Retry-After`) after repeated failures |
| `POST /auth/logout` | Same-origin. `204`; clears the session cookie so the browser is logged out |

When a password is configured, requests to `/api/v1/*` without a valid bearer token must carry a
valid session cookie. The `__Host-pantrypal_session` cookie lasts 30 days and is `HttpOnly`,
`Secure`, `SameSite=Lax` with `Path=/`; the `__Host-` prefix forbids a `Domain` scope. Changing
`PANTRYPAL_PASSWORD` and restarting invalidates every existing browser session; each browser must log
in again. Bearer tokens are a separate mechanism and are not affected by password rotation.
Sessions are signed cookies rather than a server-side session table, so logout clears the browser's
cookie; rotate the password to invalidate any copy of a cookie held elsewhere.
On a fresh database, run `household init` before using the UI: session-authenticated requests return
`503` with code `unavailable` until a household exists.

The cookie is always `Secure`, so browsers only send it over HTTPS. Terminate TLS in front of the app
(the Cloudflare Tunnel, Caddy, or `tailscale serve` below). Browsers make an exception for
`http://localhost`, so local development works without TLS; a LAN IP or arbitrary hostname over
plain HTTP does not. Do not expose the app over plain HTTP beyond localhost.

Login accepts JSON only. Login, logout, and unsafe cookie-authenticated API requests require an
`Origin` header equal to the request `Host`, and that origin must be `https:` except for loopback
development (`http://localhost`, `127.0.0.1`, `[::1]`). `X-Forwarded-Host` is ignored; Cloudflare
Tunnel preserves `Host`. Failed logins are limited to 10 per minute per socket peer plus a
40-per-minute global cap, returning `429` with `Retry-After`; behind the tunnel every peer appears
as loopback, so the global cap is the effective limit. Login bodies are capped at 4 KiB (`413`).
Do not retry a `429` in a loop.

Password login and network trust are mutually exclusive in practice: when `PANTRYPAL_PASSWORD` is
set it takes precedence, and `PANTRYPAL_TRUST_NETWORK=1` no longer grants anonymous access to
`/api/v1/*`. `/mcp` never accepts a browser cookie; it requires a bearer token in every mode. If
neither a password nor network trust is configured, the UI loads but its API calls return `401`
(and `/auth/session` reports `enabled: false`).

Compose reads `.env` for interpolation, but only `docker-compose.tunnel.yml` passes the values into
the container. Plain `pnpm dev` does **not** read `.env`; export the variable first or pass it
explicitly (`node --env-file=.env dist/server.js` for the compiled server).

### Network trust (private networks only)

Without a password, the browser still calls `/api/v1/*` same-origin and has no login, so run it with
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
Enable password login instead when the app is reachable from the public internet.

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

Use this when you are not using the [Cloudflare Tunnel stack](#public-deployment-with-cloudflare-tunnel-and-password-login)
and terminate TLS yourself. MCP clients (Claude, IDE agents, scripts) talk to `/mcp` over the
network with a bearer token in a header, so expose the service over HTTPS and do not send tokens
over plain HTTP beyond localhost. If the browser UI is exposed, set `PANTRYPAL_PASSWORD` (and
`PANTRYPAL_REQUIRE_PASSWORD=true`); its session cookie is `Secure`, so the public URL must be HTTPS.
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

Bearer tokens authenticate API clients and MCP clients; they remain valid whether or not browser
password login is enabled. Rules of thumb:

- One token per client (laptop agent, phone shortcut, MCP client) so revoking one does not break
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

These commands target the local stack. For the tunnel deployment, use
`docker compose -f docker-compose.tunnel.yml …` instead; the update sequence is shown in
[Update and rotate](#6-update-and-rotate).

Rolling back an image does not roll back the schema: restore the backup you took above.

## Operations

These commands target the local stack; prefix them with `-f docker-compose.tunnel.yml` for the
tunnel deployment.

| Task | Command |
|---|---|
| Logs | `docker compose logs -f pantrypal` |
| Health | `curl localhost:8787/health` (public, returns `{ok, version}`) |
| Container health | `docker inspect --format '{{.State.Health.Status}}' $(docker compose ps -q pantrypal)` (image has a `HEALTHCHECK` on `/health`) |
| Auth mode/session | `curl localhost:8787/auth/session` (public, `{enabled, authenticated}`) |
| OpenAPI document | `curl localhost:8787/openapi.json` |
| Shell in the container | `docker compose exec pantrypal sh` |

There is no metrics endpoint and no admin UI in v1. The SQLite file is small (a household state is
well under a few MB) and the process is idle when nobody is calling it.
