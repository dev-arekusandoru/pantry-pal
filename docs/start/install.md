# Install PantryPal

PantryPal runs as one server process. It needs one writable directory for its SQLite database. The Docker image includes the server, web app, migrations, and example seed.

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

Compose loads `docker-compose.yml` and `docker-compose.override.yml` together. The override:

- Publishes the port on `127.0.0.1` only.
- Sets `PANTRYPAL_TRUST_NETWORK=1`, so the web app can call the API without a token.

The default stack has no browser password. It relies on network trust and a loopback port. The override replaces the base port list; it does not publish both a public and a loopback binding.

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). Only the host and local proxies can reach this port. If Docker runs on another machine, use an SSH tunnel or VPN; the loopback port is not open to your laptop. Do not put a public proxy in front of this mode without authentication. See [Access and security](../host/security.md).

### Public access

Use the standalone tunnel stack to publish PantryPal on the internet. It adds a shared browser password and a Cloudflare Tunnel, publishes no host ports, and requires both secrets. It replaces the default stack; do not run both against the same database. See [Public access with Cloudflare Tunnel](../host/tunnel.md).

### Run the base file only

```sh
docker compose -f docker-compose.yml up -d --build
```

This ignores the override. The port is published on all interfaces, and network trust is off. The web app sends no token, so it cannot use the API in this mode. Use it for API and MCP clients that send bearer tokens, behind a firewall or an authenticating proxy.

### Create the first household

```sh
docker compose exec pantrypal node dist/cli.js household init --name "Our House" --timezone America/New_York
docker compose exec pantrypal node dist/cli.js token create --name laptop
```

`--timezone` is optional. The default is UTC. An instance supports one household. A second `household init` fails.

The token is printed once. Copy it now. To load the sample household instead, skip the `household init` command and follow [Example data](example-data.md). The seed creates its own household.

If the instance has `PANTRYPAL_PASSWORD` set, the web app asks for that shared password. The token is still needed for API and MCP clients.

### Check the install

Set `PANTRYPAL_TOKEN` to the value printed by `token create`, then run:

```sh
curl -s http://127.0.0.1:8787/health
curl -s -H "Authorization: Bearer $PANTRYPAL_TOKEN" http://127.0.0.1:8787/api/v1/household
```

The health check needs no token. The household request must return the household JSON. Open the web app at [http://127.0.0.1:8787](http://127.0.0.1:8787).

For a password-protected instance, check the mode and session state:

```sh
curl -s http://127.0.0.1:8787/auth/session
```

It returns `{"enabled":true,"authenticated":false}` before login.

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
pnpm cli household init --name "Our House" --timezone America/New_York
pnpm cli token create --name laptop
HOST=127.0.0.1 PANTRYPAL_TRUST_NETWORK=1 pnpm start
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
