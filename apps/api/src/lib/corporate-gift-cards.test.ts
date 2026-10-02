import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CORPORATE_MAX_DISCOUNT_BPS,
  DEFAULT_CORPORATE_GIFT_CARD_SETTINGS,
  normaliseCorporateGiftCardSettings,
  normaliseGiftCardSettings,
  quoteCorporateOrder,
  splitDiscountAcrossCards,
  type CorporateGiftCardSettings
} from '@alma/shared';
import {
  cancelBlockedReason,
  corporateOrderReference,
  csvCell,
  drainEligible,
  giftCardEmailRecipients,
  issueBlockedReason,
  parseCsv,
  parseScheduledDeliveryAt,
  paymentBlockedReason,
  reassignBlockedReason,
  recipientRowKey,
  refuseInvoicePath,
  toCsv,
  validateRecipientCsv
} from './corporate-gift-cards.js';

const now = new Date('2026-10-03T00:00:00.000Z');

const tiers: CorporateGiftCardSettings = {
  minimumQuantity: 10,
  tiers: [
    { minQuantity: 10, discountBps: 250 },
    { minQuantity: 25, discountBps: 500 },
    { minQuantity: 50, discountBps: 750 },
    { minQuantity: 100, discountBps: 1000 }
  ]
};

describe('corporate pricing tiers', () => {
  it('ships with no discount configured — nothing is hardcoded', () => {
    assert.deepEqual(DEFAULT_CORPORATE_GIFT_CARD_SETTINGS.tiers, []);
    const quote = quoteCorporateOrder({ quantity: 100, faceValueCents: 10000, settings: DEFAULT_CORPORATE_GIFT_CARD_SETTINGS, account: null });
    assert.equal(quote.discountSource, 'NONE');
    assert.equal(quote.discountCents, 0);
    assert.equal(quote.amountDueCents, 1_000_000);
  });

  it('applies the highest tier the order quantity reaches, per order', () => {
    const quote = quoteCorporateOrder({ quantity: 50, faceValueCents: 10000, settings: tiers, account: null });
    assert.equal(quote.discountSource, 'GLOBAL_TIER');
    assert.equal(quote.discountBps, 750);
    assert.equal(quote.faceValueTotalCents, 500_000);
    assert.equal(quote.discountCents, 37_500);
    assert.equal(quote.amountDueCents, 462_500);
    assert.equal(quote.snapshot.basis, 'PER_ORDER_QUANTITY');
  });

  it('a quantity just under a threshold gets the tier below it', () => {
    assert.equal(quoteCorporateOrder({ quantity: 49, faceValueCents: 10000, settings: tiers, account: null }).discountBps, 500);
    assert.equal(quoteCorporateOrder({ quantity: 9, faceValueCents: 10000, settings: tiers, account: null }).discountBps, 0);
  });

  it('an account override replaces the tiers entirely, up or down', () => {
    const up = quoteCorporateOrder({ quantity: 10, faceValueCents: 10000, settings: tiers, account: { discountOverrideBps: 750, minimumQuantityOverride: null } });
    assert.equal(up.discountSource, 'ACCOUNT_OVERRIDE');
    assert.equal(up.discountBps, 750);
    const down = quoteCorporateOrder({ quantity: 100, faceValueCents: 10000, settings: tiers, account: { discountOverrideBps: 100, minimumQuantityOverride: null } });
    assert.equal(down.discountBps, 100);
    assert.equal(down.discountSource, 'ACCOUNT_OVERRIDE');
  });

  it('an explicit zero override means no discount, and says so', () => {
    const quote = quoteCorporateOrder({ quantity: 100, faceValueCents: 10000, settings: tiers, account: { discountOverrideBps: 0, minimumQuantityOverride: null } });
    assert.equal(quote.discountBps, 0);
    assert.equal(quote.discountSource, 'NONE');
  });

  it('the account minimum overrides the global minimum in the quote', () => {
    const quote = quoteCorporateOrder({ quantity: 5, faceValueCents: 5000, settings: tiers, account: { discountOverrideBps: null, minimumQuantityOverride: 5 } });
    assert.equal(quote.minimumQuantity, 5);
    assert.equal(quote.snapshot.minimumQuantity, 10);
    assert.equal(quote.snapshot.accountMinimumQuantityOverride, 5);
  });

  it('never alters face value: discount comes off what is owed, not the card', () => {
    const quote = quoteCorporateOrder({ quantity: 100, faceValueCents: 10000, settings: tiers, account: null });
    assert.equal(quote.faceValueCents, 10000);
    assert.equal(quote.faceValueTotalCents, 1_000_000);
    assert.equal(quote.amountDueCents + quote.discountCents, quote.faceValueTotalCents);
  });

  it('caps any configured discount at the hard ceiling', () => {
    const quote = quoteCorporateOrder({ quantity: 100, faceValueCents: 10000, settings: tiers, account: { discountOverrideBps: 9999, minimumQuantityOverride: null } });
    assert.equal(quote.discountBps, CORPORATE_MAX_DISCOUNT_BPS);
  });

  it('snapshots the terms in force so a later settings change cannot rewrite history', () => {
    const quote = quoteCorporateOrder({ quantity: 25, faceValueCents: 10000, settings: tiers, account: null });
    const frozen = JSON.parse(JSON.stringify(quote.snapshot));
    tiers.tiers[1]!.discountBps = 9000; // somebody edits the settings afterwards
    assert.equal(frozen.appliedBps, 500);
    assert.deepEqual(frozen.tiers[1], { minQuantity: 25, discountBps: 500 });
    tiers.tiers[1]!.discountBps = 500;
  });

  it('normalises tiers: sorted, deduplicated by threshold, defaults filled', () => {
    const settings = normaliseCorporateGiftCardSettings({ tiers: [{ minQuantity: 50, discountBps: 700 }, { minQuantity: 10, discountBps: 200 }, { minQuantity: 50, discountBps: 750 }] });
    assert.equal(settings.minimumQuantity, 10);
    assert.deepEqual(settings.tiers, [{ minQuantity: 10, discountBps: 200 }, { minQuantity: 50, discountBps: 750 }]);
  });

  it('rides inside the existing gift card settings object with safe defaults', () => {
    const settings = normaliseGiftCardSettings({ publicHeadline: 'Hello there' });
    assert.deepEqual(settings.corporate, DEFAULT_CORPORATE_GIFT_CARD_SETTINGS);
    const withTiers = normaliseGiftCardSettings({ corporate: { minimumQuantity: 20, tiers: [{ minQuantity: 20, discountBps: 300 }] } });
    assert.equal(withTiers.corporate.minimumQuantity, 20);
    assert.equal(withTiers.publicHeadline, 'Gift a good table.');
  });
});

describe('splitting the discount across cards', () => {
  it('sums back to the order discount exactly, in whole cents', () => {
    for (const [discount, quantity] of [[37_500, 50], [1, 3], [100, 7], [0, 10], [12_345, 100]] as const) {
      const shares = splitDiscountAcrossCards(discount, quantity);
      assert.equal(shares.length, quantity);
      assert.equal(shares.reduce((sum, share) => sum + share, 0), discount);
      assert.ok(Math.max(...shares) - Math.min(...shares) <= 1, 'shares differ by at most one cent');
      assert.ok(shares.every((share) => Number.isInteger(share) && share >= 0));
    }
  });

  it('is empty for an empty order', () => {
    assert.deepEqual(splitDiscountAcrossCards(100, 0), []);
  });
});

describe('order lifecycle', () => {
  const awaiting = { status: 'AWAITING_PAYMENT', paymentStatus: 'AWAITING_PAYMENT', paymentMethod: 'STRIPE' } as const;
  const paid = { status: 'AWAITING_PAYMENT', paymentStatus: 'PAID', paymentMethod: 'MANUAL_OFFLINE' } as const;
  const issued = { status: 'ISSUED', paymentStatus: 'PAID', paymentMethod: 'STRIPE' } as const;
  const cancelled = { status: 'CANCELLED', paymentStatus: 'CANCELLED', paymentMethod: 'STRIPE' } as const;

  it('payment is recorded once, never on an issued or cancelled order', () => {
    assert.equal(paymentBlockedReason(awaiting), null);
    assert.ok(paymentBlockedReason(paid));
    assert.ok(paymentBlockedReason(issued));
    assert.ok(paymentBlockedReason(cancelled));
  });

  it('cards are issued only after payment, and only once', () => {
    assert.ok(issueBlockedReason(awaiting));
    assert.equal(issueBlockedReason(paid), null);
    assert.ok(issueBlockedReason(issued));
    assert.ok(issueBlockedReason(cancelled));
  });

  it('an order is cancellable only before its cards exist', () => {
    assert.equal(cancelBlockedReason(awaiting), null);
    assert.equal(cancelBlockedReason(paid), null);
    assert.ok(cancelBlockedReason(issued));
    assert.ok(cancelBlockedReason(cancelled));
  });

  it('invoice / PO purchasing is refused at the boundary', () => {
    assert.equal(refuseInvoicePath('STRIPE'), null);
    assert.equal(refuseInvoicePath('MANUAL_OFFLINE'), null);
    assert.match(refuseInvoicePath('INVOICE') ?? '', /not switched on/);
  });

  it('formats the human reference', () => {
    assert.equal(corporateOrderReference(7), 'CG-0007');
    assert.equal(corporateOrderReference(12345), 'CG-12345');
  });
});

describe('pool cards and email', () => {
  const base = { purchaserEmail: 'accounts@company.example', recipientEmail: 'sarah@example.com', emailedAt: null };

  it('an unallocated pool card is emailed to nobody, whatever addresses it holds', () => {
    assert.deepEqual(giftCardEmailRecipients({ ...base, corporateOrderId: 'o1', allocationStatus: 'UNALLOCATED' }), []);
    assert.deepEqual(giftCardEmailRecipients({ ...base, corporateOrderId: 'o1', allocationStatus: null }), []);
  });

  it('an allocated corporate card goes to the recipient only, never the company contact', () => {
    assert.deepEqual(giftCardEmailRecipients({ ...base, corporateOrderId: 'o1', allocationStatus: 'ALLOCATED' }), ['sarah@example.com']);
    assert.deepEqual(giftCardEmailRecipients({ ...base, corporateOrderId: 'o1', allocationStatus: 'ALLOCATED', recipientEmail: null }), []);
  });

  it('a consumer card keeps the existing purchaser + recipient rule', () => {
    assert.deepEqual(giftCardEmailRecipients({ ...base, corporateOrderId: null, allocationStatus: null }), ['accounts@company.example', 'sarah@example.com']);
    assert.deepEqual(giftCardEmailRecipients({ ...base, corporateOrderId: null, allocationStatus: null, recipientEmail: 'accounts@company.example' }), ['accounts@company.example']);
  });

  it('the drain never picks up an unallocated card, even one with a past schedule', () => {
    const due = new Date('2026-10-02T00:00:00.000Z');
    assert.equal(drainEligible({ status: 'ACTIVE', emailedAt: null, scheduledDeliveryAt: due, corporateOrderId: 'o1', allocationStatus: 'UNALLOCATED' }, now), false);
    assert.equal(drainEligible({ status: 'ACTIVE', emailedAt: null, scheduledDeliveryAt: due, corporateOrderId: 'o1', allocationStatus: 'ALLOCATED' }, now), true);
    assert.equal(drainEligible({ status: 'ACTIVE', emailedAt: null, scheduledDeliveryAt: due, corporateOrderId: null, allocationStatus: null }, now), true);
  });

  it('the drain waits for a future schedule and skips sent, unscheduled or dead cards', () => {
    const future = new Date('2026-10-04T00:00:00.000Z');
    const past = new Date('2026-10-02T00:00:00.000Z');
    assert.equal(drainEligible({ status: 'ACTIVE', emailedAt: null, scheduledDeliveryAt: future, corporateOrderId: 'o1', allocationStatus: 'ALLOCATED' }, now), false);
    assert.equal(drainEligible({ status: 'ACTIVE', emailedAt: past, scheduledDeliveryAt: past, corporateOrderId: 'o1', allocationStatus: 'ALLOCATED' }, now), false);
    assert.equal(drainEligible({ status: 'ACTIVE', emailedAt: null, scheduledDeliveryAt: null, corporateOrderId: 'o1', allocationStatus: 'ALLOCATED' }, now), false);
    assert.equal(drainEligible({ status: 'CANCELLED', emailedAt: null, scheduledDeliveryAt: past, corporateOrderId: 'o1', allocationStatus: 'ALLOCATED' }, now), false);
  });

  it('re-addressing is allowed until the voucher has gone out', () => {
    assert.equal(reassignBlockedReason({ corporateOrderId: 'o1', allocationStatus: 'ALLOCATED', status: 'ACTIVE', emailedAt: null }), null);
    assert.match(reassignBlockedReason({ corporateOrderId: 'o1', allocationStatus: 'ALLOCATED', status: 'ACTIVE', emailedAt: now }) ?? '', /already been emailed/);
    assert.match(reassignBlockedReason({ corporateOrderId: 'o1', allocationStatus: 'UNALLOCATED', status: 'ACTIVE', emailedAt: null }) ?? '', /not been allocated/);
    assert.match(reassignBlockedReason({ corporateOrderId: null, allocationStatus: null, status: 'ACTIVE', emailedAt: null }) ?? '', /not a corporate/);
    assert.match(reassignBlockedReason({ corporateOrderId: 'o1', allocationStatus: 'ALLOCATED', status: 'CANCELLED', emailedAt: null }) ?? '', /cancelled/);
  });
});

describe('scheduled delivery parsing', () => {
  it('empty and past mean send now', () => {
    assert.deepEqual(parseScheduledDeliveryAt('', now), { ok: true, value: null });
    assert.deepEqual(parseScheduledDeliveryAt('2026-01-01T00:00:00Z', now), { ok: true, value: null });
  });
  it('a future date within a year is kept; beyond a year is refused; garbage is refused', () => {
    const soon = parseScheduledDeliveryAt('2026-11-01T09:00:00+11:00', now);
    assert.ok(soon.ok && soon.value instanceof Date);
    assert.equal(parseScheduledDeliveryAt('2028-01-01T00:00:00Z', now).ok, false);
    assert.equal(parseScheduledDeliveryAt('next tuesday', now).ok, false);
  });
});

describe('CSV parsing', () => {
  it('handles quotes, embedded commas and line breaks, CRLF and a BOM', () => {
    const text = '﻿a,b,c\r\n1,"two, with comma","three\nlines"\r\n"he said ""hi""",,\n';
    assert.deepEqual(parseCsv(text), [
      ['a', 'b', 'c'],
      ['1', 'two, with comma', 'three\nlines'],
      ['he said "hi"', '', '']
    ]);
  });
  it('drops blank lines', () => {
    assert.deepEqual(parseCsv('a,b\n\n1,2\n   \n'), [['a', 'b'], ['1', '2']]);
  });
  it('round-trips through the writer', () => {
    const csv = toCsv(['code', 'name'], [['ALMA-1', 'Sarah, "S"'], ['ALMA-2', 'plain']]);
    assert.deepEqual(parseCsv(csv), [['code', 'name'], ['ALMA-1', 'Sarah, "S"'], ['ALMA-2', 'plain']]);
    assert.equal(csvCell('x'), 'x');
    assert.equal(csvCell(null), '');
  });
});

describe('recipient CSV validation', () => {
  const header = 'firstName,lastName,email,message,scheduledDeliveryAt,reference';

  it('accepts the template and derives one stable key per row', () => {
    const { rows, errors } = validateRecipientCsv(`${header}\nSarah,Matthews,sarah@example.com,"Enjoy dinner on us.",2026-11-01T09:00:00+11:00,12 Ocean St\nTom,Reed,tom@example.com,,,\n`, now);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.recipientName, 'Sarah Matthews');
    assert.equal(rows[0]!.recipientEmail, 'sarah@example.com');
    assert.equal(rows[0]!.message, 'Enjoy dinner on us.');
    assert.ok(rows[0]!.scheduledDeliveryAt instanceof Date);
    assert.equal(rows[0]!.reference, '12 Ocean St');
    assert.equal(rows[1]!.scheduledDeliveryAt, null);
    assert.equal(rows[1]!.message, null);
    assert.match(rows[0]!.allocationKey, /^csv:[0-9a-f]{32}$/);
    assert.notEqual(rows[0]!.allocationKey, rows[1]!.allocationKey);
  });

  it('the same file produces the same keys — the basis of retry idempotency', () => {
    const file = `${header}\nSarah,Matthews,SARAH@example.com,,,\n`;
    const first = validateRecipientCsv(file, now).rows[0]!.allocationKey;
    const second = validateRecipientCsv(file, new Date(now.getTime() + 60_000)).rows[0]!.allocationKey;
    assert.equal(first, second);
    assert.equal(first, recipientRowKey({ recipientName: 'Sarah Matthews', recipientEmail: 'sarah@example.com', message: null, scheduledDeliveryAt: null, reference: null }));
  });

  it('two identical rows are two cards, with distinct keys', () => {
    const { rows, errors } = validateRecipientCsv(`${header}\nA,B,a@example.com,,,\nA,B,a@example.com,,,\n`, now);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]!.allocationKey, rows[1]!.allocationKey);
    assert.ok(rows[1]!.allocationKey.endsWith('#2'));
  });

  it('reports every row-level problem at once and allocates nothing', () => {
    const { rows, errors } = validateRecipientCsv(`${header}\n,,not-an-email,,,\nTom,Reed,tom@example.com,,2030-01-01T00:00:00Z,\nJo,Bloggs,jo@example.com,,,\n`, now);
    assert.deepEqual(rows, []);
    assert.deepEqual(
      errors.map((error) => [error.row, error.field]),
      [[1, 'firstName'], [1, 'email'], [2, 'scheduledDeliveryAt']]
    );
  });

  it('accepts friendly header spellings and a single name column', () => {
    const { rows, errors } = validateRecipientCsv('Name,Email Address,Delivery Date\nSarah Matthews,sarah@example.com,\n', now);
    assert.deepEqual(errors, []);
    assert.equal(rows[0]!.recipientName, 'Sarah Matthews');
  });

  it('refuses a file with no email column, an empty file, and a header-only file', () => {
    assert.equal(validateRecipientCsv('firstName,lastName\nA,B\n', now).errors[0]!.field, 'email');
    assert.equal(validateRecipientCsv('', now).errors[0]!.message, 'The file is empty.');
    assert.match(validateRecipientCsv(`${header}\n`, now).errors[0]!.message, /no recipients/);
  });
});
