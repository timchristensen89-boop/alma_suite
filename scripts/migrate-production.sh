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
TCP_URL=$(python3 -c "
import re, sys
url = sys.stdin.read().strip()
# Cloud SQL socket format: postgresql://user:pass@/dbname?host=/cloudsql/...
# Convert to TCP:          postgresql://user:pass@127.0.0.1:PORT/dbname
url = re.sub(r'@/([^?]+)\?host=\S+', '@127.0.0.1:$PORT/\1', url)
print(url)
" <<< "$RAW_URL")

echo "→ Running prisma migrate deploy..."
cd "$(dirname "$0")/.."
DATABASE_URL="$TCP_URL" pnpm db:migrate:production

echo "✓ Done."
