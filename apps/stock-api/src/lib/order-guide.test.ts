import assert from 'node:assert/strict';
import test from 'node:test';
import {
  holdBackImplausibleGuideSuggestions,
  stockPurchaseOrderBatchInputSchema,
  type StockOrderGuideLine
} from '@alma/shared';

const line = (over: Partial<StockOrderGuideLine> = {}): StockOrderGuideLine => ({
  stockItemId: 'item',
  description: 'Item',
  unit: 'each',
  onHand: 0,
  parLevel: 10,
  agreedCostCents: null,
  agreedEffectiveAt: null,
  lastPaidCents: 500,
  lastPurchasedAt: null,
  priceMovement: null,
  suggestedQuantity: 0,
  ...over
});

test('a wrong-unit par is held back, real suggestions survive', () => {
  // The production case: 21,724 bottles of gin suggested because somebody
  // counted millilitres. It dwarfs the rest of the suggested spend.
  const gin = line({ stockItemId: 'gin', description: 'Dry Gin', suggestedQuantity: 21_724, lastPaidCents: 5_471 });
  const limes = line({ stockItemId: 'limes', description: 'Limes', suggestedQuantity: 3, lastPaidCents: 900 });
  const kegs = line({ stockItemId: 'kegs', description: 'Lager keg', suggestedQuantity: 2, agreedCostCents: 27_000, lastPaidCents: null });

  const held = holdBackImplausibleGuideSuggestions([gin, limes, kegs]);

  assert.equal(held, 1);
  assert.equal(gin.suggestedQuantity, 0);
  assert.equal(gin.checkPar, true);
  assert.equal(limes.suggestedQuantity, 3);
  assert.equal(limes.checkPar, undefined);
  assert.equal(kegs.suggestedQuantity, 2);
});

test('ordinary suggested spend is left alone', () => {
  const lines = [
    line({ stockItemId: 'a', suggestedQuantity: 4, lastPaidCents: 2_000 }),
    line({ stockItemId: 'b', suggestedQuantity: 6, agreedCostCents: 1_500, lastPaidCents: 1_600 }),
    line({ stockItemId: 'c', suggestedQuantity: 1, lastPaidCents: 12_000 })
  ];
  assert.equal(holdBackImplausibleGuideSuggestions(lines), 0);
  assert.deepEqual(lines.map((l) => l.suggestedQuantity), [4, 6, 1]);
});

test('a big share alone is not enough below the value floor', () => {
  // One $12 line that is 100% of the suggested spend is just a small order.
  const only = line({ suggestedQuantity: 1, lastPaidCents: 1_200 });
  assert.equal(holdBackImplausibleGuideSuggestions([only]), 0);
  assert.equal(only.suggestedQuantity, 1);
});

test('unpriced suggestions cannot trip the guard or the total', () => {
  const unpriced = line({ stockItemId: 'new', suggestedQuantity: 50, lastPaidCents: null });
  assert.equal(holdBackImplausibleGuideSuggestions([unpriced]), 0);
  assert.equal(unpriced.suggestedQuantity, 50);
});

test('batch input: one order per supplier, lines validated', () => {
  const parsed = stockPurchaseOrderBatchInputSchema.parse({
    venue: 'St Alma',
    send: true,
    message: 'Deliver before 10am',
    orders: [
      {
        supplierId: 'sup-1',
        supplierName: 'Two Providores',
        lines: [{ stockItemId: 'gin', description: 'Dry Gin', unit: 'bottle', orderedQuantity: 6, unitCostCents: 5_471 }]
      },
      {
        supplierName: 'No email pty ltd',
        lines: [{ description: 'Limes', orderedQuantity: 2 }]
      }
    ]
  });
  assert.equal(parsed.orders.length, 2);
  assert.equal(parsed.orders[1]?.lines[0]?.unitCostCents, 0);

  assert.throws(() => stockPurchaseOrderBatchInputSchema.parse({ send: false, orders: [] }));
  assert.throws(() =>
    stockPurchaseOrderBatchInputSchema.parse({
      send: false,
      orders: [{ supplierName: 'X', lines: [{ description: 'Limes', orderedQuantity: 0 }] }]
    })
  );
});
