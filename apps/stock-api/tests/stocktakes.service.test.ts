import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@alma/db';
import {
  recipeBulkDeleteInputSchema,
  stockInvoiceImportInputSchema,
  stockItemBulkDeleteInputSchema,
  stocktakeBulkDeleteInputSchema,
  supplierBulkDeleteInputSchema
} from '@alma/shared';
import { itemsService } from '../src/services/items.service.js';
import { stocktakesService } from '../src/services/stocktakes.service.js';
import { suppliersService } from '../src/services/suppliers.service.js';

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
      () =>
        stocktakesService.deleteStocktakes({
          ids: [stocktake.id],
          confirmationText: 'DELETE STOCKTAKES'
        }),
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

    const deleted = await stocktakesService.deleteStocktakes({
      ids: [stocktake.id],
      confirmationText: 'DELETE STOCKTAKES'
    });
    assert.equal(deleted.deleted, 1);
  } finally {
    await cleanup({ stocktakeIds, itemIds: [itemA.id, itemB.id] });
  }
});

test('bulk destructive inputs require typed confirmation text', () => {
  assert.throws(
    () => stockItemBulkDeleteInputSchema.parse({ ids: ['item-1'] }),
    /DELETE ITEMS/
  );
  assert.throws(
    () => supplierBulkDeleteInputSchema.parse({ ids: ['supplier-1'] }),
    /DELETE SUPPLIERS/
  );
  assert.throws(
    () => recipeBulkDeleteInputSchema.parse({ ids: ['recipe-1'] }),
    /DELETE RECIPES/
  );
  assert.throws(
    () => stocktakeBulkDeleteInputSchema.parse({ ids: ['stocktake-1'] }),
    /DELETE STOCKTAKES/
  );
  assert.throws(
    () => stockInvoiceImportInputSchema.parse({ invoices: [{ invoiceNumber: '1' }] }),
    /IMPORT INVOICES/
  );

  assert.doesNotThrow(() =>
    stockItemBulkDeleteInputSchema.parse({
      ids: ['item-1'],
      confirmationText: 'DELETE ITEMS'
    })
  );
});

test('catalogue item deletion is blocked when records reference the item', async () => {
  const suffix = `delete-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item = await createItem(`Referenced item ${suffix}`, 1, 'ea');
  const recipe = await prisma.recipe.create({
    data: {
      title: `Referenced recipe ${suffix}`,
      estimatedCost: 0,
      lines: {
        create: {
          position: 1,
          ingredientName: item.name,
          itemId: item.id
        }
      }
    }
  });

  try {
    await assert.rejects(
      () =>
        itemsService.deleteItems({
          ids: [item.id],
          confirmationText: 'DELETE ITEMS'
        }),
      /Cannot delete 1 item/
    );
  } finally {
    await prisma.recipe.deleteMany({ where: { id: recipe.id } });
    await cleanup({ itemIds: [item.id] });
  }
});

test('supplier deletion is blocked when imported invoices reference the supplier', async () => {
  const suffix = `delete-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const supplier = await prisma.supplier.create({
    data: {
      name: `Referenced supplier ${suffix}`,
      status: 'ACTIVE'
    }
  });
  const invoice = await prisma.supplierInvoice.create({
    data: {
      source: 'TEST',
      invoiceKey: suffix,
      supplierId: supplier.id,
      supplierName: supplier.name,
      currencyCode: 'AUD'
    }
  });

  try {
    await assert.rejects(
      () =>
        suppliersService.deleteSuppliers({
          ids: [supplier.id],
          confirmationText: 'DELETE SUPPLIERS'
        }),
      /imported invoices/
    );
  } finally {
    await prisma.supplierInvoice.deleteMany({ where: { id: invoice.id } });
    await prisma.supplier.deleteMany({ where: { id: supplier.id } });
  }
});
