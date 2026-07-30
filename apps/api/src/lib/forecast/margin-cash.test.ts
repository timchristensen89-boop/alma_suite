import assert from "node:assert/strict";
import test from "node:test";
import {
  cogsFromPurchases,
  cogsFromStocktake,
  cogsTheoretical,
  computeMargin,
  creditorHeadroom,
  expandCommitment,
  intercompanyPair,
  projectCashFlow,
  type CashMovement,
} from "./margin-cash.js";

const D = (dollars: number) => Math.round(dollars * 100);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

// ── margin ─────────────────────────────────────────────────────────────────

test("COGS from stocktake follows the stock-movement identity", () => {
  const result = cogsFromStocktake({
    category: "Food",
    openingStockCents: D(18_500),
    purchasesCents: D(42_000),
    transfersInCents: D(0),
    transfersOutCents: D(450),
    wastageCents: D(620),
    staffMealsCents: D(980),
    closingStockCents: D(19_100),
  });
  // 18,500 + 42,000 + 0 − 450 − 19,100 = 40,950
  assert.equal(result.cogsCents, D(40_950));
  assert.equal(result.basis, "STOCKTAKE");
});

test("wastage and staff meals stay visible rather than hidden inside COGS", () => {
  const result = cogsFromStocktake({
    category: "Food", openingStockCents: 0, purchasesCents: D(1_000), transfersInCents: 0,
    transfersOutCents: 0, wastageCents: D(80), staffMealsCents: D(120), closingStockCents: 0,
  });
  assert.equal(result.cogsCents, D(1_000));
  assert.equal(result.wastageCents, D(80));
  assert.equal(result.staffMealsCents, D(120));
});

test("theoretical COGS is labelled as not reconciled", () => {
  const theoretical = cogsTheoretical(D(10_000));
  assert.equal(theoretical.basis, "THEORETICAL");
  assert.match(theoretical.method, /NOT reconciled/);

  const purchases = cogsFromPurchases(D(10_000));
  assert.equal(purchases.basis, "PURCHASES_ONLY");
  assert.match(purchases.method, /no stocktake/);
});

test("labour is gross wages plus super — PAYG is never added again", () => {
  const margin = computeMargin({
    netSalesExGstCents: D(100_000),
    foodCogs: cogsFromStocktake({ category: "Food", openingStockCents: 0, purchasesCents: D(20_000), transfersInCents: 0, transfersOutCents: 0, wastageCents: 0, staffMealsCents: 0, closingStockCents: 0 }),
    beverageCogs: cogsFromPurchases(D(5_000)),
    grossWagesCents: D(30_000),
    paygWithheldCents: D(6_000),
    superPercent: 12,
  });
  assert.equal(margin.labourCostCents, D(33_600), "30,000 + 3,600 super; PAYG excluded");
  assert.equal(margin.superCents, D(3_600));
});

test("margin percentages are computed against GST-exclusive sales", () => {
  const margin = computeMargin({
    netSalesExGstCents: D(100_000),
    foodCogs: cogsFromPurchases(D(20_000)),
    beverageCogs: cogsFromPurchases(D(5_000)),
    grossWagesCents: D(30_000),
    superPercent: 12,
  });
  assert.equal(margin.totalCogsCents, D(25_000));
  assert.equal(margin.cogsPercent, 25);
  assert.equal(margin.grossProfitCents, D(75_000));
  assert.equal(margin.grossMarginPercent, 75);
  assert.equal(margin.primeCostCents, D(58_600));
  assert.equal(margin.primeCostPercent, 58.6);
});

test("margin carries the COGS basis so the UI can label it", () => {
  const margin = computeMargin({
    netSalesExGstCents: D(1_000),
    foodCogs: cogsTheoretical(D(200)),
    beverageCogs: cogsFromStocktake({ category: "Bev", openingStockCents: 0, purchasesCents: D(50), transfersInCents: 0, transfersOutCents: 0, wastageCents: 0, staffMealsCents: 0, closingStockCents: 0 }),
    grossWagesCents: D(300),
    superPercent: 12,
  });
  assert.equal(margin.cogsBasis.food, "THEORETICAL");
  assert.equal(margin.cogsBasis.beverage, "STOCKTAKE");
});

test("zero sales does not divide by zero", () => {
  const margin = computeMargin({
    netSalesExGstCents: 0, foodCogs: cogsFromPurchases(0), beverageCogs: cogsFromPurchases(0),
    grossWagesCents: 0, superPercent: 12,
  });
  assert.equal(margin.cogsPercent, null);
  assert.equal(margin.grossMarginPercent, null);
});

// ── cash flow ──────────────────────────────────────────────────────────────

test("cash projects forward from an actual opening balance", () => {
  const movements: CashMovement[] = [
    { date: day("2026-08-02"), amountCents: D(5_000), category: "SALES", description: "Payout", provenance: "ACTUAL" },
    { date: day("2026-08-03"), amountCents: D(-2_000), category: "RENT", description: "Rent", provenance: "MANAGEMENT_ASSUMPTION" },
  ];
  const result = projectCashFlow({ openingBankCents: D(10_000), startDate: day("2026-08-01"), days: 4, movements });

  assert.equal(result.points[0]?.closingCashCents, D(10_000), "quiet day changes nothing");
  assert.equal(result.points[1]?.closingCashCents, D(15_000));
  assert.equal(result.points[2]?.closingCashCents, D(13_000));
  assert.equal(result.closingCashCents, D(13_000));
});

test("a bill, its bank payment and a recurring assumption cannot all be charged", () => {
  const rentKey = "rent:2026-08-01";
  const movements: CashMovement[] = [
    { date: day("2026-08-01"), amountCents: D(-12_828.77), category: "RENT", description: "Rent (bank)", provenance: "ACTUAL", dedupeKey: rentKey },
    { date: day("2026-08-01"), amountCents: D(-12_828.77), category: "RENT", description: "Rent (Xero bill)", provenance: "MODEL_FORECAST", dedupeKey: rentKey },
    { date: day("2026-08-01"), amountCents: D(-12_828.77), category: "RENT", description: "Rent (assumption)", provenance: "MANAGEMENT_ASSUMPTION", dedupeKey: rentKey },
  ];
  const result = projectCashFlow({ openingBankCents: D(50_000), startDate: day("2026-08-01"), days: 2, movements });

  assert.equal(result.duplicatesRemoved, 2);
  assert.equal(result.closingCashCents, D(37_171.23), "rent charged exactly once");
  assert.equal(result.points[0]?.movements[0]?.provenance, "ACTUAL", "the actual wins over the estimates");
});

test("GST inside receipts is reserved, not treated as spendable", () => {
  const movements: CashMovement[] = [
    { date: day("2026-08-01"), amountCents: D(11_000), category: "SALES", description: "Takings", provenance: "ACTUAL", gstReserveCents: D(1_000) },
  ];
  const result = projectCashFlow({ openingBankCents: 0, startDate: day("2026-08-01"), days: 1, movements });

  assert.equal(result.points[0]?.closingCashCents, D(11_000), "bank shows the full receipt");
  assert.equal(result.points[0]?.gstReserveCents, D(1_000));
  assert.equal(result.points[0]?.operatingCashCents, D(10_000), "only the ex-GST part is spendable");
});

test("paying the BAS releases the reserve it settles", () => {
  const movements: CashMovement[] = [
    { date: day("2026-08-01"), amountCents: D(11_000), category: "SALES", description: "Takings", provenance: "ACTUAL", gstReserveCents: D(1_000) },
    { date: day("2026-08-28"), amountCents: D(-1_000), category: "BAS", description: "BAS payment", provenance: "MODEL_FORECAST" },
  ];
  const result = projectCashFlow({ openingBankCents: 0, startDate: day("2026-08-01"), days: 30, movements });
  const final = result.points[result.points.length - 1];
  assert.equal(final?.gstReserveCents, 0, "reserve is released once remitted");
  assert.equal(final?.closingCashCents, D(10_000));
  assert.equal(final?.operatingCashCents, D(10_000));
});

test("the lowest cash point and breach days are reported", () => {
  const movements: CashMovement[] = [
    { date: day("2026-08-05"), amountCents: D(-9_000), category: "PAYROLL", description: "Wages", provenance: "MANAGEMENT_ASSUMPTION" },
    { date: day("2026-08-09"), amountCents: D(12_000), category: "SALES", description: "Payout", provenance: "MODEL_FORECAST" },
  ];
  const result = projectCashFlow({ openingBankCents: D(5_000), startDate: day("2026-08-01"), days: 14, movements });

  assert.equal(result.lowestCashCents, D(-4_000));
  assert.equal(result.lowestCashDate?.toISOString().slice(0, 10), "2026-08-05");
  assert.ok(result.breachDates.length > 0, "days below zero are flagged");
  assert.equal(result.closingCashCents, D(8_000));
});

test("monthly commitments expand onto the nominated payment day", () => {
  const movements = expandCommitment(
    { description: "Rent", category: "RENT", amountCents: D(12_828.77), frequency: "MONTHLY", startDate: day("2026-08-01"), paymentDay: 1 },
    { start: day("2026-08-01"), end: day("2026-10-31") },
  );
  assert.equal(movements.length, 3);
  assert.deepEqual(movements.map((m) => m.date.toISOString().slice(0, 10)), ["2026-08-01", "2026-09-01", "2026-10-01"]);
  assert.ok(movements.every((m) => m.amountCents < 0), "commitments are outflows");
});

test("a payment day beyond the month end clamps to the last day", () => {
  const movements = expandCommitment(
    { description: "Loan", category: "FINANCE_REPAYMENTS", amountCents: D(1_000), frequency: "MONTHLY", startDate: day("2026-01-31"), paymentDay: 31 },
    { start: day("2026-01-01"), end: day("2026-03-31") },
  );
  assert.equal(movements[1]?.date.toISOString().slice(0, 10), "2026-02-28", "February has no 31st");
});

test("weekly commitments step every seven days and respect the end date", () => {
  const movements = expandCommitment(
    { description: "Wages", category: "WAGES", amountCents: D(7_000), frequency: "WEEKLY", startDate: day("2026-08-03"), endDate: day("2026-08-24") },
    { start: day("2026-08-01"), end: day("2026-09-30") },
  );
  assert.equal(movements.length, 4);
  assert.equal(movements[3]?.date.toISOString().slice(0, 10), "2026-08-24");
});

test("an intercompany payment nets to zero across the group — never new cash", () => {
  const pair = intercompanyPair({
    date: day("2026-08-15"), amountCents: D(50_000),
    fromCompanyId: "co_af", toCompanyId: "co_tcc", reason: "Working capital support",
  });
  assert.equal(pair.length, 2);
  assert.equal(pair[0]?.amountCents, D(-50_000));
  assert.equal(pair[1]?.amountCents, D(50_000));
  assert.equal(pair.reduce((sum, m) => sum + m.amountCents, 0), 0, "no group cash is created");
  assert.notEqual(pair[0]?.companyId, pair[1]?.companyId, "the two sides sit in different entities");
});

test("creditor headroom never exceeds the worst point in the horizon", () => {
  const movements: CashMovement[] = [
    { date: day("2026-08-05"), amountCents: D(-40_000), category: "PAYROLL", description: "Wages", provenance: "MANAGEMENT_ASSUMPTION" },
    { date: day("2026-08-20"), amountCents: D(60_000), category: "SALES", description: "Payout", provenance: "MODEL_FORECAST" },
  ];
  const result = projectCashFlow({ openingBankCents: D(50_000), startDate: day("2026-08-01"), days: 30, movements });
  assert.equal(result.closingCashCents, D(70_000));
  assert.equal(result.lowestCashCents, D(10_000));
  assert.equal(creditorHeadroom(result), D(10_000), "a healthy closing balance does not excuse a mid-month trough");
});

test("creditor headroom is never negative and respects restricted money", () => {
  const result = projectCashFlow({
    openingBankCents: D(1_000), startDate: day("2026-08-01"), days: 3,
    movements: [{ date: day("2026-08-02"), amountCents: D(-5_000), category: "PAYROLL", description: "Wages", provenance: "ACTUAL" }],
  });
  assert.equal(creditorHeadroom(result), 0, "an overdrawn venue offers creditors nothing");

  const healthy = projectCashFlow({
    openingBankCents: D(20_000), startDate: day("2026-08-01"), days: 3,
    movements: [{ date: day("2026-08-01"), amountCents: D(11_000), category: "SALES", description: "Takings", provenance: "ACTUAL", gstReserveCents: D(1_000) }],
  });
  // 31,000 bank − 1,000 GST − 2,000 gift-card float = 28,000, but the trough was 19,000...
  assert.ok(creditorHeadroom(healthy, D(2_000)) <= D(30_000));
});
