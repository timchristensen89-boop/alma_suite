import assert from "node:assert/strict";
import test from "node:test";
import {
  businessDateOf,
  dedupeByKey,
  normaliseSquareOrder,
  normaliseSquarePayment,
  normaliseSquarePayout,
  normaliseSquareRefund,
  normaliseXeroAccount,
  normaliseXeroBankTransaction,
  normaliseXeroInvoice,
  normaliseXeroPayment,
  parseXeroDate,
  squareMoneyCents,
  xeroDollarsToCents,
} from "./normalise.js";

const ctx = { companyId: "co_tcc", venueId: "ve_avalon" };
const D = (dollars: number) => Math.round(dollars * 100);

test("Square money parses from number and string, and missing money is zero", () => {
  assert.equal(squareMoneyCents({ amount: 12345 }), 12345);
  assert.equal(squareMoneyCents({ amount: "12345" }), 12345);
  assert.equal(squareMoneyCents(null), 0);
  assert.equal(squareMoneyCents({}), 0);
});

test("business date uses the venue timezone, not UTC", () => {
  // 2026-07-28T14:30Z is 2026-07-29 00:30 in Sydney — a different trading day.
  const date = businessDateOf("2026-07-28T14:30:00Z", "Australia/Sydney");
  assert.equal(date?.toISOString().slice(0, 10), "2026-07-29");
});

test("Square order uses reported tax rather than re-deriving GST", () => {
  const order = normaliseSquareOrder(
    {
      id: "ord_1",
      created_at: "2026-07-01T02:00:00Z",
      total_money: { amount: D(110) },
      total_tax_money: { amount: D(10) },
      total_discount_money: { amount: D(5) },
      total_tip_money: { amount: D(3) },
    },
    ctx,
  );
  assert.equal(order?.grossSalesCents, D(110), "gross stays GST inclusive");
  assert.equal(order?.gstCents, D(10));
  assert.equal(order?.netSalesExGstCents, D(100));
  assert.equal(order?.discountsCents, D(5));
  assert.equal(order?.tipsCents, D(3));
  assert.equal(order?.idempotencyKey, "square:order:ord_1");
});

test("Square order without reported tax backs GST out of the inclusive total", () => {
  const order = normaliseSquareOrder(
    { id: "ord_2", created_at: "2026-07-01T02:00:00Z", total_money: { amount: D(110) } },
    ctx,
  );
  assert.equal(order?.netSalesExGstCents, D(100));
  assert.equal(order?.gstCents, D(10));
});

test("order components always reconcile to the inclusive gross", () => {
  const order = normaliseSquareOrder(
    { id: "ord_3", created_at: "2026-07-01T02:00:00Z", total_money: { amount: 129_99 }, total_tax_money: { amount: 11_82 } },
    ctx,
  );
  assert.equal((order?.netSalesExGstCents ?? 0) + (order?.gstCents ?? 0), order?.grossSalesCents);
});

test("order line items are normalised with quantity and category", () => {
  const order = normaliseSquareOrder(
    {
      id: "ord_4",
      created_at: "2026-07-01T02:00:00Z",
      total_money: { amount: D(44) },
      total_tax_money: { amount: D(4) },
      line_items: [
        {
          catalog_object_id: "cat_1",
          name: "Barramundi",
          quantity: "2",
          total_money: { amount: D(44) },
          total_tax_money: { amount: D(4) },
          base_price_money: { amount: D(22) },
          catalog_category: { name: "Mains" },
        },
      ],
    },
    ctx,
  );
  assert.equal(order?.lines.length, 1);
  assert.equal(order?.lines[0]?.quantity, 2);
  assert.equal(order?.lines[0]?.category, "Mains");
  assert.equal(order?.lines[0]?.netSalesExGstCents, D(40));
  assert.equal(order?.lines[0]?.menuPriceCents, D(22));
});

test("an order without an id or a date is rejected rather than half-ingested", () => {
  assert.equal(normaliseSquareOrder({ created_at: "2026-07-01T02:00:00Z" }, ctx), null);
  assert.equal(normaliseSquareOrder({ id: "ord_x" }, ctx), null);
});

test("Square payout keeps the arrival date — the actual settlement timing", () => {
  const payout = normaliseSquarePayout(
    {
      id: "po_1",
      created_at: "2026-07-01T05:00:00Z",
      arrival_date: "2026-07-03T00:00:00Z",
      amount_money: { amount: D(4_210.55) },
      status: "PAID",
      destination: { type: "BANK_ACCOUNT", id: "ba_1" },
    },
    ctx,
  );
  assert.equal(payout?.netPayoutCents, D(4_210.55));
  assert.equal(payout?.arrivalDate?.toISOString().slice(0, 10), "2026-07-03");
  assert.equal(payout?.destinationAccount, "ba_1");
  assert.equal(payout?.idempotencyKey, "square:payout:po_1");
});

test("Square payment captures processing fees and the payout link", () => {
  const payment = normaliseSquarePayment(
    {
      id: "pay_1",
      order_id: "ord_1",
      created_at: "2026-07-01T02:00:00Z",
      amount_money: { amount: D(110) },
      tip_money: { amount: D(5) },
      processing_fee: [{ amount_money: { amount: D(1.9) } }, { amount_money: { amount: D(0.3) } }],
      source_type: "CARD",
      payout_id: "po_1",
    },
    ctx,
  );
  assert.equal(payment?.feeCents, D(2.2), "fees are summed");
  assert.equal(payment?.payoutId, "po_1");
  assert.equal(payment?.tenderType, "CARD");
});

test("Square refund is normalised against its payment", () => {
  const refund = normaliseSquareRefund(
    { id: "rf_1", payment_id: "pay_1", created_at: "2026-07-02T02:00:00Z", amount_money: { amount: D(20) }, status: "COMPLETED" },
    ctx,
  );
  assert.equal(refund?.amountCents, D(20));
  assert.equal(refund?.paymentSourceId, "pay_1");
});

test("Xero dollars convert to cents without float drift", () => {
  assert.equal(xeroDollarsToCents(12_828.77), 1_282_877);
  assert.equal(xeroDollarsToCents("11067.50"), 1_106_750);
  assert.equal(xeroDollarsToCents(null), 0);
});

test("a naive Xero date keeps its calendar day and is not shifted by local time", () => {
  // The bug this guards: `new Date("2026-07-28T00:00:00")` reads as LOCAL,
  // which in Sydney becomes 2026-07-27 in UTC — a due date moved a day early.
  assert.equal(parseXeroDate("2026-07-28T00:00:00")?.toISOString().slice(0, 10), "2026-07-28");
  assert.equal(parseXeroDate("2026-07-28")?.toISOString().slice(0, 10), "2026-07-28");
});

test("Xero dates parse from both ISO and the /Date(...)/ format", () => {
  assert.equal(parseXeroDate("2026-07-28T00:00:00")?.toISOString().slice(0, 10), "2026-07-28");
  assert.equal(parseXeroDate("/Date(1785196800000+0000)/")?.toISOString().slice(0, 10), "2026-07-28");
  assert.equal(parseXeroDate(null), null);
  assert.equal(parseXeroDate("not a date"), null);
});

test("Xero invoice keeps ex-GST and gross separately — never conflated", () => {
  const invoice = normaliseXeroInvoice(
    {
      InvoiceID: "inv_1",
      Type: "ACCPAY",
      InvoiceNumber: "INV-42",
      Contact: { Name: "Supplier Pty Ltd" },
      DateString: "2026-07-01T00:00:00",
      DueDateString: "2026-07-31T00:00:00",
      SubTotal: 1000,
      TotalTax: 100,
      Total: 1100,
      AmountDue: 1100,
      Status: "AUTHORISED",
    },
    "co_tcc",
  );
  assert.equal(invoice?.netAmountCents, D(1_000), "SubTotal is GST exclusive");
  assert.equal(invoice?.taxAmountCents, D(100));
  assert.equal(invoice?.grossAmountCents, D(1_100));
  // The operating model must never add gross to a GST-exclusive P&L line.
  assert.notEqual(invoice?.netAmountCents, invoice?.grossAmountCents);
});

test("Xero invoice total is derived when absent", () => {
  const invoice = normaliseXeroInvoice({ InvoiceID: "inv_2", SubTotal: 500, TotalTax: 50 }, "co_tcc");
  assert.equal(invoice?.grossAmountCents, D(550));
});

test("bank transactions are signed: spend negative, receive positive", () => {
  const spend = normaliseXeroBankTransaction(
    { BankTransactionID: "bt_1", Type: "SPEND", DateString: "2026-07-01T00:00:00", Total: 250.5 },
    "co_tcc",
  );
  const receive = normaliseXeroBankTransaction(
    { BankTransactionID: "bt_2", Type: "RECEIVE", DateString: "2026-07-01T00:00:00", Total: 4210.55 },
    "co_tcc",
  );
  assert.equal(spend?.amountCents, D(-250.5));
  assert.equal(receive?.amountCents, D(4_210.55));
  // Summing the column gives the net movement with no type inspection.
  assert.equal((spend?.amountCents ?? 0) + (receive?.amountCents ?? 0), D(3_960.05));
});

test("a bank transaction already negative in Xero is not double-negated", () => {
  const spend = normaliseXeroBankTransaction(
    { BankTransactionID: "bt_3", Type: "SPEND", DateString: "2026-07-01T00:00:00", Total: -250.5 },
    "co_tcc",
  );
  assert.equal(spend?.amountCents, D(-250.5));
});

test("Xero accounts flag bank accounts", () => {
  const bank = normaliseXeroAccount({ AccountID: "acc_1", Code: "090", Name: "NAB Business", Type: "BANK" }, "co_tcc");
  const expense = normaliseXeroAccount({ AccountID: "acc_2", Code: "400", Name: "Rent", Type: "EXPENSE" }, "co_tcc");
  assert.equal(bank?.isBank, true);
  assert.equal(expense?.isBank, false);
});

test("Xero payment routes to bill or invoice by type", () => {
  const billPayment = normaliseXeroPayment(
    { PaymentID: "pmt_1", Date: "2026-07-05T00:00:00", Amount: 1100, Invoice: { InvoiceID: "inv_1", Type: "ACCPAY" } },
    "co_tcc",
  );
  assert.equal(billPayment?.billSourceId, "inv_1");
  assert.equal(billPayment?.invoiceSourceId, null);

  const salesPayment = normaliseXeroPayment(
    { PaymentID: "pmt_2", Date: "2026-07-05T00:00:00", Amount: 500, Invoice: { InvoiceID: "inv_9", Type: "ACCREC" } },
    "co_tcc",
  );
  assert.equal(salesPayment?.invoiceSourceId, "inv_9");
  assert.equal(salesPayment?.billSourceId, null);
});

test("re-ingesting the same record twice is a no-op, keeping the fresher copy", () => {
  const first = { idempotencyKey: "square:payout:po_1", netPayoutCents: 100, status: "SENT" };
  const second = { idempotencyKey: "square:payout:po_1", netPayoutCents: 100, status: "PAID" };
  const deduped = dedupeByKey([first, second]);
  assert.equal(deduped.length, 1, "no double count");
  assert.equal(deduped[0]?.status, "PAID", "later page wins");
});
