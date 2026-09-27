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
// A recipe whose yield is recorded by weight or volume (g, kg, mL, L) with
// no serve size has NO per-serve cost: dividing the batch by the gram count
// would be a knowingly invalid number. Such a recipe is excluded with the
// reason `Serve size required` and counted so the recipe can be fixed. A
// warning beside an invalid cost is not acceptable (decision, Sept 2026).

import { isMeasureUnit } from './stock-units.js';

export type RecipePortionInput = {
  /** Batch cost in dollars, as stored on Recipe.estimatedCost. */
  estimatedCost: number | null | undefined;
  yieldQuantity: number | null | undefined;
  /** The yield's unit: a measure (g, kg, mL, L) needs a serve size; a count (serves, each) is the serve count. */
  yieldUnit?: string | null | undefined;
  portionSize: number | null | undefined;
};

export type RecipePortionCostReason = 'ok' | 'uncosted' | 'serve_size_required';
export const SERVE_SIZE_REQUIRED = 'Serve size required';

export type RecipePortionCost = {
  /** Cost of one serve in cents; null with a reason otherwise. */
  cents: number | null;
  reason: RecipePortionCostReason;
  /** Operator wording for the reason, e.g. "Serve size required". */
  label: string | null;
};

/** True when the yield is by weight/volume and no serve size says how big a serve is. */
export function serveSizeRequired(recipe: Pick<RecipePortionInput, 'yieldQuantity' | 'yieldUnit' | 'portionSize'>): boolean {
  const y = recipe.yieldQuantity ?? 0;
  const p = recipe.portionSize ?? 0;
  return y > 0 && !(p > 0) && isMeasureUnit(recipe.yieldUnit ?? null);
}

/** One serve's cost with the reason when there is none. The rule every consumer reads. */
export function recipePortionCost(recipe: RecipePortionInput): RecipePortionCost {
  const batch = recipe.estimatedCost;
  if (batch == null || !Number.isFinite(batch) || batch <= 0) return { cents: null, reason: 'uncosted', label: 'No cost on the recipe' };
  if (serveSizeRequired(recipe)) return { cents: null, reason: 'serve_size_required', label: SERVE_SIZE_REQUIRED };
  return { cents: Math.round((batch * 100) / recipePortions(recipe)), reason: 'ok', label: null };
}

/** How many serves the batch yields under the editor's rule; always ≥ 1. */
export function recipePortions(recipe: Pick<RecipePortionInput, 'yieldQuantity' | 'portionSize'>): number {
  const y = recipe.yieldQuantity ?? 0;
  const p = recipe.portionSize ?? 0;
  if (y > 0 && p > 0) return y / p;
  if (y > 0) return y;
  return 1;
}

/** Cost of one serve in cents, or null when the recipe carries no cost or needs a serve size. */
export function recipePortionCostCents(recipe: RecipePortionInput): number | null {
  return recipePortionCost(recipe).cents;
}

/** Batch cost in cents, or null when the recipe carries no cost. */
export function recipeBatchCostCents(recipe: Pick<RecipePortionInput, 'estimatedCost'>): number | null {
  const batch = recipe.estimatedCost;
  if (batch == null || !Number.isFinite(batch) || batch <= 0) return null;
  return Math.round(batch * 100);
}
