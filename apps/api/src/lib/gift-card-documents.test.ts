import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeGiftCardSaleLines, saleDocumentType, summariseLines } from '@alma/shared';
import {
  applyIssuerGstStatus,
  cardBrandLabel,
  creditSeriesFor,
  giftCardDocumentIneligibleReason,
  giftCardSaleKey,
  maskGiftCardCode,
  paymentMethodSummary,
  paymentProviderForCard,
  planStripeRefundCredits,
  shouldReconcileRefundsOnIssue,
  promoCodeForDocument,
  stripeCheckoutSessionIdForDocument,
  stripePaymentIntentIdForCard,
  stripeRefundCreditReason,
  type GiftCardDocumentEligibility,
  type GiftCardPaymentFacts
} from './gift-card-documents.js';

const paidAt = new Date('2026-09-30T02:00:00.000Z');

// An online card, paid through Stripe Checkout with the 3.5% fee.
const card = (overrides: Partial<GiftCardDocumentEligibility> = {}): GiftCardDocumentEligibility => ({
  status: 'ACTIVE',
  testMode: false,
  amountPaidCents: 103_50,
  paidAt,
  tender: 'STRIPE',
  ...overrides
});

describe('which gift cards get a document', () => {
  it('an online card paid through Stripe does', () => {
    assert.equal(giftCardDocumentIneligibleReason(card()), null);
  });

  it('a counter sale taken in cash, EFTPOS or on the card terminal does', () => {
    for (const tender of ['CASH', 'EFTPOS', 'CARD']) {
      assert.equal(giftCardDocumentIneligibleReason(card({ tender, amountPaidCents: 100_00 })), null, tender);
    }
  });

  it('a GiftUp import does — the money was real, it just went through GiftUp', () => {
    assert.equal(giftCardDocumentIneligibleReason(card({ amountPaidCents: 50_00 })), null);
  });

  it('a card that was paid and later cancelled still does — a refund is a credit note, not a missing receipt', () => {
    assert.equal(giftCardDocumentIneligibleReason(card({ status: 'CANCELLED' })), null);
    assert.equal(giftCardDocumentIneligibleReason(card({ status: 'REDEEMED' })), null);
    assert.equal(giftCardDocumentIneligibleReason(card({ status: 'EXPIRED' })), null);
  });

  it('a test card does not, even though it has a paid date', () => {
    const reason = giftCardDocumentIneligibleReason(card({ testMode: true, amountPaidCents: 0, paidAt }));
    assert.match(reason ?? '', /test card/);
  });

  it('a test card does not, even with an amount on it', () => {
    assert.match(giftCardDocumentIneligibleReason(card({ testMode: true })) ?? '', /test card/);
  });

  it('a campaign reward card does not: paidAt is set but nothing was paid', () => {
    const reason = giftCardDocumentIneligibleReason(card({ amountPaidCents: 0, paidAt, tender: null }));
    assert.match(reason ?? '', /Nothing was paid/);
  });

  it('a donation does not: tender COMP, nothing paid, no paid date', () => {
    const reason = giftCardDocumentIneligibleReason(card({ tender: 'COMP', amountPaidCents: 0, paidAt: null }));
    assert.match(reason ?? '', /given away/);
  });

  it('a comped counter card does not', () => {
    assert.match(giftCardDocumentIneligibleReason(card({ tender: 'COMP', paidAt: null, amountPaidCents: 0 })) ?? '', /given away/);
  });

  it('a card with no recorded amount does not', () => {
    assert.match(giftCardDocumentIneligibleReason(card({ amountPaidCents: null })) ?? '', /Nothing was paid/);
    assert.match(giftCardDocumentIneligibleReason(card({ amountPaidCents: -5 })) ?? '', /Nothing was paid/);
  });

  it('an amount with no paid date does not', () => {
    assert.match(giftCardDocumentIneligibleReason(card({ paidAt: null })) ?? '', /no payment date/);
  });

  it('an unpaid checkout says it is awaiting payment, not that nothing was paid', () => {
    const reason = giftCardDocumentIneligibleReason(card({ status: 'PENDING_PAYMENT', amountPaidCents: null, paidAt: null }));
    assert.match(reason ?? '', /awaiting payment/);
  });

  it('accepts the paid date as an ISO string as well as a Date', () => {
    assert.equal(giftCardDocumentIneligibleReason(card({ paidAt: paidAt.toISOString() })), null);
  });
});

describe('how the money came in', () => {
  it('takes the tender for Stripe and counter sales', () => {
    assert.equal(paymentProviderForCard({ promoCodeSnapshot: null, tender: 'STRIPE' }), 'STRIPE');
    assert.equal(paymentProviderForCard({ promoCodeSnapshot: 'PHYSICAL_COUNTER', tender: 'CASH' }), 'CASH');
    assert.equal(paymentProviderForCard({ promoCodeSnapshot: 'PHYSICAL_COUNTER', tender: 'EFTPOS' }), 'EFTPOS');
    assert.equal(paymentProviderForCard({ promoCodeSnapshot: null, tender: 'CARD' }), 'CARD');
  });

  it('calls a GiftUp import GiftUp, whatever its tender says', () => {
    assert.equal(paymentProviderForCard({ promoCodeSnapshot: 'GIFTUP_IMPORT', tender: 'STRIPE' }), 'GIFTUP');
  });

  it('falls back to OTHER for anything it does not recognise', () => {
    assert.equal(paymentProviderForCard({ promoCodeSnapshot: null, tender: null }), 'OTHER');
    assert.equal(paymentProviderForCard({ promoCodeSnapshot: null, tender: 'COMP' }), 'OTHER');
    assert.equal(paymentProviderForCard({ promoCodeSnapshot: null, tender: 'BARTER' }), 'OTHER');
  });
});

describe('when Stripe may be asked about a card', () => {
  const facts = (overrides: Partial<GiftCardPaymentFacts> = {}): GiftCardPaymentFacts => ({
    tender: 'STRIPE',
    testMode: false,
    promoCodeSnapshot: null,
    stripePaymentIntentId: 'pi_3Qabc',
    ...overrides
  });

  it('a live Stripe card with a PaymentIntent may be looked up', () => {
    assert.equal(stripePaymentIntentIdForCard(facts()), 'pi_3Qabc');
  });

  it('a GiftUp import is never looked up, even though its tender says STRIPE', () => {
    assert.equal(stripePaymentIntentIdForCard(facts({ promoCodeSnapshot: 'GIFTUP_IMPORT' })), null);
  });

  it('a test card is never looked up', () => {
    assert.equal(stripePaymentIntentIdForCard(facts({ testMode: true })), null);
  });

  it('a counter sale is never looked up', () => {
    assert.equal(stripePaymentIntentIdForCard(facts({ tender: 'CASH' })), null);
    assert.equal(stripePaymentIntentIdForCard(facts({ tender: 'CARD' })), null);
  });

  it('a card with no PaymentIntent is never looked up', () => {
    assert.equal(stripePaymentIntentIdForCard(facts({ stripePaymentIntentId: null })), null);
    assert.equal(stripePaymentIntentIdForCard(facts({ stripePaymentIntentId: '  ' })), null);
  });

  it('copies only a real Checkout Session id onto a document', () => {
    assert.equal(stripeCheckoutSessionIdForDocument('cs_live_a1b2'), 'cs_live_a1b2');
    for (const synthetic of ['TEST-AB12CD34', 'physical:1759200000000', 'donation:2026:3', 'giftup:ALMA-1234', 'campaign:c1:ALMA-9', null]) {
      assert.equal(stripeCheckoutSessionIdForDocument(synthetic), null, String(synthetic));
    }
  });
});

describe('what the document calls the payment', () => {
  it('names the card from Stripe', () => {
    assert.equal(paymentMethodSummary('STRIPE', 'visa', '4242'), 'Visa ending 4242');
    assert.equal(paymentMethodSummary('STRIPE', 'amex', '0005'), 'American Express ending 0005');
    assert.equal(paymentMethodSummary('STRIPE', 'eftpos_au', '1234'), 'eftpos ending 1234');
  });

  it('says what it can when Stripe told it less', () => {
    assert.equal(paymentMethodSummary('STRIPE'), 'Stripe');
    assert.equal(paymentMethodSummary('STRIPE', 'visa', null), 'Visa');
    assert.equal(paymentMethodSummary('STRIPE', null, '4242'), 'Card ending 4242');
    assert.equal(paymentMethodSummary('STRIPE', 'unknown', null), 'Stripe');
  });

  it('names counter and imported payments plainly', () => {
    assert.equal(paymentMethodSummary('CASH'), 'Cash');
    assert.equal(paymentMethodSummary('EFTPOS'), 'EFTPOS');
    assert.equal(paymentMethodSummary('CARD'), 'Card (at the counter)');
    assert.equal(paymentMethodSummary('GIFTUP'), 'GiftUp');
    assert.equal(paymentMethodSummary('OTHER'), 'Other');
  });

  it('title-cases a brand it has not seen before', () => {
    assert.equal(cardBrandLabel('mastercard'), 'Mastercard');
    assert.equal(cardBrandLabel('new_brand'), 'New Brand');
    assert.equal(cardBrandLabel(''), null);
  });
});

describe('promo code on the discount line', () => {
  it('prints a real promo code', () => {
    assert.equal(promoCodeForDocument('SPRING10'), 'SPRING10');
  });

  it('ignores the origin markers that share the column', () => {
    for (const marker of ['GIFTUP_IMPORT', 'PHYSICAL_COUNTER', 'DONATION', 'CAMPAIGN_REWARD:cmg123', null, '']) {
      assert.equal(promoCodeForDocument(marker), null, String(marker));
    }
  });
});

describe('numbering and latches', () => {
  it('keys the live sale document by card id', () => {
    assert.equal(giftCardSaleKey('cmg1abc'), 'GIFT_CARD:cmg1abc');
  });

  it('numbers credit notes in the matching CN series', () => {
    assert.equal(creditSeriesFor('ALMA-INV'), 'ALMA-CN');
    assert.equal(creditSeriesFor('TCC-INV'), 'TCC-CN');
    // Only the trailing -INV is the sale marker.
    assert.equal(creditSeriesFor('INV-INV'), 'INV-CN');
    assert.equal(creditSeriesFor('ALMA'), 'ALMA-CN');
  });

  it('masks a card code down to its last four', () => {
    assert.equal(maskGiftCardCode('ALMA-22480BB1'), '***0BB1');
  });
});

describe('an issuer that is not registered for GST', () => {
  const lines = composeGiftCardSaleLines({
    code: 'ALMA-22480BB1',
    faceValueCents: 100_00,
    discountCents: 0,
    promoCode: null,
    amountPaidCents: 103_50,
    recipientName: null
  });

  it('leaves a registered issuer’s lines exactly as composed', () => {
    assert.equal(applyIssuerGstStatus(lines, true), lines);
    assert.equal(summariseLines(applyIssuerGstStatus(lines, true)).gstCents, 32);
  });

  it('charges no GST on anything, so the sale is a receipt', () => {
    const untaxed = applyIssuerGstStatus(lines, false);
    const totals = summariseLines(untaxed);
    assert.equal(totals.gstCents, 0);
    assert.equal(totals.taxableCents, 0);
    assert.equal(totals.totalCents, 103_50);
    assert.equal(totals.gstTreatment, 'FACE_VALUE_VOUCHER');
    assert.equal(saleDocumentType(totals, false), 'RECEIPT');
  });

  it('keeps every amount and description', () => {
    const untaxed = applyIssuerGstStatus(lines, false);
    assert.deepEqual(
      untaxed.map((line) => [line.description, line.amountCents]),
      lines.map((line) => [line.description, line.amountCents])
    );
  });
});

describe('which Stripe refunds still need a credit note', () => {
  const refund = (id: string, status: string, amount = 20_00) => ({ id, status, amount, created: 1_790_000_000, reason: null });

  it('credits a succeeded refund with no live note, once', () => {
    const plan = planStripeRefundCredits(
      [refund('re_a', 'succeeded'), refund('re_b', 'succeeded'), refund('re_c', 'pending')],
      [{ stripeRefundId: 're_a', number: 'ALMA-CN-000001', status: 'ISSUED' }]
    );
    assert.deepEqual(plan.toCredit.map((item) => item.id), ['re_b']);
    assert.deepEqual(plan.failedButCredited, []);
  });

  it('credits again a refund whose note was voided (a note raised by hand counts like any other)', () => {
    const plan = planStripeRefundCredits(
      [refund('re_a', 'succeeded')],
      [{ stripeRefundId: 're_a', number: 'ALMA-CN-000001', status: 'VOID' }]
    );
    assert.deepEqual(plan.toCredit.map((item) => item.id), ['re_a']);
  });

  it('never credits a failed refund, and flags one that already has a live note', () => {
    const plan = planStripeRefundCredits(
      [refund('re_a', 'failed'), refund('re_b', 'canceled'), refund('re_c', 'requires_action')],
      [
        { stripeRefundId: 're_a', number: 'ALMA-CN-000001', status: 'ISSUED' },
        { stripeRefundId: 're_c', number: 'ALMA-CN-000002', status: 'ISSUED' }
      ]
    );
    assert.deepEqual(plan.toCredit, []);
    assert.deepEqual(plan.failedButCredited.map((item) => [item.refund.id, item.noteNumber]), [['re_a', 'ALMA-CN-000001']]);
  });

  it('says why the money went back', () => {
    assert.equal(stripeRefundCreditReason({ reason: 'requested_by_customer' }), 'Refunded in Stripe (requested by customer)');
    assert.equal(stripeRefundCreditReason({ reason: null }), 'Refunded in Stripe');
  });
});

describe('Stripe refunds looked up when a document is issued', () => {
  const stripeSale = { provider: 'STRIPE', stripePaymentIntentId: 'pi_123' };

  it('never on the checkout path: the payment confirmed a moment ago and cannot have been refunded', () => {
    assert.equal(shouldReconcileRefundsOnIssue({ ...stripeSale, issueSource: 'AUTO_STRIPE' }), false);
  });

  it('when a document is issued by hand or by the catch-up job, so an earlier refund is credited', () => {
    assert.equal(shouldReconcileRefundsOnIssue({ ...stripeSale, issueSource: 'MANUAL' }), true);
    assert.equal(shouldReconcileRefundsOnIssue({ ...stripeSale, issueSource: 'CATCH_UP' }), true);
  });

  it('never for a sale Stripe did not take', () => {
    for (const provider of ['CASH', 'EFTPOS', 'CARD', 'GIFTUP', 'OTHER']) {
      assert.equal(shouldReconcileRefundsOnIssue({ provider, stripePaymentIntentId: 'pi_123', issueSource: 'MANUAL' }), false);
    }
    assert.equal(shouldReconcileRefundsOnIssue({ provider: 'STRIPE', stripePaymentIntentId: null, issueSource: 'MANUAL' }), false);
  });
});

describe('a voided Stripe credit note keeps its refund id but stops counting', () => {
  const refund = { id: 're_1', amount: 50_00, status: 'succeeded', created: 1, reason: null };

  it('a refund whose only note was voided is credited again', () => {
    const plan = planStripeRefundCredits([refund], [{ stripeRefundId: 're_1', number: 'ALMA-CN-000001', status: 'VOID' }]);
    assert.deepEqual(plan.toCredit.map((r) => r.id), ['re_1']);
  });

  it('a refund with a live note is not credited twice', () => {
    const plan = planStripeRefundCredits(
      [refund],
      [
        { stripeRefundId: 're_1', number: 'ALMA-CN-000001', status: 'VOID' },
        { stripeRefundId: 're_1', number: 'ALMA-CN-000002', status: 'ISSUED' }
      ]
    );
    assert.equal(plan.toCredit.length, 0);
  });
});
