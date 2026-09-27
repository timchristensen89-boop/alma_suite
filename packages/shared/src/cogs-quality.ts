// Shared COGS data-quality guards, pure so the forecast engine, the menu
// profitability report and the tests all apply the SAME rule. Covered by
// cogs-quality.test.ts.
//
// Background: a handful of menu recipes are batch/prep specs costed per serve
// (e.g. Guacamole costed as two whole avocado trays, a cocktail as a full 1L
// bottle of spirit). Those rows report a per-serve cost at or above the
// per-serve take, which is impossible for a real menu item and, left in,
// pushed theoretical food cost wildly high (39%+). This module is the single
// definition of "that row is a costing error" so the two surfaces can never
// drift apart.

// True when a recipe's costed value for the units actually sold meets or
// exceeds the net revenue those units earned — i.e. the recipe is priced to
// lose money on every serve, which in practice always means a batch recipe
// costed per serve rather than a genuinely unprofitable dish.
//
// `costCentsPerServe` is the recipe's estimatedCost in cents (per one serve).
// `netCents` is the net (ex-discount) revenue for the whole row.
// `quantitySold` is the number of serves the row covers.
export function isSuspectRecipeCost(
  costCentsPerServe: number,
  netCents: number,
  quantitySold: number
): boolean {
  if (costCentsPerServe <= 0 || quantitySold <= 0 || netCents <= 0) return false;
  return costCentsPerServe * quantitySold >= netCents;
}

// Assumed cost % for takings NOT covered by recipe-mapped items — mostly
// bottled wine and beer resale, which typically runs 35-40% cost in AU venues.
export const UNMAPPED_TAKINGS_COGS_PCT = 38;

// Blended theoretical food-cost %: real recipe costs for the recipe-mapped
// slice of takings, plus a standard beverage-resale margin for the rest
// (unmapped items are mostly bottled wine/beer, which run far dearer than the
// cocktail-and-food mix that dominates the mapped set). Suspect batch-costed
// rows are excluded from both numerator and denominator by the caller before
// this is summed. Returns null when the mapped slice is too thin to trust.
//
// Clamped to a sane 18-45% band and returned rounded to one decimal.
export function blendedTheoreticalCogsPct(input: {
  mappedCostCents: number;
  mappedNetCents: number;
  totalSalesCents: number;
  minMappedShare?: number;
}): number | null {
  const { mappedCostCents, mappedNetCents, totalSalesCents } = input;
  const minMappedShare = input.minMappedShare ?? 0.25;
  if (mappedNetCents <= 0 || totalSalesCents <= 0) return null;
  const mappedShare = Math.min(1, mappedNetCents / totalSalesCents);
  if (mappedShare < minMappedShare) return null;
  const mappedPct = (mappedCostCents / mappedNetCents) * 100;
  const blendedPct = mappedPct * mappedShare + UNMAPPED_TAKINGS_COGS_PCT * (1 - mappedShare);
  return Math.round(Math.min(45, Math.max(18, blendedPct)) * 10) / 10;
}
