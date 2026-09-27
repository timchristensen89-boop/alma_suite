// How old a finalised stocktake may be before the suite stops trusting it,
// in one place so every surface applies the SAME rule.
//
// The stocktake status widgets (stock-api `stocktakesService.venueStatus`,
// api `reportsService.stocktakeStatus`) have always graded a venue's latest
// locked count "partial" once it is more than 14 days old. Actual COGS reuses
// that same limit for its brackets: a count is an opening or closing figure
// for a period only when it was taken within this many days BEFORE the
// boundary. Before this, `stockValueAtCents` took the latest count of any
// age, so a March count bracketed both ends of June, opening equalled
// closing, COGS collapsed to purchases and the figure was labelled complete.

export const STOCKTAKE_STALE_DAYS = 14;

/** A count older than this, measured back from the period boundary, cannot bracket it. */
export const STOCKTAKE_BRACKET_TOLERANCE_DAYS = STOCKTAKE_STALE_DAYS;

const DAY_MS = 86_400_000;

/** Whole days from the count to the boundary (negative when the count is after it). */
export function stocktakeAgeDays(countedAt: Date, at: Date): number {
  return Math.floor((at.getTime() - countedAt.getTime()) / DAY_MS);
}

export function stocktakeBracketsBoundary(countedAt: Date, at: Date, toleranceDays = STOCKTAKE_BRACKET_TOLERANCE_DAYS): boolean {
  const age = stocktakeAgeDays(countedAt, at);
  return age >= 0 && age <= toleranceDays;
}
