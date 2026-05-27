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
