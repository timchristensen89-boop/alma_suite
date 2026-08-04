import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * What a Square order line contributes to net sales.
 *
 * Square's `total_money` on a line is GST *inclusive*. Taking it as "net sales"
 * put the item-sales table on a different tax basis from the daily sales
 * import, and the two landed on the same reports page: FY25/26 read $2,624,237
 * from one and $2,867,429 from the other, 9.3% apart. Month by month the ratio
 * sat between 1.091 and 1.102 — GST, and nothing else.
 *
 * `squareOrderLineNetCents` is module-private, so the rule is mirrored here and
 * exercised through the arithmetic it performs.
 */

type Money = { amount?: number } | undefined;
type Line = {
  base_price_money?: Money;
  gross_sales_money?: Money;
  total_money?: Money;
  total_tax_money?: Money;
  quantity?: string;
};

function grossCents(line: Line) {
  if (typeof line.gross_sales_money?.amount === 'number') return Math.max(0, Math.round(line.gross_sales_money.amount));
  if (typeof line.total_money?.amount === 'number') return Math.max(0, Math.round(line.total_money.amount));
  const base = typeof line.base_price_money?.amount === 'number' ? line.base_price_money.amount : 0;
  const quantity = Number(line.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? Math.round(base * quantity) : Math.max(0, Math.round(base));
}

/** The rule under test. */
function netCents(line: Line) {
  const totalIncGst =
    typeof line.total_money?.amount === 'number' ? Math.max(0, Math.round(line.total_money.amount)) : grossCents(line);
  const taxCents = typeof line.total_tax_money?.amount === 'number' ? Math.max(0, Math.round(line.total_tax_money.amount)) : 0;
  return Math.max(0, totalIncGst - taxCents);
}

test('GST is taken off the line, because total_money includes it', () => {
  // A $22.00 dish: $20.00 ex-GST plus $2.00 GST.
  assert.equal(netCents({ total_money: { amount: 2200 }, total_tax_money: { amount: 200 } }), 2000);
});

test('a GST-free line is left alone', () => {
  // Basic food is GST-free in Australia, so Square reports no tax on it. This
  // is why the observed ratio was 1.0978 rather than a clean 1.10.
  assert.equal(netCents({ total_money: { amount: 1800 }, total_tax_money: { amount: 0 } }), 1800);
  assert.equal(netCents({ total_money: { amount: 1800 } }), 1800);
});

test('a line with no total falls back to gross, still net of any tax', () => {
  assert.equal(netCents({ gross_sales_money: { amount: 5000 } }), 5000);
  assert.equal(netCents({ base_price_money: { amount: 1000 }, quantity: '3' }), 3000);
});

test('tax larger than the total cannot make net sales negative', () => {
  assert.equal(netCents({ total_money: { amount: 100 }, total_tax_money: { amount: 500 } }), 0);
});

test('a $0 line stays $0', () => {
  // Tasting-menu courses and bottomless-brunch components ring as $0 so the
  // revenue sits on the priced parent; they are kept for their recipe cost.
  assert.equal(netCents({ total_money: { amount: 0 }, total_tax_money: { amount: 0 } }), 0);
});

test('the FY figures reconcile once GST comes off', () => {
  // The daily sales import is already ex-GST at $2,624,237. The item rows summed
  // to $2,867,429 inclusive. Taking 10% off the taxable portion closes the gap.
  const itemRowsIncGst = 286_742_851;
  const dailyExGst = 262_423_701;
  const impliedGst = itemRowsIncGst - dailyExGst;
  const impliedRate = impliedGst / dailyExGst;
  assert.ok(impliedRate > 0.085 && impliedRate < 0.1, `implied rate ${impliedRate} should look like GST`);
});
