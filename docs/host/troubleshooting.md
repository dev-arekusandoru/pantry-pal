# Troubleshooting

Start with the service state, logs, and health check:

These commands target the default stack. For the Cloudflare Tunnel stack, use
`-f docker-compose.tunnel.yml` in every Compose command. See
[Public access with Cloudflare Tunnel](tunnel.md).

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

- Check `/auth/session`. `{"enabled":false,...}` means no browser password is
  configured. With the base file alone, network trust is also off and the web
  app sends no token, so API calls return `401`. Use the default stack on a
  trusted network, set `PANTRYPAL_PASSWORD`, or use a proxy that supplies a
  valid bearer token. See [Access and security](security.md).
- If password mode is on, the web app shows a login screen. Sign in first. A
  wrong or expired session returns `401`; rotate the password only when you want
  to sign every browser out.
- If you see `503` and a message about no household, run `household init` or load the example data:

  ```sh
  docker compose exec pantrypal node dist/cli.js household init --name "Our House"
  ```

- If a proxy adds an `Authorization` header, it must be a valid token. A sent
  token is always checked, even when a session cookie is present, and a bad token
  returns `401`.
- With the tunnel stack, use
  `docker compose -f docker-compose.tunnel.yml exec pantrypal ...` for the
  command above.

## Browser login fails

- `/auth/session` reports `enabled: false`: no password reached the process. Set
  `PANTRYPAL_PASSWORD` and recreate the container with `docker compose up -d`.
  With the tunnel stack, edit `.env` and use
  `docker compose -f docker-compose.tunnel.yml up -d --force-recreate pantrypal`.
- Startup exits with a message that `PANTRYPAL_PASSWORD` is required:
  `PANTRYPAL_REQUIRE_PASSWORD` is on and the password is unset. Set the password
  or remove the requirement.
- Login succeeds but the next request returns `401`: the cookie is `Secure` and
  needs HTTPS, except on `http://localhost`. Use HTTPS for a LAN address or
  public hostname.
- Login returns `403`: the request `Origin` host does not match `Host`, the
  origin is not HTTPS (outside loopback), or the proxy removed `Origin`. Preserve
  both headers. `X-Forwarded-Host` does not count.
- Login returns `401`: wrong password. It returns `429` after 10 failures per
  minute from one peer or 40 in total; wait for `Retry-After` instead of retrying.
  A body over 4 KiB returns `413`; a non-JSON body returns `415`.
- Sessions disappear after a restart only if the password changed. Sessions are
  signed with the password, so rotating it signs out every browser. A copied
  cookie otherwise stays valid until it expires.
- To sign out, use **Settings → Log out**. Closing the tab does not end the
  session.

## MCP returns 401

`/mcp` always requires a token, even when network trust or a browser password is
on. It never accepts a session cookie. Create a token and send it in the
`Authorization: Bearer <token>` header. See [MCP setup](../connect/setup.md).

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

## The tunnel has no connection

```sh
docker compose -f docker-compose.tunnel.yml ps
docker compose -f docker-compose.tunnel.yml logs --tail=100 cloudflared
```

- `cloudflared` needs outbound HTTPS to Cloudflare. A blocked egress firewall
  stops the connector.
- A wrong or revoked tunnel token stops the connector. Copy the token again from
  the tunnel dashboard and recreate `cloudflared`.
- The public hostname must use service type `HTTP` and URL `pantrypal:8787`.
- The stack publishes no host ports on purpose. Test through the public URL, not
  `localhost:8787`, on the Docker host.
- Do not add Cloudflare Access to this hostname. It blocks MCP bearer tokens.
- If `pantrypal` is unhealthy, fix that first; `cloudflared` waits for it.

## Environment changes do not apply

`docker compose restart` restarts the existing container and keeps its environment. Run `docker compose up -d` to recreate it with the new values. Check the merged settings with:

```sh
docker compose config
```

For the tunnel stack, edit `.env`, then recreate the affected service:

```sh
docker compose -f docker-compose.tunnel.yml up -d --force-recreate pantrypal
```

For a source run, restart the process. A plain source run does not read `.env`.

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
