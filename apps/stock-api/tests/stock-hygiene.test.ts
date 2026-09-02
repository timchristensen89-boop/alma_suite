import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@alma/db';
import { STOCKTAKE_PREP_AREA } from '@alma/shared';
import { itemsService } from '../src/services/items.service.js';
import { stocktakesService } from '../src/services/stocktakes.service.js';
import { stocktakeTemplatesService } from '../src/services/stocktake-templates.service.js';

// Real rows, same convention as stocktakes.service.test.ts: skip without a
// database, unique suffix per case, cleanup children before parents.
const NO_DB = { skip: !process.env.DATABASE_URL };

function suffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function cleanup(ids: { stocktakeIds?: string[]; itemIds?: string[]; supplierIds?: string[]; templateIds?: string[]; recipeIds?: string[] }) {
  if (ids.stocktakeIds?.length) {
    await prisma.inventoryMovement.deleteMany({ where: { sourceStocktakeId: { in: ids.stocktakeIds } } });
    await prisma.stocktake.deleteMany({ where: { id: { in: ids.stocktakeIds } } });
  }
  if (ids.templateIds?.length) await prisma.stocktakeTemplate.deleteMany({ where: { id: { in: ids.templateIds } } });
  if (ids.recipeIds?.length) await prisma.recipe.deleteMany({ where: { id: { in: ids.recipeIds } } });
  if (ids.itemIds?.length) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids.itemIds } } });
    await prisma.stockItem.deleteMany({ where: { id: { in: ids.itemIds } } });
  }
  if (ids.supplierIds?.length) {
    await prisma.supplierInvoice.deleteMany({ where: { supplierId: { in: ids.supplierIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: ids.supplierIds } } });
  }
}

test('merging repoints every reference, folds same-count lines, sums venue stock and backfills the keeper', NO_DB, async () => {
  const tag = suffix('merge');
  const keep = await prisma.stockItem.create({
    data: { name: `Beef short rib ${tag}`, unit: 'kg', onHand: 22, parLevel: 0, status: 'ACTIVE', venueStock: { create: { venue: 'St Alma', onHand: 22 } } }
  });
  const dup = await prisma.stockItem.create({
    data: {
      name: `Beef Short Ribs ${tag}`, sku: `SKU-${tag}`, unit: 'kg', countUnit: 'kg', countArea: 'Kitchen', latestCostCents: 2400,
      latestCostAt: new Date(), onHand: 9, parLevel: 4, status: 'ACTIVE',
      venueStock: { create: [{ venue: 'St Alma', onHand: 4 }, { venue: 'Alma Avalon', onHand: 5 }] }
    }
  });
  const supplier = await prisma.supplier.create({ data: { name: `FoodByUs ${tag}` } });
  const invoice = await prisma.supplierInvoice.create({ data: { invoiceKey: `inv-${tag}`, supplierId: supplier.id, supplierName: supplier.name } });
  await prisma.supplierInvoiceLine.create({ data: { supplierInvoiceId: invoice.id, lineNumber: 1, lineKey: 'l1', description: 'BEEF SHORT RIBS', itemId: dup.id } });
  // Same alias key on both: the keeper's row must survive, the duplicate's go.
  // (aliasKey, NULL supplier) is the one shape the unique index lets exist twice.
  await prisma.stockItemAlias.create({ data: { aliasKey: `beef short ribs ${tag}`, supplierId: null, stockItemId: keep.id, sourceText: 'x' } });
  await prisma.stockItemAlias.create({ data: { aliasKey: `beef short ribs ${tag}`, supplierId: null, stockItemId: dup.id, sourceText: 'y' } });
  await prisma.stockItemAlias.create({ data: { aliasKey: `beef rib ${tag}`, supplierId: supplier.id, stockItemId: dup.id, sourceText: 'z' } });
  await prisma.supplierPriceListItem.create({ data: { supplierId: supplier.id, stockItemId: keep.id, description: 'keeper price', unitCostCents: 2400 } });
  await prisma.supplierPriceListItem.create({ data: { supplierId: supplier.id, stockItemId: dup.id, description: 'dup price', unitCostCents: 2450 } });
  const recipe = await prisma.recipe.create({ data: { title: `Birria ${tag}`, isPrepRecipe: true, lines: { create: { ingredientName: 'ribs', quantity: 4, unit: 'kg', itemId: dup.id } } } });
  // One count that lists BOTH rows for the same shelf.
  const stocktake = await stocktakesService.createStocktake({
    name: `Count ${tag}`, venue: 'St Alma', countedAt: new Date().toISOString(),
    lines: [
      { itemId: keep.id, label: keep.name, countedQty: 20, unit: 'kg' },
      { itemId: dup.id, label: dup.name, countedQty: 4, unit: 'kg', notes: 'back fridge' }
    ]
  });
  const dupLine = stocktake.lines.find((line) => line.itemId === dup.id)!;
  await prisma.inventoryMovement.create({ data: { itemId: dup.id, movementType: 'WASTAGE', quantityDelta: -1, quantityBefore: 5, quantityAfter: 4, sourceStocktakeLineId: dupLine.id } });

  try {
    const result = await itemsService.mergeItems({ parentId: keep.id, duplicateIds: [dup.id], confirmationText: 'MERGE ITEMS' });
    assert.equal(result.mergedCount, 1);
    assert.deepEqual(result.venuesAdded, ['Alma Avalon']);
    assert.equal(result.moved.aliases, 2);
    assert.equal(result.moved.priceListItems, 1);
    assert.equal(result.moved.invoiceLines, 1);
    assert.equal(result.moved.recipeLines, 1);
    assert.equal(result.moved.stocktakeLines, 1);

    const keeper = await prisma.stockItem.findUniqueOrThrow({ where: { id: keep.id }, include: { aliases: true, priceListItems: true, venueStock: { orderBy: { venue: 'asc' } } } });
    assert.equal(keeper.sku, `SKU-${tag}`, 'sku backfilled onto the keeper');
    assert.equal(keeper.countUnit, 'kg');
    assert.equal(keeper.countArea, 'Kitchen');
    assert.equal(keeper.latestCostCents, 2400);
    assert.equal(keeper.parLevel, 4);
    assert.deepEqual(keeper.venueStock.map((row) => [row.venue, row.onHand]), [['Alma Avalon', 5], ['St Alma', 26]]);
    assert.equal(keeper.onHand, 31);
    assert.equal(keeper.aliases.length, 2, 'colliding alias dropped, the other repointed');
    assert.equal(keeper.aliases.every((alias) => alias.stockItemId === keep.id), true);
    assert.equal(keeper.priceListItems.length, 1, 'keeper kept its own supplier price');
    assert.equal(keeper.priceListItems[0]?.description, 'keeper price');

    const archived = await prisma.stockItem.findUniqueOrThrow({ where: { id: dup.id }, include: { aliases: true, priceListItems: true, venueStock: true, invoiceLines: true, recipeLines: true, stocktakeLines: true } });
    assert.equal(archived.status, 'ARCHIVED');
    assert.equal(archived.sku, null);
    assert.match(archived.notes ?? '', /Merged into/);
    assert.equal(archived.aliases.length + archived.priceListItems.length + archived.venueStock.length + archived.invoiceLines.length + archived.recipeLines.length + archived.stocktakeLines.length, 0);

    // The count now has ONE line for the shelf, summed, with the note kept and
    // the ledger row re-anchored to it.
    const lines = await prisma.stocktakeLine.findMany({ where: { stocktakeId: stocktake.id } });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.itemId, keep.id);
    assert.equal(lines[0]?.countedQty, 24);
    assert.equal(lines[0]?.notes, 'back fridge');
    const movement = await prisma.inventoryMovement.findFirst({ where: { itemId: keep.id, movementType: 'WASTAGE' } });
    assert.equal(movement?.sourceStocktakeLineId, lines[0]?.id);

    // Merged rows disappear from the duplicate report.
    const report = await itemsService.duplicates();
    assert.equal(report.groups.some((group) => group.items.some((item) => item.id === dup.id)), false);
  } finally {
    await cleanup({ stocktakeIds: [stocktake.id], recipeIds: [recipe.id], itemIds: [keep.id, dup.id], supplierIds: [supplier.id] });
  }
});

test('a venue-pinned manager cannot merge the shared catalogue', NO_DB, async () => {
  await assert.rejects(
    () => itemsService.mergeItems(
      { parentId: 'a', duplicateIds: ['b'], confirmationText: 'MERGE ITEMS' },
      { id: 'u1', role: 'MANAGER', isAdmin: false, venue: 'St Alma' } as never
    ),
    /every venue/
  );
});

test('deleting an item with only cascade-side history is refused', NO_DB, async () => {
  const tag = suffix('delete');
  const item = await prisma.stockItem.create({ data: { name: `Waste ${tag}`, unit: 'kg', onHand: 0, parLevel: 0 } });
  await prisma.stockWastageRecord.create({ data: { stockItemId: item.id, venue: 'St Alma', quantity: 1, unit: 'kg', reason: 'Spoiled' } });
  try {
    await assert.rejects(
      () => itemsService.deleteItems({ ids: [item.id], confirmationText: 'DELETE ITEMS' }),
      /wastage/
    );
    assert.equal(await prisma.stockItem.count({ where: { id: item.id } }), 1);
  } finally {
    await prisma.stockWastageRecord.deleteMany({ where: { stockItemId: item.id } });
    await cleanup({ itemIds: [item.id] });
  }
});

test('a save built on a stale copy of the count is refused instead of overwriting', NO_DB, async () => {
  const tag = suffix('stale');
  const item = await prisma.stockItem.create({ data: { name: `Limes ${tag}`, unit: 'kg', onHand: 0, parLevel: 0 } });
  const stocktake = await stocktakesService.createStocktake({
    name: `Stale ${tag}`, countedAt: new Date().toISOString(),
    lines: [{ itemId: item.id, label: item.name, countedQty: null, unit: 'kg' }]
  });
  try {
    const loadedAt = stocktake.updatedAt;
    // First iPad saves fine.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const first = await stocktakesService.updateStocktake(stocktake.id, {
      expectedUpdatedAt: loadedAt,
      lines: [{ id: stocktake.lines[0]!.id, itemId: item.id, label: item.name, countedQty: 3, unit: 'kg' }]
    });
    assert.equal(first.lines[0]?.countedQty, 3);
    // Second iPad, still holding the original copy, is stopped.
    await assert.rejects(
      () => stocktakesService.updateStocktake(stocktake.id, {
        expectedUpdatedAt: loadedAt,
        lines: [{ id: stocktake.lines[0]!.id, itemId: item.id, label: item.name, countedQty: 99, unit: 'kg' }]
      }),
      /saved this count/
    );
    const kept = await prisma.stocktakeLine.findUniqueOrThrow({ where: { id: stocktake.lines[0]!.id } });
    assert.equal(kept.countedQty, 3);
    // A client that does not send the guard is unchanged.
    const legacy = await stocktakesService.updateStocktake(stocktake.id, {
      lines: [{ itemId: item.id, label: item.name, countedQty: 5, unit: 'kg' }]
    });
    assert.equal(legacy.lines[0]?.countedQty, 5);
  } finally {
    await cleanup({ stocktakeIds: [stocktake.id], itemIds: [item.id] });
  }
});

test('lines saved with their ids keep those ids, and an omitted quantity reads as not counted', NO_DB, async () => {
  const tag = suffix('inplace');
  const a = await prisma.stockItem.create({ data: { name: `A ${tag}`, unit: 'ea', onHand: 0, parLevel: 0 } });
  const b = await prisma.stockItem.create({ data: { name: `B ${tag}`, unit: 'ea', onHand: 0, parLevel: 0 } });
  const stocktake = await stocktakesService.createStocktake({
    name: `Inplace ${tag}`, countedAt: new Date().toISOString(),
    lines: [{ itemId: a.id, label: a.name, unit: 'ea' }, { itemId: b.id, label: b.name, countedQty: '', unit: 'ea' }] as never
  });
  try {
    assert.deepEqual(stocktake.lines.map((line) => line.countedQty), [null, null]);
    const [lineA, lineB] = stocktake.lines;
    const saved = await stocktakesService.updateStocktake(stocktake.id, {
      lines: [
        { id: lineA!.id, itemId: a.id, label: a.name, countedQty: 2, unit: 'ea' },
        { id: lineB!.id, itemId: b.id, label: b.name, countedQty: null, unit: 'ea' },
        { itemId: '', label: 'Hand-written extra', countedQty: 1, unit: 'ea' }
      ]
    });
    assert.deepEqual(saved.lines.slice(0, 2).map((line) => line.id), [lineA!.id, lineB!.id]);
    assert.equal(saved.lines.length, 3);
    // Dropping a line from the payload removes it; the others keep their ids.
    const trimmed = await stocktakesService.updateStocktake(stocktake.id, {
      lines: [{ id: lineB!.id, itemId: b.id, label: b.name, countedQty: 7, unit: 'ea' }]
    });
    assert.deepEqual(trimmed.lines.map((line) => [line.id, line.countedQty]), [[lineB!.id, 7]]);
  } finally {
    await cleanup({ stocktakeIds: [stocktake.id], itemIds: [a.id, b.id] });
  }
});

test('a reopened count can be submitted again, and reopening does not record a review', NO_DB, async () => {
  const tag = suffix('reopen');
  const item = await prisma.stockItem.create({ data: { name: `R ${tag}`, unit: 'ea', onHand: 0, parLevel: 0 } });
  const stocktake = await stocktakesService.createStocktake({
    name: `Reopen ${tag}`, countedAt: new Date().toISOString(), status: 'SUBMITTED',
    lines: [{ itemId: item.id, label: item.name, countedQty: 1, unit: 'ea' }]
  });
  try {
    const reopened = await stocktakesService.reopenStocktake(stocktake.id);
    assert.equal(reopened.status, 'IN_PROGRESS');
    assert.equal(reopened.reviewedAt, null);
    await prisma.stocktake.update({ where: { id: stocktake.id }, data: { status: 'REOPENED' } });
    const submitted = await stocktakesService.submitStocktake(stocktake.id);
    assert.equal(submitted.status, 'SUBMITTED');
  } finally {
    await cleanup({ stocktakeIds: [stocktake.id], itemIds: [item.id] });
  }
});

test('the count sheet walks by area, hides expected quantities when blind, and prints prep last', NO_DB, async () => {
  const tag = suffix('sheet');
  const bar = await prisma.stockItem.create({ data: { name: `Corona ${tag}`, unit: 'case', countUnit: 'bottle', conversionFactor: 24, countArea: 'Bar', onHand: 40, parLevel: 24, venueStock: { create: { venue: 'St Alma', onHand: 30 } } } });
  const cool = await prisma.stockItem.create({ data: { name: `Limes ${tag}`, unit: 'kg', countArea: 'Cool room', onHand: 8, parLevel: 5 } });
  const recipe = await prisma.recipe.create({ data: { title: `Birria ${tag}`, isPrepRecipe: true, yieldQuantity: 6, yieldUnit: 'kg' } });
  const stocktake = await stocktakesService.createStocktake({
    name: `Sheet ${tag}`, venue: 'St Alma', countedAt: new Date().toISOString(),
    lines: [
      { recipeId: recipe.id, label: recipe.title, unit: 'kg', location: STOCKTAKE_PREP_AREA },
      { itemId: cool.id, label: cool.name, unit: 'kg', location: 'Cool room' },
      { itemId: bar.id, label: bar.name, unit: 'bottle', location: 'Bar' }
    ]
  });
  const template = await prisma.stocktakeTemplate.create({ data: { name: `Tpl ${tag}`, venue: 'St Alma', includeItemIds: [bar.id, cool.id], countAreas: ['__none__'], blindDefault: false, prepRecipeIds: [recipe.id] } });
  try {
    const blind = await stocktakesService.countSheet(stocktake.id, null);
    assert.equal(blind.blind, true);
    assert.deepEqual(blind.sections.map((section) => section.area), ['Cool room', 'Bar', STOCKTAKE_PREP_AREA]);
    assert.equal(blind.sections.every((section) => section.rows.every((row) => row.expectedQty === null)), true);
    const barRow = blind.sections[1]!.rows[0]!;
    assert.equal(barRow.purchaseUnit, 'case');
    assert.equal(barRow.conversionFactor, 24);
    assert.equal(barRow.unit, 'bottle');

    const open = await stocktakesService.countSheet(stocktake.id, null, { blind: false });
    assert.equal(open.sections[1]!.rows[0]!.expectedQty, 30, 'venue on-hand, not the group total');

    const fromTemplate = await stocktakeTemplatesService.countSheet(template.id, null);
    assert.equal(fromTemplate.source, 'template');
    assert.equal(fromTemplate.blind, false);
    assert.deepEqual(fromTemplate.sections.map((section) => section.area), ['Bar', 'Cool room', STOCKTAKE_PREP_AREA]);
    assert.equal(fromTemplate.sections[0]!.rows[0]!.expectedQty, 30);
    assert.equal(fromTemplate.sections[2]!.rows[0]!.kind, 'PREPPED_ITEM');
  } finally {
    await cleanup({ stocktakeIds: [stocktake.id], templateIds: [template.id], recipeIds: [recipe.id], itemIds: [bar.id, cool.id] });
  }
});
