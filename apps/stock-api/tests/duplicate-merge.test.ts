import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@alma/db';
import { applyCluster, checkRun, ensureBackupTable, planCluster, rollback, BACKUP_TABLE, type Decision } from '../scripts/lib/duplicate-merge.js';

/**
 * The duplicate merge must be undoable exactly. Build a cluster the way the
 * catalogue really has them — a floor-named survivor counted on the latest
 * sheet, an invoice-named twin carrying recipe/invoice links and a stale
 * holding, both counted on one old sheet, both on the latest sheet (a double
 * count) and both on a venue-less stray sheet — merge it, check what moved,
 * roll it back, and compare every row with what was there before.
 */
const NO_DB = { skip: !process.env.DATABASE_URL };

async function rowsFor(itemIds: string[]) {
  const [items, venueStock, lines, recipeLines, aliases, movements] = await Promise.all([
    prisma.stockItem.findMany({ where: { id: { in: itemIds } }, orderBy: { id: 'asc' } }),
    prisma.venueStockItem.findMany({ where: { stockItemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
    prisma.stocktakeLine.findMany({ where: { itemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
    prisma.recipeLine.findMany({ where: { itemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
    prisma.stockItemAlias.findMany({ where: { stockItemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
    prisma.inventoryMovement.findMany({ where: { itemId: { in: itemIds } }, orderBy: { id: 'asc' } })
  ]);
  return { items, venueStock, lines, recipeLines, aliases, movements };
}

type Fixture = Awaited<ReturnType<typeof buildFixture>>;

async function buildFixture(tag: string, options: { costTwin?: number } = {}) {
  const category = await prisma.stockCategory.upsert({ where: { name: 'Spirits — Tequila & Mezcal' }, update: {}, create: { name: 'Spirits — Tequila & Mezcal' } });
  const survivor = await prisma.stockItem.create({ data: { name: `Patron Silver ${tag}`, unit: 'bottle', countUnit: 'bottle', conversionFactor: 1, categoryId: category.id, avgCostCents: 7000, onHand: 3, parLevel: 0, status: 'ACTIVE', venueStock: { create: [{ venue: 'St Alma', onHand: 3, active: true }] } } });
  const twin = await prisma.stockItem.create({ data: { name: `PATRON SILVER 700ML BOTTLE ${tag}`, unit: 'case', countUnit: 'bottle', conversionFactor: 6, categoryId: category.id, avgCostCents: options.costTwin ?? 7100, latestCostCents: 42600, onHand: 9, parLevel: 6, status: 'ACTIVE', notes: 'invoice twin', venueStock: { create: [{ venue: 'St Alma', onHand: 4, active: true }, { venue: 'Alma Avalon', onHand: 5, active: true }] } } });
  const recipe = await prisma.recipe.create({ data: { title: `Margarita ${tag}`, status: 'ACTIVE' } });
  const recipeLine = await prisma.recipeLine.create({ data: { recipeId: recipe.id, ingredientName: twin.name, quantity: 45, unit: 'ml', itemId: twin.id, position: 1 } });
  const alias = await prisma.stockItemAlias.create({ data: { aliasKey: `patron silver 700ml ${tag}`, stockItemId: twin.id, sourceText: twin.name } });
  // An old applied sheet where only the twin was counted; the latest sheet where BOTH were (double count);
  // a venue-less stray sheet listing both with counts, which must never be folded.
  const oldSheet = await prisma.stocktake.create({ data: { name: `Old ${tag}`, venue: 'St Alma', countedAt: new Date('2025-12-31'), status: 'REVIEWED', appliedAt: new Date('2026-01-01'), lines: { create: [{ position: 1, label: twin.name, itemId: twin.id, countedQty: 4, unit: 'bottle', stockValueCents: 28400 }] } }, include: { lines: true } });
  const latest = await prisma.stocktake.create({ data: { name: `Latest ${tag}`, venue: 'St Alma', countedAt: new Date('2026-10-01'), status: 'SUBMITTED', updatedAt: new Date('2026-10-01'), lines: { create: [{ position: 1, label: survivor.name, itemId: survivor.id, countedQty: 3, unit: 'bottle', stockValueCents: 21000 }, { position: 2, label: twin.name, itemId: twin.id, countedQty: 3, unit: 'bottle', stockValueCents: 21300 }] } }, include: { lines: true } });
  const stray = await prisma.stocktake.create({ data: { name: `Stray ${tag}`, venue: null, countedAt: new Date('2026-06-07'), status: 'IN_PROGRESS', updatedAt: new Date('2026-07-16'), lines: { create: [{ position: 1, label: survivor.name, itemId: survivor.id, countedQty: 2, unit: 'bottle', stockValueCents: 14000 }, { position: 2, label: twin.name, itemId: twin.id, countedQty: 6, unit: 'bottle', stockValueCents: 42600 }] } }, include: { lines: true } });
  const movement = await prisma.inventoryMovement.create({ data: { itemId: twin.id, movementType: 'STOCKTAKE_ADJUSTMENT', quantityDelta: 1, quantityBefore: 3, quantityAfter: 4, unit: 'bottle', sourceStocktakeId: oldSheet.id, sourceStocktakeLineId: oldSheet.lines[0]!.id } });
  const ids = [survivor.id, twin.id];
  const decision: Decision = {
    index: 9999,
    cluster: `Patron Silver ${tag}`,
    action: 'merge',
    canonicalId: survivor.id,
    duplicateIds: [twin.id],
    unitSafe: true,
    onHandPlan: [
      { itemId: survivor.id, venue: 'St Alma', treatment: 'keep' },
      { itemId: twin.id, venue: 'St Alma', treatment: 'discard_stale', onHand: 4, why: 'same bottles as the survivor count' },
      { itemId: twin.id, venue: 'Alma Avalon', treatment: 'keep', onHand: 5, why: 'survivor not stocked at Avalon; real holding' }
    ],
    sameSheetDoubleCount: { present: true, treatment: 'keep_canonical_line_only', stocktakeIds: [latest.id] }
  };
  async function cleanup() {
    await prisma.inventoryMovement.deleteMany({ where: { OR: [{ itemId: { in: ids } }, { sourceStocktakeId: { in: [oldSheet.id, latest.id, stray.id] } }] } });
    await prisma.stocktake.deleteMany({ where: { id: { in: [oldSheet.id, latest.id, stray.id] } } });
    await prisma.recipeLine.deleteMany({ where: { recipeId: recipe.id } });
    await prisma.recipe.delete({ where: { id: recipe.id } });
    await prisma.stockItemAlias.deleteMany({ where: { stockItemId: { in: ids } } });
    await prisma.stockItem.deleteMany({ where: { id: { in: ids } } });
    await prisma.$executeRawUnsafe(`DELETE FROM "${BACKUP_TABLE}" WHERE "runId" LIKE $1`, `test-${tag}%`);
  }
  return { survivor, twin, recipe, recipeLine, alias, oldSheet, latest, stray, movement, ids, decision, cleanup };
}

test('a cluster merge discards the stale holding, drops the double count, never folds the stray sheet, repoints history, and rolls back exactly', NO_DB, async () => {
  const tag = `dupe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const f: Fixture = await buildFixture(tag);
  const runId = `test-${tag}`;
  const before = await rowsFor(f.ids);
  try {
    await ensureBackupTable();
    const plan = await planCluster(f.decision);
    assert.deepEqual(plan.check.problems, [], plan.check.problems.join('; '));
    assert.equal(plan.holdingsBefore['St Alma']!.onHand, 7);
    assert.equal(plan.holdingsAfter['St Alma']!.onHand, 3, 'the twin’s stale St Alma holding is discarded, not summed');
    assert.equal(plan.holdingsAfter['Alma Avalon']!.onHand, 5, 'the twin’s Avalon holding moves across');
    assert.equal(plan.discarded.length, 1);
    assert.equal(plan.discarded[0]!.valueCents, 28400);
    assert.equal(plan.doubleCounts.length, 1, 'the latest sheet is a double count; the stray sheet is not folded so it is not one');
    assert.equal(plan.foldExcluded, 1, 'the twin’s line on the stray sheet is repointed only');

    const result = await applyCluster(runId, plan);
    assert.equal(result.mergedCount, 1);
    assert.equal(result.moved.recipeLines, 1);

    const merged = await prisma.stockItem.findUnique({ where: { id: f.survivor.id }, include: { venueStock: true } });
    assert.equal(merged?.venueStock.find((v) => v.venue === 'St Alma')?.onHand, 3);
    assert.equal(merged?.venueStock.find((v) => v.venue === 'Alma Avalon')?.onHand, 5);
    assert.equal(merged?.onHand, 8);
    assert.equal(merged?.latestCostCents, 42600, 'cost the survivor lacked is backfilled');
    const archived = await prisma.stockItem.findUnique({ where: { id: f.twin.id } });
    assert.equal(archived?.status, 'ARCHIVED');
    assert.match(archived?.notes ?? '', /merge-duplicate-items-2026-10 run/);
    assert.equal((await prisma.recipeLine.findUnique({ where: { id: f.recipeLine.id } }))?.itemId, f.survivor.id);
    assert.equal((await prisma.stockItemAlias.findUnique({ where: { id: f.alias.id } }))?.stockItemId, f.survivor.id);
    assert.equal((await prisma.inventoryMovement.findUnique({ where: { id: f.movement.id } }))?.itemId, f.survivor.id);
    const latestLines = await prisma.stocktakeLine.findMany({ where: { stocktakeId: f.latest.id } });
    assert.equal(latestLines.length, 1, 'the duplicate line on the latest sheet is gone');
    assert.equal(latestLines[0]!.countedQty, 3, 'and the survivor’s count did not grow');
    assert.equal(latestLines[0]!.stockValueCents, 21000);
    const strayLines = await prisma.stocktakeLine.findMany({ where: { stocktakeId: f.stray.id }, orderBy: { position: 'asc' } });
    assert.equal(strayLines.length, 2, 'the venue-less stray sheet keeps both lines');
    assert.deepEqual(strayLines.map((l) => [l.itemId, l.countedQty]), [[f.survivor.id, 2], [f.survivor.id, 6]], 'repointed, not summed');
    const oldLine = await prisma.stocktakeLine.findUnique({ where: { id: f.oldSheet.lines[0]!.id } });
    assert.equal(oldLine?.itemId, f.survivor.id, 'history repoints, it is not deleted');
    assert.equal(oldLine?.countedQty, 4);

    await rollback(runId);
    const after = await rowsFor(f.ids);
    assert.deepEqual(after, before, 'every row is back exactly as it was, timestamps included');
  } finally {
    await f.cleanup();
  }
});

test('keep_duplicate_line puts the twin’s count on the survivor’s line before the merge', NO_DB, async () => {
  const tag = `dupe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const f = await buildFixture(tag);
  const runId = `test-${tag}`;
  try {
    // The survivor was listed but not counted on the latest sheet; the twin's line holds the real count.
    const survivorLine = f.latest.lines.find((l) => l.itemId === f.survivor.id)!;
    await prisma.stocktakeLine.update({ where: { id: survivorLine.id }, data: { countedQty: null, stockValueCents: null } });
    const plan = await planCluster({ ...f.decision, sameSheetDoubleCount: { present: true, treatment: 'keep_duplicate_line', stocktakeIds: [f.latest.id] } });
    assert.deepEqual(plan.check.problems, []);
    await applyCluster(runId, plan);
    const lines = await prisma.stocktakeLine.findMany({ where: { stocktakeId: f.latest.id } });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.id, survivorLine.id);
    assert.equal(lines[0]!.countedQty, 3, 'the twin’s count now sits on the survivor’s line');
    assert.equal(lines[0]!.stockValueCents, 21300);
    await rollback(runId);
    assert.equal((await prisma.stocktakeLine.count({ where: { stocktakeId: f.latest.id } })), 2);
  } finally {
    await f.cleanup();
  }
});

test('refusals: a cost 2× apart without review, a holding counted since the review, a sheet saved minutes ago, and one item in two clusters', NO_DB, async () => {
  const tag = `dupe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const f = await buildFixture(tag, { costTwin: 50010 });
  try {
    const cost = await planCluster(f.decision);
    assert.ok(cost.check.problems.some((p) => /avg cost differs/.test(p)), cost.check.problems.join('; '));
    const reviewed = await planCluster({ ...f.decision, costReviewed: true });
    assert.ok(!reviewed.check.problems.some((p) => /avg cost differs/.test(p)));

    await prisma.venueStockItem.updateMany({ where: { stockItemId: f.twin.id, venue: 'St Alma' }, data: { onHand: 9 } });
    const moved = await planCluster({ ...f.decision, costReviewed: true });
    assert.ok(moved.check.problems.some((p) => /counted since/.test(p)), moved.check.problems.join('; '));
    await prisma.venueStockItem.updateMany({ where: { stockItemId: f.twin.id, venue: 'St Alma' }, data: { onHand: 4 } });

    await prisma.stocktake.update({ where: { id: f.latest.id }, data: { updatedAt: new Date() } });
    const live = await planCluster({ ...f.decision, costReviewed: true });
    assert.ok(live.check.problems.some((p) => /saved in the last 30 minutes/.test(p)), live.check.problems.join('; '));

    assert.deepEqual(checkRun([f.decision, { ...f.decision, index: 1 }]).length, 2, 'the same items in two clusters is refused for the whole run');
  } finally {
    await f.cleanup();
  }
});

test('rollback refuses when the survivor gained history after the merge, unless forced', NO_DB, async () => {
  const tag = `dupe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const f = await buildFixture(tag);
  const runId = `test-${tag}`;
  let newSheet: { id: string } | null = null;
  try {
    await ensureBackupTable();
    await applyCluster(runId, await planCluster(f.decision));
    newSheet = await prisma.stocktake.create({ data: { name: `After ${tag}`, venue: 'St Alma', countedAt: new Date(), status: 'IN_PROGRESS', lines: { create: [{ position: 1, label: f.survivor.name, itemId: f.survivor.id, countedQty: 1, unit: 'bottle' }] } } });
    await assert.rejects(() => rollback(runId), /created on the survivor after the merge/);
    await rollback(runId, { force: true });
    assert.equal((await prisma.stockItem.findUnique({ where: { id: f.twin.id } }))?.status, 'ACTIVE');
  } finally {
    if (newSheet) await prisma.stocktake.delete({ where: { id: newSheet.id } });
    await f.cleanup();
  }
});
