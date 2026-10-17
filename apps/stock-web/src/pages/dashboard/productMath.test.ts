import assert from 'node:assert/strict';
import test from 'node:test';
import type { Recipe } from '@alma/shared';
import { merge, sortRows, toRow } from './productMath';

const recipe = (over: Partial<Recipe>): Recipe => ({
  id: 'r', title: 'Taco', venue: 'St Alma', category: 'Tacos', isPrepRecipe: false, status: 'ACTIVE', salePriceCents: 1200, portionCostCents: 300,
  actualSales: { lookbackDays: 30, fromDate: '2026-09-19', toDate: '2026-10-18', quantitySold: 100, netSalesCents: 100000, grossSalesCents: 120000, orderCount: 90 },
  ...over
} as unknown as Recipe);

test('gross profit is net sales less recipe cost per unit, so a discounted dish cannot show a 700% margin', () => {
  const r = toRow(recipe({}), 'St Alma');
  assert.equal(r.profitCents, 100000 - 300 * 100);
  assert.equal(Math.round(r.marginPercent!), 70);
  assert.equal(r.costed, true);
});

test('a near-zero recipe cost is treated as uncosted, not as a 98% margin', () => {
  const r = toRow(recipe({ portionCostCents: 5 }), 'St Alma');
  assert.equal(r.costed, false);
  assert.equal(r.profitCents, null);
});

test('the venue price wins over the shared price for the 2% rule when nothing sold', () => {
  const r = toRow(recipe({ actualSales: { lookbackDays: 30, fromDate: 'a', toDate: 'b', quantitySold: 0, netSalesCents: 0, grossSalesCents: 0, orderCount: 0 }, venuePrices: [{ venue: 'St Alma', salePriceCents: 2000 }] } as never), 'St Alma');
  assert.equal(r.units, 0);
  assert.equal(r.costed, true);
  assert.equal(r.profitCents, 0);
});

test('the group view adds the same dish across venues and only keeps a profit when every venue is costed', () => {
  const a = toRow(recipe({ id: 'a', venue: 'St Alma' }), 'St Alma');
  const b = toRow(recipe({ id: 'b', venue: 'Alma Avalon', portionCostCents: null }), 'Alma Avalon');
  const [row] = merge([a, b]);
  assert.equal(row!.units, 200);
  assert.equal(row!.netSalesCents, 200000);
  assert.deepEqual(row!.venues, ['St Alma', 'Alma Avalon']);
  assert.equal(row!.profitCents, null, 'Avalon has no cost, so the group profit is unknown');
  const [costed] = merge([a, toRow(recipe({ id: 'c', venue: 'Alma Avalon' }), 'Alma Avalon')]);
  assert.equal(costed!.profitCents, 2 * (100000 - 30000));
});

test('sorting: slow sellers put the fewest units first, ties by net sales then name', () => {
  const rows = [
    toRow(recipe({ id: '1', title: 'B', actualSales: { lookbackDays: 30, fromDate: 'a', toDate: 'b', quantitySold: 2, netSalesCents: 500, grossSalesCents: 500, orderCount: 1 } }), 'St Alma'),
    toRow(recipe({ id: '2', title: 'A', actualSales: { lookbackDays: 30, fromDate: 'a', toDate: 'b', quantitySold: 2, netSalesCents: 500, grossSalesCents: 500, orderCount: 1 } }), 'St Alma'),
    toRow(recipe({ id: '3', title: 'C', actualSales: { lookbackDays: 30, fromDate: 'a', toDate: 'b', quantitySold: 9, netSalesCents: 100, grossSalesCents: 100, orderCount: 1 } }), 'St Alma')
  ];
  assert.deepEqual(sortRows(rows, 'units', false).map((r) => r.title), ['A', 'B', 'C']);
  assert.deepEqual(sortRows(rows, 'units', true).map((r) => r.title), ['C', 'A', 'B']);
  assert.deepEqual(sortRows(rows, 'name', false).map((r) => r.title), ['A', 'B', 'C']);
});
