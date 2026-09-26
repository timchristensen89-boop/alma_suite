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
  openingStockCents: number;
  closingStockCents: number;
  source: 'stock_bounded' | 'purchases_only';
  quality: 'complete' | 'estimated' | 'missing_opening' | 'missing_closing' | 'closing_implausible';
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

export type ActualCogsSummary = ActualCogsInput & {
  /** actual cogsCents / mapped sales. Only a fact when quality is 'complete'. */
  percentOfMappedSales: number | null;
  /** Gross profit on the actual figure; null unless the actual figure is complete. */
  grossProfitCents: number | null;
  grossProfitPercent: number | null;
  /** Whether the actual figure is comparable with the theoretical one. */
  comparable: boolean;
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
  closing_implausible: 'Supplier bills only — the closing stocktake reads higher than opening + purchases'
};

export function summariseActualCogs(actual: ActualCogsInput, mappedSalesCents: number): ActualCogsSummary {
  const comparable = actual.quality === 'complete';
  const grossProfitCents = comparable ? mappedSalesCents - actual.cogsCents : null;
  return {
    ...actual,
    percentOfMappedSales: pct1(actual.cogsCents, mappedSalesCents),
    grossProfitCents,
    grossProfitPercent: grossProfitCents == null ? null : pct1(grossProfitCents, mappedSalesCents),
    comparable,
    label: ACTUAL_LABELS[actual.quality]
  };
}

export function summariseCostOfGoods(input: { recipes: CogsRecipeInput[]; actual: ActualCogsInput }): CostOfGoodsSummary {
  const theoretical = summariseTheoreticalCogs(input.recipes);
  const actual = summariseActualCogs(input.actual, theoretical.mappedSalesCents);
  const varianceCents = actual.comparable ? actual.cogsCents - theoretical.cogsCents : null;
  return {
    theoretical,
    actual,
    varianceCents,
    variancePercent: varianceCents == null || theoretical.cogsCents <= 0 ? null : pct1(varianceCents, theoretical.cogsCents)
  };
}
