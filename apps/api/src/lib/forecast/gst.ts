// GST and PAYG rules.
//
// The two mistakes this module exists to prevent:
//
//   1. Double-counting GST. Xero P&L sales and expenses are GST EXCLUSIVE.
//      Square gross sales are GST INCLUSIVE. Adding them together, or
//      deducting GST again as an operating expense, overstates cost.
//   2. Double-counting PAYG. Gross wages ALREADY contain PAYG withholding.
//      PAYG is a remittance timing item for BAS, never an extra wage cost.
//
// So there are two deliberately separate views:
//
//   - the GST-EXCLUSIVE operating forecast (P&L shape), and
//   - the bank liquidity / BAS timing forecast (cash shape), where GST is
//     collected, reserved, and later remitted.
//
// Reserved GST is never presented as available operating cash.

/** Australian GST rate. Both entities report on a CASH basis. */
export const GST_RATE = 0.1;
export const GST_DIVISOR = 1 + GST_RATE;

/** Strip GST from a GST-inclusive amount. */
export function exGstCents(inclusiveCents: number): number {
  return Math.round(inclusiveCents / GST_DIVISOR);
}

/** The GST component of a GST-inclusive amount. */
export function gstComponentCents(inclusiveCents: number): number {
  return inclusiveCents - exGstCents(inclusiveCents);
}

/** Add GST to a GST-exclusive amount. */
export function incGstCents(exclusiveCents: number): number {
  return Math.round(exclusiveCents * GST_DIVISOR);
}

export type SalesBasis = "GST_INCLUSIVE" | "GST_EXCLUSIVE";

/**
 * Normalise a sales figure to GST-exclusive for the operating model.
 *
 * Callers must state the basis of what they hold. There is no sniffing: a
 * silent guess here is exactly how Square gross gets added to Xero net.
 */
export function toOperatingSalesExGstCents(amountCents: number, basis: SalesBasis): number {
  return basis === "GST_INCLUSIVE" ? exGstCents(amountCents) : amountCents;
}

export interface WageInput {
  /** Gross wages — INCLUSIVE of PAYG withheld. */
  grossWagesCents: number;
  /** PAYG withheld from those gross wages. Remittance timing only. */
  paygWithheldCents?: number;
  superPercent: number;
}

export interface WageCostResult {
  /** The operating cost: gross wages + super. PAYG is NOT added. */
  operatingWageCostCents: number;
  grossWagesCents: number;
  superCents: number;
  /** Cash paid to staff now (gross less PAYG withheld). */
  netPayToStaffCents: number;
  /** Owed to the ATO at the next BAS. A liability, not a wage cost. */
  paygPayableCents: number;
}

/**
 * Wage cost for the operating model.
 *
 * operating cost = gross wages + super. PAYG is already inside gross wages, so
 * adding it again would overstate labour by the withholding amount.
 */
export function computeWageCost(input: WageInput): WageCostResult {
  const gross = Math.max(0, Math.round(input.grossWagesCents));
  const payg = Math.max(0, Math.round(input.paygWithheldCents ?? 0));
  if (payg > gross) {
    throw new Error("PAYG withheld cannot exceed gross wages — check the payroll source.");
  }
  const superCents = Math.round(gross * (Math.max(0, input.superPercent) / 100));
  return {
    operatingWageCostCents: gross + superCents,
    grossWagesCents: gross,
    superCents,
    netPayToStaffCents: gross - payg,
    paygPayableCents: payg,
  };
}

export interface BasReserveInput {
  /** GROSS customer receipts for the period (GST inclusive). */
  grossReceiptsCents: number;
  /**
   * Historical net-GST rate as a percentage of gross receipts. A fallback
   * TIMING assumption only — actual BAS replaces it whenever available.
   */
  netGstReservePercent: number;
  /** PAYG withheld in the period, remitted with the same BAS. */
  paygWithheldCents?: number;
  /** An actual or draft BAS net GST figure. Takes precedence when supplied. */
  actualNetGstCents?: number | null;
}

export interface BasReserveResult {
  grossReceiptsCents: number;
  /** GST to hold back, not available as operating cash. */
  netGstReserveCents: number;
  paygPayableCents: number;
  /** Total expected BAS payment. */
  basPayableCents: number;
  /** Receipts less the GST reserve — what the business may actually spend. */
  operatingCashFromReceiptsCents: number;
  basis: "ACTUAL_BAS" | "ESTIMATED_RATE";
}

/**
 * Split gross receipts into spendable operating cash and a GST reserve.
 *
 * Prefers a lodged or draft BAS figure; falls back to the historical rate.
 */
export function computeBasReserve(input: BasReserveInput): BasReserveResult {
  const gross = Math.max(0, Math.round(input.grossReceiptsCents));
  const payg = Math.max(0, Math.round(input.paygWithheldCents ?? 0));
  const hasActual = input.actualNetGstCents !== undefined && input.actualNetGstCents !== null;
  const netGst = hasActual
    ? Math.max(0, Math.round(input.actualNetGstCents as number))
    : Math.round(gross * (Math.max(0, input.netGstReservePercent) / 100));

  return {
    grossReceiptsCents: gross,
    netGstReserveCents: netGst,
    paygPayableCents: payg,
    basPayableCents: netGst + payg,
    operatingCashFromReceiptsCents: gross - netGst,
    basis: hasActual ? "ACTUAL_BAS" : "ESTIMATED_RATE",
  };
}

/**
 * Cash buckets. Bank cash is not the same as cash available to creditors: it
 * still contains money owed to the ATO and any restricted balances.
 */
export interface CashPositionInput {
  bankCashCents: number;
  gstReserveCents: number;
  paygPayableCents: number;
  /** Gift-card float, deposits — customer money, not the company's to spend. */
  restrictedCents?: number;
}

export interface CashPositionResult {
  bankCashCents: number;
  gstReserveCents: number;
  paygPayableCents: number;
  restrictedCents: number;
  /** Bank cash less GST, PAYG and restricted money. May be negative. */
  operatingCashCents: number;
  /** What could fund a creditor distribution. Never negative. */
  cashAvailableForCreditorsCents: number;
}

export function computeCashPosition(input: CashPositionInput): CashPositionResult {
  const bank = Math.round(input.bankCashCents);
  const gst = Math.max(0, Math.round(input.gstReserveCents));
  const payg = Math.max(0, Math.round(input.paygPayableCents));
  const restricted = Math.max(0, Math.round(input.restrictedCents ?? 0));
  const operating = bank - gst - payg - restricted;
  return {
    bankCashCents: bank,
    gstReserveCents: gst,
    paygPayableCents: payg,
    restrictedCents: restricted,
    operatingCashCents: operating,
    cashAvailableForCreditorsCents: Math.max(0, operating),
  };
}
