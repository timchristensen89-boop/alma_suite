// The arithmetic and the rules behind actual (financial) Cost of Goods Sold,
// kept free of Prisma so the relationships can be tested against a fake
// reader. `cogs.ts` supplies the Prisma-backed reader and is the module the
// apps import. Covered by cogs-core.test.ts.
//
// The relationship every caller relies on:
//
//   actual COGS = opening stock + purchases − closing stock
//
// and it only holds when BOTH brackets are real counts for the period:
//
//   • a bracket is the latest finalised (SUBMITTED / REVIEWED / LOCKED) count
//     on or before the boundary, and it must be no older than
//     STOCKTAKE_BRACKET_TOLERANCE_DAYS (the suite's existing 14-day
//     "stale stocktake" rule). A March count is not June's opening stock.
//     Before this rule, the latest count of ANY age bracketed both ends, so
//     opening equalled closing, COGS collapsed to purchases, and the figure
//     was labelled complete.
//   • a venue's count is split across sessions on the same VENUE day (bar
//     and kitchen, minutes apart), so the sessions of that day are summed —
//     on the Sydney day, not the server's. The containers run UTC, so a
//     server-local day split a 9am and a 10am Sydney session that fell either
//     side of UTC midnight.
//   • the all-venues figure sums each CONFIGURED venue's bracket. The group
//     population is the configured venues (the Venue table) plus explicitly
//     reported unattributed data — never every distinct string ever written
//     into a stocktake's venue field. "Both", "Unspecified", a Loaded
//     location name: those are off-venue counts, listed for remediation,
//     neither required to bracket the group nor folded into it. A stored
//     label resolves to a configured venue only through the shared
//     venue-resolution rules (exact after normalisation, or an explicit
//     alias). When any configured venue has no valid bracket, the group
//     figure is missing and says which venue is short — never the sum of
//     the others.
//
// When a bracket is unavailable the figure falls back to purchases only and
// `quality` says exactly which bracket failed and why; `reasons` spells it
// out in operator language.

import {
  STOCKTAKE_BRACKET_TOLERANCE_DAYS,
  resolveVenueLabel,
  stocktakeAgeDays,
  venueDayBounds,
  venueDayKey,
  type VenueResolutionStatus
} from '@alma/shared';

export type CogsSource = 'stock_bounded' | 'purchases_only';

// 'complete' = both brackets present and plausible. Every other value names
// the bracket that failed (missing = no finalised count on or before the
// boundary; stale = the latest count is older than the tolerance) so callers
// can surface "COGS is purchases only because …" honestly. 'estimated' =
// neither bracket is usable.
export type CogsQuality =
  | 'complete'
  | 'estimated'
  | 'missing_opening'
  | 'missing_closing'
  | 'stale_opening'
  | 'stale_closing'
  | 'closing_implausible';

export type StockBracketStatus = 'ok' | 'missing' | 'stale';

/** A finalised count whose stored venue label is not a configured venue. */
export type OffVenueCount = {
  sourceLabel: string;
  resolution: Exclude<VenueResolutionStatus, 'canonical' | 'alias'>;
  countedOn: string;
  valueCents: number;
};

export type StockBracket = {
  status: StockBracketStatus;
  /** Sum of the venue's (or every venue's) finalised sessions on the count day; null unless status is 'ok'. */
  valueCents: number | null;
  /** Venue-day key of the count that was used or rejected; null when no count exists. */
  countedOn: string | null;
  /** Whole days between that count and the boundary; null when no count exists. */
  ageDays: number | null;
  toleranceDays: number;
  /** All-venues only: configured venues whose bracket is missing or stale, with why. */
  venuesWithoutCount: Array<{ venue: string; status: Exclude<StockBracketStatus, 'ok'>; countedOn: string | null; ageDays: number | null }>;
  /** All-venues only: finalised counts on or before the boundary whose venue label is not a configured venue. Reported, never required, never summed. */
  offVenueCounts: OffVenueCount[];
};

export type ActualCogs = {
  cogsCents: number;
  purchasesCents: number;
  /** Null when the bracket is unavailable — never zero, which reads as "no stock". */
  openingStockCents: number | null;
  closingStockCents: number | null;
  openingStockAvailable: boolean;
  closingStockAvailable: boolean;
  opening: StockBracket;
  closing: StockBracket;
  source: CogsSource;
  quality: CogsQuality;
  /** Why the figure is not a complete opening + purchases − closing, in plain words. Empty when complete. */
  reasons: string[];
  /**
   * Venue-scoped figures only: finalised stock purchases in the window that
   * carry NO venue and so are in the group figure but in no venue's. Zero for
   * the all-venues figure. A venue figure with unattributed purchases is
   * incomplete for that venue, and the group is Σ venues + this.
   */
  unattributedPurchasesCents: number;
  unattributedInvoiceCount: number;
};

/** The minimal data access the arithmetic needs; cogs.ts implements it on Prisma. */
export type CogsReader = {
  /** The configured venues — the canonical population (Venue table). */
  configuredVenues(): Promise<string[]>;
  /** Every distinct venue label stored on a finalised count on or before `at` (null included as ''). */
  storedCountVenueLabels(at: Date): Promise<string[]>;
  /** The latest finalised count under any of the given stored labels, on or before `at` (any age). */
  latestFinalisedCount(venueLabels: string[], at: Date): Promise<{ countedAt: Date } | null>;
  /** Ids of every finalised count under the labels inside the window and on or before `at`. */
  finalisedCountIdsBetween(venueLabels: string[], window: { gte: Date; lt: Date }, at: Date): Promise<string[]>;
  /** Σ stockValueCents over the lines of those counts. */
  lineValueCents(stocktakeIds: string[]): Promise<number>;
  /** Finalised counts under the given (off-venue) labels on or before `at`: one row per count day, valued. */
  countsUnderLabels(venueLabels: string[], at: Date): Promise<Array<{ label: string; countedAt: Date; valueCents: number }>>;
  /** Ex-GST finalised stock purchases in [start, end); venue null = all, including untagged invoices. */
  purchasesExGstCents(venue: string | null, start: Date, end: Date): Promise<number>;
  /** Finalised stock purchases in [start, end) with no venue on the invoice. */
  unattributedPurchases(start: Date, end: Date): Promise<{ cents: number; invoices: number }>;
};

const fmtDay = (at: Date) => venueDayKey(at);
const none = (toleranceDays: number): StockBracket => ({
  status: 'missing', valueCents: null, countedOn: null, ageDays: null, toleranceDays, venuesWithoutCount: [], offVenueCounts: []
});

/**
 * Which stored labels belong to which configured venue, and which belong to
 * none. Resolution is the shared rule (exact after normalisation, explicit
 * alias); nothing is guessed. Historical records are read through this map
 * and never rewritten.
 */
export async function partitionCountLabels(reader: CogsReader, at: Date): Promise<{
  configured: string[];
  labelsByVenue: Map<string, string[]>;
  offVenue: Array<{ label: string; resolution: OffVenueCount['resolution'] }>;
}> {
  const [configured, labels] = await Promise.all([reader.configuredVenues(), reader.storedCountVenueLabels(at)]);
  const labelsByVenue = new Map<string, string[]>(configured.map((venue) => [venue, []]));
  const offVenue: Array<{ label: string; resolution: OffVenueCount['resolution'] }> = [];
  for (const label of labels) {
    const resolved = resolveVenueLabel(label, configured);
    if (resolved.venue) labelsByVenue.get(resolved.venue)!.push(label);
    else offVenue.push({ label, resolution: resolved.status === 'pseudo' || resolved.status === 'blank' ? resolved.status : 'unknown' });
  }
  return { configured, labelsByVenue, offVenue };
}

async function bracketForLabels(reader: CogsReader, labels: string[], at: Date, toleranceDays: number): Promise<StockBracket> {
  if (labels.length === 0) return none(toleranceDays);
  const latest = await reader.latestFinalisedCount(labels, at);
  if (!latest) return none(toleranceDays);
  const countedOn = fmtDay(latest.countedAt);
  const ageDays = stocktakeAgeDays(latest.countedAt, at);
  if (ageDays > toleranceDays) {
    return { ...none(toleranceDays), status: 'stale', countedOn, ageDays };
  }
  // Every session the venue recorded on that venue day, not just the last one.
  const day = venueDayBounds(countedOn);
  const ids = day ? await reader.finalisedCountIdsBetween(labels, day, at) : [];
  const valueCents = ids.length ? await reader.lineValueCents(ids) : 0;
  return { ...none(toleranceDays), status: 'ok', valueCents, countedOn, ageDays };
}

/** One configured venue's bracket at a boundary, reading every stored label that resolves to it. */
export async function venueStockBracket(
  reader: CogsReader,
  venue: string,
  at: Date,
  toleranceDays = STOCKTAKE_BRACKET_TOLERANCE_DAYS
): Promise<StockBracket> {
  const { labelsByVenue, configured } = await partitionCountLabels(reader, at);
  const canonical = configured.find((name) => resolveVenueLabel(name, configured).venue === resolveVenueLabel(venue, configured).venue);
  const labels = canonical ? labelsByVenue.get(canonical) ?? [] : [];
  return bracketForLabels(reader, labels, at, toleranceDays);
}

/** The bracket for one venue, or the sum over every venue that has ever counted. */
export async function stockBracket(
  reader: CogsReader,
  venue: string | null,
  at: Date,
  toleranceDays = STOCKTAKE_BRACKET_TOLERANCE_DAYS
): Promise<StockBracket> {
  if (venue != null) return venueStockBracket(reader, venue, at, toleranceDays);
  // Group population = configured venues + explicitly reported off-venue counts.
  const { configured: venues, labelsByVenue, offVenue } = await partitionCountLabels(reader, at);
  const offVenueRows = offVenue.length ? await reader.countsUnderLabels(offVenue.map((o) => o.label), at) : [];
  const offVenueCounts: OffVenueCount[] = offVenueRows.map((row) => ({
    sourceLabel: row.label,
    resolution: offVenue.find((o) => o.label === row.label)?.resolution ?? 'unknown',
    countedOn: fmtDay(row.countedAt),
    valueCents: row.valueCents
  }));
  if (venues.length === 0) {
    return { ...none(toleranceDays), offVenueCounts };
  }
  const brackets = await Promise.all(venues.map((name) => bracketForLabels(reader, labelsByVenue.get(name) ?? [], at, toleranceDays)));
  const short: StockBracket['venuesWithoutCount'] = [];
  let sum = 0;
  let oldest: { countedOn: string; ageDays: number } | null = null;
  brackets.forEach((bracket, index) => {
    const name = venues[index] as string;
    if (bracket.status !== 'ok') {
      short.push({ venue: name, status: bracket.status, countedOn: bracket.countedOn, ageDays: bracket.ageDays });
      return;
    }
    sum += bracket.valueCents ?? 0;
    if (bracket.countedOn && bracket.ageDays != null && (!oldest || bracket.ageDays > oldest.ageDays)) {
      oldest = { countedOn: bracket.countedOn, ageDays: bracket.ageDays };
    }
  });
  if (short.length > 0) {
    // A group figure that quietly dropped a venue is not the group's stock.
    const status: StockBracketStatus = short.every((v) => v.status === 'stale') ? 'stale' : 'missing';
    return { ...none(toleranceDays), status, venuesWithoutCount: short, offVenueCounts };
  }
  const o = oldest as { countedOn: string; ageDays: number } | null;
  return { ...none(toleranceDays), status: 'ok', valueCents: sum, countedOn: o?.countedOn ?? null, ageDays: o?.ageDays ?? null, offVenueCounts };
}

function bracketReason(which: 'opening' | 'closing', bracket: StockBracket, at: Date, venue: string | null): string | null {
  if (bracket.status === 'ok') return null;
  const boundary = fmtDay(at);
  const label = which === 'opening' ? 'Opening' : 'Closing';
  if (venue == null && bracket.venuesWithoutCount.length > 0) {
    const parts = bracket.venuesWithoutCount.map((v) =>
      v.status === 'missing'
        ? `${v.venue} has no finalised stocktake on or before ${boundary}`
        : `${v.venue}'s latest count (${v.countedOn}) was ${v.ageDays} days before ${boundary}, past the ${bracket.toleranceDays}-day limit`
    );
    return `${label} stock is unavailable for all venues: ${parts.join('; ')}.`;
  }
  const who = venue ?? 'the group';
  if (bracket.status === 'missing') return `${label} stock is unavailable: ${who} has no finalised stocktake on or before ${boundary}.`;
  return `${label} stock is unavailable: ${who}'s latest count (${bracket.countedOn}) was ${bracket.ageDays} days before ${boundary}, past the ${bracket.toleranceDays}-day limit.`;
}

export async function computeActualCogsWith(
  reader: CogsReader,
  params: { venue: string | null; start: Date; end: Date; toleranceDays?: number }
): Promise<ActualCogs> {
  const { venue, start, end } = params;
  const tolerance = params.toleranceDays ?? STOCKTAKE_BRACKET_TOLERANCE_DAYS;
  const [purchasesCents, opening, closing, unattributed] = await Promise.all([
    reader.purchasesExGstCents(venue, start, end),
    stockBracket(reader, venue, start, tolerance),
    // Closing uses lte:end so a count taken exactly at the boundary (this
    // period's close, next period's open) is included, not lost to 1ms.
    stockBracket(reader, venue, end, tolerance),
    venue == null ? Promise.resolve({ cents: 0, invoices: 0 }) : reader.unattributedPurchases(start, end)
  ]);

  const base = {
    purchasesCents,
    openingStockCents: opening.valueCents,
    closingStockCents: closing.valueCents,
    openingStockAvailable: opening.status === 'ok',
    closingStockAvailable: closing.status === 'ok',
    opening,
    closing,
    unattributedPurchasesCents: unattributed.cents,
    unattributedInvoiceCount: unattributed.invoices
  };
  const venueNote =
    unattributed.invoices > 0
      ? [`${unattributed.invoices} supplier invoice${unattributed.invoices === 1 ? '' : 's'} in this window carry no venue, so their purchases are in the group figure but in no venue's.`]
      : [];
  // Off-venue counts are data quality, not a bracket: said, never used.
  const offVenue = [...opening.offVenueCounts, ...closing.offVenueCounts];
  if (venue == null && offVenue.length > 0) {
    const labels = [...new Set(offVenue.map((c) => `"${c.sourceLabel || '(blank)'}"`))];
    venueNote.push(`${offVenue.length} finalised count${offVenue.length === 1 ? '' : 's'} carr${offVenue.length === 1 ? 'ies' : 'y'} a venue label that is not a configured venue (${labels.join(', ')}); they are listed as unattributed and are not part of any venue's or the group's stock.`);
  }

  if (opening.status === 'ok' && closing.status === 'ok') {
    const rawCogsCents = (opening.valueCents ?? 0) + purchasesCents - (closing.valueCents ?? 0);
    // Closing stock can't exceed what was on hand plus everything bought — a
    // negative COGS means the closing count is mis-valued (almost always a
    // unit/pack error on one high-value line). Don't clamp to $0, which reads
    // as "no cost of goods"; fall back to purchases and say so, with both
    // bracket values still returned so the caller can show them.
    if (rawCogsCents < 0) {
      return {
        ...base,
        cogsCents: purchasesCents,
        source: 'purchases_only',
        quality: 'closing_implausible',
        reasons: [
          `Closing stock (${fmtDay(end)}) reads higher than opening stock plus purchases, so the closing count is mis-valued; purchases are shown instead.`,
          ...venueNote
        ]
      };
    }
    return { ...base, cogsCents: rawCogsCents, source: 'stock_bounded', quality: 'complete', reasons: venueNote };
  }

  const quality: CogsQuality =
    opening.status !== 'ok' && closing.status !== 'ok'
      ? 'estimated'
      : opening.status !== 'ok'
        ? opening.status === 'stale' ? 'stale_opening' : 'missing_opening'
        : closing.status === 'stale' ? 'stale_closing' : 'missing_closing';
  const reasons = [bracketReason('opening', opening, start, venue), bracketReason('closing', closing, end, venue)].filter(
    (r): r is string => r != null
  );
  return { ...base, cogsCents: purchasesCents, source: 'purchases_only', quality, reasons: [...reasons, ...venueNote] };
}

/** The value a "stock on hand" tile may show: the latest valid count, or nothing. */
export async function stockValueAtCentsWith(reader: CogsReader, venue: string | null, at: Date): Promise<number | null> {
  const bracket = await stockBracket(reader, venue, at);
  return bracket.status === 'ok' ? bracket.valueCents : null;
}

/**
 * A purchases-only figure with no brackets at all, for residual rows a report
 * derives (e.g. "Unassigned" = group − Σ venues). Never fabricates a count.
 */
export function unattributedCogs(cogsCents: number, purchasesCents: number, reasons: string[]): ActualCogs {
  const none: StockBracket = { status: 'missing', valueCents: null, countedOn: null, ageDays: null, toleranceDays: STOCKTAKE_BRACKET_TOLERANCE_DAYS, venuesWithoutCount: [], offVenueCounts: [] };
  return {
    cogsCents,
    purchasesCents,
    openingStockCents: null,
    closingStockCents: null,
    openingStockAvailable: false,
    closingStockAvailable: false,
    opening: none,
    closing: none,
    source: 'purchases_only',
    quality: 'estimated',
    reasons,
    unattributedPurchasesCents: 0,
    unattributedInvoiceCount: 0
  };
}
