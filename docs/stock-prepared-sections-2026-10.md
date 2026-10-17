# Batch Cocktails & Kitchen Prep in Alma Stock (Oct 2026)

Branch `feat/stock-batches-and-prep`. Built and tested on local copies of production only. Nothing here has touched production.

## Design

A batch or a prep item is an ordinary **stock item** in one of two new categories, **Batch Cocktails** and **Kitchen Prep**. Because they are stock items, every existing surface picks them up with no separate app: item lists, the count screen, templates, printed blank sheets, Excel exports, valuation reports and history.

| Field | How it is stored |
| --- | --- |
| Counting unit | `countUnit` = `L` or `kg` |
| Container | `unit` = `container`, `conversionFactor` = container size in L or kg |
| Cost | `avgCostCents` = cost per litre or per kilo |
| Venue | normal per-venue holdings (`VenueStockItem`) |
| Recipe | optional `prepRecipeId` link to the prep recipe it is made from |

The only schema change is that one nullable column (plus its index and foreign key) and the two category rows. Migration: `20261017090000_prepared_stock_sections`.

### Counting

Staff see **Item | Quantity | Unit | Value**. On prepared rows the unit picker offers the count unit, its metric sibling and the container, for example `L`, `mL`, `container (5 L)`. The system converts on save:

- 2.5 L records 2.5 L.
- 2500 mL records 2.5 L.
- 0.5 container of a 5 L container records 2.5 L.
- 1300 g of Salsa Verde records 1.3 kg.

Value is quantity × cost per litre or kilo. Autosave, search and editing during a count work as for every other item.

### Recipe linkage without double counting

- The item drawer shows "Made from recipe" and a suggested cost per litre or kilo, worked out from the recipe's ingredient costs ÷ its yield. A manager applies it with "Use recipe cost". It is never applied automatically.
- Counting a batch **never deducts or credits ingredients**.
- A recipe that has its own stock item is removed from the old "prepped item" picker. Adding it as a prep line is refused with a message pointing to the item.
- Applying a stocktake that has both a prep line and the linked item for the same recipe is refused, so the same batch can never be counted twice.

### Templates

The setup script adds Batch Cocktails to bar templates and Kitchen Prep to kitchen templates. A template only includes prepared items whose recipe belongs to the template's venue.

## Setup script

`apps/stock-api/scripts/create-prepared-stock-items-2026-10.ts` creates one item per active prep recipe.

- Dry run by default. `--apply` writes. `--rollback <runId>` removes the items and restores the templates. Every change is recorded in `_stock_prepared_items_backup`.
- Bar items are recipes whose names look like batches, syrups, cordials, shrubs or infusions. The rest go to Kitchen Prep.
- Container size = recipe yield. Cost = recipe cost ÷ yield, left blank and flagged when it looks inflated.
- Production needs `--i-mean-production`.

Rehearsal on a 17 Oct production copy: 38 items created, then rolled back. Items, templates and venue holdings were byte-identical afterwards.

### Needs a decision before or after setup

Three recipes have no litre or kilo yield and are skipped until one is set:

- Chicken Tinga Empanada (yield "1 units")
- Guacamole (yield "80 portions")
- Mole Verde (yield "50 portions")

Seven items get a blank cost because their recipe cost looks wrong. The usual causes are case prices entered as unit prices and the 100 g placeholder measures:

- Ginger Spice Batch, both venues ($131.87/L)
- Sensible Marg Batch ($187.20/L)
- Agave Beef Short Ribs ($70.63/kg)
- Martajada Sauce ($550.84/kg)
- Pineapple Salsa ($166.55/kg)
- Tomatillo Salsa ($128.41/kg)

Managers can type a cost, or press "Use recipe cost" once the ingredient fixes land.

## Production order (each step needs Tim's approval)

1. Take a database backup.
2. Run the migration (adds the column and the two categories, nothing else).
3. Land the case-price corrections and placeholder-measure fixes, so recipe costs are right.
4. Run the setup script as a dry run on production, review, then `--apply --i-mean-production`.
5. Deploy stock-api and stock-web.
6. Smoke test: open a bar count and a kitchen count, enter 2.5 L and 1300 g, check values, print a blank sheet, export Excel.

Rollback: `--rollback <runId>` removes the created items (refused if any were counted), then redeploy the previous images. The migration's column is nullable and harmless to leave in place.

## Tests

`apps/stock-api/tests/prepared-stock.test.ts` covers section order, unit conversions and valuation, the recipe cost suggestion and both double-count guards. Full API suite: 337 of 337 pass.
