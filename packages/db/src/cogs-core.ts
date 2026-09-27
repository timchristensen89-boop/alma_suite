// The arithmetic and the rules behind actual (financial) Cost of Goods Sold,
// kept free of Prisma so the relationships can be tested against a fake
// reader. `cogs.ts` supplies the Prisma-backed reader and is the module the
// apps import. Covered by cogs-core.test.ts.
//
// The relationship every caller relies on:
//
//   actual COGS = opening stock + purchases − closing stock
//
// and it only holds when BOTH boundaries carry a COMPLETE, VALUED count of
// the same population the purchases cover. Purchases are food AND beverage
// (supplier invoices are not told apart locally), so each boundary needs:
//
//   • one valid COMBINED count, or one valid FOOD count plus one valid
//     BEVERAGE count (Alma counts the kitchen and the bar on separate
//     sheets). A FOOD count alone is not the venue's stock, however close to
//     the boundary it sits: completeness first, distance second. Before this
//     rule a food-only count bracketed combined purchases and Avalon's June
//     read $12,194.52 (18.9%), labelled complete.
//   • valid = finalised (SUBMITTED / REVIEWED / LOCKED), of known scope
//     (UNKNOWN never qualifies — historical counts and anything ambiguous),
//     sufficiently valued (no line counted above zero without a value), and
//     within STOCKTAKE_BOUNDARY_WINDOW_DAYS (±7) of the boundary.
//   • duplicates of one scope: the nearest wins; a tie goes to the count on
//     or before the boundary. Sessions of one scope on one VENUE day (Sydney,
//     not the server's UTC) are one count, summed.
//   • a composed boundary sums its components, keeps each component's id,
//     date and value, and measures its distance as the furthest component's.
//     FOOD and BEVERAGE components more than STOCKTAKE_COMPONENT_GAP_WARNING_DAYS
//     apart still compose, with an explicit warning; no stock movement
//     between them is invented.
//   • the same instant is one month's close and the next month's open, and
//     the rule is a pure function of the candidates around that instant, so
//     the shared boundary is the same composition on both sides. It cannot
//     drift forward.
//   • the all-venues figure sums each CONFIGURED venue's boundary. The group
//     population is the configured venues (Settings › Venues) plus explicitly
//     reported unattributed data — never every distinct string ever written
//     into a stocktake's venue field. "Both", "Unspecified", a Loaded
//     location name: those are off-venue counts, listed for remediation,
//     neither required nor folded in. A stored label resolves to a configured
//     venue only through the shared venue-resolution rules. When any
//     configured venue has no valid boundary, the group figure is missing and
//     says which venue is short — never the sum of the others.
//
// When a boundary is unavailable the figure falls back to purchases only and
// `quality` says which boundary failed; `reasons` spells out why in operator
// language, naming the counts that were considered and why each did not
// qualify.

import {
  STOCKTAKE_BOUNDARY_WINDOW_DAYS,
  STOCKTAKE_COMPONENT_GAP_WARNING_DAYS,
  resolveVenueLabel,
  stocktakeDistanceDays,
  venueDayKey,
  type StocktakeScope,
  type StocktakeValuation,
  type VenueResolutionStatus
} from '@alma/shared';

export type CogsSource = 'stock_bounded' | 'purchases_only';

// 'complete' = both boundaries carry a complete composition. Every other
// value names the boundary that failed: missing = no finalised count within
// the window at all; incomplete = counts exist in the window but do not make
// a complete, valued count of known scope. 'estimated' = neither boundary is
// usable.
export type CogsQuality =
  | 'complete'
  | 'estimated'
  | 'missing_opening'
  | 'missing_closing'
  | 'incomplete_opening'
  | 'incomplete_closing'
  | 'closing_implausible';

export type StockBracketStatus = 'ok' | 'missing' | 'incomplete';

/** A finalised count as the composition rule sees it. */
export type ScopedCount = {
  id: string;
  name: string;
  countedAt: Date;
  scope: StocktakeScope;
  valuation: StocktakeValuation;
};

/** One count (or one venue day's sessions of one scope) used in a boundary. */
export type BracketComponent = {
  scope: StocktakeScope;
  /** Venue-day key of the count. */
  countedOn: string;
  countedAt: string;
  valueCents: number;
  /** Whole days from the boundary, either side. */
  distanceDays: number;
  /** Whether it was taken on/before the boundary or after it. */
  side: 'before' | 'after';
  stocktakeIds: string[];
  names: string[];
};

export type RejectedCountReason = 'unknown_scope' | 'unvalued' | 'duplicate' | 'no_counterpart';

/** A finalised count inside the window that was NOT used, and why. */
export type RejectedCount = {
  stocktakeId: string;
  name: string;
  scope: StocktakeScope;
  countedOn: string;
  valueCents: number;
  distanceDays: number;
  reason: RejectedCountReason;
  detail: string;
};

/** A finalised count whose stored venue label is not a configured venue. */
export type OffVenueCount = {
  sourceLabel: string;
  resolution: Exclude<VenueResolutionStatus, 'canonical' | 'alias'>;
  countedOn: string;
  valueCents: number;
};

export type VenueShort = {
  venue: string;
  status: Exclude<StockBracketStatus, 'ok'>;
  countedOn: string | null;
  distanceDays: number | null;
  detail: string;
};

export type StockBracket = {
  status: StockBracketStatus;
  /** Σ of the components (or of every venue's composition); null unless status is 'ok'. */
  valueCents: number | null;
  /** Venue-day key of the component nearest the boundary (the latest component for a composed count); null when nothing was used. */
  countedOn: string | null;
  /** The furthest component's whole-day distance from the boundary; null when nothing was used. */
  distanceDays: number | null;
  windowDays: number;
  composition: 'combined' | 'food_and_beverage' | null;
  components: BracketComponent[];
  /** Candidates inside the window that were not used, with why. */
  rejected: RejectedCount[];
  /** Explicit quality warnings on a boundary that still qualifies (e.g. components days apart). */
  warnings: string[];
  /** All-venues only: configured venues whose boundary is missing or incomplete, with why. */
  venuesWithoutCount: VenueShort[];
  /** All-venues only: finalised counts on or before the boundary whose venue label is not a configured venue. Reported, never required, never summed. */
  offVenueCounts: OffVenueCount[];
};

export type ActualCogs = {
  cogsCents: number;
  purchasesCents: number;
  /** Null when the boundary is unavailable — never zero, which reads as "no stock". */
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
  /** Quality warnings on a figure that IS complete (component dates apart). */
  warnings: string[];
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
  /** The configured venues — the canonical population (Settings › Venues). */
  configuredVenues(): Promise<string[]>;
  /** Every distinct venue label stored on a finalised count on or before `at` (null included as ''). */
  storedCountVenueLabels(at: Date): Promise<string[]>;
  /** Finalised counts under the labels with countedAt in [gte, lte], with scope and per-line valuation assessed. */
  finalisedCountsNear(venueLabels: string[], window: { gte: Date; lte: Date }): Promise<ScopedCount[]>;
  /** Finalised counts under the given (off-venue) labels on or before `at`: one row per count, valued. */
  countsUnderLabels(venueLabels: string[], at: Date): Promise<Array<{ label: string; countedAt: Date; valueCents: number }>>;
  /** Ex-GST finalised stock purchases in [start, end); venue null = all, including untagged invoices. */
  purchasesExGstCents(venue: string | null, start: Date, end: Date): Promise<number>;
  /** Finalised stock purchases in [start, end) with no venue on the invoice. */
  unattributedPurchases(start: Date, end: Date): Promise<{ cents: number; invoices: number }>;
};

const DAY_MS = 86_400_000;
const fmtDay = (at: Date) => venueDayKey(at);
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const none = (windowDays: number): StockBracket => ({
  status: 'missing',
  valueCents: null,
  countedOn: null,
  distanceDays: null,
  windowDays,
  composition: null,
  components: [],
  rejected: [],
  warnings: [],
  venuesWithoutCount: [],
  offVenueCounts: []
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

type Candidate = ScopedCount & { countedOn: string; distanceDays: number; side: 'before' | 'after' };

/** Nearest first; on equal distance the count on/before the boundary; then the later instant (deterministic). */
function nearer(a: Candidate, b: Candidate): number {
  if (a.distanceDays !== b.distanceDays) return a.distanceDays - b.distanceDays;
  if (a.side !== b.side) return a.side === 'before' ? -1 : 1;
  return b.countedAt.getTime() - a.countedAt.getTime();
}

/** Sessions of one scope on one venue day, as one component. */
function componentsByDay(candidates: Candidate[]): BracketComponent[] {
  const byDay = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byDay.get(c.countedOn) ?? [];
    list.push(c);
    byDay.set(c.countedOn, list);
  }
  return [...byDay.values()].map((sessions) => {
    const nearest = [...sessions].sort(nearer)[0]!;
    return {
      scope: nearest.scope,
      countedOn: nearest.countedOn,
      countedAt: nearest.countedAt.toISOString(),
      valueCents: sessions.reduce((sum, s) => sum + s.valuation.valueCents, 0),
      distanceDays: nearest.distanceDays,
      side: nearest.side,
      stocktakeIds: sessions.map((s) => s.id),
      names: sessions.map((s) => s.name)
    };
  });
}

function componentNearer(a: BracketComponent, b: BracketComponent): number {
  if (a.distanceDays !== b.distanceDays) return a.distanceDays - b.distanceDays;
  if (a.side !== b.side) return a.side === 'before' ? -1 : 1;
  return b.countedAt.localeCompare(a.countedAt);
}

const describeComponent = (c: BracketComponent) => `${c.scope} ${c.countedOn} ${money(c.valueCents)}`;

/**
 * The composition rule for one venue at one boundary, given every finalised
 * count of the venue inside the window. Pure: the same candidates always
 * give the same boundary, which is what lets one instant serve as a month's
 * close and the next month's open without drifting.
 */
export function composeBoundary(counts: ScopedCount[], at: Date, windowDays = STOCKTAKE_BOUNDARY_WINDOW_DAYS): StockBracket {
  const base = none(windowDays);
  const candidates: Candidate[] = counts
    .map((c) => ({ ...c, countedOn: fmtDay(c.countedAt), distanceDays: stocktakeDistanceDays(c.countedAt, at), side: c.countedAt.getTime() <= at.getTime() ? ('before' as const) : ('after' as const) }))
    .filter((c) => c.distanceDays <= windowDays);
  if (candidates.length === 0) return base;

  const rejected: RejectedCount[] = [];
  const reject = (c: Candidate, reason: RejectedCountReason, detail: string) =>
    rejected.push({ stocktakeId: c.id, name: c.name, scope: c.scope, countedOn: c.countedOn, valueCents: c.valuation.valueCents, distanceDays: c.distanceDays, reason, detail });

  const valid: Candidate[] = [];
  /** Every session behind a component that ended up unused. */
  const rejectComponent = (component: BracketComponent, reason: RejectedCountReason, detail: string) => {
    for (const c of valid.filter((s) => component.stocktakeIds.includes(s.id))) reject(c, reason, detail);
  };
  for (const c of candidates) {
    if (c.scope === 'UNKNOWN') reject(c, 'unknown_scope', 'scope is UNKNOWN (not set from a template or a sheet, and never inferred from its value)');
    else if (!c.valuation.sufficient) reject(c, 'unvalued', c.valuation.reason ?? 'the count is not sufficiently valued');
    else valid.push(c);
  }

  // Per scope: sessions on one venue day are one count; then the nearest wins.
  const chosen = new Map<StocktakeScope, BracketComponent>();
  for (const scope of ['COMBINED', 'FOOD', 'BEVERAGE'] as const) {
    const ofScope = valid.filter((c) => c.scope === scope);
    if (ofScope.length === 0) continue;
    const ranked = componentsByDay(ofScope).sort(componentNearer);
    const winner = ranked[0]!;
    chosen.set(scope, winner);
    for (const loser of ranked.slice(1)) {
      for (const c of ofScope.filter((s) => loser.stocktakeIds.includes(s.id))) {
        reject(c, 'duplicate', `another ${scope} count (${winner.countedOn}) is nearer the boundary`);
      }
    }
  }

  const combined = chosen.get('COMBINED') ?? null;
  const food = chosen.get('FOOD') ?? null;
  const beverage = chosen.get('BEVERAGE') ?? null;
  const pair = food && beverage ? [food, beverage] : null;

  let components: BracketComponent[] | null = null;
  let composition: StockBracket['composition'] = null;
  if (combined && pair) {
    // Both complete: the nearer boundary wins; a tie goes to the single count.
    const pairDistance = Math.max(pair[0]!.distanceDays, pair[1]!.distanceDays);
    if (pairDistance < combined.distanceDays) {
      components = pair;
      composition = 'food_and_beverage';
      rejectComponent(combined, 'duplicate', `a FOOD + BEVERAGE pair (${pair.map((p) => p.countedOn).join(' + ')}) is nearer the boundary`);
    } else {
      components = [combined];
      composition = 'combined';
      for (const p of pair) rejectComponent(p, 'duplicate', `a COMBINED count (${combined.countedOn}) is at least as near the boundary`);
    }
  } else if (combined) {
    components = [combined];
    composition = 'combined';
    for (const p of [food, beverage]) if (p) rejectComponent(p, 'duplicate', `a COMBINED count (${combined.countedOn}) covers the boundary`);
  } else if (pair) {
    components = pair;
    composition = 'food_and_beverage';
  }

  if (!components) {
    for (const p of [food, beverage]) {
      if (p) rejectComponent(p, 'no_counterpart', `a ${p.scope} count alone is not the venue's stock; no ${p.scope === 'FOOD' ? 'BEVERAGE' : 'FOOD'} count within ${windowDays} days of the boundary`);
    }
    return { ...base, status: 'incomplete', rejected };
  }

  const warnings: string[] = [];
  if (components.length === 2) {
    const [a, b] = components as [BracketComponent, BracketComponent];
    const gapDays = Math.round(Math.abs(new Date(a.countedAt).getTime() - new Date(b.countedAt).getTime()) / DAY_MS);
    if (gapDays > STOCKTAKE_COMPONENT_GAP_WARNING_DAYS) {
      warnings.push(`The FOOD (${a.countedOn}) and BEVERAGE (${b.countedOn}) counts are ${gapDays} days apart; the boundary is their sum as counted, with no stock movement between them assumed.`);
    }
  }
  const nearest = [...components].sort(componentNearer)[0]!;
  return {
    ...base,
    status: 'ok',
    valueCents: components.reduce((sum, c) => sum + c.valueCents, 0),
    countedOn: nearest.countedOn,
    distanceDays: Math.max(...components.map((c) => c.distanceDays)),
    composition,
    components,
    rejected,
    warnings
  };
}

/** Why one venue's boundary is not usable, in operator words. */
function shortDetail(bracket: StockBracket): string {
  if (bracket.status === 'missing') return `no finalised stocktake within ${bracket.windowDays} days`;
  const parts: string[] = [];
  const lone = bracket.rejected.filter((r) => r.reason === 'no_counterpart');
  for (const r of lone) parts.push(`a ${r.scope} count (${r.countedOn}, ${money(r.valueCents)}) has no ${r.scope === 'FOOD' ? 'BEVERAGE' : 'FOOD'} counterpart`);
  const unknown = bracket.rejected.filter((r) => r.reason === 'unknown_scope');
  if (unknown.length) parts.push(`${unknown.length} count${unknown.length === 1 ? '' : 's'} of unknown scope (${unknown.map((r) => `${r.countedOn}, ${money(r.valueCents)}`).join('; ')})`);
  const unvalued = bracket.rejected.filter((r) => r.reason === 'unvalued');
  if (unvalued.length) parts.push(`${unvalued.length} count${unvalued.length === 1 ? '' : 's'} not sufficiently valued (${unvalued.map((r) => `${r.countedOn}: ${r.detail}`).join('; ')})`);
  return parts.join('; ') || 'no complete count';
}

async function bracketForLabels(reader: CogsReader, labels: string[], at: Date, windowDays: number): Promise<StockBracket> {
  if (labels.length === 0) return none(windowDays);
  const window = { gte: new Date(at.getTime() - windowDays * DAY_MS), lte: new Date(at.getTime() + windowDays * DAY_MS) };
  const counts = await reader.finalisedCountsNear(labels, window);
  return composeBoundary(counts, at, windowDays);
}

/** One configured venue's boundary, reading every stored label that resolves to it. */
export async function venueStockBracket(
  reader: CogsReader,
  venue: string,
  at: Date,
  windowDays = STOCKTAKE_BOUNDARY_WINDOW_DAYS
): Promise<StockBracket> {
  const { labelsByVenue, configured } = await partitionCountLabels(reader, at);
  const canonical = configured.find((name) => resolveVenueLabel(name, configured).venue === resolveVenueLabel(venue, configured).venue);
  const labels = canonical ? labelsByVenue.get(canonical) ?? [] : [];
  return bracketForLabels(reader, labels, at, windowDays);
}

/** The boundary for one venue, or the sum over every configured venue. */
export async function stockBracket(
  reader: CogsReader,
  venue: string | null,
  at: Date,
  windowDays = STOCKTAKE_BOUNDARY_WINDOW_DAYS
): Promise<StockBracket> {
  if (venue != null) return venueStockBracket(reader, venue, at, windowDays);
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
    return { ...none(windowDays), offVenueCounts };
  }
  const brackets = await Promise.all(venues.map((name) => bracketForLabels(reader, labelsByVenue.get(name) ?? [], at, windowDays)));
  const short: VenueShort[] = [];
  const components: BracketComponent[] = [];
  const rejected: RejectedCount[] = [];
  const warnings: string[] = [];
  let sum = 0;
  let furthest: { countedOn: string; distanceDays: number } | null = null;
  brackets.forEach((bracket, index) => {
    const name = venues[index] as string;
    rejected.push(...bracket.rejected);
    if (bracket.status !== 'ok') {
      short.push({ venue: name, status: bracket.status, countedOn: bracket.rejected[0]?.countedOn ?? null, distanceDays: bracket.rejected[0]?.distanceDays ?? null, detail: shortDetail(bracket) });
      return;
    }
    sum += bracket.valueCents ?? 0;
    components.push(...bracket.components);
    warnings.push(...bracket.warnings.map((w) => `${name}: ${w}`));
    if (bracket.countedOn && bracket.distanceDays != null && (!furthest || bracket.distanceDays > furthest.distanceDays)) {
      furthest = { countedOn: bracket.countedOn, distanceDays: bracket.distanceDays };
    }
  });
  if (short.length > 0) {
    // A group figure that quietly dropped a venue is not the group's stock.
    const status: StockBracketStatus = short.every((v) => v.status === 'missing') ? 'missing' : 'incomplete';
    return { ...none(windowDays), status, rejected, venuesWithoutCount: short, offVenueCounts };
  }
  const f = furthest as { countedOn: string; distanceDays: number } | null;
  const compositions = new Set(brackets.map((b) => b.composition));
  return {
    ...none(windowDays),
    status: 'ok',
    valueCents: sum,
    countedOn: f?.countedOn ?? null,
    distanceDays: f?.distanceDays ?? null,
    composition: compositions.size === 1 ? brackets[0]!.composition : 'food_and_beverage',
    components,
    rejected,
    warnings,
    offVenueCounts
  };
}

function bracketReason(which: 'opening' | 'closing', bracket: StockBracket, at: Date, venue: string | null): string | null {
  if (bracket.status === 'ok') return null;
  const boundary = fmtDay(at);
  const label = which === 'opening' ? 'Opening' : 'Closing';
  if (venue == null && bracket.venuesWithoutCount.length > 0) {
    const parts = bracket.venuesWithoutCount.map((v) => `${v.venue}: ${v.detail}`);
    return `${label} stock is unavailable for all venues at ${boundary}: ${parts.join('; ')}.`;
  }
  const who = venue ?? 'the group';
  if (bracket.status === 'missing') return `${label} stock is unavailable: ${who} has no finalised stocktake within ${bracket.windowDays} days of ${boundary}.`;
  return `${label} stock is unavailable: ${who}'s counts within ${bracket.windowDays} days of ${boundary} do not make a complete count — ${shortDetail(bracket)}.`;
}

export async function computeActualCogsWith(
  reader: CogsReader,
  params: { venue: string | null; start: Date; end: Date; windowDays?: number }
): Promise<ActualCogs> {
  const { venue, start, end } = params;
  const windowDays = params.windowDays ?? STOCKTAKE_BOUNDARY_WINDOW_DAYS;
  const [purchasesCents, opening, closing, unattributed] = await Promise.all([
    reader.purchasesExGstCents(venue, start, end),
    stockBracket(reader, venue, start, windowDays),
    stockBracket(reader, venue, end, windowDays),
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
    warnings: [...opening.warnings.map((w) => `Opening: ${w}`), ...closing.warnings.map((w) => `Closing: ${w}`)],
    unattributedPurchasesCents: unattributed.cents,
    unattributedInvoiceCount: unattributed.invoices
  };
  const venueNote =
    unattributed.invoices > 0
      ? [`${unattributed.invoices} supplier invoice${unattributed.invoices === 1 ? '' : 's'} in this window carry no venue, so their purchases are in the group figure but in no venue's.`]
      : [];
  // Off-venue counts are data quality, not a boundary: said, never used.
  const offVenue = [...opening.offVenueCounts, ...closing.offVenueCounts];
  if (venue == null && offVenue.length > 0) {
    const labels = [...new Set(offVenue.map((c) => `"${c.sourceLabel || '(blank)'}"`))];
    venueNote.push(`${offVenue.length} finalised count${offVenue.length === 1 ? '' : 's'} carr${offVenue.length === 1 ? 'ies' : 'y'} a venue label that is not a configured venue (${labels.join(', ')}); they are listed as unattributed and are not part of any venue's or the group's stock.`);
  }

  if (opening.status === 'ok' && closing.status === 'ok') {
    const rawCogsCents = (opening.valueCents ?? 0) + purchasesCents - (closing.valueCents ?? 0);
    // Closing stock can't exceed what was on hand plus everything bought — a
    // negative COGS means a boundary is mis-valued (a unit/pack error on one
    // high-value line, or a component that under-counts). Don't clamp to $0,
    // which reads as "no cost of goods"; fall back to purchases and say so,
    // with both boundary values still returned so the caller can show them.
    if (rawCogsCents < 0) {
      return {
        ...base,
        cogsCents: purchasesCents,
        source: 'purchases_only',
        quality: 'closing_implausible',
        reasons: [
          `Closing stock (${fmtDay(end)}) reads higher than opening stock plus purchases, so a boundary count is mis-valued; purchases are shown instead.`,
          ...venueNote
        ]
      };
    }
    return { ...base, cogsCents: rawCogsCents, source: 'stock_bounded', quality: 'complete', reasons: venueNote };
  }

  const failed = (b: StockBracket): 'missing' | 'incomplete' => (b.status === 'incomplete' ? 'incomplete' : 'missing');
  const quality: CogsQuality =
    opening.status !== 'ok' && closing.status !== 'ok'
      ? 'estimated'
      : opening.status !== 'ok'
        ? (`${failed(opening)}_opening` as CogsQuality)
        : (`${failed(closing)}_closing` as CogsQuality);
  const reasons = [bracketReason('opening', opening, start, venue), bracketReason('closing', closing, end, venue)].filter(
    (r): r is string => r != null
  );
  return { ...base, cogsCents: purchasesCents, source: 'purchases_only', quality, reasons: [...reasons, ...venueNote] };
}

/** The value a "stock on hand" tile may show: the latest complete count within the window, or nothing. */
export async function stockValueAtCentsWith(reader: CogsReader, venue: string | null, at: Date, windowDays = STOCKTAKE_BOUNDARY_WINDOW_DAYS): Promise<number | null> {
  const bracket = await stockBracket(reader, venue, at, windowDays);
  return bracket.status === 'ok' ? bracket.valueCents : null;
}

/**
 * A purchases-only figure with no boundaries at all, for residual rows a
 * report derives (e.g. "Unassigned" = group − Σ venues). Never fabricates a count.
 */
export function unattributedCogs(cogsCents: number, purchasesCents: number, reasons: string[]): ActualCogs {
  const empty = none(STOCKTAKE_BOUNDARY_WINDOW_DAYS);
  return {
    cogsCents,
    purchasesCents,
    openingStockCents: null,
    closingStockCents: null,
    openingStockAvailable: false,
    closingStockAvailable: false,
    opening: empty,
    closing: empty,
    source: 'purchases_only',
    quality: 'estimated',
    reasons,
    warnings: [],
    unattributedPurchasesCents: 0,
    unattributedInvoiceCount: 0
  };
}
