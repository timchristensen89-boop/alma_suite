import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@alma/db';
import { stocktakesService } from '../src/services/stocktakes.service.js';
import { applyUnitFix, ensureUnitFixBackupTable, planUnitFix, rollbackUnitFix, type UnitFixFile } from '../scripts/lib/unit-fix.js';

/**
 * The unit fix must be undoable exactly, must refuse a target that has changed
 * since review, and — with the apply guard — a sheet with a millilitre line on
 * a bottle item must not be appliable until it is restated.
 */
const NO_DB = { skip: !process.env.DATABASE_URL };

async function buildFixture(tag: string) {
  const gin = await prisma.stockItem.create({
    data: { name: `Bulk Gin ${tag}`, unit: 'bottle', countUnit: 'bottle', conversionFactor: 1, measurePerCountUnit: 750, measureUnit: 'ml', avgCostCents: 4500, onHand: 19400, parLevel: 0, status: 'ACTIVE', venueStock: { create: [{ venue: 'St Alma', onHand: 19400, active: true }] } }
  });
  const nuts = await prisma.stockItem.create({
    data: { name: `Pistachio ${tag}`, unit: 'each', countUnit: 'each', conversionFactor: 1, measurePerCountUnit: 100, measureUnit: 'g', avgCostCents: 4468, onHand: 0, parLevel: 0, status: 'ACTIVE' }
  });
  // The applied count that wrote 19 400 mL as 19 400 bottles…
  const old = await prisma.stocktake.create({
    data: { name: `Bar 31/08 ${tag}`, venue: 'St Alma', countedAt: new Date('2026-08-31'), status: 'REVIEWED', appliedAt: new Date('2026-09-01'), lines: { create: [{ position: 1, label: gin.name, itemId: gin.id, countedQty: 19400, unit: 'mL', stockValueCents: 116400 }] } },
    include: { lines: true }
  });
  const source = await prisma.inventoryMovement.create({
    data: { itemId: gin.id, movementType: 'STOCKTAKE_ADJUSTMENT', quantityBefore: 20, quantityAfter: 19400, quantityDelta: 19380, unit: 'mL', sourceStocktakeId: old.id, sourceStocktakeLineId: old.lines[0]!.id, notes: `Applied stocktake: ${old.name} · Venue: St Alma`, createdAt: new Date('2026-09-01T01:00:00Z') }
  });
  // …and the unapplied count with the same mistake waiting to happen.
  const latest = await prisma.stocktake.create({
    data: {
      name: `Bar 01/10 ${tag}`, venue: 'St Alma', countedAt: new Date('2026-10-01'), status: 'SUBMITTED',
      lines: { create: [
        { position: 1, label: gin.name, itemId: gin.id, countedQty: 8300, unit: 'ml', stockValueCents: 49800 },
        { position: 2, label: nuts.name, itemId: nuts.id, countedQty: 970, unit: 'g', stockValueCents: 43340 }
      ] }
    },
    include: { lines: true }
  });
  const file: UnitFixFile = {
    sheets: { 'St Alma': latest.id },
    measures: [{ itemId: nuts.id, item: nuts.name, from: { measurePerCountUnit: 100, measureUnit: 'g' }, to: { measurePerCountUnit: 1000, measureUnit: 'g' }, reason: 'costed per kilo' }],
    lines: [
      { action: 'restate', confidence: 'high', venue: 'St Alma', item: gin.name, itemId: gin.id, lineId: latest.lines[0]!.id, from: { countedQty: 8300, unit: 'ml' }, to: { countedQty: 11.0667, unit: 'bottle' }, reason: 'mL ÷ 750' },
      { action: 'restate', confidence: 'high', venue: 'St Alma', item: nuts.name, itemId: nuts.id, lineId: latest.lines[1]!.id, from: { countedQty: 970, unit: 'g' }, to: { countedQty: 0.97, unit: 'each' }, reason: '970 g of a 1 kg bag' }
    ],
    holdings: [{
      confidence: 'high', venue: 'St Alma', item: gin.name, itemId: gin.id,
      holdingId: (await prisma.venueStockItem.findFirstOrThrow({ where: { stockItemId: gin.id, venue: 'St Alma' } })).id,
      from: { onHand: 19400 }, to: { onHand: 25.8667 }, sourceStocktakeId: old.id, sourceStocktakeLineId: old.lines[0]!.id, sourceMovementId: source.id,
      sourceLine: { countedQty: 19400, unit: 'mL' }, reason: 'mL entered as bottles'
    }]
  };
  const ids = [gin.id, nuts.id];
  async function snapshot() {
    const [items, venueStock, lines, movements] = await Promise.all([
      prisma.stockItem.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.venueStockItem.findMany({ where: { stockItemId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.stocktakeLine.findMany({ where: { itemId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.inventoryMovement.findMany({ where: { itemId: { in: ids } }, orderBy: { id: 'asc' } })
    ]);
    return { items, venueStock, lines, movements };
  }
  async function cleanup() {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.stocktake.deleteMany({ where: { id: { in: [old.id, latest.id] } } });
    await prisma.venueStockItem.deleteMany({ where: { stockItemId: { in: ids } } });
    await prisma.stockItem.deleteMany({ where: { id: { in: ids } } });
  }
  return { gin, nuts, old, latest, file, snapshot, cleanup };
}

test('a mL line on a bottle item cannot be applied until it is restated', NO_DB, async () => {
  const f = await buildFixture(`guard-${process.pid}`);
  try {
    await assert.rejects(stocktakesService.applyStocktake(f.latest.id, null), (error: { statusCode?: number; message: string }) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /2 lines can't be applied yet/);
      return true;
    });
    // Nothing was written by the refused apply.
    const sheet = await prisma.stocktake.findUniqueOrThrow({ where: { id: f.latest.id } });
    assert.equal(sheet.appliedAt, null);
    assert.equal(sheet.status, 'SUBMITTED');

    const plan = await planUnitFix(f.file);
    assert.deepEqual(plan.refusals, []);
    await ensureUnitFixBackupTable();
    await applyUnitFix(`test-guard-${process.pid}`, plan);
    const applied = await stocktakesService.applyStocktake(f.latest.id, null);
    assert.equal(applied.movements.length, 2);
    const gin = await prisma.venueStockItem.findFirstOrThrow({ where: { stockItemId: f.gin.id, venue: 'St Alma' } });
    assert.equal(gin.onHand, 11.0667);
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM "_stock_unit_fix_backup" WHERE "runId" = $1`, `test-guard-${process.pid}`).catch(() => {});
    await f.cleanup();
  }
});

test('the unit fix restates lines and holdings, records a correction, and rolls back exactly', NO_DB, async () => {
  const f = await buildFixture(`fix-${process.pid}`);
  const runId = `test-fix-${process.pid}`;
  try {
    const before = await f.snapshot();
    const plan = await planUnitFix(f.file);
    assert.deepEqual(plan.refusals, []);
    assert.equal(plan.lines[0]!.rawApplyCents, 8300 * 4500);
    await ensureUnitFixBackupTable();
    const { movementIds } = await applyUnitFix(runId, plan);

    const lines = await prisma.stocktakeLine.findMany({ where: { stocktakeId: f.latest.id }, orderBy: { position: 'asc' } });
    assert.deepEqual(lines.map((l) => [l.countedQty, l.unit, l.stockValueCents]), [[11.0667, 'bottle', 49800], [0.97, 'each', 4334]]);
    assert.match(lines[0]!.notes ?? '', /was 8300 ml, now 11\.0667 bottle/);
    const holding = await prisma.venueStockItem.findFirstOrThrow({ where: { stockItemId: f.gin.id, venue: 'St Alma' } });
    assert.equal(holding.onHand, 25.8667);
    assert.equal((await prisma.stockItem.findUniqueOrThrow({ where: { id: f.gin.id } })).onHand, 25.8667);
    assert.equal((await prisma.stockItem.findUniqueOrThrow({ where: { id: f.nuts.id } })).measurePerCountUnit, 1000);
    const correction = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: movementIds[0]! } });
    assert.equal(correction.movementType, 'STOCKTAKE_CORRECTION');
    assert.equal(correction.sourceStocktakeLineId, f.old.lines[0]!.id);
    assert.equal(correction.quantityBefore, 19400);
    assert.equal(correction.quantityAfter, 25.8667);
    // The history that wrote the bad number is untouched.
    const oldLine = await prisma.stocktakeLine.findUniqueOrThrow({ where: { id: f.old.lines[0]!.id } });
    assert.deepEqual([oldLine.countedQty, oldLine.unit], [19400, 'mL']);

    // A second plan against the fixed data refuses: nothing looks as reviewed.
    const again = await planUnitFix(f.file);
    assert.equal(again.refusals.length, 4);

    await rollbackUnitFix(runId);
    assert.deepEqual(await f.snapshot(), before);
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM "_stock_unit_fix_backup" WHERE "runId" = $1`, runId).catch(() => {});
    await f.cleanup();
  }
});

test('rollback refuses when a restated row was edited after the fix', NO_DB, async () => {
  const f = await buildFixture(`edit-${process.pid}`);
  const runId = `test-edit-${process.pid}`;
  try {
    await ensureUnitFixBackupTable();
    await applyUnitFix(runId, await planUnitFix(f.file));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await prisma.stocktakeLine.update({ where: { id: f.latest.lines[1]!.id }, data: { countedQty: 1 } });
    await assert.rejects(rollbackUnitFix(runId), /edited since/);
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM "_stock_unit_fix_backup" WHERE "runId" = $1`, runId).catch(() => {});
    await f.cleanup();
  }
});

test('a case-price correction lowers only the average cost, leaves history alone, and rolls back exactly', NO_DB, async () => {
  const tag = `cost-${process.pid}-${Date.now()}`;
  const runId = `test-${tag}`;
  const item = await prisma.stockItem.create({
    data: {
      name: `Lyres Agave ${tag}`, unit: 'bottle', countUnit: 'bottle', conversionFactor: 1, measurePerCountUnit: 700, measureUnit: 'ml',
      avgCostCents: 21114, latestCostCents: 21114, onHand: 7, parLevel: 0, status: 'ACTIVE',
      venueStock: { create: [{ venue: 'Alma Avalon', onHand: 1, active: true }, { venue: 'St Alma', onHand: 6, active: true }] }
    }
  });
  const sheet = await prisma.stocktake.create({
    data: { name: `Old count ${tag}`, venue: 'St Alma', countedAt: new Date('2026-08-31'), status: 'REVIEWED', appliedAt: new Date('2026-09-01'),
      lines: { create: [{ position: 1, label: item.name, itemId: item.id, countedQty: 6, unit: 'bottle', stockValueCents: 126684 }] } }
  });
  const snapshot = async () => ({
    item: await prisma.stockItem.findUniqueOrThrow({ where: { id: item.id } }),
    venues: await prisma.venueStockItem.findMany({ where: { stockItemId: item.id }, orderBy: { id: 'asc' } }),
    lines: await prisma.stocktakeLine.findMany({ where: { itemId: item.id }, orderBy: { id: 'asc' } })
  });
  const file: UnitFixFile = { costs: [{ confidence: 'high', itemId: item.id, item: item.name, from: { avgCostCents: 21114 }, to: { avgCostCents: 3519 }, reason: '6 × $35.19' }] };
  try {
    const before = await snapshot();
    const plan = await planUnitFix(file);
    assert.deepEqual(plan.refusals, []);
    assert.deepEqual(plan.costs[0]!.holdings.map((h) => [h.venue, h.beforeCents, h.afterCents]).sort(), [['Alma Avalon', 21114, 3519], ['St Alma', 126684, 21114]]);
    await ensureUnitFixBackupTable();
    await applyUnitFix(runId, plan);

    const after = await snapshot();
    assert.equal(after.item.avgCostCents, 3519);
    assert.equal(after.item.latestCostCents, 21114, 'the latest purchase price is not touched');
    assert.deepEqual(after.venues.map((v) => v.onHand), before.venues.map((v) => v.onHand), 'holdings are not touched');
    assert.deepEqual(after.lines, before.lines, 'stocktake history keeps the value it was recorded with');

    // Reviewed against a cost that has since changed: refused, nothing written.
    const stale = await planUnitFix(file);
    assert.equal(stale.refusals.length, 1);
    assert.match(stale.refusals[0]!, /now \$35\.19, reviewed as \$211\.14/);

    await rollbackUnitFix(runId);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM "_stock_unit_fix_backup" WHERE "runId" = $1`, runId).catch(() => {});
    await prisma.stocktake.deleteMany({ where: { id: sheet.id } });
    await prisma.venueStockItem.deleteMany({ where: { stockItemId: item.id } });
    await prisma.stockItem.deleteMany({ where: { id: item.id } });
  }
});

test('a cost correction that would raise the cost is refused', NO_DB, async () => {
  const item = await prisma.stockItem.create({ data: { name: `Raise ${process.pid}-${Date.now()}`, unit: 'bottle', countUnit: 'bottle', avgCostCents: 1000, onHand: 0, parLevel: 0, status: 'ACTIVE' } });
  try {
    const plan = await planUnitFix({ costs: [{ itemId: item.id, item: item.name, from: { avgCostCents: 1000 }, to: { avgCostCents: 6000 }, reason: 'wrong way' }] });
    assert.equal(plan.costs.length, 0);
    assert.match(plan.refusals[0]!, /must lower the cost/);
    // A supplier-price rise goes through only when someone has put their name to it.
    const approved = await planUnitFix({ costs: [{ itemId: item.id, item: item.name, from: { avgCostCents: 1000 }, to: { avgCostCents: 6000 }, reason: 'supplier price', approvedIncrease: 'Owner, 18 Oct 2026' }] });
    assert.equal(approved.refusals.length, 0);
    assert.equal(approved.costs.length, 1);
    const blank = await planUnitFix({ costs: [{ itemId: item.id, item: item.name, from: { avgCostCents: 1000 }, to: { avgCostCents: 6000 }, reason: 'supplier price', approvedIncrease: '  ' }] });
    assert.match(blank.refusals[0]!, /must lower the cost/);
  } finally {
    await prisma.stockItem.deleteMany({ where: { id: item.id } });
  }
});
