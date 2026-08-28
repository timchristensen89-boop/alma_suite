#!/usr/bin/env bash
set -euo pipefail

# One-off: correct Alma Avalon's card tips for 22-28 August 2026.
#
# Two faults were running at once in the emailed Lightspeed report, and
# together they produced figures that are exactly 3x two days added together:
#
#   1. The report stopped carrying a date column, so two trading days landed
#      on one fallback date ("yesterday in Sydney", read at import time).
#   2. Each day's total was still repeated across rows, and the pre-8723cf9
#      parser summed those rows instead of counting them once.
#
# The arithmetic is exact, which is how we know this is the whole story:
#
#   Sat 22 $184.11 + Sun 23  $43.18 = $227.29   x3 = $681.87  (stored on 23rd)
#   Wed 26  $86.70 + Thu 27  $79.15 = $165.85   x3 = $497.55  (stored on 27th)
#
# So 22 and 26 Aug have no row at all — their money was absorbed into the
# following day and then tripled.
#
# The true figures below come from the Lightspeed sale-level export
# (sales_feed_20260829), summing the Tip column per trading day. That method
# was validated against a day we already know: it returns $108.85 for Friday
# 21 August, matching the figure the earlier repair set by hand, and its
# sales total for 23 August ($2,382.55) matches the stored day total to the
# cent. One sale crossed midnight (SP-Til23 0822104819, closed on the 23rd);
# it carried no tip, so it changes nothing.
#
#   Sat 22 Aug   $184.11   (no row today)
#   Sun 23 Aug    $43.18   (currently $681.87)
#   Wed 26 Aug    $86.70   (no row today)
#   Thu 27 Aug    $79.15   (currently $497.55)
#   Fri 28 Aug   $331.81   (whatever is there now)
#
# NOTE ON DIRECTION: this makes the week of 17-23 Aug SMALLER, from $1,018.12
# to $563.54. Staff were on track to be over-paid by $454.58, not short. No
# payment run exists for either week, so this is a correction before payout
# rather than a clawback.
#
# DRY RUN unless FIX_AVALON_TIPS_CONFIRM=YES. Run it on the VPS:
#
#     cd /opt/alma/alma-suite && ./scripts/fix-avalon-tips-aug-22-28.sh
#     cd /opt/alma/alma-suite && FIX_AVALON_TIPS_CONFIRM=YES ./scripts/fix-avalon-tips-aug-22-28.sh
#
# Safe to run twice: it sets absolute amounts via an upsert keyed on
# importKey, so a second run is a no-op rather than a further division.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
DB="${DB:-alma_suite_v18}"
CONFIRM="${FIX_AVALON_TIPS_CONFIRM:-NO}"

psql_run() {
  (cd "$DEPLOY_DIR" && docker compose exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d $DB")
}

echo "→ Before:"
psql_run <<'SQL'
SELECT "serviceDate"::date AS day,
       to_char("serviceDate", 'Dy')  AS dow,
       "amountCents"/100.0           AS dollars,
       source,
       notes
FROM "StaffTipCardEntry"
WHERE venue = 'Alma Avalon'
  AND "serviceDate" >= '2026-08-17' AND "serviceDate" < '2026-08-31'
ORDER BY "serviceDate";
SQL

echo
echo "→ Payment runs for the affected weeks (an approved run will NOT change):"
psql_run <<'SQL'
SELECT id, "weekStart"::date, "weekEnd"::date, "tipPoolCents"/100.0 AS pool, status, "paidAt"
FROM "StaffTipPaymentRun"
WHERE venue = 'Alma Avalon'
  AND "weekStart" >= '2026-08-10' AND "weekStart" < '2026-08-31'
ORDER BY "weekStart";
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

INSERT INTO "StaffTipCardEntry"
  (id, venue, "serviceDate", "amountCents", source, "externalId", "importKey", notes, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'Alma Avalon', TIMESTAMP '2026-08-22 00:00:00', 18411, 'lightspeed-email',
   'lightspeed-email:Alma Avalon:2026-08-22', 'lightspeed-email:Alma Avalon:2026-08-22',
   'Corrected from the Lightspeed sale-level export. The emailed report merged this day into the 23rd and tripled it.', now(), now()),
  (gen_random_uuid()::text, 'Alma Avalon', TIMESTAMP '2026-08-23 00:00:00', 4318, 'lightspeed-email',
   'lightspeed-email:Alma Avalon:2026-08-23', 'lightspeed-email:Alma Avalon:2026-08-23',
   'Corrected from the Lightspeed sale-level export. Was $681.87 = 3 x (22nd $184.11 + 23rd $43.18).', now(), now()),
  (gen_random_uuid()::text, 'Alma Avalon', TIMESTAMP '2026-08-26 00:00:00', 8670, 'lightspeed-email',
   'lightspeed-email:Alma Avalon:2026-08-26', 'lightspeed-email:Alma Avalon:2026-08-26',
   'Corrected from the Lightspeed sale-level export. The emailed report merged this day into the 27th and tripled it.', now(), now()),
  (gen_random_uuid()::text, 'Alma Avalon', TIMESTAMP '2026-08-27 00:00:00', 7915, 'lightspeed-email',
   'lightspeed-email:Alma Avalon:2026-08-27', 'lightspeed-email:Alma Avalon:2026-08-27',
   'Corrected from the Lightspeed sale-level export. Was $497.55 = 3 x (26th $86.70 + 27th $79.15).', now(), now()),
  (gen_random_uuid()::text, 'Alma Avalon', TIMESTAMP '2026-08-28 00:00:00', 33181, 'lightspeed-email',
   'lightspeed-email:Alma Avalon:2026-08-28', 'lightspeed-email:Alma Avalon:2026-08-28',
   'Set from the Lightspeed sale-level export.', now(), now())
ON CONFLICT ("importKey") DO UPDATE
  SET "amountCents" = EXCLUDED."amountCents",
      notes         = EXCLUDED.notes,
      "updatedAt"   = now();

COMMIT;
SQL

echo
echo "→ After (expect Sat 184.11, Sun 43.18, Wed 86.70, Thu 79.15, Fri 331.81):"
psql_run <<'SQL'
SELECT "serviceDate"::date AS day,
       to_char("serviceDate", 'Dy') AS dow,
       "amountCents"/100.0          AS dollars
FROM "StaffTipCardEntry"
WHERE venue = 'Alma Avalon'
  AND "serviceDate" >= '2026-08-17' AND "serviceDate" < '2026-08-31'
ORDER BY "serviceDate";

\echo 'Week 17-23 Aug (expect 563.54, was 1018.12):'
SELECT SUM("amountCents")/100.0 AS week_17_23
FROM "StaffTipCardEntry"
WHERE venue = 'Alma Avalon'
  AND "serviceDate" >= '2026-08-17' AND "serviceDate" < '2026-08-24';

\echo 'Week 24-30 Aug so far (expect 497.66 through Friday):'
SELECT SUM("amountCents")/100.0 AS week_24_30
FROM "StaffTipCardEntry"
WHERE venue = 'Alma Avalon'
  AND "serviceDate" >= '2026-08-24' AND "serviceDate" < '2026-08-31';
SQL
