// Is the supplier-invoice feed complete enough for a period's purchases to
// stand as the period's purchases?
//
// "Complete" here means: the EXPECTED invoice feed appears to have kept
// flowing through the period. It does not mean every purchase has been
// verified — nothing in the suite can know about an invoice it never
// received. What it can know is when the feed stops:
//
//   • general cadence — invoices keep arriving through the elapsed part of
//     the period. August 2026 held $461.61 of purchases against $181k of
//     sales and the old rule (first-invoice date only) called that 100%
//     covered, because one invoice existed;
//   • an established supplier disappears — a supplier with regular,
//     repeated activity in the 90 days before the period has nothing at all
//     in it. FoodByUs and Paramount Liquor stop after mid-July while the
//     produce suppliers continue: a partially stalled feed that cadence
//     alone does not see.
//
// "Regular" is defined from history, deterministically: at least
// ESTABLISHED_MIN_INVOICE_DATES distinct invoice dates in the 90 days before
// the period, with a last invoice within ESTABLISHED_RECENT_DAYS of its
// start. An occasional supplier (one or two invoices) is never mandatory. A
// supplier is "absent" only once the elapsed period is long enough to expect
// it: at least ABSENCE_MIN_DAYS and at least twice its longest historical
// gap, so a fortnightly supplier is not flagged on day 10.
//
// An absence does not age out. The first version of this rule judged each
// period from the 90 days before it alone, so FoodByUs and Paramount Liquor
// — silent since mid-July — were flagged absent in August and then, by
// September, were no longer "established" (last invoice > 45 days before
// 1 Sep) and September read complete on $4.5k of purchases against $164k
// of sales. Now a supplier that was regular as of its own last invoice
// (ESTABLISHED_MIN_INVOICE_DATES distinct dates in the 90 days up to it)
// stays expected, period after period, until it invoices again or the
// supplier is explicitly marked no longer expected (`notExpectedSuppliers`
// — Supplier.status ARCHIVED). Continued silence is never read as
// cessation. Every carried-forward absence says so in the output.
//
// No supplier is classified food or beverage by name here, and no dollar
// value decides whether a supplier matters. Suppliers are only ever
// "expected" or not.

export const INVOICE_FEED_LOOKBACK_DAYS = 90;
export const ESTABLISHED_MIN_INVOICE_DATES = 3;
export const ESTABLISHED_RECENT_DAYS = 45;
export const ABSENCE_MIN_DAYS = 14;
/** Below this share of the elapsed period covered by invoice activity, the feed is incomplete. */
export const MIN_FEED_COVERAGE = 0.9;
/** Younger than this, a period is not judged on cadence at all. */
export const CADENCE_MIN_ELAPSED_DAYS = 7;
/** Days after the last invoice that still count as covered: one ordinary weekly gap. */
export const FEED_GAP_TOLERANCE_DAYS = 7;

const DAY_MS = 86_400_000;

export type InvoiceFeedInvoice = { supplierName: string; invoiceDate: Date };

export type InvoiceFeedStatus = 'complete' | 'incomplete' | 'too_early';

export type AbsentSupplier = {
  supplierName: string;
  /** Distinct invoice dates in the 90 days up to the supplier's last invoice. */
  invoiceDates: number;
  /** Last invoice date before the period (YYYY-MM-DD). */
  lastInvoiceBefore: string;
  /** Longest gap between consecutive invoice dates in that window, in days. */
  longestGapDays: number;
  /** Whole days from the last invoice to the period start. */
  absentForDays: number;
  /**
   * True when the supplier is expected only because its earlier absence has
   * not been resolved (its last invoice is older than ESTABLISHED_RECENT_DAYS
   * before this period, so the per-period rule alone would have dropped it).
   */
  carriedForward: boolean;
};

export type InvoiceFeedAssessment = {
  status: InvoiceFeedStatus;
  /** 0–1: share of the elapsed period between the first and last invoice in it. */
  coverage: number;
  elapsedDays: number;
  firstInvoiceDate: string | null;
  lastInvoiceDate: string | null;
  /** The uncovered stretch at the end of the elapsed period, when there is one. */
  missingInterval: { from: string; to: string } | null;
  /** Suppliers expected in this period: regular as of the period start, or carrying an unresolved absence. */
  establishedSuppliers: string[];
  absentEstablishedSuppliers: AbsentSupplier[];
  /** Suppliers explicitly marked no longer expected, whose silence was therefore not judged. */
  notExpectedSuppliers: string[];
  /** Why the feed is not complete, in operator words; null when it is. */
  reason: string | null;
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY_MS);

/**
 * @param invoices every finalised stock invoice with an invoice date before
 *   `end` (the whole history is needed: an absence is judged as of the
 *   supplier's own last invoice, however long ago). Invoices on or after
 *   `end` are ignored.
 * @param notExpectedSuppliers supplier names explicitly marked no longer
 *   expected (Supplier.status ARCHIVED); their silence is not judged.
 */
export function assessInvoiceFeed(input: {
  start: Date;
  end: Date;
  now: Date;
  invoices: InvoiceFeedInvoice[];
  notExpectedSuppliers?: Iterable<string>;
}): InvoiceFeedAssessment {
  const { start, end, now } = input;
  const notExpected = new Set([...(input.notExpectedSuppliers ?? [])].map((n) => n.trim()));
  const elapsedEnd = new Date(Math.min(end.getTime(), now.getTime()));
  const elapsedDays = Math.max(0, (elapsedEnd.getTime() - start.getTime()) / DAY_MS);
  const inPeriod = input.invoices.filter((i) => i.invoiceDate >= start && i.invoiceDate < elapsedEnd);
  const before = input.invoices.filter((i) => i.invoiceDate < start);

  // ── Cadence ──
  let coverage = 0;
  let firstInvoiceDate: string | null = null;
  let lastInvoiceDate: string | null = null;
  let missingInterval: InvoiceFeedAssessment['missingInterval'] = null;
  if (inPeriod.length > 0 && elapsedDays > 0) {
    const times = inPeriod.map((i) => i.invoiceDate.getTime());
    const first = new Date(Math.min(...times));
    const last = new Date(Math.max(...times));
    firstInvoiceDate = dayKey(first);
    lastInvoiceDate = dayKey(last);
    // Covered from the first invoice to the last plus one ordinary weekly
    // gap: a feed is not "stalled" a few days after its last delivery.
    const coveredTo = Math.min(elapsedEnd.getTime(), last.getTime() + FEED_GAP_TOLERANCE_DAYS * DAY_MS);
    coverage = Math.round(Math.min(1, Math.max(0, (coveredTo - first.getTime()) / (elapsedEnd.getTime() - start.getTime()))) * 100) / 100;
    if (coveredTo < elapsedEnd.getTime()) {
      missingInterval = { from: dayKey(new Date(coveredTo)), to: dayKey(elapsedEnd) };
    }
  } else if (elapsedDays > 0) {
    missingInterval = { from: dayKey(start), to: dayKey(elapsedEnd) };
  }

  // ── Expected suppliers ──
  //
  // Two ways to be expected in this period, both judged from history only:
  //   (a) regular as of the period start: ≥ ESTABLISHED_MIN_INVOICE_DATES
  //       distinct dates in the 90 days before it and a last invoice within
  //       ESTABLISHED_RECENT_DAYS of it;
  //   (b) regular as of the supplier's own LAST invoice (≥ the same number of
  //       distinct dates in the 90 days up to and including it) and silent
  //       ever since — an unresolved absence, carried forward until the
  //       supplier invoices again or is marked not expected.
  const datesBySupplier = new Map<string, Set<number>>();
  for (const i of before) {
    const key = i.supplierName.trim();
    if (!key) continue;
    const set = datesBySupplier.get(key) ?? new Set<number>();
    set.add(dayOf(i.invoiceDate));
    datesBySupplier.set(key, set);
  }
  const startDay = dayOf(start);
  const establishedSuppliers: string[] = [];
  const notExpectedSuppliers: string[] = [];
  const profiles = new Map<string, { lastBefore: number; longestGapDays: number; invoiceDates: number; carriedForward: boolean }>();
  const regularOver = (days: number[], windowEnd: number) => {
    // Distinct invoice dates in the 90 days up to (and including) windowEnd, and the longest gap between them.
    const inWindow = days.filter((d) => d > windowEnd - INVOICE_FEED_LOOKBACK_DAYS && d <= windowEnd);
    let longestGapDays = 0;
    for (let k = 1; k < inWindow.length; k += 1) longestGapDays = Math.max(longestGapDays, inWindow[k]! - inWindow[k - 1]!);
    return { count: inWindow.length, longestGapDays };
  };
  for (const [supplier, set] of datesBySupplier) {
    const days = [...set].sort((a, b) => a - b);
    const lastBefore = days[days.length - 1]!;
    if (notExpected.has(supplier)) {
      notExpectedSuppliers.push(supplier);
      continue;
    }
    // (a) as of the period start: the window ends the day before the period.
    const asOfStart = regularOver(days, startDay - 1);
    const recent = startDay - lastBefore <= ESTABLISHED_RECENT_DAYS;
    if (asOfStart.count >= ESTABLISHED_MIN_INVOICE_DATES && recent) {
      establishedSuppliers.push(supplier);
      profiles.set(supplier, { lastBefore, longestGapDays: asOfStart.longestGapDays, invoiceDates: asOfStart.count, carriedForward: false });
      continue;
    }
    // (b) as of its last invoice: was it regular then? If so, its absence since is unresolved.
    const asOfLast = regularOver(days, lastBefore);
    if (asOfLast.count >= ESTABLISHED_MIN_INVOICE_DATES) {
      establishedSuppliers.push(supplier);
      profiles.set(supplier, { lastBefore, longestGapDays: asOfLast.longestGapDays, invoiceDates: asOfLast.count, carriedForward: !recent });
    }
  }
  establishedSuppliers.sort();
  notExpectedSuppliers.sort();

  const activeInPeriod = new Set(inPeriod.map((i) => i.supplierName.trim()));
  const absentEstablishedSuppliers: AbsentSupplier[] = [];
  for (const supplier of establishedSuppliers) {
    if (activeInPeriod.has(supplier)) continue;
    const profile = profiles.get(supplier)!;
    const expectedBy = Math.max(ABSENCE_MIN_DAYS, 2 * profile.longestGapDays);
    if (elapsedDays < expectedBy) continue;
    absentEstablishedSuppliers.push({
      supplierName: supplier,
      invoiceDates: profile.invoiceDates,
      lastInvoiceBefore: dayKey(new Date(profile.lastBefore * DAY_MS)),
      longestGapDays: profile.longestGapDays,
      absentForDays: startDay - profile.lastBefore,
      carriedForward: profile.carriedForward
    });
  }

  // ── Verdict ──
  const reasons: string[] = [];
  const judgeCadence = elapsedDays >= CADENCE_MIN_ELAPSED_DAYS;
  if (judgeCadence && coverage < MIN_FEED_COVERAGE) {
    reasons.push(
      inPeriod.length === 0
        ? `No supplier invoices fall in the ${Math.round(elapsedDays)} elapsed days of the period.`
        : `Supplier invoices cover ${Math.round(coverage * 100)}% of the elapsed period (${firstInvoiceDate} to ${lastInvoiceDate}${missingInterval ? `; nothing from ${missingInterval.from} to ${missingInterval.to}` : ''}).`
    );
  }
  if (absentEstablishedSuppliers.length > 0) {
    reasons.push(
      `${absentEstablishedSuppliers.length} regular supplier${absentEstablishedSuppliers.length === 1 ? '' : 's'} ${absentEstablishedSuppliers.length === 1 ? 'has' : 'have'} no invoice in this period (${absentEstablishedSuppliers
        .map((s) => `${s.supplierName}: ${s.invoiceDates} invoice dates in the 90 days to ${s.lastInvoiceBefore}, then nothing for ${s.absentForDays} days${s.carriedForward ? ' — an unresolved absence carried forward' : ''}`)
        .join('; ')}). An absence stands until the supplier invoices again or is marked no longer expected.`
    );
  }
  const status: InvoiceFeedStatus = reasons.length > 0 ? 'incomplete' : judgeCadence ? 'complete' : 'too_early';
  return {
    status,
    coverage,
    elapsedDays: Math.round(elapsedDays * 100) / 100,
    firstInvoiceDate,
    lastInvoiceDate,
    missingInterval,
    establishedSuppliers,
    absentEstablishedSuppliers,
    notExpectedSuppliers,
    reason: reasons.length ? reasons.join(' ') : null
  };
}
