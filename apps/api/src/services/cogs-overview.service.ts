/**
 * The Stock home page's COGS overview: per venue and for the group, cost of
 * goods this month so far, last month and the year to date, each beside the
 * same days a year earlier, plus this month beside the same days last month.
 *
 * Source: the Xero profit and loss (accrual, ex-GST) for every Xero
 * organisation on the suite's connection, one per venue. Sales ride along so
 * each figure can be read as a percentage of sales. Xero is read at most
 * once every ten minutes; the page shows when the figures were refreshed.
 *
 * The windows and the arithmetic are pure functions (tested); only `overview`
 * talks to Xero.
 */
import type { StockCogsComparison, StockCogsFigure, StockCogsOverviewPayload, StockCogsRow } from '@alma/shared';
import { integrationService, type XeroPlMonth, type XeroPlPeriodPairs, type XeroPlPeriodRequest } from './integration.service.js';

const SYDNEY = 'Australia/Sydney';
const MEMO_MS = 10 * 60 * 1000;
const VENUE_ORDER = ['St Alma', 'Alma Avalon'];

/** Today in Sydney as YYYY-MM-DD. */
export function todayInSydney(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SYDNEY, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}
function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** The same calendar days one month earlier, the day clamped to that month's length. */
export function sameDaysLastMonth(from: string, to: string) {
  const f = parts(from);
  const t = parts(to);
  const shift = (y: number, m: number, d: number) => {
    const ny = m === 1 ? y - 1 : y;
    const nm = m === 1 ? 12 : m - 1;
    return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
  };
  return { from: shift(f.y, f.m, f.d), to: shift(t.y, t.m, t.d) };
}
/** The same calendar days one year earlier (29 Feb becomes 28 Feb). */
export function sameDaysLastYear(from: string, to: string) {
  const shift = (date: string) => {
    const { y, m, d } = parts(date);
    return iso(y - 1, m, Math.min(d, daysInMonth(y - 1, m)));
  };
  return { from: shift(from), to: shift(to) };
}

export type CogsWindows = Record<'monthToDate' | 'previousMonth' | 'lastMonth' | 'yearToDate', XeroPlPeriodRequest>;

/** The four windows for a given "today". */
export function cogsWindows(today: string): CogsWindows {
  const { y, m } = parts(today);
  const monthStart = iso(y, m, 1);
  const lastY = m === 1 ? y - 1 : y;
  const lastM = m === 1 ? 12 : m - 1;
  return {
    monthToDate: { key: 'monthToDate', from: monthStart, to: today, timeframe: 'YEAR' },
    previousMonth: { key: 'previousMonth', from: monthStart, to: today, timeframe: 'MONTH' },
    lastMonth: { key: 'lastMonth', from: iso(lastY, lastM, 1), to: iso(lastY, lastM, daysInMonth(lastY, lastM)), timeframe: 'YEAR' },
    yearToDate: { key: 'yearToDate', from: iso(y, 1, 1), to: today, timeframe: 'YEAR' }
  };
}

export function toFigure(month: XeroPlMonth | undefined): StockCogsFigure {
  const cogsCents = month?.cogsCents ?? 0;
  const salesCents = month?.salesCents ?? 0;
  return {
    cogsCents,
    salesCents,
    cogsPercent: salesCents > 0 ? Math.round((cogsCents / salesCents) * 1000) / 10 : null
  };
}

function comparison(request: XeroPlPeriodRequest, pair: { current: XeroPlMonth; prior: XeroPlMonth } | undefined): StockCogsComparison {
  const prior = request.timeframe === 'MONTH' ? sameDaysLastMonth(request.from, request.to) : sameDaysLastYear(request.from, request.to);
  const current = toFigure(pair?.current);
  const previous = toFigure(pair?.prior);
  return {
    from: request.from,
    to: request.to,
    current,
    prior: previous,
    priorFrom: prior.from,
    priorTo: prior.to,
    changePercent: previous.cogsCents !== 0 ? Math.round(((current.cogsCents - previous.cogsCents) / Math.abs(previous.cogsCents)) * 1000) / 10 : null
  };
}

/** Pure: shape Xero's period pairs into the page's rows. */
export function buildCogsOverview(input: {
  today: string;
  venues: string[];
  pairs: XeroPlPeriodPairs;
  lastRefreshed: string;
}): StockCogsOverviewPayload {
  const windows = cogsWindows(input.today);
  const row = (label: string, venue: string | null, source: Record<string, { current: XeroPlMonth; prior: XeroPlMonth }> | undefined): StockCogsRow => ({
    label,
    venue,
    monthToDate: comparison(windows.monthToDate, source?.monthToDate),
    lastMonth: comparison(windows.lastMonth, source?.lastMonth),
    previousMonth: comparison(windows.previousMonth, source?.previousMonth),
    yearToDate: comparison(windows.yearToDate, source?.yearToDate)
  });
  const ordered = [...input.venues].sort((a, b) => {
    const ia = VENUE_ORDER.indexOf(a);
    const ib = VENUE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  const notes: string[] = [];
  for (const tenant of input.pairs.tenants) {
    if (!tenant.venue) notes.push(`The Xero organisation "${tenant.name ?? tenant.id}" is not matched to a venue, so its figures are in the group only.`);
  }
  for (const venue of ordered) {
    if (!input.pairs.perVenue[venue]) notes.push(`No Xero organisation is connected for ${venue}, so its row is empty and the group is short by it.`);
  }
  const mtd = windows.monthToDate;
  if (mtd.from === mtd.to) notes.push('It is the first day of the month, so "this month" covers one day.');
  return {
    asOf: input.today,
    source: 'xero',
    basis: 'accrual-ex-gst',
    rows: [row('Group', null, input.pairs.group), ...ordered.map((venue) => row(venue, venue, input.pairs.perVenue[venue]))],
    tenants: input.pairs.tenants.map((tenant) => ({ name: tenant.name, venue: tenant.venue })),
    notes,
    lastRefreshed: input.lastRefreshed
  };
}

let memo: { key: string; at: number; value: Promise<StockCogsOverviewPayload> } | null = null;

export const cogsOverviewService = {
  async overview(now = new Date()): Promise<StockCogsOverviewPayload> {
    const today = todayInSydney(now);
    if (memo && memo.key === today && now.getTime() - memo.at < MEMO_MS) return memo.value;
    const value = (async () => {
      const windows = cogsWindows(today);
      const pairs = await integrationService.xeroCogsPeriodPairs(Object.values(windows));
      const venues = Array.from(new Set([...Object.keys(pairs.perVenue), ...pairs.tenants.map((t) => t.venue).filter((v): v is string => Boolean(v))]));
      return buildCogsOverview({ today, venues, pairs, lastRefreshed: new Date().toISOString() });
    })();
    memo = { key: today, at: now.getTime(), value };
    value.catch(() => {
      // A failed read is not kept for ten minutes.
      if (memo?.value === value) memo = null;
    });
    return value;
  }
};
