# Install Rakumi

Rakumi runs as one server process. It needs one writable directory for its SQLite database. The Docker image includes the server, web app, migrations, and example seed.

Use Docker Compose for a normal install. You can also run the built app with Node.js.

## Requirements

- Docker Engine with the Compose v2 plugin, for the recommended install.
- Node.js 22 or later and pnpm, for a source install.
- Git.
- A local directory for the database.
- A VPN, tunnel, or reverse proxy if other devices will connect. For internet access, use the [Cloudflare Tunnel stack](../host/tunnel.md).

## Install with Docker Compose

Clone the repository, then run the remaining commands from its root:

```sh
git clone https://github.com/dev-arekusandoru/pantry-pal.git
cd pantry-pal
mkdir -p data
sudo chown -R 1000:1000 data
docker network create rakazo_app
docker compose up -d --build
```

The image runs as uid 1000. On a Linux host, the `data` directory must be writable by that user. Skip the `chown` if your user already has uid 1000.

The base Compose file joins an external network named `rakazo_app`. Create it once. Skip the network command if it already exists. If you use another network, set `RAKAZO_NETWORK` to its name.

The Compose file builds a local image. It does not pull a prebuilt image.

### What the default stack does

Compose loads `docker-compose.yml` and `docker-compose.override.yml` together. The override publishes the port on `127.0.0.1` only.

Signup is open on a fresh database, so you create your account from the browser. The override replaces the base port list; it does not publish both a public and a loopback binding.

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). Only the host and local proxies can reach this port. If Docker runs on another machine, use an SSH tunnel or VPN; the loopback port is not open to your laptop. See [Access and security](../host/security.md).

### Public access

Use the standalone tunnel stack to publish Rakumi on the internet. It adds a Cloudflare Tunnel, publishes no host ports, and requires the tunnel token. It replaces the default stack; do not run both against the same database. See [Public access with Cloudflare Tunnel](../host/tunnel.md).

### Run the base file only

```sh
docker compose -f docker-compose.yml up -d --build
```

This ignores the override, so the port is published on all interfaces. Signup is open by default. Anyone who can reach the port can create an account, so keep it behind a firewall or an authenticating proxy, or set `PANTRYPAL_SIGNUP=closed`.

### Create the first account

Create your account in the web app with the signup form, or from the CLI:

```sh
docker compose exec pantrypal node dist/cli.js account create \
  --email you@example.com --household "Our House"
docker compose exec pantrypal node dist/cli.js token create --name laptop
```

The CLI asks for a password twice. The account owns the new household. The token
is printed once. Copy it now; API and MCP clients need it. To load the sample
household instead, follow [Example data](example-data.md); the seed creates its
own household, which you can attach an account to with `--household-id`.

Signup stays open until you set `PANTRYPAL_SIGNUP=closed`. See
[Configuration](../host/configuration.md).

### Check the install

Set `PANTRYPAL_TOKEN` to the value printed by `token create`, then run:

```sh
curl -s http://127.0.0.1:8787/health
curl -s -H "Authorization: Bearer $PANTRYPAL_TOKEN" http://127.0.0.1:8787/api/v1/household
```

The health check needs no token. The household request must return the household JSON. Open the web app at [http://127.0.0.1:8787](http://127.0.0.1:8787).

Check the session state:

```sh
curl -s http://127.0.0.1:8787/auth/session
```

Without a cookie it returns `{"authenticated":false,"signupOpen":true}`.

Follow the logs with:

```sh
docker compose logs -f pantrypal
```

The database is on the host at `./data/pantrypal.db`. The container sees it at `/data/pantrypal.db`. Read [Backups and restore](../host/backups.md) before you add important data.

## Run without Docker

Use Node.js 22 or later and pnpm. A C++ compiler and Python 3 may be needed for `better-sqlite3` if no prebuilt binary is available.

```sh
git clone https://github.com/dev-arekusandoru/pantry-pal.git
cd pantry-pal
pnpm install
pnpm build
pnpm cli account create --email you@example.com --household "Our House"
pnpm cli token create --name laptop
HOST=127.0.0.1 pnpm start
```

Open [http://127.0.0.1:4787](http://127.0.0.1:4787). The source server defaults to port 4787. The Docker image sets 8787. To use 8787 from source, add `PORT=8787` to the last command.

`pnpm build` builds the server and the web app. The default database is `./data/pantrypal.db`. Set `PANTRYPAL_DB_PATH` to use another path, and use the same value for the CLI and the server.

Keep the process under systemd or another supervisor. The server handles `SIGTERM` and closes the database. For hot reload and the Vite dev server, see [Local setup](../develop/setup.md).

## Next steps

- [Load example data](example-data.md)
- [Connect an AI assistant](../connect/setup.md)
- [Public access with Cloudflare Tunnel](../host/tunnel.md)
- [Configuration](../host/configuration.md)
- [Access and security](../host/security.md)
- [Updates](../host/updates.md)
