/** Ask Stripe what really happened to a gift card's checkout session. */
import { prisma } from '@alma/db';
import Stripe from 'stripe';
import { env } from '../src/env.js';

const code = process.argv[2];
const card = await prisma.giftCard.findFirst({
  where: { code: code ?? '' },
  select: { code: true, status: true, paidAt: true, stripeCheckoutSessionId: true, initialValueCents: true }
});
if (!card?.stripeCheckoutSessionId) {
  console.log('no checkout session for', code, card);
  process.exit(0);
}
const stripe = new Stripe(env.stripe.secretKey!);
const session = await stripe.checkout.sessions.retrieve(card.stripeCheckoutSessionId, { expand: ['payment_intent'] });
console.log({
  code: card.code,
  almaStatus: card.status,
  almaPaidAt: card.paidAt,
  faceValue: card.initialValueCents / 100,
  stripeStatus: session.status,
  stripePaymentStatus: session.payment_status,
  stripeAmountTotal: (session.amount_total ?? 0) / 100
});
process.exit(0);
