// Margin and cash-flow engines.
//
// The margin engine's honesty rule: recipe costing is NOT actual COGS. Where a
// stocktake brackets the period, COGS is computed from stock movement and
// labelled ACCOUNTING_ESTIMATE; where it does not, the theoretical figure is
// returned and labelled as theoretical. The two are never presented as the
// same thing.
//
// The cash engine's honesty rule: bank cash is not spendable cash. GST and
// PAYG collected but not yet remitted are carried as a reserve, and a creditor
// distribution is only ever offered out of what is left.

import { computeCashPosition, computeWageCost } from "./gst.js";

// ── Margin ─────────────────────────────────────────────────────────────────

export interface StocktakeMovement {
  category: string;
  openingStockCents: number;
  purchasesCents: number;
  transfersInCents: number;
  transfersOutCents: number;
  wastageCents: number;
  staffMealsCents: number;
  closingStockCents: number;
}

export interface CogsResult {
  cogsCents: number;
  /** Kept visible rather than buried inside COGS. */
  wastageCents: number;
  staffMealsCents: number;
  basis: "STOCKTAKE" | "THEORETICAL" | "PURCHASES_ONLY";
  /** Plain-English method, for the "where did this come from" panel. */
  method: string;
}

/**
 * Actual COGS from stock movement:
 *   opening + purchases + transfers in − transfers out − closing
 *
 * Wastage and staff meals are reported separately, not netted away, because a
 * venue needs to see them to act on them.
 */
export function cogsFromStocktake(movement: StocktakeMovement): CogsResult {
  const cogs =
    movement.openingStockCents +
    movement.purchasesCents +
    movement.transfersInCents -
    movement.transfersOutCents -
    movement.closingStockCents;
  return {
    cogsCents: cogs,
    wastageCents: movement.wastageCents,
    staffMealsCents: movement.staffMealsCents,
    basis: "STOCKTAKE",
    method: "Opening stock + purchases + transfers in − transfers out − closing stock.",
  };
}

/**
 * Theoretical COGS: recipe cost × units sold.
 *
 * Explicitly NOT actual COGS. Returned so a weekly view has something to show
 * between monthly counts, but labelled so nobody mistakes it for a reconciled
 * figure.
 */
export function cogsTheoretical(recipeCostCents: number): CogsResult {
  return {
    cogsCents: recipeCostCents,
    wastageCents: 0,
    staffMealsCents: 0,
    basis: "THEORETICAL",
    method: "Recipe cost × units sold. NOT reconciled to purchases or a stocktake.",
  };
}

/** Purchases only — the weakest basis, used when no count brackets the period. */
export function cogsFromPurchases(purchasesCents: number): CogsResult {
  return {
    cogsCents: purchasesCents,
    wastageCents: 0,
    staffMealsCents: 0,
    basis: "PURCHASES_ONLY",
    method: "Purchases in the period, with no stocktake to bracket it. Timing of deliveries will distort this.",
  };
}

export interface MarginInput {
  /** GST EXCLUSIVE sales. */
  netSalesExGstCents: number;
  foodCogs: CogsResult;
  beverageCogs: CogsResult;
  grossWagesCents: number;
  paygWithheldCents?: number;
  superPercent: number;
  /** Other operating costs, GST exclusive. */
  otherOperatingCents?: number;
}

export interface MarginResult {
  netSalesExGstCents: number;
  foodCogsCents: number;
  beverageCogsCents: number;
  totalCogsCents: number;
  grossProfitCents: number;
  grossMarginPercent: number | null;
  cogsPercent: number | null;
  grossWagesCents: number;
  superCents: number;
  labourCostCents: number;
  labourPercent: number | null;
  primeCostCents: number;
  primeCostPercent: number | null;
  contributionMarginCents: number;
  operatingResultCents: number;
  cogsBasis: { food: CogsResult["basis"]; beverage: CogsResult["basis"] };
}

/**
 * The margin stack.
 *
 * Labour is gross wages + super. PAYG is NOT added — it is already inside
 * gross wages, and adding it would overstate labour by the withholding.
 */
export function computeMargin(input: MarginInput): MarginResult {
  const sales = Math.max(0, Math.round(input.netSalesExGstCents));
  const totalCogs = input.foodCogs.cogsCents + input.beverageCogs.cogsCents;
  const wages = computeWageCost({
    grossWagesCents: input.grossWagesCents,
    paygWithheldCents: input.paygWithheldCents,
    superPercent: input.superPercent,
  });
  const grossProfit = sales - totalCogs;
  const primeCost = totalCogs + wages.operatingWageCostCents;
  const other = Math.max(0, Math.round(input.otherOperatingCents ?? 0));
  // Rounded to 4dp: percentages here are displayed and compared against
  // targets, and raw float noise (58.599999999999994) reads as a defect.
  const pct = (value: number) => (sales > 0 ? Math.round((value / sales) * 100 * 10_000) / 10_000 : null);

  return {
    netSalesExGstCents: sales,
    foodCogsCents: input.foodCogs.cogsCents,
    beverageCogsCents: input.beverageCogs.cogsCents,
    totalCogsCents: totalCogs,
    grossProfitCents: grossProfit,
    grossMarginPercent: pct(grossProfit),
    cogsPercent: pct(totalCogs),
    grossWagesCents: wages.grossWagesCents,
    superCents: wages.superCents,
    labourCostCents: wages.operatingWageCostCents,
    labourPercent: pct(wages.operatingWageCostCents),
    primeCostCents: primeCost,
    primeCostPercent: pct(primeCost),
    contributionMarginCents: sales - primeCost,
    operatingResultCents: sales - primeCost - other,
    cogsBasis: { food: input.foodCogs.basis, beverage: input.beverageCogs.basis },
  };
}

// ── Cash flow ──────────────────────────────────────────────────────────────

export interface CashMovement {
  date: Date;
  /** Signed: positive in, negative out. */
  amountCents: number;
  category: string;
  description: string;
  /** Where the figure came from, so the UI can label it honestly. */
  provenance: "ACTUAL" | "MODEL_FORECAST" | "MANAGEMENT_ASSUMPTION" | "PROPOSAL_TERM";
  /** Set for receipts carrying GST that must be reserved, not spent. */
  gstReserveCents?: number;
  /** Deduplication key — prevents a bill and its bank payment double counting. */
  dedupeKey?: string;
}

export interface CashFlowPoint {
  date: Date;
  openingCashCents: number;
  inflowsCents: number;
  outflowsCents: number;
  netMovementCents: number;
  closingCashCents: number;
  /** GST collected and not yet remitted, carried forward. */
  gstReserveCents: number;
  /** Closing bank cash less the GST reserve. */
  operatingCashCents: number;
  movements: CashMovement[];
}

export interface CashFlowResult {
  points: CashFlowPoint[];
  /** The worst closing operating-cash position across the horizon. */
  lowestCashCents: number;
  lowestCashDate: Date | null;
  closingCashCents: number;
  closingGstReserveCents: number;
  /** Days where operating cash goes negative. */
  breachDates: Date[];
  duplicatesRemoved: number;
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Project cash day by day from an actual opening bank balance.
 *
 * Double counting is prevented up front: movements sharing a `dedupeKey` are
 * collapsed to one, so a Xero bill, its bank payment and a recurring
 * assumption for the same rent cannot all be charged.
 */
export function projectCashFlow(input: {
  openingBankCents: number;
  openingGstReserveCents?: number;
  startDate: Date;
  days: number;
  movements: CashMovement[];
}): CashFlowResult {
  // Collapse duplicates, keeping the first (an ACTUAL beats a later estimate
  // because the movements are ordered actuals-first by the caller).
  const seen = new Set<string>();
  const deduped: CashMovement[] = [];
  let duplicatesRemoved = 0;
  for (const movement of input.movements) {
    if (movement.dedupeKey) {
      if (seen.has(movement.dedupeKey)) { duplicatesRemoved += 1; continue; }
      seen.add(movement.dedupeKey);
    }
    deduped.push(movement);
  }

  const byDay = new Map<string, CashMovement[]>();
  for (const movement of deduped) {
    const key = dayKey(movement.date);
    const bucket = byDay.get(key) ?? [];
    bucket.push(movement);
    byDay.set(key, bucket);
  }

  const points: CashFlowPoint[] = [];
  let cash = Math.round(input.openingBankCents);
  let gstReserve = Math.max(0, Math.round(input.openingGstReserveCents ?? 0));
  let lowestCash = Number.POSITIVE_INFINITY;
  let lowestCashDate: Date | null = null;
  const breachDates: Date[] = [];

  for (let offset = 0; offset < input.days; offset += 1) {
    const date = new Date(input.startDate.getTime() + offset * 24 * 60 * 60 * 1000);
    const movements = byDay.get(dayKey(date)) ?? [];

    let inflows = 0;
    let outflows = 0;
    for (const movement of movements) {
      if (movement.amountCents >= 0) inflows += movement.amountCents;
      else outflows += Math.abs(movement.amountCents);
      // GST inside a receipt is reserved, not spendable.
      gstReserve += Math.max(0, movement.gstReserveCents ?? 0);
      // A BAS payment releases the reserve it settles.
      if (movement.category === "BAS" && movement.amountCents < 0) {
        gstReserve = Math.max(0, gstReserve - Math.abs(movement.amountCents));
      }
    }

    const opening = cash;
    cash = opening + inflows - outflows;
    const operatingCash = cash - gstReserve;

    if (operatingCash < lowestCash) { lowestCash = operatingCash; lowestCashDate = date; }
    if (operatingCash < 0) breachDates.push(date);

    points.push({
      date,
      openingCashCents: opening,
      inflowsCents: inflows,
      outflowsCents: outflows,
      netMovementCents: inflows - outflows,
      closingCashCents: cash,
      gstReserveCents: gstReserve,
      operatingCashCents: operatingCash,
      movements,
    });
  }

  return {
    points,
    lowestCashCents: Number.isFinite(lowestCash) ? lowestCash : input.openingBankCents,
    lowestCashDate,
    closingCashCents: cash,
    closingGstReserveCents: gstReserve,
    breachDates,
    duplicatesRemoved,
  };
}

/** Expand a recurring commitment into dated cash movements. */
export function expandCommitment(
  commitment: {
    description: string;
    category: string;
    amountCents: number;
    frequency: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONE_OFF";
    startDate: Date;
    endDate?: Date | null;
    paymentDay?: number | null;
  },
  horizon: { start: Date; end: Date },
): CashMovement[] {
  const movements: CashMovement[] = [];
  const stop = commitment.endDate && commitment.endDate < horizon.end ? commitment.endDate : horizon.end;
  const amount = -Math.abs(commitment.amountCents); // commitments are outflows

  const push = (date: Date, index: number) => {
    if (date < horizon.start || date > stop) return;
    movements.push({
      date,
      amountCents: amount,
      category: commitment.category,
      description: commitment.description,
      provenance: "MANAGEMENT_ASSUMPTION",
      dedupeKey: `commitment:${commitment.description}:${dayKey(date)}:${index}`,
    });
  };

  if (commitment.frequency === "ONE_OFF") {
    push(commitment.startDate, 0);
    return movements;
  }

  const stepDays = commitment.frequency === "WEEKLY" ? 7 : commitment.frequency === "FORTNIGHTLY" ? 14 : null;

  if (stepDays) {
    let cursor = new Date(commitment.startDate);
    let index = 0;
    while (cursor <= stop) {
      push(cursor, index);
      cursor = new Date(cursor.getTime() + stepDays * 24 * 60 * 60 * 1000);
      index += 1;
      if (index > 1000) break;
    }
    return movements;
  }

  const monthStep = commitment.frequency === "MONTHLY" ? 1 : commitment.frequency === "QUARTERLY" ? 3 : 12;

  // Step by YEAR/MONTH integers, never by mutating a Date. Advancing a Date
  // sitting on the 31st rolls Feb 31 forward into March and silently SKIPS
  // February — a commitment that quietly misses a month in a cash forecast.
  const startYear = commitment.startDate.getUTCFullYear();
  const startMonth = commitment.startDate.getUTCMonth();
  const anchorDay = commitment.paymentDay ?? commitment.startDate.getUTCDate();

  for (let index = 0; index < 480; index += 1) {
    const monthOffset = index * monthStep;
    const year = startYear + Math.floor((startMonth + monthOffset) / 12);
    const month = (startMonth + monthOffset) % 12;
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const date = new Date(Date.UTC(year, month, Math.min(anchorDay, lastDayOfMonth)));
    if (date > stop) break;
    push(date, index);
  }
  return movements;
}

/**
 * An intercompany payment: an equal and opposite pair, never new group cash.
 * Returns one movement for each entity so neither side can be modelled alone.
 */
export function intercompanyPair(input: {
  date: Date;
  amountCents: number;
  fromCompanyId: string;
  toCompanyId: string;
  reason: string;
}): Array<CashMovement & { companyId: string }> {
  const amount = Math.abs(input.amountCents);
  const key = `intercompany:${input.fromCompanyId}:${input.toCompanyId}:${dayKey(input.date)}:${amount}`;
  return [
    {
      companyId: input.fromCompanyId,
      date: input.date,
      amountCents: -amount,
      category: "INTERCOMPANY",
      description: `Intercompany payment to ${input.toCompanyId}: ${input.reason}`,
      provenance: "MANAGEMENT_ASSUMPTION",
      dedupeKey: `${key}:out`,
    },
    {
      companyId: input.toCompanyId,
      date: input.date,
      amountCents: amount,
      category: "INTERCOMPANY",
      description: `Intercompany receipt from ${input.fromCompanyId}: ${input.reason}`,
      provenance: "MANAGEMENT_ASSUMPTION",
      dedupeKey: `${key}:in`,
    },
  ];
}

/** Cash genuinely available to fund a creditor distribution. */
export function creditorHeadroom(result: CashFlowResult, restrictedCents = 0): number {
  const position = computeCashPosition({
    bankCashCents: result.closingCashCents,
    gstReserveCents: result.closingGstReserveCents,
    paygPayableCents: 0,
    restrictedCents,
  });
  // Never offer more than the worst point across the horizon.
  return Math.max(0, Math.min(position.cashAvailableForCreditorsCents, result.lowestCashCents));
}
