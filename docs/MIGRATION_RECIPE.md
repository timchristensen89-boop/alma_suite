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
