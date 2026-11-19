#!/usr/bin/env bash
# Release PantryPal on this host: build, back up the database, replace the
# container, and wait until it is healthy.
#
#   scripts/deploy.sh                 # tunnel stack (docker-compose.tunnel.yml)
#   scripts/deploy.sh --dry-run       # print every step, change nothing
#   scripts/deploy.sh --file docker-compose.yml
#   scripts/deploy.sh --skip-pull     # deploy the checked-out commit as it is
#
# Order matters:
#   1. Build the new image first. A build error leaves the old container running.
#   2. Stop the container, so SQLite closes the database and its -wal file.
#   3. Archive data/ (the whole directory) to backups/ and check the archive.
#   4. Start the new container. Migrations run at server start.
#   5. Wait for the Docker health check. If it fails, print the rollback steps.
#
# Migrations are forward-only. The script never restores a backup by itself.
set -Eeuo pipefail

COMPOSE_FILE="docker-compose.tunnel.yml"
SERVICE="pantrypal"
BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-10}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
DRY_RUN=0
SKIP_PULL=0
ASSUME_YES=0

usage() {
  sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options:
  --file FILE     Compose file (default: docker-compose.tunnel.yml)
  --skip-pull     Do not run git pull
  --dry-run       Print the steps and run nothing that changes state
  --yes           Do not ask before stopping the service
  -h, --help      Show this help

Environment:
  BACKUP_DIR      Where archives go (default: backups)
  KEEP_BACKUPS    Archives to keep (default: 10; older ones are deleted)
  HEALTH_TIMEOUT  Seconds to wait for a healthy container (default: 120)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --file) COMPOSE_FILE="${2:?--file needs a value}"; shift 2 ;;
    --skip-pull) SKIP_PULL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# Run a state-changing command, or only print it in a dry run.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    local shown="$*"
    printf '[dry-run] %s\n' "${shown/#dc /docker compose -f $COMPOSE_FILE }"
  else
    "$@"
  fi
}

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

# ---- Preflight ---------------------------------------------------------------
log "Preflight"
[ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE not found in $ROOT"
[ -d data ] || die "data/ not found in $ROOT. Run this from the repository that holds the database."
[ -d nutrition ] || die "nutrition/ is missing. The image needs it."
command -v docker >/dev/null || die "docker is not installed"
docker info >/dev/null 2>&1 || die "Cannot reach the Docker daemon. Add yourself to the docker group, or run with sudo."
docker compose version >/dev/null 2>&1 || die "docker compose is not available"

if [ "$COMPOSE_FILE" = "docker-compose.tunnel.yml" ]; then
  [ -f .env ] || die ".env is missing (it needs CLOUDFLARE_TUNNEL_TOKEN)"
  grep -Eq '^CLOUDFLARE_TUNNEL_TOKEN=.+' .env || die "CLOUDFLARE_TUNNEL_TOKEN is not set in .env"
fi
dc config -q || die "$COMPOSE_FILE is not valid"

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
PREVIOUS_IMAGE="$(docker image inspect --format '{{.Id}}' "$(dc config --images | grep -m1 "^pantrypal:" || echo pantrypal:prod)" 2>/dev/null || echo none)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Stack:          $COMPOSE_FILE"
echo "Branch:         $BRANCH"
echo "Current commit: $PREVIOUS_COMMIT"
echo "Current image:  $PREVIOUS_IMAGE"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Note: tracked files have uncommitted changes. The image is built from the working tree, including them:"
  git status --short --untracked-files=no | sed 's/^/  /'
fi

# ---- Update source -----------------------------------------------------------
if [ "$SKIP_PULL" -eq 1 ]; then
  log "Skipping git pull"
elif git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  log "Pulling the latest source (fast-forward only)"
  run git pull --ff-only
else
  log "No upstream branch is set; skipping git pull"
fi
NEW_COMMIT="$(git rev-parse HEAD)"
echo "Deploying commit: $NEW_COMMIT"

# ---- Build (old container keeps running) ------------------------------------
log "Building the new image (the running container is not touched)"
run dc build

# ---- Confirm -----------------------------------------------------------------
if [ "$DRY_RUN" -eq 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
  printf '\nThe service stops now for the backup and restart (about a minute). Continue? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) echo "Cancelled. Nothing was stopped."; exit 0 ;; esac
fi

# ---- Stop, back up -----------------------------------------------------------
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/pantrypal-data-$STAMP-${PREVIOUS_COMMIT:0:9}.tar.gz"

log "Stopping $SERVICE so SQLite closes the database cleanly"
run dc stop "$SERVICE"

log "Backing up data/ to $ARCHIVE"
run mkdir -p "$BACKUP_DIR"
if [ "$DRY_RUN" -eq 1 ]; then
  printf '[dry-run] tar -czf %s data/\n' "$ARCHIVE"
else
  if ! tar -czf "$ARCHIVE" data/; then
    rm -f "$ARCHIVE"
    echo "The backup failed, so nothing was changed. Starting the old container again." >&2
    dc start "$SERVICE" || true
    die "tar failed. If it is a permission error, run the script with sudo or fix the owner of data/."
  fi
  # A backup you cannot read back is not a backup.
  tar -tzf "$ARCHIVE" | grep -q '^data/pantrypal\.db$' || {
    dc start "$SERVICE" || true
    die "The archive has no data/pantrypal.db: $ARCHIVE"
  }
  echo "Backup OK: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
fi

# ---- Release -----------------------------------------------------------------
log "Starting the new version (migrations run when the server starts)"
run dc up -d

fail() {
  cat >&2 <<EOF

The new version did not become healthy. Read the logs:
  docker compose -f $COMPOSE_FILE logs --tail 100 $SERVICE

To roll back (restores the database from the backup and the previous code):
  docker compose -f $COMPOSE_FILE stop $SERVICE
  mv data data.failed-deploy-$STAMP
  tar -xzf $ARCHIVE
  git switch --detach $PREVIOUS_COMMIT
  docker compose -f $COMPOSE_FILE up -d --build --force-recreate

Migrations are forward-only: do not start old code on the new database.
Keep data.failed-deploy-$STAMP until the rollback is verified.
EOF
  exit 1
}

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] wait up to ${HEALTH_TIMEOUT}s for the $SERVICE health check"
else
  log "Waiting for the health check (up to ${HEALTH_TIMEOUT}s)"
  CID="$(dc ps -q "$SERVICE")"
  [ -n "$CID" ] || fail
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  status="starting"
  while [ "$SECONDS" -lt "$deadline" ]; do
    state="$(docker inspect --format '{{.State.Status}}' "$CID" 2>/dev/null || echo gone)"
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CID" 2>/dev/null || echo gone)"
    if [ "$state" != "running" ] && [ "$state" != "restarting" ]; then status="exited"; break; fi
    [ "$status" = "healthy" ] && break
    [ "$status" = "unhealthy" ] && break
    sleep 2
  done
  [ "$status" = "healthy" ] || fail

  log "Server log since start"
  dc logs --tail 30 "$SERVICE" || true
  log "Health"
  dc exec -T "$SERVICE" node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>r.text()).then(t=>console.log(t))" || true
fi

# ---- Housekeeping ------------------------------------------------------------
if [ "$DRY_RUN" -eq 0 ] && [ -d "$BACKUP_DIR" ]; then
  # Keep the newest KEEP_BACKUPS archives made by this script.
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/pantrypal-data-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | while read -r old; do
    echo "Removing old backup: $old"
    rm -f -- "$old"
  done
fi

log "Done"
echo "Deployed:   $NEW_COMMIT"
echo "Backup:     $ARCHIVE"
echo "Rollback:   see docs/host/updates.md#roll-back (previous commit $PREVIOUS_COMMIT)"
