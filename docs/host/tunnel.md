# Public access with Cloudflare Tunnel

Use the Cloudflare Tunnel stack to reach PantryPal from the internet without
opening inbound ports. Cloudflare provides HTTPS at the edge, and a shared
password protects the browser app.

`docker-compose.tunnel.yml` is standalone. It does not use
`docker-compose.override.yml` or join the `rakazo` network. Stop the local stack
first; do not run both against the same database.

## 1. Create the tunnel

In the Cloudflare dashboard:

1. Open **Zero Trust → Networks → Tunnels** and select **Create a tunnel**.
2. Choose **Cloudflared**, name it (for example `pantrypal`), and copy the
   **tunnel token** from the connector screen.
3. Under **Public Hostnames**, add:
   - **Subdomain**: `pantry`
   - **Domain**: `example.com`
   - **Path**: empty
   - **Service type**: `HTTP`
   - **URL**: `pantrypal:8787`
4. Save. Cloudflare creates the DNS record for `https://pantry.example.com`.

The public URL is HTTPS; the connector reaches PantryPal over plain HTTP on the
private Docker network. Keep ports closed and do not add an `A`/`AAAA` record for
the host. Do not put Cloudflare Access in front of this hostname: it blocks MCP
clients before their bearer token is read.

## 2. Configure secrets

From the repository root:

```sh
cp .env.example .env
chmod 600 .env
```

Set both values in `.env`:

```dotenv
PANTRYPAL_PASSWORD='a long random shared password'
CLOUDFLARE_TUNNEL_TOKEN='the token from the tunnel dashboard'
```

Generate the password with `openssl rand -base64 32`. Single quotes protect a `$`
from Compose interpolation. `.env` is git-ignored; never commit real secrets.

## 3. Start the stack

Stop the local stack if it is running:

```sh
docker compose down
```

Prepare the data directory before you start the app. The image runs as uid 1000.
On Linux:

```sh
mkdir -p data
sudo chown -R 1000:1000 data
```

If this instance has data, back it up while the app is stopped:

```sh
tar -czf "pantrypal-backup-$(date +%F).tar.gz" data/
```

Then start the tunnel stack:

```sh
docker compose -f docker-compose.tunnel.yml up -d --build
```

Both secrets are required, so Compose aborts if either is missing. The app also
fails at startup without a password because the file sets
`PANTRYPAL_REQUIRE_PASSWORD=true`.

## 4. Initialize a fresh instance

Skip this when `./data/pantrypal.db` already holds your household. For a new
database:

```sh
docker compose -f docker-compose.tunnel.yml exec pantrypal \
  node dist/cli.js household init --name "Our House" --timezone America/New_York

docker compose -f docker-compose.tunnel.yml exec pantrypal \
  node dist/cli.js token create --name laptop
```

The token is printed once. To load the sample household, use the seed command in
[Example data](../start/example-data.md). Migrations run on startup.

## 5. Verify

```sh
docker compose -f docker-compose.tunnel.yml ps
docker compose -f docker-compose.tunnel.yml logs -f cloudflared
curl -fsS https://pantry.example.com/health
curl -fsS https://pantry.example.com/auth/session
```

Open `https://pantry.example.com`, enter the password, and confirm the household
loads. Use **Settings → Log out** to clear the cookie. Password and session
rules are in [Access and security](security.md) and the
[REST API reference](../reference/rest-api.md#browser-session-endpoints).

Bearer access is independent of the browser password:

```sh
curl -fsS -H "Authorization: Bearer $PANTRYPAL_TOKEN" \
  https://pantry.example.com/api/v1/household
```

Point MCP clients at `https://pantry.example.com/mcp` with a bearer token. The
browser cookie is not accepted there. See [MCP setup](../connect/setup.md).

## 6. Operate the tunnel stack

Every command for this deployment needs the file prefix; plain `docker compose`
targets the local stack.

Back up before updating, because migrations are forward-only:

```sh
docker compose -f docker-compose.tunnel.yml stop pantrypal
tar -czf "pantrypal-backup-$(date +%F).tar.gz" data/
git pull --ff-only
docker compose -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.tunnel.yml logs -f pantrypal
```

Rotate the browser password by changing `PANTRYPAL_PASSWORD` in `.env` and
recreating the app:

```sh
docker compose -f docker-compose.tunnel.yml up -d --force-recreate pantrypal
```

This signs out every browser; bearer tokens are unaffected. Rotate the tunnel
token by changing `CLOUDFLARE_TUNNEL_TOKEN` and recreating `cloudflared`:

```sh
docker compose -f docker-compose.tunnel.yml up -d --force-recreate cloudflared
```

For backups and restores, use the same prefix and stop `pantrypal` first. Do not
delete `data/`. See [Backups and restore](backups.md) and [Updates](updates.md).

## Limits

- One shared password and no accounts or roles.
- Logout clears the current browser; rotate the password to invalidate cookies
  held elsewhere.
- The tunnel token is a secret. Do not expose a second public route that bypasses
  the password.

See [Configuration](configuration.md) and [Troubleshooting](troubleshooting.md).
