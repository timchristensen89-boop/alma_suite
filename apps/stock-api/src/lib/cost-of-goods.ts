// The Stock dashboard's cost-of-goods summary, pure so the four figures it
// shows — mapped sales, theoretical cost, actual cost, gross profit — are
// each defined once and labelled by what they are. Covered by
// cost-of-goods.test.ts.
//
// Background: the dashboard card "Food & drink cost $4,948.78 · 39.1% of
// sales $143,411.09" put the ACTUAL dollar figure over the THEORETICAL
// percentage. $4,948.78 / $143,411.09 is 3.45%; 39.1% was recipe cost ÷
// sales. Nothing on the payload said which was which, and the API dropped
// the flag that would have marked the actual figure as purchases-only for a
// window no stocktake bracketed. Purchases must never silently become COGS.

import { isSuspectRecipeCost } from '@alma/shared';

export type CogsRecipeInput = {
  id: string;
  /** Recipe.estimatedCost in dollars, as stored (the batch cost). */
  estimatedCost: number | null;
  salePriceCents: number | null;
  actualSales: { quantitySold: number; netSalesCents: number } | null;
};

export type ActualCogsInput = {
  cogsCents: number;
  purchasesCents: number;
  /** Null when the bracket is unavailable — the canonical helper never returns zero for a missing count. */
  openingStockCents: number | null;
  closingStockCents: number | null;
  source: 'stock_bounded' | 'purchases_only';
  quality: 'complete' | 'estimated' | 'missing_opening' | 'missing_closing' | 'stale_opening' | 'stale_closing' | 'closing_implausible';
  /** The canonical helper's own reasons, passed through to the card. */
  reasons?: string[];
};

export type TheoreticalCogsSummary = {
  /** Σ recipe cost × units sold over recipes that sold, minus suspect rows. */
  cogsCents: number;
  /** Net sales of the recipe-mapped Square items that sold (the ONLY sales here). */
  mappedSalesCents: number;
  /** cogsCents / mappedSalesCents, one decimal. */
  percentOfMappedSales: number | null;
  grossProfitCents: number;
  grossProfitPercent: number | null;
  mappedRecipes: number;
  unmappedRecipes: number;
  /** Mapped, sold, but costed at $0 — their sales are in the denominator with no cost. */
  zeroCostRecipes: number;
  /** Costed at or above their take per serve — batch specs costed per serve; excluded. */
  suspectRecipes: number;
  avgMarginPercent: number | null;
};

/**
 * What the two figures actually cover. Actual COGS is a whole-venue (or
 * whole-group) figure over every item bought and counted; theoretical cost
 * and "mapped sales" cover only the recipe-mapped Square items that sold,
 * less the rows excluded as suspect or uncosted. They are only comparable
 * when period, venue and item coverage line up — stocktake completeness on
 * its own says nothing about scope.
 */
export type CogsScopeInput = {
  /** Both sides measured over the same window. */
  periodMatches: boolean;
  /** Both sides measured over the same venue set. */
  venueMatches: boolean;
  /** Net sales of EVERY Square item sold in the window, mapped or not; null when unknown. */
  totalItemSalesCents: number | null;
};

export type CogsComparability = {
  comparable: boolean;
  /** mapped sales ÷ total item sales, one decimal %; null when total is unknown. */
  mappedSalesSharePercent: number | null;
  /** Every reason the figures are not like-for-like, in plain words. Empty when comparable. */
  reasons: string[];
};

export type ActualCogsSummary = ActualCogsInput & {
  /** actual cogsCents / mapped sales. Only a fact when `comparability.comparable`. */
  percentOfMappedSales: number | null;
  /** Gross profit on the actual figure; null unless comparable. */
  grossProfitCents: number | null;
  grossProfitPercent: number | null;
  /** Shorthand for comparability.comparable. */
  comparable: boolean;
  comparability: CogsComparability;
  label: string;
};

export type CostOfGoodsSummary = {
  theoretical: TheoreticalCogsSummary;
  actual: ActualCogsSummary;
  /** actual − theoretical, only when the actual figure is complete. */
  varianceCents: number | null;
  variancePercent: number | null;
};

export function pct1(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function summariseTheoreticalCogs(recipes: CogsRecipeInput[]): TheoreticalCogsSummary {
  let cogsCents = 0;
  let mappedSalesCents = 0;
  let mappedRecipes = 0;
  let unmappedRecipes = 0;
  let zeroCostRecipes = 0;
  let suspectRecipes = 0;
  let marginSum = 0;
  let marginCount = 0;
  for (const recipe of recipes) {
    const sales = recipe.actualSales;
    const qty = sales?.quantitySold ?? 0;
    if (!sales || qty <= 0) {
      unmappedRecipes += 1;
      continue;
    }
    const costCents = Math.round((recipe.estimatedCost ?? 0) * 100);
    // Same guard the Reports menu profitability applies: a recipe that
    // costs at least what it sells for is a batch spec costed per serve,
    // and would push theoretical food cost wildly high.
    if (isSuspectRecipeCost(costCents, sales.netSalesCents, qty)) {
      suspectRecipes += 1;
      continue;
    }
    mappedRecipes += 1;
    if (costCents <= 0) zeroCostRecipes += 1;
    cogsCents += costCents * qty;
    mappedSalesCents += sales.netSalesCents;
    if (recipe.salePriceCents && recipe.salePriceCents > 0) {
      marginSum += ((recipe.salePriceCents - costCents) / recipe.salePriceCents) * 100;
      marginCount += 1;
    }
  }
  const grossProfitCents = mappedSalesCents - cogsCents;
  return {
    cogsCents,
    mappedSalesCents,
    percentOfMappedSales: pct1(cogsCents, mappedSalesCents),
    grossProfitCents,
    grossProfitPercent: pct1(grossProfitCents, mappedSalesCents),
    mappedRecipes,
    unmappedRecipes,
    zeroCostRecipes,
    suspectRecipes,
    avgMarginPercent: marginCount > 0 ? Math.round((marginSum / marginCount) * 10) / 10 : null
  };
}

const ACTUAL_LABELS: Record<ActualCogsInput['quality'], string> = {
  complete: 'Opening stock + purchases − closing stock',
  estimated: 'Supplier bills only — no stocktake brackets this window',
  missing_opening: 'Supplier bills only — no stocktake at the start of the window',
  missing_closing: 'Supplier bills only — no stocktake at the end of the window',
  stale_opening: 'Supplier bills only — the latest stocktake before the window start is older than the 14-day limit',
  stale_closing: 'Supplier bills only — the latest stocktake before the window end is older than the 14-day limit',
  closing_implausible: 'Supplier bills only — the closing stocktake reads higher than opening + purchases'
};

// Mapped sales must be, to rounding, ALL item sales before the whole-venue
// actual figure can be read against them.
const FULL_COVERAGE_SHARE = 99.5;

export function assessCogsComparability(input: {
  actual: ActualCogsInput;
  theoretical: TheoreticalCogsSummary;
  scope: CogsScopeInput;
}): CogsComparability {
  const { actual, theoretical, scope } = input;
  const reasons: string[] = [];
  // The canonical helper's dated reasons win over the generic label.
  if (actual.quality !== 'complete') reasons.push(...(actual.reasons?.length ? actual.reasons : [ACTUAL_LABELS[actual.quality].toLowerCase()]));
  if (!scope.periodMatches) reasons.push('the two figures cover different periods');
  if (!scope.venueMatches) reasons.push('the actual figure covers a different venue set from the mapped sales');
  const share =
    scope.totalItemSalesCents == null ? null : pct1(Math.min(theoretical.mappedSalesCents, scope.totalItemSalesCents), scope.totalItemSalesCents);
  if (share == null) reasons.push('total item sales for the window are unknown, so item coverage cannot be confirmed');
  else if (share < FULL_COVERAGE_SHARE) reasons.push(`recipe-mapped items are ${share}% of item sales — the actual figure covers everything bought`);
  if (theoretical.suspectRecipes > 0) reasons.push(`${theoretical.suspectRecipes} batch-costed recipe${theoretical.suspectRecipes === 1 ? '' : 's'} excluded from the theoretical side`);
  if (theoretical.zeroCostRecipes > 0) reasons.push(`${theoretical.zeroCostRecipes} recipe${theoretical.zeroCostRecipes === 1 ? '' : 's'} sold with no cost on the theoretical side`);
  return { comparable: reasons.length === 0, mappedSalesSharePercent: share, reasons };
}

export function summariseActualCogs(actual: ActualCogsInput, theoretical: TheoreticalCogsSummary, scope: CogsScopeInput): ActualCogsSummary {
  const comparability = assessCogsComparability({ actual, theoretical, scope });
  const mappedSalesCents = theoretical.mappedSalesCents;
  const grossProfitCents = comparability.comparable ? mappedSalesCents - actual.cogsCents : null;
  return {
    ...actual,
    percentOfMappedSales: comparability.comparable ? pct1(actual.cogsCents, mappedSalesCents) : null,
    grossProfitCents,
    grossProfitPercent: grossProfitCents == null ? null : pct1(grossProfitCents, mappedSalesCents),
    comparable: comparability.comparable,
    comparability,
    label: ACTUAL_LABELS[actual.quality]
  };
}

export function summariseCostOfGoods(input: { recipes: CogsRecipeInput[]; actual: ActualCogsInput; scope: CogsScopeInput }): CostOfGoodsSummary {
  const theoretical = summariseTheoreticalCogs(input.recipes);
  const actual = summariseActualCogs(input.actual, theoretical, input.scope);
  const varianceCents = actual.comparable ? actual.cogsCents - theoretical.cogsCents : null;
  return {
    theoretical,
    actual,
    varianceCents,
    variancePercent: varianceCents == null || theoretical.cogsCents <= 0 ? null : pct1(varianceCents, theoretical.cogsCents)
  };
}
