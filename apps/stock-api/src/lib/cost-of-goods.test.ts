import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summariseActualCogs, summariseCostOfGoods, summariseTheoreticalCogs } from './cost-of-goods.js';

const recipe = (over: { id: string; cost?: number | null; price?: number | null; qty?: number; net?: number; sold?: boolean }) => ({
  id: over.id,
  estimatedCost: over.cost === undefined ? 5 : over.cost,
  salePriceCents: over.price === undefined ? 2000 : over.price,
  actualSales: over.sold === false ? null : { quantitySold: over.qty ?? 10, netSalesCents: over.net ?? 18_000 }
});

// The screen that started this: mapped sales $143,411.09, theoretical recipe
// cost ≈ $56,074 (39.1%), actual purchases in the window $4,948.78 with no
// stocktake bracketing it.
const SCREEN = {
  recipes: [
    recipe({ id: 'a', cost: 56_074, qty: 1, net: 14_341_109 })
  ],
  actual: {
    cogsCents: 494_878,
    purchasesCents: 494_878,
    openingStockCents: 0,
    closingStockCents: 0,
    source: 'purchases_only' as const,
    quality: 'estimated' as const
  }
};

describe('the symptom', () => {
  it('keeps the theoretical percentage with the theoretical dollars and the actual with the actual', () => {
    const summary = summariseCostOfGoods(SCREEN);
    assert.equal(summary.theoretical.percentOfMappedSales, 39.1);
    assert.equal(summary.actual.percentOfMappedSales, 3.5);
    // Whatever the screen shows as "$4,948.78 · X% of sales", X must be the
    // ratio of those two displayed numbers.
    assert.equal(Math.round((summary.actual.cogsCents / summary.theoretical.mappedSalesCents) * 1000) / 10, summary.actual.percentOfMappedSales);
  });

  it('purchases-only never poses as COGS: not comparable, no variance, no actual GP', () => {
    const summary = summariseCostOfGoods(SCREEN);
    assert.equal(summary.actual.comparable, false);
    assert.equal(summary.varianceCents, null);
    assert.equal(summary.variancePercent, null);
    assert.equal(summary.actual.grossProfitCents, null);
    assert.match(summary.actual.label, /Supplier bills only/);
    // Theoretical GP is still a fact.
    assert.equal(summary.theoretical.grossProfitCents, 14_341_109 - 5_607_400);
  });

  it('a stocktake-bounded window is comparable and carries the variance', () => {
    const summary = summariseCostOfGoods({
      ...SCREEN,
      actual: { cogsCents: 5_000_000, purchasesCents: 4_800_000, openingStockCents: 1_000_000, closingStockCents: 800_000, source: 'stock_bounded', quality: 'complete' }
    });
    assert.equal(summary.actual.comparable, true);
    assert.equal(summary.varianceCents, 5_000_000 - 5_607_400);
    assert.equal(summary.variancePercent, -10.8);
    assert.equal(summary.actual.grossProfitCents, 14_341_109 - 5_000_000);
    assert.equal(summary.actual.label, 'Opening stock + purchases − closing stock');
  });
});

describe('summariseTheoreticalCogs', () => {
  it('sums recipe cost × units over recipes that sold, and only their sales', () => {
    const t = summariseTheoreticalCogs([
      recipe({ id: 'taco', cost: 5, qty: 10, net: 18_000 }),
      recipe({ id: 'unsold', sold: false })
    ]);
    assert.equal(t.cogsCents, 5_000);
    assert.equal(t.mappedSalesCents, 18_000);
    assert.equal(t.percentOfMappedSales, 27.8);
    assert.equal(t.mappedRecipes, 1);
    assert.equal(t.unmappedRecipes, 1);
  });

  it('excludes suspect batch-costed rows from both numerator and denominator, like Reports does', () => {
    const t = summariseTheoreticalCogs([
      recipe({ id: 'taco', cost: 5, qty: 10, net: 18_000 }),
      // A 1L-of-spirit "per serve" cost: $25 a serve on $18 of sales each.
      recipe({ id: 'batch', cost: 25, qty: 10, net: 18_000 })
    ]);
    assert.equal(t.suspectRecipes, 1);
    assert.equal(t.cogsCents, 5_000);
    assert.equal(t.mappedSalesCents, 18_000);
  });

  it('counts zero-cost recipes so the coverage of the percentage is visible', () => {
    const t = summariseTheoreticalCogs([
      recipe({ id: 'taco', cost: 5, qty: 10, net: 18_000 }),
      recipe({ id: 'uncosted', cost: 0, qty: 10, net: 18_000 })
    ]);
    assert.equal(t.zeroCostRecipes, 1);
    // Its sales dilute the percentage — which is why the count is reported.
    assert.equal(t.percentOfMappedSales, 13.9);
  });
});

describe('summariseActualCogs', () => {
  it('names each purchases-only reason plainly', () => {
    const base = { cogsCents: 100, purchasesCents: 100, openingStockCents: 0, closingStockCents: 0, source: 'purchases_only' as const };
    assert.match(summariseActualCogs({ ...base, quality: 'missing_opening' }, 1000).label, /start of the window/);
    assert.match(summariseActualCogs({ ...base, quality: 'missing_closing' }, 1000).label, /end of the window/);
    assert.match(summariseActualCogs({ ...base, quality: 'closing_implausible' }, 1000).label, /reads higher/);
  });
});
