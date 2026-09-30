import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import {
  composeCreditLines,
  composeGiftCardSaleLines,
  summariseLines,
  type FinancialDocumentDetail,
  type FinancialDocumentLineDraft
} from '@alma/shared';
import { feeNote, maskGiftCardCodes, pdfSafeText, renderFinancialDocumentPdf } from './financial-document-pdf.js';

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

/**
 * Every string drawn on the document, in drawing order. pdf-lib writes each
 * drawText as one hex string shown with Tj in a compressed content stream;
 * the standard fonts encode WinAnsi, which latin1 reads back closely enough
 * for the ASCII these tests look for. Wrapped text comes back one line per
 * entry, so join with spaces to look for a sentence.
 */
async function drawnText(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const drawn: string[] = [];
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
      for (const match of operators.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        drawn.push(Buffer.from(match[1] ?? '', 'hex').toString('latin1'));
      }
    }
  }
  return drawn;
}

// $100 card, $2 promo, paid $98 + 3.5% = $101.43: the fee is $3.43, but only
// the $1.43 that takes the total above face value is taxable.
function partlyTaxableSale(): FinancialDocumentDetail {
  const lines = composeGiftCardSaleLines({
    code: 'ALMA-22480BB1',
    faceValueCents: 100_00,
    discountCents: 2_00,
    promoCode: 'SPRING',
    amountPaidCents: 101_43,
    recipientName: null
  });
  const totals = summariseLines(lines);
  return saleDocument({
    totalCents: totals.totalCents,
    taxableCents: totals.taxableCents,
    gstCents: totals.gstCents,
    gstTreatment: totals.gstTreatment,
    lines: withPositions(lines)
  });
}

const WHOLE_FEE_NOTE = "The service fee is the amount paid above the card's face value, which is a taxable supply (s100-5(2) GST Act).";
const PART_FEE_NOTE = "The part of the service fee paid above the card's face value ($1.43) is a taxable supply (s100-5(2) GST Act).";

const logoPng = new Uint8Array(
  readFileSync(new URL('../../../giftcards-web/public/images/brand/alma-group-logo-ink.png', import.meta.url))
);

describe('pdfSafeText', () => {
  it('leaves plain text alone', () => {
    assert.equal(pdfSafeText('ALMA gift card ending 0BB1 $103.50'), 'ALMA gift card ending 0BB1 $103.50');
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

describe('maskGiftCardCodes', () => {
  it('cuts a whole card code in line text down to its last four', () => {
    assert.equal(maskGiftCardCodes('ALMA gift card ALMA-22480BB1'), 'ALMA gift card ending 0BB1');
    assert.equal(maskGiftCardCodes('Replaces ALMA-00C0FFEE and ALMA-22480BB1'), 'Replaces ending FFEE and ending 0BB1');
  });

  it('leaves document numbers, already masked text and other words alone', () => {
    assert.equal(maskGiftCardCodes('Credits ALMA-INV-000184'), 'Credits ALMA-INV-000184');
    assert.equal(maskGiftCardCodes('ALMA-CN-000012'), 'ALMA-CN-000012');
    assert.equal(maskGiftCardCodes('ALMA gift card ending 0BB1'), 'ALMA gift card ending 0BB1');
    assert.equal(maskGiftCardCodes('Face value voucher for ALMA staff'), 'Face value voucher for ALMA staff');
  });
});

describe('feeNote', () => {
  it('calls the whole fee taxable when all of it was paid above face value', () => {
    assert.equal(feeNote(saleDocument()), WHOLE_FEE_NOTE);
  });

  it('names the taxable part when a promo leaves only some of the fee above face value', () => {
    const doc = partlyTaxableSale();
    const fee = doc.lines.find((line) => line.taxableAmountCents > 0);
    assert.equal(fee?.amountCents, 3_43);
    assert.equal(fee?.taxableAmountCents, 1_43);
    assert.equal(feeNote(doc), PART_FEE_NOTE);
  });

  it('says nothing on a receipt with nothing taxable, or on a credit note', () => {
    const lines = composeGiftCardSaleLines({
      code: 'ALMA-00C0FFEE',
      faceValueCents: 50_00,
      discountCents: 0,
      promoCode: null,
      amountPaidCents: 50_00,
      recipientName: null
    });
    assert.equal(feeNote(saleDocument({ type: 'RECEIPT', lines: withPositions(lines) })), null);
    const sale = saleDocument();
    const credit = composeCreditLines(sale, [], sale.totalCents);
    assert.equal(feeNote(saleDocument({ type: 'ADJUSTMENT_NOTE', lines: withPositions(credit) })), null);
  });
});

describe('renderFinancialDocumentPdf', () => {
  it('names the gift card by its last four, never the whole code', async () => {
    const text = (await drawnText(await renderFinancialDocumentPdf(saleDocument(), { logoPng }))).join('\n');
    assert.ok(text.includes('Gift card ending 0BB1'), 'the For row names the card');
    assert.ok(text.includes('ALMA gift card ending 0BB1'), 'the card line names the card');
    assert.ok(!text.includes('22480BB1'), 'the full code is nowhere on the page');
  });

  it('masks the full code on a line stored before lines were masked', async () => {
    const doc = saleDocument();
    const [card, ...rest] = doc.lines;
    assert.ok(card);
    const legacy = { ...card, description: 'ALMA gift card ALMA-22480BB1', detail: 'Face value voucher (was ALMA-22480BB1)' };
    const text = (await drawnText(await renderFinancialDocumentPdf({ ...doc, lines: [legacy, ...rest] }))).join('\n');
    assert.ok(text.includes('ALMA gift card ending 0BB1'));
    assert.ok(text.includes('Face value voucher (was ending 0BB1)'));
    assert.ok(!text.includes('22480BB1'));
  });

  it('prints the fee note that matches how much of the fee is taxable', async () => {
    const whole = (await drawnText(await renderFinancialDocumentPdf(saleDocument()))).join(' ');
    assert.ok(whole.includes(WHOLE_FEE_NOTE));
    const part = (await drawnText(await renderFinancialDocumentPdf(partlyTaxableSale()))).join(' ');
    assert.ok(part.includes(PART_FEE_NOTE));
    assert.ok(!part.includes(WHOLE_FEE_NOTE));
  });

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
