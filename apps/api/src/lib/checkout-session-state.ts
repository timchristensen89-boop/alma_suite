/**
 * What a Stripe Checkout Session says about a gift card payment, and what may
 * be done to the card because of it.
 *
 * Pure (no Stripe client, no database) so the rules are tested directly.
 *
 * The bug this exists to prevent: a session that is still OPEN — the customer
 * has the QR up on their phone and is typing their card number — reports
 * `payment_status: 'unpaid'`. The counter iPad polls the session every 2.5s
 * from the moment the QR is shown, and the old check treated 'unpaid' as
 * "Stripe did not confirm payment", cancelling the card on the first poll.
 * When the customer then paid, the payment landed on a cancelled card: money
 * taken, no card. 'unpaid' is not a failure. Only Stripe saying the session
 * EXPIRED is.
 */

export type CheckoutSessionLike = {
  mode?: string | null;
  status?: string | null;
  payment_status?: string | null;
};

/**
 * paid      — Stripe confirmed the money: activate the card.
 * abandoned — the session expired without payment: the card can be closed off.
 * pending   — anything else: an open session (customer still paying), or a
 *             completed session whose payment is still processing (a delayed
 *             method confirms later through checkout.session.async_payment_*).
 *             Leave the card alone and look again later.
 */
export type CheckoutSessionDisposition = 'paid' | 'abandoned' | 'pending';

export function checkoutSessionDisposition(session: CheckoutSessionLike): CheckoutSessionDisposition {
  if (session.mode === 'payment' && session.status === 'complete' && session.payment_status === 'paid') return 'paid';
  if (session.status === 'expired') return 'abandoned';
  return 'pending';
}

/**
 * The note disregardUnconfirmedCheckout writes on a card it closes off. It is
 * also the marker that tells a SYSTEM cancellation (no confirmed payment at
 * the time) apart from a manager cancelling the card on purpose: only the
 * first may be undone when Stripe later confirms the payment.
 */
export const UNCONFIRMED_CHECKOUT_REFUND_NOTE = 'No gift card issued because Stripe did not confirm payment.';

export type GiftCardPaymentState = {
  status: string;
  paidAt: Date | null;
  cancelledById: string | null;
  refundNote: string | null;
};

/**
 * What a confirmed Stripe payment may do to the card it paid for.
 *
 * activate        — still waiting for payment: activate it.
 * recover         — closed off by the system before the payment was confirmed
 *                   (the premature-cancellation bug, or any race like it):
 *                   the customer has paid, so activate it after all.
 * already_settled — already active, redeemed or expired: nothing to do (a
 *                   duplicate webhook, a second poll, a retry).
 * needs_attention — cancelled by a person. Money arrived for a card someone
 *                   deliberately cancelled; it is not silently reinstated.
 *                   A manager refunds it in Stripe or reinstates it.
 */
export type PaidCheckoutAction = 'activate' | 'recover' | 'already_settled' | 'needs_attention';

export function paidCheckoutAction(card: GiftCardPaymentState): PaidCheckoutAction {
  if (card.status === 'PENDING_PAYMENT') return 'activate';
  if (card.status === 'CANCELLED') {
    return isSystemCancelledBeforePayment(card) ? 'recover' : 'needs_attention';
  }
  return 'already_settled';
}

/** A card the system closed off because Stripe had not (yet) confirmed payment. */
export function isSystemCancelledBeforePayment(card: GiftCardPaymentState): boolean {
  return (
    card.status === 'CANCELLED'
    && card.paidAt === null
    && !card.cancelledById
    && card.refundNote === UNCONFIRMED_CHECKOUT_REFUND_NOTE
  );
}
