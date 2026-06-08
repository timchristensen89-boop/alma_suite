#!/usr/bin/env bash
set -euo pipefail

# Set par levels from usage (DRY RUN unless PAR_CONFIRM=YES). Mirrors migrate-production.sh (Secret Manager + Cloud SQL proxy).
INSTANCE="alma-compliance:australia-southeast1:alma-compliance-db"
PORT=5444
PROJECT="alma-compliance"

echo "→ Fetching DATABASE_URL from Secret Manager..."
RAW_URL=$(gcloud secrets versions access latest --secret="DATABASE_URL" --project="$PROJECT")
echo "→ Starting Cloud SQL Auth Proxy on port $PORT..."
cloud-sql-proxy "$INSTANCE" --port "$PORT" &
PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null; echo '→ Proxy stopped.'" EXIT
sleep 4
echo "→ Rewriting socket URL to TCP..."
TCP_URL=$(PROXY_PORT="$PORT" RAW_URL="$RAW_URL" python3 -c "
import os
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
url=os.environ['RAW_URL'].strip(); port=os.environ['PROXY_PORT']; parts=urlsplit(url)
q=[(k,v) for k,v in parse_qsl(parts.query, keep_blank_values=True) if k not in ('host','sslmode')]
n=(parts.username or '')+((':'+parts.password) if parts.password is not None else '')
n=(n+'@' if n else '')+'127.0.0.1:'+port
print(urlunsplit((parts.scheme,n,parts.path,urlencode(q),parts.fragment)))
")
echo "→ Running..."
cd "$(dirname "$0")/.."
DATABASE_URL="$TCP_URL" PAR_CONFIRM="${PAR_CONFIRM:-}" PAR_LOOKBACK_DAYS="${PAR_LOOKBACK_DAYS:-120}" pnpm --filter @alma/api exec tsx scripts/set-par-from-usage.ts
echo "✓ Done."
