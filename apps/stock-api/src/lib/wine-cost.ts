/**
 * What a pour of wine costs us, worked out from what the bottle cost.
 *
 * The stocktake sheets price a bottle. The register sells 150mL, 250mL and
 * 750mL of the same wine, and the wine report's margin column is only as good
 * as the cost sitting on each of those items — so the bottle price has to be
 * divided down to the pour before it is written anywhere.
 *
 * Pure, and tested, because every number here ends up in a margin figure Tim
 * makes buying decisions from.
 */

/** A standard bottle. Everything on both lists is one except the Muscat. */
export const BOTTLE_ML = 750;

/**
 * Cost of one pour, in dollars, from the bottle's ex-GST cost.
 *
 * Straight proportion — no allowance for the last inch of the bottle or for a
 * heavy pour. Both are real, both vary by who is pouring, and inventing a
 * number for them would make the margin look precise when it is not. A wine
 * poured 5% heavy shows 5% worse margin, which is the truth.
 */
export function pourCost(bottleCostDollars: number, ml: number): number {
  if (!(bottleCostDollars > 0) || !(ml > 0)) return 0;
  return Math.round(bottleCostDollars * (ml / BOTTLE_ML) * 100) / 100;
}

/**
 * A stocktake line is priced per bottle, but the sheet does not say what size
 * that bottle is. A pour LARGER than a standard bottle is the tell that it is
 * not one — a 1500mL magnum priced as "a bottle" would otherwise cost out at
 * double. Those are reported rather than guessed at.
 */
export function suspiciousPour(ml: number): boolean {
  return ml > BOTTLE_ML;
}

/**
 * Gross margin on a pour, as a percentage of what the guest pays.
 *
 * NULL when the wine sells for nothing (a $0 package inclusion), because a
 * margin on no revenue is not 0% — it is not a number at all, and showing 0%
 * would drag a venue's average down for wines nobody was charged for.
 */
export function marginPercent(salePriceDollars: number, costDollars: number): number | null {
  if (!(salePriceDollars > 0)) return null;
  return ((salePriceDollars - costDollars) / salePriceDollars) * 100;
}
