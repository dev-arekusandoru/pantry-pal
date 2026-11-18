# Public access with Cloudflare Tunnel

Use the Cloudflare Tunnel stack to reach PantryPal from the internet without
opening inbound ports. Cloudflare provides HTTPS at the edge, and accounts
protect the browser app.

`docker-compose.tunnel.yml` is standalone. It does not use
`docker-compose.override.yml`. Stop the local stack first; do not run both
against the same database.

PantryPal joins two networks on this host:

- `tunnel` — private to this compose project, where `cloudflared` reaches
  `pantrypal:8787`. No ports are published.
- `rakazo` (`RAKAZO_NETWORK`, default `rakazo_app`) — shared with the rakazo and
  homehub stacks, so sibling containers can call `http://pantrypal:8787`
  directly. They must send a bearer token.
  `rakazo_app` must already exist (`docker network create rakazo_app`).

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

Set the tunnel token in `.env`:

```dotenv
CLOUDFLARE_TUNNEL_TOKEN='the token from the tunnel dashboard'
```

`.env` is git-ignored; never commit real secrets. Signup is open by default, so
you can create your account from the browser after the first start. To close the
instance, add `PANTRYPAL_SIGNUP=closed` to `.env` after you create your accounts.

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

Compose aborts when the tunnel token is missing.

## 4. Initialize a fresh instance

Skip this when `./data/pantrypal.db` already holds your household. For a new
database:

Open `https://pantry.example.com` and use the signup form to create your account
and household. Set `PANTRYPAL_SIGNUP=closed` in `.env` and recreate `pantrypal`
when you no longer need signup.

To create the account from the CLI instead (for example on an instance that is
already closed to signup):

```sh
docker compose -f docker-compose.tunnel.yml exec pantrypal \
  node dist/cli.js account create --email you@example.com --household "Our House"

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

Open `https://pantry.example.com`, sign in, and confirm the household loads. Use
**Settings → Log out** to end the session. Account and session rules are in
[Access and security](security.md) and the
[REST API reference](../reference/rest-api.md#account-endpoints).

Bearer access is independent of the browser session:

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

Reset an account password with the CLI:

```sh
docker compose -f docker-compose.tunnel.yml exec pantrypal \
  node dist/cli.js account reset-password you@example.com
```

This signs that account out everywhere; bearer tokens are unaffected. Rotate the
tunnel token by changing `CLOUDFLARE_TUNNEL_TOKEN` and recreating `cloudflared`:

```sh
docker compose -f docker-compose.tunnel.yml up -d --force-recreate cloudflared
```

For backups and restores, use the same prefix and stop `pantrypal` first. Do not
delete `data/`. See [Backups and restore](backups.md) and [Updates](updates.md).

## Limits

- Each account owns one household; there are no roles inside it.
- Logout ends the current browser session. A copied cookie stays valid until it
  expires or the password is reset.
- Keep `PANTRYPAL_SIGNUP=closed` after you create your accounts, so strangers
  cannot create households.
- The tunnel token is a secret. Do not expose a second public route that bypasses
  authentication.

See [Configuration](configuration.md) and [Troubleshooting](troubleshooting.md).
