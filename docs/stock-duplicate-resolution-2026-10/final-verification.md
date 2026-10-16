# Alma Stock: final verification (16 October 2026)

**Status: verified on copies of production. Nothing in this report was applied to production.** The checks ran on a read-only copy of production taken at 22:03 AEDT on 16 Oct, after today's unit fixes, and on the pre-fix backup from 21:15. Four things are waiting for approval; they are listed at the end.

## 1. PR #322: testing, and automatic unit handling

**Tests.** The stock-api suite passes 333/333 against a database, and the web app typechecks and builds. PR #322 now includes PR #321: the two branches merged without conflicts and the suite ran on the combined code. #322 is now based on #321's branch, so its diff shows only its own changes. Merge #321 first.

**How units now work, so managers never convert anything:**

- **The count screen asks for the item's count unit.** "Bottles", "bags", "kg": whatever the item is counted in. New counts started from a template already use it.
- **Anything typed in another unit is stored in the count unit, converted automatically, wherever a count is entered.** That covers creating a count, saving the whole sheet, the count screen's per-line save and the bulk "fix unit" tool. The conversion happens when it can't be wrong:
  - cases to bottles, using the item's pack size
  - grams to kilos, and mL to litres
  - a pack label such as "700ml" on a bottle item
  - a weight or volume on a pack item with a real measure: 970 g of a 1 kg bag is stored as 0.97 bag

  If the conversion could be wrong, the count is refused with a plain message such as "Pistachio: 970 g can't be turned into each — the item doesn't yet say how much one each holds. Enter it in each." It isn't guessed.
- **Lines a save didn't change are left exactly as stored.** Editing a count never rewrites the history already on it.
- **At apply,** exact conversions (cases, kg/g) happen automatically and the movement records them: "Counted 3 case = 18 bottle". A line whose conversion would depend on the item's measure, such as an imported "22 ml" on a bottle item, is refused and named before anything is written. The Stocktake page shows that message.

**What stops this being fully automatic for every item:** 83 active items still carry the 100 g / 100 mL placeholder measure that the first catalogue import gave them (`placeholder-measures.csv`: tortillas, kegs, produce, dry goods). Counting those in their count unit works. Entering them by weight is refused until someone sets the real measure on the item. Fixing those 83 measures is the last step to full weight-to-pack automation.

## 2. The 30 highest-value items at each venue

The table below is the state after the pending steps (juice fix, merges, 1 Oct sheets). "Cluster" says whether the duplicate review already covers the item.

### Alma Avalon

| # | Item | Holds | Value | Issue | Cluster |
|---|---|---|---:|---|---|
| 1 | Herradura Agave Nectar 473 mL (case of 12) | 15 | $2,023 | **Case price stored per bottle** ($134.88). The 15 is a 2025 quantity. Likely ~$169 | #104, your call |
| 2 | Sammy Piquant Jetsetter 700 mL | 10.7 | $1,923 | **$179.70 a bottle looks like a case price.** 2025 quantity | #107, your call |
| 3 | Manly 20 L gin drum | 18,100 "gram" | $1,267 | Counts in "gram" (means mL). **Same gin as Manly Dry Gin (#6)**, so it's double counted | #192, approved |
| 4 | Massenez Pomme Verte | 6 | $1,249 | **$208.20 for a 500 mL bottle is far too high** | none |
| 5 | Lyre's White Cane 700 mL | 6 | $1,227 | **$204.42 is a case price.** 2025 quantity | #82, refused on cost |
| 6 | Manly Spirits Dry Gin | 25.87 | $1,164 | Last counted 1 Sep (19.4 L). The 1 Oct count went on the drum (#3) | #192 |
| 10 | TSEC 20 L (No Sugar) | 1.05 L | $714 | **$680 per litre is a drum price on a litre unit.** Likely ~$36. 2025 quantity | #193, your call |
| 12 | Watermelon Juice (1 × 5 L) | 11.3 L | $339 | $30/L is wrong (~$7/L). Twin of Watermelon Juice | #109, your call |
| 13, 14, 19, 22 | Herradura Reposado, Patrón XO Café, Aguas Mansas 700 mL, BenMarco Malbec | — | $1,216 | **Not counted since Dec 2025:** invoice-named twins | #34, #92, #0, #200 |
| 18 | Tortilla Corn | 1,700 | $289 | Counted 2.15 in August and 1,700 on 1 Oct. One of those units is wrong; also a placeholder measure | #209, your call |
| 23 | Bicarb Soda 1 kg | 45 | $270 | **45 bags left by a 2025 sheet** | none |
| 24 | Limes | 5.8 kg | $264 | **$45.57/kg looks like a box price** | #225, your call |
| 28 | Lime Juice (1 × 5 L) | 3.5 L | $245 | **$70/L is wrong** ($7.60/L on the invoice). Twin of Lime Juice | #105, your call |

Plausible as recorded: Kendall Jackson, Laurent-Perrier, El Tequileño (counts plus prep credits), the El Jolgorio and Herradura Suprema mezcals at $250–500 a bottle, Don Julio 1942, the wines.

### St Alma

| # | Item | Holds | Value | Issue | Cluster |
|---|---|---|---:|---|---|
| 2 | Cuvée Colette Rosé 2024 (case of 6) | 18.4 | $1,877 | **$102 a bottle is a case price.** 2025 quantity | #202, your call |
| 5 | Domaine Thompson Explorer Pinot (case of 12) | 6 | $1,446 | **$241 a bottle is a case price** (~$20) | #117, your call |
| 7, 14 | Lyre's Agave Blanco, Lyre's White Cane 700 mL | 6, 4.37 | $2,161 | **Case prices per bottle** | #106, #82 |
| 9 | "Rum" | 2.7 | $1,093 | No product named; $404.82 a bottle; from a March sheet | none |
| 11 + 12 | Bonnet & Cotton Beaujolais, case-of-12 item + floor item | 28 + 28 | $1,960 | **Same 28 bottles under two items** | #116, your call |
| 13 | Serenello Prosecco (case of 6) | 11 | $935 | **$85 a bottle is a case price** (~$14) | #128, your call |
| 21, 22 | Giffard Rose Syrup 1 L, Patrón XO Café | — | $1,272 | Rose syrup at $142 is a case price; both not counted since Dec 2025 | #102, #92 |

Plausible: the Rockford Basket Press 2017/2018, Sandrone Barolo, Bouchard Corton, Pol Roger, beef short ribs (deliveries since a zero count), the Manly spirits (now in bottles), El Tequileño.

**The patterns, and where they get fixed:**
- **Case or drum prices stored as a per-bottle cost** on invoice-named items: roughly $13k of overstatement across the two lists. Fix: set the per-bottle cost on each item. Most are in clusters waiting for your call, where the merge keeps the survivor's correct cost.
- **2025 quantities never recounted:** these are the stale twin holdings the merges discard.
- **Double counts across two items:** Manly gin, Bonnet & Cotton, lime and watermelon juice. Merging, or recounting one of the two items, fixes each.

## 3. The 81 approved merges

- **Re-run against today's production copy:** **65 ready, 16 refused** by the script's guards, the same as this morning. 10 have a different count unit; 7 have costs 2× or more apart (one cluster has both). Refused clusters are not touched.
- **History is preserved.** The merge script now treats every applied sheet as history: a duplicate's lines there are repointed to the surviving item and **never summed or deleted**. After applying all 65 on the copy, every line on every applied sheet matches field for field (quantity, unit, label, value, position, notes), every movement matches, and counts and totals are identical. Only the item reference moves.
- **Folds happen only on the two unapplied 1 Oct sheets: 60 lines.**
  - 52 were blank lines.
  - 5 were duplicate lines next to a survivor line that already holds the count. Four were zeros; the fifth is i Lauri Pecorino, the same 10 bottles written on two rows.
  - 1 moved the duplicate's count (black pepper, 0.3) onto the survivor's blank line.

  Nothing is summed twice.
- **Rollback:** rolling all 65 back on the copy restored StockItem, VenueStockItem, StocktakeLine, InventoryMovement, RecipeLine, SupplierInvoiceLine, aliases, reorder notices and PO lines identically.
- **Order matters: merge first, then apply the 1 Oct sheets.** If the sheets are applied first, 4 more merges are refused, because their double counts would then sit on applied sheets.

## 4. Reviewing the other 151 clusters

The review page is a private page at <https://claude.ai/artifact/XGDLxz5Q2PWkDaTPd3QJVZ>. For each group it shows:
- the items, their roles, costs and holdings at each venue
- why the merge was proposed
- the independent checks, and which of them disagreed
- the final check's corrections

You pick **Merge as proposed**, **Merge with corrections**, **Keep separate** or **Needs a shelf check**, and can add a note. Choices are saved, and a merge file is built from them afterwards for your final go-ahead. Nothing merges from the page.

## 5. The 1 October stocktakes

**St Alma "Bar & FOH 01/10/2026" can be applied now.** On the production copy:
- All 267 counted lines were already in their count unit, so even production's current apply code (which converts nothing) writes the right number.
- Applying it wrote 267 movements, each on-hand equal to its count.
- No line on any other sheet changed, no existing movement changed, and the sheet's own lines were untouched.

**Alma Avalon "Stocktake 10/1/2026" needs three more lines restated first.** The final pass found them; my earlier check missed them because the item measure made the number look right.

| Line | Evidence | Restated |
|---|---|---|
| Apple Juice 3.8 L | Invoices: "2 Litre Bottle" at $6.65 = the item's cost | **1.9** bottles (measure 1 L → 2 L) |
| Grapefruit Juice 2.15 L | Loaded: "1.3 2 L = $9.75" | **1.075** bottles (measure 1 L → 2 L) |
| Ice Cream Chocolate 7 L | $2.50 per each = $25 per 10 L tub, so each is 1 L | **7**, label only |

They're prepared as `unit-fixes-2026-10-16-juices.json` and rehearsed on the copy, **not run on production**. With them in place, the Avalon sheet applies cleanly: 398 movements, each on-hand equal to its count, history unchanged. Applied raw, apple and grapefruit juice would record double the real stock (about $20 between them).

**Full sequence proven on the copy:** juice fix, then the 65 merges, then both sheets. Result: 660 movements, every on-hand equal to its count, no historical line or movement changed.

## 6. Backups and rollback for every production change today

| Run | When (AEDT) | Changed | Backup taken first (on the VPS, `/opt/alma/backups/`) |
|---|---|---|---|
| `prod-unitfix-20261016-high` | 21:16 | 20 measures, 42 lines, 7 holdings | `pre-unit-fix-20261016-211524.dump` |
| `prod-unitfix-20261016-massenez` | 21:26 | 1 line, 1 holding | `pre-massenez-fix-20261016-212554.dump` |
| `prod-unitfix-20261016-shelfcheck` | 21:39 | 5 lines | `pre-shelf-check-fix-20261016-213927.dump` |
| `prod-unitfix-20261016-packsizes` | 21:51 | 1 measure, 4 lines, 1 holding | `pre-pack-size-fix-20261016-215049.dump` |
| `prod-unitfix-20261016-bayleaves` | 21:55 | 1 line | `pre-bay-leaves-fix-20261016-215456.dump` |

**Rollback tested.** On a copy of production taken after all five runs, rolling them back newest first produced a database identical to the 21:15 pre-fix backup: StockItem, VenueStockItem, StocktakeLine, InventoryMovement, Stocktake and RecipeLine all match. Restoring that backup locally also proved the backup file is usable.

Command for one run: `fix-unit-entries-2026-10.ts --rollback <run id> --i-mean-production`. It refuses if anything was edited, moved or applied after the run, unless `--force` is passed. **Once a 1 Oct sheet is applied, rolling back the fixes on that sheet's lines is refused.** At that point the app's reversal is the way back, and the backups remain as a last resort.

Production's stock API container was built on 27 Sep from code before #321 and #322. Until those are deployed, production has neither the automatic conversion nor the apply guard.

## 7. Stock valuation by venue and category

Value is active items, on hand × average cost. "After" means after the juice fix, the 65 merges and both 1 Oct sheets.

| Category | Alma Avalon now | Alma Avalon after | St Alma now | St Alma after |
|---|---:|---:|---:|---:|
| Spirits — Tequila & Mezcal | $15,599 | $12,797 | $15,953 | $13,835 |
| Wine — Red | $8,183 | $2,075 | $23,715 | $23,200 |
| Wine — White | $4,024 | $3,091 | $12,928 | $12,244 |
| Spirits — Other | $4,478 | $5,614 | $6,713 | $5,996 |
| Liqueurs & Aperitifs | $4,657 | $5,062 | $4,504 | $4,999 |
| Non-Alcoholic & Mixers | $4,472 | $4,373 | $4,212 | $4,584 |
| Oils & Condiments | $2,946 | $2,961 | $514 | $514 |
| Wine — Sparkling | $2,118 | $1,063 | $1,616 | $2,352 |
| Wine — Rosé | $435 | $305 | $2,951 | $3,354 |
| Beer & Cider | $1,451 | $855 | $1,791 | $662 |
| Produce | $1,288 | $1,225 | $1,032 | $1,032 |
| Meat & Poultry | $345 | $394 | $1,828 | $1,828 |
| Dry / Pantry | $904 | $803 | $423 | $423 |
| Seafood | $489 | $372 | $122 | $122 |
| Herbs & Spices | $365 | $361 | $66 | $66 |
| Bakery | $36 | $324 | $204 | $204 |
| Dairy & Eggs | $283 | $234 | $137 | $137 |
| Other categories | $201 | $247 | $423 | $423 |
| **Total** | **$52,275** | **$42,156** | **$79,130** | **$75,974** |

This morning the totals were Alma Avalon $3,004,624 and St Alma $265,027. The remaining suspicious value is mostly the case prices in §2, roughly $13k, which would come off when the per-bottle costs are set.

## Waiting for your approval (nothing below has been done)

1. **Juice fix on production:** three Avalon lines and two measures (§5). It is needed before the Avalon sheet can be applied.
2. **The 65 merges on production,** run before the sheets are applied.
3. **Apply the two 1 Oct sheets.** St Alma is ready now; Avalon is ready after step 1.
4. **Merge and deploy #321 and #322,** for the automatic conversion and the apply guard.

After that: your calls on the 151 clusters, the case-price costs in §2, and the 83 placeholder measures.
