# reports.service.ts — stock-read reroute plan

The 13 direct stock reads in `reports.service.ts`, each scoped for a flag-gated,
shadow-diffable reroute. Unlike the manager-dashboard read (a clean full-table
`ACTIVE` fetch), most of these are **counts, cross-venue aggregations, or
variance/Square joins** — so each needs either a matching stock-api endpoint or a
small new one, and must be shadow-diffed (reports are numeric → easy to compare).

**Do not blind-wire these.** Wire one, run flag-on against a venue, diff the
report numbers vs flag-off, then flip. Repeat. `stock-client` now exposes the
read endpoints these need (additive; no consumer wired yet).

Legend — Risk: 🟢 clean fetch · 🟡 shape/aggregation to verify · 🔴 needs new stock-api endpoint or is Square-coupled.

| # | Line | Reads | Used for | Target endpoint | Risk |
|---|---|---|---|---|---|
| 1 | 179 | `venueStockItem` (venue,stockItemId,onHand) | onHand-by-venue map for COGS/valuation | none yet — needs `GET /items/on-hand?venue=&itemIds=` | 🔴 |
| 2 | 452 | `stockItem.count` ACTIVE | catalogue size (snapshot) | `itemsSummary()` (`/items/summary`) if it returns active count | 🟡 |
| 3 | 455 | `venueStockItem` + stockItem par/reorder | low/out-of-stock counts | `lowStock()` (`/items/low-stock`) — verify it also yields out-of-stock | 🟡 |
| 4 | 463 | `stocktake.count` SUBMITTED/appliedAt null | "ready for review" count | `stocktakeReview()` length, or add count to `/stocktake/summary` | 🟡 |
| 5 | 466 | `stocktake.findMany` +lines +item | recently-submitted review cards | `stocktakeReview()` — match `toStocktakeReviewPayload` shape | 🟡 |
| 6 | 481 | `stocktakeLine.findMany` (cross-stocktake, take 100) | highest-variance rows | needs `GET /stocktake/variance?since=` (cross-take) | 🔴 |
| 7 | 969 | `supplierInvoiceLine.findMany` (date range, +invoice.venue) | COGS for prime-cost/wage% | `/recipes/cost-of-goods` aggregates differently — needs raw-line endpoint or report rework | 🔴 |
| 8 | 979 | `stockWastageRecord.findMany` (date range, venue) | wastage in prime-cost | `listWastage()` (`/operations/wastage`) — verify cost fields + date filter | 🟡 |
| 9 | 1263 | `squareMenuRecipeMapping.findMany` | menu→recipe mapping for sales-mix | Square-integration data; not a plain stock read — keep or move with integration | 🔴 |
| 10 | 1515 | `recipe.findMany` (id,estimatedCost,yieldQuantity,portionSize) | per-portion cost | `listRecipes()` returns a heavier payload; may need a lean `/recipes/costs` endpoint | 🟡 |
| 11 | 1868 | `stocktake.findMany` distinct venues | venue list for status | derive from `stocktakeSummary()` | 🟡 |
| 12 | 1874 | `stocktake.findFirst` LOCKED +lines | latest locked value per venue | `stocktakeSummary()` if it includes locked value, else add | 🟡 |
| 13 | 1882 | `stocktake.findFirst` latest any | latest stocktake status per venue | `stocktakeSummary()` | 🟡 |

## Suggested order
1. **🟡 single-fetch, low blast radius first:** #8 wastage, #10 recipe costs, #2 catalogue count.
2. **🟡 stocktake-status cluster (#11–13)** together via one `stocktakeSummary()` shape.
3. **🟡 review cluster (#3,#4,#5)** via `lowStock()` + `stocktakeReview()`.
4. **🔴 last / needs new endpoints:** #1 on-hand map, #6 cross-take variance, #7 COGS raw lines, #9 Square mapping.

## Progress
- ✅ **#2 catalogue count** — wired (`stockReads.activeItemCount()` → `/items/summary.activeItems`), flag-gated default-off. **Live parity PASS** (3 == 3).
- ✅ **#10 recipe costs** — wired (`stockReads.recipeCosts()` → `/recipes.recipes`), flag-gated default-off. **Live parity PASS** (rows identical).
- ✅ **#8 wastage — DONE.** Added a dedicated stock-api endpoint `GET /operations/wastage-report?from=&to=&venue=` (date-ranged, all reasons, uncapped) since `listWastage` excluded staff reasons + capped at 100. Wired via `stockReads.wastageInRange()`, flag-gated default-off. **Live parity PASS** (2 in-range rows, 800c, STAFF_MEAL kept + May excluded).
- ✅ **#11–13 stocktake status — DONE.** Ported the per-venue status computation into stock-api (`stocktakesService.venueStatus` + `GET /stocktake/venue-status`); the report's `stocktakeStatus` delegates when flag on. **Live parity PASS** (report output == ported output: 2 venues, Main locked=3000c/good, Annex=partial).
- ✅ **#1/#3/#4/#5/#6 buildStockSummary — DONE (one port).** The whole stock-summary computation (venue on-hand lookup, low/out-of-stock, ready-for-review count, recently-submitted review cards, highest variance) ported into stock-api (`stockReportsService.buildStockSummary` + `GET /stocktake/stock-summary`); `reports.service.buildStockSummary` delegates when flag on. **Live parity PASS** — the report's full `ReportsStockSummary` deep-equals the ported output (low=2, out=1, variance=2, review=2).
- ✅ **#7 raw-line COGS — DONE.** Added `GET /invoices/cogs-lines` (item-linked lines, date-ranged) + `stockReads.cogsLinesInRange` (re-nested to the consumer's `{invoice:{venue},lineAmountCents}` shape); wired the prime-cost read flag-gated. **Live parity PASS** (2 in-range lines, 4000c; no-item + out-of-range excluded).
- ⏸ **#9 Square menu-recipe mapping — PARKED (wrong domain).** `squareMenuRecipeMapping` is Square-integration data, not a stock read — it's written/owned by `integration.service` (Square sync), and the report uses it for sales-mix. Rerouting it through stock-api would draw the boundary in the wrong place. It should move with the **integration domain** (or get a dedicated mapping endpoint when that domain is tackled), not as part of the stock seal.

**Tally: 12 of 13 rerouted + verified** (dashboard + #1–#8, #10, #11–13), **#9 parked** (integration-domain, by design). Stock-read sealing of reports.service is effectively complete; what remains is integration-domain (#9) and the write-paths (integration.service Square sync, loaded-import) which need stock-api write endpoints, not read reroutes.

Both verified via `apps/api/scripts/verify-dashboard-stock-parity.ts` on embedded Postgres. Prisma branches retained (guard still lists these lines by design until flags flip).

## Per-site procedure (same as MIGRATION_RECIPE)
For each row: confirm the endpoint returns the consumed fields → add/normalize in
`stock-reads.ts` → wire the call site behind `useStockApiReads` (keep the Prisma
branch) → typecheck → shadow-diff the report numbers on one venue → flip.

> stock-client read methods added for this work: `lowStock`, `itemsSummary`,
> `listStocktakes`, `stocktakeSummary`, `stocktakeReview`, `listSupplierInvoices`,
> `listWastage`, `listRecipes`, `costOfGoods`.
