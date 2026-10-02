// Corporate gift cards — the pure part. No Prisma, no Stripe, no mail: every
// rule a bulk order or a pool card obeys is a function of its inputs here, so
// the service stays thin and the tests (corporate-gift-cards.test.ts) can
// exercise every branch without a database.

import { createHash } from 'node:crypto';
import {
  CORPORATE_RECIPIENT_CSV_COLUMNS,
  type CorporateCsvRowError,
  type CorporateOrderStatus,
  type CorporatePaymentMethod,
  type CorporatePaymentStatus,
  type CorporateRecipientCsvColumn
} from '@alma/shared';

/* ------------------------------------------------------------------ */
/* Order lifecycle                                                    */
/* ------------------------------------------------------------------ */

export type CorporateOrderState = {
  status: CorporateOrderStatus;
  paymentStatus: CorporatePaymentStatus;
  paymentMethod: CorporatePaymentMethod;
};

/**
 * Why an order cannot take a payment right now, or null when it can.
 * Payment is recorded exactly once; an ISSUED or CANCELLED order never
 * accepts money, and INVOICE orders cannot exist yet (see refuseInvoicePath).
 */
export function paymentBlockedReason(order: CorporateOrderState): string | null {
  if (order.status === 'CANCELLED') return 'This order was cancelled.';
  if (order.paymentStatus === 'PAID' || order.status === 'ISSUED') return 'This order has already been paid and its cards issued.';
  return null;
}

/** Issuing is allowed exactly when the order is paid and not yet issued. */
export function issueBlockedReason(order: CorporateOrderState): string | null {
  if (order.status === 'CANCELLED') return 'This order was cancelled.';
  if (order.status === 'ISSUED') return 'Cards have already been issued for this order.';
  if (order.paymentStatus !== 'PAID') return 'Cards are issued once the payment is confirmed.';
  return null;
}

/**
 * An order can be cancelled only before its cards exist. After issuance the
 * cards are real liability with real codes; each is cancelled individually
 * through the ordinary gift-card cancel, which records a reason per card.
 */
export function cancelBlockedReason(order: CorporateOrderState): string | null {
  if (order.status === 'CANCELLED') return 'This order is already cancelled.';
  if (order.status === 'ISSUED') return 'Cards have been issued. Cancel individual cards instead, so each cancellation carries its own reason.';
  return null;
}

/**
 * Invoice / purchase-order purchasing is deliberately switched off. The
 * issuing entity, the GST treatment of a face-value voucher and any credit
 * terms are open decisions; until they are made no order is created on
 * credit. This is the single boundary that keeps it off.
 */
export const INVOICE_PATH_DISABLED_MESSAGE =
  'Invoice / purchase-order purchasing is not switched on yet. Take payment by card (Stripe) or record an offline payment once the money has arrived.';

export function refuseInvoicePath(method: CorporatePaymentMethod): string | null {
  return method === 'INVOICE' ? INVOICE_PATH_DISABLED_MESSAGE : null;
}

/* ------------------------------------------------------------------ */
/* Pool cards                                                         */
/* ------------------------------------------------------------------ */

export type PoolCardLike = {
  corporateOrderId: string | null;
  allocationStatus: 'UNALLOCATED' | 'ALLOCATED' | null;
  recipientEmail: string | null;
  purchaserEmail: string;
  emailedAt: Date | string | null;
};

export function isCorporateCard(card: Pick<PoolCardLike, 'corporateOrderId'>): boolean {
  return Boolean(card.corporateOrderId);
}

export function isUnallocatedPoolCard(card: Pick<PoolCardLike, 'corporateOrderId' | 'allocationStatus'>): boolean {
  return Boolean(card.corporateOrderId) && card.allocationStatus === 'UNALLOCATED';
}

/**
 * Who the voucher email goes to.
 *
 * A consumer card goes to the purchaser and the recipient (the purchaser
 * bought it and wants a copy). A corporate card's "purchaser" is the company's
 * contact, who bought a hundred of them — mailing them a hundred vouchers is
 * wrong, and mailing anyone an UNALLOCATED card leaks pool inventory to a
 * person who was never meant to hold it. So:
 *   - unallocated corporate card → nobody, ever;
 *   - allocated corporate card → the recipient only;
 *   - anything else → the existing rule.
 */
export function giftCardEmailRecipients(card: PoolCardLike): string[] {
  if (card.corporateOrderId) {
    if (card.allocationStatus !== 'ALLOCATED') return [];
    return card.recipientEmail ? [card.recipientEmail] : [];
  }
  return Array.from(new Set([card.purchaserEmail, card.recipientEmail].filter((value): value is string => Boolean(value))));
}

/**
 * Whether the scheduled-delivery drain may send this card. Mirrors the
 * database predicate in drainScheduledGiftCardSends so the two cannot drift:
 * ACTIVE, never emailed, due, and not sitting unallocated in a pool.
 */
export function drainEligible(card: {
  status: string;
  emailedAt: Date | null;
  scheduledDeliveryAt: Date | null;
  corporateOrderId: string | null;
  allocationStatus: 'UNALLOCATED' | 'ALLOCATED' | null;
}, now: Date): boolean {
  if (card.status !== 'ACTIVE') return false;
  if (card.emailedAt) return false;
  if (!card.scheduledDeliveryAt || card.scheduledDeliveryAt.getTime() > now.getTime()) return false;
  if (isUnallocatedPoolCard(card)) return false;
  return true;
}

/**
 * Re-addressing rules. A card that has not gone out (scheduled, or its email
 * failed) can be pointed at somebody else. Once the voucher has been
 * delivered the recipient holds the code, so the card is theirs: cancel it
 * and allocate another from the pool instead.
 */
export function reassignBlockedReason(card: {
  corporateOrderId: string | null;
  allocationStatus: 'UNALLOCATED' | 'ALLOCATED' | null;
  status: string;
  emailedAt: Date | null;
}): string | null {
  if (!card.corporateOrderId) return 'This is not a corporate pool card.';
  if (card.status !== 'ACTIVE') return `This card is ${card.status.toLowerCase().replace('_', ' ')} and cannot be re-addressed.`;
  if (card.allocationStatus !== 'ALLOCATED') return 'This card has not been allocated yet. Allocate it instead.';
  if (card.emailedAt) {
    return 'This voucher has already been emailed, so the recipient holds the code. Cancel the card and allocate another one from the pool.';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Scheduled delivery                                                 */
/* ------------------------------------------------------------------ */

export const SCHEDULE_HORIZON_MONTHS = 12;

/**
 * Parse a requested delivery time. Empty or past = send now (null). Anything
 * more than a year out is refused so a typo cannot park a card forever —
 * the same cap the public checkout applies.
 */
export function parseScheduledDeliveryAt(raw: string | null | undefined, now: Date): { ok: true; value: Date | null } | { ok: false; message: string } {
  const text = (raw ?? '').trim();
  if (!text) return { ok: true, value: null };
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return { ok: false, message: 'Delivery date is not a valid date/time. Use ISO format, e.g. 2026-11-01T09:00:00+11:00.' };
  const horizon = new Date(now);
  horizon.setMonth(horizon.getMonth() + SCHEDULE_HORIZON_MONTHS);
  if (parsed.getTime() > horizon.getTime()) return { ok: false, message: `Schedule a delivery date within the next ${SCHEDULE_HORIZON_MONTHS} months.` };
  if (parsed.getTime() <= now.getTime()) return { ok: true, value: null };
  return { ok: true, value: parsed };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                */
/* ------------------------------------------------------------------ */

/**
 * RFC 4180 reader: quoted fields, doubled quotes inside them, embedded
 * commas and line breaks, CRLF or LF, an optional UTF-8 BOM. Returns rows of
 * cells; blank lines are dropped. Small on purpose — no dependency for a
 * six-column file.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      index += 1;
      continue;
    }
    cell += char;
    index += 1;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

export type RecipientRow = {
  row: number;
  recipientName: string;
  recipientEmail: string;
  message: string | null;
  scheduledDeliveryAt: Date | null;
  reference: string | null;
  allocationKey: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CSV_MAX_ROWS = 500;

/**
 * Validate the whole file before anything is written. Returns every error at
 * once, with the 1-based data row number (row 1 is the first row under the
 * header), so the person fixes the file in one pass rather than one row at a
 * time.
 *
 * Header matching is case-insensitive and ignores spaces, so "First Name"
 * and "firstName" both work. A "name" column is accepted in place of
 * firstName/lastName.
 */
export function validateRecipientCsv(text: string, now: Date): { rows: RecipientRow[]; errors: CorporateCsvRowError[] } {
  const errors: CorporateCsvRowError[] = [];
  const parsed = parseCsv(text);
  if (parsed.length === 0) return { rows: [], errors: [{ row: 0, field: null, message: 'The file is empty.' }] };

  const header = parsed[0]!.map((cell) => cell.trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const columnIndex = new Map<CorporateRecipientCsvColumn | 'name', number>();
  const aliases: Record<string, CorporateRecipientCsvColumn | 'name'> = {
    firstname: 'firstName',
    first: 'firstName',
    givenname: 'firstName',
    lastname: 'lastName',
    last: 'lastName',
    surname: 'lastName',
    familyname: 'lastName',
    name: 'name',
    fullname: 'name',
    recipient: 'name',
    recipientname: 'name',
    email: 'email',
    emailaddress: 'email',
    recipientemail: 'email',
    message: 'message',
    note: 'message',
    scheduleddeliveryat: 'scheduledDeliveryAt',
    deliverydate: 'scheduledDeliveryAt',
    senddate: 'scheduledDeliveryAt',
    sendat: 'scheduledDeliveryAt',
    scheduledfor: 'scheduledDeliveryAt',
    reference: 'reference',
    ref: 'reference',
    internalreference: 'reference'
  };
  header.forEach((cell, index) => {
    const column = aliases[cell];
    if (column && !columnIndex.has(column)) columnIndex.set(column, index);
  });
  if (!columnIndex.has('email')) {
    errors.push({ row: 0, field: 'email', message: `No email column found. Expected columns: ${CORPORATE_RECIPIENT_CSV_COLUMNS.join(', ')}.` });
  }
  if (!columnIndex.has('firstName') && !columnIndex.has('name')) {
    errors.push({ row: 0, field: 'firstName', message: 'No firstName (or name) column found.' });
  }
  if (errors.length) return { rows: [], errors };

  const dataRows = parsed.slice(1);
  if (dataRows.length === 0) errors.push({ row: 0, field: null, message: 'The file has a header but no recipients.' });
  if (dataRows.length > CSV_MAX_ROWS) {
    errors.push({ row: 0, field: null, message: `Too many rows (${dataRows.length}). Upload at most ${CSV_MAX_ROWS} recipients per file.` });
    return { rows: [], errors };
  }

  const cellOf = (cells: string[], column: CorporateRecipientCsvColumn | 'name') => {
    const index = columnIndex.get(column);
    return index === undefined ? '' : (cells[index] ?? '').trim();
  };

  const rows: RecipientRow[] = [];
  const seenKeys = new Map<string, number>();
  dataRows.forEach((cells, offset) => {
    const row = offset + 1;
    const first = cellOf(cells, 'firstName');
    const last = cellOf(cells, 'lastName');
    const full = cellOf(cells, 'name');
    const recipientName = (full || `${first} ${last}`.trim()).slice(0, 160);
    const recipientEmail = cellOf(cells, 'email').toLowerCase();
    const message = cellOf(cells, 'message').slice(0, 500) || null;
    const reference = cellOf(cells, 'reference').slice(0, 120) || null;
    const scheduledRaw = cellOf(cells, 'scheduledDeliveryAt');

    if (!recipientName) errors.push({ row, field: 'firstName', message: 'Recipient name is missing.' });
    if (!recipientEmail) errors.push({ row, field: 'email', message: 'Email is missing.' });
    else if (!EMAIL_PATTERN.test(recipientEmail) || recipientEmail.length > 160) errors.push({ row, field: 'email', message: `"${recipientEmail}" is not a valid email address.` });

    let scheduledDeliveryAt: Date | null = null;
    const schedule = parseScheduledDeliveryAt(scheduledRaw, now);
    if (!schedule.ok) errors.push({ row, field: 'scheduledDeliveryAt', message: schedule.message });
    else scheduledDeliveryAt = schedule.value;

    // Identical rows in one file (two cards for the same person, same text)
    // are each their own card: the occurrence number keeps their keys apart.
    const base = recipientRowKey({ recipientName, recipientEmail, message, scheduledDeliveryAt, reference });
    const occurrence = (seenKeys.get(base) ?? 0) + 1;
    seenKeys.set(base, occurrence);
    rows.push({
      row,
      recipientName,
      recipientEmail,
      message,
      scheduledDeliveryAt,
      reference,
      allocationKey: occurrence === 1 ? base : `${base}#${occurrence}`
    });
  });

  return { rows: errors.length ? [] : rows, errors };
}

/**
 * The idempotency key for a recipient row: what the row says, hashed. The
 * same file uploaded twice produces the same keys, so the second upload
 * finds every row already allocated and allocates nothing.
 */
export function recipientRowKey(row: {
  recipientName: string;
  recipientEmail: string;
  message: string | null;
  scheduledDeliveryAt: Date | null;
  reference: string | null;
}): string {
  const material = [
    row.recipientEmail.trim().toLowerCase(),
    row.recipientName.trim().toLowerCase(),
    (row.message ?? '').trim(),
    row.scheduledDeliveryAt ? row.scheduledDeliveryAt.toISOString() : '',
    (row.reference ?? '').trim()
  ].join('\u001f');
  return `csv:${createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

/** One CSV cell, quoted when it needs to be. */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** CG-0001 style reference from the order's sequence number. */
export function corporateOrderReference(number: number): string {
  return `CG-${String(number).padStart(4, '0')}`;
}
