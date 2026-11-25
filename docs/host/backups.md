# Backups and restore

The SQLite database holds all household data and token records. Keep it on a
local disk, not NFS or SMB. Save backup copies off the host.

Run these commands from the repository root. They target the default stack. For a base-only setup, add `-f docker-compose.yml` to each Compose command. For the Cloudflare Tunnel stack, use `-f docker-compose.tunnel.yml` instead. Do not combine the tunnel file with the default stack or its override.

## Back up with a short stop

```sh
docker compose stop pantrypal
tar -czf "pantrypal-backup-$(date +%F).tar.gz" data/
docker compose start pantrypal
```

The server closes the database on shutdown. The archive keeps the database and
any `-wal` and `-shm` files together. Do not copy just the live `.db` file.

For the tunnel stack, select its Compose file:

```sh
docker compose -f docker-compose.tunnel.yml stop pantrypal
tar -czf "pantrypal-backup-$(date +%F).tar.gz" data/
docker compose -f docker-compose.tunnel.yml start pantrypal
```

## Back up while running

Use SQLite's online backup API:

```sh
docker compose exec -T pantrypal rm -f /tmp/pantrypal-backup.db
docker compose exec -T pantrypal node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.env.PANTRYPAL_DB_PATH, { readonly: true });
  db.backup("/tmp/pantrypal-backup.db")
    .then(() => { db.close(); })
    .catch((error) => { console.error(error); process.exit(1); });
'
docker compose cp pantrypal:/tmp/pantrypal-backup.db "./pantrypal-backup-$(date +%F).db"
docker compose exec -T pantrypal rm -f /tmp/pantrypal-backup.db
```

If the host has `sqlite3`, this is another online backup method:

```sh
sqlite3 data/pantrypal.db ".backup 'pantrypal-backup.db'"
```

## Off-site backups with Litestream

The tunnel stack can copy the database to a Cloudflare R2 bucket without a
stop. The `litestream` service does this. It is off by default.

| Setting | Value |
| --- | --- |
| Upload of changes | At most every 5 minutes, only when data changed |
| Full copy (snapshot) | Every 12 hours |
| Kept for | 14 days, then Litestream deletes it |
| Data you can lose in a host failure | Up to 5 minutes of edits |

To change these values, edit `litestream.yml`. See the
[Litestream configuration reference](https://litestream.io/reference/config/).

### Set up

1. In the Cloudflare dashboard, open **R2** and create a bucket, for example
   `rakumi-backups`. For **Location**, select **Provide a location hint** and
   choose the region nearest to your server, for example **Eastern North
   America (ENAM)**.
2. Create an R2 API token with **Object Read & Write** access to that bucket
   only. Copy the access key ID, the secret access key, and the S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).
3. Add these lines to `.env`:

   ```sh
   COMPOSE_PROFILES=backup
   LITESTREAM_BUCKET=rakumi-backups
   LITESTREAM_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   LITESTREAM_ACCESS_KEY_ID=<access key id>
   LITESTREAM_SECRET_ACCESS_KEY=<secret access key>
   ```

4. Start the service and read its log:

   ```sh
   docker compose -f docker-compose.tunnel.yml up -d
   docker compose -f docker-compose.tunnel.yml logs --tail 20 litestream
   ```

The log must show no errors. The first upload is a full copy. Then run the
[restore test](#test-the-off-site-backup).

`scripts/deploy.sh` stops `litestream` before it archives `data/` and starts it
again with the new version.

### Test the off-site backup

```sh
scripts/restore-test.sh
```

The script restores the latest copy from R2 into a temporary directory. It
checks the database, starts the app on the copy on port 8798, and compares row
counts with the live database. It does not change `data/`. Run it after setup
and then about once a month.

### Restore from R2

Use this when `data/` is lost or damaged:

```sh
docker compose -f docker-compose.tunnel.yml stop litestream pantrypal
mv data "data.before-restore-$(date +%F-%H%M%S)"
mkdir data && sudo chown 1000:1000 data
docker compose -f docker-compose.tunnel.yml run --rm --no-deps litestream restore /data/pantrypal.db
docker compose -f docker-compose.tunnel.yml up -d
```

To restore the database as it was at an earlier time, add
`-timestamp 2026-11-20T08:00:00Z` after `restore`. The time must be within the
last 14 days.

Then check the app as described at the end of [Restore](#restore).

## Restore

For a release rollback, use [Updates](updates.md#roll-back) instead. The code
must match the restored schema.

For the tunnel stack, select `docker-compose.tunnel.yml` in every Compose
command below.

First, stop the service and preserve the current data. If the `litestream`
service runs, stop it too (`stop litestream pantrypal`):

```sh
docker compose stop pantrypal
mv data "data.before-restore-$(date +%F-%H%M%S)"
```

Choose **one** restore method. Replace the backup name with your saved file.

For a directory archive:

```sh
tar -xzf pantrypal-backup-2026-11-05.tar.gz
```

For an online database snapshot:

```sh
mkdir data
cp pantrypal-backup-2026-11-05.db data/pantrypal.db
```

Do not add a snapshot beside old WAL files. Fix the owner of the files:

```sh
sudo chown -R 1000:1000 data
```

If the `litestream` service is set up, reset its local state now. Otherwise
it does not upload the restored database correctly:

```sh
docker compose -f docker-compose.tunnel.yml run --rm --no-deps litestream reset /data/pantrypal.db
```

Then start the service:

```sh
docker compose up -d --force-recreate
curl -sS http://127.0.0.1:8787/health
docker compose exec pantrypal node dist/cli.js household show
```

Check recent data in the web app. Keep the preserved directory until you verify
the restore. List and revoke tokens as needed: a restore can make old tokens
valid again. See [Access and security](security.md#stored-data).

Test a restore before you need it. A backup saves data, not application code.
