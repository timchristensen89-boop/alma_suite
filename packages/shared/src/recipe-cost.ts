// What one sold serve of a recipe costs, defined once. Covered by
// recipe-cost.test.ts (apps/api/src/lib) and cost-of-goods.test.ts.
//
// `Recipe.estimatedCost` is the BATCH cost in dollars: the recipe editor
// (`refreshRecipeEstimatedCost`) stores the sum of the ingredient lines
// there, and sub-recipe lines and the manual-cost fallback read it as a
// batch. A batch of guacamole that yields 40 portions costs 40× what a
// serve costs. Theoretical COGS, menu profitability, the forecast's
// theoretical food-cost %, the dish-margin page and POS wastage costing
// were multiplying the batch cost by units sold — which is why a
// "suspect" guard had to throw away every recipe that appeared to cost
// more than it sold for. The guard remains as a data-quality signal;
// this is the fix.
//
// The portion rule is the recipe editor's own (`calculateRecipeCost`):
//   portions = yieldQuantity ÷ portionSize   when both are set,
//            = yieldQuantity                 when only the yield is set,
//            = 1                             otherwise (a single-serve dish).
// A recipe whose yield is recorded in grams with no portion size divides
// by that gram count; that is an input error the recipe editor already
// warns about, not something this helper can repair.

export type RecipePortionInput = {
  /** Batch cost in dollars, as stored on Recipe.estimatedCost. */
  estimatedCost: number | null | undefined;
  yieldQuantity: number | null | undefined;
  portionSize: number | null | undefined;
};

/** How many serves the batch yields under the editor's rule; always ≥ 1. */
export function recipePortions(recipe: Pick<RecipePortionInput, 'yieldQuantity' | 'portionSize'>): number {
  const y = recipe.yieldQuantity ?? 0;
  const p = recipe.portionSize ?? 0;
  if (y > 0 && p > 0) return y / p;
  if (y > 0) return y;
  return 1;
}

/** Cost of one serve in cents, or null when the recipe carries no cost. */
export function recipePortionCostCents(recipe: RecipePortionInput): number | null {
  const batch = recipe.estimatedCost;
  if (batch == null || !Number.isFinite(batch) || batch <= 0) return null;
  return Math.round((batch * 100) / recipePortions(recipe));
}

/** Batch cost in cents, or null when the recipe carries no cost. */
export function recipeBatchCostCents(recipe: Pick<RecipePortionInput, 'estimatedCost'>): number | null {
  const batch = recipe.estimatedCost;
  if (batch == null || !Number.isFinite(batch) || batch <= 0) return null;
  return Math.round(batch * 100);
}
