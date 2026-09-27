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
// ESTABLISHED_MIN_INVOICE_DATES distinct invoice dates in the lookback and a
// last invoice within ESTABLISHED_RECENT_DAYS of the period start. An
// occasional supplier (one or two invoices) is never mandatory. A supplier
// is "absent" only once the elapsed period is long enough to expect it:
// at least ABSENCE_MIN_DAYS and at least twice its longest historical gap,
// so a fortnightly supplier is not flagged on day 10.
//
// No supplier is classified food or beverage by name here. Suppliers are
// only ever "established" or not.

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
  /** Distinct invoice dates in the lookback. */
  invoiceDates: number;
  /** Last invoice date before the period (YYYY-MM-DD). */
  lastInvoiceBefore: string;
  /** Longest gap between consecutive invoice dates in the lookback, in days. */
  longestGapDays: number;
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
  establishedSuppliers: string[];
  absentEstablishedSuppliers: AbsentSupplier[];
  /** Why the feed is not complete, in operator words; null when it is. */
  reason: string | null;
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY_MS);

/**
 * @param invoices finalised stock invoices with an invoice date in
 *   [start − INVOICE_FEED_LOOKBACK_DAYS, end); anything else is ignored.
 */
export function assessInvoiceFeed(input: { start: Date; end: Date; now: Date; invoices: InvoiceFeedInvoice[] }): InvoiceFeedAssessment {
  const { start, end, now } = input;
  const elapsedEnd = new Date(Math.min(end.getTime(), now.getTime()));
  const elapsedDays = Math.max(0, (elapsedEnd.getTime() - start.getTime()) / DAY_MS);
  const lookbackStart = new Date(start.getTime() - INVOICE_FEED_LOOKBACK_DAYS * DAY_MS);

  const inPeriod = input.invoices.filter((i) => i.invoiceDate >= start && i.invoiceDate < elapsedEnd);
  const before = input.invoices.filter((i) => i.invoiceDate >= lookbackStart && i.invoiceDate < start);

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

  // ── Established suppliers ──
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
  const profiles = new Map<string, { lastBefore: number; longestGapDays: number; invoiceDates: number }>();
  for (const [supplier, set] of datesBySupplier) {
    const days = [...set].sort((a, b) => a - b);
    if (days.length < ESTABLISHED_MIN_INVOICE_DATES) continue;
    const lastBefore = days[days.length - 1]!;
    if (startDay - lastBefore > ESTABLISHED_RECENT_DAYS) continue;
    let longestGapDays = 0;
    for (let k = 1; k < days.length; k += 1) longestGapDays = Math.max(longestGapDays, days[k]! - days[k - 1]!);
    establishedSuppliers.push(supplier);
    profiles.set(supplier, { lastBefore, longestGapDays, invoiceDates: days.length });
  }
  establishedSuppliers.sort();

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
      longestGapDays: profile.longestGapDays
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
      `${absentEstablishedSuppliers.length} established supplier${absentEstablishedSuppliers.length === 1 ? '' : 's'} with regular invoices in the previous 90 days ${absentEstablishedSuppliers.length === 1 ? 'has' : 'have'} none in this period (${absentEstablishedSuppliers.map((s) => `${s.supplierName}, last ${s.lastInvoiceBefore}`).join('; ')}).`
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
    reason: reasons.length ? reasons.join(' ') : null
  };
}
