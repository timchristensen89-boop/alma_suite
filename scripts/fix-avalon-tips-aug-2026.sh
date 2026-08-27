#!/usr/bin/env bash
set -euo pipefail

# One-off: correct Alma Avalon's card tips for the week of 17 August 2026.
#
# The emailed Lightspeed report carries the day's TOTAL tips on every
# revenue-centre row, and the importer summed those rows — so each day was
# stored at exactly three times the money that was in the till:
#
#     Wed 19 Aug   $483.15 stored   $161.05 taken
#     Thu 20 Aug   $199.05 stored    $66.35 taken
#     Fri 21 Aug   $326.55 stored   $108.85 taken
#
# The parser is fixed (apps/api/src/lib/tip-rows.ts), but that only changes
# what future imports write. These four rows are already stored and have to be
# corrected by hand. The Monday row is a $1.00 stub, not a tripled day, so it
# is removed rather than divided.
#
# The figures below are Tim's, taken off the Lightspeed report itself.
#
# DRY RUN unless FIX_AVALON_TIPS_CONFIRM=YES. Run it on the VPS:
#
#     cd /opt/alma/alma-suite && ./scripts/fix-avalon-tips-aug-2026.sh
#     cd /opt/alma/alma-suite && FIX_AVALON_TIPS_CONFIRM=YES ./scripts/fix-avalon-tips-aug-2026.sh
#
# Safe to run twice: it sets absolute amounts rather than dividing, so a second
# run is a no-op rather than a ninth of the money.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
DB="${DB:-alma_suite_v18}"
CONFIRM="${FIX_AVALON_TIPS_CONFIRM:-NO}"

psql_run() {
  (cd "$DEPLOY_DIR" && docker compose exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d $DB")
}

echo "→ Before:"
psql_run <<'SQL'
SELECT "serviceDate"::date AS day, "amountCents"/100.0 AS dollars, source
FROM "StaffTipCardEntry"
WHERE venue = 'Alma Avalon'
  AND "serviceDate" >= '2026-08-17' AND "serviceDate" < '2026-08-24'
ORDER BY "serviceDate";
SQL

echo
echo "→ Locked tip run for that week (a run already approved will NOT change):"
psql_run <<'SQL'
SELECT id, "weekStart"::date, "weekEnd"::date, "tipPoolCents"/100.0 AS pool, "paidAt"
FROM "StaffTipPaymentRun"
WHERE venue = 'Alma Avalon' AND "weekStart" >= '2026-08-17' AND "weekStart" < '2026-08-24';
SQL

if [ "$CONFIRM" != "YES" ]; then
  echo
  echo "DRY RUN — nothing written. Re-run with FIX_AVALON_TIPS_CONFIRM=YES to apply."
  exit 0
fi

echo
echo "→ Applying…"
psql_run <<'SQL'
BEGIN;

UPDATE "StaffTipCardEntry"
   SET "amountCents" = 16105,
       notes = 'Corrected: emailed report repeated the day total on 3 rows.'
 WHERE venue = 'Alma Avalon' AND source = 'lightspeed-email' AND "serviceDate" = '2026-08-19';

UPDATE "StaffTipCardEntry"
   SET "amountCents" = 6635,
       notes = 'Corrected: emailed report repeated the day total on 3 rows.'
 WHERE venue = 'Alma Avalon' AND source = 'lightspeed-email' AND "serviceDate" = '2026-08-20';

UPDATE "StaffTipCardEntry"
   SET "amountCents" = 10885,
       notes = 'Corrected: emailed report repeated the day total on 3 rows.'
 WHERE venue = 'Alma Avalon' AND source = 'lightspeed-email' AND "serviceDate" = '2026-08-21';

-- Monday was a $1.00 stub, never a real trading day.
DELETE FROM "StaffTipCardEntry"
 WHERE venue = 'Alma Avalon' AND source = 'lightspeed-email' AND "serviceDate" = '2026-08-17';

COMMIT;
SQL

echo
echo "→ After (expect Wed 161.05, Thu 66.35, Fri 108.85 — 336.25 for the week):"
psql_run <<'SQL'
SELECT "serviceDate"::date AS day, "amountCents"/100.0 AS dollars
FROM "StaffTipCardEntry"
WHERE venue = 'Alma Avalon'
  AND "serviceDate" >= '2026-08-17' AND "serviceDate" < '2026-08-24'
ORDER BY "serviceDate";

SELECT SUM("amountCents")/100.0 AS avalon_week_total
FROM "StaffTipCardEntry"
WHERE venue = 'Alma Avalon'
  AND "serviceDate" >= '2026-08-17' AND "serviceDate" < '2026-08-24';
SQL
