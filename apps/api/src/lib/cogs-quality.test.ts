import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blendedTheoreticalCogsPct, isSuspectRecipeCost, UNMAPPED_TAKINGS_COGS_PCT } from './cogs-quality.js';

describe('isSuspectRecipeCost', () => {
  it('flags recipes that cost as much as or more than they sell for', () => {
    // Guacamole: $86.94/serve recipe cost, sells for $16 — a 2-tray batch.
    assert.equal(isSuspectRecipeCost(8694, 1600 * 40, 40), true);
    // Coconut Margarita: $180.71/serve (a 1L tequila batch), $22 each.
    assert.equal(isSuspectRecipeCost(18071, 2200 * 76, 76), true);
    // Exactly break-even is still suspect (>=).
    assert.equal(isSuspectRecipeCost(1600, 1600, 1), true);
  });

  it('passes normal profitable dishes', () => {
    // Classic Margarita: $3.40 cost, $22 sale.
    assert.equal(isSuspectRecipeCost(340, 2200 * 585, 585), false);
    // A thin-margin dish is NOT suspect as long as it clears its cost.
    assert.equal(isSuspectRecipeCost(1500, 1600, 1), false);
  });

  it('is inert on missing/zero inputs', () => {
    assert.equal(isSuspectRecipeCost(0, 1600, 5), false);
    assert.equal(isSuspectRecipeCost(500, 0, 5), false);
    assert.equal(isSuspectRecipeCost(500, 1600, 0), false);
    assert.equal(isSuspectRecipeCost(-5, 1600, 5), false);
  });
});

describe('blendedTheoreticalCogsPct', () => {
  it('blends mapped recipe cost with the beverage-resale rate for the rest', () => {
    // Mapped slice: $9,000 cost on $50,000 net = 18%, and it covers half of a
    // $100,000 week → 18*0.5 + 38*0.5 = 28%.
    assert.equal(
      blendedTheoreticalCogsPct({ mappedCostCents: 900_000, mappedNetCents: 5_000_000, totalSalesCents: 10_000_000 }),
      28
    );
  });

  it('returns null when the mapped slice is too thin to trust', () => {
    // Only 10% of takings are recipe-mapped — below the 25% floor.
    assert.equal(
      blendedTheoreticalCogsPct({ mappedCostCents: 100_000, mappedNetCents: 1_000_000, totalSalesCents: 10_000_000 }),
      null
    );
  });

  it('clamps to the 18-45% sanity band', () => {
    // Absurdly cheap mapped items, fully mapped → clamps up to 18.
    assert.equal(
      blendedTheoreticalCogsPct({ mappedCostCents: 10, mappedNetCents: 1_000_000, totalSalesCents: 1_000_000 }),
      18
    );
    // Very dear mapped items, fully mapped → clamps down to 45.
    assert.equal(
      blendedTheoreticalCogsPct({ mappedCostCents: 900_000, mappedNetCents: 1_000_000, totalSalesCents: 1_000_000 }),
      45
    );
  });

  it('guards divide-by-zero', () => {
    assert.equal(blendedTheoreticalCogsPct({ mappedCostCents: 0, mappedNetCents: 0, totalSalesCents: 100 }), null);
    assert.equal(blendedTheoreticalCogsPct({ mappedCostCents: 100, mappedNetCents: 100, totalSalesCents: 0 }), null);
  });

  it('exposes the beverage rate as a documented constant', () => {
    assert.equal(UNMAPPED_TAKINGS_COGS_PCT, 38);
  });
});
