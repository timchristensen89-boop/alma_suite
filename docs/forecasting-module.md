# Forecasting module — implementation note

Phase 0 audit and the architectural decisions that follow from it. Written
before the code so the reasoning is reviewable; kept updated as phases land.

## What is already here

| Concern | Finding |
| --- | --- |
| Framework | pnpm monorepo (`pnpm@10.32.1`), Express API (`apps/api`), Vite + React frontends (`apps/reports-web` etc.) |
| Database | PostgreSQL via Prisma (`packages/db/prisma/schema.prisma`), 109 migrations already applied |
| Auth | `apps/api/src/lib/auth-middleware.ts` — `requireManager` / `requireAdmin` / `requireSettingsAdmin`; `/api/forecast` and `/api/reports` are already gated and app-access controlled (`REPORTS`/`COMPLIANCE`) |
| Existing forecasting | `apps/api/src/services/forecast.service.ts` (outlook, cashflow, accuracy, backtest) writing `ForecastDaySnapshot`; UI at `apps/reports-web/src/pages/ForecastPage.tsx` |
| Square | `integration.service.ts` — OAuth, locations, item sales → `SalesActualEntry` / `SalesItemActualEntry`; webhooks verified |
| Xero | `integration.service.ts` — OAuth (granular scopes), contacts, ACCPAY bills, P&L report, bill PDF attachments |
| Scheduled jobs | VPS crontab hitting `/api/integration-jobs/*` with a scheduler secret (not Cloud Scheduler — see the VPS deploy runbook) |
| Tests | `node --test` with `tsx` (`apps/api` `test` script), pure-function unit tests |

## The finding that shapes everything

**There is no company or legal-entity model.** All 58 domain models are keyed by
`venue String` ("St Alma", "Alma Avalon"). The suite has never needed to know
that those venues sit in two different Pty Ltds.

This module's first requirement is that **Two Cooked Chooks Pty Ltd (Avalon)
and Alma Freshwater Pty Ltd (St Alma) are never combined** — separate cash,
creditors, liabilities and proposals. So the legal entity has to become a
first-class object.

### Decision: additive, entity-first schema — no retrofit

The forecasting tables are new and namespaced `fc_*` (Prisma models prefixed
`Fc`). Every one of them carries `companyId` as a **required** field; venue is
optional and secondary. They are NOT bolted onto the existing venue-keyed
models.

Rationale:

1. The brief says do not replace working functionality. Adding `companyId` to
   58 live models, and to every query that reads them, is exactly the kind of
   change that breaks the roster, stock and reports surfaces that work today.
2. Entity separation is a *forecasting and insolvency* requirement. Making it
   the spine of the new schema is stronger than retrofitting it as an optional
   column elsewhere, where a missing filter silently commingles two companies.
3. Venue → company is 1:1 here, so the legacy venue-keyed actuals can be read
   into the canonical layer through one mapping (`fc_venues.legacy_venue_name`)
   without ambiguity.

The practical safety property: **a query against a forecasting table cannot
accidentally span both companies**, because there is no row without a
`companyId`, and the service layer takes `companyId` as a required argument
rather than an optional filter.

### Money and rates

All money is integer **cents** (existing suite convention — `salesCents`,
`wageCents`). Rates and percentages are `Decimal` at the precision declared,
never floats, because these figures drive a creditor distribution.

### Group view

A group comparison is permitted and is explicitly labelled a comparison. It is
computed by placing two single-entity results side by side — never by summing
into a shared cash figure. Intercompany movement is modelled as a paired
outflow/inflow across two entities inside one scenario, never as new cash.

## Assumption provenance

Every number the model produces is tagged with how it was arrived at:

| Tag | Meaning |
| --- | --- |
| `ACTUAL` | A source transaction (Square, Xero, bank, lodged BAS) |
| `ACCOUNTING_ESTIMATE` | Derived from accounting data with a stated method (e.g. COGS from stock movement) |
| `MANAGEMENT_ASSUMPTION` | Entered by management (the seed assumptions below) |
| `MODEL_FORECAST` | Produced by a forecasting model, with an interval |
| `MANUAL_OVERRIDE` | A deliberate override, with author, reason and expiry |
| `PROPOSAL_TERM` | A creditor proposal term, not a prediction |

The UI must never show a figure without this tag. A forecast is not made
reliable by the code running.

## Seed assumptions — status: UNCONFIRMED

The figures in `packages/db/prisma/seeds/forecast-assumptions.ts` come from the
written brief. **The revised creditor workbook referenced as the seed and
verification source was not supplied**, so nothing has been reconciled against
it. They are versioned and editable, and are marked
`MANAGEMENT_ASSUMPTION` with `confirmed = false` until someone signs them off
against the workbook.

Items that specifically need management confirmation are listed at the end of
this document.

## Phase status

- [x] Phase 0 — repository audit
- [x] Phase 1 — data foundation: 42 `fc_*` tables, additive migration, seeds
- [x] Phase 2 — sync core (retry/rate-limit/pagination/reconciliation) and
      provider normalisers. **Not done:** the HTTP callers that actually pull
      Square and Xero into the `fc_*` tables — see Known limitations.
- [x] Phase 3 — 13 import templates, validation, error reports
- [x] Phase 4 — sales, margin and cash engines with walk-forward backtesting
      and champion/challenger promotion
- [x] Phase 5 — scenarios and the creditor distribution engine
- [x] Phase 6 — UI at Reports → Forecasting (10 sections)
- [x] Phase 7 — verification (163 tests, typechecks, builds, migration replay)

## Verification results

| Gate | Result |
| --- | --- |
| API unit tests | 163 passing, 0 failing |
| API typecheck | clean |
| reports-web typecheck | clean |
| Production builds | reports-web, web, staff-web, stock-web all build |
| Prisma schema | valid |
| Migration replay (clean DB) | all 110 migrations apply; 42 `fc_*` tables created |
| Pre-existing tables preserved | RecipeSalePrice, StockSupplierOrder, StockSupplierOrderItem intact |

## Known limitations — read before relying on this

1. **No live data has flowed through this module.** The engines, normalisers
   and validators are unit-tested against fixtures. The HTTP callers that pull
   Square payouts/orders/payments and Xero accounts/bank/invoices into the
   `fc_*` tables are NOT written — the resilient core they will sit on is, and
   is tested. Until that lands and runs, every screen shows seeded assumptions
   rather than actuals.
2. **The creditor workbook was never supplied.** Nothing is reconciled against
   it. All seeds are `confirmed = false` and the UI says so.
3. **Square account → company and Xero tenant → company are unmapped.** Both
   were asked for and not answered; `FcCompany.xeroTenantId` and
   `FcVenue.squareLocationId` are null. Mapping a payout to the wrong entity
   would misstate the wrong company's cash, so sync must not run until these
   are set.
4. **A forecast is not made reliable by the code running.** No model has been
   trained on real trading history here; accuracy figures appear only after
   forecast runs have actuals to compare against.
5. **Pre-existing schema drift is unresolved.** `prisma migrate diff` still
   wants to drop RecipeSalePrice, StockSupplierOrder and
   StockSupplierOrderItem. This module's migration is filtered to additive-only
   and proven safe, but the drift will bite the next person who generates a
   migration.
6. **Manual entry forms are API-complete but UI-light.** Import handles bulk
   entry; per-record manual forms beyond assumptions are not built.

## Sync design (Phase 2)

`apps/api/src/lib/forecast/` holds the provider-agnostic core, deliberately
separate from the existing `integration.service.ts` so the working Square and
Xero syncs are untouched:

- `http.ts` — retry with full-jitter backoff. 429/408/5xx retry, other 4xx do
  not (retrying a revoked token just burns rate limit). `Retry-After` wins over
  our own curve. Rate-limit headers surfaced for logging.
- `paginate.ts` — cursor walks (Square) and page walks (Xero). Both resumable:
  they report where they stopped. A repeated cursor ends the walk but is
  reported as TRUNCATED, never as a completed walk — claiming completeness we
  cannot verify would understate a cash position.
- `reconcile.ts` — Square payout ↔ Xero bank deposit matching, greedy
  best-first on amount then date. One bank line can satisfy only one payout,
  debits are never treated as a payout landing, and an unmatched payout is
  reported rather than guessed at. Cash arrival uses the ACTUAL arrival date
  where Square supplies one, otherwise the observed median settlement lag —
  never the sales date.

## Assumptions needing management confirmation

1. The creditor workbook was not attached; every seeded figure is unverified.
2. Freshwater's external creditor pool ($337,915) is an estimate pending
   admitted proofs of debt.
3. Net-GST reserve rates (Avalon 5.82%, Freshwater 6.10%) are fallback timing
   assumptions from a small number of BAS periods.
4. The $1 menu-price uplift assumes full realisation across chargeable items;
   the conservative scenario discounts realisation by 10%.
5. The administration fee ($25,000 per entity over 12 months) is assumed to be
   funded from operating cash, not from the proposal, unless stated otherwise.
6. NAB and Plenti repayments are allocated wholly to Avalon in the standalone
   model, per the brief.
