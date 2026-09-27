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

## 7. Evidence queries the validator does not print (all SELECT; run against `alma_reval`)

```bash
cd /opt/alma/deploy
Q() { docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d alma_reval -X -A -F " | "'; }
```

**7a. Supplier cadence per month (which suppliers the rule treats as established, and why).** For each of Jun–Sep: every supplier's distinct invoice dates in the 90 days before the month, its last invoice before the month, its longest gap, and whether it invoiced in the month. `established` = ≥ 3 dates AND last invoice ≤ 45 days before the start; `absent flagged` = established, no invoice in the month, and the month's elapsed days ≥ max(14, 2 × longest gap).

```sql
Q <<'SQL'
WITH months(m, start_at, end_at) AS (VALUES
  ('2026-06', timestamptz '2026-05-31 14:00Z', timestamptz '2026-06-30 14:00Z'),
  ('2026-07', timestamptz '2026-06-30 14:00Z', timestamptz '2026-07-31 14:00Z'),
  ('2026-08', timestamptz '2026-07-31 14:00Z', timestamptz '2026-08-31 14:00Z'),
  ('2026-09', timestamptz '2026-08-31 14:00Z', timestamptz '2026-09-30 14:00Z')),
inv AS (
  SELECT "supplierName" AS s, "invoiceDate"::date AS d
  FROM "SupplierInvoice" WHERE status <> 'DRAFT' AND "triageStatus" <> 'NO_ITEM' AND "invoiceDate" IS NOT NULL),
lb AS (
  SELECT m.m, i.s, i.d FROM months m JOIN inv i ON i.d >= (m.start_at - interval '90 days')::date AND i.d < m.start_at::date),
gaps AS (
  SELECT m, s, d, d - lag(d) OVER (PARTITION BY m, s ORDER BY d) AS gap FROM (SELECT DISTINCT m, s, d FROM lb) x),
prof AS (
  SELECT m, s, count(DISTINCT d) AS dates, max(d) AS last_before, coalesce(max(gap), 0) AS longest_gap FROM gaps GROUP BY m, s),
inm AS (
  SELECT m.m, i.s, count(*) AS invoices_in_month, min(i.d) AS first_in, max(i.d) AS last_in
  FROM months m JOIN inv i ON i.d >= m.start_at::date AND i.d < m.end_at::date GROUP BY m.m, i.s)
SELECT p.m, p.s AS supplier, p.dates AS dates_prior_90d, p.last_before, p.longest_gap AS longest_gap_days,
       (p.dates >= 3 AND (mo.start_at::date - p.last_before) <= 45) AS established,
       coalesce(im.invoices_in_month, 0) AS invoices_in_month, im.first_in, im.last_in,
       LEAST(EXTRACT(EPOCH FROM (mo.end_at - mo.start_at))/86400, EXTRACT(EPOCH FROM (now() - mo.start_at))/86400)::int AS elapsed_days,
       (p.dates >= 3 AND (mo.start_at::date - p.last_before) <= 45 AND coalesce(im.invoices_in_month,0) = 0
        AND LEAST(EXTRACT(EPOCH FROM (mo.end_at - mo.start_at))/86400, EXTRACT(EPOCH FROM (now() - mo.start_at))/86400) >= GREATEST(14, 2*p.longest_gap)) AS absent_flagged
FROM prof p JOIN months mo ON mo.m = p.m LEFT JOIN inm im ON im.m = p.m AND im.s = p.s
ORDER BY p.m, established DESC, p.s;
SQL
```

**7b. Component-gap evidence: every finalised count within ±7 days of each boundary, per venue, with its scope, value and unvalued-line count, so the FOOD/BEVERAGE date gaps that could compose are visible.** (Scopes are all UNKNOWN in the dump; the gap question is about the dates.)

```sql
Q <<'SQL'
WITH b(boundary) AS (VALUES (timestamptz '2026-05-31 14:00Z'), (timestamptz '2026-06-30 14:00Z'), (timestamptz '2026-07-31 14:00Z'), (timestamptz '2026-08-31 14:00Z'), (timestamptz '2026-09-30 14:00Z')),
c AS (
  SELECT s.id, s.name, s.venue, s.template, s."importSource", s.scope, s."countedAt",
         count(l.id) AS lines,
         count(l.id) FILTER (WHERE l."countedQty" > 0 AND l."stockValueCents" IS NULL) AS unvalued,
         coalesce(sum(l."stockValueCents"),0)/100.0 AS value
  FROM "Stocktake" s LEFT JOIN "StocktakeLine" l ON l."stocktakeId" = s.id
  WHERE s.status IN ('SUBMITTED','REVIEWED','LOCKED') GROUP BY s.id)
SELECT to_char(b.boundary AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD') AS boundary_day, c.venue,
       to_char(c."countedAt" AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD HH24:MI') AS counted_sydney,
       round(EXTRACT(EPOCH FROM (c."countedAt" - b.boundary))/86400, 2) AS signed_days,
       c.scope, c.value, c.lines, c.unvalued, c.template, c."importSource", left(c.id, 8) AS id8, c.name
FROM b JOIN c ON abs(EXTRACT(EPOCH FROM (c."countedAt" - b.boundary))) <= 7*86400
ORDER BY b.boundary, c.venue, c."countedAt";
SQL
```

**7c. The August labour rows without PII.** The validator's section 3 already prints every Prime row's basis. This names the roster shifts behind any roster-only row by shift venue label and an 8-character profile-id prefix only (no names).

```sql
Q <<'SQL'
SELECT coalesce(nullif(trim(r.venue),''), nullif(trim(p.venue),''), 'Unassigned') AS row_key,
       left(r."staffProfileId", 8) AS profile_id8,
       count(*) AS shifts,
       round(sum(EXTRACT(EPOCH FROM (r."endsAt" - r."startsAt"))/3600 - coalesce(r."breakMinutes",0)/60.0)::numeric, 2) AS roster_hours,
       (SELECT count(*) FROM "Timesheet" t WHERE t."staffProfileId" = r."staffProfileId" AND t."workDate" >= '2026-07-31' AND t."workDate" < '2026-08-31' AND t.status IN ('DRAFT','SUBMITTED','APPROVED','EXPORTED')) AS timesheets_in_aug
FROM "RosterShift" r JOIN "StaffProfile" p ON p.id = r."staffProfileId"
WHERE r."startsAt" < '2026-08-31 14:00Z' AND r."endsAt" > '2026-07-31 14:00Z' AND r.status <> 'CANCELLED' AND p."accountType" = 'HUMAN'
  AND coalesce(nullif(trim(r.venue),''), nullif(trim(p.venue),''), 'Unassigned') NOT IN ('Alma Avalon', 'St Alma')
GROUP BY 1, 2 ORDER BY 1, 2;
SQL
```

Send 7a–7c with the validator output (section 6 removed).

## 8. Alternative: run everything in the Claude session instead of on the VPS

The session container has Postgres 16 installed (cluster `main`, currently stopped) and the branch checked out, but no route to the VPS and no copy of the dump. Uploading `alma-alma_suite_v18-20260926T170002Z.sql.gz` (78 MB) into the session lets the restore, migration, validator, evidence queries and cleanup all run there, with nothing on the VPS touched at all. The upload should be deleted from the session afterwards along with the restored database.
