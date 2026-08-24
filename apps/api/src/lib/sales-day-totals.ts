/**
 * One figure of takings per venue-day, however many feeds reported it.
 *
 * A day's takings can arrive from more than one source (the POS close, the
 * emailed Lightspeed summary, a manual entry). They describe the SAME money,
 * so the best-known figure per venue-day is the MAX, never the sum — summing
 * across sources double-counts every day two feeds cover, which quietly
 * inflated the recap/prime-cost/sales totals while the labour view (which
 * already took the max) disagreed with them for the same venue and day.
 *
 * This is that labour-view rule, extracted so every report reads the same
 * number. Pure and tested (sales-day-totals.test.ts).
 */

export type VenueDaySale = { venue: string; serviceDate: Date; salesCents: number };

/** `${venue}|${YYYY-MM-DD}` → the best-known takings for that venue-day. */
export function bestVenueDaySales(rows: readonly VenueDaySale[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.venue}|${row.serviceDate.toISOString().slice(0, 10)}`;
    best.set(key, Math.max(best.get(key) ?? 0, row.salesCents));
  }
  return best;
}

/** Total takings over the rows, one figure per venue-day. */
export function dedupedSalesCents(rows: readonly VenueDaySale[]): number {
  let total = 0;
  for (const value of bestVenueDaySales(rows).values()) total += value;
  return total;
}

/** Per-venue totals and distinct trading days, one figure per venue-day. */
export function dedupedSalesByVenue(rows: readonly VenueDaySale[]): Map<string, { salesCents: number; days: number }> {
  const byVenue = new Map<string, { salesCents: number; days: number }>();
  for (const [key, cents] of bestVenueDaySales(rows)) {
    const venue = key.slice(0, key.lastIndexOf('|'));
    const entry = byVenue.get(venue) ?? { salesCents: 0, days: 0 };
    entry.salesCents += cents;
    entry.days += 1;
    byVenue.set(venue, entry);
  }
  return byVenue;
}
