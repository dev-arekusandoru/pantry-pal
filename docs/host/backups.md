# Backups and restore

The SQLite database holds all household data and token records. Keep it on a
local disk, not NFS or SMB. Save backup copies off the host.

Run these commands from the repository root. For a base-only setup, add
`-f docker-compose.yml` to each Compose command.

## Back up with a short stop

```sh
docker compose stop pantrypal
tar -czf "pantrypal-backup-$(date +%F).tar.gz" data/
docker compose start pantrypal
```

The server closes the database on shutdown. The archive keeps the database and
any `-wal` and `-shm` files together. Do not copy just the live `.db` file.

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

## Restore

For a release rollback, use [Updates](updates.md#roll-back) instead. The code
must match the restored schema.

First, stop the service and preserve the current data:

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

Do not add a snapshot beside old WAL files. Then start the service:

```sh
sudo chown -R 1000:1000 data
docker compose up -d --force-recreate
curl -sS http://127.0.0.1:8787/health
docker compose exec pantrypal node dist/cli.js household show
```

Check recent data in the web app. Keep the preserved directory until you verify
the restore. List and revoke tokens as needed: a restore can make old tokens
valid again. See [Access and security](security.md#stored-data).

Test a restore before you need it. A backup saves data, not application code.
