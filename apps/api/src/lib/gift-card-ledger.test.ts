import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGiftCardLedger, giftCardLedgerBalances, giftCardOrigin } from './gift-card-ledger.js';

// Saturday 26 September 2026, 12:00 in Sydney (AEST +10). The venue month is
// September: 2026-08-31T14:00Z .. 2026-09-30T14:00Z.
const NOW = new Date('2026-09-26T02:00:00.000Z');

type Card = Parameters<typeof buildGiftCardLedger>[0]['cards'][number];
type Redemption = Parameters<typeof buildGiftCardLedger>[0]['redemptions'][number];

let seq = 0;
const card = (over: Partial<Card> = {}): Card => ({
  id: over.id ?? `card-${(seq += 1)}`,
  status: 'ACTIVE',
  testMode: false,
  initialValueCents: 10_000,
  balanceCents: 10_000,
  paidAt: '2026-09-05T03:00:00.000Z',
  promoCodeSnapshot: null,
  saleChannel: 'ONLINE',
  ...over
});
const redemption = (over: Partial<Redemption> & { giftCardId: string }): Redemption => ({
  status: 'COMPLETED',
  amountCents: 5_000,
  venue: 'St Alma',
  redeemedAt: '2026-09-10T09:00:00.000Z',
  cardTestMode: false,
  ...over
});

// The relationship every ledger must honour, whatever the fixture:
// issued = active balance + expired retained + recorded + unrecorded − over-recorded + cancelled written off.
function assertIdentity(ledger: ReturnType<typeof buildGiftCardLedger>) {
  const { issued, explained } = giftCardLedgerBalances(ledger);
  assert.equal(explained, issued, `ledger does not reconcile: ${JSON.stringify(ledger)}`);
}

// A representative register: two GiftUp imports (one partly used before the
// import, so no redemption row), an online card redeemed in Alma, a test
// card, a cancelled card, an expired card with balance, a donation and a
// campaign reward.
const CARDS: Card[] = [
  card({ id: 'giftup-a', promoCodeSnapshot: 'GIFTUP_IMPORT', initialValueCents: 20_000, balanceCents: 12_000, paidAt: '2025-12-20T00:00:00.000Z' }),
  card({ id: 'giftup-b', promoCodeSnapshot: 'GIFTUP_IMPORT', initialValueCents: 5_000, balanceCents: 5_000, paidAt: '2026-03-01T00:00:00.000Z' }),
  card({ id: 'online', initialValueCents: 10_000, balanceCents: 4_000 }), // 6,000 redeemed in Alma this month (rows below)
  card({ id: 'test', testMode: true, initialValueCents: 1_000, balanceCents: 1_000 }),
  card({ id: 'cancelled', status: 'CANCELLED', initialValueCents: 7_000, balanceCents: 0 }),
  card({ id: 'expired', status: 'EXPIRED', initialValueCents: 3_000, balanceCents: 2_500, paidAt: '2024-01-01T00:00:00.000Z' }),
  card({ id: 'donation', promoCodeSnapshot: 'DONATION', saleChannel: 'DONATION', paidAt: null, initialValueCents: 15_000, balanceCents: 15_000 }),
  card({ id: 'campaign', promoCodeSnapshot: 'CAMPAIGN_REWARD:abc', initialValueCents: 2_000, balanceCents: 2_000, paidAt: '2026-08-31T15:00:00.000Z' }), // 01:00 on 1 Sep in Sydney
  card({ id: 'redeemed', status: 'REDEEMED', initialValueCents: 8_000, balanceCents: 0, paidAt: '2026-08-10T00:00:00.000Z' })
];
const REDEMPTIONS: Redemption[] = [
  redemption({ giftCardId: 'online', amountCents: 4_000, venue: 'St Alma', redeemedAt: '2026-09-10T09:00:00.000Z' }),
  redemption({ giftCardId: 'online', amountCents: 2_000, venue: 'Alma Avalon', redeemedAt: '2026-08-31T15:30:00.000Z' }), // 01:30 on 1 Sep in Sydney
  redemption({ giftCardId: 'redeemed', amountCents: 8_000, venue: null, redeemedAt: '2026-08-15T05:00:00.000Z' }), // last month, unallocated
  redemption({ giftCardId: 'expired', amountCents: 500, venue: 'St Alma', redeemedAt: '2026-07-01T05:00:00.000Z' }), // before it expired
  redemption({ giftCardId: 'test', amountCents: 600, venue: 'St Alma', redeemedAt: '2026-09-12T05:00:00.000Z', cardTestMode: true }), // test card
  redemption({ giftCardId: 'online', amountCents: 900, venue: 'St Alma', redeemedAt: '2026-09-12T05:00:00.000Z', status: 'VOIDED' })
];

describe('buildGiftCardLedger', () => {
  const ledger = buildGiftCardLedger({ cards: CARDS, redemptions: REDEMPTIONS, now: NOW });

  it('reconciles: issued equals everything it became', () => {
    assertIdentity(ledger);
  });

  it('liability is the remaining balance on ACTIVE non-test cards, and the active count is over the same cards', () => {
    // GiftUp 12,000 + 5,000, online 4,000, donation 15,000, campaign 2,000.
    assert.equal(ledger.activeBalanceCents, 38_000);
    assert.equal(ledger.activeCards, 5);
  });

  it('keeps expired retained balance and test cards out of the liability, but visible', () => {
    assert.equal(ledger.expiredCards, 1);
    assert.equal(ledger.expiredRetainedCents, 2_500);
    assert.equal(ledger.testCards, 1);
  });

  it('issued and recorded are the same population: every activated card, whatever its status now', () => {
    // 20,000 + 5,000 + 10,000 + 7,000 (cancelled) + 3,000 (expired) + 15,000 + 2,000 + 8,000.
    assert.equal(ledger.issuedValueCents, 70_000);
    // 4,000 + 2,000 + 8,000 + 500 (on the expired card). Test and VOIDED rows excluded.
    assert.equal(ledger.redemptionsRecordedCents, 14_500);
  });

  it('explains drawdown card by card, so history on one card never offsets another', () => {
    // giftup-a: 8,000 drawn down before import, no rows → unrecorded.
    assert.equal(ledger.unrecordedDrawdownCents, 8_000);
    assert.equal(ledger.overRecordedCents, 0);
    // The cancelled card's 7,000 was never redeemed: written off, not "drawn down".
    assert.equal(ledger.cancelledWrittenOffCents, 7_000);
    assert.equal(ledger.recordedOnCancelledCents, 0);
    // Face − balance over the non-cancelled cards: 8,000 + 0 + 6,000 + 500 + 0 + 0 + 8,000.
    assert.equal(ledger.drawnDownCents, 22_500);
  });

  it('this month is the venue month, so an early-hours redemption on the 1st in Sydney counts', () => {
    assert.equal(ledger.redeemedThisMonthCents, 6_000);
    assert.equal(ledger.redeemedLastMonthCents, 8_000);
    // Online 10,000 + campaign 2,000 + the cancelled card's 7,000: issuance is
    // historical, so a card cancelled later was still issued this month.
    assert.equal(ledger.issuedThisMonthCents, 19_000);
    assert.equal(ledger.issuedThisMonthCards, 3);
    assert.equal(ledger.issuedLastMonthCents, 8_000);
  });

  it('the venue breakdown sums to the monthly and lifetime totals by construction', () => {
    assert.equal(ledger.redeemedByVenue.reduce((sum, row) => sum + row.monthCents, 0), ledger.redeemedThisMonthCents);
    assert.equal(ledger.redeemedByVenue.reduce((sum, row) => sum + row.lifetimeCents, 0), ledger.redemptionsRecordedCents);
  });

  it('explains the liability by origin so imported cards are visible', () => {
    const giftup = ledger.byOrigin.find((row) => row.origin === 'GIFTUP_IMPORT');
    assert.deepEqual(giftup, { origin: 'GIFTUP_IMPORT', activeCards: 2, activeBalanceCents: 17_000, issuedValueCents: 25_000 });
    assert.equal(ledger.byOrigin.reduce((sum, row) => sum + row.activeBalanceCents, 0), ledger.activeBalanceCents);
    assert.equal(ledger.byOrigin.reduce((sum, row) => sum + row.issuedValueCents, 0), ledger.issuedValueCents);
  });
});

describe('like-for-like populations (review fixtures)', () => {
  it("an expired card's recorded redemption cannot explain an active imported card's drawdown", () => {
    // Active GiftUp import: $100 face, $20 left, no rows. Expired card: $50 recorded.
    const ledger = buildGiftCardLedger({
      cards: [
        card({ id: 'import', promoCodeSnapshot: 'GIFTUP_IMPORT', initialValueCents: 10_000, balanceCents: 2_000 }),
        card({ id: 'old', status: 'EXPIRED', initialValueCents: 5_000, balanceCents: 0, paidAt: '2024-01-01T00:00:00.000Z' })
      ],
      redemptions: [redemption({ giftCardId: 'old', amountCents: 5_000, redeemedAt: '2024-06-01T00:00:00.000Z' })],
      now: NOW
    });
    // The old subtraction of scopes gave 80 − 50 = 30. The $80 is unexplained
    // whatever happened on the other card.
    assert.equal(ledger.unrecordedDrawdownCents, 8_000);
    assert.equal(ledger.redemptionsRecordedCents, 5_000);
    assert.equal(ledger.activeBalanceCents, 2_000);
    assert.equal(ledger.expiredRetainedCents, 0);
    assertIdentity(ledger);
  });

  it('a fully recorded redemption followed by expiry stays explained and leaves nothing retained', () => {
    const ledger = buildGiftCardLedger({
      cards: [card({ id: 'c', status: 'EXPIRED', initialValueCents: 10_000, balanceCents: 0 })],
      redemptions: [redemption({ giftCardId: 'c', amountCents: 10_000 })],
      now: NOW
    });
    assert.equal(ledger.redemptionsRecordedCents, 10_000);
    assert.equal(ledger.unrecordedDrawdownCents, 0);
    assert.equal(ledger.expiredRetainedCents, 0);
    assert.equal(ledger.activeBalanceCents, 0);
    assertIdentity(ledger);
  });

  it('a fully recorded redemption followed by cancellation is a recorded redemption, not a write-off', () => {
    const ledger = buildGiftCardLedger({
      cards: [card({ id: 'c', status: 'CANCELLED', initialValueCents: 10_000, balanceCents: 0 })],
      redemptions: [redemption({ giftCardId: 'c', amountCents: 10_000 })],
      now: NOW
    });
    assert.equal(ledger.recordedOnCancelledCents, 10_000);
    assert.equal(ledger.cancelledWrittenOffCents, 0);
    assert.equal(ledger.unrecordedDrawdownCents, 0);
    assertIdentity(ledger);
  });

  it('a partly redeemed card that is then cancelled splits into recorded and written off', () => {
    const ledger = buildGiftCardLedger({
      cards: [card({ id: 'c', status: 'CANCELLED', initialValueCents: 10_000, balanceCents: 0 })],
      redemptions: [redemption({ giftCardId: 'c', amountCents: 3_000 })],
      now: NOW
    });
    assert.equal(ledger.recordedOnCancelledCents, 3_000);
    assert.equal(ledger.cancelledWrittenOffCents, 7_000);
    assertIdentity(ledger);
  });

  it('rows that exceed a card\'s own drawdown are stated as over-recorded, never clamped away', () => {
    const ledger = buildGiftCardLedger({
      cards: [card({ id: 'c', initialValueCents: 10_000, balanceCents: 8_000 })],
      redemptions: [redemption({ giftCardId: 'c', amountCents: 5_000 })],
      now: NOW
    });
    assert.equal(ledger.overRecordedCents, 3_000);
    assert.equal(ledger.unrecordedDrawdownCents, 0);
    assertIdentity(ledger);
  });

  it('current redeemable balance is untouched by historical status changes', () => {
    const base = [card({ id: 'live', initialValueCents: 10_000, balanceCents: 6_000 })];
    const before = buildGiftCardLedger({ cards: base, redemptions: [redemption({ giftCardId: 'live', amountCents: 4_000 })], now: NOW });
    const after = buildGiftCardLedger({
      cards: [...base, card({ id: 'gone', status: 'CANCELLED', initialValueCents: 50_000, balanceCents: 0 })],
      redemptions: [redemption({ giftCardId: 'live', amountCents: 4_000 })],
      now: NOW
    });
    assert.equal(after.activeBalanceCents, before.activeBalanceCents);
    assert.equal(after.activeCards, before.activeCards);
    assert.equal(after.issuedValueCents, before.issuedValueCents + 50_000);
    assert.equal(after.cancelledWrittenOffCents, 50_000);
    assertIdentity(after);
  });
});

describe('giftCardOrigin', () => {
  it('reads origins off the same markers the purchase report uses', () => {
    assert.equal(giftCardOrigin({ promoCodeSnapshot: 'GIFTUP_IMPORT', saleChannel: 'ONLINE' }), 'GIFTUP_IMPORT');
    assert.equal(giftCardOrigin({ promoCodeSnapshot: 'PHYSICAL_COUNTER', saleChannel: 'COUNTER' }), 'PHYSICAL_COUNTER');
    assert.equal(giftCardOrigin({ promoCodeSnapshot: null, saleChannel: 'COUNTER' }), 'COUNTER');
    assert.equal(giftCardOrigin({ promoCodeSnapshot: null, saleChannel: 'CORPORATE' }), 'CORPORATE');
    assert.equal(giftCardOrigin({ promoCodeSnapshot: 'CAMPAIGN_REWARD:x', saleChannel: 'ONLINE' }), 'CAMPAIGN_REWARD');
    assert.equal(giftCardOrigin({ promoCodeSnapshot: null, saleChannel: 'DONATION' }), 'DONATION');
  });
});
