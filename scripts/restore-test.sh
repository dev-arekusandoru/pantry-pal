#!/usr/bin/env bash
# Test the off-site backup: restore the latest Litestream copy from R2 into a
# temporary directory, check it, start the app on it, and compare row counts
# with the live database. It never changes data/ or the running stack.
#
#   scripts/restore-test.sh
#
# Needs the litestream service set up (docs/host/backups.md) and the app image
# built (pantrypal:prod). Counts can differ by the edits of the last few
# minutes: Litestream uploads changes every 5 minutes.
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.tunnel.yml}"
IMAGE="${IMAGE:-pantrypal:prod}"
PORT="${RESTORE_TEST_PORT:-8798}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

TMP="$(mktemp -d /tmp/rakumi-restore-XXXXXX)"
NAME="rakumi-restore-test-$$"
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
# The containers run as uid 1000 and must write here.
chmod 0777 "$TMP"

# Integrity check and row counts, as JSON. Argument: database path.
COUNT_JS='
const Database = require("better-sqlite3");
const db = new Database(process.argv[1], { readonly: true });
const n = (t) => db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n;
console.log(JSON.stringify({
  integrity: db.pragma("integrity_check", { simple: true }),
  households: n("household"),
  accounts: n("account"),
  recipes: n("recipe"),
  pantry_items: n("pantry_item"),
  meal_slots: n("meal_slot"),
}));
'

printf '==> Restoring the latest backup from R2\n'
dc run --rm --no-deps -v "$TMP:/restore" litestream \
  restore -o /restore/pantrypal.db /data/pantrypal.db \
  || die "litestream restore failed. Check the R2 settings in .env."
[ -s "$TMP/pantrypal.db" ] || die "The restore made no database file."

printf '\n==> Checking the restored database\n'
restored="$(docker run --rm -v "$TMP:/restore" "$IMAGE" node -e "$COUNT_JS" /restore/pantrypal.db)"
echo "Restored: $restored"
grep -q '"integrity":"ok"' <<<"$restored" || die "The integrity check failed."

printf '\n==> Starting the app on the restored copy (port %s)\n' "$PORT"
# No billing or email settings: the test app sends nothing and charges no one.
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8787" \
  -e PANTRYPAL_DB_PATH=/restore/pantrypal.db -v "$TMP:/restore" "$IMAGE" >/dev/null
health=""
for _ in $(seq 1 30); do
  health="$(curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null)" && break
  sleep 1
done
[ -n "$health" ] || { docker logs --tail 30 "$NAME" >&2; die "The app did not start on the restored copy."; }
echo "Health: $health"

printf '\n==> Comparing with the live database\n'
live="$(dc exec -T pantrypal node -e "$COUNT_JS" /data/pantrypal.db)" \
  || die "Cannot read the live database. Is the pantrypal service running?"
echo "Live:     $live"
echo "Restored: $restored"
if [ "${live#*\"households\"}" = "${restored#*\"households\"}" ]; then
  echo "Counts match."
else
  echo "Counts differ. Edits from the last 5 minutes may not be uploaded yet. Run the test again later to confirm."
fi

printf '\nRestore test passed. The temporary copy is deleted now.\n'
