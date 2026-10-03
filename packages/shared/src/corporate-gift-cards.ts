import { z } from 'zod';

/**
 * Corporate gift cards v1 — shared shapes.
 *
 * A company buys N cards of one face value in a single order. The cards it
 * gets are ordinary Alma gift cards (cross-venue, same redemption, same
 * expiry) that belong to the order and sit in a pool until staff allocate
 * each one to a recipient. Nothing here knows about venues: a gift card is
 * redeemable at any Alma venue, and venue belongs to the redemption.
 *
 * Staff-operated: there is no corporate login in v1. Every schema here is an
 * input a manager types on the company's behalf.
 */

/* ------------------------------------------------------------------ */
/* Pricing configuration                                              */
/* ------------------------------------------------------------------ */

/** The most cards one order may hold. Keeps a typo from issuing 5,000 cards. */
export const CORPORATE_ORDER_MAX_QUANTITY = 500;
/** Discounts above this are refused outright, whatever the setting says. */
export const CORPORATE_MAX_DISCOUNT_BPS = 5000;

export const corporateTierSchema = z.object({
  /** Orders of at least this many cards get the tier. */
  minQuantity: z.coerce.number().int().min(1).max(CORPORATE_ORDER_MAX_QUANTITY),
  /** Discount off the face value total, in basis points (250 = 2.5%). */
  discountBps: z.coerce.number().int().min(0).max(CORPORATE_MAX_DISCOUNT_BPS)
});
export type CorporateTier = z.infer<typeof corporateTierSchema>;

export const corporateGiftCardSettingsSchema = z.object({
  /** Fewest cards a corporate order may hold, unless the account overrides it. */
  minimumQuantity: z.coerce.number().int().min(1).max(CORPORATE_ORDER_MAX_QUANTITY),
  /**
   * Quantity tiers, applied PER ORDER (never lifetime spend). The highest tier
   * whose minQuantity the order reaches is the one used. Empty means no
   * discount until the owner configures one — nothing is hardcoded.
   */
  tiers: z.array(corporateTierSchema).max(12)
});
export type CorporateGiftCardSettings = z.infer<typeof corporateGiftCardSettingsSchema>;

export const DEFAULT_CORPORATE_GIFT_CARD_SETTINGS: CorporateGiftCardSettings = {
  minimumQuantity: 10,
  tiers: []
};

/** Sorted ascending by minQuantity, one tier per threshold (last wins). */
export function normaliseCorporateGiftCardSettings(input: unknown): CorporateGiftCardSettings {
  const parsed = corporateGiftCardSettingsSchema.partial().safeParse(input);
  const patch = parsed.success ? parsed.data : {};
  const byThreshold = new Map<number, CorporateTier>();
  for (const tier of patch.tiers ?? DEFAULT_CORPORATE_GIFT_CARD_SETTINGS.tiers) {
    byThreshold.set(tier.minQuantity, { minQuantity: tier.minQuantity, discountBps: tier.discountBps });
  }
  return {
    minimumQuantity: patch.minimumQuantity ?? DEFAULT_CORPORATE_GIFT_CARD_SETTINGS.minimumQuantity,
    tiers: [...byThreshold.values()].sort((a, b) => a.minQuantity - b.minQuantity)
  };
}

/* ------------------------------------------------------------------ */
/* Pricing                                                            */
/* ------------------------------------------------------------------ */

export type CorporateDiscountSource = 'NONE' | 'GLOBAL_TIER' | 'ACCOUNT_OVERRIDE';

export type CorporatePricingAccount = {
  discountOverrideBps: number | null;
  minimumQuantityOverride: number | null;
};

export type CorporatePricingSnapshot = {
  basis: 'PER_ORDER_QUANTITY';
  minimumQuantity: number;
  tiers: CorporateTier[];
  accountDiscountOverrideBps: number | null;
  accountMinimumQuantityOverride: number | null;
  appliedBps: number;
  source: CorporateDiscountSource;
};

export type CorporateOrderQuote = {
  quantity: number;
  faceValueCents: number;
  faceValueTotalCents: number;
  discountSource: CorporateDiscountSource;
  discountBps: number;
  discountCents: number;
  /** What the buyer owes for the cards. Face value is never altered. */
  amountDueCents: number;
  minimumQuantity: number;
  snapshot: CorporatePricingSnapshot;
};

/**
 * Price an order from the settings and the account in force right now.
 *
 * The result is stored on the order as its commercial snapshot. Changing a
 * tier or an override afterwards changes future quotes only; an issued order
 * keeps the terms it was sold on.
 */
export function quoteCorporateOrder(input: {
  quantity: number;
  faceValueCents: number;
  settings: CorporateGiftCardSettings;
  account: CorporatePricingAccount | null;
}): CorporateOrderQuote {
  const settings = normaliseCorporateGiftCardSettings(input.settings);
  const quantity = Math.trunc(input.quantity);
  const faceValueCents = Math.trunc(input.faceValueCents);
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error('Quantity must be at least 1.');
  if (!Number.isFinite(faceValueCents) || faceValueCents < 1) throw new Error('Face value must be positive.');

  const minimumQuantity = input.account?.minimumQuantityOverride ?? settings.minimumQuantity;
  const faceValueTotalCents = quantity * faceValueCents;

  let source: CorporateDiscountSource = 'NONE';
  let bps = 0;
  if (input.account?.discountOverrideBps !== null && input.account?.discountOverrideBps !== undefined) {
    source = 'ACCOUNT_OVERRIDE';
    bps = input.account.discountOverrideBps;
  } else {
    const tier = [...settings.tiers].reverse().find((candidate) => quantity >= candidate.minQuantity);
    if (tier && tier.discountBps > 0) {
      source = 'GLOBAL_TIER';
      bps = tier.discountBps;
    }
  }
  bps = Math.min(Math.max(Math.trunc(bps), 0), CORPORATE_MAX_DISCOUNT_BPS);
  if (bps === 0) source = 'NONE';

  // Round once, on the order total. Per-card shares are derived from this
  // figure (splitDiscountAcrossCards) so the cards always sum back to it.
  const discountCents = Math.round((faceValueTotalCents * bps) / 10000);
  return {
    quantity,
    faceValueCents,
    faceValueTotalCents,
    discountSource: source,
    discountBps: bps,
    discountCents,
    amountDueCents: faceValueTotalCents - discountCents,
    minimumQuantity,
    snapshot: {
      basis: 'PER_ORDER_QUANTITY',
      minimumQuantity: settings.minimumQuantity,
      tiers: settings.tiers,
      accountDiscountOverrideBps: input.account?.discountOverrideBps ?? null,
      accountMinimumQuantityOverride: input.account?.minimumQuantityOverride ?? null,
      appliedBps: bps,
      source
    }
  };
}

/**
 * Spread an order-level discount over its cards in whole cents.
 *
 * The first `remainder` cards carry one extra cent, so Σ shares === total
 * exactly and no card's discount exceeds its face value. Each card's
 * `discountCents` then feeds the existing gift-card accounting unchanged.
 */
export function splitDiscountAcrossCards(discountCents: number, quantity: number): number[] {
  if (quantity < 1) return [];
  const total = Math.max(0, Math.trunc(discountCents));
  const base = Math.floor(total / quantity);
  const remainder = total - base * quantity;
  return Array.from({ length: quantity }, (_, index) => base + (index < remainder ? 1 : 0));
}

/* ------------------------------------------------------------------ */
/* Inputs                                                             */
/* ------------------------------------------------------------------ */

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

export const corporateAccountInputSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  tradingName: optionalText(160),
  abn: optionalText(20),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(160),
  contactPhone: optionalText(40),
  accountsEmail: z.string().trim().email().max(160).optional().or(z.literal('')),
  billingAddress: optionalText(400),
  notes: optionalText(2000),
  active: z.boolean().optional()
});
export type CorporateAccountInput = z.infer<typeof corporateAccountInputSchema>;

/** Commercial terms: owner-only on the API. Null clears an override. */
export const corporateAccountTermsInputSchema = z.object({
  discountOverrideBps: z.coerce.number().int().min(0).max(CORPORATE_MAX_DISCOUNT_BPS).nullable().optional(),
  minimumQuantityOverride: z.coerce.number().int().min(1).max(CORPORATE_ORDER_MAX_QUANTITY).nullable().optional()
});
export type CorporateAccountTermsInput = z.infer<typeof corporateAccountTermsInputSchema>;

export const corporateAccountUpdateSchema = corporateAccountInputSchema.partial();

export const CORPORATE_PAYMENT_METHODS = ['STRIPE', 'MANUAL_OFFLINE', 'INVOICE'] as const;
export type CorporatePaymentMethod = (typeof CORPORATE_PAYMENT_METHODS)[number];

export const corporateOrderInputSchema = z.object({
  corporateAccountId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(CORPORATE_ORDER_MAX_QUANTITY),
  faceValueCents: z.coerce.number().int().min(1),
  paymentMethod: z.enum(CORPORATE_PAYMENT_METHODS),
  poNumber: optionalText(60),
  customerReference: optionalText(120),
  defaultMessage: optionalText(500),
  internalNote: optionalText(1000),
  /** One id per form submission; a retry returns the same order. */
  clientRequestId: z.string().trim().min(8).max(80).optional(),
  successUrl: z.string().url().optional().or(z.literal('')),
  cancelUrl: z.string().url().optional().or(z.literal(''))
});
export type CorporateOrderInput = z.infer<typeof corporateOrderInputSchema>;

export const CORPORATE_MANUAL_TENDERS = ['CARD', 'CASH', 'EFTPOS', 'BANK_TRANSFER'] as const;
export type CorporateManualTender = (typeof CORPORATE_MANUAL_TENDERS)[number];

export const corporateManualPaymentInputSchema = z.object({
  tender: z.enum(CORPORATE_MANUAL_TENDERS),
  paymentReference: optionalText(120),
  /** ISO date-time the money arrived. Defaults to now. */
  paidAt: z.string().optional().or(z.literal(''))
});
export type CorporateManualPaymentInput = z.infer<typeof corporateManualPaymentInputSchema>;

export const corporateOrderCancelInputSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});

export const corporateAllocationInputSchema = z.object({
  recipientName: z.string().trim().min(1).max(160),
  recipientEmail: z.string().trim().email().max(160),
  message: optionalText(500),
  /** ISO date-time. Empty or past = send now. */
  scheduledDeliveryAt: z.string().optional().or(z.literal('')),
  reference: optionalText(120),
  /**
   * Idempotency key within the order. A retry with the same key returns the
   * card already allocated to it instead of allocating a second one.
   */
  allocationKey: z.string().trim().min(1).max(160).optional()
});
export type CorporateAllocationInput = z.infer<typeof corporateAllocationInputSchema>;

/** Re-address a card that has not been emailed yet. Same shape, no new key. */
export const corporateReassignInputSchema = corporateAllocationInputSchema.omit({ allocationKey: true });

export const corporateCsvImportInputSchema = z.object({
  /** The CSV file contents. */
  csv: z.string().min(1).max(2_000_000),
  /** Validate and report only; allocate nothing. */
  dryRun: z.boolean().optional()
});
export type CorporateCsvImportInput = z.infer<typeof corporateCsvImportInputSchema>;

/* ------------------------------------------------------------------ */
/* CSV template                                                       */
/* ------------------------------------------------------------------ */

/**
 * Recipient upload columns. There is deliberately no value column: every card
 * in an order has the order's face value, so a row cannot change it.
 */
export const CORPORATE_RECIPIENT_CSV_COLUMNS = [
  'firstName',
  'lastName',
  'email',
  'message',
  'scheduledDeliveryAt',
  'reference'
] as const;
export type CorporateRecipientCsvColumn = (typeof CORPORATE_RECIPIENT_CSV_COLUMNS)[number];

export const CORPORATE_RECIPIENT_CSV_TEMPLATE =
  `${CORPORATE_RECIPIENT_CSV_COLUMNS.join(',')}\n` +
  'Sarah,Matthews,sarah@example.com,"Congratulations on your new home. Enjoy dinner on us.",2026-11-01T09:00:00+11:00,12 Ocean St settlement\n';

/* ------------------------------------------------------------------ */
/* API payloads                                                       */
/* ------------------------------------------------------------------ */

export type CorporateOrderStatus = 'AWAITING_PAYMENT' | 'ISSUED' | 'CANCELLED';
export type CorporatePaymentStatus = 'AWAITING_PAYMENT' | 'PAID' | 'CANCELLED';
export type GiftCardAllocationStatus = 'UNALLOCATED' | 'ALLOCATED';

export type CorporateAccount = {
  id: string;
  companyName: string;
  tradingName: string | null;
  abn: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  accountsEmail: string | null;
  billingAddress: string | null;
  active: boolean;
  discountOverrideBps: number | null;
  minimumQuantityOverride: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Operational figures for one account, over every non-test order it has. */
export type CorporateAccountStats = {
  orderCount: number;
  /** Cards on ISSUED orders. */
  cardsPurchased: number;
  faceValueCents: number;
  discountCents: number;
  /** Σ amountPaidCents on PAID orders (includes any Stripe service fee). */
  amountPaidCents: number;
  allocated: number;
  unallocated: number;
  emailed: number;
  emailFailed: number;
  /** Cards fully redeemed (status REDEEMED). */
  redeemedCards: number;
  /** Face − balance over the account's live cards: what has been spent. */
  redeemedCents: number;
  /** Remaining balance on ACTIVE cards: the outstanding liability. */
  outstandingCents: number;
  lastOrderAt: string | null;
};

export type CorporateAccountSummary = CorporateAccount & { stats: CorporateAccountStats };

export type CorporateOrderSummary = {
  id: string;
  number: number;
  reference: string;
  corporateAccountId: string;
  companyName: string;
  quantity: number;
  faceValueCents: number;
  faceValueTotalCents: number;
  discountSource: CorporateDiscountSource;
  discountBps: number;
  discountCents: number;
  amountDueCents: number;
  serviceFeeCents: number;
  paymentMethod: CorporatePaymentMethod;
  paymentStatus: CorporatePaymentStatus;
  status: CorporateOrderStatus;
  tender: string | null;
  paymentReference: string | null;
  amountPaidCents: number | null;
  paidAt: string | null;
  issuedAt: string | null;
  poNumber: string | null;
  customerReference: string | null;
  defaultMessage: string | null;
  internalNote: string | null;
  testMode: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  pool: {
    total: number;
    allocated: number;
    unallocated: number;
    emailed: number;
    emailFailed: number;
    scheduled: number;
    redeemedCards: number;
    cancelledCards: number;
    outstandingCents: number;
  };
};

export type CorporatePoolCard = {
  id: string;
  code: string;
  status: string;
  allocationStatus: GiftCardAllocationStatus | null;
  allocationKey: string | null;
  allocatedAt: string | null;
  initialValueCents: number;
  balanceCents: number;
  discountCents: number;
  recipientName: string | null;
  recipientEmail: string | null;
  message: string | null;
  scheduledDeliveryAt: string | null;
  emailedAt: string | null;
  emailError: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
  /** The reference the allocating row or form supplied, if any. */
  reference: string | null;
};

export type CorporateOrderDetail = CorporateOrderSummary & {
  pricingSnapshot: CorporatePricingSnapshot | Record<string, never>;
  stripeCheckoutSessionId: string | null;
  /** Hosted Stripe page the buyer pays on; only while awaiting Stripe payment. */
  checkoutUrl: string | null;
  cards: CorporatePoolCard[];
};

export type CorporateOrderCreateResult = {
  order: CorporateOrderDetail;
  /** For STRIPE: the hosted checkout to send the buyer to. */
  checkoutUrl: string | null;
};

export type CorporateCsvRowError = { row: number; field: string | null; message: string };

export type CorporateCsvRowPlan = {
  row: number;
  recipientName: string;
  recipientEmail: string;
  message: string | null;
  scheduledDeliveryAt: string | null;
  reference: string | null;
  allocationKey: string;
  /** Already allocated to this key on this order (a retried upload). */
  alreadyAllocated: boolean;
};

export type CorporateCsvImportResult = {
  dryRun: boolean;
  valid: boolean;
  rows: CorporateCsvRowPlan[];
  errors: CorporateCsvRowError[];
  summary: {
    rowCount: number;
    toAllocate: number;
    alreadyAllocated: number;
    available: number;
    shortfall: number;
  };
  /** Only on a real run. */
  allocated?: Array<{ row: number; code: string; emailed: boolean; emailError: string | null }>;
};

export type CorporateAccountExportRow = {
  orderReference: string;
  code: string;
  status: string;
  allocationStatus: string;
  recipientName: string;
  recipientEmail: string;
  reference: string;
  faceValueCents: number;
  balanceCents: number;
  discountCents: number;
  scheduledDeliveryAt: string;
  emailedAt: string;
  emailError: string;
  expiresAt: string;
};
