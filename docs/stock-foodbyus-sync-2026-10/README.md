# FoodByUs → Stock recipe sync (October 2026)

Tim keeps the real recipes in FoodByUs (Menu Costing, venue **St Alma**; the
"Alma Group" venue there holds no costing). This folder is the read-only pull of
that data on 18 Oct 2026 compared with Stock, and the guarded fixes that follow
from it. **Phase A was applied to production on 18 Oct 2026 01:35 (Sydney)** — see
"Production run" below. Phase B is still a proposal.

## What FoodByUs holds

- 57 recipes (dishes and preps) for St Alma, 110 costed ingredients. Every one
  of the 57 matches a Stock recipe by name. Alma Avalon has no FoodByUs data, so
  Avalon recipes are fixed only where the same prep exists in both venues.
- Dump: St Alma recipe details with ingredient lines, unit costs, yields and
  portion sizes (kept in the session scratchpad, not committed — it is
  supplier pricing).

## What was wrong in Stock

1. **Import leftovers.** 164 recipe lines are not ingredients at all — names
   like "(4 portions)" or "100 g" with no stock item and no sub-recipe (77 at
   St Alma, 87 at Avalon). Any uncosted line makes `calculateRecipeCost`
   return null, so the stored cost of those dishes never refreshed; the home
   page then showed stale or $0 costs (e.g. Chicken Tinga Empanadas $0.06).
2. **Preps not linked.** 49 lines name a prep ("Mole Verde", "Salsa Roja" …)
   but point at nothing. FoodByUs says which prep recipe each one is.
3. **Prep yields stored as raw weight.** 21 preps carry the sum of their
   ingredient weights as the yield; FoodByUs has the finished weight
   (1.2–2.9× smaller after reduction), so per-gram prep costs were too low.
   Chicken Tinga Empanada is a units yield (1 piece), not 55 g.
4. **Item costs out of line with the supplier price** — 18 ingredients differ
   from FoodByUs by more than 25% (see Phase B).

## Phase A — recipe-only fixes (no effect on stock value)

All through `apps/stock-api/scripts/create-prepared-stock-items-2026-10.ts`
(dry run by default, every `expectNow` must match or the run is REFUSED,
snapshot into `_stock_prepared_items_backup`, exact `--rollback <runId>`):

| Step | Command | What it does |
|---|---|---|
| 1 | `--prune-leftovers --apply-prune --run-id prod-fbu-prune-YYYYMMDD` | deletes the 164 leftover lines (recorded, recreated on rollback) |
| 2 | `--links docs/stock-foodbyus-sync-2026-10/recipe-prep-links.json --apply-links --run-id prod-fbu-links-YYYYMMDD` | sets `subRecipeId` on the 49 prep lines |
| 3 | `--recipes docs/stock-foodbyus-sync-2026-10/recipe-yields.json --apply-recipes --run-id prod-fbu-yields-YYYYMMDD` | sets finished yields on 21 preps |
| 4 | `--refresh-costs --apply-refresh` | recomputes every stored recipe cost from its lines (pure recompute; re-run after any rollback) |

Each step refreshes the recipes it touched and their dependents. Run ids must
be unused (`assertFreshRun`). Rollback in reverse order (3, 2, 1) then step 4.

### Rehearsal on a fresh production copy (alma_stock_links, 18 Oct)

```
Applied prune run f-prune: 164 line(s) removed; 86 recipe cost(s) refreshed. Rollback: --rollback f-prune
Applied links run f-links: 49 recipe line(s); 37 recipe cost(s) refreshed. Rollback: --rollback f-links
Applied recipes run f-yields: 21 recipe(s); 21 recipe cost(s) refreshed. Rollback: --rollback f-yields
Refreshed 659 recipe cost(s); 213 changed.
  Beach, Please Batch (St Alma): $98.83 → $66.73
  Snapper (new) (St Alma): $36.11 → $8.80
  Snapper (new) (St Alma): $0.00 → $21.52
  Gilbert Sauvignon Blanc 750mL (St Alma): $19.70 → $1.64
  Roasted Baby Beetroots (St Alma): $3.86 → $21.24
  Don Julio Blanco 30mL (Alma Avalon): $20.00 → $3.33
  Octopus (St Alma): $25.25 → $8.83
  Polenta Parmesan Fries (St Alma): $1.01 → $15.29
  Sensible Margarita (Alma Avalon): $14.46 → $3.05
  Wendouree Cabernet Malbec 750mL (St Alma): $250.00 → $240.00
  Aperol(ish) Spritz (Alma Avalon): $12.69 → $3.10
  Flan (St Alma): $14.45 → $7.48
  Domaine Oudin Chablis 750mL (St Alma): $42.18 → $48.97
  Seared Scallop (1pc) (Alma Avalon): $2.71 → $9.09
  Gilbert Sauvignon Blanc 250mL (St Alma): $6.57 → $0.55
St Alma: dishes sold in 30 days 115; without a usable cost before 22 → after 22
Alma Avalon: dishes sold in 30 days 54; without a usable cost before 12 → after 12
dish costs changed: 219 (St Alma 125 , Avalon 91 )

St Alma dishes in FoodByUs: Stock before → after vs FoodByUs
  Guacamole & Tostadas               $  3.75 → $  3.75   FoodByUs $  2.76  <-- item costs (see Phase B)
  Prawn Tostada                      $  3.26 → $  3.42   FoodByUs $  3.48  ok
  Salmon Crudo                       $  2.52 → $  2.83   FoodByUs $  4.83  <-- item costs (see Phase B)
  Agave Beef Short Ribs              $  6.07 → $ 10.83   FoodByUs $ 20.20  <-- item costs (see Phase B)
  Chicken                            $  8.50 → $  8.57   FoodByUs $  8.70  ok
  Octopus                            $ 25.25 → $  8.83   FoodByUs $  8.01  ok
  Poached Snapper 'Veracruzana'      $ 16.87 → $ 16.87   FoodByUs $ 16.87  ok
  Roasted Baby Beetroots             $  3.86 → $ 21.24   FoodByUs $  3.87  <-- item costs (see Phase B)
  Salmon (new)                       $  7.47 → $  4.42   FoodByUs $  6.48  <-- item costs (see Phase B)
  Snapper (new)                      $  0.00 → $ 21.52   FoodByUs $  9.19  <-- item costs (see Phase B)
  Broccolini                         $  2.87 → $  2.87   FoodByUs $  1.56  <-- item costs (see Phase B)
  Mixed Greens Salad                 $  2.59 → $  8.04   FoodByUs $  2.59  <-- item costs (see Phase B)
  Polenta Parmesan Fries             $  1.01 → $ 15.29   FoodByUs $  1.43  <-- item costs (see Phase B)
  Flan                               $ 14.45 → $  7.48   FoodByUs $  4.31  <-- item costs (see Phase B)
  Chicken With Mole Taco             $  1.62 → $  1.62   FoodByUs $  0.71  <-- item costs (see Phase B)
  Poblano Chicken Taco               $  0.92 → $  1.54   FoodByUs $  1.38  ok
  Pork Taco                          $  0.81 → $  1.20   FoodByUs $  1.10  ok
  Chicken Tinga Empanada (1pc)       $  0.03 → $  0.86   FoodByUs $  0.91  ok
  Chicken Tinga Empanadas            $  0.06 → $  2.42   FoodByUs $  2.51  ok
8 of 19 within 20% of FoodByUs after the recipe fixes alone
```

Rolled back in reverse order: `RecipeLine` checksum identical to the
pre-rehearsal value. Stock holdings and valuations are not touched by any step
(the script writes `RecipeLine` and `Recipe` only).

The 11 St Alma dishes still off FoodByUs after Phase A are explained by item
costs (Phase B) — e.g. Polenta Parmesan Fries $15.29 vs $1.43 is the Parmesan
wedge carrying a carton price; Roasted Baby Beetroots and Mixed Greens Salad
are goat/blue cheese at 10–12× — and by one portion question for Tim:
**Agave Beef Short Ribs** is 250 g a portion in Stock but ~667 g in FoodByUs
($10.83 vs $20.20).

## Phase B — item cost corrections (affects valuation; needs sign-off)

`item-cost-outliers.json` lists the 18 ingredients whose Stock average cost is
more than 25% off the FoodByUs supplier price. Proposed values are the
FoodByUs unit cost scaled to Stock's count unit. Several look like a pack or
measure error rather than a price error (a carton price on a per-wedge item, a
case price on a bottle) — those should have the count unit checked before the
cost is changed, because the fix may be the measure, not the cost. Tim approved every row on 18 Oct 2026 (Rum at $54.68); the reviewed file is
`item-cost-fixes.json` (17 costs + 4 measures), run by
`fix-unit-entries-2026-10.ts --fixes …`. Four rows are measure fixes, not price
changes (Coriander dozen = 1,200 g, Celery bunch = 615 g, Limes kg = 1,000 g,
Cucumber punnet = 250 g). Seven rows RAISE a cost; the fix tool refuses a rise
unless the row carries `approvedIncrease` with the approver's name.

| Stock item | Venue lines | Stock cost (per count unit) | FoodByUs | Proposed | Basis | Read as |
|---|---|---|---|---|---|---|
| PARMESAN GRANA WEDGE 14 X 200GM (Zanetti) CTN | 1 | $116.00 per each (200 g) | $0.0415 per g (Foodlink, pack 2800 g) | $8.30 | FoodByUs $0.0415/g × 200 g per each | pack or measure error — check the count unit before changing the cost |
| CHEESE BLUE 100GM (Castello) EA (10) | 1 | $49.62 per each (100 g) | $0.0400 per g (Foodlink, pack 100 g EA) | $4.00 | FoodByUs $0.0400/g × 100 g per each | pack or measure error — check the count unit before changing the cost |
| Cheese Goat | 2 | $27.57 per each (100 g) | $0.0275 per g (Foodlink, pack 1 kg EA) | $2.75 | FoodByUs $0.0275/g × 100 g per each | pack or measure error — check the count unit before changing the cost |
| Coriander Dozen | 7 | $0.20 per dozen (100 g) | $1.8350 per Units (Produce To Perfection, pack 12 Units) | $1.83 | FoodByUs $1.83 per unit (12 Units pack) | pack or measure error — check the count unit before changing the cost |
| Rum | 1 | $404.82 per bottle (750 ml) | $0.0729 per ml (?, pack 700 ml) | $54.68 | FoodByUs $0.0729/ml × 750 ml per bottle | pack or measure error — check the count unit before changing the cost |
| Tomatoes Cherry | 2 | $3.00 per each (100 g) | $0.0055 per g (Foodlink, pack 400 g) | $0.55 | FoodByUs $0.0055/g × 100 g per each | pack or measure error — check the count unit before changing the cost |
| Celery Bunch | 4 | $3.75 per bunch (120 g) | $0.0062 per g (Produce To Perfection, pack 615 g) | $0.74 | FoodByUs $0.0062/g × 120 g per bunch | pack or measure error — check the count unit before changing the cost |
| DELI BACON STREAKY | 2 | $54.60 per kg (—) | $0.0180 per g (Mastercut Meats, pack 3 kg) | $18.00 | FoodByUs $0.0180/g × 1000 | pack or measure error — check the count unit before changing the cost |
| Tortilla Flour 12inch | 5 | $0.48 per each (100 g) | $0.1900 per Units (Foodlink, pack 30 Units) | $0.19 | FoodByUs $0.19 per unit (30 Units pack) | cost too high |
| CHORIZO DON'S | 2 | $39.50 per kg (—) | $0.0160 per g (Mastercut Meats, pack 2.5 kg) | $16.00 | FoodByUs $0.0160/g × 1000 | cost too high |
| SALMON FILLETS S/OFF TASI SASHIMI 1.5-2KG R/W (Huon) | 3 | $21.45 per kg (1000 g) | $0.0507 per g (Foodlink, pack 1 kg) | $50.70 | FoodByUs $0.0507/g × 1000 g per kg | cost too low |
| Flour Plain | 1 | $1.12 per each (1000 g) | $0.0025 per g (Foodlink, pack 1 kg) | $2.50 | FoodByUs $0.0025/g × 1000 g per each | cost too low |
| Cabbage Red | 1 | $3.80 per each (400 g) | $6.7600 per Units (Produce To Perfection, pack 1 Units) | $6.76 | FoodByUs $6.76 per unit (1 Units pack) | cost too low |
| VINEGAR WHITE 4LT (Edlyn) EA (3) | 1 | $4.30 per each (4000 ml) | $0.0015 per ml (Foodlink, pack 5 L) | $6.00 | FoodByUs $0.0015/ml × 4000 ml per each | cost too low |
| Chilli Poblano Kilo | 1 | $17.50 per kg (—) | $0.0238 per g (Produce To Perfection, pack 1 kg) | $23.80 | FoodByUs $0.0238/g × 1000 | cost too low |
| Mexican Oregano - 250g | 3 | $17.70 per each (250 g) | $0.0960 per g (Fireworks Foods, pack 250 g) | $24.00 | FoodByUs $0.0960/g × 250 g per each | cost too low |
| Limes Volume Box 10kg | 5 | $7.70 per kg (70 g) | $0.0046 per g (Produce To Perfection, pack 10 kg) | $0.32 | FoodByUs $0.0046/g × 70 g per kg | pack or measure error — check the count unit before changing the cost |
| Cucumber Quks Punnet | 7 | $3.80 per punnet (200 g) | $0.0120 per g (Produce To Perfection, pack 250 g) | $2.40 | FoodByUs $0.0120/g × 200 g per punnet | cost too high |

## Not covered

- Alma Avalon recipes beyond shared preps (no FoodByUs data).
- Mole Verde (Avalon) yield still in portions.
- Stock's sales-margin figures use stored costs; they correct themselves once
  Phase A runs in production.

## Production run (18 Oct 2026, approved by Tim)

Backup `/opt/alma/backups/pre-fbu-oct18-20261018-013343.dump` (99.7 MB), restored
locally and matched on StockItem 889, VenueStockItem 1910, StocktakeLine 9701,
InventoryMovement 6933, Recipe 702, RecipeLine 1664. All three dry runs
matched the rehearsal with no refusals. Applied, in order:

```
Applied prune run prod-fbu-prune-20261018: 164 line(s) removed; 86 recipe cost(s) refreshed
Applied links run prod-fbu-links-20261018: 49 recipe line(s); 37 recipe cost(s) refreshed
Applied recipes run prod-fbu-yields-20261018: 21 recipe(s); 21 recipe cost(s) refreshed
Refreshed 659 recipe cost(s); 213 changed.
```

After: RecipeLine 1,500 (11 still unlinked, none are leftovers); VenueStockItem
byte-identical; StocktakeLine and InventoryMovement identical to the backup;
valuations unchanged — Alma Avalon $31,154.50, St Alma $58,739.31.
Rollback: `--rollback prod-fbu-yields-20261018`, then `-links-`, then
`-prune-`, then `--refresh-costs --apply-refresh`.

### Phase B rehearsal (copy at the Phase A state, 18 Oct)

```
Applied run pB-rehearsal2: 17 cost(s), 4 measure(s), 0 line(s), 0 holding(s) with 0 correction movement(s).
Refreshed 659 recipe cost(s); 71 changed.
```

| | Alma Avalon | St Alma |
|---|---:|---:|
| Before (Phase A state = production now) | $31,154.50 | $58,739.31 |
| After Phase B | $31,536.57 | $57,818.49 |
| Change | +$382.05 (Coriander dozen at $22.02) | −$920.83 (mostly Rum: 2.7 × $404.82 → $54.68) |

St Alma dish costs after Phase B vs FoodByUs: Roasted Baby Beetroots $3.87 = $3.87,
Mixed Greens Salad $2.58 vs $2.59, Guacamole & Tostadas $2.74 vs $2.76, Flan $4.21 vs
$4.31, Poblano Chicken Taco $1.36 vs $1.38, Polenta Parmesan Fries $15.29 → $4.52
(FoodByUs $1.43 — remaining gap is the polenta/oil lines, not the cheese). Salmon
dishes now cost ABOVE FoodByUs (Salmon Crudo $7.67 vs $4.83): Stock's portion is
larger than FoodByUs's, same per-kg price. Snapper (new) $21.52 vs $9.19 and
Agave Beef Short Ribs $11.19 vs $20.20 are portion/line questions, not prices.

Rolled back: StockItem and RecipeLine checksums identical, valuations back to
$31,154.50 / $58,739.31. Production order: `--fixes item-cost-fixes.json --apply
--run-id prod-fbu-costs-YYYYMMDD --i-mean-production`, then `--refresh-costs
--apply-refresh`. Rollback: `--rollback <runId>`, then refresh again.
