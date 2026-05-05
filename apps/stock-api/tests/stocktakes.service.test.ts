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

    await assert.rejects(
      () => stocktakesService.applyStocktake(stocktake.id),
      /already been applied/
    );

    const movementCount = await prisma.inventoryMovement.count({
      where: { sourceStocktakeId: stocktake.id }
    });
    assert.equal(movementCount, 2);
  } finally {
    await cleanup({ stocktakeIds, itemIds: [itemA.id, itemB.id] });
  }
});
