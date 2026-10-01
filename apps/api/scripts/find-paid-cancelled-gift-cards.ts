import Stripe from 'stripe';
import { prisma } from '@alma/db';
import { UNCONFIRMED_CHECKOUT_REFUND_NOTE } from '../src/lib/checkout-session-state.js';

// READ ONLY. Lists gift cards the system cancelled because Stripe "had not
// confirmed payment", and — when STRIPE_SECRET_KEY is set — asks Stripe
// whether each one was in fact paid afterwards.
//
// Before the counter-sale fix, the counter iPad's first poll of an OPEN
// checkout session (payment_status 'unpaid' while the customer is still
// paying) cancelled the card, and the payment then landed on that cancelled
// card. This finds those cards so each can be reinstated or refunded by hand.
// It writes nothing, anywhere: no database update, no Stripe call other than
// retrieving a checkout session.
//
//   node --import tsx scripts/find-paid-cancelled-gift-cards.ts
//   STRIPE_SECRET_KEY=... node --import tsx scripts/find-paid-cancelled-gift-cards.ts

const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
const stripe = stripeKey
  ? new Stripe(stripeKey, process.env.STRIPE_CONTEXT ? { stripeContext: process.env.STRIPE_CONTEXT } : {})
  : null;

const cards = await prisma.giftCard.findMany({
  where: {
    status: 'CANCELLED',
    paidAt: null,
    cancelledById: null,
    refundNote: UNCONFIRMED_CHECKOUT_REFUND_NOTE,
    stripeCheckoutSessionId: { startsWith: 'cs_' }
  },
  orderBy: { createdAt: 'desc' },
  select: {
    code: true,
    saleChannel: true,
    initialValueCents: true,
    purchaserName: true,
    purchaserEmail: true,
    createdAt: true,
    cancelledAt: true,
    cancelReason: true,
    stripeCheckoutSessionId: true
  }
});

console.log(`${cards.length} card(s) cancelled by the system before a payment was confirmed.`);
if (!stripe) console.log('STRIPE_SECRET_KEY is not set: listing only, not checking Stripe.');

let paid = 0;
for (const card of cards) {
  let stripeState = 'not checked';
  if (stripe && card.stripeCheckoutSessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(card.stripeCheckoutSessionId);
      stripeState = `${session.status}/${session.payment_status}`;
      if (session.status === 'complete' && session.payment_status === 'paid') {
        paid += 1;
        stripeState += ` PAID ${((session.amount_total ?? 0) / 100).toFixed(2)} — payment intent ${String(session.payment_intent ?? '')}`;
      }
    } catch (error) {
      stripeState = `lookup failed: ${error instanceof Error ? error.message : 'unknown'}`;
    }
  }
  console.log(
    [
      `***${card.code.slice(-4)}`,
      card.saleChannel,
      `$${(card.initialValueCents / 100).toFixed(2)}`,
      card.purchaserName,
      card.createdAt.toISOString(),
      `cancelled ${card.cancelledAt?.toISOString() ?? '?'} (${card.cancelReason ?? ''})`,
      stripeState
    ].join(' | ')
  );
}

if (stripe) {
  console.log(`${paid} of them were paid in Stripe: each needs reinstating or refunding by hand.`);
}
await prisma.$disconnect();
