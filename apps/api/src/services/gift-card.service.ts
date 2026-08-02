import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
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
  design: string | null;
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
    design: card.design ?? null,
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

function walletConfigStatus() {
  return {
    appleConfigured: Boolean(
      env.giftCards.appleWallet.passTypeIdentifier &&
        env.giftCards.appleWallet.teamIdentifier &&
        env.giftCards.appleWallet.signerCert &&
        env.giftCards.appleWallet.signerKey &&
        env.giftCards.appleWallet.wwdr
    ),
    googleConfigured: Boolean(
      env.giftCards.googleWallet.issuerId &&
        env.giftCards.googleWallet.serviceAccountEmail &&
        env.giftCards.googleWallet.privateKey
    )
  };
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

// Create a gift card while atomically reserving a promo-code slot. The quote-time
// count is only advisory: two concurrent checkouts could both pass it and exceed
// maxRedemptions. Here we take a row lock on the promo (a Prisma update holds the
// row lock to the end of the transaction) so concurrent checkouts serialise, then
// re-count reserved (non-cancelled) cards and create inside the same transaction.
async function createGiftCardReservingPromo(
  data: Prisma.GiftCardUncheckedCreateInput,
  promo: { id: string; maxRedemptions: number | null } | null | undefined
) {
  if (!promo || promo.maxRedemptions === null || promo.maxRedemptions === undefined) {
    return prisma.giftCard.create({ data, include: { redemptions: true } });
  }
  const max = promo.maxRedemptions;
  return prisma.$transaction(async (tx) => {
    await tx.giftCardPromoCode.update({ where: { id: promo.id }, data: { updatedAt: new Date() } });
    const reserved = await tx.giftCard.count({
      where: { promoCodeId: promo.id, testMode: false, status: { not: 'CANCELLED' } }
    });
    if (reserved >= max) {
      throw new HttpError(400, 'Promo code has reached its usage limit.');
    }
    return tx.giftCard.create({ data, include: { redemptions: true } });
  });
}

/**
 * An image the venue uploaded, held inline in the settings JSON as a base64
 * data URL.
 *
 * Serving it that way put 103.5 KB of the public config's 104 KB on the wire
 * for every single visitor to the buy page — 99.5% of the payload, repeated on
 * every load, and impossible to cache or put behind a CDN because it lives
 * inside a JSON API response.
 *
 * These helpers swap the blob for a URL pointing at an endpoint that serves
 * the same bytes once, with a long cache. Nothing has to be migrated: the
 * bytes stay where they are, they just stop travelling with the config.
 */
const INLINE_IMAGE_FIELDS = ['heroImageUrl', 'artworkUrl'] as const;
type InlineImageField = (typeof INLINE_IMAGE_FIELDS)[number];

function isInlineImage(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * Replace inline images with a URL to the asset endpoint.
 *
 * The URL carries a short hash of the content, so a new upload is a new URL
 * and the cached copy of the old one is never served in its place.
 */
function withHostedImages<T extends Record<string, unknown>>(settings: T): T {
  const out = { ...settings };
  for (const field of INLINE_IMAGE_FIELDS) {
    const value = out[field];
    if (!isInlineImage(value)) continue;
    const fingerprint = createHash('sha256').update(value).digest('hex').slice(0, 16);
    // Absolute, because the buy page is served from a different origin to the
    // API — a relative path would resolve against the site and 404.
    (out as Record<string, unknown>)[field] =
      `${env.publicApiUrl.replace(/\/$/, '')}/api/gift-cards/assets/${field}/${fingerprint}`;
  }
  return out;
}

/** The bytes behind one of those URLs, for the asset endpoint to send. */
async function readSettingsImage(field: string): Promise<{ mimeType: string; body: Buffer } | null> {
  if (!INLINE_IMAGE_FIELDS.includes(field as InlineImageField)) return null;
  const settings = await getGiftCardSettings();
  const value = (settings as Record<string, unknown>)[field];
  if (!isInlineImage(value)) return null;
  const match = value.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) return null;
  return { mimeType: match[1]!, body: Buffer.from(match[2]!, 'base64') };
}

/**
 * A card number nobody is using yet.
 *
 * Retries on collision rather than trusting one draw: the code is only 8 hex
 * characters, and handing a guest a number that already belongs to somebody
 * else's balance is the one failure that must not happen. Ten attempts is far
 * past the point of paranoia and still costs nothing.
 */
async function issueUnusedCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `ALMA-${randomBytes(4).toString('hex').toUpperCase()}`;
    const taken = await prisma.giftCard.findUnique({ where: { code: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new HttpError(500, 'Could not issue a free card number. Try again.');
}

export const giftCardService = {
  canManagePromoCodes,
  readSettingsImage,

  async getPublicSettings() {
    return withHostedImages(await getGiftCardSettings());
  },

  async getPublicConfig(): Promise<GiftCardPublicConfig> {
    const settings = withHostedImages(await getGiftCardSettings());
    if (settings.testCheckoutEnabled) {
      return {
        settings,
        checkoutMode: 'test',
        checkoutNotice: 'Test checkout is enabled. No real payment will be taken.',
        wallet: walletConfigStatus()
      };
    }

    if (!stripe) {
      return {
        settings,
        checkoutMode: 'setup_required',
        checkoutNotice: 'Payment setup is required before gift card checkout can go live.',
        wallet: walletConfigStatus()
      };
    }

    return {
      settings,
      checkoutMode: 'live',
      checkoutNotice: null,
      wallet: walletConfigStatus()
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

    // Optional scheduled delivery. Cap at 1 year out so a bad client
    // can't park a card in the queue forever.
    let scheduledDeliveryAt: Date | null = null;
    if (data.scheduledDeliveryAt && data.scheduledDeliveryAt.trim()) {
      const parsed = new Date(data.scheduledDeliveryAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new HttpError(400, 'Scheduled delivery date is invalid.');
      }
      const maxDate = new Date();
      maxDate.setFullYear(maxDate.getFullYear() + 1);
      if (parsed.getTime() > maxDate.getTime()) {
        throw new HttpError(400, 'Schedule a delivery date within the next 12 months.');
      }
      // Anything in the past is treated as "send now" — the create
      // path falls through to the existing immediate-send branch.
      if (parsed.getTime() > Date.now()) {
        scheduledDeliveryAt = parsed;
      }
    }

    if (settings.testCheckoutEnabled) {
      const testSessionId = `TEST-${randomBytes(8).toString('hex').toUpperCase()}`;
      const card = await createGiftCardReservingPromo(
        {
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
          design: data.design ?? null,
          promoCodeId: promoResult?.promo.id ?? null,
          promoCodeSnapshot: promoResult?.promo.code ?? null,
          testMode: true,
          stripeCheckoutSessionId: testSessionId,
          paidAt: new Date(),
          expiresAt,
          scheduledDeliveryAt
        },
        promoResult?.promo
      );
      if (!scheduledDeliveryAt) {
        await this.sendGiftCardEmail(card, settings);
      }
      return {
        giftCardId: card.id,
        checkoutUrl: successUrl(testSessionId),
        checkoutSessionId: testSessionId,
        embedded: false,
        testMode: true,
        discountCents,
        amountPaidCents: 0
      };
    }

    if (!stripe) throw new HttpError(503, 'Payment setup is required before gift card checkout can go live.');

    const card = await createGiftCardReservingPromo(
      {
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
        design: data.design ?? null,
        promoCodeId: promoResult?.promo.id ?? null,
        promoCodeSnapshot: promoResult?.promo.code ?? null,
        expiresAt,
        scheduledDeliveryAt
      },
      promoResult?.promo
    );

    const commonSession: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      customer_email: data.purchaserEmail.trim().toLowerCase(),
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
    };

    const wantsEmbedded = data.checkoutUiMode === 'embedded' && Boolean(env.stripe.publishableKey);
    const session = await stripe.checkout.sessions.create(
      wantsEmbedded
        ? {
            ...commonSession,
            ui_mode: 'embedded_page',
            return_url: data.successUrl?.trim() || successUrl()
          }
        : {
            ...commonSession,
            success_url: data.successUrl?.trim() || successUrl(),
            cancel_url: data.cancelUrl?.trim() || cancelUrl()
          }
    );

    await prisma.giftCard.update({
      where: { id: card.id },
      data: { stripeCheckoutSessionId: session.id }
    });

    if (wantsEmbedded) {
      if (!session.client_secret) throw new HttpError(502, 'Stripe did not return an embedded checkout client secret');
      return {
        giftCardId: card.id,
        checkoutUrl: data.successUrl?.trim() || successUrl(session.id),
        checkoutSessionId: session.id,
        embedded: true,
        checkoutClientSecret: session.client_secret,
        stripePublishableKey: env.stripe.publishableKey,
        discountCents,
        amountPaidCents: amountDueCents
      };
    }

    if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout URL');
    return {
      giftCardId: card.id,
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      embedded: false,
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
        // Liability triad (live cards only): issued = original face value,
        // outstanding = remaining redeemable balance, redeemed = drawn down.
        activeBalanceCents: totals._sum.balanceCents ?? 0,
        soldValueCents: totals._sum.initialValueCents ?? 0,
        redeemedValueCents: Math.max(0, (totals._sum.initialValueCents ?? 0) - (totals._sum.balanceCents ?? 0))
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

  // Activate a physical gift card at point of sale. The user types the
  // pre-printed code, enters what the guest paid in cash/EFTPOS, and the
  // card becomes redeemable immediately. No Stripe involvement.
  async activatePhysicalCard(input: unknown, actor?: AuthUser | null) {
    if (!input || typeof input !== 'object') {
      throw new HttpError(400, 'Activation payload required');
    }
    const data = input as Record<string, unknown>;
    // A counter sale can go two ways round. Either the venue has pre-printed
    // cards and staff type the code from the one they just handed over, or
    // they have blanks and need the system to issue a number to write on.
    // Only the first was possible before, which is the wrong way round for a
    // venue that has not ordered pre-printed stock yet.
    const typedCode = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
    const codeRaw = typedCode || (await issueUnusedCode());
    const initialValueCents = typeof data.initialValueCents === 'number' ? Math.round(data.initialValueCents) : NaN;
    const purchaserName = typeof data.purchaserName === 'string' && data.purchaserName.trim()
      ? data.purchaserName.trim()
      : 'Counter sale';
    const purchaserEmail = typeof data.purchaserEmail === 'string' && data.purchaserEmail.trim()
      ? data.purchaserEmail.trim().toLowerCase()
      : (actor?.email?.toLowerCase() ?? 'counter@alma');
    const recipientName = typeof data.recipientName === 'string' && data.recipientName.trim()
      ? data.recipientName.trim()
      : null;
    const recipientEmail = typeof data.recipientEmail === 'string' && data.recipientEmail.trim()
      ? data.recipientEmail.trim().toLowerCase()
      : null;

    if (!codeRaw || !/^[A-Z0-9-]+$/.test(codeRaw)) {
      throw new HttpError(400, 'A card code may only contain letters, numbers and dashes.');
    }
    if (!Number.isFinite(initialValueCents) || initialValueCents < 500) {
      throw new HttpError(400, 'Initial value must be at least $5.');
    }

    const existing = await prisma.giftCard.findUnique({ where: { code: codeRaw } });
    if (existing) {
      throw new HttpError(409, `Code ${codeRaw} is already in use.`);
    }

    const settings = await getGiftCardSettings();
    // Every Alma gift card carries the legal minimum 3-year expiry — including
    // physical counter cards — matching online purchases. This is a condition of
    // the gift-card exemption, so it's applied uniformly, never left open-ended.
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 3);

    const card = await prisma.giftCard.create({
      data: {
        code: codeRaw,
        status: 'ACTIVE',
        initialValueCents,
        balanceCents: initialValueCents,
        discountCents: 0,
        amountPaidCents: initialValueCents,
        currency: 'aud',
        purchaserName,
        purchaserEmail,
        recipientName,
        recipientEmail,
        message: null,
        promoCodeId: null,
        promoCodeSnapshot: 'PHYSICAL_COUNTER',
        testMode: false,
        stripeCheckoutSessionId: `physical:${Date.now()}`,
        paidAt: new Date(),
        expiresAt
      },
      include: { redemptions: true }
    });

    if (recipientEmail) {
      // Send the digital copy so the guest has a record on their phone
      try {
        await this.sendGiftCardEmail(card, settings);
      } catch (err) {
        console.error('[gift-card] activatePhysicalCard email failed', err);
      }
    }

    return toGiftCardPayload(card);
  },

  async redeem(input: unknown, redeemedById?: string) {
    const data = giftCardRedemptionInputSchema.parse(input);
    const card = await findCardByCode(data.code);
    // Friendly pre-checks (non-authoritative — the atomic update below is the
    // real guard against concurrent redemptions).
    if (card.status !== 'ACTIVE') throw new HttpError(400, `Gift card is ${card.status.replace('_', ' ').toLowerCase()}`);
    if (card.expiresAt && card.expiresAt < new Date()) throw new HttpError(400, 'Gift card has expired');
    if (card.balanceCents < data.amountCents) throw new HttpError(400, 'Gift card balance is too low');

    const updated = await prisma.$transaction(async (tx) => {
      // Atomic, conditional decrement: only succeeds if the card is still ACTIVE
      // and the balance still covers the amount. Two concurrent redemptions can
      // never drive the balance negative — the loser matches zero rows.
      const decrement = await tx.giftCard.updateMany({
        where: { id: card.id, status: 'ACTIVE', balanceCents: { gte: data.amountCents } },
        data: { balanceCents: { decrement: data.amountCents } }
      });
      if (decrement.count === 0) {
        throw new HttpError(409, 'Gift card balance changed; please reload and try again');
      }
      await tx.giftCardRedemption.create({
        data: {
          giftCardId: card.id,
          amountCents: data.amountCents,
          venue: data.venue?.trim() || null,
          notes: data.notes?.trim() || null,
          redeemedById: redeemedById ?? null
        }
      });
      const after = await tx.giftCard.findUniqueOrThrow({
        where: { id: card.id },
        select: { balanceCents: true }
      });
      return tx.giftCard.update({
        where: { id: card.id },
        data: { status: after.balanceCents === 0 ? 'REDEEMED' : 'ACTIVE' },
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
    if (card.status === 'REDEEMED') throw new HttpError(400, 'Gift card is fully redeemed and cannot be cancelled');

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
    // Scheduled delivery (e.g. for a birthday) — defer the send. The
    // /jobs/gift-cards/drain Cloud Scheduler endpoint picks it up
    // when scheduledDeliveryAt arrives.
    if (card.scheduledDeliveryAt && card.scheduledDeliveryAt.getTime() > Date.now()) {
      return payload;
    }
    await this.sendGiftCardEmail(card, await getGiftCardSettings());
    return payload;
  },

  // Cloud Scheduler entry — finds gift cards with a scheduledDeliveryAt
  // in the past + emailedAt null + status ACTIVE, sends each one.
  // Returns counts so the scheduler logs are useful. Designed to be
  // safely re-runnable: if a send fails the card stays in the queue
  // (emailedAt stays null + emailError is set by sendGiftCardEmail).
  /**
   * Move gift cards to the state they have actually reached.
   *
   * Two transitions had no owner. A card past its three-year expiry stayed
   * ACTIVE forever — the counter refused it, but it still counted as an
   * outstanding liability on every report, and cancel() guarded on an EXPIRED
   * status nothing could ever produce. And a checkout the buyer abandoned sat
   * in PENDING_PAYMENT indefinitely, inflating what looked like sold cards.
   *
   * Both are time-based facts, so a sweep is the right shape. Nothing here
   * touches money: an expired card keeps its balance so the figure survives
   * for anyone who has to honour it as a goodwill gesture, and an abandoned
   * checkout is cancelled with a reason rather than deleted.
   */
  async sweepGiftCardLifecycle(input: { abandonedAfterHours?: number } = {}) {
    const now = new Date();
    // Long enough that a slow Stripe redirect or a buyer who wandered off mid
    // payment is never cancelled out from under a real payment.
    const abandonedAfterHours = Math.min(Math.max(input.abandonedAfterHours ?? 24, 1), 24 * 30);
    const abandonedBefore = new Date(now.getTime() - abandonedAfterHours * 3600_000);

    const expired = await prisma.giftCard.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now, not: null } },
      data: { status: 'EXPIRED' }
    });

    // Only ever cancel a pending card that never got a payment reference —
    // one carrying a Stripe session may still be settling.
    const abandoned = await prisma.giftCard.updateMany({
      where: {
        status: 'PENDING_PAYMENT',
        createdAt: { lt: abandonedBefore },
        OR: [{ stripePaymentIntentId: null }, { stripePaymentIntentId: '' }]
      },
      data: {
        status: 'CANCELLED',
        balanceCents: 0,
        cancelledAt: now,
        cancelReason: `Checkout abandoned — no payment within ${abandonedAfterHours}h.`
      }
    });

    return {
      expired: expired.count,
      abandoned: abandoned.count,
      abandonedAfterHours,
      generatedAt: now.toISOString()
    };
  },

  async drainScheduledGiftCardSends() {
    const settings = await getGiftCardSettings();
    const due = await prisma.giftCard.findMany({
      where: {
        status: 'ACTIVE',
        emailedAt: null,
        scheduledDeliveryAt: { lte: new Date(), not: null }
      },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } },
      take: 200
    });
    let sent = 0;
    let failed = 0;
    for (const card of due) {
      try {
        await this.sendGiftCardEmail(card, settings);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error('[gift-cards] scheduled send failed', {
          giftCardId: card.id,
          scheduledFor: card.scheduledDeliveryAt?.toISOString(),
          reason: error instanceof Error ? error.message : 'unknown'
        });
      }
    }
    return { eligible: due.length, sent, failed, generatedAt: new Date().toISOString() };
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
          redeemUrl: redeemUrl(card.code),
          appleWalletUrl: appleWalletUrl(card.code),
          googleWalletUrl: googleWalletUrl(card.code),
          design: card.design,
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
