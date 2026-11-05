# Troubleshooting

Start with the service state, logs, and health check:

```sh
docker compose ps
docker compose logs --tail=100 pantrypal
curl -s http://127.0.0.1:8787/health
```

`/health` is public. The image also has a healthcheck:

```sh
docker inspect --format '{{.State.Health.Status}}' pantrypal
```

## Compose cannot find the external network

The base file joins an external network named `rakazo_app`, with or without the override. If it does not exist, Compose stops with an error such as `network rakazo_app declared as external, but could not be found`.

Create it once:

```sh
docker network create rakazo_app
```

To use another existing network, set `RAKAZO_NETWORK`:

```sh
RAKAZO_NETWORK=my_network docker compose up -d --build
```

## Compose rejects `!override`

The override file uses the `!override` tag to replace the base port list. Update Docker Compose if your version does not accept it. Then run `docker compose up -d --build` again.

## Permission errors on the database

Symptoms include `SQLITE_CANTOPEN`, `EACCES`, `attempt to write a readonly database`, or a container that restarts during startup. The image runs as uid 1000. On a Linux host, give that user write access:

```sh
mkdir -p data
sudo chown -R 1000:1000 data
docker compose up -d
```

Do not use `chmod 777`. See [Configuration](configuration.md).

## Port 8787 is already in use

Docker reports that the port is allocated. Change the host side of the mapping in `docker-compose.override.yml` for the default stack, or in `docker-compose.yml` for base-only:

```yaml
ports: !override
  - "127.0.0.1:9000:8787"
```

Keep `!override` when you edit the override file; it replaces the base port list.
If you edit the base file alone, use plain `ports:` instead.
Run `docker compose up -d` and open `http://127.0.0.1:9000`.

## The web app cannot reach the API

- With the base file alone, network trust is off and the web app sends no token. Use the default stack on a trusted network, or a proxy that authenticates visitors and forwards a valid bearer token. See [Access and security](security.md).
- If you see `503` and a message about no household, run `household init` or load the example data:

  ```sh
  docker compose exec pantrypal node dist/cli.js household init --name "Our House"
  ```

- If a proxy adds an `Authorization` header, it must be a valid token. Trust mode does not ignore a bad token.

## MCP returns 401

`/mcp` always requires a token, even when network trust is on. Create a token and send it in the `Authorization: Bearer <token>` header. See [MCP setup](../connect/setup.md).

A token in a query parameter does not work. A revoked token also returns `401`.

## The server uses the wrong port

A source run defaults to 4787. The Docker image sets 8787. Check the startup log line:

```text
PantryPal listening on http://0.0.0.0:8787
```

Set `PORT` to choose a port. If you change the container port, also change the Compose mapping. See [Configuration](configuration.md).

## The database is locked

PantryPal waits up to 5 seconds for a lock. If the error continues, another process is using the same database.

- Run one server against one database file.
- Stop old containers or local servers that use the same `data` directory.
- Keep the database on a local filesystem. Do not use NFS or SMB.

## An update or migration fails

The new server exits before it serves traffic. Read the logs, then restore the backup from before the update and run the previous code. Do not delete the data directory. See [Update PantryPal](updates.md) and [Backups and restore](backups.md).

Do not run CLI commands to inspect the database if you plan to roll back. Every CLI command that opens the database applies pending migrations.

## The seed is refused

The seed only loads into a household with no ingredients or recipes. `--force` skips that check; it does not clear, replace, or merge data safely. Use a fresh database or restore a backup. See [Example data](../start/example-data.md) and [Data import](../reference/import.md).

## The web app is not served

The log says the web app is missing and the server is API only. For a source run, build it with `pnpm build`, not `pnpm build:server`. For a custom build, check `PANTRYPAL_WEB_DIR` and make sure the directory contains `index.html`. See [Configuration](configuration.md).

## Environment changes do not apply

`docker compose restart` restarts the existing container and keeps its environment. Run `docker compose up -d` to recreate it with the new values. Check the merged settings with:

```sh
docker compose config
```

For a source run, restart the process.

## Data appears empty after a restart

Compose resolves `./data` from the directory that contains the base Compose file.
Check the resolved mount with `docker compose config`.

If you restored data, check the ownership of `data` and the container logs. See [Backups and restore](backups.md).

## A local build fails on `better-sqlite3`

Use Node.js 22 or later. The native module needs Python 3 and a C++ toolchain when no prebuilt binary exists. On Debian or Ubuntu:

```sh
sudo apt install build-essential python3
pnpm rebuild better-sqlite3
```

The Docker image includes the compiled module, so you do not need a host toolchain. Use Compose if you do not want to build the module on the host.

## A token is lost

The secret is shown only once. Create a new token, update the client, then revoke the old token. See [Access and security](security.md).
