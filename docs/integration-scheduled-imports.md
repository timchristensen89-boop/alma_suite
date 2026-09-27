# Scheduled Square, Xero, and Deputy Imports

Alma can run regular guarded import jobs from Cloud Scheduler. These endpoints are not user-authenticated; they require the `INTEGRATION_SCHEDULER_SECRET` bearer token and should only be called by the scheduler.

## Environment

Required API env:

- `INTEGRATION_SCHEDULER_SECRET`
- Xero OAuth/env: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URL`, `INTEGRATION_TOKEN_ENCRYPTION_KEY`
- Square OAuth/env: `SQUARE_PRIMARY_*`, `SQUARE_SECONDARY_*`, `SQUARE_REDIRECT_URI`, `SQUARE_WEBHOOK_URL`, `SQUARE_ENVIRONMENT`, `SQUARE_API_VERSION`
- Deputy OAuth/env: `DEPUTY_CLIENT_ID`, `DEPUTY_CLIENT_SECRET`, `DEPUTY_REDIRECT_URL`, `DEPUTY_WEBHOOK_SECRET` (optional, for webhook subscription)

Do not place the real scheduler secret in source control or shell history.

## Endpoints

Production API base:

```text
https://alma-compliance-api-433873385316.australia-southeast1.run.app
```

Scheduled endpoints:

```text
POST /api/integration-jobs/xero/import
POST /api/integration-jobs/square/sync
POST /api/integration-jobs/deputy/sync
POST /api/integration-jobs/run
```

Each request must include:

```text
Authorization: Bearer <INTEGRATION_SCHEDULER_SECRET>
Content-Type: application/json
```

## Xero Job

The Xero scheduled job imports:

- supplier contacts marked as suppliers in Xero
- new authorised or paid supplier bills from the lookback window
- supplier invoice lines into Stock invoice records for later COGS/reporting review

It deliberately skips bills that look like duplicates, have no supplier match, or have no line items. Those remain for manual review/import. Payroll, payments and bank feeds are not imported by this job.

### Multi-tenant

A single Xero OAuth grant can cover multiple tenants/orgs (e.g. both Alma Avalon and St Alma). The scheduled job iterates every tenant captured on `connection.metadata.xeroTenants` and runs the contacts + bills import once per tenant.

To authorise multiple tenants in one connection: when prompted on the Xero consent screen, select every org the integration should be able to read. Reconnecting always refreshes the tenant list. Old connections (made before this rollout) keep their single-tenant behaviour until they're reconnected; the scheduler falls back to `providerAccountId` for those.

Per-tenant detail (contacts created, bills imported, warnings) is returned in the `tenants[]` array of the scheduled-import response. Admin → Integrations → Xero displays the tenant list when more than one is connected.

Admin shows the scheduler endpoint readiness and the latest `SCHEDULED` Xero run in:

```text
Admin → Integrations → Xero
```

Example body:

```json
{
  "lookbackDays": 14,
  "contactsLimit": 500,
  "billsLimit": 100
}
```

## Square Job

The Square scheduled job refreshes token health as needed, syncs locations for the primary and secondary Square accounts, imports completed payment totals into `SalesActualEntry` for Reports prime-cost sales, and imports completed order line item sales into `SalesItemActualEntry` for menu reporting and Stock par recommendations.

It groups completed payments by account, Square location and service date. Each account falls back to its configured Square label as the Alma venue, so keep `SQUARE_PRIMARY_LABEL` and `SQUARE_SECONDARY_LABEL` aligned with Alma venue names. It records order line items for reporting, but it does not import Square inventory counts or mutate Stock balances.

Square item sales are grouped by Square account, location, service date, and catalog item or item name. Alma keeps unmatched item rows for review instead of discarding them. Stock par recommendations only use rows that can be matched to Stock recipes by name, so recipe names should be kept aligned with Square menu item names before relying on recommended par increases.

Example body:

```json
{
  "account": "primary",
  "salesLookbackDays": 7,
  "salesLimit": 1000
}
```

Omit `account` to sync both accounts.

## Deputy Job

The Deputy scheduled job runs employee, document, and roster sync in that order — so document sync can match newly-imported employees, and the roster sync (which can also create placeholder profiles for unallocated shifts) runs last.

- Roster window: 7 days lookback + 14 days lookforward. Existing Deputy-tagged shifts in that window are deleted before recreation (idempotent).
- Employees: upsert by email / name+venue; locally-edited fields are preserved.
- Documents: classified as RSA, RSG, Food Safety, or routed to `staffDocumentReview` for manual review. SHA256-deduped so re-runs are safe.

No body is required; `POST /api/integration-jobs/deputy/sync` with the scheduler bearer is enough.

### Timesheets: the window, and re-reading an older week

The timesheet part of the sync reads 14 days back and 1 day forward. Each Deputy
timesheet upserts onto its own row (`deputyTimesheetId`), so a re-read converges
rather than duplicating. A body widens the window for a one-off re-read — for
example after a change to how a Deputy field is read, so the corrected reading
reaches rows the nightly window has already moved past:

```json
{"timesheetLookbackDays": 28}
```

Bounds are 1–120 days back and 0–31 forward (`timesheetLookforwardDays`). The
manager routes `POST /api/integrations/deputy/sync-timesheets` and `/sync-all`
accept the same keys (`lookbackDays` / `lookforwardDays` are aliases). On the
VPS, with the scheduler secret read from the API env file as the daily-sales
cron does:

```
curl -fsS -m 300 -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(grep -m1 ^INTEGRATION_SCHEDULER_SECRET= /opt/alma/deploy/env/suite-api.env | cut -d= -f2-)" \
  -d '{"timesheetLookbackDays":28}' https://api.almagroup.com.au/api/integration-jobs/deputy/sync
```

**Leave.** A Deputy timesheet imports as leave (`isLeave`, badged on the
Timesheets page) only when Deputy's `IsLeave` bit is set or `LeaveRule` is a
positive rule id; a `0` or blank rule id is "no rule", never leave. The row's
note records the raw Deputy fields (`Deputy IsLeave=… LeaveRule=… LeaveId=…`)
so the badge can be checked without another API call. To see one person's week
side by side with what Deputy holds today, run the read-only
`scripts/timesheet-leave-diagnose.sh` on the VPS (`STAFF=<name>
WEEK_ENDING=<Sunday>`); it prints each row, Deputy's own fields, whether the two
agree, and the exact re-sync command. A row Deputy itself marks as leave stays
leave after a re-sync — correct it in Deputy first.

## Cloud Scheduler Commands

Create these from a secure shell where the secret is already available in an environment variable. Do not paste the real value into shared notes.

```bash
API_URL="https://alma-compliance-api-433873385316.australia-southeast1.run.app"

gcloud scheduler jobs create http alma-xero-supplier-import \
  --project alma-compliance \
  --location australia-southeast1 \
  --schedule "10 5 * * *" \
  --time-zone "Australia/Sydney" \
  --uri "${API_URL}/api/integration-jobs/xero/import" \
  --http-method POST \
  --headers "Authorization=Bearer ${INTEGRATION_SCHEDULER_SECRET},Content-Type=application/json" \
  --message-body '{"lookbackDays":14,"contactsLimit":500,"billsLimit":100}'

gcloud scheduler jobs create http alma-square-location-sync \
  --project alma-compliance \
  --location australia-southeast1 \
  --schedule "25 5 * * *" \
  --time-zone "Australia/Sydney" \
  --uri "${API_URL}/api/integration-jobs/square/sync" \
  --http-method POST \
  --headers "Authorization=Bearer ${INTEGRATION_SCHEDULER_SECRET},Content-Type=application/json" \
  --message-body '{"salesLookbackDays":7,"salesLimit":1000}'
```

### Daily 9am — all integrations together

One job, hits `/jobs/run`, which orchestrates Square + Xero + Deputy in a single request. Use this *or* the per-provider jobs above, not both.

```bash
gcloud scheduler jobs create http alma-integrations-daily-9am \
  --project alma-compliance \
  --location australia-southeast1 \
  --schedule "0 9 * * *" \
  --time-zone "Australia/Sydney" \
  --uri "${API_URL}/api/integration-jobs/run" \
  --http-method POST \
  --headers "Authorization=Bearer ${INTEGRATION_SCHEDULER_SECRET},Content-Type=application/json" \
  --message-body '{"includeSquare":true,"includeXero":true,"includeDeputy":true}'
```

If you already have the early-morning Xero + Square jobs above, either delete those (`gcloud scheduler jobs delete alma-xero-supplier-import --location australia-southeast1`) or leave them — `runScheduledIntegrationImports` is idempotent and safe to call twice.

## Lightspeed emailed reports (Avalon card tips and item sales)

The Lightspeed (Kounta) API is a paid add-on, so Alma Avalon's data arrives the
free way: scheduled Insights reports emailed as CSV to the reports mailbox on
`mail.almagroup.com.au`. The VPS IMAP poller (`scripts/sevenrooms-imap-poll.py`,
same transport as SevenRooms) forwards each email to
`POST /webhooks/lightspeed/email?token=…`, and
`apps/api/src/services/lightspeed-inbound.service.ts` reads every CSV
attachment. Each email is recorded once on `IntegrationWebhookEvent`
(provider `LIGHTSPEED`, account `inbound-email`) with what it wrote, what it
refused and why.

**Where to look first.** Staff → Tips → *Emailed Lightspeed reports* lists the
last 14 days of emails with their outcome and notes. The same record prints on
the VPS with `scripts/tips-diagnose.sh`. A day with no card tips is one of:

- no email arrived (check the Lightspeed schedule and the mailbox rule);
- the email had no tips column (the report's tile lost it);
- the day was refused — undated rows that could be several days run together,
  or two tiles that disagree on the day's figure;
- the day was skipped because card tips were already recorded by hand or by
  the API sync (the emailed figure is never written on top of them).

**How the tips column is read** (`apps/api/src/lib/lightspeed-tips.ts`,
`tip-rows.ts`, all unit-tested):

- One tips/gratuity column per attachment; the most total-looking wins; rate,
  percentage and count columns are never money.
- The date column is found by pattern, so Looker's view prefix and timeframe
  suffix ("Sales Data Sale Closed Date", "Sale Closed Date Date", "Payments
  Payment Date", the sales feed's "SaleDate") all work, as do `dd/mm/yyyy`,
  `dd-mm-yyyy` and "20 Sep 2026". A date on one row carries forward over the
  blank-date value rows Looker writes beneath it.
- Rows are totalled per attachment, per venue, per day. Identical values
  repeated across a day are one day total (the revenue-centre shape that once
  paid a week at 3×); differing values are parts and add up. When the report
  has a sale id column (the sales-feed export), rows with different ids are
  always separate sales — two $10 tips are $20.
- Attachments are then merged: tiles that agree are one figure; tiles that
  disagree are refused with both figures named. Ranking tiles (top 10, highest,
  drop-off, discounts) are never read; "Untitled" / "Summary of …" tiles are
  read for tips but not for item sales.
- Today is never written (the day is not over), $0 days are skipped, and
  several undated rows on one guessed day are refused rather than summed.

**Setting the report up so it lands.** Schedule a daily report with the date
filter on *Yesterday*, include the business date column (e.g. *Sale Closed
Date*) and keep the tips column on one tile. If Lightspeed will only email the
reconciliation overview, the per-sale sales-feed export (SaleID, SaleDate, Tip)
can still be pasted into Staff → Tips → *Manual CSV import*; the paste keys each
sale by its id and a re-paste updates rather than duplicates.

## Daily sales → Xero (POS takings into the books)

`POST /api/integration-jobs/pos/daily-sales-to-xero` posts **yesterday's POS
takings** into each venue's own Xero organisation as an AUTHORISED daily
sales invoice (food / beverage / surcharge / discounts / refunds split, GST
exclusive, card tips as a no-GST line when a tips account is set). Idempotent
per venue+day — a repeat run answers "Already posted" instead of double-billing.

It only posts venues that have a Xero organisation selected in the **POS
Office → Venues & receipts** card (tenant dropdown + sales/tips account
codes; sales account defaults to 200). The same card has the manual handle:
per-day status, a dry-run **Preview**, and **Post now** for a missed or
corrected day.

The connection must hold the `accounting.invoices` scope — if Xero was
connected before that scope was requested, the push answers 409 with
"reconnect Xero" and the fix is Admin → disconnect → reconnect once.

On the VPS the simplest schedule is a file in `/etc/cron.d` (no Cloud
Scheduler needed). The secret is read from the env file at run time with
`grep` rather than sourcing it — docker env files allow unquoted spaces,
which break `sh` sourcing. 07:00 Sydney is 21:00 UTC (AEST) — the venue is
long closed and the day is final:

```
0 21 * * * root curl -fsS -m 60 -X POST -H "Authorization: Bearer $(grep -m1 ^INTEGRATION_SCHEDULER_SECRET= /opt/alma/deploy/env/suite-api.env | cut -d= -f2-)" https://api.almagroup.com.au/api/integration-jobs/pos/daily-sales-to-xero >> /var/log/alma-xero-daily-sales.log 2>&1
```

Re-posting a specific day (e.g. after a refund was corrected): body
`{"serviceDate":"2026-08-20"}`, or use Preview/Post in the Office card.

## Manual Smoke Test

Use a short-lived local variable and do not print it:

```bash
API_URL="https://alma-compliance-api-433873385316.australia-southeast1.run.app"

curl -sS -X POST "${API_URL}/api/integration-jobs/run" \
  -H "Authorization: Bearer ${INTEGRATION_SCHEDULER_SECRET}" \
  -H "Content-Type: application/json" \
  --data '{"includeSquare":true,"includeXero":true,"lookbackDays":7}' \
  | jq .
```

Expected proof:

- `IntegrationSyncRun.syncType` is `SCHEDULED`
- Square reports location sync and sales row import results
- Xero imports only new matched supplier bills and safe supplier contacts
