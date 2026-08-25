import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LOYALTY_DEFAULTS,
  creditCentsFor,
  loyaltyEarnBaseCents,
  parseLoyaltySettings,
  pointsEarned,
  pointsNeededFor
} from './loyalty-maths.js';

const settings = { ...LOYALTY_DEFAULTS, active: true };

describe('loyalty settings parsing', () => {
  it('defaults an empty blob and never activates by accident', () => {
    const parsed = parseLoyaltySettings({});
    assert.equal(parsed.active, false);
    assert.equal(parsed.pointsPerDollar, 1);
    assert.equal(parsed.pointValueCents, 5);
  });

  it('rejects zero and negative rates back to defaults', () => {
    const parsed = parseLoyaltySettings({ pointsPerDollar: 0, pointValueCents: -3, active: true });
    assert.equal(parsed.pointsPerDollar, 1);
    assert.equal(parsed.pointValueCents, 5);
    assert.equal(parsed.active, true);
  });

  it('accepts minRedeemPoints of zero', () => {
    assert.equal(parseLoyaltySettings({ minRedeemPoints: 0 }).minRedeemPoints, 0);
  });
});

describe('earn base', () => {
  it('excludes gift-card top-ups and the points-paid portion', () => {
    assert.equal(
      loyaltyEarnBaseCents({ totalCents: 15000, giftCardLineCents: 5000, loyaltyPaidCents: 2000 }),
      8000
    );
  });

  it('never goes negative', () => {
    assert.equal(loyaltyEarnBaseCents({ totalCents: 5000, giftCardLineCents: 5000, loyaltyPaidCents: 2000 }), 0);
  });
});

describe('points arithmetic', () => {
  it('floors part-dollars on earn — the house rounds down', () => {
    assert.equal(pointsEarned(9999, settings), 99);
    assert.equal(pointsEarned(99, settings), 0);
  });

  it('ceils points needed on redeem — a redemption is never underfunded', () => {
    // 5c/point: $10.00 = 200 points, $10.01 = 201 points.
    assert.equal(pointsNeededFor(1000, settings), 200);
    assert.equal(pointsNeededFor(1001, settings), 201);
  });

  it('earn and redeem agree: credit of earned points never exceeds spend', () => {
    for (const cents of [1, 99, 100, 1550, 9999, 100000]) {
      const earned = pointsEarned(cents, settings);
      assert.ok(creditCentsFor(earned, settings) <= cents);
    }
  });
});
