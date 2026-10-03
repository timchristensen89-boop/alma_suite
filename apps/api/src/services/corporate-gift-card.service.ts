import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  GIFT_CARD_MAX_AMOUNT_CENTS,
  GIFT_CARD_MIN_AMOUNT_CENTS,
  GIFT_CARD_SERVICE_FEE_BPS,
  corporateAccountInputSchema,
  corporateAccountTermsInputSchema,
  corporateAccountUpdateSchema,
  corporateAllocationInputSchema,
  corporateCsvImportInputSchema,
  corporateManualPaymentInputSchema,
  corporateOrderCancelInputSchema,
  corporateOrderInputSchema,
  corporateReassignInputSchema,
  quoteCorporateOrder,
  splitDiscountAcrossCards,
  type AuthUser,
  type CorporateAccount,
  type CorporateAccountExportRow,
  type CorporateAccountStats,
  type CorporateAccountSummary,
  type CorporateCsvImportResult,
  type CorporateOrderCreateResult,
  type CorporateOrderDetail,
  type CorporateOrderQuote,
  type CorporateOrderSummary,
  type CorporatePoolCard,
  type GiftCardSettings
} from '@alma/shared';
import Stripe from 'stripe';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { checkoutSessionDisposition } from '../lib/checkout-session-state.js';
import {
  cancelBlockedReason,
  corporateOrderReference,
  issuancePending,
  issueBlockedReason,
  parseScheduledDeliveryAt,
  paymentBlockedReason,
  reassignBlockedReason,
  refuseInvoicePath,
  toCsv,
  validateRecipientCsv
} from '../lib/corporate-gift-cards.js';
import { giftCardService } from './gift-card.service.js';

/**
 * Corporate gift cards, staff-operated.
 *
 * An order is priced from the settings and the account, paid (Stripe, or an
 * offline payment the owner records), and then — once, atomically — turned
 * into N ordinary ACTIVE gift cards that sit UNALLOCATED in a pool. Staff
 * allocate pool cards to recipients one at a time or from a CSV; allocation
 * fills in the card's own recipient / message / schedule columns and sends
 * (or schedules) the ordinary voucher email. No second card, no new payment,
 * no new liability: the balance was on the books from issuance.
 *
 * What this deliberately does not do: issue tax invoices, extend credit,
 * decide GST treatment, choose an issuing entity, or touch Xero. Invoice /
 * PO purchasing is refused at refuseInvoicePath until those decisions exist.
 */

const stripe = env.stripe.secretKey
  ? new Stripe(env.stripe.secretKey, {
      apiVersion: env.stripe.apiVersion,
      ...(env.stripe.context && { stripeContext: env.stripe.context })
    })
  : null;

const SALE_CHANNEL = 'CORPORATE';
const EXPIRY_YEARS = 3;

type OrderRow = Prisma.CorporateGiftCardOrderGetPayload<{ include: { corporateAccount: true } }>;
type PoolCardRow = Prisma.GiftCardGetPayload<{ select: typeof poolCardSelect }>;

const poolCardSelect = {
  id: true,
  code: true,
  status: true,
  allocationStatus: true,
  allocationKey: true,
  allocationReference: true,
  allocatedAt: true,
  initialValueCents: true,
  balanceCents: true,
  discountCents: true,
  recipientName: true,
  recipientEmail: true,
  message: true,
  scheduledDeliveryAt: true,
  emailedAt: true,
  emailError: true,
  expiresAt: true,
  cancelledAt: true,
  createdAt: true
} satisfies Prisma.GiftCardSelect;

async function settings(): Promise<GiftCardSettings> {
  return (await giftCardService.getAdminSettings()).settings;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function text(value: string | undefined | null, fallback: string | null = null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function serviceFeeCents(amountCents: number): number {
  return Math.round((amountCents * GIFT_CARD_SERVICE_FEE_BPS) / 10000);
}

function formatAmount(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(cents / 100);
}

function toAccountPayload(row: Prisma.CorporateAccountGetPayload<Record<string, never>>): CorporateAccount {
  return {
    id: row.id,
    companyName: row.companyName,
    tradingName: row.tradingName,
    abn: row.abn,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    accountsEmail: row.accountsEmail,
    billingAddress: row.billingAddress,
    active: row.active,
    discountOverrideBps: row.discountOverrideBps,
    minimumQuantityOverride: row.minimumQuantityOverride,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toPoolCard(row: PoolCardRow): CorporatePoolCard {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    allocationStatus: row.allocationStatus,
    allocationKey: row.allocationKey,
    allocatedAt: iso(row.allocatedAt),
    initialValueCents: row.initialValueCents,
    balanceCents: row.balanceCents,
    discountCents: row.discountCents,
    recipientName: row.recipientName,
    recipientEmail: row.recipientEmail,
    message: row.message,
    scheduledDeliveryAt: iso(row.scheduledDeliveryAt),
    emailedAt: iso(row.emailedAt),
    emailError: row.emailError,
    expiresAt: iso(row.expiresAt),
    cancelledAt: iso(row.cancelledAt),
    reference: row.allocationReference
  };
}

type PoolCounts = CorporateOrderSummary['pool'];

function emptyPool(): PoolCounts {
  return { total: 0, allocated: 0, unallocated: 0, emailed: 0, emailFailed: 0, scheduled: 0, redeemedCards: 0, cancelledCards: 0, outstandingCents: 0 };
}

function poolCounts(cards: Array<Pick<PoolCardRow, 'status' | 'allocationStatus' | 'emailedAt' | 'emailError' | 'scheduledDeliveryAt' | 'balanceCents'>>): PoolCounts {
  const pool = emptyPool();
  for (const card of cards) {
    pool.total += 1;
    if (card.status === 'CANCELLED') pool.cancelledCards += 1;
    if (card.status === 'REDEEMED') pool.redeemedCards += 1;
    if (card.status === 'ACTIVE') pool.outstandingCents += card.balanceCents;
    if (card.allocationStatus === 'ALLOCATED') {
      pool.allocated += 1;
      if (card.emailedAt) pool.emailed += 1;
      else if (card.emailError) pool.emailFailed += 1;
      else if (card.scheduledDeliveryAt) pool.scheduled += 1;
    } else if (card.status === 'ACTIVE') {
      pool.unallocated += 1;
    }
  }
  return pool;
}

function toOrderSummary(row: OrderRow, pool: PoolCounts): CorporateOrderSummary {
  return {
    id: row.id,
    number: row.number,
    reference: corporateOrderReference(row.number),
    corporateAccountId: row.corporateAccountId,
    companyName: row.corporateAccount.companyName,
    quantity: row.quantity,
    faceValueCents: row.faceValueCents,
    faceValueTotalCents: row.faceValueTotalCents,
    discountSource: row.discountSource,
    discountBps: row.discountBps,
    discountCents: row.discountCents,
    amountDueCents: row.amountDueCents,
    serviceFeeCents: row.serviceFeeCents,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    status: row.status,
    tender: row.tender,
    paymentReference: row.paymentReference,
    amountPaidCents: row.amountPaidCents,
    paidAt: iso(row.paidAt),
    issuedAt: iso(row.issuedAt),
    poNumber: row.poNumber,
    customerReference: row.customerReference,
    defaultMessage: row.defaultMessage,
    internalNote: row.internalNote,
    testMode: row.testMode,
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
    pool
  };
}

async function loadOrder(id: string): Promise<OrderRow> {
  const row = await prisma.corporateGiftCardOrder.findUnique({ where: { id }, include: { corporateAccount: true } });
  if (!row) throw new HttpError(404, 'No such corporate order.');
  return row;
}

async function poolFor(orderId: string): Promise<PoolCardRow[]> {
  return prisma.giftCard.findMany({
    where: { corporateOrderId: orderId },
    select: poolCardSelect,
    orderBy: [{ allocatedAt: 'desc' }, { createdAt: 'asc' }]
  });
}

async function orderDetail(row: OrderRow): Promise<CorporateOrderDetail> {
  const cards = await poolFor(row.id);
  let checkoutUrl: string | null = null;
  if (row.status === 'AWAITING_PAYMENT' && row.paymentMethod === 'STRIPE' && row.stripeCheckoutSessionId && stripe) {
    try {
      const session = await stripe.checkout.sessions.retrieve(row.stripeCheckoutSessionId);
      if (session.status === 'open' && session.url) checkoutUrl = session.url;
    } catch {
      checkoutUrl = null;
    }
  }
  return {
    ...toOrderSummary(row, poolCounts(cards)),
    pricingSnapshot: (row.pricingSnapshot as CorporateOrderDetail['pricingSnapshot']) ?? {},
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    checkoutUrl,
    cards: cards.map(toPoolCard)
  };
}

/** Codes nobody is using, distinct within the batch, checked against the table. */
async function issueCodes(count: number): Promise<string[]> {
  const codes = new Set<string>();
  for (let attempt = 0; attempt < 10 && codes.size < count; attempt += 1) {
    const candidates: string[] = [];
    while (candidates.length + codes.size < count) {
      const code = `ALMA-${randomBytes(4).toString('hex').toUpperCase()}`;
      if (!codes.has(code) && !candidates.includes(code)) candidates.push(code);
    }
    const taken = new Set(
      (await prisma.giftCard.findMany({ where: { code: { in: candidates } }, select: { code: true } })).map((row) => row.code)
    );
    for (const code of candidates) if (!taken.has(code)) codes.add(code);
  }
  if (codes.size < count) throw new HttpError(500, 'Could not issue enough free card numbers. Try again.');
  return [...codes];
}

/* ------------------------------------------------------------------ */
/* Issuance                                                           */
/* ------------------------------------------------------------------ */

/**
 * Turn a PAID order into its pool of cards. Exactly once: the order row is
 * locked, the transition AWAITING_PAYMENT → ISSUED is a conditional update,
 * and a pool that already exists is refused — so a webhook, a poll and a
 * manual click arriving together produce one set of cards.
 */
async function issueCards(orderId: string): Promise<OrderRow> {
  const codes = await issueCodes((await loadOrder(orderId)).quantity);
  return prisma.$transaction(async (tx) => {
    // Row lock for the rest of the transaction.
    const order = await tx.corporateGiftCardOrder.update({
      where: { id: orderId },
      data: { updatedAt: new Date() },
      include: { corporateAccount: true }
    });
    const blocked = issueBlockedReason(order);
    if (blocked) throw new HttpError(409, blocked);
    const existing = await tx.giftCard.count({ where: { corporateOrderId: orderId } });
    if (existing > 0) throw new HttpError(409, 'Cards have already been issued for this order.');

    const shares = splitDiscountAcrossCards(order.discountCents, order.quantity);
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + EXPIRY_YEARS);
    const paidAt = order.paidAt ?? new Date();

    await tx.giftCard.createMany({
      data: codes.slice(0, order.quantity).map((code, index) => ({
        code,
        status: 'ACTIVE' as const,
        initialValueCents: order.faceValueCents,
        balanceCents: order.faceValueCents,
        discountCents: shares[index] ?? 0,
        // What this card cost the company. Test orders took no money.
        amountPaidCents: order.testMode ? 0 : order.faceValueCents - (shares[index] ?? 0),
        currency: 'aud',
        purchaserName: order.corporateAccount.companyName,
        purchaserEmail: order.corporateAccount.contactEmail.toLowerCase(),
        recipientName: null,
        recipientEmail: null,
        message: null,
        design: null,
        promoCodeId: null,
        promoCodeSnapshot: null,
        testMode: order.testMode,
        scheduledDeliveryAt: null,
        // The order holds the Stripe session; a pool card must never be
        // reachable through the public session-poll endpoint.
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: order.stripePaymentIntentId,
        paidAt,
        saleChannel: SALE_CHANNEL,
        tender: order.tender,
        tenderReference: corporateOrderReference(order.number),
        soldByStaffId: order.createdById,
        expiresAt,
        corporateOrderId: order.id,
        allocationStatus: 'UNALLOCATED' as const
      }))
    });

    const flipped = await tx.corporateGiftCardOrder.updateMany({
      where: { id: orderId, status: 'AWAITING_PAYMENT', paymentStatus: 'PAID' },
      data: { status: 'ISSUED', issuedAt: new Date() }
    });
    if (flipped.count !== 1) throw new HttpError(409, 'Order changed while issuing; nothing was issued.');
    return tx.corporateGiftCardOrder.findUniqueOrThrow({ where: { id: orderId }, include: { corporateAccount: true } });
  });
}

/**
 * Finish an order that is paid but has no pool yet (issuancePending). The
 * payment write and the pool write are two transactions, so a crash between
 * them strands money without cards; this re-runs issuance, which is itself
 * guarded (row lock, existing-pool check, conditional status flip), so two
 * recoveries racing produce one pool and the loser simply sees ISSUED.
 */
async function recoverIssuance(order: OrderRow): Promise<OrderRow> {
  if (!issuancePending(order)) return order;
  console.warn(`[corporate-gift-cards] ${corporateOrderReference(order.number)} is paid but has no cards — issuing now`);
  try {
    return await issueCards(order.id);
  } catch (error) {
    const latest = await loadOrder(order.id);
    if (latest.status === 'ISSUED') return latest;
    throw error;
  }
}

/** Record Stripe's confirmation, once, then issue. */
async function settleStripePayment(order: OrderRow, session: Stripe.Checkout.Session): Promise<OrderRow> {
  const paid = typeof session.amount_total === 'number' ? session.amount_total : null;
  const expected = order.amountDueCents + order.serviceFeeCents;
  if (paid !== null && paid !== expected) {
    console.error('[corporate-gift-cards] Stripe amount did not match the order', { orderId: order.id, paid, expected });
    throw new HttpError(400, 'Stripe payment amount did not match the corporate order.');
  }
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  const claimed = await prisma.corporateGiftCardOrder.updateMany({
    where: { id: order.id, paymentStatus: 'AWAITING_PAYMENT', status: 'AWAITING_PAYMENT' },
    data: {
      paymentStatus: 'PAID',
      paidAt: new Date(),
      amountPaidCents: paid ?? expected,
      tender: 'STRIPE',
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: intent
    }
  });
  if (claimed.count === 0) {
    // Somebody else recorded it first. If they also issued, done; if they
    // did not get that far, finish it here.
    return recoverIssuance(await loadOrder(order.id));
  }
  console.info(`[corporate-gift-cards] ${corporateOrderReference(order.number)} paid via Stripe, issuing ${order.quantity} cards`);
  return issueCards(order.id);
}

async function createStripeCheckout(order: OrderRow, urls: { successUrl?: string; cancelUrl?: string }): Promise<{ order: OrderRow; checkoutUrl: string }> {
  if (!stripe) throw new HttpError(503, 'Payment setup is required before Stripe checkout can be used.');
  const web = env.giftCards.webUrl.replace(/\/+$/, '');
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: order.corporateAccount.contactEmail.toLowerCase(),
    client_reference_id: `corporate:${order.id}`,
    metadata: {
      corporateOrderId: order.id,
      corporateOrderReference: corporateOrderReference(order.number),
      amountDueCents: String(order.amountDueCents),
      serviceFeeCents: String(order.serviceFeeCents)
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'aud',
          unit_amount: order.amountDueCents,
          product_data: {
            name: `${order.quantity} × ALMA Gift Card ${formatAmount(order.faceValueCents)}`,
            description: [
              `${corporateOrderReference(order.number)} for ${order.corporateAccount.companyName}`,
              order.discountCents ? `Corporate discount ${formatAmount(order.discountCents)} off ${formatAmount(order.faceValueTotalCents)}` : ''
            ].filter(Boolean).join(' · ')
          }
        }
      },
      ...(order.serviceFeeCents > 0
        ? [{
            quantity: 1,
            price_data: {
              currency: 'aud',
              unit_amount: order.serviceFeeCents,
              product_data: {
                name: 'Service fee',
                description: `${(GIFT_CARD_SERVICE_FEE_BPS / 100).toFixed(1)}% card processing — not deducted from the gift cards`
              }
            }
          }]
        : [])
    ],
    success_url: urls.successUrl?.trim() || `${web}/corporate?order=${encodeURIComponent(order.id)}&paid=1`,
    cancel_url: urls.cancelUrl?.trim() || `${web}/corporate?order=${encodeURIComponent(order.id)}`
  });
  if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout URL');
  const updated = await prisma.corporateGiftCardOrder.update({
    where: { id: order.id },
    data: { stripeCheckoutSessionId: session.id },
    include: { corporateAccount: true }
  });
  return { order: updated, checkoutUrl: session.url };
}

/* ------------------------------------------------------------------ */
/* Stats                                                              */
/* ------------------------------------------------------------------ */

type OrderStatRow = Pick<OrderRow, 'corporateAccountId' | 'status' | 'paymentStatus' | 'quantity' | 'faceValueTotalCents' | 'discountCents' | 'amountPaidCents' | 'createdAt' | 'testMode' | 'id'>;
type CardStatRow = Pick<PoolCardRow, 'status' | 'allocationStatus' | 'emailedAt' | 'emailError' | 'initialValueCents' | 'balanceCents'> & { corporateOrderId: string | null; testMode: boolean };

function accountStats(orders: OrderStatRow[], cards: CardStatRow[]): CorporateAccountStats {
  const live = orders.filter((order) => !order.testMode);
  const liveOrderIds = new Set(live.map((order) => order.id));
  const stats: CorporateAccountStats = {
    orderCount: live.length,
    cardsPurchased: 0,
    faceValueCents: 0,
    discountCents: 0,
    amountPaidCents: 0,
    allocated: 0,
    unallocated: 0,
    emailed: 0,
    emailFailed: 0,
    redeemedCards: 0,
    redeemedCents: 0,
    outstandingCents: 0,
    lastOrderAt: null
  };
  for (const order of live) {
    if (order.status === 'ISSUED') {
      stats.cardsPurchased += order.quantity;
      stats.faceValueCents += order.faceValueTotalCents;
      stats.discountCents += order.discountCents;
    }
    if (order.paymentStatus === 'PAID') stats.amountPaidCents += order.amountPaidCents ?? 0;
    if (!stats.lastOrderAt || order.createdAt.toISOString() > stats.lastOrderAt) stats.lastOrderAt = order.createdAt.toISOString();
  }
  for (const card of cards) {
    if (card.testMode || !card.corporateOrderId || !liveOrderIds.has(card.corporateOrderId)) continue;
    if (card.allocationStatus === 'ALLOCATED') {
      stats.allocated += 1;
      if (card.emailedAt) stats.emailed += 1;
      else if (card.emailError) stats.emailFailed += 1;
    } else if (card.status === 'ACTIVE') {
      stats.unallocated += 1;
    }
    if (card.status === 'REDEEMED') stats.redeemedCards += 1;
    if (card.status !== 'CANCELLED') stats.redeemedCents += card.initialValueCents - card.balanceCents;
    if (card.status === 'ACTIVE') stats.outstandingCents += card.balanceCents;
  }
  return stats;
}

const cardStatSelect = {
  corporateOrderId: true,
  testMode: true,
  status: true,
  allocationStatus: true,
  emailedAt: true,
  emailError: true,
  initialValueCents: true,
  balanceCents: true
} satisfies Prisma.GiftCardSelect;

/* ------------------------------------------------------------------ */
/* Service                                                            */
/* ------------------------------------------------------------------ */

export const corporateGiftCardService = {
  /* ---- accounts ---- */

  async listAccounts(input: { query?: string; includeInactive?: boolean } = {}): Promise<CorporateAccountSummary[]> {
    const query = input.query?.trim();
    const accounts = await prisma.corporateAccount.findMany({
      where: {
        ...(input.includeInactive ? {} : { active: true }),
        ...(query
          ? {
              OR: [
                { companyName: { contains: query, mode: 'insensitive' } },
                { tradingName: { contains: query, mode: 'insensitive' } },
                { contactName: { contains: query, mode: 'insensitive' } },
                { contactEmail: { contains: query, mode: 'insensitive' } },
                { abn: { contains: query.replace(/\s+/g, '') } }
              ]
            }
          : {})
      },
      orderBy: [{ active: 'desc' }, { companyName: 'asc' }]
    });
    if (accounts.length === 0) return [];
    const ids = accounts.map((account) => account.id);
    const [orders, cards] = await Promise.all([
      prisma.corporateGiftCardOrder.findMany({
        where: { corporateAccountId: { in: ids } },
        select: { id: true, corporateAccountId: true, status: true, paymentStatus: true, quantity: true, faceValueTotalCents: true, discountCents: true, amountPaidCents: true, createdAt: true, testMode: true }
      }),
      prisma.giftCard.findMany({
        where: { corporateOrder: { corporateAccountId: { in: ids } } },
        select: cardStatSelect
      })
    ]);
    const orderToAccount = new Map(orders.map((order) => [order.id, order.corporateAccountId]));
    return accounts.map((account) => ({
      ...toAccountPayload(account),
      stats: accountStats(
        orders.filter((order) => order.corporateAccountId === account.id),
        cards.filter((card) => card.corporateOrderId && orderToAccount.get(card.corporateOrderId) === account.id)
      )
    }));
  },

  async getAccount(id: string): Promise<{ account: CorporateAccountSummary; orders: CorporateOrderSummary[] }> {
    const row = await prisma.corporateAccount.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, 'No such corporate account.');
    const orders = await prisma.corporateGiftCardOrder.findMany({
      where: { corporateAccountId: id },
      include: { corporateAccount: true },
      orderBy: [{ createdAt: 'desc' }]
    });
    const cards = await prisma.giftCard.findMany({
      where: { corporateOrderId: { in: orders.map((order) => order.id) } },
      select: { ...cardStatSelect, scheduledDeliveryAt: true }
    });
    const byOrder = new Map<string, typeof cards>();
    for (const card of cards) {
      const list = byOrder.get(card.corporateOrderId!) ?? [];
      list.push(card);
      byOrder.set(card.corporateOrderId!, list);
    }
    return {
      account: { ...toAccountPayload(row), stats: accountStats(orders, cards) },
      orders: orders.map((order) => toOrderSummary(order, poolCounts(byOrder.get(order.id) ?? [])))
    };
  },

  async createAccount(input: unknown, actor?: AuthUser | null): Promise<CorporateAccount> {
    const data = corporateAccountInputSchema.parse(input);
    const row = await prisma.corporateAccount.create({
      data: {
        companyName: data.companyName.trim(),
        tradingName: text(data.tradingName),
        abn: text(data.abn?.replace(/\s+/g, '')),
        contactName: data.contactName.trim(),
        contactEmail: data.contactEmail.trim().toLowerCase(),
        contactPhone: text(data.contactPhone),
        accountsEmail: text(data.accountsEmail?.toLowerCase()),
        billingAddress: text(data.billingAddress),
        notes: text(data.notes),
        active: data.active ?? true,
        createdById: actor?.id ?? null
      }
    });
    console.info(`[corporate-gift-cards] account created ${row.id} "${row.companyName}" by ${actor?.email ?? actor?.id ?? 'unknown'}`);
    return toAccountPayload(row);
  },

  async updateAccount(id: string, input: unknown): Promise<CorporateAccount> {
    const data = corporateAccountUpdateSchema.parse(input);
    const row = await prisma.corporateAccount.update({
      where: { id },
      data: {
        ...(data.companyName !== undefined && { companyName: data.companyName.trim() }),
        ...(data.tradingName !== undefined && { tradingName: text(data.tradingName) }),
        ...(data.abn !== undefined && { abn: text(data.abn?.replace(/\s+/g, '')) }),
        ...(data.contactName !== undefined && { contactName: data.contactName.trim() }),
        ...(data.contactEmail !== undefined && { contactEmail: data.contactEmail.trim().toLowerCase() }),
        ...(data.contactPhone !== undefined && { contactPhone: text(data.contactPhone) }),
        ...(data.accountsEmail !== undefined && { accountsEmail: text(data.accountsEmail?.toLowerCase()) }),
        ...(data.billingAddress !== undefined && { billingAddress: text(data.billingAddress) }),
        ...(data.notes !== undefined && { notes: text(data.notes) }),
        ...(data.active !== undefined && { active: data.active })
      }
    });
    return toAccountPayload(row);
  },

  /** Commercial terms. Owner-only at the route. */
  async updateAccountTerms(id: string, input: unknown, actor?: AuthUser | null): Promise<CorporateAccount> {
    const data = corporateAccountTermsInputSchema.parse(input);
    const row = await prisma.corporateAccount.update({
      where: { id },
      data: {
        ...(data.discountOverrideBps !== undefined && { discountOverrideBps: data.discountOverrideBps }),
        ...(data.minimumQuantityOverride !== undefined && { minimumQuantityOverride: data.minimumQuantityOverride })
      }
    });
    console.info(`[corporate-gift-cards] terms changed for ${id}: override=${row.discountOverrideBps ?? 'none'}bps min=${row.minimumQuantityOverride ?? 'global'} by ${actor?.email ?? actor?.id ?? 'unknown'}`);
    return toAccountPayload(row);
  },

  /* ---- quoting and orders ---- */

  async quote(input: { corporateAccountId: string; quantity: number; faceValueCents: number; paymentMethod?: string }): Promise<CorporateOrderQuote & { serviceFeeCents: number; totalPayableCents: number; belowMinimum: boolean }> {
    const account = await prisma.corporateAccount.findUnique({ where: { id: input.corporateAccountId } });
    if (!account) throw new HttpError(404, 'No such corporate account.');
    const current = await settings();
    const quote = quoteCorporateOrder({ quantity: input.quantity, faceValueCents: input.faceValueCents, settings: current.corporate, account });
    const fee = input.paymentMethod === 'STRIPE' && !current.testCheckoutEnabled ? serviceFeeCents(quote.amountDueCents) : 0;
    return { ...quote, serviceFeeCents: fee, totalPayableCents: quote.amountDueCents + fee, belowMinimum: quote.quantity < quote.minimumQuantity };
  },

  async createOrder(input: unknown, actor?: AuthUser | null): Promise<CorporateOrderCreateResult> {
    const data = corporateOrderInputSchema.parse(input);
    const invoiceRefusal = refuseInvoicePath(data.paymentMethod);
    if (invoiceRefusal) throw new HttpError(400, invoiceRefusal);
    if (data.faceValueCents < GIFT_CARD_MIN_AMOUNT_CENTS || data.faceValueCents > GIFT_CARD_MAX_AMOUNT_CENTS) {
      throw new HttpError(400, `Card value must be between ${formatAmount(GIFT_CARD_MIN_AMOUNT_CENTS)} and ${formatAmount(GIFT_CARD_MAX_AMOUNT_CENTS)}.`);
    }

    if (data.clientRequestId) {
      const existing = await prisma.corporateGiftCardOrder.findUnique({ where: { clientRequestId: data.clientRequestId }, include: { corporateAccount: true } });
      if (existing) {
        const detail = await orderDetail(existing);
        return { order: detail, checkoutUrl: detail.checkoutUrl };
      }
    }

    const account = await prisma.corporateAccount.findUnique({ where: { id: data.corporateAccountId } });
    if (!account) throw new HttpError(404, 'No such corporate account.');
    if (!account.active) throw new HttpError(400, 'This corporate account is inactive. Reactivate it before placing an order.');

    const current = await settings();
    const quote = quoteCorporateOrder({ quantity: data.quantity, faceValueCents: data.faceValueCents, settings: current.corporate, account });
    if (quote.quantity < quote.minimumQuantity) {
      throw new HttpError(400, `Corporate orders for ${account.companyName} need at least ${quote.minimumQuantity} cards.`);
    }
    const testMode = current.testCheckoutEnabled;
    if (data.paymentMethod === 'STRIPE' && !testMode && !stripe) {
      throw new HttpError(503, 'Payment setup is required before Stripe checkout can be used.');
    }
    const fee = data.paymentMethod === 'STRIPE' && !testMode ? serviceFeeCents(quote.amountDueCents) : 0;

    let order: OrderRow;
    try {
      order = await prisma.corporateGiftCardOrder.create({
        data: {
          corporateAccountId: account.id,
          quantity: quote.quantity,
          faceValueCents: quote.faceValueCents,
          faceValueTotalCents: quote.faceValueTotalCents,
          discountSource: quote.discountSource,
          discountBps: quote.discountBps,
          discountCents: quote.discountCents,
          amountDueCents: quote.amountDueCents,
          serviceFeeCents: fee,
          pricingSnapshot: quote.snapshot as unknown as Prisma.InputJsonValue,
          paymentMethod: data.paymentMethod,
          poNumber: text(data.poNumber),
          customerReference: text(data.customerReference),
          defaultMessage: text(data.defaultMessage),
          internalNote: text(data.internalNote),
          clientRequestId: data.clientRequestId ?? null,
          testMode,
          createdById: actor?.id ?? null,
          // A test order is "paid" with no money, like a test checkout.
          ...(testMode ? { paymentStatus: 'PAID' as const, paidAt: new Date(), amountPaidCents: 0, tender: 'TEST' } : {})
        },
        include: { corporateAccount: true }
      });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002' && data.clientRequestId) {
        const existing = await prisma.corporateGiftCardOrder.findUniqueOrThrow({ where: { clientRequestId: data.clientRequestId }, include: { corporateAccount: true } });
        const detail = await orderDetail(existing);
        return { order: detail, checkoutUrl: detail.checkoutUrl };
      }
      throw error;
    }
    console.info(
      `[corporate-gift-cards] ${corporateOrderReference(order.number)} created: ${order.quantity} × ${order.faceValueCents}c for "${account.companyName}" ` +
        `discount=${order.discountCents}c (${order.discountSource} ${order.discountBps}bps) due=${order.amountDueCents}c fee=${fee}c ${data.paymentMethod}${testMode ? ' TEST' : ''} by ${actor?.email ?? actor?.id ?? 'unknown'}`
    );

    if (testMode) {
      const issued = await issueCards(order.id);
      return { order: await orderDetail(issued), checkoutUrl: null };
    }
    if (data.paymentMethod === 'STRIPE') {
      const { order: withSession, checkoutUrl } = await createStripeCheckout(order, { successUrl: data.successUrl, cancelUrl: data.cancelUrl });
      return { order: await orderDetail(withSession), checkoutUrl };
    }
    return { order: await orderDetail(order), checkoutUrl: null };
  },

  /** A fresh hosted checkout for an order still awaiting Stripe payment. */
  async refreshStripeCheckout(orderId: string): Promise<CorporateOrderCreateResult> {
    const order = await this.reconcileStripe(await loadOrder(orderId));
    const blocked = paymentBlockedReason(order);
    if (blocked) throw new HttpError(409, blocked);
    if (order.paymentMethod !== 'STRIPE') throw new HttpError(400, 'This order is not paid through Stripe.');
    const { order: withSession, checkoutUrl } = await createStripeCheckout(order, {});
    return { order: await orderDetail(withSession), checkoutUrl };
  },

  /**
   * Ask Stripe about an order still awaiting payment. The webhook normally
   * gets there first; this is the poll from the order screen and the safety
   * net when a webhook was lost. Expired sessions are cleared so a new one
   * can be created; the order itself stays open.
   */
  async reconcileStripe(order: OrderRow): Promise<OrderRow> {
    if (order.status !== 'AWAITING_PAYMENT') return order;
    // Paid (by any method) but the pool was never created: finish that
    // before anything else, every time the order is read. A read must still
    // succeed if the repair fails again (the order screen is where staff see
    // "paid, issuing cards" and the retry), so the failure is logged and the
    // pending order returned; the webhook path keeps throwing so Stripe
    // retries on its own schedule.
    if (order.paymentStatus === 'PAID') {
      try {
        return await recoverIssuance(order);
      } catch (error) {
        console.error('[corporate-gift-cards] issuance retry failed; order stays paid-but-unissued', { orderId: order.id, reason: error instanceof Error ? error.message : 'unknown' });
        return order;
      }
    }
    if (order.paymentStatus !== 'AWAITING_PAYMENT') return order;
    if (order.paymentMethod !== 'STRIPE' || !order.stripeCheckoutSessionId || !stripe) return order;
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId, { expand: ['payment_intent'] });
    } catch (error) {
      console.error('[corporate-gift-cards] could not reach Stripe for order', { orderId: order.id, reason: error instanceof Error ? error.message : 'unknown' });
      return order;
    }
    const disposition = checkoutSessionDisposition(session);
    if (disposition === 'paid') return settleStripePayment(order, session);
    if (disposition === 'abandoned') {
      await prisma.corporateGiftCardOrder.updateMany({
        where: { id: order.id, paymentStatus: 'AWAITING_PAYMENT', stripeCheckoutSessionId: session.id },
        data: { stripeCheckoutSessionId: null }
      });
      return loadOrder(order.id);
    }
    return order;
  },

  /** Webhook entry: checkout.session.* for a session carrying corporateOrderId. */
  async handleStripeSession(session: Stripe.Checkout.Session, kind: 'completed' | 'expired'): Promise<void> {
    const orderId = session.metadata?.corporateOrderId;
    if (!orderId) return;
    const order = await prisma.corporateGiftCardOrder.findUnique({ where: { id: orderId }, include: { corporateAccount: true } });
    if (!order) return;
    if (kind === 'expired') {
      await prisma.corporateGiftCardOrder.updateMany({
        where: { id: order.id, paymentStatus: 'AWAITING_PAYMENT', stripeCheckoutSessionId: session.id },
        data: { stripeCheckoutSessionId: null }
      });
      return;
    }
    if (checkoutSessionDisposition(session) !== 'paid') return;
    if (order.paymentStatus === 'PAID') {
      // Duplicate webhook for a settled order — unless the earlier delivery
      // recorded the payment and then failed before issuing. Finish it.
      await recoverIssuance(order);
      return;
    }
    await settleStripePayment(order, session);
  },

  async getOrder(id: string): Promise<CorporateOrderDetail> {
    return orderDetail(await this.reconcileStripe(await loadOrder(id)));
  },

  async listOrders(input: { status?: string; query?: string } = {}): Promise<CorporateOrderSummary[]> {
    const query = input.query?.trim();
    const orders = await prisma.corporateGiftCardOrder.findMany({
      where: {
        ...(input.status && ['AWAITING_PAYMENT', 'ISSUED', 'CANCELLED'].includes(input.status) ? { status: input.status as OrderRow['status'] } : {}),
        ...(query ? { corporateAccount: { companyName: { contains: query, mode: 'insensitive' } } } : {})
      },
      include: { corporateAccount: true },
      orderBy: [{ createdAt: 'desc' }],
      take: 200
    });
    const cards = await prisma.giftCard.findMany({
      where: { corporateOrderId: { in: orders.map((order) => order.id) } },
      select: { ...cardStatSelect, scheduledDeliveryAt: true }
    });
    const byOrder = new Map<string, typeof cards>();
    for (const card of cards) {
      const list = byOrder.get(card.corporateOrderId!) ?? [];
      list.push(card);
      byOrder.set(card.corporateOrderId!, list);
    }
    return orders.map((order) => toOrderSummary(order, poolCounts(byOrder.get(order.id) ?? [])));
  },

  /**
   * An offline payment the business has already received — bank transfer,
   * the venue's EFTPOS terminal, cash. Owner-only at the route: marking a
   * five-figure order paid is a trust boundary, not a floor action.
   */
  async recordManualPayment(orderId: string, input: unknown, actor?: AuthUser | null): Promise<CorporateOrderDetail> {
    const data = corporateManualPaymentInputSchema.parse(input);
    const order = await loadOrder(orderId);
    const blocked = paymentBlockedReason(order);
    if (blocked) throw new HttpError(409, blocked);
    if (order.paymentMethod === 'STRIPE') {
      throw new HttpError(400, 'This order is set up for Stripe payment. If the money arrived another way, create the order again as an offline payment.');
    }
    const paidAt = data.paidAt?.trim() ? new Date(data.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new HttpError(400, 'Enter a valid payment date.');
    if (paidAt.getTime() > Date.now() + 60_000) throw new HttpError(400, 'A payment date cannot be in the future.');
    const claimed = await prisma.corporateGiftCardOrder.updateMany({
      where: { id: order.id, paymentStatus: 'AWAITING_PAYMENT', status: 'AWAITING_PAYMENT' },
      data: {
        paymentStatus: 'PAID',
        paidAt,
        amountPaidCents: order.amountDueCents,
        tender: data.tender,
        paymentReference: text(data.paymentReference),
        paymentRecordedById: actor?.id ?? null
      }
    });
    if (claimed.count === 0) throw new HttpError(409, 'This order changed a moment ago (paid or cancelled by somebody else). Reload it.');
    console.info(`[corporate-gift-cards] ${corporateOrderReference(order.number)} marked paid ${data.tender} ${order.amountDueCents}c by ${actor?.email ?? actor?.id ?? 'unknown'}`);
    return orderDetail(await issueCards(order.id));
  },

  async cancelOrder(orderId: string, input: unknown, actor?: AuthUser | null): Promise<CorporateOrderDetail> {
    const data = corporateOrderCancelInputSchema.parse(input);
    const order = await loadOrder(orderId);
    const blocked = cancelBlockedReason(order);
    if (blocked) throw new HttpError(409, blocked);
    // Both conditions, not just the lifecycle status: a payment racing this
    // cancel flips paymentStatus first, and that must make the cancel lose.
    // CANCELLED + PAID is a state that cannot be reached.
    const cancelled = await prisma.corporateGiftCardOrder.updateMany({
      where: { id: order.id, status: 'AWAITING_PAYMENT', paymentStatus: 'AWAITING_PAYMENT' },
      data: { status: 'CANCELLED', paymentStatus: 'CANCELLED', cancelledAt: new Date(), cancelReason: data.reason.trim(), cancelledById: actor?.id ?? null }
    });
    if (cancelled.count === 0) throw new HttpError(409, 'This order changed a moment ago (it may have just been paid). Reload it.');
    if (order.stripeCheckoutSessionId && stripe) {
      try {
        await stripe.checkout.sessions.expire(order.stripeCheckoutSessionId);
      } catch {
        // Already complete or expired; nothing to do.
      }
    }
    console.info(`[corporate-gift-cards] ${corporateOrderReference(order.number)} cancelled: ${data.reason.trim()} by ${actor?.email ?? actor?.id ?? 'unknown'}`);
    return orderDetail(await loadOrder(order.id));
  },

  /* ---- pool allocation ---- */

  /**
   * Hand one pool card to a recipient.
   *
   * The claim is a conditional update on a card that is still UNALLOCATED and
   * ACTIVE, so two staff allocating at once get two different cards and never
   * the same one. An allocationKey makes the call idempotent within the
   * order: a retry returns the card that key already got. Then the ordinary
   * voucher email goes out now, or waits for the drain if scheduled.
   */
  async allocate(orderId: string, input: unknown, actor?: AuthUser | null): Promise<{ card: CorporatePoolCard; emailed: boolean; emailError: string | null; alreadyAllocated: boolean }> {
    const data = corporateAllocationInputSchema.parse(input);
    const order = await loadOrder(orderId);
    if (order.status !== 'ISSUED') throw new HttpError(409, 'Cards can be allocated once the order is paid and issued.');
    const schedule = parseScheduledDeliveryAt(data.scheduledDeliveryAt, new Date());
    if (!schedule.ok) throw new HttpError(400, schedule.message);
    const allocationKey = data.allocationKey?.trim() || `manual:${randomBytes(8).toString('hex')}`;

    const existing = await prisma.giftCard.findUnique({
      where: { corporateOrderId_allocationKey: { corporateOrderId: order.id, allocationKey } },
      select: poolCardSelect
    });
    if (existing) return { card: toPoolCard(existing), emailed: Boolean(existing.emailedAt), emailError: existing.emailError, alreadyAllocated: true };

    const claimedId = await claimPoolCard(order.id, {
      allocationStatus: 'ALLOCATED',
      allocationKey,
      allocationReference: text(data.reference),
      allocatedAt: new Date(),
      allocatedById: actor?.id ?? null,
      recipientName: data.recipientName.trim(),
      recipientEmail: data.recipientEmail.trim().toLowerCase(),
      message: text(data.message, order.defaultMessage),
      scheduledDeliveryAt: schedule.value,
      emailError: null
    });
    if (claimedId === 'duplicate-key') {
      const raced = await prisma.giftCard.findUniqueOrThrow({
        where: { corporateOrderId_allocationKey: { corporateOrderId: order.id, allocationKey } },
        select: poolCardSelect
      });
      return { card: toPoolCard(raced), emailed: Boolean(raced.emailedAt), emailError: raced.emailError, alreadyAllocated: true };
    }
    if (!claimedId) throw new HttpError(409, `No unallocated cards left on ${corporateOrderReference(order.number)}.`);

    const sent = await deliverIfDue(claimedId);
    console.info(
      `[corporate-gift-cards] ${corporateOrderReference(order.number)} allocated code=***${sent.code.slice(-4)} to ${maskEmail(sent.recipientEmail)}` +
        `${sent.scheduledDeliveryAt ? ` scheduled ${sent.scheduledDeliveryAt.toISOString()}` : sent.emailedAt ? ' emailed' : sent.emailError ? ` EMAIL FAILED: ${sent.emailError}` : ''} by ${actor?.email ?? actor?.id ?? 'unknown'}`
    );
    return { card: toPoolCard(sent), emailed: Boolean(sent.emailedAt), emailError: sent.emailError, alreadyAllocated: false };
  },

  /** Re-address an allocated card that has not been emailed yet. */
  async reassign(cardId: string, input: unknown, actor?: AuthUser | null): Promise<{ card: CorporatePoolCard; emailed: boolean; emailError: string | null }> {
    const data = corporateReassignInputSchema.parse(input);
    const card = await prisma.giftCard.findUnique({ where: { id: cardId }, select: { ...poolCardSelect, corporateOrderId: true } });
    if (!card) throw new HttpError(404, 'No such card.');
    const blocked = reassignBlockedReason(card);
    if (blocked) throw new HttpError(409, blocked);
    const schedule = parseScheduledDeliveryAt(data.scheduledDeliveryAt, new Date());
    if (!schedule.ok) throw new HttpError(400, schedule.message);
    const order = await loadOrder(card.corporateOrderId!);
    const changed = await prisma.giftCard.updateMany({
      where: { id: card.id, allocationStatus: 'ALLOCATED', status: 'ACTIVE', emailedAt: null },
      data: {
        recipientName: data.recipientName.trim(),
        recipientEmail: data.recipientEmail.trim().toLowerCase(),
        message: text(data.message, order.defaultMessage),
        allocationReference: text(data.reference, card.allocationReference),
        scheduledDeliveryAt: schedule.value,
        allocatedAt: new Date(),
        allocatedById: actor?.id ?? null,
        emailError: null
      }
    });
    if (changed.count === 0) throw new HttpError(409, 'This card changed; reload and try again.');
    const sent = await deliverIfDue(card.id);
    return { card: toPoolCard(sent), emailed: Boolean(sent.emailedAt), emailError: sent.emailError };
  },

  /** Send the voucher again. Allocated cards only; the existing resend path does the work. */
  async resend(cardId: string): Promise<CorporatePoolCard> {
    const card = await prisma.giftCard.findUnique({ where: { id: cardId }, select: { code: true, corporateOrderId: true, allocationStatus: true } });
    if (!card || !card.corporateOrderId) throw new HttpError(404, 'No such corporate card.');
    if (card.allocationStatus !== 'ALLOCATED') throw new HttpError(409, 'This card has not been allocated to anyone yet, so there is nobody to send it to.');
    await giftCardService.resendGiftCardEmail(card.code);
    const after = await prisma.giftCard.findUniqueOrThrow({ where: { id: cardId }, select: poolCardSelect });
    return toPoolCard(after);
  },

  /* ---- CSV ---- */

  /**
   * Validate the whole file first; allocate nothing unless every row passes
   * and the pool can cover every new row. Rows already allocated on this
   * order (same key) are reported and skipped, so uploading the same file
   * twice allocates no second card.
   */
  async importRecipients(orderId: string, input: unknown, actor?: AuthUser | null): Promise<CorporateCsvImportResult> {
    const data = corporateCsvImportInputSchema.parse(input);
    const order = await loadOrder(orderId);
    if (order.status !== 'ISSUED') throw new HttpError(409, 'Recipients can be uploaded once the order is paid and issued.');
    const { rows, errors } = validateRecipientCsv(data.csv, new Date());
    const dryRun = data.dryRun === true;

    const existing = rows.length
      ? await prisma.giftCard.findMany({
          where: { corporateOrderId: order.id, allocationKey: { in: rows.map((row) => row.allocationKey) } },
          select: { allocationKey: true }
        })
      : [];
    const alreadyKeys = new Set(existing.map((row) => row.allocationKey));
    const plan = rows.map((row) => ({
      row: row.row,
      recipientName: row.recipientName,
      recipientEmail: row.recipientEmail,
      message: row.message,
      scheduledDeliveryAt: iso(row.scheduledDeliveryAt),
      reference: row.reference,
      allocationKey: row.allocationKey,
      alreadyAllocated: alreadyKeys.has(row.allocationKey)
    }));
    const toAllocate = plan.filter((row) => !row.alreadyAllocated).length;
    const available = await prisma.giftCard.count({ where: { corporateOrderId: order.id, allocationStatus: 'UNALLOCATED', status: 'ACTIVE' } });
    const shortfall = Math.max(0, toAllocate - available);
    const allErrors = [...errors];
    if (rows.length && shortfall > 0) {
      allErrors.push({ row: 0, field: null, message: `This file needs ${toAllocate} card(s) but only ${available} unallocated card(s) remain on ${corporateOrderReference(order.number)}. Nothing was allocated.` });
    }
    const result: CorporateCsvImportResult = {
      dryRun,
      valid: allErrors.length === 0,
      rows: plan,
      errors: allErrors,
      summary: { rowCount: plan.length, toAllocate, alreadyAllocated: plan.length - toAllocate, available, shortfall }
    };
    if (dryRun || !result.valid) return result;

    const allocated: NonNullable<CorporateCsvImportResult['allocated']> = [];
    for (const row of rows) {
      const outcome = await this.allocate(order.id, {
        recipientName: row.recipientName,
        recipientEmail: row.recipientEmail,
        message: row.message ?? '',
        scheduledDeliveryAt: row.scheduledDeliveryAt ? row.scheduledDeliveryAt.toISOString() : '',
        reference: row.reference ?? '',
        allocationKey: row.allocationKey
      }, actor);
      allocated.push({ row: row.row, code: outcome.card.code, emailed: outcome.emailed, emailError: outcome.emailError });
    }
    console.info(`[corporate-gift-cards] ${corporateOrderReference(order.number)} CSV import: ${allocated.length} row(s), ${toAllocate} newly allocated, by ${actor?.email ?? actor?.id ?? 'unknown'}`);
    return { ...result, allocated };
  },

  /* ---- reporting ---- */

  async exportAccountCards(accountId: string): Promise<{ filename: string; csv: string; rows: CorporateAccountExportRow[] }> {
    const account = await prisma.corporateAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new HttpError(404, 'No such corporate account.');
    const orders = await prisma.corporateGiftCardOrder.findMany({ where: { corporateAccountId: accountId, testMode: false }, select: { id: true, number: true } });
    const numbers = new Map(orders.map((order) => [order.id, order.number]));
    const cards = await prisma.giftCard.findMany({
      where: { corporateOrderId: { in: orders.map((order) => order.id) } },
      select: { ...poolCardSelect, corporateOrderId: true },
      orderBy: [{ createdAt: 'asc' }]
    });
    const rows: CorporateAccountExportRow[] = cards.map((card) => ({
      orderReference: corporateOrderReference(numbers.get(card.corporateOrderId!) ?? 0),
      code: card.code,
      status: card.status,
      allocationStatus: card.allocationStatus ?? '',
      recipientName: card.recipientName ?? '',
      recipientEmail: card.recipientEmail ?? '',
      reference: card.allocationReference ?? '',
      faceValueCents: card.initialValueCents,
      balanceCents: card.balanceCents,
      discountCents: card.discountCents,
      scheduledDeliveryAt: iso(card.scheduledDeliveryAt) ?? '',
      emailedAt: iso(card.emailedAt) ?? '',
      emailError: card.emailError ?? '',
      expiresAt: iso(card.expiresAt) ?? ''
    }));
    const header = ['order', 'code', 'status', 'allocation', 'recipientName', 'recipientEmail', 'reference', 'faceValue', 'balance', 'discount', 'scheduledDeliveryAt', 'emailedAt', 'emailError', 'expiresAt'];
    const csv = toCsv(
      header,
      rows.map((row) => [
        row.orderReference,
        row.code,
        row.status,
        row.allocationStatus,
        row.recipientName,
        row.recipientEmail,
        row.reference,
        (row.faceValueCents / 100).toFixed(2),
        (row.balanceCents / 100).toFixed(2),
        (row.discountCents / 100).toFixed(2),
        row.scheduledDeliveryAt,
        row.emailedAt,
        row.emailError,
        row.expiresAt
      ])
    );
    const slug = account.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account';
    return { filename: `alma-corporate-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, csv, rows };
  }
};

/* ------------------------------------------------------------------ */
/* Internals used above                                               */
/* ------------------------------------------------------------------ */

/**
 * Claim one unallocated card with a conditional update. Returns the card id,
 * null when the pool is empty, or 'duplicate-key' when another request with
 * the same allocationKey won the race (the unique index on
 * (corporateOrderId, allocationKey) says so).
 */
async function claimPoolCard(orderId: string, data: Prisma.GiftCardUpdateManyMutationInput & { allocationKey: string }): Promise<string | null | 'duplicate-key'> {
  // Each round re-reads what is free RIGHT NOW and tries those in turn. The
  // pool is reported empty only when a fresh read finds nothing — never by
  // skipping ahead, which under contention could step past a card that is
  // still free. Ten rounds of ten is far beyond any realistic burst.
  for (let round = 0; round < 10; round += 1) {
    const candidates = await prisma.giftCard.findMany({
      where: { corporateOrderId: orderId, allocationStatus: 'UNALLOCATED', status: 'ACTIVE' },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 10
    });
    if (candidates.length === 0) return null;
    for (const candidate of candidates) {
      try {
        const claimed = await prisma.giftCard.updateMany({
          where: { id: candidate.id, corporateOrderId: orderId, allocationStatus: 'UNALLOCATED', status: 'ACTIVE' },
          data
        });
        if (claimed.count === 1) return candidate.id;
      } catch (error) {
        if ((error as { code?: string } | null)?.code === 'P2002') return 'duplicate-key';
        throw error;
      }
    }
  }
  throw new HttpError(409, 'The pool is busy right now. Try again in a moment.');
}

/** Email now unless the card is scheduled for later; return the card as it stands. */
async function deliverIfDue(cardId: string) {
  const card = await prisma.giftCard.findUniqueOrThrow({ where: { id: cardId }, include: { redemptions: { orderBy: [{ redeemedAt: 'desc' }] } } });
  if (card.scheduledDeliveryAt && card.scheduledDeliveryAt.getTime() > Date.now()) {
    return prisma.giftCard.findUniqueOrThrow({ where: { id: cardId }, select: { ...poolCardSelect } });
  }
  try {
    await giftCardService.sendGiftCardEmail(card, await settings());
  } catch (error) {
    await prisma.giftCard.update({ where: { id: cardId }, data: { emailError: error instanceof Error ? error.message : 'Email failed' } });
  }
  return prisma.giftCard.findUniqueOrThrow({ where: { id: cardId }, select: { ...poolCardSelect } });
}

function maskEmail(email: string | null): string {
  if (!email) return '(none)';
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`;
}
