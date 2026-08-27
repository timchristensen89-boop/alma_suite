#!/usr/bin/env bash
#
# Restore the ALMA database from a backup made by backup-db.sh.
#
# DESTRUCTIVE: this overwrites the current database with the dump's contents
# (the dumps are made with --clean --if-exists, so they drop and recreate every
# object). Runs on the VPS from the deploy directory.
#
#   scripts/restore-db.sh /opt/alma/backups/alma-alma_suite_v18-20260824T030000Z.sql.gz
#
# The one drill worth doing before you need it: restore last night's dump into a
# THROWAWAY database and eyeball a few tables, so "we have backups" is a fact,
# not a hope.
set -euo pipefail

COMPOSE_DIR="${ALMA_DEPLOY_DIR:-/opt/alma/deploy}"
DB_NAME="${ALMA_DB_NAME:-alma_suite_v18}"
DUMP="${1:-}"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "usage: $0 <path-to-backup.sql.gz>" >&2
  exit 1
fi
gzip -t "$DUMP"  # refuse a corrupt archive before touching the DB

echo "This will OVERWRITE the '${DB_NAME}' database with:"
echo "  ${DUMP}"
read -r -p "Type the database name to confirm: " CONFIRM
[ "$CONFIRM" = "$DB_NAME" ] || { echo "aborted."; exit 1; }

cd "$COMPOSE_DIR"
echo "→ restoring…"
gunzip -c "$DUMP" | docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d ${DB_NAME} -v ON_ERROR_STOP=1"
echo "→ restore complete. Restart the API so it reconnects cleanly:"
echo "    docker compose restart suite-api stock-api"
