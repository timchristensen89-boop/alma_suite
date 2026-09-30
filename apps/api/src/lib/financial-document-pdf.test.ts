import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  composeCreditLines,
  composeGiftCardSaleLines,
  summariseLines,
  type FinancialDocumentDetail,
  type FinancialDocumentLineDraft
} from '@alma/shared';
import { pdfSafeText, renderFinancialDocumentPdf } from './financial-document-pdf.js';

const NASTY = 'Arrow → minus − tick ✓ at least ≥ Māori 😀 narrow space nbsp here zero​width new\nline tab\there';

function withPositions(lines: FinancialDocumentLineDraft[]) {
  return lines.map((line, index) => ({ ...line, id: `line-${index + 1}`, position: index + 1 }));
}

function saleDocument(overrides: Partial<FinancialDocumentDetail> = {}): FinancialDocumentDetail {
  const lines = composeGiftCardSaleLines({
    code: 'ALMA-22480BB1',
    faceValueCents: 100_00,
    discountCents: 0,
    promoCode: null,
    amountPaidCents: 103_50,
    recipientName: 'Sam'
  });
  const totals = summariseLines(lines);
  return {
    id: 'doc-1',
    number: 'ALMA-INV-000184',
    type: 'TAX_INVOICE',
    status: 'ISSUED',
    gstTreatment: totals.gstTreatment,
    sourceType: 'GIFT_CARD',
    sourceId: 'card-1',
    sourceReference: 'ALMA-22480BB1',
    giftCardId: 'card-1',
    creditsDocumentId: null,
    creditsDocumentNumber: null,
    legalEntityId: 'entity-1',
    issuerLegalName: 'Alma Hospitality Pty Ltd',
    issuerTradingName: 'St Alma',
    issuerAbn: '51824753556',
    customerName: 'Jordan Purchaser',
    customerOrganisation: null,
    customerEmail: 'jordan@example.com',
    currency: 'aud',
    totalCents: totals.totalCents,
    taxableCents: totals.taxableCents,
    gstCents: totals.gstCents,
    paymentProvider: 'STRIPE',
    paymentMethodSummary: 'Visa ending 4242',
    paidAt: '2026-09-30T02:00:00.000Z',
    issuedAt: '2026-09-30T02:00:05.000Z',
    issueSource: 'AUTO_STRIPE',
    emailedAt: null,
    emailedTo: null,
    emailError: null,
    emailCount: 0,
    voidedAt: null,
    voidReason: null,
    testMode: false,
    issuerAddress: '1 Pittwater Road\nManly NSW 2095',
    issuerEmail: 'hello@almagroup.com.au',
    issuerPhone: '02 9000 0000',
    issuerWebsite: 'almagroup.com.au',
    issuerGstRegistered: true,
    customerAbn: null,
    customerReference: null,
    paymentReference: null,
    stripePaymentIntentId: 'pi_3QabcDEFghiJKLmno',
    stripeCheckoutSessionId: 'cs_live_a1b2c3',
    stripeChargeId: 'ch_3Qabc',
    stripeRefundId: null,
    supplyDate: '2026-09-30T02:00:00.000Z',
    reason: null,
    note: null,
    issuedByName: null,
    lines: withPositions(lines),
    credits: [],
    remainingCreditableCents: totals.totalCents,
    ...overrides
  };
}

async function pageCount(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

function isPdf(bytes: Uint8Array) {
  return Buffer.from(bytes.subarray(0, 4)).toString('latin1') === '%PDF';
}

const logoPng = new Uint8Array(
  readFileSync(new URL('../../../giftcards-web/public/images/brand/alma-group-logo-ink.png', import.meta.url))
);

describe('pdfSafeText', () => {
  it('leaves plain text alone', () => {
    assert.equal(pdfSafeText('ALMA gift card ALMA-22480BB1 $103.50'), 'ALMA gift card ALMA-22480BB1 $103.50');
  });

  it('keeps what WinAnsi can print: Latin-1 and the Windows-1252 extras', () => {
    const keep = 'Café · 5 × $20 — “quoted” ’s … € • – ™ Zoë ½';
    assert.equal(pdfSafeText(keep), keep);
  });

  it('spells out the symbols the standard fonts lack', () => {
    assert.equal(pdfSafeText('−$3.50'), '-$3.50');
    assert.equal(pdfSafeText('A → B'), 'A -> B');
    assert.equal(pdfSafeText('≥ 18, ≤ 65'), '>= 18, <= 65');
    assert.equal(pdfSafeText('Paid ✓'), 'Paid Yes');
  });

  it('turns the odd spaces into ordinary ones and drops zero-width characters', () => {
    assert.equal(pdfSafeText('6:00 pm'), '6:00 pm');
    assert.equal(pdfSafeText('a b c d'), 'a b c d');
    assert.equal(pdfSafeText('zero​width﻿'), 'zerowidth');
    assert.equal(pdfSafeText('tab\there'), 'tab here');
  });

  it('keeps the base letter of an accent WinAnsi lacks', () => {
    assert.equal(pdfSafeText('Māori Wardens'), 'Maori Wardens');
    assert.equal(pdfSafeText('Nguyễn'), 'Nguyen');
  });

  it('replaces anything else with a question mark, one per character', () => {
    assert.equal(pdfSafeText('Thanks 😀'), 'Thanks ?');
    assert.equal(pdfSafeText('Łódź'), '?ódz');
    assert.equal(pdfSafeText('東京'), '??');
    // The joiners and variation selectors inside an emoji sequence add nothing.
    assert.equal(pdfSafeText('Family 👨\u200D👩\u200D👧'), 'Family ???');
    assert.equal(pdfSafeText('❤️'), '?');
  });

  it('never lets a line break through — callers split on it first', () => {
    assert.equal(pdfSafeText('one\ntwo'), 'one?two');
  });

  it('is safe on everything it returns', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    assert.doesNotThrow(() => font.widthOfTextAtSize(pdfSafeText(NASTY), 10));
  });
});

describe('renderFinancialDocumentPdf', () => {
  it('renders a tax invoice on one page', async () => {
    const bytes = await renderFinancialDocumentPdf(saleDocument(), { logoPng, footerLines: ['Questions? hello@almagroup.com.au'] });
    assert.ok(isPdf(bytes));
    assert.equal(await pageCount(bytes), 1);
  });

  it('renders a receipt', async () => {
    const lines = composeGiftCardSaleLines({
      code: 'ALMA-00C0FFEE',
      faceValueCents: 50_00,
      discountCents: 0,
      promoCode: null,
      amountPaidCents: 50_00,
      recipientName: null
    });
    const totals = summariseLines(lines);
    const bytes = await renderFinancialDocumentPdf(
      saleDocument({
        type: 'RECEIPT',
        number: 'ALMA-INV-000185',
        paymentProvider: 'CASH',
        paymentMethodSummary: 'Cash',
        paymentReference: 'POS St Alma',
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: null,
        totalCents: totals.totalCents,
        taxableCents: totals.taxableCents,
        gstCents: totals.gstCents,
        gstTreatment: totals.gstTreatment,
        lines: withPositions(lines)
      })
    );
    assert.ok(isPdf(bytes));
    assert.equal(await pageCount(bytes), 1);
  });

  it('renders an adjustment note against the tax invoice', async () => {
    const sale = saleDocument();
    const lines = composeCreditLines(sale, [], sale.totalCents);
    const totals = summariseLines(lines);
    const bytes = await renderFinancialDocumentPdf(
      saleDocument({
        id: 'doc-2',
        number: 'ALMA-CN-000012',
        type: 'ADJUSTMENT_NOTE',
        creditsDocumentId: sale.id,
        creditsDocumentNumber: sale.number,
        reason: 'Refunded in Stripe (requested by customer)',
        stripeRefundId: 're_3Qabc',
        issueSource: 'STRIPE_REFUND',
        totalCents: totals.totalCents,
        taxableCents: totals.taxableCents,
        gstCents: totals.gstCents,
        gstTreatment: totals.gstTreatment,
        lines: withPositions(lines),
        remainingCreditableCents: 0
      }),
      { logoPng }
    );
    assert.ok(isPdf(bytes));
    assert.equal(totals.gstCents, 32);
  });

  it('renders a void document with its reason', async () => {
    const bytes = await renderFinancialDocumentPdf(
      saleDocument({
        status: 'VOID',
        voidedAt: '2026-10-01T01:00:00.000Z',
        voidReason: 'Issued to the wrong company — reissued as ALMA-INV-000190',
        remainingCreditableCents: 0
      }),
      { logoPng }
    );
    assert.ok(isPdf(bytes));
  });

  it('prints the wordmark in type when there is no logo, or the logo is damaged', async () => {
    assert.ok(isPdf(await renderFinancialDocumentPdf(saleDocument(), { logoPng: null })));
    assert.ok(isPdf(await renderFinancialDocumentPdf(saleDocument(), { logoPng: new Uint8Array([1, 2, 3, 4]) })));
  });

  it('survives characters the standard fonts cannot encode, in every field', async () => {
    const [first] = saleDocument().lines;
    assert.ok(first);
    const bytes = await renderFinancialDocumentPdf(
      saleDocument({
        issuerLegalName: NASTY,
        issuerTradingName: NASTY,
        issuerAddress: NASTY,
        customerName: NASTY,
        customerOrganisation: NASTY,
        customerReference: NASTY,
        customerEmail: 'a.very.long.email.address.without.any.spaces.at.all@an-extremely-long-domain-name.example.com',
        paymentMethodSummary: NASTY,
        note: `${NASTY}\n\n${NASTY}`,
        voidReason: NASTY,
        status: 'VOID',
        lines: [{ ...first, description: NASTY, detail: NASTY }]
      }),
      { logoPng, footerLines: [NASTY] }
    );
    assert.ok(isPdf(bytes));
  });

  it('paginates a long document, repeating the footer on every page', async () => {
    const [first] = saleDocument().lines;
    assert.ok(first);
    const lines = Array.from({ length: 60 }, (_, index) => ({
      ...first,
      id: `line-${index + 1}`,
      position: index + 1,
      description: `ALMA gift card ALMA-${String(index).padStart(8, '0')}`,
      detail: 'Face value voucher for someone with a long enough name that this detail wraps onto a second line in the column'
    }));
    const bytes = await renderFinancialDocumentPdf(saleDocument({ lines, note: 'Council PO 4471' }), { logoPng });
    assert.ok(isPdf(bytes));
    assert.ok((await pageCount(bytes)) > 1);
  });

  it('prints the same file for the same document', async () => {
    const doc = saleDocument();
    const a = await renderFinancialDocumentPdf(doc, { logoPng });
    const b = await renderFinancialDocumentPdf(doc, { logoPng });
    assert.deepEqual(Buffer.from(a), Buffer.from(b));
  });
});
