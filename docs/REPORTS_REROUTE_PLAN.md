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
- ⏸ **#8 wastage — PARKED (endpoint mismatch).** `/operations/wastage` (`listWastage`) excludes staff-usage reasons, caps at 100, and has no date range; the report wants a date-ranged, unfiltered, uncapped set. Needs a dedicated reporting endpoint (`GET /operations/wastage?from=&to=&all=1`) before it can be rerouted. Not forced.
- Remaining 🟡/🔴 (#1,3,4,5,6,7,9,11,12,13) per table below — next.

Both verified via `apps/api/scripts/verify-dashboard-stock-parity.ts` on embedded Postgres. Prisma branches retained (guard still lists these lines by design until flags flip).

## Per-site procedure (same as MIGRATION_RECIPE)
For each row: confirm the endpoint returns the consumed fields → add/normalize in
`stock-reads.ts` → wire the call site behind `useStockApiReads` (keep the Prisma
branch) → typecheck → shadow-diff the report numbers on one venue → flip.

> stock-client read methods added for this work: `lowStock`, `itemsSummary`,
> `listStocktakes`, `stocktakeSummary`, `stocktakeReview`, `listSupplierInvoices`,
> `listWastage`, `listRecipes`, `costOfGoods`.
