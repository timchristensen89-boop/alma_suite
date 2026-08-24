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
  DONATION_ANNUAL_CAP,
  DONATION_ASSUMED_REDEMPTION_RATE,
  DONATION_FOOD_COST_RATE,
  assessDonation,
  donationActualCostCents,
  donationConditions,
  donationExpectedCostCents,
  donationExpiry,
  donationScore,
  type AuthUser,
  type DonationAllocation,
  type DonationCriteria,
  type DonationRecord,
  type DonationReport,
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
    redeemUrl: redeemUrl(card.code),
    // design === 'custom' is set exactly when a GiftCardArtwork row was stored,
    // so it doubles as the marker without an extra query per card.
    customArtworkUrl: card.design === 'custom' ? artworkUrl(card.code) : null
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

function artworkUrl(code: string) {
  return apiUrl(`/api/gift-cards/artwork/${encodeURIComponent(code)}`);
}

// "Create your own" artwork arrives as a data URL the checkout schema has
// already shape-checked; decode and enforce the real byte cap here (base64
// inflates ~4/3, so the string cap alone can't guarantee the decoded size).
const CUSTOM_ARTWORK_MAX_BYTES = 4 * 1024 * 1024;
function decodeCustomArtwork(dataUrl: string): { mimeType: string; data: Buffer } {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
  if (!match) throw new HttpError(400, 'Custom artwork must be a PNG, JPEG, or WebP image.');
  const data = Buffer.from(match[2]!, 'base64');
  if (data.length === 0) throw new HttpError(400, 'Custom artwork is empty.');
  if (data.length > CUSTOM_ARTWORK_MAX_BYTES) {
    throw new HttpError(400, 'Custom artwork is too large — keep it under 4 MB.');
  }
  return { mimeType: match[1]!, data };
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

/**
 * Purchaser service fee, charged on top of the card value at Stripe checkout.
 * 350 bps = 3.5% — parity with what GiftUp charged purchasers (~3.5–4%), so
 * moving in-house is not a price rise. The fee never touches the card's
 * balance: a $100 card costs $103.50 and is still worth $100.
 *
 * The per-card fee is snapshotted into the Stripe session's metadata at
 * checkout, and the webhook verifies against that snapshot — so changing this
 * rate never strands a checkout that was already in flight.
 */
const GIFT_CARD_SERVICE_FEE_BPS = 350;

function serviceFeeCents(baseCents: number) {
  return Math.round((baseCents * GIFT_CARD_SERVICE_FEE_BPS) / 10000);
}

/** The fee this session was actually created with (0 for pre-fee sessions). */
function sessionServiceFeeCents(session: Stripe.Checkout.Session) {
  const raw = Number(session.metadata?.serviceFeeCents);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
}

/**
 * Every redemption is revenue for one venue — the outstanding card balance is
 * a liability until it lands somewhere, so a redemption with no venue (or a
 * misspelt one) would silently drop money out of both venues' figures.
 * Normalises spellings to the canonical names used across the suite and the
 * POS, and refuses anything unrecognisable.
 */
export const REDEMPTION_VENUES = ['Alma Avalon', 'St Alma', 'Functions / Pop-up'] as const;

function normaliseRedemptionVenue(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value.includes('avalon')) return 'Alma Avalon';
  if (value.includes('alma') || value.includes('freshwater') || value.includes('fresh water')) return 'St Alma';
  if (value.includes('function') || value.includes('pop')) return 'Functions / Pop-up';
  throw new HttpError(400, `Choose the venue taking this redemption: ${REDEMPTION_VENUES.join(', ')}.`);
}

/**
 * Whose voucher a donation is. Not the same list as REDEMPTION_VENUES: a
 * donated raffle prize is written for one venue or for either, and "Functions
 * / Pop-up" is not somewhere a prize winner turns up.
 */
export const DONATION_VENUES = ['St Alma', 'Alma Avalon', 'Either venue'] as const;

/** Staff names for the "approved by" column, in one query rather than N. */
async function approverNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const staff = await prisma.staffProfile.findMany({
    where: { id: { in: wanted } },
    select: { id: true, firstName: true, lastName: true }
  });
  return new Map(staff.map((person) => [person.id, `${person.firstName} ${person.lastName}`.trim()]));
}

function toDonationRecord(
  row: {
    id: string;
    year: number;
    sequence: number;
    organisation: string;
    cause: string | null;
    contactName: string | null;
    contactEmail: string | null;
    venue: string;
    eventDate: Date | null;
    local: boolean;
    bringsPeopleIn: boolean;
    named: boolean;
    existingRelationship: boolean;
    dgrEndorsed: boolean;
    score: number;
    listingEvidence: string | null;
    notes: string | null;
    approvedById: string | null;
    createdAt: Date;
    giftCard: {
      code: string;
      status: string;
      initialValueCents: number;
      balanceCents: number;
      expiresAt: Date | null;
      redemptions: Array<{ amountCents: number; status: string; redeemedAt: Date }>;
    };
  },
  names: Map<string, string>
): DonationRecord {
  // Voided redemptions were put back on the card, so they are not spend.
  const live = row.giftCard.redemptions.filter((redemption) => redemption.status === 'COMPLETED');
  const redeemedCents = live.reduce((sum, redemption) => sum + redemption.amountCents, 0);
  const lastRedeemedAt = live.reduce<Date | null>(
    (latest, redemption) => (!latest || redemption.redeemedAt > latest ? redemption.redeemedAt : latest),
    null
  );
  return {
    id: row.id,
    year: row.year,
    sequence: row.sequence,
    organisation: row.organisation,
    cause: row.cause,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    venue: row.venue,
    eventDate: row.eventDate ? row.eventDate.toISOString() : null,
    criteria: {
      local: row.local,
      bringsPeopleIn: row.bringsPeopleIn,
      named: row.named,
      existingRelationship: row.existingRelationship,
      dgrEndorsed: row.dgrEndorsed
    },
    score: row.score,
    listingEvidence: row.listingEvidence,
    notes: row.notes,
    approvedByName: row.approvedById ? (names.get(row.approvedById) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    card: {
      code: row.giftCard.code,
      status: row.giftCard.status,
      initialValueCents: row.giftCard.initialValueCents,
      balanceCents: row.giftCard.balanceCents,
      redeemedCents,
      expiresAt: row.giftCard.expiresAt ? row.giftCard.expiresAt.toISOString() : null,
      lastRedeemedAt: lastRedeemedAt ? lastRedeemedAt.toISOString() : null
    }
  };
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
        serviceFeeBps: GIFT_CARD_SERVICE_FEE_BPS,
        wallet: walletConfigStatus()
      };
    }

    if (!stripe) {
      return {
        settings,
        checkoutMode: 'setup_required',
        checkoutNotice: 'Payment setup is required before gift card checkout can go live.',
        serviceFeeBps: GIFT_CARD_SERVICE_FEE_BPS,
        wallet: walletConfigStatus()
      };
    }

    return {
      settings,
      checkoutMode: 'live',
      checkoutNotice: null,
      serviceFeeBps: GIFT_CARD_SERVICE_FEE_BPS,
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

  /**
   * `counter` marks a sale a staff member is ringing up face to face. The
   * customer still pays through Stripe — they scan a QR and tap on their own
   * phone — so no card details ever touch the iPad, and the venue needs no
   * reader hardware. The flag only changes how the sale is labelled.
   */
  async createCheckout(input: unknown, options: { counter?: boolean; soldByStaffId?: string | null } = {}) {
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

    // Decode "Create your own" artwork up front so a bad upload fails the
    // request before any card row exists.
    const customArtwork = data.customArtwork ? decodeCustomArtwork(data.customArtwork) : null;

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
          design: customArtwork ? 'custom' : data.design ?? null,
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
      if (customArtwork) {
        await prisma.giftCardArtwork.create({
          data: { giftCardId: card.id, mimeType: customArtwork.mimeType, data: new Uint8Array(customArtwork.data) }
        });
      }
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
        serviceFeeCents: 0,
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
        design: customArtwork ? 'custom' : data.design ?? null,
        promoCodeId: promoResult?.promo.id ?? null,
        promoCodeSnapshot: promoResult?.promo.code ?? null,
        saleChannel: options.counter ? 'COUNTER' : 'ONLINE',
        tender: 'STRIPE',
        soldByStaffId: options.counter ? options.soldByStaffId ?? null : null,
        expiresAt,
        scheduledDeliveryAt
      },
      promoResult?.promo
    );
    // Persist the artwork BEFORE the Stripe session: Stripe metadata can't
    // carry it (500-char values), and the webhook path only knows the card id.
    if (customArtwork) {
      await prisma.giftCardArtwork.create({
        data: { giftCardId: card.id, mimeType: customArtwork.mimeType, data: new Uint8Array(customArtwork.data) }
      });
    }

    // Service fee on what the purchaser actually owes (after any promo). A
    // separate Stripe line item, so the receipt reads "$100 card + $3.50 fee"
    // rather than a single opaque $103.50.
    const feeCents = serviceFeeCents(amountDueCents);

    const commonSession: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      customer_email: data.purchaserEmail.trim().toLowerCase(),
      client_reference_id: card.id,
      metadata: {
        giftCardId: card.id,
        giftCardCode: card.code,
        promoCode: promoResult?.promo.code ?? '',
        discountCents: String(discountCents),
        serviceFeeCents: String(feeCents)
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
        },
        ...(feeCents > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: 'aud',
                  unit_amount: feeCents,
                  product_data: {
                    name: 'Service fee',
                    description: `${(GIFT_CARD_SERVICE_FEE_BPS / 100).toFixed(1)}% card processing — not deducted from the gift card`
                  }
                }
              }
            ]
          : [])
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
        serviceFeeCents: feeCents,
        amountPaidCents: amountDueCents + feeCents
      };
    }

    if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout URL');
    return {
      giftCardId: card.id,
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      embedded: false,
      discountCents,
      serviceFeeCents: feeCents,
      amountPaidCents: amountDueCents + feeCents
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
    // Status governs, not paidAt: a comped counter card and a donation
    // voucher are live with paidAt deliberately null, and both 404'd here
    // with a message blaming Stripe for a payment that never existed.
    if (!['ACTIVE', 'REDEEMED'].includes(card.status)) {
      throw new HttpError(404, 'This gift card is not live yet.');
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

    // Redemption revenue split by venue — server-side over ALL redemptions
    // (the card list above is capped at 100, so client-side sums undercount).
    // Each redemption is that venue's revenue; the remaining balances above
    // are the liability still owed. `venue: null` rows predate the venue
    // requirement and surface as "Unallocated" rather than disappearing.
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [venueLifetime, venueMonth] = await Promise.all([
      prisma.giftCardRedemption.groupBy({
        by: ['venue'],
        _sum: { amountCents: true },
        where: { status: 'COMPLETED', giftCard: { testMode: false } }
      }),
      prisma.giftCardRedemption.groupBy({
        by: ['venue'],
        _sum: { amountCents: true },
        where: { status: 'COMPLETED', giftCard: { testMode: false }, redeemedAt: { gte: monthStart } }
      })
    ]);
    const monthByVenue = new Map(venueMonth.map((row) => [row.venue ?? 'Unallocated', row._sum.amountCents ?? 0]));
    const redeemedByVenue = venueLifetime
      .map((row) => ({
        venue: row.venue ?? 'Unallocated',
        lifetimeCents: row._sum.amountCents ?? 0,
        monthCents: monthByVenue.get(row.venue ?? 'Unallocated') ?? 0
      }))
      .sort((a, b) => b.lifetimeCents - a.lifetimeCents);

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
        redeemedValueCents: Math.max(0, (totals._sum.initialValueCents ?? 0) - (totals._sum.balanceCents ?? 0)),
        redeemedByVenue
      }
    };
  },

  // View-only reporting: which cards were redeemed, for how much, at which
  // venue, and by whom. Staff names are resolved server-side so the client
  // never needs the staff directory. Sold/outstanding figures ride along so
  // the page reads as one statement: money in, money drawn down, money owed.
  async report(input: { from?: string; to?: string; venue?: string; includeTest?: boolean }) {
    const to = input.to ? new Date(input.to) : new Date();
    const from = input.from ? new Date(input.from) : null;
    if (Number.isNaN(to.getTime()) || (from !== null && Number.isNaN(from.getTime()))) {
      throw new HttpError(400, 'from and to must be ISO dates.');
    }
    // Test cards are out of the numbers by default — they are not money and a
    // liability figure that counts them is wrong. But a redemption you cannot
    // see is indistinguishable from a redemption that did not happen, so there
    // has to be a way to look: with the toggle on, test rows join the log and
    // the totals, and every one of them is flagged as test on the way out.
    const includeTest = input.includeTest === true;
    const realCardsOnly = includeTest ? {} : { testMode: false };
    const redeemedAt = { lte: to, ...(from ? { gte: from } : {}) };
    const redemptionWhere = {
      status: 'COMPLETED' as const,
      ...(includeTest ? {} : { giftCard: { testMode: false } }),
      // "Unallocated" is the report's name for redemptions that predate the
      // venue requirement — filtering by it must find those NULL rows.
      ...(input.venue ? { venue: input.venue === 'Unallocated' ? null : input.venue } : {}),
      redeemedAt
    };
    const LOG_CAP = 500;
    const [rows, byVenueRaw, redeemedTotal, sold, liability] = await Promise.all([
      prisma.giftCardRedemption.findMany({
        where: redemptionWhere,
        orderBy: [{ redeemedAt: 'desc' }],
        take: LOG_CAP,
        include: {
          giftCard: { select: { code: true, status: true, purchaserName: true, recipientName: true, testMode: true } }
        }
      }),
      prisma.giftCardRedemption.groupBy({
        by: ['venue'],
        _sum: { amountCents: true },
        _count: { _all: true },
        where: redemptionWhere
      }),
      prisma.giftCardRedemption.aggregate({
        _sum: { amountCents: true },
        _count: { _all: true },
        where: redemptionWhere
      }),
      prisma.giftCard.aggregate({
        _sum: { initialValueCents: true },
        _count: { _all: true },
        where: {
          ...realCardsOnly,
          status: { in: ['ACTIVE', 'REDEEMED'] },
          paidAt: { lte: to, ...(from ? { gte: from } : {}) }
        }
      }),
      prisma.giftCard.aggregate({
        _sum: { balanceCents: true },
        _count: { _all: true },
        where: { ...realCardsOnly, status: 'ACTIVE' }
      })
    ]);
    const staffIds = [...new Set(rows.map((row) => row.redeemedById).filter((id): id is string => Boolean(id)))];
    const staff = staffIds.length
      ? await prisma.staffProfile.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, firstName: true, lastName: true }
        })
      : [];
    const staffName = new Map(staff.map((member) => [member.id, `${member.firstName} ${member.lastName}`.trim()]));
    return {
      range: { from: from ? from.toISOString() : null, to: to.toISOString() },
      summary: {
        redemptionCount: redeemedTotal._count._all,
        redeemedCents: redeemedTotal._sum.amountCents ?? 0,
        cardsSoldCount: sold._count._all,
        cardsSoldCents: sold._sum.initialValueCents ?? 0,
        outstandingCents: liability._sum.balanceCents ?? 0,
        activeCards: liability._count._all
      },
      byVenue: byVenueRaw
        .map((row) => ({
          venue: row.venue ?? 'Unallocated',
          redemptionCount: row._count._all,
          redeemedCents: row._sum.amountCents ?? 0
        }))
        .sort((a, b) => b.redeemedCents - a.redeemedCents),
      redemptions: rows.map((row) => ({
        id: row.id,
        redeemedAt: row.redeemedAt.toISOString(),
        amountCents: row.amountCents,
        venue: row.venue,
        notes: row.notes,
        code: row.giftCard.code,
        cardStatus: row.giftCard.status,
        recipientName: row.giftCard.recipientName,
        purchaserName: row.giftCard.purchaserName,
        testMode: row.giftCard.testMode,
        redeemedByName: row.redeemedById ? (staffName.get(row.redeemedById) ?? null) : null
      })),
      includeTest,
      truncated: rows.length === LOG_CAP
    };
  },

  /**
   * One row per card sold: when, how, by whom, for whom, and what has
   * happened to it since. The companion to report() (redemption-centric).
   * Range filters on paidAt — the moment the card became real money — which
   * for imported GiftUp cards is the original GiftUp purchase date.
   */
  async purchaseReport(input: { from?: string; to?: string; source?: string; query?: string }) {
    const to = input.to ? new Date(input.to) : new Date();
    const from = input.from ? new Date(input.from) : null;
    if (Number.isNaN(to.getTime()) || (from !== null && Number.isNaN(from.getTime()))) {
      throw new HttpError(400, 'from and to must be ISO dates.');
    }
    const query = input.query?.trim();
    const source = input.source?.trim().toUpperCase();
    // How a card was sold, derived from the row: GiftUp import → GIFTUP;
    // physical/counter activation → PHYSICAL; POS/counter Stripe → COUNTER;
    // storefront → ONLINE; test checkouts → TEST.
    const sourceWhere =
      source === 'GIFTUP'
        ? { promoCodeSnapshot: 'GIFTUP_IMPORT' }
        : source === 'PHYSICAL'
          ? { promoCodeSnapshot: 'PHYSICAL_COUNTER' }
          : source === 'COUNTER'
            ? { saleChannel: 'COUNTER', promoCodeSnapshot: { not: 'PHYSICAL_COUNTER' } }
            : source === 'ONLINE'
              ? { saleChannel: 'ONLINE', testMode: false, NOT: { promoCodeSnapshot: 'GIFTUP_IMPORT' } }
              : source === 'TEST'
                ? { testMode: true }
                : {};
    const where = {
      paidAt: { lte: to, ...(from ? { gte: from } : {}) },
      // Test checkouts are visible ONLY under the TEST source filter. The
      // default view used to include them, so a Stripe test card inflated
      // sold value, card count and the popularity rankings.
      ...(source === 'TEST' ? {} : { testMode: false }),
      ...sourceWhere,
      ...(query
        ? {
            OR: [
              { code: { contains: query, mode: 'insensitive' as const } },
              { purchaserEmail: { contains: query, mode: 'insensitive' as const } },
              { purchaserName: { contains: query, mode: 'insensitive' as const } },
              { recipientEmail: { contains: query, mode: 'insensitive' as const } },
              { recipientName: { contains: query, mode: 'insensitive' as const } }
            ]
          }
        : {})
    };
    const CAP = 1000;
    const [cards, totals] = await Promise.all([
      prisma.giftCard.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }],
        take: CAP,
        include: { redemptions: { where: { status: 'COMPLETED' }, orderBy: [{ redeemedAt: 'desc' }] } }
      }),
      prisma.giftCard.aggregate({
        _sum: { initialValueCents: true, amountPaidCents: true, balanceCents: true },
        _count: { _all: true },
        where
      })
    ]);
    const staffIds = [...new Set(cards.map((card) => card.soldByStaffId).filter((id): id is string => Boolean(id)))];
    const staff = staffIds.length
      ? await prisma.staffProfile.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const staffName = new Map(staff.map((member) => [member.id, `${member.firstName} ${member.lastName}`.trim()]));

    const sourceOf = (card: (typeof cards)[number]): 'ONLINE' | 'COUNTER' | 'GIFTUP' | 'PHYSICAL' | 'TEST' =>
      card.testMode
        ? 'TEST'
        : card.promoCodeSnapshot === 'GIFTUP_IMPORT'
          ? 'GIFTUP'
          : card.promoCodeSnapshot === 'PHYSICAL_COUNTER'
            ? 'PHYSICAL'
            : card.saleChannel === 'COUNTER'
              ? 'COUNTER'
              : 'ONLINE';

    const bySource = new Map<string, { cardCount: number; soldCents: number }>();
    for (const card of cards) {
      const key = sourceOf(card);
      const entry = bySource.get(key) ?? { cardCount: 0, soldCents: 0 };
      entry.cardCount += 1;
      entry.soldCents += card.initialValueCents;
      bySource.set(key, entry);
    }

    // Most popular design and most common value, over the cards in this window.
    // (Capped at CAP like the log; the UI says "in this window".)
    const byDesign = new Map<string, { count: number; soldCents: number }>();
    const byValue = new Map<number, number>();
    for (const card of cards) {
      const design = card.design ?? 'default';
      const d = byDesign.get(design) ?? { count: 0, soldCents: 0 };
      d.count += 1;
      d.soldCents += card.initialValueCents;
      byDesign.set(design, d);
      byValue.set(card.initialValueCents, (byValue.get(card.initialValueCents) ?? 0) + 1);
    }
    const popular = {
      byDesign: [...byDesign.entries()]
        .map(([design, entry]) => ({ design, ...entry }))
        .sort((a, b) => b.count - a.count || b.soldCents - a.soldCents),
      byValue: [...byValue.entries()]
        .map(([valueCents, count]) => ({ valueCents, count }))
        .sort((a, b) => b.count - a.count || b.valueCents - a.valueCents)
    };

    const soldCents = totals._sum.initialValueCents ?? 0;
    const outstandingCents = totals._sum.balanceCents ?? 0;
    return {
      popular,
      range: { from: from ? from.toISOString() : null, to: to.toISOString() },
      summary: {
        cardCount: totals._count._all,
        soldCents,
        paidCents: totals._sum.amountPaidCents ?? 0,
        outstandingCents,
        redeemedCents: Math.max(0, soldCents - outstandingCents)
      },
      bySource: [...bySource.entries()]
        .map(([source, entry]) => ({ source, ...entry }))
        .sort((a, b) => b.soldCents - a.soldCents),
      purchases: cards.map((card) => ({
        code: card.code,
        status: card.status,
        purchasedAt: (card.paidAt ?? card.createdAt).toISOString(),
        source: sourceOf(card),
        tender: card.tender,
        soldByName: card.soldByStaffId ? (staffName.get(card.soldByStaffId) ?? null) : null,
        initialValueCents: card.initialValueCents,
        discountCents: card.discountCents,
        amountPaidCents: card.amountPaidCents,
        balanceCents: card.balanceCents,
        redeemedCents: card.redemptions.reduce((sum, redemption) => sum + redemption.amountCents, 0),
        purchaserName: card.purchaserName,
        purchaserEmail: card.purchaserEmail,
        recipientName: card.recipientName,
        recipientEmail: card.recipientEmail,
        message: card.message,
        design: card.design,
        promoCode:
          card.promoCodeSnapshot && !['GIFTUP_IMPORT', 'PHYSICAL_COUNTER'].includes(card.promoCodeSnapshot)
            ? card.promoCodeSnapshot
            : null,
        scheduledDeliveryAt: card.scheduledDeliveryAt?.toISOString() ?? null,
        emailedAt: card.emailedAt?.toISOString() ?? null,
        emailError: card.emailError,
        lastRedeemedAt: card.redemptions[0]?.redeemedAt.toISOString() ?? null,
        redemptionCount: card.redemptions.length,
        cancelledAt: card.cancelledAt?.toISOString() ?? null,
        cancelReason: card.cancelReason,
        expiresAt: card.expiresAt?.toISOString() ?? null,
        stripePaymentIntentId: card.stripePaymentIntentId
      })),
      truncated: cards.length === CAP
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
    // The guard here is about an online order Stripe has not confirmed yet,
    // which is exactly what PENDING_PAYMENT means. It used to also test
    // paidAt — but a comped counter card and a donation voucher are both live
    // with paidAt deliberately null, so checking the balance on either came
    // back "payment has not been confirmed". Status is the thing that governs
    // whether a card can be used, so status is what this asks.
    if (card.status === 'PENDING_PAYMENT') {
      throw new HttpError(404, 'Gift card payment has not been confirmed by Stripe.');
    }
    // A donation voucher carries conditions an ordinary card does not, and the
    // person holding it will not have read them. Ride them along so the counter
    // can say so before the redemption, not after.
    const donation = await prisma.giftCardDonation.findUnique({
      where: { giftCardId: card.id },
      select: { organisation: true, year: true, sequence: true, venue: true }
    });
    return {
      ...toGiftCardPayload(card),
      // Same rule as the public payload: design === 'custom' is set exactly
      // when artwork bytes were stored. Without this the counter's Balance
      // panel drew the preset fallback for a custom card — staff compared the
      // guest's card against artwork the buyer never chose.
      customArtworkUrl: card.design === 'custom' ? artworkUrl(card.code) : null,
      donation: donation
        ? {
            organisation: donation.organisation,
            reference: `${donation.year}/${donation.sequence}`,
            venue: donation.venue,
            conditions: donationConditions()
          }
        : null
    };
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

    // How the money was taken. A counter sale usually goes through the venue's
    // own POS, and recording that here is what lets gift card revenue reconcile
    // against takings instead of appearing from nowhere. COMP is a giveaway —
    // real card, no money, and worth being able to tell apart later.
    const TENDERS = ['CARD', 'CASH', 'EFTPOS', 'STRIPE', 'COMP'] as const;
    const tenderRaw = typeof data.tender === 'string' ? data.tender.trim().toUpperCase() : '';
    const tender = (TENDERS as readonly string[]).includes(tenderRaw) ? tenderRaw : 'CARD';
    const tenderReference = typeof data.tenderReference === 'string' && data.tenderReference.trim()
      ? data.tenderReference.trim().slice(0, 64)
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
        // A comped card was never paid for. Leaving paidAt set would put it in
        // the sold-value total and overstate what the venue actually took.
        paidAt: tender === 'COMP' ? null : new Date(),
        amountPaidCents: tender === 'COMP' ? 0 : initialValueCents,
        saleChannel: 'COUNTER',
        tender,
        tenderReference,
        soldByStaffId: actor?.id ?? null,
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

  /* ---------------------------------------------------------------- */
  /* Donations and sponsorship                                         */
  /* ---------------------------------------------------------------- */

  /** How many of this year's twelve are gone, and how many are left. */
  async donationAllocation(year = new Date().getFullYear()): Promise<DonationAllocation> {
    const used = await prisma.giftCardDonation.count({ where: { year } });
    return { year, cap: DONATION_ANNUAL_CAP, used, remaining: Math.max(0, DONATION_ANNUAL_CAP - used) };
  },

  /**
   * Issue a donation voucher.
   *
   * A real gift card, so it behaves like one at the till and shows up in the
   * card register — but comped, twelve months rather than three years, and
   * booked against the year's allocation of twelve. The cap is held by a unique
   * index on (year, sequence) rather than by a check up here, so two managers
   * issuing at the same moment cannot both take the last one.
   */
  async recordDonation(input: unknown, actor?: AuthUser | null) {
    if (!input || typeof input !== 'object') throw new HttpError(400, 'Donation details required.');
    const data = input as Record<string, unknown>;

    const str = (key: string, max = 200) => {
      const value = data[key];
      return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
    };
    const flag = (key: string) => data[key] === true;

    const organisation = str('organisation');
    const amountCents =
      typeof data.amountCents === 'number' ? Math.round(data.amountCents) : NaN;
    const venueRaw = str('venue') ?? '';
    const venue = (DONATION_VENUES as readonly string[]).includes(venueRaw) ? venueRaw : '';
    const criteria: DonationCriteria = {
      local: flag('local'),
      bringsPeopleIn: flag('bringsPeopleIn'),
      named: flag('named'),
      existingRelationship: flag('existingRelationship'),
      dgrEndorsed: flag('dgrEndorsed')
    };

    if (!venue) {
      throw new HttpError(400, `Choose whose voucher this is: ${DONATION_VENUES.join(', ')}.`);
    }

    const year = new Date().getFullYear();
    const used = await prisma.giftCardDonation.count({ where: { year } });
    const verdict = assessDonation({
      amountCents: Number.isFinite(amountCents) ? amountCents : 0,
      used,
      criteria,
      organisation: organisation ?? ''
    });
    if (!verdict.ok) {
      // One sentence, because a wall of them is a wall nobody reads.
      throw new HttpError(400, verdict.reasons.join(' '));
    }

    const eventDateRaw = str('eventDate');
    const eventDate = eventDateRaw ? new Date(eventDateRaw) : null;
    const issuedAt = new Date();
    const expiresAt = donationExpiry(issuedAt);
    const conditions = donationConditions();

    // Retry once per remaining slot: the only way the create loses is another
    // manager taking the sequence number we just read, and there are at most
    // twelve of those in a year.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < DONATION_ANNUAL_CAP; attempt += 1) {
      const highest = await prisma.giftCardDonation.findFirst({
        where: { year },
        orderBy: { sequence: 'desc' },
        select: { sequence: true }
      });
      const sequence = (highest?.sequence ?? 0) + 1;
      if (sequence > DONATION_ANNUAL_CAP) {
        throw new HttpError(
          409,
          `All ${DONATION_ANNUAL_CAP} donations for ${year} are gone. The answer is no until the calendar turns.`
        );
      }
      try {
        const created = await prisma.$transaction(async (tx) => {
          const card = await tx.giftCard.create({
            data: {
              code: await issueUnusedCode(),
              status: 'ACTIVE',
              initialValueCents: amountCents,
              balanceCents: amountCents,
              discountCents: 0,
              currency: 'aud',
              purchaserName: `Donation · ${organisation}`,
              purchaserEmail: str('contactEmail', 160)?.toLowerCase() ?? (actor?.email?.toLowerCase() ?? 'donations@alma'),
              recipientName: str('contactName', 120),
              // Deliberately not emailed on issue. A raffle prize goes to
              // whoever wins it, not to the person who asked for it, so the
              // card number is handed over on paper or forwarded by Tim.
              recipientEmail: null,
              message: conditions,
              promoCodeId: null,
              promoCodeSnapshot: 'DONATION',
              testMode: false,
              stripeCheckoutSessionId: `donation:${year}:${sequence}`,
              // No money changed hands. paidAt stays null so this never lands
              // in a sold-value total and overstates takings.
              paidAt: null,
              amountPaidCents: 0,
              saleChannel: 'DONATION',
              tender: 'COMP',
              tenderReference: `${organisation} ${year}/${sequence}`.slice(0, 64),
              soldByStaffId: actor?.id ?? null,
              expiresAt
            },
            include: { redemptions: true }
          });
          const donation = await tx.giftCardDonation.create({
            data: {
              giftCardId: card.id,
              year,
              sequence,
              organisation: organisation!,
              cause: str('cause', 300),
              contactName: str('contactName', 120),
              contactEmail: str('contactEmail', 160)?.toLowerCase() ?? null,
              venue,
              eventDate: eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate : null,
              ...criteria,
              score: donationScore(criteria),
              listingEvidence: str('listingEvidence', 400),
              notes: str('notes', 1000),
              approvedById: actor?.id ?? null
            }
          });
          return { card, donation };
        });
        console.info(
          `[gift-cards] donation ${year}/${created.donation.sequence} code=${created.card.code} ` +
            `${organisation} ${amountCents}c venue=${venue} by ${actor?.email ?? actor?.id ?? 'unknown'}`
        );
        return {
          card: toGiftCardPayload(created.card),
          donation: await this.getDonation(created.donation.id),
          allocation: await this.donationAllocation(year),
          warnings: verdict.warnings
        };
      } catch (error) {
        // P2002 on (year, sequence) — somebody else took that number. Read the
        // highest again and try for the next one.
        const code = (error as { code?: string } | null)?.code;
        if (code !== 'P2002') throw error;
        lastError = error;
      }
    }
    throw (lastError ?? new HttpError(409, 'Could not book that donation. Try again.'));
  },

  async getDonation(id: string): Promise<DonationRecord> {
    const row = await prisma.giftCardDonation.findUnique({
      where: { id },
      include: { giftCard: { include: { redemptions: true } } }
    });
    if (!row) throw new HttpError(404, 'No such donation.');
    return toDonationRecord(row, await approverNames([row.approvedById]));
  },

  /**
   * Record the listing after the fact.
   *
   * The policy's tax note turns on being named: keep the email confirming the
   * listing and file it with the invoice. This is where that gets written down,
   * so it exists when the accountant asks rather than in somebody's inbox.
   */
  async updateDonation(id: string, input: unknown): Promise<DonationRecord> {
    if (!input || typeof input !== 'object') throw new HttpError(400, 'Nothing to update.');
    const data = input as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof data.listingEvidence === 'string') patch.listingEvidence = data.listingEvidence.trim().slice(0, 400) || null;
    if (typeof data.notes === 'string') patch.notes = data.notes.trim().slice(0, 1000) || null;
    if (typeof data.named === 'boolean') patch.named = data.named;
    if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to update.');

    const existing = await prisma.giftCardDonation.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'No such donation.');
    if (typeof patch.named === 'boolean') {
      patch.score = donationScore({
        local: existing.local,
        bringsPeopleIn: existing.bringsPeopleIn,
        named: patch.named as boolean,
        existingRelationship: existing.existingRelationship,
        dgrEndorsed: existing.dgrEndorsed
      });
    }
    await prisma.giftCardDonation.update({ where: { id }, data: patch });
    return this.getDonation(id);
  },

  /**
   * The donation register for a year.
   *
   * The policy claims twelve $200 vouchers cost $500–800 rather than $2,400.
   * This is where that claim gets checked: face value against value actually
   * redeemed, at food cost, with the redemption rate measured instead of
   * assumed — which the policy itself asks for.
   */
  async donationReport(input: { year?: number } = {}): Promise<DonationReport> {
    const year = Number.isFinite(input.year) ? Number(input.year) : new Date().getFullYear();
    const rows = await prisma.giftCardDonation.findMany({
      where: { year },
      orderBy: { sequence: 'asc' },
      include: { giftCard: { include: { redemptions: true } } }
    });
    const names = await approverNames(rows.map((row) => row.approvedById));
    const donations = rows.map((row) => toDonationRecord(row, names));

    const faceValueCents = donations.reduce((sum, row) => sum + row.card.initialValueCents, 0);
    const redeemedCents = donations.reduce((sum, row) => sum + row.card.redeemedCents, 0);
    const now = new Date();
    const expiredUnusedCents = rows.reduce((sum, row) => {
      const expired = row.giftCard.expiresAt ? row.giftCard.expiresAt < now : false;
      return expired ? sum + row.giftCard.balanceCents : sum;
    }, 0);

    const byVenueMap = new Map<string, { venue: string; count: number; faceValueCents: number; redeemedCents: number }>();
    for (const row of donations) {
      const entry = byVenueMap.get(row.venue) ?? { venue: row.venue, count: 0, faceValueCents: 0, redeemedCents: 0 };
      entry.count += 1;
      entry.faceValueCents += row.card.initialValueCents;
      entry.redeemedCents += row.card.redeemedCents;
      byVenueMap.set(row.venue, entry);
    }

    return {
      year,
      allocation: { year, cap: DONATION_ANNUAL_CAP, used: rows.length, remaining: Math.max(0, DONATION_ANNUAL_CAP - rows.length) },
      summary: {
        faceValueCents,
        redeemedCents,
        actualCostCents: donationActualCostCents(redeemedCents, DONATION_FOOD_COST_RATE),
        expectedCostCents: donationExpectedCostCents(faceValueCents, DONATION_ASSUMED_REDEMPTION_RATE, DONATION_FOOD_COST_RATE),
        // Value-weighted, because cost follows dollars and not card counts.
        // Null with nothing issued, rather than a misleading zero.
        redemptionRate: faceValueCents > 0 ? redeemedCents / faceValueCents : null,
        unusedCount: donations.filter((row) => row.card.redeemedCents === 0).length,
        expiredUnusedCents
      },
      byVenue: [...byVenueMap.values()].sort((a, b) => b.faceValueCents - a.faceValueCents),
      donations
    };
  },

  async redeem(input: unknown, redeemedById?: string) {
    const data = giftCardRedemptionInputSchema.parse(input);
    const venue = normaliseRedemptionVenue(data.venue);
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
          venue,
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
    // Expected = card value − promo + the service fee this exact session was
    // created with (from its metadata snapshot, so a rate change can't strand
    // an in-flight checkout).
    const expectedAmountCents =
      existing.initialValueCents - existing.discountCents + sessionServiceFeeCents(session);
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

    // Stale pending cards are NOT simply cancelled. A buyer who paid and then
    // closed the tab before the success page loaded, on a webhook that never
    // arrived, has a paid card sitting in PENDING_PAYMENT — cancelling that on
    // a timer would take money and give nothing back. Stripe is the authority,
    // so ask it about every stale card that got as far as a checkout session.
    const stale = await prisma.giftCard.findMany({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: abandonedBefore } },
      select: { id: true, stripeCheckoutSessionId: true },
      take: 200
    });

    let abandoned = 0;
    let recovered = 0;
    let unresolved = 0;
    for (const card of stale) {
      if (!card.stripeCheckoutSessionId || !stripe) {
        // Never reached Stripe at all — safe to close off.
        const closed = await prisma.giftCard.updateMany({
          where: { id: card.id, status: 'PENDING_PAYMENT' },
          data: {
            status: 'CANCELLED',
            balanceCents: 0,
            cancelledAt: now,
            cancelReason: `Checkout abandoned — no payment within ${abandonedAfterHours}h.`
          }
        });
        abandoned += closed.count;
        continue;
      }
      try {
        const session = await stripe.checkout.sessions.retrieve(card.stripeCheckoutSessionId, {
          expand: ['payment_intent']
        });
        if (isStripePaymentConfirmed(session)) {
          // The webhook was lost. Activate and send it now — late is recoverable,
          // cancelled is not.
          await this.handleCheckoutCompleted(session);
          recovered += 1;
        } else if (session.status === 'expired' || session.payment_status === 'unpaid') {
          await this.disregardUnconfirmedCheckout(session, `Checkout abandoned — Stripe reports no payment after ${abandonedAfterHours}h.`);
          abandoned += 1;
        } else {
          // Still open at Stripe. Leave it and look again tomorrow.
          unresolved += 1;
        }
      } catch (error) {
        // A Stripe outage must never cancel a card. Leave it pending.
        unresolved += 1;
        console.error('[gift-cards] lifecycle sweep could not reach Stripe', {
          giftCardId: card.id,
          reason: error instanceof Error ? error.message : 'unknown'
        });
      }
    }

    return {
      expired: expired.count,
      abandoned,
      /** Paid cards whose webhook never arrived, activated by this sweep. */
      recovered,
      /** Still open at Stripe, or Stripe was unreachable — left pending. */
      unresolved,
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

  // Serve the customer-designed artwork by card code (public — the code is the
  // secret, same trust model as /qr/:code and /print/:code).
  async getArtworkByCode(code: string): Promise<{ mimeType: string; data: Buffer }> {
    const card = await prisma.giftCard.findUnique({ where: { code }, select: { id: true } });
    if (!card) throw new HttpError(404, 'Gift card not found.');
    const artwork = await prisma.giftCardArtwork.findUnique({ where: { giftCardId: card.id } });
    if (!artwork) throw new HttpError(404, 'This gift card has no custom artwork.');
    return { mimeType: artwork.mimeType, data: Buffer.from(artwork.data) };
  },

  async sendGiftCardEmail(card: Parameters<typeof toGiftCardPayload>[0], settings: GiftCardSettings) {
    if (card.emailedAt) return toGiftCardPayload(card);
    const recipients = Array.from(new Set([card.purchaserEmail, card.recipientEmail].filter(Boolean)));
    if (recipients.length === 0) return toGiftCardPayload(card);

    // "Create your own" cards carry the customer's rendered artwork — the
    // email attaches it and shows it inline via the hosted URL.
    const artworkRow = card.design === 'custom'
      ? await prisma.giftCardArtwork.findUnique({ where: { giftCardId: card.id } })
      : null;

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
          settings,
          ...(artworkRow
            ? {
                customArtwork: {
                  data: Buffer.from(artworkRow.data),
                  mimeType: artworkRow.mimeType,
                  url: artworkUrl(card.code)
                }
              }
            : {})
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

  // Manager-triggered re-send of the voucher email — the recovery for a card
  // whose delivery failed (emailError set) or that a customer says never
  // arrived even though we recorded a send (a first send can bounce silently).
  // A deliberate resend must go out regardless: sendGiftCardEmail short-circuits
  // when emailedAt is set, so clear it first, then send. Paid live cards only.
  async resendGiftCardEmail(code: string) {
    const card = await findCardByCode(code);
    // Status, not paidAt — a donation voucher or comped counter card is
    // ACTIVE with paidAt deliberately null, and its email can fail like any
    // other card's.
    if (card.status !== 'ACTIVE') {
      throw new HttpError(400, 'Only an active gift card can have its voucher resent.');
    }
    if (!card.purchaserEmail && !card.recipientEmail) {
      throw new HttpError(400, 'This card has no email address on file to send to.');
    }
    const reset = await prisma.giftCard.update({
      where: { id: card.id },
      data: { emailedAt: null },
      include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } }
    });
    const result = await this.sendGiftCardEmail(reset, await getGiftCardSettings());
    // sendGiftCardEmail swallows a provider failure into emailError rather than
    // throwing; surface it so the button reports the real outcome.
    if (result.emailError) {
      throw new HttpError(502, `Could not send the voucher: ${result.emailError}`);
    }
    return result;
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
    // Status governs — donation and comped cards are live with paidAt null.
    if (!['ACTIVE', 'REDEEMED'].includes(card.status)) {
      throw new HttpError(404, 'This gift card is not live yet.');
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
