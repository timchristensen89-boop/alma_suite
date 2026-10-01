// Which gift cards get a receipt or tax invoice, and what the document says
// about how they were paid. Pure, so every case the Stripe map turned up is
// pinned by gift-card-documents.test.ts.
//
// Two traps shaped this file:
//  - paidAt is not a money flag. Campaign reward cards and test cards have it
//    set with nothing paid; donations and comps have it null. Only "money
//    actually came in" earns a document.
//  - stripeCheckoutSessionId is overloaded with synthetic keys (TEST-…,
//    physical:…, donation:…, giftup:…, campaign:…). It is never proof that
//    Stripe was involved, so nothing here reads it as such.

import type { FinancialDocumentLineDraft, PaymentProvider } from '@alma/shared';

export type GiftCardDocumentEligibility = {
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  testMode: boolean;
  amountPaidCents: number | null;
  paidAt: Date | string | null;
  tender: string | null;
};

export type GiftCardPaymentFacts = {
  tender: string | null;
  testMode: boolean;
  promoCodeSnapshot: string | null;
  stripePaymentIntentId: string | null;
};

/** promoCodeSnapshot value the GiftUp import writes. Not a promo code. */
export const GIFTUP_IMPORT_MARKER = 'GIFTUP_IMPORT';

/**
 * Why a card cannot have a sale document, or null when it can.
 *
 * Checked in this order so the sentence names the real reason: a test card is
 * a test card whatever else is true of it, and an unpaid checkout has no paid
 * amount yet, which would otherwise read as "nothing was paid".
 */
export function giftCardDocumentIneligibleReason(card: GiftCardDocumentEligibility): string | null {
  if (card.testMode) return 'This is a test card. No money was taken, so there is nothing to receipt.';
  if (card.status === 'PENDING_PAYMENT') {
    return 'This card is still awaiting payment. A receipt can be issued once the payment is confirmed.';
  }
  if (card.tender === 'COMP') {
    return 'This card was given away (complimentary or a donation), so there is no sale to receipt.';
  }
  if (!card.amountPaidCents || card.amountPaidCents <= 0) {
    return 'Nothing was paid for this card (a complimentary, donation or campaign card), so there is nothing to receipt.';
  }
  if (!card.paidAt) return 'There is no payment date recorded for this card, so there is nothing to receipt.';
  return null;
}

const COUNTER_TENDERS = new Set<PaymentProvider>(['STRIPE', 'CARD', 'CASH', 'EFTPOS']);

/** How the money came in, as the document records it. */
export function paymentProviderForCard(card: { promoCodeSnapshot: string | null; tender: string | null }): PaymentProvider {
  // GiftUp imports carry tender STRIPE, but the money went through GiftUp.
  if (card.promoCodeSnapshot === GIFTUP_IMPORT_MARKER) return 'GIFTUP';
  const tender = (card.tender ?? '').toUpperCase() as PaymentProvider;
  return COUNTER_TENDERS.has(tender) ? tender : 'OTHER';
}

/**
 * The PaymentIntent to ask Stripe about, or null when this card was not a real
 * Stripe payment. GiftUp imports and test cards both say tender STRIPE; only
 * the combination below is a charge that exists in Alma's Stripe account.
 */
export function stripePaymentIntentIdForCard(card: GiftCardPaymentFacts): string | null {
  if (card.tender !== 'STRIPE' || card.testMode || card.promoCodeSnapshot === GIFTUP_IMPORT_MARKER) return null;
  return card.stripePaymentIntentId?.trim() || null;
}

/** Only a real Checkout Session id is worth copying onto a document. */
export function stripeCheckoutSessionIdForDocument(sessionId: string | null): string | null {
  const id = sessionId?.trim() ?? '';
  return id.startsWith('cs_') ? id : null;
}

/**
 * The promo code to print on the discount line. promoCodeSnapshot doubles as
 * an origin marker for cards that were never discounted by a code.
 */
export function promoCodeForDocument(snapshot: string | null): string | null {
  const code = snapshot?.trim();
  if (!code) return null;
  if (code === GIFTUP_IMPORT_MARKER || code === 'PHYSICAL_COUNTER' || code === 'DONATION') return null;
  if (code.startsWith('CAMPAIGN_REWARD:')) return null;
  return code;
}

const CARD_BRANDS: Record<string, string> = {
  amex: 'American Express',
  cartes_bancaires: 'Cartes Bancaires',
  diners: 'Diners Club',
  discover: 'Discover',
  eftpos_au: 'eftpos',
  jcb: 'JCB',
  link: 'Link',
  mastercard: 'Mastercard',
  unionpay: 'UnionPay',
  visa: 'Visa'
};

/** Stripe's brand id ("mastercard", "eftpos_au") as a person would write it. */
export function cardBrandLabel(brand: string | null | undefined): string | null {
  const id = brand?.trim().toLowerCase();
  if (!id || id === 'unknown') return null;
  return CARD_BRANDS[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** "Visa ending 4242", "Cash", "Card (at the counter)". */
export function paymentMethodSummary(provider: PaymentProvider, brand?: string | null, last4?: string | null): string {
  switch (provider) {
    case 'STRIPE': {
      const label = cardBrandLabel(brand);
      const digits = last4?.trim();
      if (label && digits) return `${label} ending ${digits}`;
      if (digits) return `Card ending ${digits}`;
      return label ?? 'Stripe';
    }
    case 'CARD':
      return 'Card (at the counter)';
    case 'CASH':
      return 'Cash';
    case 'EFTPOS':
      return 'EFTPOS';
    case 'GIFTUP':
      return 'GiftUp';
    case 'OTHER':
      return 'Other';
  }
}

/** The exactly-once latch for a card's live sale document. */
export function giftCardSaleKey(cardId: string): string {
  return `GIFT_CARD:${cardId}`;
}

/** ALMA-INV → ALMA-CN: credit notes number in their own series. */
export function creditSeriesFor(saleSeries: string): string {
  return saleSeries.endsWith('-INV') ? `${saleSeries.slice(0, -'-INV'.length)}-CN` : `${saleSeries}-CN`;
}

/**
 * An issuer that is not registered for GST makes no taxable supplies (s9-5),
 * so nothing on its documents carries GST — the service fee included. The fee
 * is part of what was paid for the voucher, so it takes the voucher's
 * treatment. With every line at zero the document comes out as a receipt.
 */
export function applyIssuerGstStatus(lines: FinancialDocumentLineDraft[], issuerGstRegistered: boolean): FinancialDocumentLineDraft[] {
  if (issuerGstRegistered) return lines;
  return lines.map((line) =>
    line.taxableAmountCents === 0 && line.gstCents === 0
      ? line
      : { ...line, gstTreatment: 'FACE_VALUE_VOUCHER', taxableAmountCents: 0, gstCents: 0 }
  );
}

/** Enough of a card code to correlate log lines — never the whole bearer secret. */
export function maskGiftCardCode(code: string): string {
  return `***${code.slice(-4)}`;
}

/** The parts of a Stripe refund the reconciliation reads. */
export type StripeRefundFacts = {
  id: string;
  status: string | null;
  amount: number;
  created: number;
  reason: string | null;
};

/** A credit note that carries a Stripe refund id. */
export type StripeRefundNote = {
  stripeRefundId: string | null;
  number: string;
  status: string;
};

/**
 * Which of a payment's Stripe refunds still need a credit note, and which
 * credited refunds Stripe has since reported as failed.
 *
 * A refund is credited once it has succeeded and no ISSUED note carries its
 * id. Voiding a note releases the id (see financialDocumentService.void), so
 * a void note normally never matches; one voided before that rule still
 * holds its id, and raiseCreditNote releases it when the refund is credited
 * again. A failed or cancelled refund is never credited; if a live note
 * already stands for it, the owner decides whether to void it — documents
 * are not rewritten behind anyone's back.
 */
export function planStripeRefundCredits<R extends StripeRefundFacts>(
  refunds: R[],
  notes: StripeRefundNote[]
): { toCredit: R[]; failedButCredited: Array<{ refund: R; noteNumber: string }> } {
  const live = new Map(
    notes.filter((note) => note.status === 'ISSUED' && note.stripeRefundId).map((note) => [note.stripeRefundId, note.number])
  );
  const toCredit: R[] = [];
  const failedButCredited: Array<{ refund: R; noteNumber: string }> = [];
  for (const refund of refunds) {
    const noteNumber = live.get(refund.id);
    if (refund.status === 'succeeded') {
      if (!noteNumber) toCredit.push(refund);
    } else if (noteNumber && (refund.status === 'failed' || refund.status === 'canceled')) {
      failedButCredited.push({ refund, noteNumber });
    }
  }
  return { toCredit, failedButCredited };
}

/** The reason printed on a credit note raised for a Stripe refund. */
export function stripeRefundCreditReason(refund: Pick<StripeRefundFacts, 'reason'>): string {
  return `Refunded in Stripe${refund.reason ? ` (${refund.reason.replace(/_/g, ' ')})` : ''}`;
}

/**
 * Whether issuing a sale document should also ask Stripe for the payment's
 * refunds and credit them.
 *
 * Why it ever does: a refund made BEFORE the document existed — a card
 * receipted by hand days later, or a corrected document reissued after a
 * void — has no credit note yet, and no new refund event will arrive to
 * raise one. So a manual issue and the catch-up job reconcile.
 *
 * Why the checkout never does (AUTO_STRIPE): the payment confirmed a moment
 * ago, so it cannot have been refunded yet. The call would only add a Stripe
 * round trip to the buyer's success page and the counter iPad, for nothing.
 * Refunds made later are still credited by the refund webhooks.
 */
export function shouldReconcileRefundsOnIssue(input: {
  provider: string;
  stripePaymentIntentId: string | null | undefined;
  issueSource: string;
}): boolean {
  return input.provider === 'STRIPE' && Boolean(input.stripePaymentIntentId) && input.issueSource !== 'AUTO_STRIPE';
}
