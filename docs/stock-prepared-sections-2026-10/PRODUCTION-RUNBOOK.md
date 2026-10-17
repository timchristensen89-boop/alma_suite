# Production runbook: merge repair, case prices, Batch Cocktails & Kitchen Prep (17 Oct 2026)

**Status: rehearsed, not run. Every step below needs Tim's approval.**

Three PRs make up this change. Each one is inert until its script is run, except #325, which also carries app code.

| PR | What it does | Changes data? |
|---|---|---|
| merge repair (`feat/stock-app-merge-repair`) | Repairs the 17 Oct 06:48 app merges: history, holdings, Agave Syrup, juice units | Yes, when run |
| #324 (`feat/stock-case-price-fix`) | 13 costs stored as case or container prices, each verified against a supplier document | Yes, when run |
| #325 (`feat/stock-batches-and-prep`) | Batch Cocktails and Kitchen Prep sections, plus their setup | Migration and setup script; app code on deploy |

## What production looks like before and after

| | Alma Avalon | St Alma |
|---|---:|---:|
| Now (17 Oct 12:54) | $39,322.32 | $64,566.68 |
| After merge repair | $39,789.36 | $63,223.51 |
| After case prices | **$31,154.50** | **$58,739.31** |
| Change | −$8,167.82 | −$5,827.37 |

The measures, recipe links and prepared items do not change stock value. The 38 prepared items start with no quantity, because the 1 Oct counts already credited what was in those batches to the raw ingredients. They are valued from their first count.

## Rehearsal (fresh production copy, 12:54)

All steps were run in this order on a copy of production, then rolled back in reverse:

- **History:** every stocktake line on every sheet is identical to the 06:37 copy taken before the app merges. The 31 applied sheets and their 6,897 adjustment movements are untouched. No stocktake is re-applied.
- **No repeated merges:** the scripted-merge backup table has the same 8,892 rows before and after. None of the 163 earlier merges or the 1 Oct applications runs again.
- **Sections:** each of the four templates lists its own venue's prepared items only: Avalon bar 7, Avalon kitchen 12, St Alma bar 6, St Alma kitchen 13. Valuation by category shows Batch Cocktails and Kitchen Prep at each venue.
- **No double counting:** counting a batch credits no ingredient. Adding its recipe as a prep line is refused: "Coconut Margarita Batch" is counted as "Coconut Margarita Batch" in Batch Cocktails.
- **Units:** 1 L records 1 L. 1,400 mL records 1.4 L. Half a 2.825 L container records 1.4125 L.
- **Rollback:** after rolling back every step, StockItem, VenueStockItem, StocktakeLine, InventoryMovement, Recipe, RecipeLine, StocktakeTemplate, StockCategory and Stocktake are all byte-identical to production.
- **Read-only dry runs against production:** the merge repair and the case prices both matched the rehearsal with no refusals.
- **Tests:** all three PRs merged together pass 339 of 339 tests.

## Prepared item costs

All 38 items get a complete cost. These are the ones that needed work:

| Item | Cost | What fixed it |
|---|---:|---|
| Sensible Marg Batch | $35.08/L | Case prices (Supasawa, Lyre's) |
| Ginger Spice Batch, both venues | $55.07/L | Genuine: mostly Aguas Mansas tequila at $65.05 a bottle |
| Agave Beef Short Ribs (St Alma) | $24.28/kg | Beef short rib $51.80 → $29.00/kg (FoodByUs), tomato box measure |
| Martajada Sauce | $6.65/kg | Onion bag and tomato box measures (were 100 g placeholders) |
| Pineapple Salsa | $3.52/kg | Same measures, plus Chilli Morita 1 kg |
| Tomatillo Salsa | $7.73/kg | Same measures |
| Coconut Margarita Batch | $55.86/L | Linked its Coconut Washed Tequila/CDC sub-recipe (1,900 mL) |
| Octopus Adobo | $10.12/kg | Linked its Chicken Adobo sub-recipe (500 g) |

The setup script now refuses to book a partial cost. If any ingredient is uncosted, the cost is left blank and the ingredient is named.

**Not created until a yield is set:** Chicken Tinga Empanada ("1 units"), Guacamole ("80 portions") and Mole Verde ("50 portions"). Each needs its batch yield in litres or kilos.

## Worth a look on the shelf (not blocking)

- **Lime Juice at Avalon:** the 1 Oct count was 5.02 on the per-container line, which reads as 25.1 L. If that was 5.02 litres, recount it.
- **Lime Juice at St Alma** (1 container + 3.8 L) and **Onion Powder at Avalon** (1 + 0.5) were counted on two lines on the same sheet. Both were kept as separate stock.
- **Agave Syrup at Avalon:** 3.65 tubs of 4 L.

## Steps

Run from a laptop checkout of `main` after the three PRs are merged. Merging deploys nothing: the stock apps deploy only by hand. Database steps go through the usual SSH tunnel. `DB` stands for the production URL on `localhost:55432`.

**0. Merge** the merge-repair PR, then #324, then #325, into `main`. Check out that commit and build:

```
pnpm install && pnpm --filter @alma/shared build && pnpm --filter @alma/db exec prisma generate && pnpm --filter @alma/db build
```

**1. Back up and verify the backup.** The backup must restore and match production row counts:

```
ssh root@203.57.50.4 'ts=$(date +%Y%m%d-%H%M%S); docker exec deploy-postgres-1 pg_dump -U alma -d alma_suite_v18 -Fc --no-owner --no-acl > /opt/alma/backups/pre-stock-oct17-$ts.dump && ls -l /opt/alma/backups/pre-stock-oct17-$ts.dump'
scp root@203.57.50.4:/opt/alma/backups/pre-stock-oct17-<ts>.dump . && createdb alma_backup_check && pg_restore -d alma_backup_check --no-owner --no-acl pre-stock-oct17-<ts>.dump
# compare row counts of StockItem, VenueStockItem, StocktakeLine, InventoryMovement, Recipe, RecipeLine with production
```

**2. Migration.** This adds one nullable column and two categories, nothing else:

```
DATABASE_URL=$DB pnpm --filter @alma/db exec prisma migrate deploy
```

**3. Merge repair.** Run the dry run first. It must say "Every row matches what was reviewed":

```
DATABASE_URL=$DB tsx apps/stock-api/scripts/repair-app-merges-2026-10.ts
DATABASE_URL=$DB tsx apps/stock-api/scripts/repair-app-merges-2026-10.ts --apply --i-mean-production --run-id prod-merge-repair-20261017
```

Expected: Avalon $39,789.36 and St Alma $63,223.51.

**4. Case prices:**

```
DATABASE_URL=$DB tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes docs/stock-case-price-fix-2026-10/case-price-fixes.json
DATABASE_URL=$DB tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes docs/stock-case-price-fix-2026-10/case-price-fixes.json --apply --i-mean-production --run-id prod-case-prices-20261017
```

Expected: Avalon $31,154.50 and St Alma $58,739.31.

**5. Ingredient measures.** This changes recipe costs only, not stock value:

```
DATABASE_URL=$DB tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes docs/stock-prepared-sections-2026-10/ingredient-measures.json --apply --i-mean-production --run-id prod-measures-20261017
```

**6. Recipe links:**

```
DATABASE_URL=$DB tsx apps/stock-api/scripts/create-prepared-stock-items-2026-10.ts --links docs/stock-prepared-sections-2026-10/recipe-line-links.json
DATABASE_URL=$DB tsx apps/stock-api/scripts/create-prepared-stock-items-2026-10.ts --links docs/stock-prepared-sections-2026-10/recipe-line-links.json --apply-links --i-mean-production --run-id prod-links-20261017
```

**7. Prepared items.** Review the dry run: 38 ready, with the 3 yield-less recipes skipped. Then apply:

```
DATABASE_URL=$DB tsx apps/stock-api/scripts/create-prepared-stock-items-2026-10.ts
DATABASE_URL=$DB tsx apps/stock-api/scripts/create-prepared-stock-items-2026-10.ts --apply --i-mean-production --run-id prod-prepared-20261017
```

**8. Deploy** stock-api (rsync to `/opt/alma/alma-suite`, then `docker compose build stock-api && up -d stock-api`) and stock-web (Firebase). Check `/health` and the site's `/version.json`.

**9. Smoke test in the app:**
- Start a St Alma bar count from its template. Batch Cocktails shows as its own section with the unit picker.
- Enter 2,500 mL on a batch. It saves as 2.5 L with the right value.
- Print the blank sheet and export Excel. Both sections appear, with "1 container = X L".
- Valuation report: totals match step 4, and both sections are listed.
- Then discard the smoke-test count.

## Rollback

Undo in reverse order. Each step can be undone on its own:

```
tsx apps/stock-api/scripts/create-prepared-stock-items-2026-10.ts --rollback prod-prepared-20261017 --i-mean-production   # refused once items are counted, unless --force
tsx apps/stock-api/scripts/create-prepared-stock-items-2026-10.ts --rollback prod-links-20261017 --i-mean-production
tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes docs/stock-prepared-sections-2026-10/ingredient-measures.json --rollback prod-measures-20261017 --i-mean-production
tsx apps/stock-api/scripts/fix-unit-entries-2026-10.ts --fixes docs/stock-case-price-fix-2026-10/case-price-fixes.json --rollback prod-case-prices-20261017 --i-mean-production
tsx apps/stock-api/scripts/repair-app-merges-2026-10.ts --rollback prod-merge-repair-20261017 --i-mean-production
```

To roll back the code, redeploy image `release-d2ffa0e` and Firebase `alma-stock-v18` at `d2ffa0ef`. The migration's column is nullable and harmless to leave in place. The last resort is restoring the step 1 dump.

## Follow-ups (not in these PRs)

- The app's Items → Duplicates merge still adds holdings and same-sheet lines together. It should repoint history and ask which holding is real, as the scripted merges do.
- Most case-priced records still buy by the bottle. Setting their purchase unit to the case stops a case invoice writing the case price back.
