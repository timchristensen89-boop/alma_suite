import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@alma/db';
import { stocktakesService } from '../src/services/stocktakes.service.js';

async function createItem(name: string, onHand: number, unit = 'ea') {
  return prisma.stockItem.create({
    data: {
      name,
      unit,
      onHand,
      parLevel: 0,
      status: 'ACTIVE'
    }
  });
}

async function cleanup(ids: { stocktakeIds?: string[]; itemIds?: string[] }) {
  if (ids.stocktakeIds?.length) {
    await prisma.inventoryMovement.deleteMany({
      where: { sourceStocktakeId: { in: ids.stocktakeIds } }
    });
    await prisma.stocktake.deleteMany({ where: { id: { in: ids.stocktakeIds } } });
  }
  if (ids.itemIds?.length) {
    await prisma.inventoryMovement.deleteMany({
      where: { itemId: { in: ids.itemIds } }
    });
    await prisma.stockItem.deleteMany({ where: { id: { in: ids.itemIds } } });
  }
}

test('submitted stocktakes do not affect balances until applied', async () => {
  const suffix = `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item = await createItem(`Submitted balance ${suffix}`, 10, 'bottle');
  const stocktakeIds: string[] = [];

  try {
    const stocktake = await stocktakesService.createStocktake({
      name: `Submitted count ${suffix}`,
      countedAt: new Date().toISOString(),
      status: 'SUBMITTED',
      lines: [
        {
          itemId: item.id,
          label: item.name,
          countedQty: 14,
          unit: item.unit
        }
      ]
    });
    stocktakeIds.push(stocktake.id);

    const unchanged = await prisma.stockItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { onHand: true }
    });
    const movements = await prisma.inventoryMovement.count({
      where: { sourceStocktakeId: stocktake.id }
    });

    assert.equal(unchanged.onHand, 10);
    assert.equal(movements, 0);
  } finally {
    await cleanup({ stocktakeIds, itemIds: [item.id] });
  }
});

test('applying submitted stocktakes creates movement deltas and updates balances once', async () => {
  const suffix = `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const itemA = await createItem(`Applied balance A ${suffix}`, 10, 'bottle');
  const itemB = await createItem(`Applied balance B ${suffix}`, 5, 'kg');
  const stocktakeIds: string[] = [];

  try {
    const stocktake = await stocktakesService.createStocktake({
      name: `Applied count ${suffix}`,
      countedAt: new Date().toISOString(),
      status: 'SUBMITTED',
      lines: [
        {
          itemId: itemA.id,
          label: itemA.name,
          countedQty: 14,
          unit: itemA.unit
        },
        {
          itemId: itemB.id,
          label: itemB.name,
          countedQty: 2,
          unit: itemB.unit
        }
      ]
    });
    stocktakeIds.push(stocktake.id);

    const applied = await stocktakesService.applyStocktake(stocktake.id);
    assert.equal(applied.movements.length, 2);
    assert.ok(applied.stocktake.appliedAt);

    const [updatedA, updatedB, movements] = await Promise.all([
      prisma.stockItem.findUniqueOrThrow({ where: { id: itemA.id } }),
      prisma.stockItem.findUniqueOrThrow({ where: { id: itemB.id } }),
      prisma.inventoryMovement.findMany({
        where: { sourceStocktakeId: stocktake.id },
        orderBy: { itemId: 'asc' }
      })
    ]);

    assert.equal(updatedA.onHand, 14);
    assert.equal(updatedB.onHand, 2);

    const movementByItem = new Map(movements.map((movement) => [movement.itemId, movement]));
    assert.equal(movementByItem.get(itemA.id)?.quantityBefore, 10);
    assert.equal(movementByItem.get(itemA.id)?.quantityAfter, 14);
    assert.equal(movementByItem.get(itemA.id)?.quantityDelta, 4);
    assert.equal(movementByItem.get(itemB.id)?.quantityBefore, 5);
    assert.equal(movementByItem.get(itemB.id)?.quantityAfter, 2);
    assert.equal(movementByItem.get(itemB.id)?.quantityDelta, -3);
    assert.equal(movements.every((movement) => movement.movementType === 'STOCKTAKE_ADJUSTMENT'), true);

    const correction = await stocktakesService.createCorrection(stocktake.id, {
      corrections: [
        {
          sourceStocktakeLineId: applied.stocktake.lines[0].id,
          quantityAfter: 16,
          reason: 'Manager found one extra bottle'
        }
      ]
    });
    assert.equal(correction.movements.length, 1);
    assert.equal(correction.movements[0].movementType, 'STOCKTAKE_CORRECTION');
    assert.equal(correction.movements[0].quantityBefore, 14);
    assert.equal(correction.movements[0].quantityAfter, 16);
    assert.equal(correction.movements[0].quantityDelta, 2);

    const correctedA = await prisma.stockItem.findUniqueOrThrow({ where: { id: itemA.id } });
    assert.equal(correctedA.onHand, 16);

    await assert.rejects(
      () => stocktakesService.applyStocktake(stocktake.id),
      /already been applied/
    );

    const movementCount = await prisma.inventoryMovement.count({
      where: { sourceStocktakeId: stocktake.id }
    });
    assert.equal(movementCount, 3);

    await assert.rejects(
      () => stocktakesService.deleteStocktakes({ ids: [stocktake.id] }),
      /Applied stocktakes cannot be deleted/
    );

    const stocktakeStillExists = await prisma.stocktake.count({
      where: { id: stocktake.id }
    });
    assert.equal(stocktakeStillExists, 1);

    const reversal = await stocktakesService.reverseStocktake(stocktake.id, {
      reason: 'Reverse before recount'
    });
    assert.equal(reversal.movements.length, 2);
    assert.equal(reversal.movements.every((movement) => movement.movementType === 'STOCKTAKE_REVERSAL'), true);
    assert.equal(reversal.stocktake.appliedAt, null);
    assert.equal(reversal.stocktake.status, 'IN_PROGRESS');

    const [reversedA, reversedB] = await Promise.all([
      prisma.stockItem.findUniqueOrThrow({ where: { id: itemA.id } }),
      prisma.stockItem.findUniqueOrThrow({ where: { id: itemB.id } })
    ]);
    assert.equal(reversedA.onHand, 10);
    assert.equal(reversedB.onHand, 5);

    await assert.rejects(
      () => stocktakesService.reverseStocktake(stocktake.id, { reason: 'Again' }),
      /Only applied stocktakes can be reversed/
    );

    const deleted = await stocktakesService.deleteStocktakes({ ids: [stocktake.id] });
    assert.equal(deleted.deleted, 1);
  } finally {
    await cleanup({ stocktakeIds, itemIds: [itemA.id, itemB.id] });
  }
});
