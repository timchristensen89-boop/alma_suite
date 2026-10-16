# Case-price corrections: 11 items (prepared 17 Oct 2026, **not applied**)

Eleven stock items carry a **case or drum price as their per-bottle, per-litre or per-kilo cost**. Each one was confirmed in the 17 Oct audit (alma_suite#323): the stored cost is an exact multiple (×6, ×12, 20 L) of the same product's per-unit cost on another record or invoice. `case-price-fixes.json` lists each one with its evidence.

| Item | Cost now | Corrected |
|---|---:|---:|
| Lyre's White Cane 700 mL | $204.42 | $34.07 |
| Lyre's Agave Blanco 700 mL | $211.14 | $35.19 |
| Sammy Piquant Jetsetter 700 mL | $179.70 | $29.95 |
| Herradura Agave Nectar 473 mL (case of 12) | $134.88 | $11.24 |
| Supasawa 700 mL (case of 6) | $148.26 | $24.71 |
| Giffard Rose Syrup 1 L | $142.35 | $23.73 |
| Giffard Coconut Syrup 1 L | $128.40 | $21.40 |
| Don Julio Blanco 750 mL | $500.10 | $83.35 |
| TSEC 20 L (No Sugar), per litre | $680.00 | $34.00 |
| Watermelon Juice (1 × 5 L), per litre | $30.00 | $6.00 |
| YG Beef Chuck Roll, per kg | $124.00 | $20.67 |

**What changes:** only each item's average cost. The latest purchase price, every stocktake line's recorded value and every stock movement stay exactly as they were, so history reads as it was recorded and only today's valuation is corrected.

## Effect (production, 17 Oct 07:02 AEDT)

| | Alma Avalon | St Alma |
|---|---:|---:|
| Stock value now | $39,322.32 | $64,566.68 |
| Correction | −$7,622.27 | −$4,731.43 |
| **After** | **$31,700.05** | **$59,835.25** |

The audit at 06:37 estimated −$9,681. The correction is now **−$12,354**, because the duplicate merges made in the app at 06:48 folded more stock into four of these case-priced records: Lyre's Agave, Supasawa, Giffard Rose and Giffard Coconut.

## Rehearsal

- **Fresh copy of production (07:02):** the dry run had no refusals. Apply lowered Avalon to $31,700.06 and St Alma to $59,835.26, exactly as planned. Stocktake lines and movements were unchanged.
- **Rollback** restored StockItem, VenueStockItem, StocktakeLine and InventoryMovement **identically** to the pristine twin (full-row checksums).
- **Read-only dry run against production:** identical to the rehearsal, with no refusals (`production-dry-run-2026-10-17.txt`).
- **Tests:** stock-api 335/335, including two new cost-fix tests. One covers apply, then stale-review refusal, then exact rollback, with history untouched. The other confirms a correction that would *raise* a cost is refused.

## To apply, once approved

```
# backup first
ssh root@203.57.50.4 'ts=$(date +%Y%m%d-%H%M%S); docker exec deploy-postgres-1 pg_dump -U alma -d alma_suite_v18 -Fc --no-owner --no-acl > /opt/alma/backups/pre-case-price-fix-$ts.dump'
# dry run, then apply (through the SSH tunnel used for the unit fixes)
DATABASE_URL=… tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes docs/stock-case-price-fix-2026-10/case-price-fixes.json
DATABASE_URL=… tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes docs/stock-case-price-fix-2026-10/case-price-fixes.json --apply --i-mean-production --run-id prod-case-prices-YYYYMMDD
# undo
DATABASE_URL=… tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes … --rollback prod-case-prices-YYYYMMDD --i-mean-production
```

The run refuses everything if any of the 11 costs has changed since review.

## Risk of the error coming back (follow-up, not part of this fix)

Most of these records have purchase unit "bottle" and 1 per purchase unit, but their cost came from a case price. A future invoice applied to them as a *case* would write the case price back. Setting each one's purchase unit to the case (for example "case", 6 per case) stops that. Herradura (case of 12) and Supasawa (case of 6) are already set up that way.

## Found while preparing this (production, 06:48–06:50 AEDT): your call, not touched

About 27 duplicate groups were merged in the app (Items → Duplicates) at 06:48. The app's merge **adds the two records' holdings together**, so:

- **Holdings were summed.** Where the two records were counting the same bottles, stock is now double-counted. Since 06:37 the value rose $1,726 at Avalon and $1,039 at St Alma.
- **Four merges went into the case-priced record,** keeping the $148–$211 a bottle price: Supasawa, Lyre's Agave, Giffard Rose and Giffard Coconut. This fix corrects those prices.
- **Units were mixed in two merges.** Watermelon Juice and Lime Juice (counted per 5 L container) were merged into the "(1 × 5L)" records counted per **litre**, so containers were added as single litres.
- **Agave Syrup** was changed to count in "gram" with 750 per purchase unit, which re-derived its cost to **$0.08**. 3.65 units at Avalon are now valued at $0.29.
