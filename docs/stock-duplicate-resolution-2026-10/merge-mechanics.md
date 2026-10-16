# Merge mechanics — `apps/stock-api/scripts/merge-duplicate-items-2026-10.ts`

Specification for the bulk duplicate-item merge and its rollback. Written against
`itemsService.mergeItems` (apps/stock-api/src/services/items.service.ts:1370–1619),
`scripts/merge-duplicate-wines.ts`, `packages/db/prisma/schema.prisma` and the
shared `stockItemMergeInputSchema` (packages/shared/src/index.ts). All numbers come
from the read-only clone `alma_stock_orig` and the precomputed `facts/*.json`.
Money is cents. Nothing here has been run against any database.

## 0. What the facts say the script will touch

| Fact | Value |
|---|---|
| Clusters in the audit | 232 (188 near-certain, 44 possible) |
| Distinct member items | 488 (492 memberships — 4 items sit in two clusters, see §5.2) |
| Members already ARCHIVED / with a sku / with a legacyId | 0 / 0 / 241 |
| Members missing category / countUnit / avgCostCents | 0 / 0 / 29 |
| Distinct countUnit values among members | 11 |
| `StocktakeLine` rows on members | 5,099 across 35 sheets (29 REVIEWED+applied 3,307; 2 SUBMITTED 1 Oct, not applied 588; 2 LOCKED, not applied 267; 2 IN_PROGRESS 937) |
| `InventoryMovement` rows on members | 3,878 (all STOCKTAKE_ADJUSTMENT); 3,204 of them carry a `sourceStocktakeLineId` on a member line |
| `RecipeLine` / `SupplierInvoiceLine` / `PurchaseOrderLine` | 994 / 596 / 224 |
| `StockReorderNotice` / `SquareMenuRecipeMapping` / `StockTransfer` | 451 / 11 / 1 |
| `StockWastageRecord` / `StockDeliveryCheckItem` | 0 / 0 |
| `stock_item_aliases` (collisions inside a cluster) | 88 (0) |
| `SupplierPriceListItem` | 0 |
| `VenueStockItem` rows on members | 1,463 = 488 phantom "Avalon" (all onHand NULL) + 975 real-venue rows; 641 real-venue rows have non-zero onHand; member holdings are valued at $77,221 |
| (stocktakeId,itemId) pairs that ALREADY have >1 line | 347 on member items (37 on IN_PROGRESS, 310 on REVIEWED sheets); 474 database-wide |
| Member lines on the phantom "Avalon" IN_PROGRESS sheet `cmti01rjj00qgoa01uhp30tw9` | 488, none counted |
| Member lines on the unassigned VOID sheet `cmq49xa2i0001s601z7kg0l2q` (venue NULL, IN_PROGRESS, $31,128 total) | 448 counted, $16,197 |
| Line `unit` is NULL on | 1 of 5,099 member lines |
| Clusters where two members feed the same recipe | 1 (cluster 164, White chocolate Callebaut → "Churros [St Alma]") |

The two 1 Oct SUBMITTED sheets (`cmup72ay90000pd01tfoyqda1` St Alma, updatedAt
2026-10-01 11:27; `cmupcujav03c0pd01796c5bpm` Alma Avalon, updatedAt 2026-10-02
20:50) are the "latest finalised sheet per venue" the canonical choice is anchored to.

## 1. What must be snapshotted before each cluster merge

Everything `mergeItems` mutates or deletes, captured as the full row (JSON of
every column, `SELECT to_jsonb(t)`), keyed by table and primary key, BEFORE the
first write of the cluster and inside the same transaction (§2). Per cluster:

1. **`StockItem`** — the full row of EVERY member (canonical and duplicates).
   The canonical row changes too: backfill of sku/category/countUnit/
   conversionFactor/countArea/measurePerCountUnit/measureUnit/latestCostCents/
   latestCostAt/avgCostCents/reorderPoint/parLevel, plus recomputed `onHand`
   and `updatedAt`. Duplicates get `status=ARCHIVED, onHand=0, notes+=merge note`
   and, if their sku was backfilled onto the parent, `sku=NULL`.
2. **`VenueStockItem`** — every row of every member, all three venues including
   the phantom "Avalon" row. Rows of duplicates are either deleted (parent already
   has the venue; onHand summed into the parent's row) or repointed
   (`stockItemId` → parent). The parent's rows change `onHand`, `active`,
   `updatedAt`. Also snapshot the pre-zeroing value of any holding marked
   `discard_stale` (§4) — it is the same row, snapshot it once before zeroing.
3. **`StocktakeLine`** — every line of every DUPLICATE: `id, legacyId, stocktakeId,
   itemId, recipeId, position, label, countedQty, unit, location, stockValueCents,
   notes, createdAt, updatedAt`. Plus, for each stocktake where a duplicate line
   will be FOLDED (parent already has a line on that sheet with a matching or
   NULL unit), the PARENT line it folds into with its pre-merge `countedQty,
   stockValueCents, notes` (snapshot the whole parent line; those three are the
   fields that change). Record per folded pair `{duplicateLineId, parentLineId,
   stocktakeId}` so rollback knows which rows to recreate and which to restore.
4. **Repointed references — ids only, with the old foreign key**, one backup row
   per affected row (`payload = {oldItemId}`) for each of:
   `RecipeLine.itemId`, `InventoryMovement.itemId`, `SupplierInvoiceLine.itemId`,
   `StockTransfer.stockItemId`, `StockWastageRecord.stockItemId`,
   `StockDeliveryCheckItem.stockItemId`, `StockReorderNotice.stockItemId`,
   `SquareMenuRecipeMapping.stockItemId`, `PurchaseOrderLine.stockItemId`,
   `StocktakeLine.itemId` (the non-folded, repointed lines — already covered by 3
   but mark them `kind: repoint`).
   `updateMany` does not return ids, so the script must `findMany({select:{id}})`
   the ids inside the transaction before the merge runs (cheap: ≤ 5k rows per
   cluster), and the `updatedAt` columns bumped by Prisma (`RecipeLine`,
   `SupplierInvoiceLine`, `StockReorderNotice`, `SquareMenuRecipeMapping`,
   `StocktakeLine`, `StockDeliveryCheckItem`) are not restored unless the rollback
   uses raw SQL (§3.9).
5. **`InventoryMovement.sourceStocktakeLineId` re-anchors** — every movement whose
   `sourceStocktakeLineId` equals a duplicate line that will be folded (the fold
   repoints them to the parent line, then deletes the duplicate line; without
   the repoint `onDelete: SetNull` would silently orphan them). Snapshot
   `{movementId, oldSourceStocktakeLineId, newSourceStocktakeLineId}`. 3,204
   movements on member lines are in scope overall; most sit on REVIEWED
   sheets whose lines are repointed, not folded.
6. **`stock_item_aliases`** — full rows of every alias on every duplicate, flagged
   `kind: repoint` or `kind: delete-collision` (collision = parent already has the
   same `(aliasKey, supplierId)`). 0 collisions today, still snapshot.
7. **`SupplierPriceListItem`** — same treatment (`kind: repoint` /
   `kind: delete-collision` on `(supplierId, stockItemId)`). 0 rows today.
8. **The canonical's backfill** — a derived row `{table:'_backfill', rowId:
   parentId, payload:{field: oldValue}}` for each field `mergeItems` fills, so the
   rollback can null them again without diffing (the full StockItem snapshot in 1
   also suffices; this is a convenience).

Every id in these tables is a Prisma `cuid()` stored as `text` (checked:
`pg_typeof(id) = text`, no sequences), so a deleted row can be re-inserted with
its original id verbatim. `legacyId` (unique on StockItem, StocktakeLine,
RecipeLine, Stocktake) is part of the snapshot and must be re-inserted too.

## 2. Backup storage

One table, created if missing, written inside the same transaction as the
cluster's merge (so a failed cluster leaves no half-backup and a committed
cluster always has its backup):

```sql
CREATE TABLE IF NOT EXISTS "_stock_merge_backup_20261016" (
  "id"           bigserial PRIMARY KEY,
  "runId"        text        NOT NULL,   -- e.g. 20261016T0312Z-<8 hex>, one per --apply invocation
  "clusterIndex" integer     NOT NULL,   -- facts/<index>.json
  "table"        text        NOT NULL,   -- Prisma table name, or '_cluster' / '_backfill' / '_fold' / '_zeroed'
  "rowId"        text        NOT NULL,   -- primary key of the row (or parentId / '<dupLineId>' for _fold)
  "payload"      jsonb       NOT NULL,   -- {"kind": ..., "row": {...full row...}} or {"kind": "repoint", "old": {...}, "new": {...}}
  "createdAt"    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "_stock_merge_backup_20261016_run_idx"
  ON "_stock_merge_backup_20261016" ("runId", "clusterIndex");
CREATE INDEX IF NOT EXISTS "_stock_merge_backup_20261016_row_idx"
  ON "_stock_merge_backup_20261016" ("table", "rowId");
```

`payload.kind` ∈ `snapshot` (full pre-image), `repoint` (fk change), `delete`
(row removed; full pre-image), `fold` (parent line pre-image + duplicate line
pre-image + movement re-anchors), `zeroed` (VenueStockItem onHand set to 0 before
the merge), `backfill`, `cluster` (the run marker: `{status:'merged', parentId,
duplicateIds, decisionsSha256, before:{...}, after:{...}, moved:{...}}`). The
`_cluster` marker row is what idempotency keys off (§5.1). This follows the
existing convention of `_wine_cost_backup_20260716`, `_ch_fix2_lines_backup_20260719`
etc., but as one table with a jsonb pre-image instead of one table per shape.

Create the table with `prisma.$executeRawUnsafe` BEFORE the per-cluster loop
(DDL inside the interactive transaction would hold a lock on the catalog across
the cluster). The script must never `DROP` it; it is kept until the user says the
merge is accepted.

## 3. Rollback procedure — per cluster, in reverse order of application

`merge-duplicate-items-2026-10.ts --rollback <runId> [--cluster <index>]`.
Processes the backup's clusters in DESCENDING `clusterIndex` (and descending
`id` within a cluster), one transaction per cluster, and refuses to roll back
cluster N while a later cluster of the same run is still merged, unless
`--cluster` names it explicitly (two clusters can share no member, §5.2, so
order only matters for the overlap refusal and for the ledger totals). Steps,
each in the same transaction:

1. **Guard**: the canonical must still exist and be ACTIVE; the duplicates must
   still exist with `status=ARCHIVED` and the merge note in `notes`; no new
   `StocktakeLine`/`InventoryMovement`/`RecipeLine`… referencing the canonical
   with `createdAt > merge commit time` may exist (rollback refuses with a list
   if any do — those rows were created after the merge and a human must decide
   where they belong). No referenced stocktake may be IN_PROGRESS with
   `updatedAt` in the last 15 minutes.
2. **Un-archive duplicates**: restore each duplicate's full `StockItem` row from
   the `snapshot` (status, onHand, notes, sku, updatedAt). Restore the canonical's
   full `StockItem` row too (this reverses the backfill, the onHand recompute and
   the notes). Use `UPDATE ... SET (col,...) = (jsonb_populate_record)` via raw SQL
   so `updatedAt` is restored rather than bumped.
3. **VenueStockItem**: for each duplicate row with `kind: delete` re-insert it
   verbatim (`INSERT ... SELECT * FROM jsonb_populate_record(null::"VenueStockItem", payload->'row')`);
   for each `kind: repoint` row set `stockItemId` back; then restore every parent
   row from its snapshot (onHand, active, parLevel, reorderPoint, updatedAt).
   `@@unique(venue, stockItemId)` holds because the parent row for that venue
   is restored, not re-created, and the duplicate's row goes back under its own
   item. Finally restore the `zeroed` holdings (they are the same rows; the
   snapshot already has the pre-zero onHand — apply snapshot last so it wins).
4. **Folded stocktake lines**: for each `fold` record (a) re-insert the deleted
   duplicate line verbatim with its original id, legacyId, position, countedQty,
   unit, stockValueCents, notes, createdAt, updatedAt; (b) restore the parent
   line's `countedQty, stockValueCents, notes` from its pre-image; (c) repoint
   every movement in the record back: `UPDATE "InventoryMovement" SET
   "sourceStocktakeLineId" = old WHERE id = movementId`. For a
   `keep_canonical_line_only` pair the script itself nulled/deleted the duplicate
   line before the merge (§4.2); that deletion is recorded as `kind: delete` on
   `StocktakeLine` and is restored the same way.
5. **Repointed references**: for every `repoint` row in `StocktakeLine`,
   `RecipeLine`, `InventoryMovement` (itemId), `SupplierInvoiceLine`,
   `StockTransfer`, `StockWastageRecord`, `StockDeliveryCheckItem`,
   `StockReorderNotice`, `SquareMenuRecipeMapping`, `PurchaseOrderLine`, set the
   fk back to `payload.old`. Do it by stored id, never by "everything on the
   parent" — the parent had its own history before the merge.
6. **Aliases and price lists**: `repoint` rows → set `stockItemId` back;
   `delete-collision` rows → re-insert verbatim. The unique constraints hold
   again because the colliding row on the parent was never moved.
7. **Backfill**: covered by step 2's full-row restore of the canonical. If a
   duplicate's sku was freed for the parent, step 2 restores it on the duplicate
   AFTER the parent's sku is restored to NULL — order: parent first, then duplicates
   (sku is `@unique`).
8. **Mark**: write a `_cluster` marker `{status:'rolled_back', rolledBackAt}` for
   the same runId/clusterIndex. The original backup rows are never deleted.
9. **updatedAt fidelity**: Prisma bumps `@updatedAt` on every `update`. The
   rollback uses `$executeRaw` for the restores so the stored `updatedAt`
   round-trips; if the script uses the Prisma client for simplicity, document
   that `updatedAt` on restored rows will read as the rollback time (affects the
   stocktake-page "last edited" display and the `VenueStockItem.updatedAt` index
   nothing else keys on).

Ids that can be re-inserted verbatim: all of them. `StockItem.id`,
`VenueStockItem.id`, `StocktakeLine.id`, `InventoryMovement.id`,
`stock_item_aliases.id`, `SupplierPriceListItem.id` are `cuid()` text keys with
no sequence; the only other uniqueness is `legacyId` (restored from the
snapshot), `sku` (ordering in step 7), `(venue, stockItemId)` on VenueStockItem
and `(aliasKey, supplierId)` / `(supplierId, stockItemId)` on aliases / price
lists, all of which are satisfied once the rows are back under their original
item.

## 4. Pre-merge on-hand treatment

### 4.1 `discard_stale` holdings

`mergeItems` sums `onHand` where the parent already stocks the venue. For a
twin that was NOT on the venue's latest finalised sheet, its `onHand` is the
leftover of an older count (the audit's ~$37.8k; $28.3k of it on members by the
facts' rough proxy, 197 holdings) and summing it would inflate the canonical's
holding by exactly that stale figure. So for every member holding the decisions
file marks `discard_stale`, the script — inside the cluster transaction, after
the snapshot, before the merge — runs
`UPDATE "VenueStockItem" SET "onHand" = 0 WHERE id = $1` and writes a `zeroed`
backup row `{venue, oldOnHand, valueCents: oldOnHand * avgCostCents}`. The merge
then adds 0. The canonical's holding is unchanged and the venue value drops by
exactly the sum of zeroed values (this is the "expected delta" in §6).

Holdings marked `keep` (the twin WAS counted on the latest sheet and the
canonical was not, or the decisions reviewer wants the sum) are left alone and
summed. Holdings marked `move_to_canonical` are the no-parent-row case and need
nothing: `mergeItems` repoints the row. Phantom "Avalon" rows: every member has
one with onHand NULL; the merge deletes the duplicate's and keeps the parent's,
adding 0. The script reports them in the dry run but takes no separate action
(it cannot — `mergeItems` handles all of `dup.venueStock`). This is the one way
the merge touches the phantom venue; it deletes a NULL row and is fully
snapshotted.

### 4.2 `sameSheetDoubleCount` → `keep_canonical_line_only`

Both members have a counted line on the same 1 Oct sheet (28 clusters by the
facts, 21 near-certain; the audit names 7 where both counts are non-trivial).
`mergeItems` would fold: `countedQty = (parent ?? 0) + (dup ?? 0)`, same for
`stockValueCents`, notes joined with " · ", movements re-anchored, duplicate line
deleted. That is a double count of the same bottles.

Confirmed from the code: if the script first sets the duplicate line's
`countedQty = NULL, stockValueCents = NULL` the fold computes
`(parent ?? 0) + (null ?? 0) = parent` — the parent's figures survive unchanged
— and still deletes the duplicate line and re-anchors its movements (none exist:
the SUBMITTED sheets are not applied). Two caveats make "null then let it fold"
the wrong mechanism:

- The fold only happens when the duplicate line's unit equals the parent line's
  (trim/lower) or either is NULL. If the two lines carry different unit strings
  ("bottle" vs "each") the duplicate line is REPOINTED instead, leaving two lines
  for one item on the sheet, one of them now blank. Apply then takes the "last
  counted line" per item (stocktakes.service.ts:1361) — the blank one is skipped
  because it is null, so apply is safe, but the sheet shows a phantom empty row
  and the variance report lists the item twice.
- If the parent line's `countedQty` is NULL (the canonical was listed but not
  counted) and the duplicate's is the real count, nulling the duplicate loses
  the count. That is the `keep_duplicate_line` decision, not this one; the
  script must support it by swapping which line is nulled.

So the script deletes the duplicate line itself: snapshot the full line
(`kind: delete`), `UPDATE "InventoryMovement" SET "sourceStocktakeLineId" =
<parentLineId> WHERE "sourceStocktakeLineId" = <dupLineId>` (recorded), then
`DELETE FROM "StocktakeLine" WHERE id = <dupLineId>`. Deterministic in both unit
cases, and the parent line is untouched (no " · " note concatenation). For the
`sum_both_lines` decision (two genuinely separate shelves counted on two lines)
do nothing and let the fold sum. For `keep_duplicate_line`, copy the duplicate
line's `countedQty/stockValueCents/notes/location` onto the parent line
(snapshot the parent line first) and then delete the duplicate line as above.

### 4.3 Sheets that must never be folded

The phantom Avalon sheet (488 member lines, none counted) and the VOID
unassigned sheet (448 counted member lines, $16,197) list every item, so on
both the parent and the duplicate have a line and `mergeItems` would fold —
summing the VOID sheet's counts and rewriting a sheet the user said to leave
alone. The refactor in §5.4 takes `foldExcludeStocktakeIds`; the script passes
those two ids so their lines are repointed only (history preserved, no
arithmetic). Dry-run lists them under "repointed, not folded".

## 5. Idempotency and safety checks

### 5.1 Refuse the cluster (and continue to the next, reporting) when

- any member is `status = ARCHIVED`, or its `notes` contain `Merged into "`, or a
  `_cluster` marker with `status:'merged'` exists for the same member set in any
  run (already merged);
- the canonical id is not ACTIVE, or is not in the cluster, or equals a duplicate;
- after simulated backfill the canonical would still lack `categoryId` or
  `countUnit` (today none do);
- members' `countUnit` differ (compare `countUnit ?? unit`, trim/lower), or
  `measurePerCountUnit`/`measureUnit` differ when both set (700 vs 750 mL twins
  are "possible", never auto-merged), or `conversionFactor` differs when both
  members have `conversionFactor != 1`;
- `avgCostCents` of a duplicate and the canonical differ by more than 2× (the
  wine script's `COST_DISAGREEMENT_LIMIT`) — refuse unless the decisions file
  carries `costReviewed: true` (Don Julio Blanco's 50010 is a case cost);
- a stocktake referenced by any member line is `IN_PROGRESS` or `REOPENED` with
  `updatedAt` within the last 30 minutes, or is `SUBMITTED` with `updatedAt`
  within the last 30 minutes (PR #321's autosave writes to SUBMITTED sheets);
  additionally lock the referenced `Stocktake` rows with
  `SELECT id FROM "Stocktake" WHERE id = ANY($1) FOR UPDATE` at the top of the
  transaction so a concurrent save waits rather than interleaves;
- the parent already has MORE THAN ONE line on a stocktake where a duplicate
  line will fold (37 such pairs on IN_PROGRESS, 310 on REVIEWED sheets among
  members). `mergeItems` folds into the FIRST line by position while apply
  honours the LAST counted line, so the folded count could land on a line apply
  ignores. Refuse unless the sheet is already applied (REVIEWED, `appliedAt`
  set — the ledger is already written and the fold only changes the displayed
  sheet) or the decisions file says `foldTarget: <lineId>`;
- a `discard_stale` holding's current `onHand` does not equal the value the
  decisions file recorded (someone counted since review) — refuse;
- the decisions file's `factsSha256` for the cluster does not match the
  `facts/<index>.json` on disk (stale review).

### 5.2 Whole-run refusals (before any cluster)

- an item id appears in two clusters of the decisions file (today:
  `cmsdf10iz003rmiio5evtegxv`, `cmoqfbld6003q9ky2v4i89e7q`,
  `cmptovvyb009xs6016axnnhxj`, `cmsdf12uj0020mij9cpu2un4t` each sit in two
  audit clusters — the reviewer must leave exactly one);
- `--apply` without `--run-id`, or a `_cluster` marker already exists for that
  runId (a re-run gets a new id);
- `DATABASE_URL` host is production and `--i-mean-production` is absent.

### 5.3 Dry-run output (`--dry-run` is the default; `--apply` is explicit)

Per cluster, JSON to `--out <file>` and a console block:

```
#17 Don Julio Blanco  → canonical cmptovvv70096s601mzhseahb "Don Julio Blanco"
  fold  cmoqfbo0n009s9ky23tatpkjn "DON JULIO BLANCO 750ML BOTTLE"   avgCost 50010 vs 8340  !! 6.0x apart — REFUSED unless costReviewed
  venue        before(onHand, $)             after(onHand, $)          action
  Alma Avalon  0.9 + 0.2 = 1.1   $91.74     0.9   $75.06              discard_stale 0.2 ($16.68)
  St Alma      0.7 + 0.05       $62.55     0.7   $58.38              discard_stale 0.05 ($4.17)
  Avalon       null + null                  null                      phantom row deleted (NULL)
  rows: StocktakeLine repoint 24, fold 2 (sheet cmup72ay9… keep_canonical_line_only), excluded-from-fold 2
        RecipeLine 2 · InventoryMovement 11 (re-anchored 0) · SupplierInvoiceLine 0 · PurchaseOrderLine 1
        StockReorderNotice 2 · SquareMenuRecipeMapping 0 · StockTransfer 0 · aliases 1 (collisions 0) · priceList 0
  backfill: latestCostCents ← 50010 (!), latestCostAt ← 2026-05-… 
  value delta this cluster: −$20.85
```

Totals at the end: clusters merged / refused (with reasons), items archived,
rows per table, venue value before/after/delta (real venues only), and the
backup row count that --apply will write. `--apply` prints the same block
after each committed cluster plus the `_cluster` marker id.

### 5.4 What in `mergeItems` is unsafe or awkward for bulk use (flagged)

1. **Own transaction, external reads.** It opens its own `prisma.$transaction`
   and loads `parent`/`dups` (with venueStock, aliases, priceListItems) BEFORE
   the transaction. The script cannot put the backup, the zeroing and the merge
   in one transaction by calling it (Prisma interactive transactions do not nest
   and the inner call would use a second connection — not atomic, and it would
   block on the rows the outer transaction holds). Required refactor: split the
   body into an exported `mergeItemsWithin(tx, {parentId, duplicateIds,
   actorName, foldExcludeStocktakeIds?})` that does its own reads on `tx`, and
   make `mergeItems` a thin wrapper (schema parse, actor check, `$transaction`,
   call). Behaviour of the API route is unchanged. Without this, the zeroing
   must be committed in an earlier transaction and the merge can no longer be
   rolled back atomically.
2. **Actor.** `actor` is optional; passing nothing skips the venue-scope check
   (fine for a script) but stamps every archive note "by system". The refactor's
   `actorName` lets the note read `merge-duplicate-items-2026-10 run <runId>`,
   which is what a future reader needs.
3. **No status / unit checks.** It merges ARCHIVED members, mismatched
   `countUnit`s and mismatched measures without complaint; §5.1 adds them.
4. **Fold target choice.** Folds into the first parent line by position; apply
   uses the last counted line (§5.1).
5. **Fold with NULL unit.** A NULL unit on either line counts as "same unit", so
   a unitless legacy line folds into anything (1 member line today).
6. **Fold sums value, not quantity×cost.** `stockValueCents` is summed, so a
   folded line's value no longer equals `countedQty × avgCost` when the two
   lines were valued at different costs. Reports read `stockValueCents`
   directly (stock-reports.service.ts:16), so the sheet total is preserved but
   per-line consistency is not. Acceptable for applied sheets; the
   `keep_canonical_line_only` path avoids it on the live ones.
7. **Venue stock union.** Deleting the duplicate's venue row discards that
   row's `parLevel`/`reorderPoint`/`unitOverride`; the parent's survive. Where
   the duplicate's par was the real one (the audit's Atlas Riesling 86 vs 6) the
   decisions file may carry `parLevelOverride` per venue and the script applies
   it after the merge (snapshotted as part of the parent row).
8. **Phantom "Avalon" rows** are summed/deleted like any venue (§4.1).
9. **`StockItem.onHand` roll-up** is recomputed from the parent's venue rows —
   including the stale ones unless zeroed first; the duplicate's own
   `StockItem.onHand` is set to 0 on archive, but its venue rows are what carry
   the stale figure, so archiving alone does not remove it from venue totals.
10. **sku uniqueness** is handled (frees the duplicate's sku before the parent
    takes it) and irrelevant today (0 skus on members); `legacyId` is NOT
    backfilled, so two legacy ids never collide.
11. **Alias/price-list collisions are deleted, not merged.** Fine, and
    snapshotted; 0 today.
12. **Transaction budget** `maxWait 15s / timeout 60s` is per call; the largest
    cluster has ~50 lines and ~40 movements, well inside it. Never wrap all 188
    clusters in one transaction — one per cluster, so a refusal mid-run leaves
    the committed clusters consistent and the rest untouched.
13. **One recipe, two members.** Cluster 164 (White chocolate Callebaut) feeds
    "Churros [St Alma]" from both members; after the merge the recipe has two
    lines for one item, costing the chocolate twice. Flag in the dry run and let
    the reviewer collapse the lines by hand.
14. **`moved.stocktakeLines`** conflates repointed and folded lines; the script
    counts them separately from its own pre-read.

## 6. Verification after `--apply`

Run as a set, record the output next to the run id. Baselines are taken by the
same script in dry-run (`--baseline <file>`) because some conditions already
fail on production.

```sql
-- 6.1 No two ACTIVE items share a wine-group / folded name (the cluster key).
--     Expected: zero rows that involve a canonical from this run; rows not in
--     the run are the "possible" clusters left for later and must match baseline.
SELECT k, array_agg(id) FROM (
  SELECT id, lower(regexp_replace(regexp_replace(name, '\(case of \d+\)', '', 'gi'), '[^a-z0-9]+', ' ', 'gi')) AS k
  FROM "StockItem" WHERE status = 'ACTIVE') t
GROUP BY k HAVING count(*) > 1;
-- (the script evaluates the real wineGroupKey()/foldText() from @alma/shared in TS; the SQL is the smoke check)

-- 6.2 No stocktake has two lines for one item, beyond the pre-existing pairs.
SELECT "stocktakeId", "itemId", count(*) FROM "StocktakeLine"
WHERE "itemId" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
-- Expected: the baseline's 474 pairs minus any the merge folded, and NO pair
-- whose itemId is a canonical of this run on a SUBMITTED/LOCKED/IN_PROGRESS sheet
-- other than the two fold-excluded sheets.

-- 6.3 Nothing still points at an archived duplicate.
SELECT 'StocktakeLine', count(*) FROM "StocktakeLine" l JOIN "StockItem" i ON i.id = l."itemId" WHERE i.status='ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%'
UNION ALL SELECT 'RecipeLine', count(*) FROM "RecipeLine" l JOIN "StockItem" i ON i.id = l."itemId" WHERE i.status='ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%'
UNION ALL SELECT 'InventoryMovement', count(*) FROM "InventoryMovement" l JOIN "StockItem" i ON i.id = l."itemId" WHERE i.status='ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%'
UNION ALL SELECT 'SupplierInvoiceLine', count(*) FROM "SupplierInvoiceLine" l JOIN "StockItem" i ON i.id = l."itemId" WHERE i.status='ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%'
UNION ALL SELECT 'VenueStockItem', count(*) FROM "VenueStockItem" l JOIN "StockItem" i ON i.id = l."stockItemId" WHERE i.status='ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%'
UNION ALL SELECT 'aliases', count(*) FROM stock_item_aliases l JOIN "StockItem" i ON i.id = l."stockItemId" WHERE i.status='ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%'
UNION ALL SELECT 'PurchaseOrderLine', count(*) FROM "PurchaseOrderLine" l JOIN "StockItem" i ON i.id = l."stockItemId" WHERE i.status='ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%'
UNION ALL SELECT 'StockReorderNotice', count(*) FROM "StockReorderNotice" l JOIN "StockItem" i ON i.id = l."stockItemId" WHERE i.status='ARCHIVED' AND i.notes LIKE '%merge-duplicate-items-2026-10%';
-- Expected: all zero. (Archived duplicates keep NO venue rows: the merge moves or deletes them all.)

-- 6.4 No orphaned ledger anchors created by the run.
SELECT count(*) FROM "InventoryMovement" WHERE "sourceStocktakeLineId" IS NULL AND "sourceStocktakeId" IS NOT NULL;
-- Expected: equal to baseline (the fold re-anchors before deleting; SetNull must never have fired).

-- 6.5 Venue value totals, real venues, ACTIVE items.
SELECT vs.venue, round(sum(coalesce(vs."onHand",0) * coalesce(si."avgCostCents",0))) AS cents
FROM "VenueStockItem" vs JOIN "StockItem" si ON si.id = vs."stockItemId"
WHERE si.status = 'ACTIVE' AND vs.venue IN ('Alma Avalon','St Alma') GROUP BY 1;
-- Expected: baseline − Σ zeroed(discard_stale value) + Σ (canonical holdings newly valued because
-- avgCostCents was backfilled from NULL: onHand × backfilled cost) ± 0 for everything else.
-- The script computes this expected figure from its own backup rows and asserts |actual − expected| < 100 cents.

-- 6.6 Sheet totals on the two 1 Oct SUBMITTED sheets.
SELECT "stocktakeId", count(*), sum("stockValueCents") FROM "StocktakeLine"
WHERE "stocktakeId" IN ('cmup72ay90000pd01tfoyqda1','cmupcujav03c0pd01796c5bpm') GROUP BY 1;
-- Expected: line count = baseline − deleted duplicate lines; value = baseline − Σ stockValueCents of the
-- keep_canonical_line_only lines removed (the double counts), unchanged for sum_both_lines.

-- 6.7 Backup completeness.
SELECT "clusterIndex", count(*) FILTER (WHERE "table"='_cluster') AS markers, count(*) AS rows
FROM "_stock_merge_backup_20261016" WHERE "runId" = $1 GROUP BY 1 ORDER BY 1;
-- Expected: one marker per merged cluster, rows ≥ members + venue rows + duplicate lines + repointed ids.

-- 6.8 Phantom venue and VOID sheet untouched except as declared.
SELECT count(*), count("onHand") FROM "VenueStockItem" WHERE venue = 'Avalon';            -- count drops by archived duplicates; count(onHand) stays 0
SELECT count(*), sum("stockValueCents") FROM "StocktakeLine" WHERE "stocktakeId" = 'cmq49xa2i0001s601z7kg0l2q'; -- unchanged (repoint only)
SELECT count(*) FROM "StocktakeLine" WHERE "stocktakeId" = 'cmti01rjj00qgoa01uhp30tw9';                         -- unchanged
```

Plus the service-level check the app already has:
`itemsService.dataQualityReport()` / `configHealth()` before and after — the
`missing_count_unit`, `missing_category`, `count-out-of-scale` counts must not
rise.

## 7. Decisions file the script reads (`scratchpad/decisions/*.json`, merged)

```jsonc
{
  "index": 17,                              // facts/<index>.json
  "factsSha256": "…",
  "action": "merge" | "keep_separate" | "needs_human",
  "canonicalId": "cmptovvv70096s601mzhseahb",
  "duplicateIds": ["cmoqfbo0n009s9ky23tatpkjn"],
  "why": "floor-named item on both 1 Oct sheets; invoice item carries 2 recipe lines",
  "holdings": [                             // one per (member, real venue) row with onHand != 0
    { "itemId": "cmoqfbo0n…", "venue": "Alma Avalon", "onHand": 0.2, "treatment": "discard_stale" | "keep" | "move_to_canonical" }
  ],
  "sameSheetDoubleCount": [
    { "stocktakeId": "cmup72ay9…", "canonicalLineId": "…", "duplicateLineId": "…",
      "treatment": "keep_canonical_line_only" | "keep_duplicate_line" | "sum_both_lines" }
  ],
  "costReviewed": true,                     // required when avgCost differs > 2×
  "foldTarget": { "<stocktakeId>": "<parentLineId>" },   // only when the parent has >1 line on a sheet
  "parLevelOverride": { "St Alma": 6 }      // optional
}
```

The script applies only `action: "merge"` entries, in ascending `index`, and
prints `keep_separate` / `needs_human` entries as skipped so the run log is a
complete account of the 232 clusters.
