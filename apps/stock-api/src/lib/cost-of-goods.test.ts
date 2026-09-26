import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessCogsComparability, summariseActualCogs, summariseCostOfGoods, summariseTheoreticalCogs } from './cost-of-goods.js';

const recipe = (over: { id: string; cost?: number | null; price?: number | null; qty?: number; net?: number; sold?: boolean }) => ({
  id: over.id,
  estimatedCost: over.cost === undefined ? 5 : over.cost,
  salePriceCents: over.price === undefined ? 2000 : over.price,
  actualSales: over.sold === false ? null : { quantitySold: over.qty ?? 10, netSalesCents: over.net ?? 18_000 }
});

// Like-for-like: same window, same venue set, every item sold is mapped.
const FULL_SCOPE = (totalItemSalesCents: number) => ({ periodMatches: true, venueMatches: true, totalItemSalesCents });

// The screen that started this: mapped sales $143,411.09, theoretical recipe
// cost ≈ $56,074 (39.1%), actual purchases in the window $4,948.78 with no
// stocktake bracketing it.
const SCREEN = {
  recipes: [recipe({ id: 'a', cost: 56_074, qty: 1, net: 14_341_109 })],
  actual: {
    cogsCents: 494_878,
    purchasesCents: 494_878,
    openingStockCents: 0,
    closingStockCents: 0,
    source: 'purchases_only' as const,
    quality: 'estimated' as const
  },
  scope: FULL_SCOPE(14_341_109)
};

const BOUNDED = {
  cogsCents: 5_000_000,
  purchasesCents: 4_800_000,
  openingStockCents: 1_000_000,
  closingStockCents: 800_000,
  source: 'stock_bounded' as const,
  quality: 'complete' as const
};

describe('the symptom', () => {
  it('keeps the theoretical percentage with the theoretical dollars; the actual % is withheld until like-for-like', () => {
    const summary = summariseCostOfGoods(SCREEN);
    assert.equal(summary.theoretical.percentOfMappedSales, 39.1);
    assert.equal(summary.actual.comparable, false);
    assert.equal(summary.actual.percentOfMappedSales, null);
  });

  it('purchases-only never poses as COGS: not comparable, no variance, no actual GP', () => {
    const summary = summariseCostOfGoods(SCREEN);
    assert.equal(summary.varianceCents, null);
    assert.equal(summary.variancePercent, null);
    assert.equal(summary.actual.grossProfitCents, null);
    assert.match(summary.actual.label, /Supplier bills only/);
    assert.match(summary.actual.comparability.reasons.join(' '), /supplier bills only/);
    // Theoretical GP is still a fact.
    assert.equal(summary.theoretical.grossProfitCents, 14_341_109 - 5_607_400);
  });

  it('a stocktake-bounded window with matching scope is comparable and carries the variance', () => {
    const summary = summariseCostOfGoods({ ...SCREEN, actual: BOUNDED });
    assert.equal(summary.actual.comparable, true);
    assert.deepEqual(summary.actual.comparability.reasons, []);
    assert.equal(summary.actual.percentOfMappedSales, Math.round((5_000_000 / 14_341_109) * 1000) / 10);
    assert.equal(summary.varianceCents, 5_000_000 - 5_607_400);
    assert.equal(summary.variancePercent, -10.8);
    assert.equal(summary.actual.grossProfitCents, 14_341_109 - 5_000_000);
    assert.equal(summary.actual.label, 'Opening stock + purchases − closing stock');
  });
});

describe('scope comparability — stocktake completeness is not enough', () => {
  it('partial mapping: a complete stocktake figure over the whole venue is not compared with a mapped subset', () => {
    // Only $18,000 of $60,000 sold is recipe-mapped; the actual figure
    // covers everything bought and counted for all $60,000.
    const summary = summariseCostOfGoods({
      recipes: [recipe({ id: 'taco', cost: 5, qty: 10, net: 18_000 })],
      actual: { ...BOUNDED, cogsCents: 20_000, purchasesCents: 20_000 },
      scope: FULL_SCOPE(60_000)
    });
    assert.equal(summary.theoretical.mappedSalesCents, 18_000);
    assert.equal(summary.actual.comparability.mappedSalesSharePercent, 30);
    assert.equal(summary.actual.comparable, false);
    assert.match(summary.actual.comparability.reasons.join(' '), /30% of item sales/);
    // Nothing that reads like "actual GP" or "variance" can exist for it.
    assert.equal(summary.actual.grossProfitCents, null);
    assert.equal(summary.actual.percentOfMappedSales, null);
    assert.equal(summary.varianceCents, null);
    // Theoretical remains stated on its own denominator.
    assert.equal(summary.theoretical.percentOfMappedSales, 27.8);
  });

  it('a venue-scoped actual figure against unfiltered mapped sales is a different venue set', () => {
    const summary = summariseCostOfGoods({
      recipes: [recipe({ id: 'taco', cost: 5, qty: 10, net: 18_000 })],
      actual: BOUNDED,
      scope: { periodMatches: true, venueMatches: false, totalItemSalesCents: 18_000 }
    });
    assert.equal(summary.actual.comparable, false);
    assert.match(summary.actual.comparability.reasons.join(' '), /different venue set/);
  });

  it('unknown total item sales cannot confirm coverage', () => {
    const c = assessCogsComparability({
      actual: BOUNDED,
      theoretical: summariseTheoreticalCogs([recipe({ id: 'taco' })]),
      scope: { periodMatches: true, venueMatches: true, totalItemSalesCents: null }
    });
    assert.equal(c.comparable, false);
    assert.equal(c.mappedSalesSharePercent, null);
    assert.match(c.reasons.join(' '), /unknown/);
  });

  it('exclusions on the theoretical side break like-for-like even at full mapping', () => {
    const c = assessCogsComparability({
      actual: BOUNDED,
      theoretical: summariseTheoreticalCogs([
        recipe({ id: 'taco', cost: 5, qty: 10, net: 18_000 }),
        recipe({ id: 'batch', cost: 25, qty: 10, net: 18_000 }) // excluded as suspect
      ]),
      scope: FULL_SCOPE(36_000)
    });
    assert.equal(c.comparable, false);
    assert.match(c.reasons.join(' '), /batch-costed/);
    // Half the item sales dropped out of the mapped denominator with it.
    assert.equal(c.mappedSalesSharePercent, 50);
  });

  it('lists every reason at once so the operator sees the whole gap', () => {
    const c = assessCogsComparability({
      actual: SCREEN.actual,
      theoretical: summariseTheoreticalCogs([recipe({ id: 'taco', cost: 0, qty: 10, net: 18_000 })]),
      scope: { periodMatches: false, venueMatches: false, totalItemSalesCents: 36_000 }
    });
    assert.equal(c.reasons.length, 5);
  });
});

describe('summariseTheoreticalCogs', () => {
  it('sums recipe cost × units over recipes that sold, and only their sales', () => {
    const t = summariseTheoreticalCogs([recipe({ id: 'taco', cost: 5, qty: 10, net: 18_000 }), recipe({ id: 'unsold', sold: false })]);
    assert.equal(t.cogsCents, 5_000);
    assert.equal(t.mappedSalesCents, 18_000);
    assert.equal(t.percentOfMappedSales, 27.8);
    assert.equal(t.mappedRecipes, 1);
    assert.equal(t.unmappedRecipes, 1);
  });

  it('excludes suspect batch-costed rows from both numerator and denominator, like Reports does', () => {
    const t = summariseTheoreticalCogs([
      recipe({ id: 'taco', cost: 5, qty: 10, net: 18_000 }),
      recipe({ id: 'batch', cost: 25, qty: 10, net: 18_000 })
    ]);
    assert.equal(t.suspectRecipes, 1);
    assert.equal(t.cogsCents, 5_000);
    assert.equal(t.mappedSalesCents, 18_000);
  });

  it('counts zero-cost recipes so the coverage of the percentage is visible', () => {
    const t = summariseTheoreticalCogs([recipe({ id: 'taco', cost: 5, qty: 10, net: 18_000 }), recipe({ id: 'uncosted', cost: 0, qty: 10, net: 18_000 })]);
    assert.equal(t.zeroCostRecipes, 1);
    assert.equal(t.percentOfMappedSales, 13.9);
  });
});

describe('summariseActualCogs', () => {
  it('names each purchases-only reason plainly', () => {
    const base = { cogsCents: 100, purchasesCents: 100, openingStockCents: 0, closingStockCents: 0, source: 'purchases_only' as const };
    const t = summariseTheoreticalCogs([recipe({ id: 'taco' })]);
    const scope = FULL_SCOPE(18_000);
    assert.match(summariseActualCogs({ ...base, quality: 'missing_opening' }, t, scope).label, /start of the window/);
    assert.match(summariseActualCogs({ ...base, quality: 'missing_closing' }, t, scope).label, /end of the window/);
    assert.match(summariseActualCogs({ ...base, quality: 'closing_implausible' }, t, scope).label, /reads higher/);
  });
});
