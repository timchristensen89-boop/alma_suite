#!/usr/bin/env bash
set -euo pipefail

# Apply stock item units (purchase/count unit + conversion factor) from a CSV
# against the production database. DRY RUN unless UNITS_CONFIRM=YES. Mirrors
# migrate-production.sh (Secret Manager + Cloud SQL proxy).
#
#   ITEM_UNITS_CSV=docs/items-units.csv ./scripts/apply-item-units.sh
#   ITEM_UNITS_CSV=docs/items-units.csv UNITS_CONFIRM=YES ./scripts/apply-item-units.sh

INSTANCE="alma-compliance:australia-southeast1:alma-compliance-db"
PORT=5442
SECRET="DATABASE_URL"
PROJECT="alma-compliance"

echo "→ Fetching DATABASE_URL from Secret Manager..."
RAW_URL=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")

echo "→ Starting Cloud SQL Auth Proxy on port $PORT..."
cloud-sql-proxy "$INSTANCE" --port "$PORT" &
PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null; echo '→ Proxy stopped.'" EXIT
sleep 4

echo "→ Rewriting socket URL to TCP..."
TCP_URL=$(PROXY_PORT="$PORT" RAW_URL="$RAW_URL" python3 -c "
import os
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
url = os.environ['RAW_URL'].strip()
port = os.environ['PROXY_PORT']
parts = urlsplit(url)
query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in ('host', 'sslmode')]
new_netloc = (parts.username or '')
if parts.password is not None:
    new_netloc += ':' + parts.password
if new_netloc:
    new_netloc += '@'
new_netloc += '127.0.0.1:' + port
print(urlunsplit((parts.scheme, new_netloc, parts.path, urlencode(query), parts.fragment)))
")

echo "→ Applying item units (${UNITS_CONFIRM:-DRY RUN})..."
cd "$(dirname "$0")/.."
CSV_PATH="${ITEM_UNITS_CSV:-docs/items-units.csv}"
case "$CSV_PATH" in /*) ;; *) CSV_PATH="$(pwd)/$CSV_PATH" ;; esac
DATABASE_URL="$TCP_URL" \
  ITEM_UNITS_CSV="$CSV_PATH" \
  UNITS_CONFIRM="${UNITS_CONFIRM:-}" \
  pnpm --filter @alma/api exec tsx scripts/apply-item-units.ts

echo "✓ Done."
