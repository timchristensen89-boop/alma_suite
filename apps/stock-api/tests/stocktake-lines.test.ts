import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@alma/db';
import { stocktakeLinesPatchInputSchema, type AuthUser } from '@alma/shared';
import { stocktakesService } from '../src/services/stocktakes.service.js';

/**
 * The per-line save the counting screen autosaves through. Same value rule
 * as the whole-sheet save, same access rule, and it never touches a line it
 * was not sent.
 */

const NO_DB = { skip: !process.env.DATABASE_URL };

function actor(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: 'test-user',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    roleTitle: 'Bar',
    venue: 'St Alma',
    accountType: 'HUMAN',
    isAdmin: false,
    trainingOnly: false,
    role: 'STAFF',
    appAccess: [],
    ...overrides
  } as AuthUser;
}

const COUNTER = actor({});
const MANAGER = actor({ id: 'test-manager', roleTitle: 'Venue Manager', role: 'MANAGER' });

async function cleanup(ids: { stocktakeIds?: string[]; itemIds?: string[] }) {
  if (ids.stocktakeIds?.length) await prisma.stocktake.deleteMany({ where: { id: { in: ids.stocktakeIds } } });
  if (ids.itemIds?.length) await prisma.stockItem.deleteMany({ where: { id: { in: ids.itemIds } } });
}

test('the lines patch schema takes a blank quantity as "not counted", never zero', () => {
  const parsed = stocktakeLinesPatchInputSchema.parse({ lines: [{ id: 'a', countedQty: '' }, { id: 'b', countedQty: '2.5' }, { id: 'c', notes: 'half case' }] });
  assert.equal(parsed.lines[0]!.countedQty, null);
  assert.equal(parsed.lines[1]!.countedQty, 2.5);
  assert.equal(parsed.lines[2]!.countedQty, undefined);
  assert.throws(() => stocktakeLinesPatchInputSchema.parse({ lines: [] }));
});

test('a per-line save values the line server-side and leaves the other lines alone', NO_DB, async () => {
  const tag = `lines-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const gin = await prisma.stockItem.create({ data: { name: `Gin ${tag}`, unit: 'case', countUnit: 'bottle', conversionFactor: 6, avgCostCents: 4500, onHand: 0, parLevel: 0, status: 'ACTIVE' } });
  const limes = await prisma.stockItem.create({ data: { name: `Limes ${tag}`, unit: 'kg', avgCostCents: 800, onHand: 0, parLevel: 0, status: 'ACTIVE' } });
  const stocktake = await stocktakesService.createStocktake(
    {
      name: `Lines ${tag}`,
      venue: 'St Alma',
      countedAt: new Date().toISOString(),
      lines: [
        { itemId: gin.id, label: gin.name, unit: 'bottle' },
        { itemId: limes.id, label: limes.name, unit: 'kg', countedQty: 4 }
      ]
    },
    MANAGER
  );
  try {
    const ginLine = stocktake.lines.find((line) => line.itemId === gin.id)!;
    const limesLine = stocktake.lines.find((line) => line.itemId === limes.id)!;
    const before = new Date(stocktake.updatedAt).getTime();

    const result = await stocktakesService.updateLines(stocktake.id, { lines: [{ id: ginLine.id, countedQty: 2.5 }] }, COUNTER);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0]!.countedQty, 2.5);
    assert.equal(result.lines[0]!.stockValueCents, 11250, '2.5 bottles × $45.00, never the client’s number');
    assert.ok(new Date(result.updatedAt).getTime() >= before, 'the count’s updatedAt moves so the whole-sheet stale guard sees the save');

    const after = await stocktakesService.get(stocktake.id, MANAGER);
    assert.equal(after.lines.find((line) => line.id === limesLine.id)!.countedQty, 4, 'untouched lines keep their count');
    assert.equal(after.lines.find((line) => line.id === limesLine.id)!.stockValueCents, 3200);

    // Clearing a count is "not counted yet" again, not zero.
    const cleared = await stocktakesService.updateLines(stocktake.id, { lines: [{ id: ginLine.id, countedQty: '' }] }, COUNTER);
    assert.equal(cleared.lines[0]!.countedQty, null);
    assert.equal(cleared.lines[0]!.stockValueCents, null);

    // A line from another count (or one removed meanwhile) is reported, not
    // allowed to fail the batch.
    const partial = await stocktakesService.updateLines(stocktake.id, { lines: [{ id: 'not-a-line', countedQty: 1 }] }, COUNTER);
    assert.deepEqual(partial.missing, ['not-a-line']);
    assert.equal(partial.lines.length, 0);
  } finally {
    await cleanup({ stocktakeIds: [stocktake.id], itemIds: [gin.id, limes.id] });
  }
});

test('counters may only write lines on an open count at their venue; managers may add and remove lines', NO_DB, async () => {
  const tag = `lines-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item = await prisma.stockItem.create({ data: { name: `Tonic ${tag}`, unit: 'each', avgCostCents: 200, onHand: 0, parLevel: 0, status: 'ACTIVE' } });
  const extra = await prisma.stockItem.create({ data: { name: `Soda ${tag}`, unit: 'each', avgCostCents: 150, onHand: 0, parLevel: 0, status: 'ACTIVE' } });
  const open = await stocktakesService.createStocktake(
    { name: `Open ${tag}`, venue: 'St Alma', countedAt: new Date().toISOString(), lines: [{ itemId: item.id, label: item.name, unit: 'each' }] },
    MANAGER
  );
  const elsewhere = await stocktakesService.createStocktake(
    { name: `Avalon ${tag}`, venue: 'Alma Avalon', countedAt: new Date().toISOString(), lines: [{ itemId: item.id, label: item.name, unit: 'each' }] },
    actor({ id: 'avalon-manager', role: 'MANAGER', venue: 'Alma Avalon' })
  );
  try {
    const line = open.lines[0]!;
    // Another venue's count is invisible, not merely refused.
    await assert.rejects(
      () => stocktakesService.updateLines(elsewhere.id, { lines: [{ id: elsewhere.lines[0]!.id, countedQty: 1 }] }, COUNTER),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 404
    );

    // Adding and removing lines.
    const added = await stocktakesService.addLine(open.id, { itemId: extra.id }, COUNTER);
    assert.equal(added.itemId, extra.id);
    assert.equal(added.countedQty, null);
    await assert.rejects(
      () => stocktakesService.addLine(open.id, { itemId: extra.id }, COUNTER),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 409,
      'an item cannot be on a count twice'
    );
    await stocktakesService.removeLine(open.id, added.id, MANAGER);
    assert.equal((await stocktakesService.get(open.id, MANAGER)).lines.length, 1);

    // Once submitted the count belongs to the reviewer.
    await stocktakesService.submitStocktake(open.id, MANAGER);
    await assert.rejects(
      () => stocktakesService.updateLines(open.id, { lines: [{ id: line.id, countedQty: 3 }] }, COUNTER),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 403
    );
    // A manager may still correct a submitted count before it is applied.
    const corrected = await stocktakesService.updateLines(open.id, { lines: [{ id: line.id, countedQty: 3 }] }, MANAGER);
    assert.equal(corrected.lines[0]!.countedQty, 3);

    // Applied to stock: closed to everyone until reversed.
    await stocktakesService.applyStocktake(open.id, MANAGER);
    await assert.rejects(
      () => stocktakesService.updateLines(open.id, { lines: [{ id: line.id, countedQty: 4 }] }, MANAGER),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 409
    );
    const applied = await stocktakesService.get(open.id, MANAGER);
    assert.equal(applied.lines[0]!.countedQty, 3, 'an applied count keeps its numbers');
  } finally {
    await prisma.inventoryMovement.deleteMany({ where: { sourceStocktakeId: { in: [open.id, elsewhere.id] } } });
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: [item.id, extra.id] } } });
    await cleanup({ stocktakeIds: [open.id, elsewhere.id], itemIds: [item.id, extra.id] });
  }
});

test('the lines patch schema: whitespace and a lone dot are blank, non-numbers are refused', () => {
  const parsed = stocktakeLinesPatchInputSchema.parse({ lines: [{ id: 'a', countedQty: ' ' }, { id: 'b', countedQty: '.' }, { id: 'c', countedQty: ' 2 ' }, { id: 'd', countedQty: 0 }] });
  assert.deepEqual(parsed.lines.map((l) => l.countedQty), [null, null, 2, 0]);
  for (const bad of [true, [], 'abc', {}]) {
    assert.throws(() => stocktakeLinesPatchInputSchema.parse({ lines: [{ id: 'a', countedQty: bad }] }), `${JSON.stringify(bad)} must be refused`);
  }
});

test('a locked count is closed to everyone, a missing line is reported not fatal, duplicate ids merge, and a line with ledger history cannot be removed', NO_DB, async () => {
  const tag = `lines-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item = await prisma.stockItem.create({ data: { name: `Mezcal ${tag}`, unit: 'bottle', avgCostCents: 9000, onHand: 0, parLevel: 0, status: 'ACTIVE' } });
  const count = await stocktakesService.createStocktake(
    { name: `Guard ${tag}`, venue: 'St Alma', countedAt: new Date().toISOString(), lines: [{ itemId: item.id, label: item.name, unit: 'bottle' }] },
    MANAGER
  );
  try {
    const line = count.lines[0]!;
    // Two patches for one line in a batch are one line with two edits.
    const merged = await stocktakesService.updateLines(count.id, { lines: [{ id: line.id, countedQty: 5 }, { id: line.id, notes: 'half case' }, { id: 'gone', countedQty: 1 }] }, COUNTER);
    assert.equal(merged.lines.length, 1);
    assert.equal(merged.lines[0]!.countedQty, 5);
    assert.equal(merged.lines[0]!.notes, 'half case');
    assert.deepEqual(merged.missing, ['gone'], 'a line that is not on the count is reported, the rest still save');

    await stocktakesService.submitStocktake(count.id, MANAGER);
    await stocktakesService.lockStocktake(count.id, MANAGER);
    await assert.rejects(
      () => stocktakesService.updateLines(count.id, { lines: [{ id: line.id, countedQty: 6 }] }, MANAGER),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 409 && /locked/i.test((err as Error).message),
      'a locked baseline refuses even a manager until it is reopened with a reason'
    );
    await stocktakesService.reopenStocktakeWithReason(count.id, MANAGER, 'test correction');
    // Apply, reverse: the line now anchors ledger movements and cannot be removed.
    await stocktakesService.submitStocktake(count.id, MANAGER);
    await stocktakesService.applyStocktake(count.id, MANAGER);
    await stocktakesService.reverseStocktake(count.id, { reason: 'test reversal' }, MANAGER);
    await assert.rejects(
      () => stocktakesService.removeLine(count.id, line.id, MANAGER),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 409
    );
    assert.ok(await prisma.stocktakeLine.findUnique({ where: { id: line.id } }), 'the anchored line is still there');
  } finally {
    await prisma.inventoryMovement.deleteMany({ where: { OR: [{ sourceStocktakeId: count.id }, { itemId: item.id }] } });
    await cleanup({ stocktakeIds: [count.id], itemIds: [item.id] });
  }
});

test('quantities entered in another unit are stored in the count unit, and history is left alone', NO_DB, async () => {
  const tag = `units-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const gin = await prisma.stockItem.create({ data: { name: `Gin ${tag}`, unit: 'case', countUnit: 'bottle', conversionFactor: 6, measurePerCountUnit: 700, measureUnit: 'ml', avgCostCents: 4500, onHand: 0, parLevel: 0, status: 'ACTIVE' } });
  const nuts = await prisma.stockItem.create({ data: { name: `Pistachio ${tag}`, unit: 'each', countUnit: 'each', conversionFactor: 1, measurePerCountUnit: 1000, measureUnit: 'g', avgCostCents: 4468, onHand: 0, parLevel: 0, status: 'ACTIVE' } });
  const herbs = await prisma.stockItem.create({ data: { name: `Herbs ${tag}`, unit: 'each', countUnit: 'each', conversionFactor: 1, measurePerCountUnit: 100, measureUnit: 'g', avgCostCents: 300, onHand: 0, parLevel: 0, status: 'ACTIVE' } });
  const stocktakeIds: string[] = [];
  try {
    // Created with a weight on a 1 kg bag item: stored as bags.
    const sheet = await stocktakesService.createStocktake(
      { name: `Units ${tag}`, venue: 'St Alma', countedAt: new Date().toISOString(), lines: [
        { itemId: gin.id, label: gin.name, unit: 'bottle' },
        { itemId: nuts.id, label: nuts.name, unit: 'g', countedQty: 970 },
        { itemId: herbs.id, label: herbs.name, unit: 'each' }
      ] },
      MANAGER
    );
    stocktakeIds.push(sheet.id);
    const line = (itemId: string) => sheet.lines.find((l) => l.itemId === itemId)!;
    assert.deepEqual([line(nuts.id).countedQty, line(nuts.id).unit, line(nuts.id).stockValueCents], [0.97, 'each', 4334]);

    // Two cases typed on the count screen: stored as 12 bottles.
    const patched = await stocktakesService.updateLines(sheet.id, { lines: [{ id: line(gin.id).id, countedQty: 2, unit: 'case' }] }, COUNTER);
    assert.deepEqual([patched.lines[0]!.countedQty, patched.lines[0]!.unit, patched.lines[0]!.stockValueCents], [12, 'bottle', 54000]);

    // A weight on an item whose measure is the placeholder is refused, and nothing is written.
    await assert.rejects(
      stocktakesService.updateLines(sheet.id, { lines: [{ id: line(herbs.id).id, countedQty: 170, unit: 'g' }] }, COUNTER),
      (error: { statusCode?: number; message: string }) => error.statusCode === 400 && /doesn't yet say how much one each holds/.test(error.message)
    );
    const herbsAfter = (await stocktakesService.get(sheet.id, MANAGER)).lines.find((l) => l.itemId === herbs.id)!;
    assert.equal(herbsAfter.countedQty, null);

    // Applying converts an exact line written straight to the table (an import), and records how.
    await prisma.stocktakeLine.update({ where: { id: line(gin.id).id }, data: { countedQty: 3, unit: 'case' } });
    await stocktakesService.updateStocktake(sheet.id, { status: 'SUBMITTED' }, MANAGER);
    const applied = await stocktakesService.applyStocktake(sheet.id, MANAGER);
    const ginMove = applied.movements.find((m) => m.itemId === gin.id)!;
    assert.equal(ginMove.quantityAfter, 18);
    assert.equal(ginMove.unit, 'bottle');
    const holding = await prisma.venueStockItem.findFirstOrThrow({ where: { stockItemId: gin.id, venue: 'St Alma' } });
    assert.equal(holding.onHand, 18);
    // The line itself still says what was counted.
    const ginLine = await prisma.stocktakeLine.findUniqueOrThrow({ where: { id: line(gin.id).id } });
    assert.deepEqual([ginLine.countedQty, ginLine.unit], [3, 'case']);

    // An imported sheet with a measure that rests on the item's measure is refused at apply.
    const imported = await prisma.stocktake.create({ data: { name: `Import ${tag}`, venue: 'St Alma', countedAt: new Date(), status: 'SUBMITTED', lines: { create: [{ position: 1, label: gin.name, itemId: gin.id, countedQty: 19400, unit: 'mL' }] } } });
    stocktakeIds.push(imported.id);
    await assert.rejects(stocktakesService.applyStocktake(imported.id, MANAGER), (error: { statusCode?: number; message: string }) =>
      error.statusCode === 409 && /1 line can't be applied yet/.test(error.message) && /has to be entered as a count/.test(error.message));

    // Editing an old sheet through the whole-sheet save leaves unchanged lines exactly as stored.
    const legacy = await prisma.stocktake.create({ data: { name: `Legacy ${tag}`, venue: 'St Alma', countedAt: new Date(), status: 'IN_PROGRESS', lines: { create: [
      { position: 1, label: gin.name, itemId: gin.id, countedQty: 22, unit: 'ml' },
      { position: 2, label: nuts.name, itemId: nuts.id, countedQty: null, unit: 'g' }
    ] } }, include: { lines: { orderBy: { position: 'asc' } } } });
    stocktakeIds.push(legacy.id);
    await stocktakesService.updateStocktake(legacy.id, { lines: [
      { id: legacy.lines[0]!.id, itemId: gin.id, label: gin.name, countedQty: 22, unit: 'ml' },
      { id: legacy.lines[1]!.id, itemId: nuts.id, label: nuts.name, countedQty: 500, unit: 'g' }
    ] }, MANAGER);
    const legacyAfter = await prisma.stocktakeLine.findMany({ where: { stocktakeId: legacy.id }, orderBy: { position: 'asc' } });
    assert.deepEqual(legacyAfter.map((l) => [l.countedQty, l.unit]), [[22, 'ml'], [0.5, 'each']]);
  } finally {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: [gin.id, nuts.id, herbs.id] } } });
    await prisma.venueStockItem.deleteMany({ where: { stockItemId: { in: [gin.id, nuts.id, herbs.id] } } });
    await cleanup({ stocktakeIds, itemIds: [gin.id, nuts.id, herbs.id] });
  }
});
