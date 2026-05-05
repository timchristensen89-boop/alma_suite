#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  source ./.env
  set +a
fi

DB_USER="${ALMA_DB_USER:-alma}"
DB_PASSWORD="${ALMA_DB_PASSWORD:-alma}"
DB_NAME="${ALMA_DB_NAME:-alma_suite_v18}"

npm run db:up >/dev/null

until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done

docker compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE "$DB_USER" LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE "$DB_USER" WITH LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;

ALTER ROLE "$DB_USER" CREATEDB;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME') THEN
    CREATE DATABASE "$DB_NAME" OWNER "$DB_USER";
  END IF;
END
\$\$;

ALTER DATABASE "$DB_NAME" OWNER TO "$DB_USER";
GRANT ALL PRIVILEGES ON DATABASE "$DB_NAME" TO "$DB_USER";
SQL

echo "Postgres role '$DB_USER' and database '$DB_NAME' are ready."
