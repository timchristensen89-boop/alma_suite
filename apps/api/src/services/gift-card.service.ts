import { randomBytes } from 'node:crypto';
import { prisma } from '@alma/db';
import {
  giftCardCheckoutInputSchema,
  giftCardLookupInputSchema,
  giftCardRedemptionInputSchema
} from '@alma/shared';
import Stripe from 'stripe';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';

const stripe = env.stripe.secretKey
  ? new Stripe(env.stripe.secretKey, { apiVersion: env.stripe.apiVersion })
  : null;

function toGiftCardPayload(card: {
  id: string;
  code: string;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  initialValueCents: number;
  balanceCents: number;
  currency: string;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string | null;
  recipientEmail: string | null;
  message: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  paidAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  redemptions: Array<{
    id: string;
    giftCardId: string;
    amountCents: number;
    venue: string | null;
    notes: string | null;
    status: 'COMPLETED' | 'VOIDED';
    redeemedById: string | null;
    redeemedAt: Date;
    createdAt: Date;
  }>;
}) {
  return {
    ...card,
    paidAt: card.paidAt?.toISOString() ?? null,
    expiresAt: card.expiresAt?.toISOString() ?? null,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    redemptions: card.redemptions.map((redemption) => ({
      ...redemption,
      redeemedAt: redemption.redeemedAt.toISOString(),
      createdAt: redemption.createdAt.toISOString()
    }))
  };
}

function publicGiftCard(card: ReturnType<typeof toGiftCardPayload>) {
  return {
    code: card.code,
    status: card.status,
    initialValueCents: card.initialValueCents,
    balanceCents: card.balanceCents,
    currency: card.currency,
    recipientName: card.recipientName,
    message: card.message,
    paidAt: card.paidAt,
    expiresAt: card.expiresAt
  };
}

async function uniqueCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `ALMA-${randomBytes(4).toString('hex').toUpperCase()}`;
    const existing = await prisma.giftCard.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new HttpError(500, 'Could not generate gift card code');
}

function successUrl(sessionIdPlaceholder = '{CHECKOUT_SESSION_ID}') {
  return `${env.giftCards.webUrl.replace(/\/+$/, '')}/success?session_id=${sessionIdPlaceholder}`;
}

function cancelUrl() {
  return `${env.giftCards.webUrl.replace(/\/+$/, '')}/`;
}

async function findCardByCode(code: string) {
  const parsed = giftCardLookupInputSchema.parse({ code });
  const card = await prisma.giftCard.findUnique({
    where: { code: parsed.code.trim().toUpperCase() },
    include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
  });
  if (!card) throw new HttpError(404, 'Gift card not found');
  return card;
}

export const giftCardService = {
  async createCheckout(input: unknown) {
    if (!stripe) throw new HttpError(503, 'Stripe is not configured yet. Add STRIPE_SECRET_KEY before taking gift card payments.');
    const data = giftCardCheckoutInputSchema.parse(input);
    const code = await uniqueCode();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 3);

    const card = await prisma.giftCard.create({
      data: {
        code,
        status: 'PENDING_PAYMENT',
        initialValueCents: data.amountCents,
        balanceCents: data.amountCents,
        currency: 'aud',
        purchaserName: data.purchaserName.trim(),
        purchaserEmail: data.purchaserEmail.trim().toLowerCase(),
        recipientName: data.recipientName?.trim() || null,
        recipientEmail: data.recipientEmail?.trim().toLowerCase() || null,
        message: data.message?.trim() || null,
        expiresAt
      },
      include: { redemptions: true }
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: data.purchaserEmail.trim().toLowerCase(),
      success_url: data.successUrl?.trim() || successUrl(),
      cancel_url: data.cancelUrl?.trim() || cancelUrl(),
      client_reference_id: card.id,
      metadata: {
        giftCardId: card.id,
        giftCardCode: card.code
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'aud',
            unit_amount: data.amountCents,
            product_data: {
              name: `ALMA Gift Card ${formatAmount(data.amountCents)}`,
              description: card.recipientName ? `For ${card.recipientName}` : 'Redeemable at ALMA venues'
            }
          }
        }
      ]
    });

    await prisma.giftCard.update({
      where: { id: card.id },
      data: { stripeCheckoutSessionId: session.id }
    });

    if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout URL');
    return {
      giftCardId: card.id,
      checkoutUrl: session.url,
      checkoutSessionId: session.id
    };
  },

  async getByCheckoutSession(sessionId: string) {
    const card = await prisma.giftCard.findUnique({
      where: { stripeCheckoutSessionId: sessionId },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
    });
    if (!card) throw new HttpError(404, 'Gift card checkout session not found');
    return publicGiftCard(toGiftCardPayload(card));
  },

  async list(input: { query?: string }) {
    const query = input.query?.trim();
    const giftCards = await prisma.giftCard.findMany({
      where: query
        ? {
            OR: [
              { code: { contains: query, mode: 'insensitive' } },
              { purchaserEmail: { contains: query, mode: 'insensitive' } },
              { purchaserName: { contains: query, mode: 'insensitive' } },
              { recipientEmail: { contains: query, mode: 'insensitive' } },
              { recipientName: { contains: query, mode: 'insensitive' } }
            ]
          }
        : {},
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } },
      orderBy: [{ createdAt: 'desc' }],
      take: 100
    });
    const totals = await prisma.giftCard.aggregate({
      _count: { id: true },
      _sum: { balanceCents: true, initialValueCents: true },
      where: { status: { in: ['ACTIVE', 'REDEEMED'] } }
    });
    return {
      giftCards: giftCards.map(toGiftCardPayload),
      totals: {
        active: giftCards.filter((card) => card.status === 'ACTIVE').length,
        pending: giftCards.filter((card) => card.status === 'PENDING_PAYMENT').length,
        redeemed: giftCards.filter((card) => card.status === 'REDEEMED').length,
        activeBalanceCents: totals._sum.balanceCents ?? 0,
        soldValueCents: totals._sum.initialValueCents ?? 0
      }
    };
  },

  async lookup(code: string) {
    return toGiftCardPayload(await findCardByCode(code));
  },

  async redeem(input: unknown, redeemedById?: string) {
    const data = giftCardRedemptionInputSchema.parse(input);
    const card = await findCardByCode(data.code);
    if (card.status !== 'ACTIVE') throw new HttpError(400, `Gift card is ${card.status.replace('_', ' ').toLowerCase()}`);
    if (card.balanceCents < data.amountCents) throw new HttpError(400, 'Gift card balance is too low');

    const nextBalance = card.balanceCents - data.amountCents;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.giftCardRedemption.create({
        data: {
          giftCardId: card.id,
          amountCents: data.amountCents,
          venue: data.venue?.trim() || null,
          notes: data.notes?.trim() || null,
          redeemedById: redeemedById ?? null
        }
      });
      return tx.giftCard.update({
        where: { id: card.id },
        data: {
          balanceCents: nextBalance,
          status: nextBalance === 0 ? 'REDEEMED' : 'ACTIVE'
        },
        include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
      });
    });
    return toGiftCardPayload(updated);
  },

  async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const cardId = session.metadata?.giftCardId || session.client_reference_id;
    if (!cardId) return null;
    const card = await prisma.giftCard.update({
      where: { id: cardId },
      data: {
        status: 'ACTIVE',
        paidAt: new Date(),
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null
      },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
    });
    return toGiftCardPayload(card);
  }
};

function formatAmount(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(cents / 100);
}

export function constructStripeWebhookEvent(body: Buffer, signature: string | undefined) {
  if (!stripe) throw new HttpError(503, 'Stripe is not configured');
  if (!env.stripe.webhookSecret) throw new HttpError(503, 'Stripe webhook secret is not configured');
  if (!signature) throw new HttpError(400, 'Missing Stripe signature');
  return stripe.webhooks.constructEvent(body, signature, env.stripe.webhookSecret);
}
