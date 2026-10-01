import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FinancialDocumentError,
  composeCreditLines,
  composeGiftCardSaleLines,
  creditDocumentType,
  documentSeries,
  financialDocumentTitle,
  formatAbn,
  formatDocumentNumber,
  gstInclusiveComponentCents,
  isValidAbn,
  normaliseInvoiceSettings,
  remainingCreditable,
  saleDocumentType,
  summariseLines,
  legalEntityInputSchema,
  issueGiftCardDocumentInputSchema,
  centsToDollars,
  creditNoteInputSchema,
  issuedButNotEmailedDetails,
  maskedGiftCardReference
} from '@alma/shared';

const card = (overrides: Partial<Parameters<typeof composeGiftCardSaleLines>[0]> = {}) => ({
  code: 'ALMA-22480BB1',
  faceValueCents: 100_00,
  discountCents: 0,
  promoCode: null,
  amountPaidCents: 100_00,
  recipientName: null,
  ...overrides
});

describe('GST component of a GST-inclusive amount', () => {
  it('is one eleventh, to the nearest cent', () => {
    assert.equal(gstInclusiveComponentCents(110_00), 10_00);
    assert.equal(gstInclusiveComponentCents(350), 32); // 31.8
    assert.equal(gstInclusiveComponentCents(247), 22); // 22.45
    assert.equal(gstInclusiveComponentCents(0), 0);
  });

  it('rounds a negative amount the same way as a positive one', () => {
    assert.equal(gstInclusiveComponentCents(-350), -32);
  });
});

describe('gift card sale at face value (counter sale, no fee)', () => {
  const lines = composeGiftCardSaleLines(card());
  const totals = summariseLines(lines);

  it('is one face value voucher line with no GST', () => {
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.gstTreatment, 'FACE_VALUE_VOUCHER');
    assert.equal(lines[0]?.amountCents, 100_00);
    assert.equal(lines[0]?.gstCents, 0);
  });

  it('is a receipt, not a tax invoice — there is no GST to claim', () => {
    assert.equal(totals.gstCents, 0);
    assert.equal(totals.gstTreatment, 'FACE_VALUE_VOUCHER');
    assert.equal(saleDocumentType(totals, true), 'RECEIPT');
  });
});

describe('gift card bought online with the 3.5% service fee', () => {
  const lines = composeGiftCardSaleLines(card({ amountPaidCents: 103_50 }));
  const totals = summariseLines(lines);

  it('splits the voucher from the fee', () => {
    assert.deepEqual(
      lines.map((line) => [line.amountCents, line.gstTreatment]),
      [
        [100_00, 'FACE_VALUE_VOUCHER'],
        [350, 'STANDARD_TAXABLE']
      ]
    );
  });

  it('taxes exactly what was paid over face value (s100-5(2))', () => {
    assert.equal(totals.totalCents, 103_50);
    assert.equal(totals.taxableCents, 350);
    assert.equal(totals.gstCents, 32);
    assert.equal(totals.gstTreatment, 'MIXED');
  });

  it('is a tax invoice when the issuer is GST registered', () => {
    assert.equal(saleDocumentType(totals, true), 'TAX_INVOICE');
  });

  it('is only a receipt when the issuer is not registered', () => {
    assert.equal(saleDocumentType(totals, false), 'RECEIPT');
  });
});

describe('gift card bought with a promo code', () => {
  it('keeps the whole price within face value when the discount covers the fee', () => {
    // $100 card, $10 off, fee 3.5% of $90 = $3.15 → paid $93.15 < $100 face.
    const lines = composeGiftCardSaleLines(card({ discountCents: 10_00, promoCode: 'SPRING', amountPaidCents: 93_15 }));
    const totals = summariseLines(lines);
    assert.deepEqual(
      lines.map((line) => [line.description, line.amountCents, line.gstCents]),
      [
        ['ALMA gift card ending 0BB1', 100_00, 0],
        ['Promo code SPRING', -10_00, 0],
        ['Service fee — card processing', 315, 0]
      ]
    );
    assert.equal(lines[2]?.gstTreatment, 'FACE_VALUE_VOUCHER');
    assert.equal(totals.totalCents, 93_15);
    assert.equal(totals.gstCents, 0);
    assert.equal(saleDocumentType(totals, true), 'RECEIPT');
  });

  it('taxes only the part of the fee that pushes the price over face value', () => {
    // $100 card, $1 off, fee $3.47 → paid $102.47; $2.47 over face value.
    const lines = composeGiftCardSaleLines(card({ discountCents: 100, promoCode: 'P', amountPaidCents: 102_47 }));
    const fee = lines[2];
    assert.equal(fee?.amountCents, 347);
    assert.equal(fee?.taxableAmountCents, 247);
    assert.equal(fee?.gstCents, 22);
    assert.equal(fee?.gstTreatment, 'MIXED');
    assert.equal(summariseLines(lines).totalCents, 102_47);
  });
});

describe('gift card payments that cannot be documented', () => {
  it('refuses a card nothing was paid for (comp, donation, test)', () => {
    assert.throws(() => composeGiftCardSaleLines(card({ amountPaidCents: 0 })), FinancialDocumentError);
    assert.throws(() => composeGiftCardSaleLines(card({ amountPaidCents: null })), /Nothing was paid/);
  });

  it('refuses a payment smaller than the card price instead of inventing a discount', () => {
    assert.throws(() => composeGiftCardSaleLines(card({ amountPaidCents: 99_00 })), /less than the card's price/);
  });

  it('refuses a discount larger than the card', () => {
    assert.throws(() => composeGiftCardSaleLines(card({ discountCents: 200_00 })), /discount is larger/);
  });

  it('names the recipient on the voucher line when there is one', () => {
    const [line] = composeGiftCardSaleLines(card({ recipientName: 'Natasha' }));
    assert.equal(line?.detail, 'Face value voucher for Natasha');
  });
});

describe('credit notes', () => {
  const original = { totalCents: 103_50, taxableCents: 350, gstCents: 32 };

  it('reverses a full refund to the cent', () => {
    const lines = composeCreditLines(original, [], 103_50);
    const totals = summariseLines(lines);
    assert.equal(totals.totalCents, 103_50);
    assert.equal(totals.taxableCents, 350);
    assert.equal(totals.gstCents, 32);
  });

  it('splits a partial refund in proportion between taxable and non-taxable', () => {
    const lines = composeCreditLines(original, [], 50_00);
    const totals = summariseLines(lines);
    assert.equal(totals.totalCents, 50_00);
    assert.equal(totals.taxableCents, 169); // 5000 × 350 / 10350
    // GST on what is left (181c → 16c) decides it: 32c − 16c = 16c reversed now.
    assert.equal(totals.gstCents, 16);
  });

  it('has the last partial refund take exactly what is left, GST included', () => {
    const first = summariseLines(composeCreditLines(original, [], 50_00));
    const second = summariseLines(composeCreditLines(original, [first], 53_50));
    assert.equal(first.totalCents + second.totalCents, 103_50);
    assert.equal(first.taxableCents + second.taxableCents, 350);
    assert.equal(first.gstCents + second.gstCents, 32);
  });

  it('refuses to credit more than is left', () => {
    const first = summariseLines(composeCreditLines(original, [], 100_00));
    assert.throws(() => composeCreditLines(original, [first], 350 + 1), /Only \$3\.50 is left/);
    assert.deepEqual(remainingCreditable(original, [first]).totalCents, 350);
  });

  it('never strands a cent of GST on the last credit', () => {
    // 346c then 4c of taxable supply: one eleventh of each slice rounds to
    // 31c + 0c and would leave 1c of GST with no taxable amount to reverse.
    const first = summariseLines(composeCreditLines(original, [], 102_36));
    const second = summariseLines(composeCreditLines(original, [first], 100));
    const last = summariseLines(composeCreditLines(original, [first, second], 14));
    assert.equal(first.totalCents + second.totalCents + last.totalCents, 103_50);
    assert.equal(first.taxableCents + second.taxableCents + last.taxableCents, 350);
    assert.equal(first.gstCents + second.gstCents + last.gstCents, 32);
    assert.equal(remainingCreditable(original, [first, second, last]).gstCents, 0);
  });

  it('reverses exactly the original GST however a refund is sliced', () => {
    for (const slices of [[1, 103_49], [350, 100_00], [3_50, 50_00, 50_00], [17, 17, 17, 102_99], [99_99, 1, 3_50]]) {
      const prior: ReturnType<typeof summariseLines>[] = [];
      for (const slice of slices) prior.push(summariseLines(composeCreditLines(original, prior, slice)));
      assert.equal(prior.reduce((sum, credit) => sum + credit.gstCents, 0), 32, `slices ${slices.join('+')}`);
      assert.equal(prior.reduce((sum, credit) => sum + credit.taxableCents, 0), 350, `slices ${slices.join('+')}`);
    }
  });

  it('refuses a zero or negative credit', () => {
    assert.throws(() => composeCreditLines(original, [], 0), /more than zero/);
  });

  it('credits a GST-free receipt with no GST at all', () => {
    const lines = composeCreditLines({ totalCents: 100_00, taxableCents: 0, gstCents: 0 }, [], 40_00);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.gstTreatment, 'FACE_VALUE_VOUCHER');
    assert.equal(lines[0]?.gstCents, 0);
  });

  it('is an adjustment note against a tax invoice and a credit note against a receipt', () => {
    assert.equal(creditDocumentType('TAX_INVOICE'), 'ADJUSTMENT_NOTE');
    assert.equal(creditDocumentType('RECEIPT'), 'CREDIT_NOTE');
  });
});

describe('document titles and numbers', () => {
  it('says what the document is', () => {
    assert.equal(financialDocumentTitle('TAX_INVOICE'), 'Tax invoice / Receipt');
    assert.equal(financialDocumentTitle('RECEIPT'), 'Receipt');
    assert.equal(financialDocumentTitle('ADJUSTMENT_NOTE'), 'Adjustment note / Credit note');
  });

  it('numbers sale documents and credit notes in separate series', () => {
    assert.equal(documentSeries('ALMA', 'RECEIPT'), 'ALMA-INV');
    assert.equal(documentSeries('ALMA', 'TAX_INVOICE'), 'ALMA-INV');
    assert.equal(documentSeries('ALMA', 'CREDIT_NOTE'), 'ALMA-CN');
    assert.equal(documentSeries('TCC', 'ADJUSTMENT_NOTE'), 'TCC-CN');
    assert.equal(formatDocumentNumber('ALMA-INV', 184), 'ALMA-INV-000184');
    assert.equal(formatDocumentNumber('ALMA-INV', 1_234_567), 'ALMA-INV-1234567');
  });
});

describe('ABN', () => {
  it('accepts a real ABN in any spacing', () => {
    assert.ok(isValidAbn('51 824 753 556'));
    assert.ok(isValidAbn('51824753556'));
    assert.equal(formatAbn('51824753556'), '51 824 753 556');
  });

  it('rejects a mistyped or short ABN', () => {
    assert.equal(isValidAbn('51 824 753 557'), false);
    assert.equal(isValidAbn('1234'), false);
    assert.equal(isValidAbn(''), false);
  });

  it('is checked when a company is saved', () => {
    const bad = legalEntityInputSchema.safeParse({ code: 'TCC', legalName: 'Two Cooked Chooks Pty Ltd', abn: '51 824 753 557' });
    assert.equal(bad.success, false);
    const good = legalEntityInputSchema.parse({ code: 'TCC', legalName: 'Two Cooked Chooks Pty Ltd', abn: '51 824 753 556' });
    assert.equal(good.documentPrefix, 'ALMA');
    assert.equal(good.gstRegistered, true);
  });

  it('allows a blank buyer ABN but not a wrong one', () => {
    assert.equal(issueGiftCardDocumentInputSchema.safeParse({ customerAbn: '' }).success, true);
    assert.equal(issueGiftCardDocumentInputSchema.safeParse({ customerAbn: '12 345 678 901' }).success, false);
  });
});

describe('manual credit notes', () => {
  it('needs the Stripe refund id when the money went back through Stripe', () => {
    const base = { amountCents: 50_00, reason: 'Refunded in Stripe' };
    assert.equal(creditNoteInputSchema.safeParse({ ...base, refundMethod: 'STRIPE' }).success, false);
    assert.equal(creditNoteInputSchema.safeParse({ ...base, refundMethod: 'STRIPE', stripeRefundId: 'ch_123' }).success, false);
    assert.equal(creditNoteInputSchema.safeParse({ ...base, refundMethod: 'STRIPE', stripeRefundId: 're_3Pq9xYz' }).success, true);
    assert.equal(creditNoteInputSchema.safeParse({ ...base, refundMethod: 'CASH' }).success, true);
  });
});

describe('gift cards on documents', () => {
  it('shows only the last four characters of the code', () => {
    assert.equal(maskedGiftCardReference('ALMA-22480BB1'), 'ending 0BB1');
    const [line] = composeGiftCardSaleLines(card());
    assert.ok(!line?.description.includes('ALMA-22480BB1'));
  });
});

describe('invoice settings', () => {
  it('defaults to nothing issued until a company is chosen', () => {
    const settings = normaliseInvoiceSettings({});
    assert.equal(settings.giftCardIssuingEntityId, null);
    assert.equal(settings.autoIssueGiftCards, false);
    assert.equal(settings.autoEmail, true);
    assert.equal(settings.autoIssueFrom, null);
  });

  it('survives junk in the stored blob', () => {
    const settings = normaliseInvoiceSettings({ autoIssueGiftCards: 'yes', autoIssueFrom: 'not a date', giftCardIssuingEntityId: '  ' });
    assert.equal(settings.autoIssueGiftCards, false);
    assert.equal(settings.autoIssueFrom, null);
    assert.equal(settings.giftCardIssuingEntityId, null);
  });
});

describe('money on documents', () => {
  it('always shows cents and groups thousands', () => {
    assert.equal(centsToDollars(100_00), '$100.00');
    assert.equal(centsToDollars(103_50), '$103.50');
    assert.equal(centsToDollars(1_234_567_89), '$1,234,567.89');
    assert.equal(centsToDollars(-5), '-$0.05');
  });
});

describe('telling "issued but the email failed" from a real failure', () => {
  it('reads the explicit marker the API sends when the document exists', () => {
    assert.deepEqual(
      issuedButNotEmailedDetails({ issued: true, documentId: 'doc_1', documentNumber: 'ALMA-CN-000003' }),
      { issued: true, documentId: 'doc_1', documentNumber: 'ALMA-CN-000003' }
    );
  });

  it('never reads a bare 502 — a proxy, a load balancer or a Stripe outage — as issued', () => {
    for (const details of [undefined, null, {}, 'Bad Gateway', { message: 'upstream' }, { issued: 'true', documentId: 'x', documentNumber: 'y' }, { issued: true }, { issued: true, documentId: '', documentNumber: 'ALMA-CN-1' }]) {
      assert.equal(issuedButNotEmailedDetails(details), null);
    }
  });
});

describe('retrying a credit note', () => {
  it('carries one request id per submission', () => {
    const base = { amountCents: 10_00, reason: 'Partial refund', refundMethod: 'CASH' };
    assert.equal(creditNoteInputSchema.safeParse({ ...base, clientRequestId: '9b2f6c3e-8a41-4f0e-9d6b-1c2a3b4c5d6e' }).success, true);
    assert.equal(creditNoteInputSchema.safeParse({ ...base, clientRequestId: 'not-a-uuid' }).success, false);
    assert.equal(creditNoteInputSchema.safeParse(base).success, true);
  });
});
