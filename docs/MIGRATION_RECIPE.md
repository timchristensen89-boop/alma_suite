# Phase 1 migration recipe — routing a suite read through stock-api

How to move one direct `prisma.<stockModel>` read in the suite onto the Stock
API, safely and reversibly. Use this per call site from the boundary-guard
worklist (`pnpm check:boundaries`).

## The pattern (shadow-safe, default-off)
Every reroute is flag-gated by `USE_STOCK_API_READS` (see
`apps/api/src/clients/stock-reads.ts`). With the flag **off** (default), the
existing Prisma query runs unchanged — zero behaviour change on deploy. With it
**on**, the read goes through stock-api.

```ts
import { useStockApiReads, stockReads } from '../clients/stock-reads.js';

const items = useStockApiReads
  ? await stockReads.activeItems({ authToken: req.user?.token })
  : await prisma.stockItem.findMany({
      where: { status: 'ACTIVE' },
      include: { category: { select: { name: true } } },
      orderBy: [{ name: 'asc' }],
    });
```

## Procedure
1. **Pick the call site** from `pnpm check:boundaries` (start with reads, not writes).
2. **Capture the expected shape.** What fields/relations does the consumer use
   from the Prisma result? (e.g. `name`, `category.name`, `status`.)
3. **Match it in the adapter.** Make the corresponding `stockReads.*` helper
   return that shape, normalizing the stock-api response if needed. This is the
   real work and MUST be checked against a running stock-api.
4. **Wire the call site** using the flag pattern above.
5. **Verify off:** `pnpm --filter @alma/api typecheck`; app behaves exactly as before.
6. **Verify on (shadow):** with `USE_STOCK_API_READS=1` and stock-api running,
   diff the new result against the old Prisma result on one venue for a week.
7. **Flip** once diffs are clean; later delete the Prisma branch.

## ✅ First reroute wired — manager dashboard low-stock (staff.service.ts)

`getManagerDashboard`'s ACTIVE-items read is now flag-gated. **Default-off = the
original Prisma query, unchanged.** To verify the new path against your stack:

```bash
# 1. Run stock-api (serves the items the suite will now read)
pnpm dev:stock-api                      # http://localhost:3019

# 2. Get a stock-api bearer token (log into Stock in the browser and copy the
#    session/handoff token, or mint one). Then run the suite API with:
USE_STOCK_API_READS=1 \
STOCK_API_URL=http://localhost:3019 \
STOCK_API_TOKEN=<valid-stock-api-token> \
pnpm dev:api

# 3. Open the Manager Dashboard. The "low stock" widget + lowStockItems count
#    now come from stock-api. Compare against a run WITHOUT the flag — the list
#    and count should be identical.
```

What to check: same items, same order, same low-stock count. `onHand` matches
because both paths use the global `StockItem.onHand` field (stock-api's
`totalOnHand` is deliberately ignored). If they match on one venue for a few
days, this read is safe to flip on permanently and the Prisma branch can go.

> Service-to-service auth (so the suite can call stock-api without a manual
> token) is still PARKED — see WORKLOG #1. `STOCK_API_TOKEN` is the interim
> shadow-testing hook.

## Current worklist (runtime reads, from the guard)
| Call site | Models | Notes |
|---|---|---|
| `apps/api/src/services/reports.service.ts` (13) | venueStockItem, stockItem, stocktake(+Line), supplierInvoiceLine, stockWastageRecord, recipe, squareMenuRecipeMapping | **Best first target — all reads.** Map each to `stockReads.*` / new helpers. |
| `apps/api/src/services/staff.service.ts:3937` | stockItem | Single read inside a `Promise.all` (manager dashboard). Smallest reroute, but verify the dashboard widget's expected item shape. |
| `apps/api/src/services/loaded-import.service.ts` (8) | stockItem, stockCategory, stocktake(+Line) | **Writes** — must go through stock-api routes, not this read adapter. |
| `apps/api/src/services/integration.service.ts` (47) | recipe, supplier, square*, supplierInvoice(+Line) | **Writes (Square sync). Do last.** Needs stock-api write endpoints. |

## Reverse seam (stock-api → workforce)
`apps/stock-api/src/services/recipes.service.ts` and `stock-operations.service.ts`
read `salesActualEntry` / `salesItemActualEntry` (workforce). Mirror this recipe
in reverse once `staff-api` exposes a sales-actuals read endpoint (blocked on
staff-api Phase 3 routes — see WORKLOG PARKED #1).
