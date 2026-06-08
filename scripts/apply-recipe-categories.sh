#!/usr/bin/env bash
set -euo pipefail
# Fill blank recipe categories from a CSV (DRY RUN unless RECIPE_CAT_CONFIRM=YES).
INSTANCE="alma-compliance:australia-southeast1:alma-compliance-db"; PORT=5445; PROJECT="alma-compliance"
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
echo "→ Running recipe category fill (${RECIPE_CAT_CONFIRM:-DRY RUN})..."
cd "$(dirname "$0")/.."
CSV_PATH="${RECIPE_CATEGORIES_CSV:-docs/recipes-categorized.csv}"
case "$CSV_PATH" in /*) ;; *) CSV_PATH="$(pwd)/$CSV_PATH" ;; esac
DATABASE_URL="$TCP_URL" RECIPE_CATEGORIES_CSV="$CSV_PATH" RECIPE_CAT_CONFIRM="${RECIPE_CAT_CONFIRM:-}" \
  pnpm --filter @alma/api exec tsx scripts/apply-recipe-categories.ts
echo "✓ Done."
