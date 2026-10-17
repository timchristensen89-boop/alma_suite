/** Pure date and window maths behind the Square sales cards, kept apart so it can be tested. */
import type { Scope } from './format';

export type SalesEntry = { venue: string; serviceDate: string; salesCents: number };
export type SalesRange = { entries: SalesEntry[]; note?: string };

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
/** Today's date in Sydney, so a late-night read still lands on the right day. */
export function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function sameDaysLastMonth(from: string, to: string) {
  const shift = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const ny = m === 1 ? y - 1 : y;
    const nm = m === 1 ? 12 : m - 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  return { from: shift(from), to: shift(to) };
}
export function sameDaysLastYear(from: string, to: string) {
  const shift = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  return { from: shift(from), to: shift(to) };
}

export type Window = { key: string; label: string; from: string; to: string; prior: { label: string; from: string; to: string }; lastYear: { from: string; to: string } };

/** The three Square windows for a given today. */
export function salesWindows(today: string): Window[] {
  const monthStart = `${today.slice(0, 7)}-01`;
  const lm = sameDaysLastMonth(monthStart, today);
  const w7 = { from: addDays(today, -6), to: today };
  const w30 = { from: addDays(today, -29), to: today };
  return [
    { key: 'mtd', label: 'This month so far', from: monthStart, to: today, prior: { label: 'same days last month', ...lm }, lastYear: sameDaysLastYear(monthStart, today) },
    { key: 'd7', label: 'Last 7 days', from: w7.from, to: w7.to, prior: { label: 'the 7 days before', from: addDays(w7.from, -7), to: addDays(w7.from, -1) }, lastYear: sameDaysLastYear(w7.from, w7.to) },
    { key: 'd30', label: 'Last 30 days', from: w30.from, to: w30.to, prior: { label: 'the 30 days before', from: addDays(w30.from, -30), to: addDays(w30.from, -1) }, lastYear: sameDaysLastYear(w30.from, w30.to) }
  ];
}

export function sum(entries: SalesEntry[], from: string, to: string, scope: Scope) {
  let total = 0;
  let days = new Set<string>();
  for (const e of entries) {
    if (e.serviceDate < from || e.serviceDate > to) continue;
    if (scope !== 'group' && e.venue !== scope) continue;
    total += e.salesCents;
    days.add(e.serviceDate);
  }
  return { total, days: days.size };
}

