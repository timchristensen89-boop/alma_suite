// Prime cost, defined once for the Monthly Recap, the Prime Cost report and
// anything else that adds labour to food. Covered by prime-cost.test.ts
// (apps/api/src/lib).
//
//   prime cost = labour + actual food COGS
//
// and ONLY that. Actual food COGS is the stocktake-bounded figure (opening +
// purchases − closing, both brackets valid) over a period whose supplier
// invoices are complete. When that figure is not available the prime cost is
// unavailable — not labour + purchases (which understates by whatever stock
// moved), and not labour + theoretical recipe cost (which is a different
// measurement and stays labelled theoretical wherever it is shown).
//
// Background: the Recap computed `wages + cogsCents` whatever `cogsCents`
// was, and divided by sales unconditionally, so a month with no stocktake
// showed "prime cost 31.8%" built on three weeks of bills.

export type LabourBasis =
  /** Timesheet hours × pay rates (+ salaried share). */
  | 'timesheets'
  /** Roster shifts × pay rates, standing in because no timesheets exist. */
  | 'roster_estimate'
  /** Nothing to cost. */
  | 'missing';

export type FoodCostInput = {
  cogsCents: number;
  purchasesCents: number;
  source: 'stock_bounded' | 'purchases_only';
  quality: string;
  /** The canonical helper's own reasons, when it has them. */
  reasons?: ReadonlyArray<string>;
};

export type PrimeCostInput = {
  salesCents: number;
  labour: { cents: number; basis: LabourBasis };
  food: FoodCostInput;
  /** 0–1: the fraction of the period supplier invoices cover; omit when unknown. */
  purchaseCoverage?: number | null;
  /** Below this coverage a food figure is not the period's; defaults to MIN_PURCHASE_COVERAGE. */
  minPurchaseCoverage?: number;
};

export type PrimeCostResolution = {
  labourCents: number;
  labourBasis: LabourBasis;
  /** 'actual' = stocktake-bounded and covered; otherwise the food figure is bills only and prime is withheld. */
  foodBasis: 'actual' | 'unavailable';
  /** Actual food COGS in cents; null when unavailable. The purchases figure is always in `purchasesCents`. */
  foodCostCents: number | null;
  purchasesCents: number;
  primeCostCents: number | null;
  /** Labour ÷ sales stands on its own (both span the period). */
  wagePercent: number | null;
  foodCostPercent: number | null;
  primeCostPercent: number | null;
  /** Why prime is unavailable, in operator words. Empty when it is a fact. */
  reasons: string[];
};

/** Below this fraction of the period, purchases are not the period's purchases. */
export const MIN_PURCHASE_COVERAGE = 0.9;

export function pct1(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function resolvePrimeCost(input: PrimeCostInput): PrimeCostResolution {
  const { salesCents, labour, food } = input;
  const minCoverage = input.minPurchaseCoverage ?? MIN_PURCHASE_COVERAGE;
  const reasons: string[] = [];

  const bounded = food.source === 'stock_bounded' && food.quality === 'complete';
  if (!bounded) {
    reasons.push(...(food.reasons?.length ? food.reasons : ['Food cost is supplier bills only — no finalised stocktake brackets the period.']));
  }
  const coverage = input.purchaseCoverage;
  if (coverage != null && coverage < minCoverage) {
    reasons.push(`Supplier invoices cover ${Math.round(coverage * 100)}% of the period, so the purchases are not the period's purchases.`);
  }
  if (labour.basis === 'missing') reasons.push('No timesheets or roster shifts to cost labour from.');

  const foodBasis: PrimeCostResolution['foodBasis'] = bounded && (coverage == null || coverage >= minCoverage) ? 'actual' : 'unavailable';
  const foodCostCents = foodBasis === 'actual' ? food.cogsCents : null;
  const primeCostCents = foodCostCents == null || labour.basis === 'missing' ? null : labour.cents + foodCostCents;

  return {
    labourCents: labour.cents,
    labourBasis: labour.basis,
    foodBasis,
    foodCostCents,
    purchasesCents: food.purchasesCents,
    primeCostCents,
    wagePercent: labour.basis === 'missing' ? null : pct1(labour.cents, salesCents),
    foodCostPercent: foodCostCents == null ? null : pct1(foodCostCents, salesCents),
    primeCostPercent: primeCostCents == null ? null : pct1(primeCostCents, salesCents),
    reasons
  };
}

const WEEK_MS = 7 * 86_400_000;

/**
 * Weeks of [start, end) that have elapsed by `now`, for costs booked as a
 * fixed amount per week (salaries). A half-elapsed month carries half its
 * salaries, the same way it carries half its sales — a full month of
 * salaries against ten days of takings read as a labour blow-out on the
 * 10th of every month. Never negative, never more than the period.
 */
export function elapsedPeriodWeeks(start: Date, end: Date, now: Date = new Date()): number {
  const stop = Math.min(end.getTime(), now.getTime());
  return Math.max(0, (stop - start.getTime()) / WEEK_MS);
}
