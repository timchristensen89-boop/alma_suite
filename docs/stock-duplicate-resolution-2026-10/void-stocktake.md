# The venue-less "$31k" stocktake — what it is and what to do

Record: `Stocktake` `cmq49xa2i0001s601z7kg0l2q`, currently named
**"VOID — stray count (likely 2025) — 08/06/2026"**, venue NULL, status IN_PROGRESS.
Source: read-only clone `alma_stock_orig` (nothing written); code read from
`alma-stock-simplify` (current `main` and the commit live on 7–8 June 2026,
`e1cf0bc`). All money is cents unless shown as `$`.

## Verdict in one paragraph

It is **not a count at all, and not from 2025**. It is the "New stocktake" screen's
default draft as it worked in June 2026: every ACTIVE item (778 at the time) on one
sheet, each line **pre-filled with the item's current on-hand**, venue left blank,
template "Full count", name `Stocktake 08/06/2026` (= `toLocaleDateString()`),
location = category name. It was created at 07:08 Sydney on 8 June 2026 and
reviewed/applied **48 seconds later**, unedited. The apply wrote 778
`STOCKTAKE_ADJUSTMENT` movements with **quantityDelta = 0 on every one of them**
(before == after for all 778), which is the proof: the sheet asserted nothing the
ledger did not already hold. It is a snapshot of `StockItem.onHand` (the cross-venue
sum) as of that instant — a ledger that was itself a mixture of the 2025 historical
sheets and the May/June 2026 Loaded imports, which is why it half-matches several
sheets and fully matches none. Its $31,128.63 "value" is 80 % mis-valuation
(see §3). Nothing in it exists only in it. Recommendation (§5): **delete it with a
snapshot**, together with its 778 zero-delta movements, before the duplicate merges
run. No status exists to park it.

## 1. The record

### 1.1 Header row (every column)

| column | value |
|---|---|
| id | cmq49xa2i0001s601z7kg0l2q |
| legacyId | NULL |
| name | VOID — stray count (likely 2025) — 08/06/2026 (originally `Stocktake 08/06/2026`, per the movement notes) |
| venue | **NULL** |
| template | Full count |
| countedAt | 2026-06-07 21:07:00 UTC = **Mon 8 Jun 2026 07:07 AEST** |
| status | IN_PROGRESS |
| notes | NULL |
| createdAt | 2026-06-07 21:08:04.791 |
| updatedAt | 2026-07-18 10:52:49.151 (the rename to "VOID …") |
| appliedAt | **NULL** — although 778 apply movements exist (see §1.3) |
| submittedAt / submittedByUserId | NULL / cmod6lvp600009kjyy6wc9yk0 (Tim Christensen, StaffProfile) |
| reviewedAt / reviewedByUserId | 2026-06-07 21:08:52.788 / Tim Christensen |
| lockedAt / lockedByUserId | NULL / NULL |
| reopenedAt / reopenedByUserId / reopenReason | 2026-07-16 12:34:07.526 / NULL / "Unlocked on request" |
| importSource | NULL |
| scope / scopeEvidence | UNKNOWN / NULL |
| countedAtText / countedAtSource | NULL / NULL |

The row is in a state **no code path produces**: `reopenStocktakeWithReason` sets
status REOPENED and never clears `appliedAt`; `reopenStocktake` refuses applied
counts and clears `reviewedAt`. Here status is IN_PROGRESS, `appliedAt` is NULL,
`reviewedAt` is still set and `submittedAt` is NULL. It was hand-edited in SQL on
16–18 July (the same session that reopened it and renamed it). Consequence: the
service's two guards against re-applying an applied count (`appliedAt` check and
"applied stocktakes must be reversed") no longer see it as applied.

### 1.2 Lines

| fact | value |
|---|---|
| lines | 778 (777 with a quantity: **603 > 0, 174 = 0**, 1 NULL) |
| distinct items | 696 — 78 items sit on 2+ lines (160 lines), because later item merges repointed invoice-style and floor-style lines onto one item (labels still show the original names, e.g. "Strangelove Yuzu Soda" 19 Each + "STRANGELOVE YUZU SODA - (CASE OF 24)" 34 units → same item) |
| items archived | 0 (all 696 ACTIVE) |
| recipe lines | 0 |
| value | 3,112,863 c = **$31,128.63** — carried by only 77 lines; 526 of the 603 positive lines have no value (NULL) or 0 |
| unit vs item countUnit | 574 of 603 positive lines carry a unit that is not the item's count unit ("750 mL", "Kilo", "units", "ml"…) |
| createdAt | **all 778 at 2026-07-16 12:56:49.578** — one bulk insert, no legacyId |
| updatedAt | 757 untouched since 16 Jul; 21 edited by the Aug cleanup passes: 1 on 3 Aug, 17 on 4 Aug (16 wines re-expressed in "ml", Wedge Cerveza Keg set back to NULL with a note), 2 on 8 Aug (Corona), 1 on 14 Aug (Broccolini) |

Item-id waves: 434 lines on May invoice-style items (`cmoqfb…`), 232 + 108 on the
31 May floor items (`cmptov…`/`cmptow…`), 4 others — i.e. every ACTIVE item on 8 June.

### 1.3 Timeline (UTC; Sydney = +10)

| when | what | evidence |
|---|---|---|
| 2026-06-07 21:07–21:08:04 | Created from the stock-web "New stocktake" screen: `emptyDraft()` → name `Stocktake 08/06/2026`, venue `''`, template `Full count`, one line per ACTIVE item with `countedQty = item.venueStock?.onHand ?? item.onHand`, `location = category.name`, `stockValueCents = unitCost × onHand` | `StocktakePage.tsx` at `e1cf0bc` lines 171–195; the movement notes read `Applied stocktake: Stocktake 08/06/2026 · Location: <category> · Reviewed by: Tim Christensen` |
| 21:08:52.788 | Reviewed + applied (one click; the apply path stamps `reviewedAt`) | `reviewedAt`; 778 movements 21:08:52.802 → 21:09:00.404 |
| 21:08:52–21:09:00 | **778 × STOCKTAKE_ADJUSTMENT, all `quantityDelta = 0`** (174 of them 0 → 0). With venue NULL, `balanceTargetForItem` takes the item path, so `quantityBefore = StockItem.onHand` — and it equalled every line | `InventoryMovement` where `sourceStocktakeId = …` |
| 2026-07-16 12:34:07 | "Unlocked on request" (reopen with reason) | `reopenedAt`, `reopenReason` |
| 2026-07-16 12:56:49 | All 778 lines deleted and re-inserted in one statement (new ids `cmrnij…`, no legacyId). FK `InventoryMovement.sourceStocktakeLineId … ON DELETE SET NULL` is why **all 778 movements now have a NULL line link** | line `createdAt`; movement `sourceStocktakeLineId` |
| 2026-07-16 → 07-18 10:52 | status → IN_PROGRESS, `appliedAt` → NULL by hand; renamed "VOID — stray count (likely 2025)" | header state (§1.1) |
| 3–14 Aug 2026 | 21 lines touched by the unit/cost clean-up passes | line `updatedAt`, Wedge keg note |

## 2. Does it match any other sheet?

Exact matches by (item, quantity) of its 603 positive lines against every other
stocktake. "overlap" = items both sheets counted.

| candidate | venue | counted on | exact | overlap | their counted lines |
|---|---|---|---|---|---|
| **Loaded import · St Alma · 2026-03-31** | St Alma | 2026-03-31 | **214** | 217 | 225 |
| Loaded import · Alma Avalon · 2026-06-30 | Alma Avalon | 2026-06-30 | 103 | 250 | 373 |
| Loaded import · Alma Avalon · 2026-06-02 | Alma Avalon | 2026-06-02 | 103 | 211 | 226 |
| Historical Bar Stocktake • 12.25 | St Alma | 2025-12-31 | 88 | 205 | 290 |
| Historical Kitchen Stocktake • 10.25 | Alma Avalon | 2025-10-31 | 61 | 69 | 104 |
| Historical Bar Stocktake • 12.25 | Alma Avalon | 2025-12-31 | 19 | 127 | 211 |
| Loaded import · St Alma · 2026-06-02 (bar) | St Alma | 2026-06-02 | 18 | 154 | 311 |
| Loaded import · St Alma · 2026-06-30 | St Alma | 2026-06-30 | 17 | 184 | 527 |
| Loaded import · St Alma · 2026-04-30 | St Alma | 2026-04-30 | 9 | 96 | 132 |
| Loaded import · Alma Avalon · 2026-05-31 | Alma Avalon | 2026-05-31 | 4 | 93 | 137 |
| Loaded import · St Alma · 2026-06-02 (food) | St Alma | 2026-06-02 | 2 | 44 | 204 |
| Historical Kitchen Stocktake • 12.25 | Alma Avalon | 2025-12-31 | 1 | 1 | 2 |
| (every other sheet) | | | ≤ 38 | | |

No candidate reproduces it; the best single sheet (St Alma 31 Mar) explains 214
lines. The sheet-of-record hypothesis fails because the sheet is not a count. The
**ledger-snapshot hypothesis** fits: for each item take the latest applied count per
venue as at 8 June 07:08 and sum the venues — 171 of 598 items match that sum
exactly, **95 of them genuine two-venue sums** (a number no venue sheet can carry).
The remaining differences are items whose on-hand on 8 June came from other
movements (deliveries, invoice receipts, the May CSV load setting `onHand` on item
creation) rather than from an applied count — all of which is consistent with
"prefilled from `StockItem.onHand`" and inconsistent with any physical count.
Why St Alma 31 March scores so high: the 2 June St Alma imports left 297 of 515
lines unlinked at apply time, so the March figures were still the ledger for most
`cmptov…` St Alma items on 8 June.

## 3. Was it ever applied, and does anything read it?

- **Applied: yes, as a no-op.** 778 `STOCKTAKE_ADJUSTMENT` rows, Σ|delta| = 0.
  No `STOCKTAKE_REVERSAL` rows exist (none needed). The header's `appliedAt` was
  later nulled by hand (§1.1).
- **COGS / stock valuation: ignored, twice over.** `packages/db/src/cogs.ts`
  `prismaCogsReader` only reads counts with status in
  `FINALISED_COUNT_STATUSES = SUBMITTED | REVIEWED | LOCKED` (IN_PROGRESS is out),
  and a NULL venue is read as the label `''`, which `resolveVenueLabel` returns as
  `status: 'blank'` → `partitionCountLabels` puts it in `offVenue`, "listed as
  unattributed and not part of any venue's or the group's stock" (`cogs-core.ts`
  §partitionCountLabels and the venueNote at line ~515). `stockValueAtCents(venue, at)`
  therefore never includes it, even if it were finalised. The scope-remediation doc
  already lists it as "never a candidate".
- **Dashboard:** `itemsService` counts `status: 'IN_PROGRESS', appliedAt: null`
  (items.service.ts ~946) — this record is one of the "in-progress stocktakes" shown
  to venue-unscoped users. The Stocktakes list shows it. The stock-reports
  dashboard reads SUBMITTED only (not this).
- **Item usage history** (`usageHistory`, items.service.ts ~845): reads
  `StocktakeLine` by `countedAt` window with no status filter; with no venue filter
  and `weeks ≥ 19` its 7 June lines would appear as a data point. Default is 12
  weeks, so today it is out of window.
- **ShiftTaskAssignment:** 0 rows reference it.
- **Live hazard:** because status is IN_PROGRESS and `appliedAt` NULL, Submit →
  Apply is permitted (a venue-scoped manager may review a venue-NULL sheet:
  `stocktake.venue !== null` passes). Apply with venue NULL writes
  `StockItem.onHand` directly (item path of `balanceTargetForItem`), so the
  8-June global quantities would overwrite the catalogue-level on-hand of 696 items
  without touching the venue rows — the exact desync the venue-sum code exists to
  prevent. Submit would also turn the one NULL line into 0.

## 4. What its lines reference, and what deleting it would lose

Items: 696, all ACTIVE; 434 May invoice-style, 340 floor-style, 4 other.

**Clusters (audit §4):** 308 positive lines (284 items, **177 near-certain
clusters**) worth $4,197.82, and 62 positive lines (59 items, **34 possible**
clusters) worth $11,999.61 — the latter dominated by one line (below). 449 of the
778 lines (356 near-certain) point at a cluster member. If `mergeItems` ran while
this sheet exists, its same-sheet twin lines would be summed into the parent line
(the 78 already-doubled items show what that looks like). Harmless for an unapplied
sheet, but it inflates the sheet's "value" and muddies the audit trail — delete
first, merge second.

**Representation elsewhere (603 positive lines, $31,128.63):**

| test | lines | value |
|---|---|---|
| item has a counted line on some other stocktake | **603 / 603** | — (0 items are counted only here) |
| same item **and** same quantity on another sheet | 405 | $13,038.84 |
| … or equals the 8-June ledger sum of per-venue applied counts | 480 | $16,492.29 |
| not exactly reproducible anywhere | 123 | $14,636.34 |
| … of which recounted at a real venue since 8 June | 57 | $3,921.68 |
| … not reproducible **and** not recounted since | 66 | $10,714.66 |
| item not recounted at a real venue since 8 June (any reason) | 98 | $10,735.22 |
| … item's cluster twin **has** been counted since | 95 | $311.38 |
| … genuinely last seen here | **3** | **$10,423.84** |

The three: "Triple SEC 20L - 20% ABV" 15.31 l **$10,410.80**, the same item again
17.1 ml $11.63, and "TSEC 20L (NoSugar)" 2.075 ml $1.41. The big one is a
valuation artefact, not stock: the line prices 15.31 units at $680 each (68,000
c/unit) where the item's avgCost is 3,000 c per L; the ledger sum of applied counts
on 8 June was 2.0775, not 15.31; and the line's own unit is "l" against a "bottle"
item unit. It belongs to the "$38k stale values" investigation (cluster "Triple sec
20 L bulk", tier possible), not to this sheet.

Mis-valuation generally: 11 lines ≥ $1,000 hold $24,991.73 (80 %) of the $31,128.63 —
Triple Sec ($10,410.80), Ramos Pinto Duas Quintas 15 units at a $150.96 case price
($2,264.40), eight Strangelove lines pricing bottles at the $57.68–$62.41 **case**
price ($10,451.51 for 178 bottles that cost about $440 at the items' own
240–260 c avgCost), Beef short ribs 54.34 kg
($1,454.68), Lime juice 15.75 L at $70/L ($1,102.50). The "$31k stocktake" is in
reality a sub-$10k ledger snapshot with stale per-case costs.

**Historical information lost by deletion: none.** Every quantity on it derives
from counts and movements that still exist (0 items only counted here); the sheet
asserts the ledger's own state; its apply changed nothing (Σ|delta| = 0). What
disappears is one row in the Stocktakes list, the dashboard's "1 in progress", and
(if the movements are removed too) 778 zero-delta "Applied stocktake" entries in
696 items' movement histories.

## 5. Options and recommendation

`StocktakeStatus` enum (schema, verified in the clone): **IN_PROGRESS, SUBMITTED,
REVIEWED, LOCKED, REOPENED**. There is no VOID / ARCHIVED / CANCELLED value, so
"archive by status" is not available without a schema migration. `StocktakeScope`:
FOOD, BEVERAGE, COMBINED, UNKNOWN.

| option | effect | verdict |
|---|---|---|
| A. Keep as-is, rename/annotate ("SNAPSHOT — system on-hand prefill 08/06/2026, not a count") | Stays in the list and dashboard count; the Submit→Apply foot-gun (§3) stays live; merges will fold its twin lines; its $31k keeps surfacing in audits | not recommended |
| B. Park by status | No suitable status; REOPENED/SUBMITTED would make it *more* visible (review queue) or eligible for COGS off-venue listing; LOCKED would make reports "prefer" it | not available |
| **C. Delete with a snapshot** (stocktake + lines + its 778 zero-delta movements, all copied to backup tables first) | Removes a non-count that is 80 % mis-valued, closes the re-apply hazard, keeps the merge PR clean; fully reversible from the backup tables | **recommended** |
| C′. Delete stocktake + lines, keep the movements | Same, but 778 orphan zero-delta rows remain with `sourceStocktakeId` NULL (FK SET NULL) and notes saying "Applied stocktake: Stocktake 08/06/2026" | acceptable if the ledger must stay append-only |

Sequencing: run C **before** the duplicate-merge migration. If a VOID status is
wanted for future cases, that is a schema change for a separate PR; it would not
help here because nothing of value needs preserving in place.

### 5.1 SQL — snapshot, delete, verify (run as one transaction, after approval)

```sql
BEGIN;

-- 1. Snapshot (schema-identical copies; CREATE TABLE AS keeps column order)
CREATE TABLE "_void_stocktake_backup_20261016"
  AS SELECT * FROM "Stocktake" WHERE id = 'cmq49xa2i0001s601z7kg0l2q';
CREATE TABLE "_void_stocktake_lines_backup_20261016"
  AS SELECT * FROM "StocktakeLine" WHERE "stocktakeId" = 'cmq49xa2i0001s601z7kg0l2q';
CREATE TABLE "_void_stocktake_movements_backup_20261016"
  AS SELECT * FROM "InventoryMovement" WHERE "sourceStocktakeId" = 'cmq49xa2i0001s601z7kg0l2q';

-- 2. Guards: exactly what §1 describes, and nothing else, is about to go
DO $$
DECLARE s int; l int; m int; nz int; rv int;
BEGIN
  SELECT count(*) INTO s FROM "_void_stocktake_backup_20261016";
  SELECT count(*) INTO l FROM "_void_stocktake_lines_backup_20261016";
  SELECT count(*), count(*) FILTER (WHERE "quantityDelta" <> 0) INTO m, nz
    FROM "_void_stocktake_movements_backup_20261016";
  SELECT count(*) INTO rv FROM "InventoryMovement"
    WHERE "sourceStocktakeId" = 'cmq49xa2i0001s601z7kg0l2q' AND "movementType" <> 'STOCKTAKE_ADJUSTMENT';
  IF s <> 1 OR l <> 778 OR m <> 778 OR nz <> 0 OR rv <> 0 THEN
    RAISE EXCEPTION 'void-stocktake snapshot mismatch: stocktake=% lines=% movements=% nonzero=% other=%', s, l, m, nz, rv;
  END IF;
END $$;

-- 3. Delete. Option C: movements too (they are all zero-delta no-ops).
DELETE FROM "InventoryMovement" WHERE "sourceStocktakeId" = 'cmq49xa2i0001s601z7kg0l2q';   -- omit this line for C′
DELETE FROM "Stocktake" WHERE id = 'cmq49xa2i0001s601z7kg0l2q';                               -- lines go by ON DELETE CASCADE

-- 4. Verify
SELECT (SELECT count(*) FROM "Stocktake"     WHERE id = 'cmq49xa2i0001s601z7kg0l2q')            AS stocktake_left,   -- 0
       (SELECT count(*) FROM "StocktakeLine" WHERE "stocktakeId" = 'cmq49xa2i0001s601z7kg0l2q') AS lines_left,       -- 0
       (SELECT count(*) FROM "InventoryMovement" WHERE "sourceStocktakeId" = 'cmq49xa2i0001s601z7kg0l2q') AS movements_left, -- 0
       (SELECT count(*) FROM "Stocktake" WHERE venue IS NULL)                                   AS venue_null_left;  -- 0

COMMIT;
```

### 5.2 SQL — rollback (restores the exact rows, ids included)

```sql
BEGIN;
INSERT INTO "Stocktake"         SELECT * FROM "_void_stocktake_backup_20261016";
INSERT INTO "StocktakeLine"     SELECT * FROM "_void_stocktake_lines_backup_20261016";
INSERT INTO "InventoryMovement" SELECT * FROM "_void_stocktake_movements_backup_20261016";  -- only if deleted in 5.1
SELECT (SELECT count(*) FROM "StocktakeLine" WHERE "stocktakeId" = 'cmq49xa2i0001s601z7kg0l2q') AS lines,      -- 778
       (SELECT count(*) FROM "InventoryMovement" WHERE "sourceStocktakeId" = 'cmq49xa2i0001s601z7kg0l2q') AS movements; -- 778
COMMIT;
```

Rollback must run before any later migration deletes or renames the items the
lines point at (`StocktakeLine.itemId` FK). If the duplicate merges have archived
items in between, the rows still insert (archive is a status, not a delete).
Drop the three backup tables only after the merge PR is closed out.

### 5.3 What changes in reports after C

- Actual COGS, stock valuation, variance brackets, monthly recap: **no change**
  (never a candidate — §3).
- Stock dashboard "in-progress stocktakes" for owner/admin: 1 → 0 from this record
  (the phantom-venue "Stocktake 9/1/2026" `cmti01rjj…`, 830 empty lines on venue
  "Avalon", is a separate record and still counts; it is outside this note and is
  not touched).
- Stocktakes list: one row fewer; no sheet at either venue is affected.
- Item usage history (`weeks ≥ 19`, no venue filter): loses a 7 June data point for
  696 items that was a copy of the ledger, not a count.
- Item movement history (Option C only): 778 zero-delta "Applied stocktake" rows
  disappear from 696 items; balances unchanged (Σ delta = 0).
- The duplicate-cluster facts: 370 positive lines (308 near-certain, 62 possible)
  stop appearing as "stocktake lines" on cluster members; last-count evidence is
  unaffected because the facts already take it from finalised venue sheets.
