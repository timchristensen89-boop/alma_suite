import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BOTTLE_ML, marginPercent, pourCost, suspiciousPour } from './wine-cost.js';

describe('pourCost', () => {
  it('charges a full bottle at the bottle price', () => {
    assert.equal(pourCost(25, 750), 25);
  });

  it('divides a glass down by volume', () => {
    // Catalina Sounds: $17.50 a bottle, so a 150mL glass costs a fifth.
    assert.equal(pourCost(17.5, 150), 3.5);
    assert.equal(pourCost(17.5, 250), 5.83);
  });

  it('rounds to the cent rather than carrying fractions into a margin', () => {
    assert.equal(pourCost(26.88, 150), 5.38);
  });

  it('is zero for a wine with no cost, not NaN', () => {
    assert.equal(pourCost(0, 150), 0);
    assert.equal(pourCost(-5, 150), 0);
  });

  it('is zero for a pour with no size', () => {
    assert.equal(pourCost(25, 0), 0);
  });

  it('uses a 750mL bottle', () => {
    assert.equal(BOTTLE_ML, 750);
  });
});

describe('suspiciousPour', () => {
  it('accepts every pour up to a bottle', () => {
    assert.equal(suspiciousPour(150), false);
    assert.equal(suspiciousPour(750), false);
  });

  it('flags anything bigger, because the sheet does not say it is a magnum', () => {
    assert.equal(suspiciousPour(1500), true);
  });
});

describe('marginPercent', () => {
  it('is the share of the sale price left after cost', () => {
    assert.ok(Math.abs((marginPercent(20, 5) ?? 0) - 75) < 1e-9);
  });

  it('is NULL on a $0 inclusion rather than 0%', () => {
    // A banquet's included glass would otherwise report 0% margin and drag
    // the venue average down for a pour nobody was charged for.
    assert.equal(marginPercent(0, 5), null);
  });

  it('goes negative when a wine is sold under cost', () => {
    assert.ok(Math.abs((marginPercent(10, 15) ?? 0) + 50) < 1e-9);
  });
});
