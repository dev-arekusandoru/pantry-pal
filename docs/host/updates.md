# Update PantryPal

Updates replace the application code and apply database migrations. Migrations are forward-only: there is no down migration. Take a backup before each update.

The Compose stack builds a local image from the Dockerfile. It does not pull a published image. To update, get the new source and rebuild.

## Before you start

Run the commands from the repository root. They target the default stack. If you use the base file only, add `-f docker-compose.yml` to every Compose command. If you use the Cloudflare Tunnel stack, use `-f docker-compose.tunnel.yml` instead. Do not combine the tunnel file with the override.

```sh
git rev-parse HEAD
docker compose stop pantrypal
tar -czf "pantrypal-before-update-$(date +%F).tar.gz" data/
```

Keep the commit ID and the archive until you are satisfied with the update. The archive is a stopped copy of the whole database directory. See [Backups and restore](backups.md) for other backup methods.

Read the release notes for the version you install. Some releases may need a manual step.

## Apply the update

```sh
git pull --ff-only
docker compose up -d --build
docker compose logs -f pantrypal
```

For the tunnel stack, select its Compose file:

```sh
git pull --ff-only
docker compose -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.tunnel.yml logs -f pantrypal
```

Compose rebuilds the server and web app, then replaces the container. The data directory stays in place.

Pending migrations run when the server starts, before it accepts requests. There is no separate migrate step. The `drizzle/` directory in the image contains the migrations.

Every CLI command that opens the database applies pending migrations too. Do not run CLI commands on a database you may need to roll back, unless you accept the schema change.

## Check the update

```sh
curl -s http://127.0.0.1:8787/health
docker compose ps
```

`/health` returns `ok` and the new version. Open the web app and check a pantry item, recipe, or plan. If you use MCP, send a request with the same token. No client change is needed unless the update changed the token or API contract.

If the server exits during startup, read the logs. A failed migration stops the new version before it serves traffic.

## Roll back

If the update fails, stop the service and decide whether migrations ran.

If migrations ran, restore the pre-update backup and run the previous code:

For the tunnel stack, select `docker-compose.tunnel.yml` in every Compose command
below.

```sh
docker compose stop pantrypal
mv data "data.failed-update-$(date +%F-%H%M%S)"
tar -xzf pantrypal-before-update-2026-11-05.tar.gz
sudo chown -R 1000:1000 data
```

Use the archive you made before the update. Then check out the commit you recorded, and rebuild:

```sh
git switch --detach <previous-commit>
docker compose up -d --build --force-recreate
```

Use `git log --oneline` to find the previous commit. Replace `<previous-commit>` with the commit you recorded before the update. If the failed update did not run migrations, you may be able to start the old code without restoring data. The backup is still the safe path.

Do not start new code against a restored old database and expect the schema to stay old. New code runs migrations on startup. Do not delete the `data.failed-update-*` directory until the rollback is verified.

## After the update

- Check the health endpoint and the web app.
- Keep the pre-update backup until you are satisfied.
- Revoke tokens only if you have a reason. A normal code update keeps existing tokens and data.
- If you changed Compose files locally, review the diff after `git pull`. Your local changes may conflict with the update.

See [Configuration](configuration.md), [Backups and restore](backups.md), and [Troubleshooting](troubleshooting.md).
