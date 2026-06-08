#!/usr/bin/env bash
set -euo pipefail
# Estimate + set yield quantity/unit on production recipes (DRY RUN unless YIELD_CONFIRM=YES).
INSTANCE="alma-compliance:australia-southeast1:alma-compliance-db"; PORT=5446; PROJECT="alma-compliance"
echo "→ Fetching DATABASE_URL from Secret Manager..."
RAW_URL=$(gcloud secrets versions access latest --secret="DATABASE_URL" --project="$PROJECT")
echo "→ Starting Cloud SQL Auth Proxy on port $PORT..."
cloud-sql-proxy "$INSTANCE" --port "$PORT" & PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null; echo '→ Proxy stopped.'" EXIT
sleep 4
TCP_URL=$(PROXY_PORT="$PORT" RAW_URL="$RAW_URL" python3 -c "
import os
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
url=os.environ['RAW_URL'].strip(); port=os.environ['PROXY_PORT']; p=urlsplit(url)
q=[(k,v) for k,v in parse_qsl(p.query, keep_blank_values=True) if k not in ('host','sslmode')]
n=(p.username or '')+((':'+p.password) if p.password is not None else ''); n=(n+'@' if n else '')+'127.0.0.1:'+port
print(urlunsplit((p.scheme,n,p.path,urlencode(q),p.fragment)))")
echo "→ Estimating recipe yields (${YIELD_CONFIRM:-DRY RUN})..."
cd "$(dirname "$0")/.."
DATABASE_URL="$TCP_URL" YIELD_CONFIRM="${YIELD_CONFIRM:-}" ALL_RECIPES="${ALL_RECIPES:-}" \
  pnpm --filter @alma/api exec tsx scripts/estimate-recipe-yields.ts
echo "✓ Done."
