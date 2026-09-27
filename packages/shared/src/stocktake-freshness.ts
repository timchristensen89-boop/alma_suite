// How old a finalised stocktake may be before the suite stops trusting it,
// in one place so every surface applies the SAME rule.
//
// The stocktake status widgets (stock-api `stocktakesService.venueStatus`,
// api `reportsService.stocktakeStatus`) have always graded a venue's latest
// locked count "partial" once it is more than 14 days old. That is
// OPERATIONAL freshness ("how recently was this venue counted?").
//
// Period boundaries are a different question ("is there a count AT the
// month end?") and use STOCKTAKE_BOUNDARY_WINDOW_DAYS (±7, symmetric) from
// stocktake-scope.ts. Before either rule existed, `stockValueAtCents` took
// the latest count of any age, so a March count bracketed both ends of
// June, opening equalled closing, COGS collapsed to purchases and the figure
// was labelled complete.

export const STOCKTAKE_STALE_DAYS = 14;

const DAY_MS = 86_400_000;

/** Whole days from the count to the boundary (negative when the count is after it). */
export function stocktakeAgeDays(countedAt: Date, at: Date): number {
  return Math.floor((at.getTime() - countedAt.getTime()) / DAY_MS);
}

/** Whole days between the count and the boundary, either side: 0 on the boundary day. */
export function stocktakeDistanceDays(countedAt: Date, at: Date): number {
  return Math.floor(Math.abs(at.getTime() - countedAt.getTime()) / DAY_MS);
}
