#!/usr/bin/env bash
set -euo pipefail

INSTANCE="alma-compliance:australia-southeast1:alma-compliance-db"
PORT=5434
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
# Pass PORT as an env var + raw URL via stdin. Cloud SQL stores the
# socket as ?host=/cloudsql/... — strip that + any sslmode flag (the
# local proxy doesn't need SSL) and point at 127.0.0.1:$PORT instead.
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

echo "→ Running prisma migrate deploy..."
cd "$(dirname "$0")/.."
DATABASE_URL="$TCP_URL" pnpm db:migrate:production

echo "✓ Done."
