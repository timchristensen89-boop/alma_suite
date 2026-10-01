import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  UNCONFIRMED_CHECKOUT_REFUND_NOTE,
  checkoutSessionDisposition,
  isSystemCancelledBeforePayment,
  paidCheckoutAction
} from './checkout-session-state.js';

// The sessions Stripe actually returns at each point of a counter sale.
const OPEN = { mode: 'payment', status: 'open', payment_status: 'unpaid' };
const PAID = { mode: 'payment', status: 'complete', payment_status: 'paid' };
const PROCESSING = { mode: 'payment', status: 'complete', payment_status: 'unpaid' };
const EXPIRED = { mode: 'payment', status: 'expired', payment_status: 'unpaid' };

/**
 * The condition getByCheckoutSession used before this fix, kept verbatim so
 * the bug stays on record: it called a session "not confirmed" — and
 * cancelled the card — on payment_status 'unpaid' alone.
 */
function legacyCancelsCard(session: { status: string; payment_status: string }) {
  return session.status === 'expired' || session.payment_status === 'unpaid' || session.payment_status === 'no_payment_required';
}

describe('a counter sale while the customer is still paying', () => {
  it('reproduces the bug: the old check cancelled the card on the first poll of an open session', () => {
    assert.equal(legacyCancelsCard(OPEN), true);
  });

  it('leaves the card pending while the session is open', () => {
    assert.equal(checkoutSessionDisposition(OPEN), 'pending');
  });

  it('leaves the card pending while a delayed payment is still processing', () => {
    assert.equal(legacyCancelsCard(PROCESSING), true);
    assert.equal(checkoutSessionDisposition(PROCESSING), 'pending');
  });

  it('activates on a confirmed payment', () => {
    assert.equal(checkoutSessionDisposition(PAID), 'paid');
  });

  it('still closes off a session Stripe expired (an abandoned sale)', () => {
    assert.equal(checkoutSessionDisposition(EXPIRED), 'abandoned');
  });

  it('does not treat a subscription or setup session as a paid card', () => {
    assert.equal(checkoutSessionDisposition({ ...PAID, mode: 'setup' }), 'pending');
  });
});

describe('what a confirmed payment does to the card', () => {
  const pending = { status: 'PENDING_PAYMENT', paidAt: null, cancelledById: null, refundNote: null };
  const systemCancelled = { status: 'CANCELLED', paidAt: null, cancelledById: null, refundNote: UNCONFIRMED_CHECKOUT_REFUND_NOTE };

  it('activates a card still waiting for payment', () => {
    assert.equal(paidCheckoutAction(pending), 'activate');
  });

  it('recovers a card the system cancelled before the payment was confirmed — money is never left on a cancelled card', () => {
    assert.ok(isSystemCancelledBeforePayment(systemCancelled));
    assert.equal(paidCheckoutAction(systemCancelled), 'recover');
  });

  it('does nothing for a card already active, redeemed or expired (duplicate webhook, second poll, retry)', () => {
    for (const status of ['ACTIVE', 'REDEEMED', 'EXPIRED']) {
      assert.equal(paidCheckoutAction({ ...pending, status, paidAt: new Date() }), 'already_settled');
    }
  });

  it('never silently reinstates a card a manager cancelled', () => {
    assert.equal(paidCheckoutAction({ ...systemCancelled, cancelledById: 'staff_1' }), 'needs_attention');
    assert.equal(paidCheckoutAction({ ...systemCancelled, refundNote: 'Customer changed their mind' }), 'needs_attention');
    assert.equal(paidCheckoutAction({ ...systemCancelled, refundNote: null }), 'needs_attention');
  });

  it('never recovers a card that had already been paid', () => {
    assert.equal(paidCheckoutAction({ ...systemCancelled, paidAt: new Date() }), 'needs_attention');
  });
});
