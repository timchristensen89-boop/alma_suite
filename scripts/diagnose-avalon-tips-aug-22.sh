#!/usr/bin/env bash
# Deliberately no -e, unlike the other scripts here: Section A leans on
# grep -c and grep -rl, which exit non-zero when a count is zero, and that
# is a RESULT worth printing rather than a reason to stop before the SQL.
set -uo pipefail

# Read-only diagnosis: why does Alma Avalon have no card-tip row for
# Saturday 22 August 2026, and why is Sunday the 23rd four to six times a
# normal day?
#
# Run it on the VPS:
#
#     cd /opt/alma/alma-suite && ./scripts/diagnose-avalon-tips-aug-22.sh
#
# Nothing here writes. Every statement is a SELECT or an inspect.
#
# ── What the stored rows already tell us ─────────────────────────────────────
#
#   Wed 19 Aug   $161.05   written 2026-08-19 18:10:02 UTC
#   Thu 20 Aug    $66.35   written 2026-08-20 18:10:02 UTC
#   Fri 21 Aug   $108.85   written 2026-08-21 18:10:02 UTC
#   Sat 22 Aug        --   nothing was written at 2026-08-22 18:10 UTC
#   Sun 23 Aug   $681.87   written 2026-08-23 18:20:03 UTC  (ten minutes late)
#
# Timestamps are UTC; Sydney is UTC+10 in August, so each report lands about
# 04:10 the next morning covering the day before. Saturday's slot produced
# nothing at all.
#
# ── The two symptoms factorise ───────────────────────────────────────────────
#
#   S1  no row at all for Saturday 22 Aug
#   S2  $681.87 on Sunday, written ten minutes off an otherwise 0.3s-stable slot
#
# Leading explanations, and what each needs to be true:
#
#   R1  The triple-count fix (commit 8723cf9, merged 22 Aug 07:19 Sydney) was
#       never DEPLOYED. Nothing in the repo deploys on merge — .github/workflows
#       /ci.yml is workflow_dispatch only with no deploy job — and the repair
#       script that corrected 19/20/21 Aug is bash reading the source tree, so
#       it proves the source was pulled, never that the image was rebuilt.
#       Avalon's report is KNOWN to repeat the day total on exactly 3 rows
#       (483.15/161.05 = 199.05/66.35 = 326.55/108.85 = 3.000000), and 68187
#       divides by 3 exactly -> a real Sunday of $227.29. Under the FIXED build
#       three identical rows collapse to one and 68187 is impossible.
#       Section A answers this outright.
#
#   R2  One email carried BOTH days with no per-row date, so fallbackDateKey
#       (lightspeed-inbound.service.ts:373, :501) put them on one key and
#       totalTipsPerDay summed two distinct figures (tip-rows.ts:50).
#       Money misdated, not lost.
#
#   R3  Saturday's email was retried after Sydney midnight and re-stamped as
#       the 23rd (yesterdaySydneyKey is read at PROCESSING time), then the
#       importKey upsert REPLACED rather than added, so one day's money
#       overwrote the other's.
#
# One thing is already established from code and needs no query: the tip write
# at :522-537 is `update: { amountCents }` — an absolute SET, never an
# increment — and importKey is unique. So $681.87 was computed inside a SINGLE
# handleInboundEmail call. Two separate deliveries cannot have added up to it.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/alma/deploy}"
SRC_DIR="${SRC_DIR:-/opt/alma/alma-suite}"
DB="${DB:-alma_suite_v18}"

echo "############################################################"
echo "# SECTION A — is the fixed parser actually RUNNING?"
echo "#"
echo "# This is the fastest way to settle R1, and no SQL can answer"
echo "# it. The string 'day total repeated on' exists only in the"
echo "# post-8723cf9 build."
echo "#"
echo "#   found in the RUNNING container  -> fix is live, R1 is dead"
echo "#   absent from the container       -> the old bundle is still"
echo "#                                      serving and the triple-"
echo "#                                      count never stopped"
echo "############################################################"
echo

echo "--- source tree checkout (proves only what was PULLED) ---"
git -C "$SRC_DIR" log -1 --format='%H %ad %s' --date=iso 2>&1 | head -1
echo
echo "--- does the source tree carry the fix? ---"
grep -c "day total repeated on" "$SRC_DIR/apps/api/src/services/lightspeed-inbound.service.ts" 2>&1 \
  | sed 's/^/  matches in source: /'
echo
echo "--- what the RUNNING api container is serving (the real answer) ---"
(cd "$DEPLOY_DIR" && docker compose ps --format '{{.Service}}\t{{.Image}}\t{{.Status}}' 2>&1) | sed 's/^/  /'
echo
echo "--- grep the built bundle inside the container ---"
# The service is suite-api, not api. Hardcoding "api" made this step print a
# "not running" error and then assert the fix was missing regardless, which is
# worse than not checking at all - so detect the name and only draw a
# conclusion when the grep actually ran.
API_SVC="${API_SVC:-}"
if [ -z "$API_SVC" ]; then
  API_SVC=$( (cd "$DEPLOY_DIR" && docker compose ps --services 2>/dev/null) \
               | grep -Ex 'suite-api|api' | head -1 )
fi
if [ -z "$API_SVC" ]; then
  echo "  could not identify the suite api service. Services present:"
  (cd "$DEPLOY_DIR" && docker compose ps --services 2>&1) | sed 's/^/    /'
  echo "  => INCONCLUSIVE. Re-run with API_SVC=<name>."
else
  echo "  service: $API_SVC"
  HITS=$( (cd "$DEPLOY_DIR" && docker compose exec -T "$API_SVC" sh -lc \
             'grep -rl "day total repeated on" /app 2>/dev/null | head -5') 2>&1 )
  if printf '%s' "$HITS" | grep -q "day total repeated on\|/app"; then
    printf '%s\n' "$HITS" | sed 's/^/    /'
    echo "  => the FIXED parser IS in the running image."
  else
    printf '%s\n' "$HITS" | sed 's/^/    /'
    echo "  => no match: the running image does NOT carry the fix."
  fi
fi
echo
echo "--- image build time vs the fix merge (2026-08-21 21:19 UTC) ---"
(cd "$DEPLOY_DIR" && docker compose images 2>&1) | sed 's/^/  /'
echo

echo
echo "############################################################"
echo "# SECTION B — the database evidence"
echo "############################################################"
echo

psql_run() {
  (cd "$DEPLOY_DIR" && docker compose exec -T postgres sh -lc "psql -U \"\$POSTGRES_USER\" -d $DB")
}

psql_run <<'SQL'
\pset pager off
\pset null '(null)'
\x auto
SET TIME ZONE 'UTC';

-- ===========================================================================
-- Q1. THE AUDIT LOG OF EVERY EMAIL RECEIVED.  Single best piece of evidence.
--     NOTE: the timestamp column is "receivedAt", NOT createdAt
--     (packages/db/prisma/schema.prisma:2772).  Set at POST receipt, before
--     any parsing (lightspeed-inbound.service.ts:302).
--
-- HOW TO READ EACH POSSIBLE OUTCOME, for a row near 2026-08-22 18:10 UTC:
--   NO ROW AT ALL             -> the Saturday email never reached the API.
--                                Unrecoverable from the app (push-only feed).
--                                Rules out R4/R5/R6/R7 for that day; leaves
--                                R1 (+ transport loss) or R3 (late retry).
--   status='IGNORED'          -> arrived, no usable CSV survived the filename
--     + errorSummary            filter.  "Only top-10/digest fragments (N)"
--                                = DIGEST_FRAGMENT at :323 ate it (R4).
--                                "No CSV attachment found." = empty email.
--   status='RECEIVED' AND     -> arrived, the parse THREW, and the Message-ID
--     processedAt IS NULL        is now permanently poisoned by the dedupe at
--     (crashed_mid_parse=t)      :313-315.  This is R5.  It can NEVER retry.
--   status='RECEIVED' AND     -> processed fine.  Then read tip_days/tip_cents:
--     processedAt NOT NULL       tip_days='0' + tip_cents='0' with rows_parsed>0
--                                = R6, the day was silently dropped at :514.
--   TWO rows clustered near   -> a drained retry backlog: Saturday's email was
--     2026-08-23 18:20           delivered late and re-stamped 2026-08-23 by
--                                yesterdaySydneyKey() at :373.  This is R3.
--   ONE row on the 23rd with  -> one email carried both days: R2.
--     tip_cents='68187'
-- warnings names the exact skip reason whenever the code chose to skip a day.
-- ===========================================================================
\echo '=== Q1  inbound email audit log, 20-26 Aug 2026 (UTC) ==='
SELECT
  "receivedAt",
  "processedAt",
  status,
  ("processedAt" IS NULL)                     AS crashed_mid_parse,
  "errorSummary",
  left(coalesce(payload->>'subject',''), 100) AS subject,
  payload->>'attachmentsParsed'               AS csvs,
  payload->>'digestFragmentsSkipped'          AS digests_skipped,
  payload->>'rowsParsed'                      AS rows_parsed,
  payload->>'dayTotalsUpserted'               AS sales_days,
  payload->>'tipDaysUpserted'                 AS tip_days,
  payload->>'tipCents'                        AS tip_cents,
  payload->'warnings'                         AS warnings,
  "providerEventId"
FROM "IntegrationWebhookEvent"
WHERE provider     = 'LIGHTSPEED'
  AND "accountKey" = 'inbound-email'
  AND "receivedAt" >= TIMESTAMP '2026-08-20 00:00:00'
  AND "receivedAt" <  TIMESTAMP '2026-08-26 00:00:00'
ORDER BY "receivedAt";

-- ===========================================================================
-- Q2. THE TIP ROWS THEMSELVES.  "notes" is written by tipNote()
--     (lightspeed-inbound.service.ts:182-186) and records whether the figure
--     was SUMMED across N CSV rows or read once as a repeated day total.
--     This is the field that discriminates the competing hypotheses.
--
-- HOW TO READ "notes" ON THE 2026-08-23 ROW (amountCents = 68187):
--   "...(3 rows)."                      -> three values were SUMMED.  Since
--       AND cents_mod_3 = 0                this venue's report is KNOWN to
--       AND no 'repeated' string             repeat the day total on 3 rows
--       anywhere (see Q6)                    (fix-avalon-tips-aug-2026.sh), the
--                                            fixed parser would have collapsed
--                                            them to 22729.  It did not =>
--                                            THE PRE-FIX BUILD WAS STILL LIVE.
--                                            R1.  Real Sunday = $227.29.
--                                            Saturday's money is GONE.
--   "...(2 rows)."                      -> two DISTINCT day figures summed onto
--                                          one dateKey: Sat + Sun merged by the
--                                          fallbackDateKey collapse at :501.
--                                          R2.  Money is MISDATED, not lost.
--                                          Nobody was underpaid in total.
--   "...(6 rows)."                      -> 3 x Sat + 3 x Sun collapsed AND
--                                          tripled.  R2 with the repeat shape
--                                          intact; Sat+Sun = $227.29 combined
--                                          (implausibly small - treat with
--                                          suspicion, prefer R1).
--   "...(1 rows)."                      -> ONE figure straight off one report.
--                                          The parser summed nothing.  The
--                                          report itself said $681.87, or a
--                                          misdated Saturday email overwrote
--                                          Sunday (check overwritten_after_create).
--   "day total repeated on N rows,      -> the repeat guard FIRED: the fixed
--    counted once."                       build IS deployed and $681.87 is a
--                                          single genuine day total.  R1 dead.
--
-- overwritten_after_create = t  -> a SECOND email replaced this row via the
--   importKey upsert at :522-537 (update SETS amountCents, never increments).
--   That is R3, and the original value is unrecoverable.
-- NO ROW for 2026-08-22 with importKey 'lightspeed-email:Alma Avalon:2026-08-22'
--   -> that key was never created; the day was lost at or before parse time,
--      not overwritten afterwards.
-- ===========================================================================
\echo '=== Q2  StaffTipCardEntry, Alma Avalon, 15-27 Aug 2026 ==='
SELECT
  id,
  venue,
  "serviceDate",
  "serviceDate"::time                     AS service_time_utc,
  "amountCents",
  "amountCents"/100.0                     AS dollars,
  ("amountCents" % 3)                     AS cents_mod_3,
  round("amountCents"/3.0)/100            AS dollars_if_tripled,
  source,
  "importKey",
  notes,
  "createdAt",
  "updatedAt",
  ("updatedAt" > "createdAt")             AS overwritten_after_create
FROM "StaffTipCardEntry"
WHERE venue = 'Alma Avalon'
  AND "serviceDate" >= DATE '2026-08-15'
  AND "serviceDate" <  DATE '2026-08-28'
ORDER BY "serviceDate";

-- ===========================================================================
-- Q3. SALES FROM THE SAME EMAIL.  handleInboundEmail writes SalesActualEntry
--     (source 'lightspeed-email') at :464 and :618, from the SAME message that
--     writes the tips at :522.  This is the cleanest discriminator available.
--
-- HOW TO READ IT:
--   Sales row EXISTS for 2026-08-22, tips row does NOT
--       -> the email ARRIVED and was parsed; the TIPS parse or the tips DATE
--          failed.  Rules out "no email".  Points at R6 (silent :514 drop),
--          or at the date column being absent for the tip rows specifically.
--          IMPORTANT COROLLARY: the summary path requires a real
--          sale_closed_date/business_date header (isDaySummaryCsv, :136-141),
--          so a 22 Aug sales row PROVES the CSV carried a parseable date -
--          which KILLS R2's "dateless collapse" outright.
--   NEITHER sales nor tips for 2026-08-22
--       -> the email never arrived, or arrived and was IGNORED/crashed before
--          :464.  Cross-check status in Q1.
--   Sales row for 2026-08-22 whose "createdAt" is on 23 Aug ~18:20
--       -> Saturday's data rode in on the LATE email.  Then a tips row must
--          exist too unless the tip rows lost their date => R2/R3 confirmed
--          and the money is misdated rather than missing.
--   Sales for 2026-08-23 with salesCents wildly out of line with 19-21 Aug
--       -> the 23rd's email covered two days.
-- ===========================================================================
\echo '=== Q3  SalesActualEntry, Alma Avalon, 15-27 Aug 2026 ==='
SELECT
  "serviceDate"::date        AS day,
  to_char("serviceDate",'Dy') AS dow,
  source,
  "salesCents"/100.0         AS sales_dollars,
  "coversCount",
  "externalId",
  "createdAt",
  "updatedAt",
  left(coalesce(notes,''),70) AS notes
FROM "SalesActualEntry"
WHERE venue = 'Alma Avalon'
  AND "serviceDate" >= DATE '2026-08-15'
  AND "serviceDate" <  DATE '2026-08-28'
ORDER BY "serviceDate", source;

-- ===========================================================================
-- Q4. THE DAY MATRIX - Q2 and Q3 side by side on a full 13-day scaffold so an
--     absent day is a visible row rather than a gap.  Read the verdict column.
--       'NO EMAIL PROCESSED FOR THIS DAY'      -> transport loss / IGNORED /
--                                                 crash before :464.
--       'EMAIL ARRIVED - TIPS PARSE FAILED'    -> sales present, tips absent.
--                                                 The bug is in the tips path.
--       'tips only'                            -> no day-summary CSV that day.
--       'both present'                         -> normal.
--     Compare tips_written vs sales_written: identical timestamps mean one
--     email wrote both; a tips_written 10 min later than the cadence is the
--     late-delivery signature.
-- ===========================================================================
\echo '=== Q4  day-by-day tips vs sales presence matrix ==='
SELECT
  d::date                    AS day,
  to_char(d,'Dy')            AS dow,
  (SELECT count(*)              FROM "StaffTipCardEntry" t
     WHERE t.venue='Alma Avalon' AND t."serviceDate"=d)                AS tip_rows,
  (SELECT sum("amountCents")/100.0 FROM "StaffTipCardEntry" t
     WHERE t.venue='Alma Avalon' AND t."serviceDate"=d)                AS tips_dollars,
  (SELECT min("createdAt")      FROM "StaffTipCardEntry" t
     WHERE t.venue='Alma Avalon' AND t."serviceDate"=d)                AS tips_written,
  (SELECT count(*)              FROM "SalesActualEntry" s
     WHERE s.venue='Alma Avalon' AND s."serviceDate"=d)                AS sales_rows,
  (SELECT sum("salesCents")/100.0 FROM "SalesActualEntry" s
     WHERE s.venue='Alma Avalon' AND s."serviceDate"=d)                AS sales_dollars,
  (SELECT min("createdAt")      FROM "SalesActualEntry" s
     WHERE s.venue='Alma Avalon' AND s."serviceDate"=d)                AS sales_written,
  (SELECT count(*)              FROM "SalesItemActualEntry" i
     WHERE i.venue='Alma Avalon' AND i."serviceDate"=d)                AS item_rows,
  CASE
    WHEN (SELECT count(*) FROM "StaffTipCardEntry" t
            WHERE t.venue='Alma Avalon' AND t."serviceDate"=d) = 0
     AND (SELECT count(*) FROM "SalesActualEntry" s
            WHERE s.venue='Alma Avalon' AND s."serviceDate"=d) = 0
     AND (SELECT count(*) FROM "SalesItemActualEntry" i
            WHERE i.venue='Alma Avalon' AND i."serviceDate"=d) = 0
      THEN 'NO EMAIL PROCESSED FOR THIS DAY'
    WHEN (SELECT count(*) FROM "StaffTipCardEntry" t
            WHERE t.venue='Alma Avalon' AND t."serviceDate"=d) = 0
      THEN 'EMAIL ARRIVED - TIPS PARSE OR TIPS DATE FAILED'
    WHEN (SELECT count(*) FROM "SalesActualEntry" s
            WHERE s.venue='Alma Avalon' AND s."serviceDate"=d) = 0
      THEN 'tips only (no day-summary CSV)'
    ELSE 'both present'
  END                          AS verdict
FROM generate_series(DATE '2026-08-15', DATE '2026-08-27', INTERVAL '1 day') d
ORDER BY d;

-- ===========================================================================
-- Q5. IS THE WEEK ALREADY PAID?  This decides whether a correction can be
--     applied or must be handled as a back-payment.
--     Matched by RANGE OVERLAP, not equality: getTipsSummary looks runs up by
--     EXACT weekStart/weekEnd equality (staff.service.ts:6567-6572) on a
--     timestamp derived from the browser's timezone, so a run CAN exist that
--     the UI cannot see.  Overlap finds it anyway.
--
-- HOW TO READ IT:
--   NO ROW                        -> nothing approved.  Correct the tip rows and
--                                    the pool recomputes; no back-payment needed.
--   ROW with status='PAID' and    -> the week is LOCKED and staff were paid from
--     lines_marked_paid > 0          the WRONG pool.  Correcting StaffTipCardEntry
--                                    now does NOT change what was paid - the run
--                                    is a snapshot.  Handle as a back-payment
--                                    (or delete the run via deleteTipsRun,
--                                    staff.service.ts:6751-6764, and re-run) and
--                                    reconcile the per-person delta from
--                                    StaffTipPaymentRunLine.amountCents.
--   ROW with lines_marked_paid=0  -> approved but not disbursed: safe to remove
--                                    the run, fix the entries, re-approve.
--   pool_dollars vs the sum of Q2 -> tells you exactly how much money the payout
--                                    was based on versus what is stored now.
-- ===========================================================================
\echo '=== Q5  StaffTipPaymentRun overlapping 17-23 Aug 2026, Alma Avalon ==='
SELECT
  r.id,
  r.venue,
  r."weekStart",
  r."weekEnd",
  r.status,
  r."tipPoolCents"/100.0                                        AS pool_dollars,
  r."paidAt",
  r."paidById",
  r."createdAt",
  r."updatedAt",
  count(l.id)                                                   AS lines,
  count(l.id) FILTER (WHERE l."paidAt" IS NOT NULL)             AS lines_marked_paid,
  count(l.id) FILTER (WHERE l.excluded)                         AS lines_excluded,
  sum(l."amountCents")/100.0                                    AS lines_dollars,
  left(coalesce(r.notes,''),80)                                 AS notes
FROM "StaffTipPaymentRun" r
LEFT JOIN "StaffTipPaymentRunLine" l ON l."paymentRunId" = r.id
WHERE r.venue = 'Alma Avalon'
  AND r."weekStart" < TIMESTAMP '2026-08-25 00:00:00'
  AND r."weekEnd"   > TIMESTAMP '2026-08-16 00:00:00'
GROUP BY r.id
ORDER BY r."weekStart";

-- ===========================================================================
-- Q6. DEPLOYMENT FINGERPRINT.  The strings below exist ONLY in the
--     post-8723cf9 build (tipNote at :184, warning at :543-546).  The bare
--     "(N rows)." string is NOT a fingerprint - the pre-fix code emitted it
--     verbatim too (verified: git show 8723cf9 -- lightspeed-inbound.service.ts).
--
--   ANY ROW returned dated on/after 2026-08-22
--       -> the FIXED parser was deployed by then.  R1 is dead, and $681.87 was
--          NOT produced by the triple-count.  Go to R2/R3.
--   ZERO ROWS
--       -> the fixed build has never demonstrably run.  Combined with a 23 Aug
--          note of "(3 rows)." on a report known to repeat its total on 3 rows,
--          this is near-proof the container was still serving the old bundle.
--          Confirm on the box: docker inspect the suite-api image Created time,
--          and git -C /opt/alma/alma-suite log -1.
-- ===========================================================================
\echo '=== Q6  deployment fingerprint: does the fixed parser string exist anywhere ==='
SELECT 'tip notes'      AS where_found, "serviceDate"::date AS when_dated, venue AS scope, notes AS text
FROM "StaffTipCardEntry"
WHERE notes LIKE '%day total repeated on%'
UNION ALL
SELECT 'event warnings', e."receivedAt"::date, e."accountKey", w
FROM "IntegrationWebhookEvent" e,
     LATERAL jsonb_array_elements_text(coalesce(e.payload->'warnings','[]'::jsonb)) AS w
WHERE e.provider = 'LIGHTSPEED'
  AND w LIKE '%carried the same figure on all%'
ORDER BY 2;

-- ===========================================================================
-- Q7. OTHER WRITERS AND STRAY DATES.
--   Any source='alma-pos' or source='lightspeed' row for Alma Avalon
--       -> the apiRow guard at :516-520 could have silently suppressed the
--          email figure for that day (it is existence-only, amount-blind,
--          and pushes no warning).
--   Any row with serviceDate in year 2001
--       -> parseDateToken's new Date() fallback at :121-122 resolved a bare
--          "22 Aug" to V8's default year.  Invisible to every week query.
--   Any row whose service_time_utc is not 00:00:00
--       -> a writer bypassed the UTC-midnight convention; the week window
--          (gte start / lt end) can then drop it.
--   ZERO ROWS from both -> none of these paths fired; ignore them.
-- ===========================================================================
\echo '=== Q7a  every tip source ever written, by venue ==='
SELECT venue, source, count(*) AS rows,
       min("serviceDate")::date AS first_day, max("serviceDate")::date AS last_day
FROM "StaffTipCardEntry"
GROUP BY venue, source
ORDER BY venue, source;

\echo '=== Q7b  stray serviceDate values (year-2001 parse, or non-UTC-midnight) ==='
SELECT id, venue, "serviceDate", "serviceDate"::time AS service_time_utc,
       "amountCents"/100.0 AS dollars, source, "importKey", "createdAt"
FROM "StaffTipCardEntry"
WHERE "serviceDate" < DATE '2020-01-01'
   OR "serviceDate"::time <> TIME '00:00:00'
ORDER BY "serviceDate";
SQL
