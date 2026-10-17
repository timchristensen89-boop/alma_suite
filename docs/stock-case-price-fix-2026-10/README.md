# Case-price corrections: 13 items, verified against supplier documents (prepared 17 Oct 2026, **not applied**)

These 13 stock items store a **case, drum or container price as their per-bottle, per-litre or per-kilo cost**. Each correction was checked against supplier documents: Gmail order confirmations and POs, the invoice lines stored in Stock, and Xero bills.

- **Where a supplier document prices the exact product, that price is used:** Lyre's 700 mL, Giffard 1 L syrup, the Nectar juices, and FoodByUs chuck roll.
- **Where no document exists,** the correction is the stored price divided by the pack size, and it matches the same product's twin record.
- **Changed after verification:** Lyre's White Cane and Agave are now $29.19, not $34.07/$35.19. Watermelon is $6.96/L, not $6.00. Chuck roll is $20.50/kg, not $20.67. **Lime Juice (1 × 5L)** is added as a 12th item, and **Beef Short Ribs (3 rib)** as a 13th: $51.80/kg was exactly 2 × $25.90, and FoodByUs has charged $29.00/kg on every delivery since 13 Jun.

`case-price-fixes.json` holds each item's evidence: supplier, date, document and line.

| Item | Price now | Corrected | Pack | Held: Avalon | Held: St Alma | Impact: Avalon | Impact: St Alma | Supplier evidence |
|---|---:|---:|---|---:|---:|---:|---:|---|
| LYRES WHITE CANE SPIRIT 700ML BOTTLE | $204.42 | $29.19 | 700 mL bottle (was a 6-bottle price) | 6 | 4.372 | $-1,051.38 | $-766.05 | **Paramount Liquor** 2026-07-26: 2 × Lyre's White Rum Alternative 700ml @ $29.19 (ex GST) (supplier price) |
| LYRES AGAVE BLANCO 700ML BOTTLE | $211.14 | $29.19 | 700 mL bottle (was a 6-bottle price) | 6.786 | 6 | $-1,234.67 | $-1,091.70 | **Paramount Liquor** 2026-07-26: 1 × Lyre's Tequila Alternative 700ml @ $29.19 (ex GST) (supplier price) |
| SAMMY PIQUANT JETSETTER 700ML BOTTLE | $179.70 | $29.95 | 700 mL bottle (was a 6-bottle price) | 10.7 | 1.95 | $-1,602.33 | $-292.02 | **(no supplier document found)**: $179.70 = 6 × $29.95 (case ÷ 6, matches twin) |
| HERRADURA AGAVE NECTAR 473ML - (CASE OF 12) | $134.88 | $11.24 | 473 mL bottle; purchase unit case of 12 | 15 | — | $-1,854.60 | — | **(no supplier document found)**: $134.88 = 12 × $11.24 (case ÷ 12) |
| SUPASAWA 700ML - (CASE OF 6) | $148.26 | $24.71 | 700 mL bottle; purchase unit case of 6 | 2.4 | 5.3 | $-296.52 | $-654.82 | **(no supplier document found)**: $148.26 = 6 × $24.71 (case ÷ 6) |
| GIFFARD ROSE SYRUP 1L BOTTLE | $142.35 | $23.73 | 1 L bottle (was a 6-bottle price) | 1.825 | 8.57 | $-216.48 | $-1,016.57 | **Paramount Liquor** 2026-07-26: Giffard Vanilla Syrup 1L @ $23.73 (same Giffard 1 L syrup price); $142.35 = 6 × $23.73 (case ÷ 6, matches supplier price) |
| GIFFARD COCONUT SYRUP 1000ML BOTTLE | $128.40 | $21.40 | 1 L bottle (was a 6-bottle price) | 3.026 | 5.4 | $-323.75 | $-577.80 | **(no coconut-specific document)**: $128.40 = 6 × $21.40 (case ÷ 6) |
| DON JULIO BLANCO 750ML BOTTLE | $500.10 | $83.35 | 750 mL bottle (was a 6-bottle price) | 0.2 | 0.05 | $-83.35 | $-20.84 | **(no supplier document found)**: $500.10 = 6 × $83.35 (case ÷ 6, matches twin) |
| TSEC 20L (NoSugar) - 20L - 20% ABV | $680.00 | $34.00 | per litre of a 20 L drum | 1.05 | 0.015 | $-678.30 | $-9.69 | **Manly Spirits (receipts carry no line items)**: $680 = one 20 L drum; ÷ 20 = $34.00/L (drum ÷ 20 L) |
| Watermelon Juice (1 x 5L) | $30.00 | $6.96 | per litre of a 5 L container | 14.62 | 3.1 | $-336.84 | $-71.42 | **Nectar Cold Pressed** 2026-10-06: Pure Watermelon Juice 5L @ $34.80 → $6.96/L (supplier price) |
| YG BEEF CHUCK ROLL | $124.00 | $20.50 | per kg | — | 2.757 | — | $-285.33 | **FoodByUs** 2026-06-30: 13.9 kg $284.95; 15 kg $307.50; 20.3 kg $416.15 = $20.50/kg each time (supplier price) |
| Lime Juice (1 x 5L) | $70.00 | $14.00 | per litre of a 5 L container | 8.52 | 4.8 | $-477.12 | $-268.80 | **Nectar Cold Pressed** 2026-10-06: Lime Juice 5L @ $70.00 → $14.00/L (supplier price) |
| BEEF SHORT RIBS GRAINFED 3 RIB | $51.80 | $29.00 | per kg (was 2 × the per-kg price) | — | 24.59 | — | $-560.65 | **FoodByUs** 2026-07-07: $29.00/kg on every delivery since 13 Jun (14.1 kg $408.90, 14.9 kg $432.10, 17.1 kg $495.90 on 2 Jul, 57.4 kg $1,664.60 on 7 Jul); $25.90/kg before (e.g. 41.1 kg $1,064.49, 45.4 kg $1,175.86); stored $51.80 = 2 × $25.90; Avalon twin $25.89 (supplier price (latest invoice)) |
| **Total** | | | | | | **$-8,155.34** | **$-5,615.69** | |

Quantities held are production at 12:51 AEDT on 17 Oct. **What changes:** only each item's average cost. The latest purchase price, every stocktake line's recorded value and every movement stay as they were.

## Effect (production, 17 Oct 12:51 AEDT)

| | Alma Avalon | St Alma |
|---|---:|---:|
| Stock value now | $39,322.32 | $64,566.68 |
| Correction | −$8,155.34 | −$5,615.69 |
| **After** | **$31,166.98** | **$58,950.98** |

**Order in production:** the separate merge-repair script runs **first**. It restores the holdings that the 06:48 app merges summed, so the quantities on Supasawa, Lyre's Agave and Giffard Rose/Coconut will drop. These case prices run second, and the combined totals will be recomputed in the final rehearsal.

## Rehearsal

- **Fresh production copy (12:51):** the dry run had no refusals. Apply lowered Avalon to $31,166.98 and St Alma to $58,950.98. Holdings, stocktake lines and movements were unchanged.
- **Rollback** was identical to the pristine twin: StockItem, VenueStockItem, StocktakeLine and InventoryMovement full-row checksums all match.
- **Read-only dry run against production:** identical to the rehearsal, with no refusals (`production-dry-run-2026-10-17.txt`).
- **Tests:** stock-api 335/335, including the cost-fix tests (apply, then stale refusal, then exact rollback; a correction that would raise a cost is refused).

## To apply, once approved (after the merge-repair script)

```
ssh root@203.57.50.4 'ts=$(date +%Y%m%d-%H%M%S); docker exec deploy-postgres-1 pg_dump -U alma -d alma_suite_v18 -Fc --no-owner --no-acl > /opt/alma/backups/pre-case-price-fix-$ts.dump'
DATABASE_URL=… tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes docs/stock-case-price-fix-2026-10/case-price-fixes.json             # dry run
DATABASE_URL=… tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes docs/stock-case-price-fix-2026-10/case-price-fixes.json --apply --i-mean-production --run-id prod-case-prices-YYYYMMDD
DATABASE_URL=… tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes … --rollback prod-case-prices-YYYYMMDD --i-mean-production   # undo
```

The run refuses everything if any of the 13 costs has changed since review.

## Risk of the error coming back (follow-up, not part of this fix)

Most of these records have purchase unit "bottle" and 1 per purchase unit, but their cost came from a case price. A future invoice applied to them as a *case* would write the case price back. Setting each one's purchase unit to the case (for example "case", 6 per case) stops that. Herradura (case of 12) and Supasawa (case of 6) are already set up that way.

## Found while preparing this (production, 06:48–06:50 AEDT): your call, not touched

About 27 duplicate groups were merged in the app (Items → Duplicates) at 06:48. The app's merge **adds the two records' holdings together**, so:

- **Holdings were summed.** Where the two records were counting the same bottles, stock is now double-counted. Since 06:37 the value rose $1,726 at Avalon and $1,039 at St Alma.
- **Four merges went into the case-priced record,** keeping the $148–$211 a bottle price: Supasawa, Lyre's Agave, Giffard Rose and Giffard Coconut. This fix corrects those prices.
- **Units were mixed in two merges.** Watermelon Juice and Lime Juice (counted per 5 L container) were merged into the "(1 × 5L)" records counted per **litre**, so containers were added as single litres.
- **Agave Syrup** was changed to count in "gram" with 750 per purchase unit, which re-derived its cost to **$0.08**. 3.65 units at Avalon are now valued at $0.29.
