// Provider payload → canonical fc_* row shapes.
//
// Kept pure and separate from persistence: this is where the money bugs live,
// so it must be testable without a database or a live token.
//
// Two rules run through everything here:
//   - Square money is GST INCLUSIVE. Xero P&L money is GST EXCLUSIVE. Every
//     normaliser states which it produced so nothing downstream has to guess.
//   - Every record carries a deterministic idempotency key, so re-ingesting
//     the same payload twice is a no-op rather than a double count.

import { exGstCents, gstComponentCents } from "./gst.js";

/** Square returns money as { amount, currency } in the smallest unit. */
export interface SquareMoney {
  amount?: number | string | null;
  currency?: string | null;
}

export function squareMoneyCents(money: SquareMoney | null | undefined): number {
  if (!money || money.amount === null || money.amount === undefined) return 0;
  const value = typeof money.amount === "string" ? Number(money.amount) : money.amount;
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/** Business date in the venue's timezone, as a UTC-midnight Date. */
export function businessDateOf(iso: string | null | undefined, timeZone = "Australia/Sydney"): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  // en-CA gives YYYY-MM-DD, so the venue-local calendar date survives the trip.
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
  return new Date(`${local}T00:00:00Z`);
}

export interface NormalisedContext {
  companyId: string;
  venueId?: string | null;
  timeZone?: string;
}

// ── Square ─────────────────────────────────────────────────────────────────

export interface SquareOrderPayload {
  id?: string;
  location_id?: string;
  created_at?: string;
  closed_at?: string | null;
  state?: string;
  total_money?: SquareMoney;
  total_tax_money?: SquareMoney;
  total_discount_money?: SquareMoney;
  total_service_charge_money?: SquareMoney;
  total_tip_money?: SquareMoney;
  net_amounts?: { total_money?: SquareMoney; tax_money?: SquareMoney };
  returns?: unknown[];
  return_amounts?: { total_money?: SquareMoney };
  line_items?: Array<{
    uid?: string;
    catalog_object_id?: string;
    name?: string;
    quantity?: string;
    variation_name?: string;
    base_price_money?: SquareMoney;
    gross_sales_money?: SquareMoney;
    total_money?: SquareMoney;
    total_discount_money?: SquareMoney;
    total_tax_money?: SquareMoney;
    catalog_category?: { name?: string } | null;
  }>;
}

export interface NormalisedSalesOrder {
  sourceId: string;
  companyId: string;
  venueId: string | null;
  businessDate: Date;
  closedAt: Date | null;
  /** GST INCLUSIVE. */
  grossSalesCents: number;
  netSalesExGstCents: number;
  gstCents: number;
  discountsCents: number;
  serviceChargeCents: number;
  tipsCents: number;
  refundsCents: number;
  transactionCount: number;
  idempotencyKey: string;
  lines: Array<{
    itemSourceId: string | null;
    itemName: string;
    category: string | null;
    quantity: number;
    grossSalesCents: number;
    netSalesExGstCents: number;
    discountsCents: number;
    refundsCents: number;
    menuPriceCents: number | null;
  }>;
}

/**
 * A Square order → canonical sale.
 *
 * Square's `total_money` is GST inclusive and its `total_tax_money` is the GST
 * within it, so the ex-GST figure is derived by subtraction where tax is
 * supplied and by division only as a fallback.
 */
export function normaliseSquareOrder(
  payload: SquareOrderPayload,
  ctx: NormalisedContext,
): NormalisedSalesOrder | null {
  const sourceId = payload.id;
  const businessDate = businessDateOf(payload.closed_at ?? payload.created_at, ctx.timeZone);
  if (!sourceId || !businessDate) return null;

  const grossInc = squareMoneyCents(payload.total_money);
  const taxCents = squareMoneyCents(payload.total_tax_money);
  // Prefer the reported tax; fall back to backing GST out of the inclusive total.
  const gstCents = taxCents > 0 ? taxCents : gstComponentCents(grossInc);
  const netExGst = taxCents > 0 ? grossInc - taxCents : exGstCents(grossInc);

  const lines = (payload.line_items ?? []).map((line) => {
    const lineGrossInc = squareMoneyCents(line.total_money ?? line.gross_sales_money);
    const lineTax = squareMoneyCents(line.total_tax_money);
    return {
      itemSourceId: line.catalog_object_id ?? null,
      itemName: line.name ?? line.variation_name ?? "Unnamed item",
      category: line.catalog_category?.name ?? null,
      quantity: Number(line.quantity ?? "1") || 0,
      grossSalesCents: lineGrossInc,
      netSalesExGstCents: lineTax > 0 ? lineGrossInc - lineTax : exGstCents(lineGrossInc),
      discountsCents: squareMoneyCents(line.total_discount_money),
      refundsCents: 0,
      menuPriceCents: squareMoneyCents(line.base_price_money) || null,
    };
  });

  return {
    sourceId,
    companyId: ctx.companyId,
    venueId: ctx.venueId ?? null,
    businessDate,
    closedAt: payload.closed_at ? new Date(payload.closed_at) : null,
    grossSalesCents: grossInc,
    netSalesExGstCents: netExGst,
    gstCents,
    discountsCents: squareMoneyCents(payload.total_discount_money),
    serviceChargeCents: squareMoneyCents(payload.total_service_charge_money),
    tipsCents: squareMoneyCents(payload.total_tip_money),
    refundsCents: squareMoneyCents(payload.return_amounts?.total_money),
    transactionCount: 1,
    idempotencyKey: `square:order:${sourceId}`,
    lines,
  };
}

export interface SquarePayoutPayload {
  id?: string;
  location_id?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  /** When the money is expected to land in the bank. */
  arrival_date?: string | null;
  amount_money?: SquareMoney;
  destination?: { type?: string; id?: string } | null;
}

export interface NormalisedPayout {
  sourceId: string;
  companyId: string;
  venueId: string | null;
  payoutDate: Date;
  arrivalDate: Date | null;
  netPayoutCents: number;
  destinationAccount: string | null;
  status: string | null;
  idempotencyKey: string;
}

/** A payout is the ACTUAL bank settlement — the basis for cash timing. */
export function normaliseSquarePayout(
  payload: SquarePayoutPayload,
  ctx: NormalisedContext,
): NormalisedPayout | null {
  const sourceId = payload.id;
  const payoutDate = businessDateOf(payload.created_at, ctx.timeZone);
  if (!sourceId || !payoutDate) return null;
  return {
    sourceId,
    companyId: ctx.companyId,
    venueId: ctx.venueId ?? null,
    payoutDate,
    arrivalDate: payload.arrival_date ? businessDateOf(payload.arrival_date, ctx.timeZone) : null,
    netPayoutCents: squareMoneyCents(payload.amount_money),
    destinationAccount: payload.destination?.id ?? payload.destination?.type ?? null,
    status: payload.status ?? null,
    idempotencyKey: `square:payout:${sourceId}`,
  };
}

export interface SquarePayoutEntryPayload {
  id?: string;
  payout_id?: string;
  type?: string;
  effective_at?: string;
  gross_amount_money?: SquareMoney;
  fee_amount_money?: SquareMoney;
  net_amount_money?: SquareMoney;
  type_details?: { payment_id?: string } | null;
}

export function normaliseSquarePayoutEntry(payload: SquarePayoutEntryPayload, companyId: string) {
  if (!payload.id) return null;
  return {
    sourceId: payload.id,
    companyId,
    payoutSourceId: payload.payout_id ?? null,
    type: payload.type ?? null,
    amountCents: squareMoneyCents(payload.net_amount_money ?? payload.gross_amount_money),
    feeCents: squareMoneyCents(payload.fee_amount_money),
    effectiveAt: payload.effective_at ? new Date(payload.effective_at) : null,
    paymentSourceId: payload.type_details?.payment_id ?? null,
    idempotencyKey: `square:payout_entry:${payload.id}`,
  };
}

export interface SquarePaymentPayload {
  id?: string;
  order_id?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  amount_money?: SquareMoney;
  tip_money?: SquareMoney;
  processing_fee?: Array<{ amount_money?: SquareMoney }>;
  source_type?: string;
  payout_id?: string | null;
}

export function normaliseSquarePayment(payload: SquarePaymentPayload, ctx: NormalisedContext) {
  const businessDate = businessDateOf(payload.created_at, ctx.timeZone);
  if (!payload.id || !businessDate) return null;
  const feeCents = (payload.processing_fee ?? []).reduce((sum, fee) => sum + squareMoneyCents(fee.amount_money), 0);
  return {
    sourceId: payload.id,
    companyId: ctx.companyId,
    venueId: ctx.venueId ?? null,
    orderSourceId: payload.order_id ?? null,
    businessDate,
    completedAt: payload.updated_at ? new Date(payload.updated_at) : null,
    amountCents: squareMoneyCents(payload.amount_money),
    tipCents: squareMoneyCents(payload.tip_money),
    feeCents,
    tenderType: payload.source_type ?? null,
    status: payload.status ?? null,
    payoutId: payload.payout_id ?? null,
    idempotencyKey: `square:payment:${payload.id}`,
  };
}

export interface SquareRefundPayload {
  id?: string;
  payment_id?: string;
  created_at?: string;
  status?: string;
  amount_money?: SquareMoney;
  reason?: string;
}

export function normaliseSquareRefund(payload: SquareRefundPayload, ctx: NormalisedContext) {
  const businessDate = businessDateOf(payload.created_at, ctx.timeZone);
  if (!payload.id || !businessDate) return null;
  return {
    sourceId: payload.id,
    companyId: ctx.companyId,
    venueId: ctx.venueId ?? null,
    paymentSourceId: payload.payment_id ?? null,
    businessDate,
    amountCents: squareMoneyCents(payload.amount_money),
    reason: payload.reason ?? null,
    status: payload.status ?? null,
    idempotencyKey: `square:refund:${payload.id}`,
  };
}

// ── Xero ───────────────────────────────────────────────────────────────────

/** Xero sends dollars as numbers, and dates as /Date(ms+offset)/ or ISO. */
export function xeroDollarsToCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

export function parseXeroDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const msMatch = value.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  if (msMatch?.[1]) {
    const parsed = new Date(Number(msMatch[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // Xero sends accounting dates with no timezone ("2026-07-28T00:00:00").
  // `new Date()` would read those as LOCAL time, which in Sydney shifts the
  // calendar date back a day and would quietly move invoice due dates and
  // business dates. An accounting date is a calendar date — pin it to UTC.
  const naive = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?$/);
  if (naive?.[1]) {
    const parsed = new Date(`${naive[1]}T${naive[2] ?? "00:00:00"}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface XeroInvoicePayload {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Reference?: string;
  Type?: string;
  Contact?: { Name?: string };
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  Status?: string;
  /** Xero P&L / invoice SubTotal is GST EXCLUSIVE. */
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  AmountDue?: number;
}

/**
 * A Xero bill (ACCPAY) or invoice (ACCREC).
 *
 * SubTotal is GST exclusive; Total includes tax. Both are kept so the
 * operating model can use ex-GST and the cash model can use gross without
 * either having to re-derive the other.
 */
export function normaliseXeroInvoice(payload: XeroInvoicePayload, companyId: string) {
  if (!payload.InvoiceID) return null;
  const netCents = xeroDollarsToCents(payload.SubTotal);
  const taxCents = xeroDollarsToCents(payload.TotalTax);
  const grossCents = xeroDollarsToCents(payload.Total) || netCents + taxCents;
  return {
    sourceId: payload.InvoiceID,
    companyId,
    type: payload.Type ?? null,
    invoiceNumber: payload.InvoiceNumber ?? payload.Reference ?? null,
    contactName: payload.Contact?.Name ?? null,
    issueDate: parseXeroDate(payload.DateString ?? payload.Date),
    dueDate: parseXeroDate(payload.DueDateString ?? payload.DueDate),
    netAmountCents: netCents,
    taxAmountCents: taxCents,
    grossAmountCents: grossCents,
    amountDueCents: xeroDollarsToCents(payload.AmountDue),
    status: payload.Status ?? null,
    idempotencyKey: `xero:invoice:${payload.InvoiceID}`,
  };
}

export interface XeroBankTransactionPayload {
  BankTransactionID?: string;
  Type?: string;
  Date?: string;
  DateString?: string;
  Total?: number;
  Contact?: { Name?: string };
  Reference?: string;
  IsReconciled?: boolean;
  BankAccount?: { AccountID?: string; Name?: string };
}

/**
 * A bank line. SPEND is stored negative and RECEIVE positive, so a cash
 * forecast can sum the column without inspecting a type string.
 */
export function normaliseXeroBankTransaction(payload: XeroBankTransactionPayload, companyId: string) {
  const txnDate = parseXeroDate(payload.DateString ?? payload.Date);
  if (!payload.BankTransactionID || !txnDate) return null;
  const magnitude = Math.abs(xeroDollarsToCents(payload.Total));
  const isSpend = (payload.Type ?? "").toUpperCase().startsWith("SPEND");
  return {
    sourceId: payload.BankTransactionID,
    companyId,
    bankAccountId: payload.BankAccount?.AccountID ?? null,
    bankAccountName: payload.BankAccount?.Name ?? null,
    txnDate,
    amountCents: isSpend ? -magnitude : magnitude,
    type: payload.Type ?? null,
    contactName: payload.Contact?.Name ?? null,
    reference: payload.Reference ?? null,
    reconciled: payload.IsReconciled === true,
    idempotencyKey: `xero:bank_txn:${payload.BankTransactionID}`,
  };
}

export interface XeroAccountPayload {
  AccountID?: string;
  Code?: string;
  Name?: string;
  Type?: string;
  TaxType?: string;
  Class?: string;
}

export function normaliseXeroAccount(payload: XeroAccountPayload, companyId: string) {
  if (!payload.AccountID) return null;
  return {
    sourceId: payload.AccountID,
    companyId,
    code: payload.Code ?? null,
    name: payload.Name ?? "Unnamed account",
    type: payload.Type ?? null,
    taxType: payload.TaxType ?? null,
    isBank: (payload.Type ?? "").toUpperCase() === "BANK",
    idempotencyKey: `xero:account:${payload.AccountID}`,
  };
}

export interface XeroPaymentPayload {
  PaymentID?: string;
  Date?: string;
  Amount?: number;
  Invoice?: { InvoiceID?: string; Type?: string };
  Account?: { AccountID?: string };
}

export function normaliseXeroPayment(payload: XeroPaymentPayload, companyId: string) {
  if (!payload.PaymentID) return null;
  const isBill = (payload.Invoice?.Type ?? "").toUpperCase() === "ACCPAY";
  return {
    sourceId: payload.PaymentID,
    companyId,
    paidDate: parseXeroDate(payload.Date),
    amountCents: xeroDollarsToCents(payload.Amount),
    invoiceSourceId: isBill ? null : payload.Invoice?.InvoiceID ?? null,
    billSourceId: isBill ? payload.Invoice?.InvoiceID ?? null : null,
    bankAccountId: payload.Account?.AccountID ?? null,
    idempotencyKey: `xero:payment:${payload.PaymentID}`,
  };
}

/**
 * Deduplicate a batch by idempotency key, keeping the LAST occurrence — a
 * later page carries the fresher version of an updated record.
 */
export function dedupeByKey<T extends { idempotencyKey: string }>(records: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const record of records) byKey.set(record.idempotencyKey, record);
  return [...byKey.values()];
}
