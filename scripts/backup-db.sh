#!/usr/bin/env bash
#
# Nightly database backup for the ALMA suite.
#
# The production database is a single Docker volume on one VPS. Until this
# script runs on a schedule, that volume is the ONLY copy of every order,
# timesheet, guest record, gift-card balance, and every uploaded file (supplier
# invoices, handbook documents and gift-card artwork are stored as bytes in the
# database). Losing the volume loses all of it. This makes a compressed dump
# every night, keeps a local window, and — once a bucket is configured — pushes
# it offsite so a dead VPS is a restore, not a catastrophe.
#
# Runs ON THE VPS, from the deploy directory. Install as a root cron:
#   0 3 * * *  /opt/alma/alma-suite/scripts/backup-db.sh >> /var/log/alma-backup.log 2>&1
#
# Offsite copy (strongly recommended — a local-only backup dies with the box):
# set ONE of these in the cron's environment or an EnvironmentFile:
#   BACKUP_GCS_BUCKET="gs://alma-db-backups"     # uses `gcloud storage cp`
#   BACKUP_RCLONE_REMOTE="b2:alma-db-backups"    # uses `rclone copy`
set -euo pipefail

COMPOSE_DIR="${ALMA_DEPLOY_DIR:-/opt/alma/deploy}"
DB_NAME="${ALMA_DB_NAME:-alma_suite_v18}"
BACKUP_DIR="${ALMA_BACKUP_DIR:-/opt/alma/backups}"
KEEP_DAYS="${ALMA_BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/alma-${DB_NAME}-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
cd "$COMPOSE_DIR"

echo "→ [$(date -u +%FT%TZ)] dumping ${DB_NAME}"
# The container's superuser name lives in $POSTGRES_USER inside the container —
# read it there rather than assuming 'postgres' (this box's role is 'alma').
docker compose exec -T postgres sh -c "pg_dump -U \"\$POSTGRES_USER\" -d ${DB_NAME} --no-owner --clean --if-exists" \
  | gzip -9 > "$OUT.partial"
mv "$OUT.partial" "$OUT"
SIZE="$(du -h "$OUT" | cut -f1)"
echo "→ wrote ${OUT} (${SIZE})"

# A zero-length or truncated dump is worse than none — it hides the failure.
if [ ! -s "$OUT" ] || [ "$(gzip -t "$OUT" 2>&1)" ]; then
  echo "✗ backup is empty or corrupt — NOT rotating old backups" >&2
  exit 1
fi

# Offsite copy, if configured.
if [ -n "${BACKUP_GCS_BUCKET:-}" ]; then
  echo "→ uploading to ${BACKUP_GCS_BUCKET}"
  gcloud storage cp "$OUT" "${BACKUP_GCS_BUCKET%/}/$(basename "$OUT")"
elif [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  echo "→ uploading to ${BACKUP_RCLONE_REMOTE}"
  rclone copy "$OUT" "${BACKUP_RCLONE_REMOTE}"
else
  echo "⚠ no offsite target set (BACKUP_GCS_BUCKET / BACKUP_RCLONE_REMOTE) — local copy only"
fi

# Rotate local copies (offsite retention is the bucket's lifecycle policy).
echo "→ pruning local backups older than ${KEEP_DAYS} days"
find "$BACKUP_DIR" -name "alma-${DB_NAME}-*.sql.gz" -type f -mtime "+${KEEP_DAYS}" -print -delete
echo "→ done"
