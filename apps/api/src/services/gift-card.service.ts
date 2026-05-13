import { randomBytes } from 'node:crypto';
import { prisma } from '@alma/db';
import {
  DEFAULT_GIFT_CARD_SETTINGS,
  giftCardPromoCodeInputSchema,
  giftCardPromoCodeUpdateSchema,
  giftCardPromoQuoteInputSchema,
  giftCardCancelInputSchema,
  giftCardCheckoutInputSchema,
  giftCardLookupInputSchema,
  giftCardRedemptionInputSchema,
  giftCardSettingsInputSchema,
  normaliseGiftCardSettings,
  type AuthUser,
  type GiftCardPublicConfig,
  type GiftCardSettings
} from '@alma/shared';
import Stripe from 'stripe';
import QRCode from 'qrcode';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { mailService } from './mail.service.js';
import { giftCardWalletService } from './gift-card-wallet.service.js';

const stripe = env.stripe.secretKey
  ? new Stripe(env.stripe.secretKey, {
      apiVersion: env.stripe.apiVersion,
      ...(env.stripe.context && { stripeContext: env.stripe.context })
    })
  : null;

const GIFT_CARD_SETTINGS_ID = 'singleton';
const GIFT_CARD_OWNER_EMAIL = (process.env.GIFT_CARD_OWNER_EMAIL ?? 'tim@almagroup.com.au').trim().toLowerCase();

function toGiftCardPayload(card: {
  id: string;
  code: string;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  initialValueCents: number;
  balanceCents: number;
  discountCents: number;
  amountPaidCents: number | null;
  currency: string;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string | null;
  recipientEmail: string | null;
  message: string | null;
  promoCodeId: string | null;
  promoCodeSnapshot: string | null;
  testMode: boolean;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  emailedAt: Date | null;
  emailError: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  refundNote: string | null;
  cancelledById: string | null;
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
    emailedAt: card.emailedAt?.toISOString() ?? null,
    cancelledAt: card.cancelledAt?.toISOString() ?? null,
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
    discountCents: card.discountCents,
    amountPaidCents: card.amountPaidCents,
    currency: card.currency,
    recipientName: card.recipientName,
    message: card.message,
    promoCodeSnapshot: card.promoCodeSnapshot,
    testMode: card.testMode,
    emailedAt: card.emailedAt,
    emailError: card.emailError,
    paidAt: card.paidAt,
    expiresAt: card.expiresAt,
    qrCodeUrl: qrCodeUrl(card.code),
    redeemUrl: redeemUrl(card.code)
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

function printableUrl(code: string) {
  return `${env.giftCards.webUrl.replace(/\/+$/, '')}/print?code=${encodeURIComponent(code)}`;
}

function redeemUrl(code: string) {
  return `${env.giftCards.webUrl.replace(/\/+$/, '')}/redeem?code=${encodeURIComponent(code)}`;
}

function apiUrl(path: string) {
  return `${env.publicApiUrl.replace(/\/+$/, '')}${path}`;
}

function appleWalletUrl(code: string) {
  return apiUrl(`/api/gift-cards/wallet/apple/${encodeURIComponent(code)}`);
}

function googleWalletUrl(code: string) {
  return apiUrl(`/api/gift-cards/wallet/google/${encodeURIComponent(code)}`);
}

function qrCodeUrl(code: string) {
  return apiUrl(`/api/gift-cards/qr/${encodeURIComponent(code)}.svg`);
}

function isStripePaymentConfirmed(session: Stripe.Checkout.Session) {
  return session.mode === 'payment' && session.status === 'complete' && session.payment_status === 'paid';
}

function paymentIntentId(session: Stripe.Checkout.Session) {
  return typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
}

function sessionAmountCents(session: Stripe.Checkout.Session) {
  return typeof session.amount_total === 'number' ? session.amount_total : null;
}

function normalisePromoCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function parseOptionalDate(value: string | undefined | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Enter a valid promo code date.');
  return date;
}

function canManagePromoCodes(user?: AuthUser | null) {
  return user?.email?.toLowerCase() === GIFT_CARD_OWNER_EMAIL;
}

function validatePromoShape(input: {
  discountType?: 'PERCENT' | 'FIXED_AMOUNT';
  percentOff?: number;
  amountOffCents?: number;
}) {
  if (input.discountType === 'PERCENT' && !input.percentOff) {
    throw new HttpError(400, 'Percent promo codes need a percent off value.');
  }
  if (input.discountType === 'FIXED_AMOUNT' && !input.amountOffCents) {
    throw new HttpError(400, 'Fixed amount promo codes need an amount off value.');
  }
}

async function getGiftCardSettings() {
  const settings = await prisma.appSettings.upsert({
    where: { id: GIFT_CARD_SETTINGS_ID },
    update: {},
    create: { id: GIFT_CARD_SETTINGS_ID },
    select: { giftCardSettings: true }
  });
  return normaliseGiftCardSettings(settings.giftCardSettings);
}

function cleanSettingsPatch(input: unknown) {
  const parsed = giftCardSettingsInputSchema.parse(input);
  return normaliseGiftCardSettings({
    ...DEFAULT_GIFT_CARD_SETTINGS,
    ...parsed
  });
}

async function toPromoPayload(promo: {
  id: string;
  code: string;
  description: string | null;
  discountType: 'PERCENT' | 'FIXED_AMOUNT';
  percentOff: number | null;
  amountOffCents: number | null;
  isActive: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const confirmedRedemptions = await prisma.giftCard.count({
    where: {
      promoCodeId: promo.id,
      testMode: false,
      paidAt: { not: null },
      status: { in: ['ACTIVE', 'REDEEMED'] }
    }
  });
  return {
    ...promo,
    startsAt: promo.startsAt?.toISOString() ?? null,
    expiresAt: promo.expiresAt?.toISOString() ?? null,
    createdAt: promo.createdAt.toISOString(),
    updatedAt: promo.updatedAt.toISOString(),
    confirmedRedemptions
  };
}

async function quotePromoCode(code: string, amountCents: number) {
  const parsed = giftCardPromoQuoteInputSchema.parse({ code, amountCents });
  const normalisedCode = normalisePromoCode(parsed.code);
  const promo = await prisma.giftCardPromoCode.findUnique({ where: { code: normalisedCode } });
  if (!promo || !promo.isActive) throw new HttpError(404, 'Promo code not found.');
  const now = new Date();
  if (promo.startsAt && promo.startsAt > now) throw new HttpError(400, 'Promo code is not active yet.');
  if (promo.expiresAt && promo.expiresAt < now) throw new HttpError(400, 'Promo code has expired.');
  const confirmedRedemptions = await prisma.giftCard.count({
    where: {
      promoCodeId: promo.id,
      testMode: false,
      paidAt: { not: null },
      status: { in: ['ACTIVE', 'REDEEMED'] }
    }
  });
  if (promo.maxRedemptions && confirmedRedemptions >= promo.maxRedemptions) {
    throw new HttpError(400, 'Promo code has reached its usage limit.');
  }

  const rawDiscount =
    promo.discountType === 'PERCENT'
      ? Math.floor(parsed.amountCents * ((promo.percentOff ?? 0) / 100))
      : promo.amountOffCents ?? 0;
  const discountCents = Math.min(Math.max(rawDiscount, 0), parsed.amountCents - 100);
  if (discountCents <= 0) throw new HttpError(400, 'Promo code does not change this gift card total.');

  return {
    promo,
    quote: {
      code: promo.code,
      description: promo.description,
      discountCents,
      amountDueCents: parsed.amountCents - discountCents
    }
  };
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
  canManagePromoCodes,

  async getPublicSettings() {
    return getGiftCardSettings();
  },

  async getPublicConfig(): Promise<GiftCardPublicConfig> {
    const settings = await getGiftCardSettings();
    if (settings.testCheckoutEnabled) {
      return {
        settings,
        checkoutMode: 'test',
        checkoutNotice: 'Test checkout is enabled. No real payment will be taken.'
      };
    }

    if (!stripe) {
      return {
        settings,
        checkoutMode: 'setup_required',
        checkoutNotice: 'Payment setup is required before gift card checkout can go live.'
      };
    }

    return {
      settings,
      checkoutMode: 'live',
      checkoutNotice: null
    };
  },

  async getAdminSettings(user?: AuthUser | null) {
    return {
      settings: await getGiftCardSettings(),
      canManagePromoCodes: canManagePromoCodes(user)
    };
  },

  async updateSettings(input: unknown) {
    const settings = cleanSettingsPatch(input);
    const updated = await prisma.appSettings.upsert({
      where: { id: GIFT_CARD_SETTINGS_ID },
      create: {
        id: GIFT_CARD_SETTINGS_ID,
        giftCardSettings: settings
      },
      update: {
        giftCardSettings: settings
      },
      select: { giftCardSettings: true }
    });
    return normaliseGiftCardSettings(updated.giftCardSettings);
  },

  async listPromoCodes() {
    const promos = await prisma.giftCardPromoCode.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }]
    });
    return Promise.all(promos.map(toPromoPayload));
  },

  async createPromoCode(input: unknown, createdById?: string | null) {
    const data = giftCardPromoCodeInputSchema.parse(input);
    validatePromoShape(data);
    try {
      const promo = await prisma.giftCardPromoCode.create({
        data: {
          code: normalisePromoCode(data.code),
          description: data.description?.trim() || null,
          discountType: data.discountType,
          percentOff: data.discountType === 'PERCENT' ? data.percentOff ?? null : null,
          amountOffCents: data.discountType === 'FIXED_AMOUNT' ? data.amountOffCents ?? null : null,
          isActive: data.isActive,
          startsAt: parseOptionalDate(data.startsAt),
          expiresAt: parseOptionalDate(data.expiresAt),
          maxRedemptions: data.maxRedemptions ?? null,
          createdById: createdById ?? null
        }
      });
      return toPromoPayload(promo);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new HttpError(409, 'That promo code already exists.');
      }
      throw error;
    }
  },

  async updatePromoCode(id: string, input: unknown) {
    const data = giftCardPromoCodeUpdateSchema.parse(input);
    validatePromoShape(data);
    const promo = await prisma.giftCardPromoCode.update({
      where: { id },
      data: {
        ...(data.code !== undefined && { code: normalisePromoCode(data.code) }),
        ...(data.description !== undefined && { description: data.description?.trim() || null }),
        ...(data.discountType !== undefined && { discountType: data.discountType }),
        ...(data.percentOff !== undefined && { percentOff: data.percentOff ?? null }),
        ...(data.amountOffCents !== undefined && { amountOffCents: data.amountOffCents ?? null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.startsAt !== undefined && { startsAt: parseOptionalDate(data.startsAt) }),
        ...(data.expiresAt !== undefined && { expiresAt: parseOptionalDate(data.expiresAt) }),
        ...(data.maxRedemptions !== undefined && { maxRedemptions: data.maxRedemptions ?? null })
      }
    });
    return toPromoPayload(promo);
  },

  async removePromoCode(id: string) {
    const promo = await prisma.giftCardPromoCode.update({
      where: { id },
      data: { isActive: false }
    });
    return toPromoPayload(promo);
  },

  async quotePromo(input: unknown) {
    const parsed = giftCardPromoQuoteInputSchema.parse(input);
    const { quote } = await quotePromoCode(parsed.code, parsed.amountCents);
    return quote;
  },

  async createCheckout(input: unknown) {
    const data = giftCardCheckoutInputSchema.parse(input);
    const settings = await getGiftCardSettings();
    const promoResult = data.promoCode?.trim()
      ? await quotePromoCode(data.promoCode, data.amountCents)
      : null;
    const discountCents = promoResult?.quote.discountCents ?? 0;
    const amountDueCents = data.amountCents - discountCents;
    const code = await uniqueCode();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 3);

    if (settings.testCheckoutEnabled) {
      const testSessionId = `TEST-${randomBytes(8).toString('hex').toUpperCase()}`;
      const card = await prisma.giftCard.create({
        data: {
          code,
          status: 'ACTIVE',
          initialValueCents: data.amountCents,
          balanceCents: data.amountCents,
          discountCents,
          amountPaidCents: 0,
          currency: 'aud',
          purchaserName: data.purchaserName.trim(),
          purchaserEmail: data.purchaserEmail.trim().toLowerCase(),
          recipientName: data.recipientName?.trim() || null,
          recipientEmail: data.recipientEmail?.trim().toLowerCase() || null,
          message: data.message?.trim() || null,
          promoCodeId: promoResult?.promo.id ?? null,
          promoCodeSnapshot: promoResult?.promo.code ?? null,
          testMode: true,
          stripeCheckoutSessionId: testSessionId,
          paidAt: new Date(),
          expiresAt
        },
        include: { redemptions: true }
      });
      await this.sendGiftCardEmail(card, settings);
      return {
        giftCardId: card.id,
        checkoutUrl: successUrl(testSessionId),
        checkoutSessionId: testSessionId,
        testMode: true,
        discountCents,
        amountPaidCents: 0
      };
    }

    if (!stripe) throw new HttpError(503, 'Payment setup is required before gift card checkout can go live.');

    const card = await prisma.giftCard.create({
      data: {
        code,
        status: 'PENDING_PAYMENT',
        initialValueCents: data.amountCents,
        balanceCents: data.amountCents,
        discountCents,
        currency: 'aud',
        purchaserName: data.purchaserName.trim(),
        purchaserEmail: data.purchaserEmail.trim().toLowerCase(),
        recipientName: data.recipientName?.trim() || null,
        recipientEmail: data.recipientEmail?.trim().toLowerCase() || null,
        message: data.message?.trim() || null,
        promoCodeId: promoResult?.promo.id ?? null,
        promoCodeSnapshot: promoResult?.promo.code ?? null,
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
        giftCardCode: card.code,
        promoCode: promoResult?.promo.code ?? '',
        discountCents: String(discountCents)
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'aud',
            unit_amount: amountDueCents,
            product_data: {
              name: `ALMA Gift Card ${formatAmount(data.amountCents)}`,
              description: [
                card.recipientName ? `For ${card.recipientName}` : 'Redeemable at ALMA venues',
                discountCents ? `Promo ${promoResult?.promo.code}: ${formatAmount(discountCents)} off` : ''
              ].filter(Boolean).join(' · ')
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
      checkoutSessionId: session.id,
      discountCents,
      amountPaidCents: amountDueCents
    };
  },

  async getByCheckoutSession(sessionId: string) {
    let card = await prisma.giftCard.findUnique({
      where: { stripeCheckoutSessionId: sessionId },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
    });
    if (!card) throw new HttpError(404, 'Gift card checkout session not found');
    if (card.status === 'PENDING_PAYMENT' && stripe) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
      if (isStripePaymentConfirmed(session)) {
        const updated = await this.handleCheckoutCompleted(session);
        if (updated) return publicGiftCard(updated);
        card = await prisma.giftCard.findUnique({
          where: { stripeCheckoutSessionId: sessionId },
          include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
        });
      } else if (session.status === 'expired' || session.payment_status === 'unpaid' || session.payment_status === 'no_payment_required') {
        await this.disregardUnconfirmedCheckout(session, 'Stripe did not confirm payment for this checkout.');
        throw new HttpError(404, 'Gift card payment was not confirmed by Stripe.');
      }
    }
    if (!card || card.status !== 'ACTIVE' || !card.paidAt) {
      throw new HttpError(404, 'Gift card payment has not been confirmed by Stripe yet.');
    }
    return publicGiftCard(toGiftCardPayload(card));
  },

  async getPrintableByCode(code: string) {
    const card = await findCardByCode(code);
    if (!card.paidAt || !['ACTIVE', 'REDEEMED'].includes(card.status)) {
      throw new HttpError(404, 'Gift card payment has not been confirmed by Stripe.');
    }
    return publicGiftCard(toGiftCardPayload(card));
  },

  async appleWalletPass(code: string) {
    const card = await findCardByCode(code);
    return giftCardWalletService.applePass(card);
  },

  async googleWalletSaveUrl(code: string) {
    const card = await findCardByCode(code);
    return giftCardWalletService.googleSaveUrl(card);
  },

  async list(input: { query?: string }) {
    const query = input.query?.trim();
    const giftCards = await prisma.giftCard.findMany({
      where: {
        AND: [
          { status: { not: 'PENDING_PAYMENT' } },
          {
            OR: [
              { paidAt: { not: null } },
              { status: { in: ['ACTIVE', 'REDEEMED'] } }
            ]
          }
        ],
        ...(query
          ? {
            OR: [
              { code: { contains: query, mode: 'insensitive' } },
              { purchaserEmail: { contains: query, mode: 'insensitive' } },
              { purchaserName: { contains: query, mode: 'insensitive' } },
              { recipientEmail: { contains: query, mode: 'insensitive' } },
              { recipientName: { contains: query, mode: 'insensitive' } }
            ]
          }
          : {})
      },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } },
      orderBy: [{ createdAt: 'desc' }],
      take: 100
    });
    const totals = await prisma.giftCard.aggregate({
      _count: { id: true },
      _sum: { balanceCents: true, initialValueCents: true },
      where: { status: { in: ['ACTIVE', 'REDEEMED'] }, testMode: false }
    });
    const test = await prisma.giftCard.count({ where: { testMode: true, status: { in: ['ACTIVE', 'REDEEMED'] } } });
    return {
      giftCards: giftCards.map(toGiftCardPayload),
      totals: {
        active: giftCards.filter((card) => card.status === 'ACTIVE' && !card.testMode).length,
        pending: 0,
        redeemed: giftCards.filter((card) => card.status === 'REDEEMED' && !card.testMode).length,
        test,
        activeBalanceCents: totals._sum.balanceCents ?? 0,
        soldValueCents: totals._sum.initialValueCents ?? 0
      }
    };
  },

  async listOrders(input: { query?: string }) {
    const query = input.query?.trim();
    const orders = await prisma.giftCard.findMany({
      where: {
        ...(query
          ? {
              OR: [
                { code: { contains: query, mode: 'insensitive' } },
                { purchaserEmail: { contains: query, mode: 'insensitive' } },
                { purchaserName: { contains: query, mode: 'insensitive' } },
                { recipientEmail: { contains: query, mode: 'insensitive' } },
                { recipientName: { contains: query, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } },
      orderBy: [{ createdAt: 'desc' }],
      take: 100
    });

    return {
      orders: orders.map(toGiftCardPayload),
      totals: {
        draft: 0,
        pendingPayment: orders.filter((order) => order.status === 'PENDING_PAYMENT').length,
        active: orders.filter((order) => order.status === 'ACTIVE').length,
        redeemed: orders.filter((order) => order.status === 'REDEEMED').length,
        cancelled: orders.filter((order) => order.status === 'CANCELLED').length,
        expired: orders.filter((order) => order.status === 'EXPIRED').length,
        test: orders.filter((order) => order.testMode).length
      }
    };
  },

  async lookup(code: string) {
    const card = await findCardByCode(code);
    if (!card.paidAt || card.status === 'PENDING_PAYMENT') {
      throw new HttpError(404, 'Gift card payment has not been confirmed by Stripe.');
    }
    return toGiftCardPayload(card);
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

  async cancel(code: string, input: unknown, cancelledById?: string) {
    const data = giftCardCancelInputSchema.parse(input);
    const card = await findCardByCode(code);
    if (card.status === 'CANCELLED') throw new HttpError(400, 'Gift card is already cancelled');
    if (card.status === 'EXPIRED') throw new HttpError(400, 'Gift card is expired');

    const updated = await prisma.giftCard.update({
      where: { id: card.id },
      data: {
        status: 'CANCELLED',
        balanceCents: 0,
        cancelledAt: new Date(),
        cancelReason: data.reason.trim(),
        refundNote: data.refundNote?.trim() || null,
        cancelledById: cancelledById ?? null
      },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
    });
    return toGiftCardPayload(updated);
  },

  async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const cardId = session.metadata?.giftCardId || session.client_reference_id;
    if (!cardId) return null;
    const existing = await prisma.giftCard.findUnique({
      where: { id: cardId },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
    });
    if (!existing) return null;
    if (!isStripePaymentConfirmed(session)) {
      await this.disregardUnconfirmedCheckout(session, 'Stripe checkout completed without confirmed payment.');
      return null;
    }
    const paidAmountCents = sessionAmountCents(session);
    const expectedAmountCents = existing.initialValueCents - existing.discountCents;
    if (paidAmountCents !== null && paidAmountCents !== expectedAmountCents) {
      await this.disregardUnconfirmedCheckout(session, 'Stripe payment amount did not match the gift card value.');
      throw new HttpError(400, 'Stripe payment amount did not match the gift card value.');
    }
    if (existing.status !== 'PENDING_PAYMENT') {
      return toGiftCardPayload(existing);
    }
    const card = await prisma.giftCard.update({
      where: { id: cardId },
      data: {
        status: 'ACTIVE',
        paidAt: new Date(),
        amountPaidCents: paidAmountCents ?? expectedAmountCents,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentId(session)
      },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
    });
    const payload = toGiftCardPayload(card);
    if (card.emailedAt) return payload;
    await this.sendGiftCardEmail(card, await getGiftCardSettings());
    return payload;
  },

  async sendGiftCardEmail(card: Parameters<typeof toGiftCardPayload>[0], settings: GiftCardSettings) {
    if (card.emailedAt) return toGiftCardPayload(card);
    const recipients = Array.from(new Set([card.purchaserEmail, card.recipientEmail].filter(Boolean)));
    if (recipients.length === 0) return toGiftCardPayload(card);

    const results = await Promise.all(
      recipients.map((to) =>
        mailService.sendGiftCard({
          to: to!,
          purchaserName: card.purchaserName,
          recipientName: card.recipientName,
          code: card.code,
          amountCents: card.initialValueCents,
          balanceCents: card.balanceCents,
          message: card.message,
          printableUrl: printableUrl(card.code),
          qrCodeUrl: qrCodeUrl(card.code),
          appleWalletUrl: appleWalletUrl(card.code),
          googleWalletUrl: googleWalletUrl(card.code),
          expiresAt: card.expiresAt,
          settings
        })
      )
    );
    const failed = results.find((result) => result.status !== 'sent');
    const updated = await prisma.giftCard.update({
      where: { id: card.id },
      data: failed
        ? { emailError: failed.reason }
        : { emailedAt: new Date(), emailError: null },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
    });
    return toGiftCardPayload(updated);
  },

  async disregardUnconfirmedCheckout(session: Stripe.Checkout.Session, reason: string) {
    const cardId = session.metadata?.giftCardId || session.client_reference_id;
    const where = cardId
      ? { id: cardId }
      : session.id
        ? { stripeCheckoutSessionId: session.id }
        : null;
    if (!where) return null;
    const existing = await prisma.giftCard.findUnique({ where });
    if (!existing || existing.paidAt || existing.status !== 'PENDING_PAYMENT') return null;
    return prisma.giftCard.update({
      where: { id: existing.id },
      data: {
        status: 'CANCELLED',
        balanceCents: 0,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentId(session),
        amountPaidCents: sessionAmountCents(session),
        cancelledAt: new Date(),
        cancelReason: reason,
        refundNote: 'No gift card issued because Stripe did not confirm payment.'
      },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
    });
  },

  async qrCodeSvg(code: string) {
    const card = await findCardByCode(code.replace(/\.svg$/i, ''));
    if (!card.paidAt || !['ACTIVE', 'REDEEMED'].includes(card.status)) {
      throw new HttpError(404, 'Gift card payment has not been confirmed.');
    }
    return QRCode.toString(redeemUrl(card.code), {
      type: 'svg',
      margin: 1,
      width: 260,
      color: {
        dark: '#1f3524',
        light: '#ffffff'
      }
    });
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
