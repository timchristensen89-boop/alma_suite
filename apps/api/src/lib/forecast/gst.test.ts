import assert from "node:assert/strict";
import test from "node:test";
import {
  computeBasReserve,
  computeCashPosition,
  computeWageCost,
  exGstCents,
  gstComponentCents,
  incGstCents,
  toOperatingSalesExGstCents,
} from "./gst.js";

const D = (dollars: number) => Math.round(dollars * 100);

test("GST is stripped and re-added consistently", () => {
  assert.equal(exGstCents(D(110)), D(100));
  assert.equal(gstComponentCents(D(110)), D(10));
  assert.equal(incGstCents(D(100)), D(110));
  // Components always reconcile to the inclusive total.
  const inclusive = D(1_271_589.05);
  assert.equal(exGstCents(inclusive) + gstComponentCents(inclusive), inclusive);
});

test("GST is not deducted twice: an already-exclusive figure passes through untouched", () => {
  const xeroNet = D(100_000); // Xero P&L is GST exclusive
  assert.equal(toOperatingSalesExGstCents(xeroNet, "GST_EXCLUSIVE"), xeroNet);

  const squareGross = D(110_000); // Square is GST inclusive
  assert.equal(toOperatingSalesExGstCents(squareGross, "GST_INCLUSIVE"), D(100_000));

  // The failure this prevents: the two are comparable only once normalised.
  assert.equal(
    toOperatingSalesExGstCents(squareGross, "GST_INCLUSIVE"),
    toOperatingSalesExGstCents(xeroNet, "GST_EXCLUSIVE"),
  );
});

test("PAYG is not added on top of gross wages", () => {
  const result = computeWageCost({
    grossWagesCents: D(7_000),
    paygWithheldCents: D(1_400),
    superPercent: 12,
  });
  // Operating cost is gross + super only. Adding PAYG would give 9,240.
  assert.equal(result.operatingWageCostCents, D(7_840));
  assert.equal(result.superCents, D(840));
  // PAYG shows up as staff net pay and an ATO liability, not extra cost.
  assert.equal(result.netPayToStaffCents, D(5_600));
  assert.equal(result.paygPayableCents, D(1_400));
});

test("wage cost is identical whether or not PAYG is broken out", () => {
  const withPayg = computeWageCost({ grossWagesCents: D(9_000), paygWithheldCents: D(2_000), superPercent: 12 });
  const withoutPayg = computeWageCost({ grossWagesCents: D(9_000), superPercent: 12 });
  assert.equal(withPayg.operatingWageCostCents, withoutPayg.operatingWageCostCents);
});

test("PAYG exceeding gross wages is rejected as a bad payroll source", () => {
  assert.throws(
    () => computeWageCost({ grossWagesCents: D(1_000), paygWithheldCents: D(1_500), superPercent: 12 }),
    /cannot exceed gross wages/,
  );
});

test("BAS reserve holds back GST from gross receipts at the fallback rate", () => {
  // Avalon's historical net-GST rate.
  const result = computeBasReserve({ grossReceiptsCents: D(100_000), netGstReservePercent: 5.82 });
  assert.equal(result.netGstReserveCents, D(5_820));
  assert.equal(result.operatingCashFromReceiptsCents, D(94_180));
  assert.equal(result.basis, "ESTIMATED_RATE");
});

test("an actual BAS figure takes precedence over the estimated rate", () => {
  const result = computeBasReserve({
    grossReceiptsCents: D(100_000),
    netGstReservePercent: 6.1,
    actualNetGstCents: D(4_500),
  });
  assert.equal(result.netGstReserveCents, D(4_500));
  assert.equal(result.basis, "ACTUAL_BAS");
});

test("BAS payable combines net GST and PAYG for the same lodgement", () => {
  const result = computeBasReserve({
    grossReceiptsCents: D(200_000),
    netGstReservePercent: 6.1,
    paygWithheldCents: D(8_000),
  });
  assert.equal(result.netGstReserveCents, D(12_200));
  assert.equal(result.basPayableCents, D(20_200));
});

test("reserved GST is never counted as operating or creditor cash", () => {
  const position = computeCashPosition({
    bankCashCents: D(100_000),
    gstReserveCents: D(20_000),
    paygPayableCents: D(8_000),
    restrictedCents: D(2_000), // gift-card float
  });
  assert.equal(position.operatingCashCents, D(70_000));
  assert.equal(position.cashAvailableForCreditorsCents, D(70_000));
  assert.notEqual(position.cashAvailableForCreditorsCents, position.bankCashCents);
});

test("cash available for creditors never goes negative even when the bank does", () => {
  const position = computeCashPosition({
    bankCashCents: D(5_000),
    gstReserveCents: D(20_000),
    paygPayableCents: D(0),
  });
  assert.equal(position.operatingCashCents, D(-15_000), "the shortfall stays visible");
  assert.equal(position.cashAvailableForCreditorsCents, 0, "but nothing is offered to creditors");
});
