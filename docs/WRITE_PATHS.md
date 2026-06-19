# Stock WRITE paths — plan (the harder half)

The read reroutes are done (see REPORTS_REROUTE_PLAN.md, MIGRATION_RECIPE.md).
What remains is the suite **writing** to stock tables. Two consumers:
`loaded-import.service` and `integration.service`. Writes are a different problem
and are deliberately **not** blind-rerouted. This documents why and how.

## Why writes are different
1. **Not shadow-diffable.** A read can be run twice (old + new) and the results
   compared with zero side effects. A write mutates state — you can't "run both
   and diff." Verification must be: on a *fresh* DB, run the operation via the
   new path, snapshot the resulting tables, and compare to a snapshot from the
   old path on an identically-seeded fresh DB.
2. **Transactional.** These operations write several tables atomically. Moving a
   write behind an HTTP call changes transaction boundaries — partial failures
   become possible where they weren't. The whole operation must move together.
3. **The suite must stop mutating stock tables entirely** — so each write
   operation becomes a stock-api endpoint the suite *calls*, not a local query.

**Verification harness for writes** (extends the embedded-pg approach):
`reset+seed → run OLD path → snapshot(stock tables) → reset+seed → run NEW path →
snapshot → deepEqual`. Build per operation before flipping.

---

## 1. loaded-import.service — duplicated but DIVERGED ⏸ (reconcile first)
The suite's `apps/api/src/services/loaded-import.service.ts` (290 lines) is an
**older copy** of `apps/stock-api/src/services/loaded-import.service.ts` (432
lines). Stock-api's version is richer: it adds outlier/suspect-value detection
(`suspectValueReason`, median ceilings) and stronger typed preview reports.
Stock-api already exposes all four endpoints: `/api/imports/loaded/{items,stocktakes}/{preview,commit}`.

The suite calls its local copy from `admin.ts` (`/admin/loaded-import/...`),
rendered by the suite admin UI.

**Blocking decisions (product, not mechanical):**
- Which version is canonical? (Almost certainly stock-api's — it's newer.)
- The suite admin UI renders the suite's preview shape. Stock-api's preview shape
  is richer/different — the UI must be updated to consume it, **or** the import
  UI should move to stock-web entirely (the stock-forward end-state).

**Recommended:** move the Loaded import UI into stock-web against stock-api, and
delete the suite's duplicate service + admin routes. That's a UI migration, not a
flag-gated reroute. If the UI must stay in the suite short-term, reroute
`admin.ts` to stock-api's endpoints AND update the UI to the new preview shape,
verified by: preview parity (read — easy) + commit state-snapshot (write).

_Removes 8 stock write/read accesses from the suite._

---

## 2. integration.service — Square + Xero sync ⏸ (large, dedicated effort)
`apps/api/src/services/integration.service.ts` — **14 stock writes + 24 stock
reads across 27 transactions**. The reads are interleaved with writes inside the
sync transactions, so they cannot be split out like the report reads were.

Stock-touching entry points:
- `syncSquareCatalog` — upserts `recipe`, `squareCatalogItem`, `squareMenuRecipeMapping`, `recipeVenuePrice`.
- `autoMatchSquareMenuMappings`, `updateSquareMenuMapping`, `ignoreSquareMenuMapping`, `clearSquareMenuMapping` — mapping writes.
- `importXeroSupplierContacts` — upserts `supplier`.
- `importXeroSupplierBills` — upserts `supplierInvoice` + `supplierInvoiceLine`, touches `stockItem`.

**Approach:** give stock-api the write endpoints these need (it should own all
stock mutations), then have integration.service call them:
- `POST /api/recipes/square-sync` (catalog → recipes/mappings/prices, one transaction)
- `POST /api/suppliers/xero-sync` (contacts → suppliers)
- `POST /api/invoices/xero-sync` (bills → invoices/lines)
- mapping CRUD endpoints for the menu-mapping operations

Each endpoint owns its transaction inside stock-api. integration.service keeps
the Square/Xero *fetching* (that's integration-domain) and hands the normalized
payload to stock-api to persist.

**This is the single largest remaining piece** and should be its own focused
effort, one entry point at a time, each verified by state-snapshot before flip.
Also unblocks reports #9 (`squareMenuRecipeMapping`), which is integration-owned.

---

## Suggested order
1. loaded-import: decide canonical + UI home → migrate (smaller, mostly done in stock-api already).
2. integration.service: add stock-api write endpoints one entry point at a time
   (start with the Xero supplier/bills upserts — simpler than the catalog sync),
   state-snapshot verify, flip.
3. Then `--strict` the boundary guard: with reads rerouted and writes moved,
   the runtime count should reach zero and the guard can fail CI on regressions.
