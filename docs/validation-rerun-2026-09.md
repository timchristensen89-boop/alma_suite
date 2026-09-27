# Same-dump revalidation of the scoped-COGS batch (run by Tim on the VPS)

Read-only against an isolated restore of `alma-alma_suite_v18-20260926T170002Z.sql.gz`
at branch head `74e2db2`. Nothing touches production, the deployed tree or
the backups; the temp database and every helper are removed at the end.
Run each block in order from an SSH session on the VPS (`/var/tmp`, not
`/tmp`, which is a 982 MB RAM disk).

## 1. Fresh checkout of the branch head (host has no node; only git is needed here)

```bash
mkdir -p /var/tmp/alma-reval && cd /var/tmp/alma-reval
git clone --depth 1 --branch claude/kind-hamilton-2cibj9 https://github.com/timchristensen89-boop/alma_suite.git src
cd src && git rev-parse --short HEAD   # expect 74e2db2
```

## 2. Isolated temp database inside the compose Postgres (no host port is published)

```bash
cd /opt/alma/deploy
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS alma_reval;" -c "CREATE DATABASE alma_reval;"'
gunzip -c /opt/alma/backups/alma-alma_suite_v18-20260926T170002Z.sql.gz | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d alma_reval -q -v ON_ERROR_STOP=0' > /var/tmp/alma-reval/restore.log 2>&1
tail -3 /var/tmp/alma-reval/restore.log
```

## 3. Apply ONLY the new migration to the temp database (the dump is at the previous head, which had no scope columns)

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d alma_reval -v ON_ERROR_STOP=1' < /var/tmp/alma-reval/src/packages/db/prisma/migrations/20260927000000_stocktake_scope/migration.sql
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d alma_reval -c "SELECT scope, count(*) FROM \"Stocktake\" GROUP BY 1;"'
# expect one row: UNKNOWN | 33 — every existing count is UNKNOWN; no countedAt changed
```

## 4. Run the validator inside the existing API image on the compose network (the branch's source is bind-mounted read-only; the image's node_modules are reused)

```bash
docker compose run --rm -T --no-deps \
  -v /var/tmp/alma-reval/src/apps/api/scripts:/app/apps/api/scripts:ro \
  -v /var/tmp/alma-reval/src/apps/api/src:/app/apps/api/src:ro \
  -v /var/tmp/alma-reval/src/packages/db/src:/app/packages/db/src:ro \
  -v /var/tmp/alma-reval/src/packages/shared/src:/app/packages/shared/src:ro \
  -e NODE_ENV=development \
  -e DATABASE_URL="postgresql://$(docker compose exec -T postgres sh -c 'printf %s "$POSTGRES_USER"'):$(docker compose exec -T postgres sh -c 'printf %s "$POSTGRES_PASSWORD"')@postgres:5432/alma_reval" \
  --entrypoint sh api -c '
    cd /app/packages/shared && npx tsc -p tsconfig.json >/dev/null 2>&1 || true
    cd /app/packages/db && npx prisma generate >/dev/null 2>&1 && npx tsc -p tsconfig.json >/dev/null 2>&1 || true
    cd /app/apps/api && node --import tsx scripts/validate-reporting-integrity.ts 2026-06 2026-07 2026-08 2026-09
  ' > /var/tmp/alma-reval/scope-reval.txt 2>&1
wc -l /var/tmp/alma-reval/scope-reval.txt
```

If the image lacks `tsx` at that path, the earlier run's invocation (the one
that produced `alma-validation.txt`) applies unchanged apart from the mounts
and the four month arguments. If the shared/db compile step fails inside the
image, run it once on the Mac (`pnpm --filter @alma/shared --filter @alma/db
build`) and mount the resulting `dist` folders as well.

## 5. What to send back

The whole of `/var/tmp/alma-reval/scope-reval.txt` **with section 6
removed** (it names staff). Sections 2, 3 and 8 are the ones the
before/after matrix is built from:

- section 2 — every month × venue boundary with `used` / `rejected` /
  `short` lines; expected: all Jun–Aug combined figures UNAVAILABLE with
  every count listed as `unknown_scope` (all records are UNKNOWN until the
  remediation table is approved), Avalon June no longer complete;
- section 3 — Recap labour = Prime labour to the cent for every row; the
  August GROUP line shows which row is roster-only and the $193.22 beside
  it; the invoice-feed line for August shows `incomplete` and names the
  absent established suppliers;
- section 8 — each finalised count near the boundaries with its scope,
  valuation (UNVALUED count), date source (the two PDF imports show
  `unrecorded`, the CSV imports `unrecorded`, and countedAt 2026-08-03 for
  the two PDF records).

## 6. Cleanup (confirm each line's output)

```bash
cd /opt/alma/deploy
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS alma_reval;" -c "SELECT datname FROM pg_database WHERE datname LIKE '"'"'alma%'"'"';"'
#   expect: only the production database name, no alma_reval
rm -rf /var/tmp/alma-reval /var/tmp/scope-out.txt
ls /var/tmp | grep -i alma || echo "no alma temp files left"
ls /opt/alma/backups/*.sql.gz | wc -l          # unchanged count
cd /opt/alma/alma-suite && git status --short | wc -l && git rev-parse --short HEAD   # deployed tree untouched, same head as before
docker compose ps --format '{{.Name}} {{.Status}}'                                   # all services still up
```

`/var/tmp/scope-out.txt` and the copy of the validation output on the Mac
(`~/Desktop/alma-validation.txt`, which contains section 6 with staff
names) should be deleted once the matrix is confirmed.
