import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { XERO_BAS_EXCLUDED, buildPosXeroLineItems, posLineBucket } from './pos-xero-lines.js';

// A POS gift card line as pos.service writes it: no recipe, no course.
const GIFT_LINE = { totalCents: 100_00, isGiftCard: true, course: null };

/** The bucketing pushPosDayToXero used before this fix, verbatim. */
function legacyBucket(line: { course?: string | null }, recipeBucket: 'FOOD' | 'BEVERAGE' | null) {
  return recipeBucket ?? (line.course === 'Drinks' ? 'BEVERAGE' : 'FOOD');
}

const day = {
  foodIncCents: 330_00,
  beverageIncCents: 110_00,
  giftCardIncCents: 0,
  surchargeIncCents: 11_00,
  discountCents: 22_00,
  refundCents: 0,
  tipCents: 15_00
};
const accounts = { sales: '200', tips: '820', giftCard: '' };

describe('POS gift card sales in the Xero daily invoice', () => {
  it('reproduces the bug: the old bucketing put a gift card sale in FOOD', () => {
    assert.equal(legacyBucket(GIFT_LINE, null), 'FOOD');
  });

  it('classifies a gift card line as a gift card, whatever its recipe or course', () => {
    assert.equal(posLineBucket(GIFT_LINE, null), 'GIFT_CARD');
    assert.equal(posLineBucket({ ...GIFT_LINE, course: 'Drinks' }, 'BEVERAGE'), 'GIFT_CARD');
  });

  it('keeps every other line in its kitchen/bar bucket exactly as before', () => {
    const cases: Array<[{ totalCents: number; isGiftCard?: boolean; course: string | null }, 'FOOD' | 'BEVERAGE' | null]> = [
      [{ totalCents: 1, course: 'Mains' }, null],
      [{ totalCents: 1, course: 'Drinks' }, null],
      [{ totalCents: 1, course: null }, 'BEVERAGE'],
      [{ totalCents: 1, course: 'Drinks' }, 'FOOD'],
      [{ totalCents: 1, isGiftCard: false, course: null }, null]
    ];
    for (const [line, recipe] of cases) {
      assert.equal(posLineBucket(line, recipe), legacyBucket(line, recipe));
    }
  });

  it('never exports gift card value as Food with GST', () => {
    for (const giftCard of ['', '2150']) {
      const { lineItems } = buildPosXeroLineItems({ ...day, giftCardIncCents: 100_00 }, { ...accounts, giftCard }, '2026-10-01');
      const food = lineItems.find((line) => line.Description.startsWith('Food sales'));
      assert.equal(food?.UnitAmount, 300); // $330 inc GST → $300 ex, unchanged by the $100 voucher
      assert.ok(lineItems.every((line) => line.TaxType !== 'OUTPUT' || !/gift/i.test(line.Description)));
    }
  });

  it('posts gift card sales in full, BAS excluded, to the configured liability account', () => {
    const { lineItems, giftCardNotPostedCents } = buildPosXeroLineItems({ ...day, giftCardIncCents: 100_00 }, { ...accounts, giftCard: '2150' }, '2026-10-01');
    const gift = lineItems.find((line) => /gift/i.test(line.Description));
    assert.deepEqual(gift, {
      Description: 'Gift cards sold (voucher liability) — 2026-10-01',
      Quantity: 1,
      UnitAmount: 100,
      AccountCode: '2150',
      TaxType: XERO_BAS_EXCLUDED
    });
    assert.equal(giftCardNotPostedCents, 0);
  });

  it('with no liability account set, leaves gift card sales off the invoice and reports the amount — no account is invented', () => {
    const { lineItems, giftCardNotPostedCents } = buildPosXeroLineItems({ ...day, giftCardIncCents: 100_00 }, accounts, '2026-10-01');
    assert.ok(!lineItems.some((line) => /gift/i.test(line.Description)));
    assert.equal(giftCardNotPostedCents, 100_00);
  });

  it('produces the same invoice as before on a day with no gift card sales', () => {
    const { lineItems, giftCardNotPostedCents } = buildPosXeroLineItems(day, { ...accounts, giftCard: '2150' }, '2026-10-01');
    assert.deepEqual(
      lineItems.map((line) => [line.Description, line.UnitAmount, line.AccountCode, line.TaxType]),
      [
        ['Food sales — 2026-10-01', 300, '200', 'OUTPUT'],
        ['Beverage sales — 2026-10-01', 100, '200', 'OUTPUT'],
        ['Surcharge', 10, '200', 'OUTPUT'],
        ['Discounts and comps', -20, '200', 'OUTPUT'],
        ['Card tips (payable to staff)', 15, '820', 'NONE']
      ]
    );
    assert.equal(giftCardNotPostedCents, 0);
  });
});
