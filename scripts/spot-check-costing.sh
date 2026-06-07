#!/usr/bin/env bash
set -euo pipefail

# Read-only spot-check of staff costing against the production database.
# Mirrors migrate-production.sh exactly (same proxy + secret handling) but
# runs a read-only query instead of a migration. Prints, for every ACTIVE
# staffer, whether the costing report can cost them (salaried / hourly /
# no-rate) and the salaried weekly wage the fix now applies.

INSTANCE="alma-compliance:australia-southeast1:alma-compliance-db"
PORT=5435
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

echo "→ Running read-only costing spot-check..."
cd "$(dirname "$0")/.."
DATABASE_URL="$TCP_URL" pnpm --filter @alma/api exec tsx scripts/spot-check-costing.ts

echo "✓ Done."
