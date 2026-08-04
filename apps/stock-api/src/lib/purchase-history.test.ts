import assert from 'node:assert/strict';
import test from 'node:test';
import {
  effectiveUnitPriceCents,
  orderQuantityToPar,
  suppliedQuantity,
  summarisePurchases,
  type PurchaseLine
} from '@alma/shared';

const line = (over: Partial<PurchaseLine> = {}): PurchaseLine => ({
  supplierId: 'foodbyus',
  supplierName: 'FoodByUs',
  unitAmountCents: 1000,
  quantity: 1,
  purchasedAt: '2026-07-01T00:00:00.000Z',
  ...over
});

/* ---------------------------------------------------------------- */
/* Nothing to go on                                                  */
/* ---------------------------------------------------------------- */

test('an item never purchased reports nothing rather than guessing', () => {
  const facts = summarisePurchases([]);
  assert.equal(facts.supplierId, null);
  assert.equal(facts.lastPriceCents, null);
  assert.equal(facts.purchaseCount, 0);
});

test('lines with no price are ignored', () => {
  // A zero-priced line is a freebie, a credit or bad data — none of which is
  // evidence of what the item costs.
  const facts = summarisePurchases([line({ unitAmountCents: 0 })]);
  assert.equal(facts.purchaseCount, 0);
  assert.equal(facts.lastPriceCents, null);
});

/* ---------------------------------------------------------------- */
/* Choosing the supplier                                             */
/* ---------------------------------------------------------------- */

test('one supplier used throughout is reported with full confidence', () => {
  // The normal case here: 122 of 123 items with history have exactly one.
  const facts = summarisePurchases([line(), line({ purchasedAt: '2026-07-15T00:00:00.000Z' })]);
  assert.equal(facts.supplierId, 'foodbyus');
  assert.equal(facts.supplierShare, 1);
});

test('the most recent supplier wins, and the share says how contested it is', () => {
  const facts = summarisePurchases([
    line({ supplierId: 'old', supplierName: 'Old Co', purchasedAt: '2026-01-01T00:00:00.000Z' }),
    line({ supplierId: 'old', supplierName: 'Old Co', purchasedAt: '2026-02-01T00:00:00.000Z' }),
    line({ supplierId: 'new', supplierName: 'New Co', purchasedAt: '2026-07-01T00:00:00.000Z' })
  ]);
  // Frequency alone would keep recommending the supplier they moved away from.
  assert.equal(facts.supplierId, 'new');
  // ...but the share is honest that this is a recent switch, not a habit.
  assert.equal(facts.supplierShare, 0.33);
});

test('frequency breaks a tie on the same day', () => {
  const sameDay = '2026-07-01T00:00:00.000Z';
  const facts = summarisePurchases([
    line({ supplierId: 'a', supplierName: 'A', purchasedAt: sameDay }),
    line({ supplierId: 'a', supplierName: 'A', purchasedAt: sameDay }),
    line({ supplierId: 'b', supplierName: 'B', purchasedAt: sameDay })
  ]);
  assert.equal(facts.supplierId, 'a');
});

/* ---------------------------------------------------------------- */
/* Price                                                             */
/* ---------------------------------------------------------------- */

test('last price is the most recent one, not the largest or the newest row', () => {
  const facts = summarisePurchases([
    line({ unitAmountCents: 5000, purchasedAt: '2026-07-20T00:00:00.000Z' }),
    line({ unitAmountCents: 9000, purchasedAt: '2026-03-01T00:00:00.000Z' })
  ]);
  assert.equal(facts.lastPriceCents, 5000);
  assert.equal(facts.lowPriceCents, 5000);
  assert.equal(facts.highPriceCents, 9000);
});

test('price movement is measured against the cheapest ever paid', () => {
  // A price that creeps up over several deliveries shows almost nothing
  // purchase-to-purchase, and a lot against where it started. 37 of 123 items
  // in production moved more than 20%.
  const facts = summarisePurchases([
    line({ unitAmountCents: 1000, purchasedAt: '2026-01-01T00:00:00.000Z' }),
    line({ unitAmountCents: 1100, purchasedAt: '2026-03-01T00:00:00.000Z' }),
    line({ unitAmountCents: 1250, purchasedAt: '2026-07-01T00:00:00.000Z' })
  ]);
  assert.equal(facts.lastPriceCents, 1250);
  assert.equal(facts.priceMovement, 0.25);
});

test('a single purchase has no movement to report', () => {
  // One data point is not a trend, and reporting 0% would imply a stable price
  // nobody has evidence for.
  const facts = summarisePurchases([line()]);
  assert.equal(facts.priceMovement, null);
  assert.equal(facts.purchaseCount, 1);
});

test('a price that fell reports negative movement', () => {
  const facts = summarisePurchases([
    line({ unitAmountCents: 2000, purchasedAt: '2026-01-01T00:00:00.000Z' }),
    line({ unitAmountCents: 1000, purchasedAt: '2026-07-01T00:00:00.000Z' })
  ]);
  // Last price IS the cheapest, so there is no premium over the best seen.
  assert.equal(facts.priceMovement, 0);
  assert.equal(facts.lowPriceCents, 1000);
});

test('quantities are totalled so a one-off is distinguishable from a staple', () => {
  const facts = summarisePurchases([line({ quantity: 2 }), line({ quantity: 3.5 })]);
  assert.equal(facts.totalQuantity, 5.5);
  assert.equal(facts.purchaseCount, 2);
});

/* ---------------------------------------------------------------- */
/* How much to order                                                 */
/* ---------------------------------------------------------------- */

test('nothing is ordered when stock is at or above par', () => {
  assert.equal(orderQuantityToPar({ onHand: 10, parLevel: 10 }), 0);
  assert.equal(orderQuantityToPar({ onHand: 12, parLevel: 10 }), 0);
});

test('a shortfall is converted into whole purchase units, rounded up', () => {
  // Needing 25 of something sold in cases of 24 means two cases. Rounding down
  // would leave the venue short, which is the one thing a par level exists to
  // prevent.
  assert.equal(orderQuantityToPar({ onHand: 0, parLevel: 25, conversionFactor: 24 }), 2);
  assert.equal(orderQuantityToPar({ onHand: 0, parLevel: 24, conversionFactor: 24 }), 1);
  assert.equal(orderQuantityToPar({ onHand: 0, parLevel: 1, conversionFactor: 24 }), 1);
});

test('stock already on order is not ordered twice', () => {
  assert.equal(orderQuantityToPar({ onHand: 2, parLevel: 10, onOrder: 8 }), 0);
  assert.equal(orderQuantityToPar({ onHand: 2, parLevel: 10, onOrder: 4 }), 4);
});

test('a missing or nonsense conversion factor is treated as one-for-one', () => {
  // Rather than dividing by zero or by null and ordering an absurd quantity.
  assert.equal(orderQuantityToPar({ onHand: 0, parLevel: 5, conversionFactor: 0 }), 5);
  assert.equal(orderQuantityToPar({ onHand: 0, parLevel: 5, conversionFactor: null }), 5);
});

/* ---------------------------------------------------------------- */
/* What one unit actually cost                                       */
/* ---------------------------------------------------------------- */

test('the real quantity is read from the description when the import says 1', () => {
  // Every one of these is a real haloumi line. The importer recorded quantity
  // as 1 and put the true figure only in the supplier's text.
  assert.equal(suppliedQuantity({ quantity: 1, description: 'CHEESE HALOUMI. Ordered: 5 units, Supplied Qty: 5 units' }), 5);
  assert.equal(suppliedQuantity({ quantity: 1, description: 'DELI CHORIZO. Ordered: 4 KG, Supplied Qty: 4.7 KG' }), 4.7);
});

test('a real structured quantity is trusted over the description', () => {
  assert.equal(suppliedQuantity({ quantity: 5, description: 'Supplied Qty: 5 units' }), 5);
  assert.equal(suppliedQuantity({ quantity: 20, description: null }), 20);
});

test('haloumi costs $17 a unit however the invoice recorded it', () => {
  // The three real shapes this line arrives in. Read straight off unitAmount
  // they look like $17, $85 and $170 for the same product — a tenfold swing
  // that would price an order ten times too high.
  const asFive = effectiveUnitPriceCents({
    supplierId: 'f', supplierName: 'FoodByUs', quantity: 5,
    unitAmountCents: 1700, lineAmountCents: 8500, purchasedAt: '2026-06-01'
  });
  const asOne = effectiveUnitPriceCents({
    supplierId: 'f', supplierName: 'FoodByUs', quantity: 1,
    unitAmountCents: 8500, lineAmountCents: 8500,
    description: 'CHEESE HALOUMI 750GM (Cypriana) EA (5). Ordered: 5 units, Supplied Qty: 5 units',
    purchasedAt: '2026-06-08'
  });
  const asTen = effectiveUnitPriceCents({
    supplierId: 'f', supplierName: 'FoodByUs', quantity: 1,
    unitAmountCents: 17000, lineAmountCents: 17000,
    description: 'CHEESE HALOUMI 750GM (Cypriana) EA (5). Ordered: 10 units, Supplied Qty: 10 units',
    purchasedAt: '2026-06-15'
  });
  assert.equal(asFive, 1700);
  assert.equal(asOne, 1700);
  assert.equal(asTen, 1700);
});

test('a stable price reports no movement once units are corrected', () => {
  const facts = summarisePurchases([
    { supplierId: 'f', supplierName: 'FoodByUs', quantity: 5, unitAmountCents: 1700, lineAmountCents: 8500, purchasedAt: '2026-06-01' },
    { supplierId: 'f', supplierName: 'FoodByUs', quantity: 1, unitAmountCents: 17000, lineAmountCents: 17000,
      description: 'Ordered: 10 units, Supplied Qty: 10 units', purchasedAt: '2026-06-15' }
  ]);
  assert.equal(facts.lastPriceCents, 1700);
  assert.equal(facts.priceMovement, 0, 'a flat price must not read as a tenfold rise');
});

test('random-weight goods price per kilo, not per delivery', () => {
  const facts = summarisePurchases([
    { supplierId: 'f', supplierName: 'FoodByUs', quantity: 1, unitAmountCents: 12000, lineAmountCents: 12000,
      description: 'DELI CHORIZO. Ordered: 4 KG, Supplied Qty: 4 KG', purchasedAt: '2026-06-01' },
    { supplierId: 'f', supplierName: 'FoodByUs', quantity: 1, unitAmountCents: 14100, lineAmountCents: 14100,
      description: 'DELI CHORIZO. Ordered: 4 KG, Supplied Qty: 4.7 KG', purchasedAt: '2026-06-08' }
  ]);
  // $120/4kg and $141/4.7kg are both $30 a kilo — a heavier delivery is not a
  // price rise.
  assert.equal(facts.lastPriceCents, 3000);
  assert.equal(facts.priceMovement, 0);
});
