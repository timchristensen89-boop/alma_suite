import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGiftCardLedger, giftCardOrigin } from './gift-card-ledger.js';

// Saturday 26 September 2026, 12:00 in Sydney (AEST +10). The venue month is
// September: 2026-08-31T14:00Z .. 2026-09-30T14:00Z.
const NOW = new Date('2026-09-26T02:00:00.000Z');

type Card = Parameters<typeof buildGiftCardLedger>[0]['cards'][number];
type Redemption = Parameters<typeof buildGiftCardLedger>[0]['redemptions'][number];

const card = (over: Partial<Card> = {}): Card => ({
  status: 'ACTIVE',
  testMode: false,
  initialValueCents: 10_000,
  balanceCents: 10_000,
  paidAt: '2026-09-05T03:00:00.000Z',
  promoCodeSnapshot: null,
  saleChannel: 'ONLINE',
  ...over
});
const redemption = (over: Partial<Redemption> = {}): Redemption => ({
  status: 'COMPLETED',
  amountCents: 5_000,
  venue: 'St Alma',
  redeemedAt: '2026-09-10T09:00:00.000Z',
  cardTestMode: false,
  ...over
});

// A representative register: two GiftUp imports (one partly used before the
// import, so no redemption row), an online card redeemed in Alma, a test
// card, a cancelled card, an expired card with balance, a donation and a
// campaign reward.
const CARDS: Card[] = [
  card({ promoCodeSnapshot: 'GIFTUP_IMPORT', initialValueCents: 20_000, balanceCents: 12_000, paidAt: '2025-12-20T00:00:00.000Z' }),
  card({ promoCodeSnapshot: 'GIFTUP_IMPORT', initialValueCents: 5_000, balanceCents: 5_000, paidAt: '2026-03-01T00:00:00.000Z' }),
  card({ initialValueCents: 10_000, balanceCents: 4_000 }), // 6,000 redeemed in Alma this month (rows below)
  card({ testMode: true, initialValueCents: 1_000, balanceCents: 1_000 }),
  card({ status: 'CANCELLED', initialValueCents: 7_000, balanceCents: 0 }),
  card({ status: 'EXPIRED', initialValueCents: 3_000, balanceCents: 2_500, paidAt: '2024-01-01T00:00:00.000Z' }),
  card({ promoCodeSnapshot: 'DONATION', saleChannel: 'DONATION', paidAt: null, initialValueCents: 15_000, balanceCents: 15_000 }),
  card({ promoCodeSnapshot: 'CAMPAIGN_REWARD:abc', initialValueCents: 2_000, balanceCents: 2_000, paidAt: '2026-08-31T15:00:00.000Z' }), // 01:00 on 1 Sep in Sydney
  card({ status: 'REDEEMED', initialValueCents: 8_000, balanceCents: 0, paidAt: '2026-08-10T00:00:00.000Z' })
];
const REDEMPTIONS: Redemption[] = [
  redemption({ amountCents: 4_000, venue: 'St Alma', redeemedAt: '2026-09-10T09:00:00.000Z' }),
  redemption({ amountCents: 2_000, venue: 'Alma Avalon', redeemedAt: '2026-08-31T15:30:00.000Z' }), // 01:30 on 1 Sep in Sydney
  redemption({ amountCents: 8_000, venue: null, redeemedAt: '2026-08-15T05:00:00.000Z' }), // last month, unallocated
  redemption({ amountCents: 600, venue: 'St Alma', redeemedAt: '2026-09-12T05:00:00.000Z', cardTestMode: true }), // test card
  redemption({ amountCents: 900, venue: 'St Alma', redeemedAt: '2026-09-12T05:00:00.000Z', status: 'VOIDED' })
];

describe('buildGiftCardLedger', () => {
  const ledger = buildGiftCardLedger({ cards: CARDS, redemptions: REDEMPTIONS, now: NOW });

  it('liability is the remaining balance on ACTIVE non-test cards, and the active count is over the same cards', () => {
    // GiftUp 12,000 + 5,000, online 4,000, donation 15,000, campaign 2,000.
    assert.equal(ledger.activeBalanceCents, 38_000);
    assert.equal(ledger.activeCards, 5);
    // The header and the tile must agree because they read these two fields.
  });

  it('keeps expired retained balance and test cards out of the liability, but visible', () => {
    assert.equal(ledger.expiredCards, 1);
    assert.equal(ledger.expiredRetainedCents, 2_500);
    assert.equal(ledger.testCards, 1);
  });

  it('separates drawdown with a redemption row from drawdown without one', () => {
    // Issued live: 20,000 + 5,000 + 10,000 + 15,000 + 2,000 + 8,000 = 60,000.
    assert.equal(ledger.issuedValueCents, 60_000);
    // Live balance: 12,000 + 5,000 + 4,000 + 15,000 + 2,000 + 0 = 38,000.
    assert.equal(ledger.drawnDownCents, 22_000);
    // Recorded COMPLETED non-test redemptions: 4,000 + 2,000 + 8,000.
    assert.equal(ledger.redemptionsRecordedCents, 14_000);
    // The GiftUp card's 8,000 pre-import drawdown has no row behind it.
    assert.equal(ledger.unrecordedDrawdownCents, 8_000);
  });

  it('this month is the venue month, so an early-hours redemption on the 1st in Sydney counts', () => {
    // 15:30Z on 31 Aug is 01:30 on 1 Sep in Sydney — inside September for
    // the venue, outside it for a UTC server month and for a Europe browser.
    assert.equal(ledger.redeemedThisMonthCents, 6_000);
    assert.equal(ledger.redeemedLastMonthCents, 8_000);
    assert.equal(ledger.issuedThisMonthCents, 12_000);
    assert.equal(ledger.issuedThisMonthCards, 2);
    assert.equal(ledger.issuedLastMonthCents, 8_000);
  });

  it('the venue breakdown sums to the monthly total by construction', () => {
    const venueMonthSum = ledger.redeemedByVenue.reduce((sum, row) => sum + row.monthCents, 0);
    assert.equal(venueMonthSum, ledger.redeemedThisMonthCents);
    const venueLifetimeSum = ledger.redeemedByVenue.reduce((sum, row) => sum + row.lifetimeCents, 0);
    assert.equal(venueLifetimeSum, ledger.redemptionsRecordedCents);
    assert.deepEqual(
      ledger.redeemedByVenue.map((row) => row.venue),
      ['Unallocated', 'St Alma', 'Alma Avalon']
    );
  });

  it('voided and test-card redemptions are outside every redemption figure', () => {
    assert.equal(ledger.redeemedByVenue.find((row) => row.venue === 'St Alma')?.lifetimeCents, 4_000);
  });

  it('explains the liability by origin so imported cards are visible', () => {
    const giftup = ledger.byOrigin.find((row) => row.origin === 'GIFTUP_IMPORT');
    assert.deepEqual(giftup, { origin: 'GIFTUP_IMPORT', activeCards: 2, activeBalanceCents: 17_000, issuedValueCents: 25_000 });
    const total = ledger.byOrigin.reduce((sum, row) => sum + row.activeBalanceCents, 0);
    assert.equal(total, ledger.activeBalanceCents);
  });

  it('reads origins off the same markers the purchase report uses', () => {
    assert.equal(giftCardOrigin({ promoCodeSnapshot: 'GIFTUP_IMPORT', saleChannel: 'ONLINE' }), 'GIFTUP_IMPORT');
    assert.equal(giftCardOrigin({ promoCodeSnapshot: 'PHYSICAL_COUNTER', saleChannel: 'COUNTER' }), 'PHYSICAL_COUNTER');
    assert.equal(giftCardOrigin({ promoCodeSnapshot: null, saleChannel: 'COUNTER' }), 'COUNTER');
    assert.equal(giftCardOrigin({ promoCodeSnapshot: 'CAMPAIGN_REWARD:x', saleChannel: 'ONLINE' }), 'CAMPAIGN_REWARD');
    assert.equal(giftCardOrigin({ promoCodeSnapshot: null, saleChannel: 'DONATION' }), 'DONATION');
  });
});
