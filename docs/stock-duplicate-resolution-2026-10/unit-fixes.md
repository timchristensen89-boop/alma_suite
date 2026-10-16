# Quantities typed in the wrong unit: fix for approval (October 2026)

**Status: dry run only. Nothing has been changed in production.** Every number here comes from a restore of the 16 Oct 2026 11:41 AEDT production dump.

## The fault

`applyStocktake` writes each line's `countedQty` straight into the venue's on-hand, in the item's count unit, and never converts the line's unit. A line of "19400 mL" on an item counted in bottles became **19 400 bottles**. The line's own value was correct, because valuation converts, so nothing on the sheet looked wrong. Only the holding it produced was wrong.

It has already happened on two applied counts. Two unapplied counts are waiting to repeat it:

| Where | What | Value as it stands | Corrected |
|---|---|---:|---:|
| Alma Avalon holdings, from "Bar & FOH 9/1/2026" | Manly Gin 19 400, Triple Sec 9 350, Triple Sec No Sugar 16 500, Vodka 7 500, Massenez Pêche 4 800, all mL stored as bottles | $2,955,022 | $2,738 |
| St Alma holdings, from "Bar & FOH 31/08/2026" | Manly Triple Sec 3 400, Triple Sec No Sugar 3 000 (mL as bottles); Lime Juice 8 (L as bottles) | $186,170 | $309 |
| Alma Avalon holding, from the May Loaded import | Table salt, 5.77 kg stored as 5.77 × 14 kg cartons | $80.78 | $5.77 |
| **St Alma "Bar & FOH 01/10/2026"** (submitted, not applied) | 4 Manly lines in mL + 1 lemon juice line in L | applying would book **$1,928,027** | $2,579 |
| **Alma Avalon "Stocktake 10/1/2026"** (submitted, not applied) | 48 lines in g/kg/mL/L/box/bottle on items counted by the pack, bag, bunch, bottle or kg | applying would book **$163,551** | $3,256 |

Venue stock value on the production copy: **Alma Avalon $3,004,624 → $52,266** and **St Alma $265,027 → $79,167** after the fix. After both 1 Oct sheets are then applied, the figures are $45,501 and $81,963. The largest holding left is 11 bottles of Rockford Basket Press 2018 at $2,310.

## What the fix does (`apps/stock-api/scripts/fix-unit-entries-2026-10.ts`)

It reads `unit-fixes.json`, a reviewed list with the evidence for every entry:

1. **23 item measures.** These record what one count unit actually holds, wherever the item had a placeholder. Most are floor-wave kitchen items costed per kilo (for example "Cost taken from the Loaded count: 10.55 Kilo = $420.11") but measured as 100 g. That is why the automatic conversion would have read 970 g of pistachio as 9.7 bags. Recipe lines in g/mL against these items re-cost correctly afterwards; the dry run names the 4 affected recipe lines.
2. **53 lines on the two unapplied sheets.** Each is restated in the item's count unit. The original number and unit are kept in the line's note, along with the reason. Two lines whose number cannot be trusted are cleared for a recount rather than guessed: bay leaves "170 g" on a bunch item, and parrot fish "9.2 g" on a kg item. The CAPI soda line keeps its 10 and only changes its label from "bottle" to "each".
3. **9 holdings.** Each is corrected with a `STOCKTAKE_CORRECTION` movement against the line that wrote the bad number, which is the same record the app's own correction flow leaves. The original count lines and movements are not edited.

Guards:

- It is a **dry run** unless `--apply` is passed, and it needs `--i-mean-production` to write anywhere except a local database.
- It **refuses the whole run** if any target no longer looks as it did at review: a line someone has edited, a sheet that has since been applied, a holding a later count has moved, or a measure already changed.
- It **snapshots** every row it will change into `_stock_unit_fix_backup`, re-checks under row locks, then writes in one transaction.
- **`--rollback <runId>`** restores every row (including `updatedAt`) and deletes the correction movements. It refuses if anything was edited, moved or applied after the fix, unless `--force` is passed.
- **`--confidence high`** runs only the 41 high-confidence lines and 7 high-confidence holdings, leaving the rest until after a shelf check.

## Needs a shelf check (medium / low confidence)

| Item | Entry | Question |
|---|---|---|
| Massenez Crème de Pêche, Pomme Verte | AA lines 4.9 L, 3 L; AA holding 4 800 mL | The cost ($220.91 / $208.20 per "bottle") and Loaded's "1 × 5 L" say these are 5 L packs. Confirm, because the fix sets the measure to 5 000 mL. |
| Lime Juice | AA line 25.1 L; StA holding 8 L | The cost of $15.20 matches a 2 L bottle at $7.60/L, but the measure said 5 L. Confirm the pack size. This item is also in duplicate cluster #105. |
| Watermelon Juice, Avocadoes | AA lines 16.6 L, 1.473 kg | No invoice to confirm the 5 L pack / 5 kg tray measures. |
| Onion Powder, Paprika Smoked | AA lines 500 g, 1.2 kg | A twin item on the same sheet records a different reading (clusters #137, #138). |
| Manly Spirits Bulk 20 L Gin drum | AA line 18.1 L → 18 100 | This item counts in "gram", which is a mislabel for mL. It also duplicates Manly Spirits Dry Gin. |
| Peppercorns, Salt Flakes | AA lines | Restated, but both items have no cost, so they still value at $0. |
| Bay Leaves, Parrot Fish | AA lines | Cleared for a recount. |

## The guard that stops it recurring

`applyStocktake` now refuses a count with any counted line whose number would change if converted to the item's count unit: mL/g/L/kg on a bottle, pack or bag item, or cases on a bottle item. The 409 names each line and its approximate converted value. The Stocktake page already shows that message, for a single approval and for bulk approve. A line whose number carries across unchanged is still allowed: same unit, a generic "each", a pack label like "700ml" on a bottle item, or "bottle" on an item counted in "each". The refusal happens before anything is written.

The guard and the data fix are needed together. Without the fix, the guard blocks both 1 Oct sheets until someone restates 53 lines by hand. Without the guard, the next count with an mL line repeats the fault.

## Rehearsal (production copy)

- Dry run: no refusals. Output: `unit-fix-dryrun-2026-10-16.txt`.
- Apply, then rollback: StockItem, VenueStockItem, StocktakeLine and InventoryMovement are **identical row for row** to the pristine copy (full-row checksums).
- Apply, then apply both 1 Oct sheets through `stocktakesService.applyStocktake`: the result is sane (figures above), and a rollback attempted afterwards is refused, as it should be.
- Tests: `tests/unit-fix.test.ts` (apply → exact rollback; stale targets refused; rollback refused after an edit; a mis-unit sheet refused by apply until restated, then accepted) and `src/lib/apply-unit-guard.test.ts`. stock-api suite: 313/313.

## Run order, once approved

1. Shelf-check the medium items, or run `--confidence high` first.
2. Run the unit fix: dry run, then `--apply --i-mean-production`.
3. Run the duplicate merges, if approved (`decisions.json`).
4. Deploy the API with the guard.
5. Apply the two 1 Oct sheets.

Deploying the guard before step 2 is safe. It only blocks those two sheets until they are fixed.
