# Dead-table audit (2026-08-25)

Which of the schema's 213 models have **no code path that reads or writes
them**. This is documentation, not a migration: nothing here has been
dropped, and nothing should be dropped without the checklist at the bottom.
The risk of a wrong drop (production data gone) dwarfs the cost of a spare
table (nothing).

## Method

Static scan of every `.ts/.tsx/.js/.mjs` under `apps/`, `packages/` and
`scripts/` (598 files) for:

1. Prisma accessor calls — `prisma.<model>`, `tx.<model>`, `db.<model>`.
2. Relation-field usage — for models never accessed directly, every relation
   field on other models typed as that model, matched as `field:` (include /
   create-nested) or `.field` (property reads).

A model with zero hits on both is a candidate. Caveat on the second pass:
generic relation names (`rows`, `lines`, `entries`, `attachments`) collide
with unrelated code, so a match there downgrades confidence rather than
proving life.

## High confidence: no reference anywhere (18 models)

Sixteen are the unbuilt half of the forecasting module's data-import
pipeline — designed for raw Square/Xero/bookings feeds that were never wired
up (the live half of `Fc*` — companies, venues, assumptions, scenarios,
creditor proposals — is used heavily by `forecast-module.service.ts`):

`FcRawSourceRecord`, `FcAccountMapping`, `FcSupplierMapping`,
`FcCategoryMapping`, `FcSalesPayment`, `FcSalesRefund`, `FcXeroAccount`,
`FcXeroInvoice`, `FcXeroBill`, `FcXeroPayment`, `FcXeroBankTransaction`,
`FcPayrollPeriod`, `FcStocktake`, `FcInventoryMovement`,
`FcBookingsSnapshot`, `FcBusinessEvent`, `FcRecurringCommitment`

And one stray:

- `StaffStatusChange` — a debugging table (it has a `stack` column) for
  tracking unexplained staff-status flips. No code writes it; if anything
  still populates it, it would be a DB trigger — check before assuming empty.

## Lower confidence: only generic-name matches (13 models)

Never accessed via a Prisma accessor; the only textual matches are relation
field names common enough to be false positives (e.g. `attachments:` also
appears in the mailer, `.rows` on SQL results):

`CommsAttachment`, `CommsAlertEvent` (the comms service demonstrably never
includes either), `FcImportJob`, `FcImportRow`, `FcImportError`,
`FcSalesOrder`, `FcSalesOrderLine`, `FcSquarePayout`, `FcSquarePayoutEntry`,
`FcOverride`, `FcForecastRun`, `FcForecastPoint`, `FcAuditEvent`

Treat these the same as the high-confidence list operationally — verify
before touching.

## Everything else

The remaining ~182 models all have at least one live accessor call and are
out of scope here. (`CommsLink` looked dead on the first pass but is used via
`include: { links: true }` throughout the comms service — the exact trap this
audit's second pass exists to catch.)

## If a drop is ever actually wanted

Per table, in order, on the VPS:

1. Row count and latest write:
   `docker compose exec postgres psql -U "$POSTGRES_USER" alma_suite_v18 -c 'SELECT COUNT(*), MAX("createdAt") FROM "FcXeroInvoice";'`
   (skip `MAX` where the table has no timestamp column). Rows present means
   something once wrote it — understand what before going further.
2. Check for triggers: `\d "StaffStatusChange"` — a trigger writing it means
   it is not dead, whatever the code says.
3. Only then: remove the model from `schema.prisma` in its own PR, let
   `prisma migrate dev` generate the `DROP TABLE`, and take a fresh
   `backup-db.sh` run immediately before `migrate deploy`.
4. Never batch drops with feature work, and never drop the lower-confidence
   list without the count check per table.

The sensible default is to do nothing: these tables cost bytes, not risk.
