/**
 * Financial documents: receipts, tax invoices and credit notes that Alma Suite
 * issues for money it has taken.
 *
 * Stripe (or the till, for a counter sale) is the truth about the PAYMENT —
 * that it happened, how much, when, on what card. It is not the accounting
 * logic. What a document has to say about GST depends on what was actually
 * sold, and who sold it, and neither of those is something Stripe knows. So
 * the document is composed here, from the sale, and every line carries its own
 * GST treatment.
 *
 * Why per line: a gift card bought online is two things at once. The card is a
 * face value voucher (Division 100 of the GST Act) — GST is not payable when it
 * is sold, only when it is redeemed for a taxable supply. But the 3.5% card
 * processing fee on top is part of the price paid for the voucher (a card
 * surcharge follows the supply it is charged on, GSTR 2014/2), and s100-5(2)
 * makes the sale of a voucher taxable to the extent the price paid EXCEEDS its
 * face value. A $100 card sold for $103.50 is therefore a $3.50 taxable supply
 * carrying $0.32 GST, and the document has to say so line by line — "the
 * extent to which each sale on the invoice is a taxable sale" is one of the
 * ATO's tax invoice requirements.
 *
 * Pure by design — no database, no clock — so the arithmetic is tested
 * directly (apps/api/src/lib/financial-documents.test.ts).
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const GST_TREATMENTS = [
  'STANDARD_TAXABLE',
  'GST_FREE',
  'INPUT_TAXED',
  'FACE_VALUE_VOUCHER',
  'MIXED'
] as const;
export type GstTreatment = (typeof GST_TREATMENTS)[number];

export const GST_TREATMENT_LABELS: Record<GstTreatment, string> = {
  STANDARD_TAXABLE: 'Taxable',
  GST_FREE: 'GST-free',
  INPUT_TAXED: 'Input taxed',
  FACE_VALUE_VOUCHER: 'Face value voucher (no GST)',
  MIXED: 'Partly taxable'
};

/**
 * RECEIPT        — a sale with nothing taxable on it (e.g. a gift card sold at
 *                  or below face value). Not a tax invoice: there is no GST
 *                  for anyone to claim.
 * TAX_INVOICE    — a sale with at least one taxable line, issued by a GST
 *                  registered entity. Also serves as the receipt.
 * CREDIT_NOTE    — money given back against a RECEIPT (no GST to adjust).
 * ADJUSTMENT_NOTE — money given back against a TAX_INVOICE: the ATO's name
 *                  for a credit note that decreases GST.
 */
export const FINANCIAL_DOCUMENT_TYPES = ['RECEIPT', 'TAX_INVOICE', 'CREDIT_NOTE', 'ADJUSTMENT_NOTE'] as const;
export type FinancialDocumentType = (typeof FINANCIAL_DOCUMENT_TYPES)[number];

export const FINANCIAL_DOCUMENT_STATUSES = ['ISSUED', 'VOID'] as const;
export type FinancialDocumentStatus = (typeof FINANCIAL_DOCUMENT_STATUSES)[number];

/** What produced the document. Only gift cards today; the engine is generic. */
export const FINANCIAL_DOCUMENT_SOURCES = ['GIFT_CARD'] as const;
export type FinancialDocumentSource = (typeof FINANCIAL_DOCUMENT_SOURCES)[number];

/** How it came to be issued. */
export const FINANCIAL_DOCUMENT_ISSUE_SOURCES = ['AUTO_STRIPE', 'MANUAL', 'STRIPE_REFUND', 'CATCH_UP'] as const;
export type FinancialDocumentIssueSource = (typeof FINANCIAL_DOCUMENT_ISSUE_SOURCES)[number];

/** How the money moved. Mirrors GiftCard.tender, plus GIFTUP for imported cards. */
export const PAYMENT_PROVIDERS = ['STRIPE', 'CARD', 'CASH', 'EFTPOS', 'GIFTUP', 'OTHER'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export function isCreditDocument(type: FinancialDocumentType) {
  return type === 'CREDIT_NOTE' || type === 'ADJUSTMENT_NOTE';
}

/** The heading printed on the document. */
export function financialDocumentTitle(type: FinancialDocumentType): string {
  switch (type) {
    case 'TAX_INVOICE':
      return 'Tax invoice / Receipt';
    case 'RECEIPT':
      return 'Receipt';
    case 'ADJUSTMENT_NOTE':
      return 'Adjustment note / Credit note';
    case 'CREDIT_NOTE':
      return 'Credit note';
  }
}

/* ------------------------------------------------------------------ */
/* GST arithmetic                                                      */
/* ------------------------------------------------------------------ */

/** GST in a GST-inclusive amount: one eleventh, to the nearest cent (half up). */
export function gstInclusiveComponentCents(amountCents: number): number {
  if (!Number.isFinite(amountCents)) return 0;
  const sign = amountCents < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(amountCents) / 11);
}

export type FinancialDocumentLineDraft = {
  description: string;
  detail: string | null;
  quantity: number;
  /** GST-inclusive price of one unit. */
  unitAmountCents: number;
  /** GST-inclusive line total (quantity × unit). Negative for a discount line. */
  amountCents: number;
  gstTreatment: GstTreatment;
  /** The GST-inclusive part of amountCents that is a taxable supply (0..amountCents). */
  taxableAmountCents: number;
  gstCents: number;
};

export type FinancialDocumentTotals = {
  totalCents: number;
  taxableCents: number;
  gstCents: number;
  gstTreatment: GstTreatment;
};

/**
 * Document totals and the one-word GST summary. A document whose lines all
 * share a treatment takes it; anything else is MIXED.
 */
export function summariseLines(lines: FinancialDocumentLineDraft[]): FinancialDocumentTotals {
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const taxableCents = lines.reduce((sum, line) => sum + line.taxableAmountCents, 0);
  const gstCents = lines.reduce((sum, line) => sum + line.gstCents, 0);
  const treatments = new Set(lines.map((line) => line.gstTreatment));
  const only = treatments.size === 1 ? [...treatments][0] : undefined;
  return { totalCents, taxableCents, gstCents, gstTreatment: only ?? 'MIXED' };
}

/**
 * Which kind of sale document the lines make. A tax invoice needs something
 * taxable on it AND a GST-registered issuer — an unregistered entity cannot
 * issue one, whatever the lines say.
 */
export function saleDocumentType(totals: FinancialDocumentTotals, issuerGstRegistered: boolean): FinancialDocumentType {
  return issuerGstRegistered && totals.gstCents > 0 ? 'TAX_INVOICE' : 'RECEIPT';
}

export function creditDocumentType(original: FinancialDocumentType): FinancialDocumentType {
  return original === 'TAX_INVOICE' ? 'ADJUSTMENT_NOTE' : 'CREDIT_NOTE';
}

/* ------------------------------------------------------------------ */
/* Gift card sale                                                      */
/* ------------------------------------------------------------------ */

export type GiftCardSaleInput = {
  code: string;
  faceValueCents: number;
  discountCents: number;
  promoCode: string | null;
  /** Everything the purchaser paid, fee included. Null/0 means nothing was paid. */
  amountPaidCents: number | null;
  recipientName: string | null;
};

export class FinancialDocumentError extends Error {}

/**
 * How a gift card is named on a document: "ending 8BB1", never the whole code.
 * The code is a bearer secret — the public print, QR and wallet endpoints and
 * the counter all take it as proof of ownership — and a tax invoice is exactly
 * the kind of document that gets forwarded to a bookkeeper. The last four are
 * enough to identify the supply; the full code stays on the document row
 * (sourceReference) for staff searching the register.
 */
export function maskedGiftCardReference(code: string): string {
  const trimmed = code.trim();
  return `ending ${trimmed.slice(-4)}`;
}

/**
 * The lines of a gift card sale.
 *
 *   ALMA gift card ending XXXX         face value      no GST
 *   Promo code SPRING (if any)         − discount      no GST
 *   Service fee — card processing      paid − price    taxable to the extent
 *                                                      paid exceeds face value
 *
 * The fee is not stored on the card; it is what was paid over the voucher's
 * price (face − discount), which is exactly the Stripe line item it came from.
 * A payment that does not reconcile (paid LESS than the voucher's price) is
 * refused rather than papered over — the document would be wrong.
 */
export function composeGiftCardSaleLines(input: GiftCardSaleInput): FinancialDocumentLineDraft[] {
  const face = Math.round(input.faceValueCents);
  const discount = Math.max(0, Math.round(input.discountCents));
  const paid = Math.round(input.amountPaidCents ?? 0);
  if (!(face > 0)) throw new FinancialDocumentError('The gift card has no face value.');
  if (!(paid > 0)) throw new FinancialDocumentError('Nothing was paid for this gift card, so there is nothing to receipt.');
  if (discount > face) throw new FinancialDocumentError('The discount is larger than the card.');

  const voucherPrice = face - discount;
  const fee = paid - voucherPrice;
  if (fee < 0) {
    throw new FinancialDocumentError(
      `The amount paid (${centsToDollars(paid)}) is less than the card's price (${centsToDollars(voucherPrice)}). Check the payment before issuing a document.`
    );
  }

  // s100-5(2): the voucher sale is taxable only to the extent the total price
  // paid exceeds the face value. That excess can only have come from the fee.
  const excess = Math.max(0, paid - face);
  const feeTaxable = Math.min(fee, excess);

  const lines: FinancialDocumentLineDraft[] = [
    {
      description: `ALMA gift card ${maskedGiftCardReference(input.code)}`,
      detail: [
        'Face value voucher',
        input.recipientName ? `for ${input.recipientName}` : null
      ].filter(Boolean).join(' ') || null,
      quantity: 1,
      unitAmountCents: face,
      amountCents: face,
      gstTreatment: 'FACE_VALUE_VOUCHER',
      taxableAmountCents: 0,
      gstCents: 0
    }
  ];

  if (discount > 0) {
    lines.push({
      description: input.promoCode ? `Promo code ${input.promoCode}` : 'Discount',
      detail: 'Reduces the price paid, not the card value',
      quantity: 1,
      unitAmountCents: -discount,
      amountCents: -discount,
      gstTreatment: 'FACE_VALUE_VOUCHER',
      taxableAmountCents: 0,
      gstCents: 0
    });
  }

  if (fee > 0) {
    lines.push({
      description: 'Service fee — card processing',
      detail: 'Not deducted from the gift card',
      quantity: 1,
      unitAmountCents: fee,
      amountCents: fee,
      gstTreatment: feeTaxable === 0 ? 'FACE_VALUE_VOUCHER' : feeTaxable === fee ? 'STANDARD_TAXABLE' : 'MIXED',
      taxableAmountCents: feeTaxable,
      gstCents: gstInclusiveComponentCents(feeTaxable)
    });
  }

  return lines;
}

/* ------------------------------------------------------------------ */
/* Credit notes                                                        */
/* ------------------------------------------------------------------ */

export type CreditableDocument = {
  totalCents: number;
  taxableCents: number;
  gstCents: number;
};

export type PriorCredit = {
  totalCents: number;
  taxableCents: number;
  gstCents: number;
};

/**
 * What is left to credit on a sale document once earlier (non-void) credit
 * notes are taken off.
 */
export function remainingCreditable(original: CreditableDocument, priorCredits: PriorCredit[]) {
  const credited = priorCredits.reduce(
    (sum, credit) => ({
      totalCents: sum.totalCents + credit.totalCents,
      taxableCents: sum.taxableCents + credit.taxableCents,
      gstCents: sum.gstCents + credit.gstCents
    }),
    { totalCents: 0, taxableCents: 0, gstCents: 0 }
  );
  return {
    totalCents: Math.max(0, original.totalCents - credited.totalCents),
    taxableCents: Math.max(0, original.taxableCents - credited.taxableCents),
    gstCents: Math.max(0, original.gstCents - credited.gstCents)
  };
}

/**
 * The lines of a credit note for `amountCents` against a sale document.
 *
 * Amounts on a credit note are stored POSITIVE — the document type says it is
 * money going back. The refund is split between the taxable and non-taxable
 * parts of what remains, in proportion; a credit that takes the remainder
 * takes exactly the remainder, so a full refund (or the last of several
 * partial ones) reverses the original GST to the cent.
 *
 * Proportional is a default, not a ruling: if a refund is specifically of the
 * fee, or specifically of the card, the accountant may want it allocated that
 * way instead. The split is printed on the note so it can be checked.
 */
export function composeCreditLines(
  original: CreditableDocument,
  priorCredits: PriorCredit[],
  amountCents: number
): FinancialDocumentLineDraft[] {
  const amount = Math.round(amountCents);
  const remaining = remainingCreditable(original, priorCredits);
  if (!(amount > 0)) throw new FinancialDocumentError('Credit amount must be more than zero.');
  if (amount > remaining.totalCents) {
    throw new FinancialDocumentError(
      `Only ${centsToDollars(remaining.totalCents)} is left to credit on this document.`
    );
  }

  const takesRemainder = amount === remaining.totalCents;
  const taxable = takesRemainder
    ? remaining.taxableCents
    : Math.min(remaining.taxableCents, Math.round((amount * remaining.taxableCents) / Math.max(1, remaining.totalCents)));
  // GST follows what is LEFT, not what is taken: the GST still owed on the
  // taxable remainder after this credit decides how much this credit reverses.
  // Taking one eleventh of each slice instead can strand a cent — two credits
  // of 346c and 4c round to 31c + 0c, leaving 1c of GST on 0c of taxable
  // supply that no later credit could ever reverse.
  const gst = takesRemainder
    ? remaining.gstCents
    : Math.max(0, Math.min(remaining.gstCents, remaining.gstCents - gstInclusiveComponentCents(remaining.taxableCents - taxable)));
  const nonTaxable = amount - taxable;

  const lines: FinancialDocumentLineDraft[] = [];
  if (nonTaxable > 0) {
    lines.push({
      description: 'Refund — not taxable',
      detail: 'Face value voucher: no GST was charged on this part',
      quantity: 1,
      unitAmountCents: nonTaxable,
      amountCents: nonTaxable,
      gstTreatment: 'FACE_VALUE_VOUCHER',
      taxableAmountCents: 0,
      gstCents: 0
    });
  }
  if (taxable > 0 || gst > 0) {
    lines.push({
      description: 'Refund — taxable',
      detail: 'Reverses GST charged on the original document',
      quantity: 1,
      unitAmountCents: taxable,
      amountCents: taxable,
      gstTreatment: 'STANDARD_TAXABLE',
      taxableAmountCents: taxable,
      gstCents: gst
    });
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

export const DOCUMENT_PREFIX_PATTERN = /^[A-Z0-9]{2,8}$/;

/** "ALMA-INV" for sale documents, "ALMA-CN" for credit/adjustment notes. */
export function documentSeries(prefix: string, type: FinancialDocumentType): string {
  return `${prefix}-${isCreditDocument(type) ? 'CN' : 'INV'}`;
}

/** ALMA-INV-000184. Six digits, growing past that rather than wrapping. */
export function formatDocumentNumber(series: string, sequence: number): string {
  return `${series}-${String(Math.max(1, Math.trunc(sequence))).padStart(6, '0')}`;
}

/* ------------------------------------------------------------------ */
/* ABN                                                                 */
/* ------------------------------------------------------------------ */

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function normaliseAbn(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * The ABR checksum: subtract 1 from the first digit, weight, sum, divisible by
 * 89. Catches a transposed or mistyped digit before it is printed on a legal
 * document.
 */
export function isValidAbn(raw: string): boolean {
  const digits = normaliseAbn(raw);
  if (!/^\d{11}$/.test(digits)) return false;
  const sum = digits.split('').reduce((total, char, index) => {
    const digit = Number(char) - (index === 0 ? 1 : 0);
    return total + digit * (ABN_WEIGHTS[index] ?? 0);
  }, 0);
  return sum % 89 === 0;
}

/** 51 824 753 556 */
export function formatAbn(raw: string): string {
  const digits = normaliseAbn(raw);
  if (digits.length !== 11) return raw.trim();
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

/* ------------------------------------------------------------------ */
/* Money formatting                                                    */
/* ------------------------------------------------------------------ */

export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/**
 * Stored in AppSettings.invoiceSettings.
 *
 * giftCardIssuingEntityId — the company that is the merchant of record for
 *   gift cards. Group cards redeem at either venue, so this is a decision, not
 *   something derivable; until it is made, nothing is issued.
 * autoIssueGiftCards — issue the document the moment Stripe confirms payment.
 * autoEmail — email it to the purchaser as well.
 * autoIssueFrom — set by the server each time auto-issue is switched on. The
 *   catch-up job only issues for cards paid after this moment, so switching
 *   the feature on (or back on after a pause) never mass-emails the buyers
 *   of the weeks it was off.
 */
export type InvoiceSettings = {
  giftCardIssuingEntityId: string | null;
  autoIssueGiftCards: boolean;
  autoEmail: boolean;
  autoIssueFrom: string | null;
  footerNote: string | null;
};

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  giftCardIssuingEntityId: null,
  autoIssueGiftCards: false,
  autoEmail: true,
  autoIssueFrom: null,
  footerNote: null
};

export const invoiceSettingsInputSchema = z.object({
  giftCardIssuingEntityId: z.string().min(1).max(64).nullable().optional(),
  autoIssueGiftCards: z.boolean().optional(),
  autoEmail: z.boolean().optional(),
  footerNote: z.string().max(400).nullable().optional()
});
export type InvoiceSettingsInput = z.infer<typeof invoiceSettingsInputSchema>;

export function normaliseInvoiceSettings(input: unknown): InvoiceSettings {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const autoIssueFrom = str(raw.autoIssueFrom);
  return {
    giftCardIssuingEntityId: str(raw.giftCardIssuingEntityId),
    autoIssueGiftCards: typeof raw.autoIssueGiftCards === 'boolean' ? raw.autoIssueGiftCards : DEFAULT_INVOICE_SETTINGS.autoIssueGiftCards,
    autoEmail: typeof raw.autoEmail === 'boolean' ? raw.autoEmail : DEFAULT_INVOICE_SETTINGS.autoEmail,
    autoIssueFrom: autoIssueFrom && !Number.isNaN(new Date(autoIssueFrom).getTime()) ? autoIssueFrom : null,
    footerNote: str(raw.footerNote)
  };
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

export const legalEntityInputSchema = z.object({
  code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and dashes only.'),
  legalName: z.string().trim().min(3).max(160),
  tradingName: optionalText(160),
  abn: z.string().trim().refine(isValidAbn, 'That ABN fails the ABR checksum — check the digits.'),
  gstRegistered: z.boolean().default(true),
  address: optionalText(300),
  email: z.string().trim().email().optional().or(z.literal('')),
  phone: optionalText(40),
  website: optionalText(160),
  documentPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(DOCUMENT_PREFIX_PATTERN, 'Prefix is 2–8 capital letters or digits.')
    .default('ALMA'),
  active: z.boolean().default(true)
});
export type LegalEntityInput = z.infer<typeof legalEntityInputSchema>;
export const legalEntityUpdateSchema = legalEntityInputSchema.partial();

/**
 * Bill-to details a manager can set when issuing by hand — a council buying a
 * card wants its own name on the document, not just the person who paid.
 * Buyer identity (or ABN) is required on a tax invoice of $1,000 or more.
 */
export const issueGiftCardDocumentInputSchema = z.object({
  customerName: optionalText(160),
  customerOrganisation: optionalText(160),
  customerAbn: z
    .string()
    .trim()
    .refine((value) => value === '' || isValidAbn(value), 'That ABN fails the ABR checksum — check the digits.')
    .optional(),
  customerEmail: z.string().trim().email().optional().or(z.literal('')),
  customerReference: optionalText(80),
  note: optionalText(400),
  email: z.boolean().default(false),
  emailTo: z.string().trim().email().optional().or(z.literal(''))
});
export type IssueGiftCardDocumentInput = z.infer<typeof issueGiftCardDocumentInputSchema>;

export const emailFinancialDocumentInputSchema = z.object({
  to: z.string().trim().email().optional().or(z.literal(''))
});
export type EmailFinancialDocumentInput = z.infer<typeof emailFinancialDocumentInputSchema>;

export const STRIPE_REFUND_ID_PATTERN = /^re_[A-Za-z0-9]+$/;

/**
 * A credit note raised by hand. When the money went back through Stripe the
 * refund id is required: it is the same key the refund webhook credits on
 * (FinancialDocument.stripeRefundId is unique), so one refund can never be
 * credited twice — once by hand and again when Stripe's event arrives.
 */
export const creditNoteInputSchema = z
  .object({
    amountCents: z.number().int().positive(),
    reason: z.string().trim().min(3).max(300),
    /** How the money went back: STRIPE (already refunded there), CASH, CARD, EFTPOS, OTHER. */
    refundMethod: z.enum(['STRIPE', 'CARD', 'CASH', 'EFTPOS', 'OTHER']).default('OTHER'),
    refundReference: optionalText(80),
    /** Stripe refund id (re_…). Required when refundMethod is STRIPE. */
    stripeRefundId: z
      .string()
      .trim()
      .regex(STRIPE_REFUND_ID_PATTERN, 'A Stripe refund id starts with re_ — copy it from the refund in Stripe.')
      .optional()
      .or(z.literal('')),
    email: z.boolean().default(false)
  })
  .superRefine((value, ctx) => {
    if (value.refundMethod === 'STRIPE' && !value.stripeRefundId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stripeRefundId'],
        message: 'Add the Stripe refund id (re_…) so this refund cannot be credited twice.'
      });
    }
  });
export type CreditNoteInput = z.infer<typeof creditNoteInputSchema>;

export const voidFinancialDocumentInputSchema = z.object({
  reason: z.string().trim().min(3).max(300)
});
export type VoidFinancialDocumentInput = z.infer<typeof voidFinancialDocumentInputSchema>;

/* ------------------------------------------------------------------ */
/* Payloads (API → web)                                                */
/* ------------------------------------------------------------------ */

export type LegalEntity = {
  id: string;
  code: string;
  legalName: string;
  tradingName: string | null;
  abn: string;
  gstRegistered: boolean;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  documentPrefix: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FinancialDocumentLine = FinancialDocumentLineDraft & {
  id: string;
  position: number;
};

export type FinancialDocumentSummary = {
  id: string;
  number: string;
  type: FinancialDocumentType;
  status: FinancialDocumentStatus;
  gstTreatment: GstTreatment;
  sourceType: FinancialDocumentSource;
  sourceId: string;
  sourceReference: string | null;
  giftCardId: string | null;
  creditsDocumentId: string | null;
  creditsDocumentNumber: string | null;
  legalEntityId: string;
  issuerLegalName: string;
  issuerTradingName: string | null;
  issuerAbn: string;
  customerName: string;
  customerOrganisation: string | null;
  customerEmail: string | null;
  currency: string;
  totalCents: number;
  taxableCents: number;
  gstCents: number;
  paymentProvider: PaymentProvider;
  paymentMethodSummary: string | null;
  paidAt: string | null;
  issuedAt: string;
  issueSource: FinancialDocumentIssueSource;
  emailedAt: string | null;
  emailedTo: string | null;
  emailError: string | null;
  emailCount: number;
  voidedAt: string | null;
  voidReason: string | null;
  testMode: boolean;
};

export type FinancialDocumentDetail = FinancialDocumentSummary & {
  issuerAddress: string | null;
  issuerEmail: string | null;
  issuerPhone: string | null;
  issuerWebsite: string | null;
  issuerGstRegistered: boolean;
  customerAbn: string | null;
  customerReference: string | null;
  paymentReference: string | null;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeChargeId: string | null;
  stripeRefundId: string | null;
  supplyDate: string | null;
  reason: string | null;
  note: string | null;
  issuedByName: string | null;
  lines: FinancialDocumentLine[];
  /** Credit/adjustment notes issued against this document (newest first). */
  credits: FinancialDocumentSummary[];
  /** What is still creditable (0 for credit notes and void documents). */
  remainingCreditableCents: number;
};

export type FinancialDocumentListResponse = {
  documents: FinancialDocumentSummary[];
  totals: {
    count: number;
    /** Sale documents minus credit notes, void excluded. */
    netTotalCents: number;
    netGstCents: number;
  };
  capped: boolean;
};

export type InvoiceSettingsResponse = {
  settings: InvoiceSettings;
  entities: LegalEntity[];
  canManage: boolean;
  /** Human-readable reason documents cannot be issued yet, or null when ready. */
  setupIssue: string | null;
};

export type GiftCardDocumentsResponse = {
  giftCardId: string;
  code: string;
  /** Why this card cannot have a document issued (test card, comp, unpaid), or null. */
  ineligibleReason: string | null;
  documents: FinancialDocumentSummary[];
};
