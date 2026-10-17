import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCogsOverview, cogsWindows, sameDaysLastMonth, sameDaysLastYear, todayInSydney } from './cogs-overview.service.js';
import type { XeroPlMonth, XeroPlPeriodPairs } from './integration.service.js';

const month = (key: string, salesCents: number, cogsCents: number): XeroPlMonth => ({
  month: key, salesCents, cogsCents, foodCogsCents: 0, bevCogsCents: 0, otherCogsCents: 0, accounts: []
});

test('the four windows: this month so far, the same days last month, last full month, and the year to date', () => {
  const w = cogsWindows('2026-10-18');
  assert.deepEqual([w.monthToDate.from, w.monthToDate.to, w.monthToDate.timeframe], ['2026-10-01', '2026-10-18', 'YEAR']);
  assert.deepEqual([w.previousMonth.from, w.previousMonth.to, w.previousMonth.timeframe], ['2026-10-01', '2026-10-18', 'MONTH']);
  assert.deepEqual([w.lastMonth.from, w.lastMonth.to, w.lastMonth.timeframe], ['2026-09-01', '2026-09-30', 'YEAR']);
  assert.deepEqual([w.yearToDate.from, w.yearToDate.to], ['2026-01-01', '2026-10-18']);
  // January: last month is December of the previous year.
  const jan = cogsWindows('2026-01-10');
  assert.deepEqual([jan.lastMonth.from, jan.lastMonth.to], ['2025-12-01', '2025-12-31']);
  assert.deepEqual([jan.yearToDate.from, jan.yearToDate.to], ['2026-01-01', '2026-01-10']);
});

test('prior windows shift a month or a year, clamping the day to the shorter month', () => {
  assert.deepEqual(sameDaysLastMonth('2026-03-01', '2026-03-31'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(sameDaysLastMonth('2026-01-01', '2026-01-10'), { from: '2025-12-01', to: '2025-12-10' });
  assert.deepEqual(sameDaysLastYear('2028-02-01', '2028-02-29'), { from: '2027-02-01', to: '2027-02-28' });
  assert.deepEqual(sameDaysLastYear('2026-01-01', '2026-10-18'), { from: '2025-01-01', to: '2025-10-18' });
});

test('today in Sydney is a calendar date in Sydney, not UTC', () => {
  // 23:30 UTC on 17 Oct is 10:30 on 18 Oct in Sydney (AEDT).
  assert.equal(todayInSydney(new Date('2026-10-17T23:30:00Z')), '2026-10-18');
  assert.equal(todayInSydney(new Date('2026-10-17T12:00:00Z')), '2026-10-17');
});

test('rows: group first, St Alma before Alma Avalon, percentages of sales and change vs prior', () => {
  const pair = (s1: number, c1: number, s0: number, c0: number) => ({ current: month('2026-10-01', s1, c1), prior: month('2025-10-01', s0, c0) });
  const pairs: XeroPlPeriodPairs = {
    perVenue: {
      'Alma Avalon': { monthToDate: pair(100000, 30000, 80000, 32000), previousMonth: pair(100000, 30000, 90000, 27000), lastMonth: pair(6907599, 939423, 9436822, 2250141), yearToDate: pair(900000, 270000, 1000000, 300000) },
      'St Alma': { monthToDate: pair(50000, 10000, 40000, 8000), previousMonth: pair(50000, 10000, 60000, 12000), lastMonth: pair(200000, 60000, 180000, 54000), yearToDate: pair(600000, 150000, 0, 0) }
    },
    group: { monthToDate: pair(150000, 40000, 120000, 40000), previousMonth: pair(150000, 40000, 150000, 39000), lastMonth: pair(7107599, 999423, 9616822, 2304141), yearToDate: pair(1500000, 420000, 1000000, 300000) },
    tenants: [{ id: 'a', name: 'Alma Avalon', venue: 'Alma Avalon' }, { id: 'b', name: 'Alma Freshwater Pty Ltd', venue: 'St Alma' }]
  };
  const out = buildCogsOverview({ today: '2026-10-18', venues: ['Alma Avalon', 'St Alma'], pairs, lastRefreshed: '2026-10-18T00:00:00.000Z' });
  assert.deepEqual(out.rows.map((r) => r.label), ['Group', 'St Alma', 'Alma Avalon']);
  const group = out.rows[0]!;
  assert.equal(group.monthToDate.current.cogsPercent, 26.7, '40,000 ÷ 150,000');
  assert.equal(group.monthToDate.changePercent, 0, 'same COGS as last year');
  assert.deepEqual([group.monthToDate.priorFrom, group.monthToDate.priorTo], ['2025-10-01', '2025-10-18']);
  assert.deepEqual([group.previousMonth.priorFrom, group.previousMonth.priorTo], ['2026-09-01', '2026-09-18']);
  assert.equal(group.previousMonth.changePercent, 2.6, '40,000 vs 39,000');
  assert.equal(group.lastMonth.changePercent, -56.6, 'September: $9,994 vs $23,041');
  const stAlma = out.rows[1]!;
  assert.equal(stAlma.yearToDate.prior.cogsPercent, null, 'no sales last year → no percentage');
  assert.equal(stAlma.yearToDate.changePercent, null, 'no prior COGS → no change');
  assert.deepEqual(out.notes, []);
});

test('an unmatched Xero organisation and a venue with no organisation are called out', () => {
  const pairs: XeroPlPeriodPairs = { perVenue: {}, group: {}, tenants: [{ id: 'x', name: 'Mystery Pty Ltd', venue: null }] };
  const out = buildCogsOverview({ today: '2026-10-01', venues: ['St Alma'], pairs, lastRefreshed: 'now' });
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[1]!.monthToDate.current.cogsCents, 0);
  assert.match(out.notes[0]!, /Mystery Pty Ltd/);
  assert.match(out.notes[1]!, /No Xero organisation is connected for St Alma/);
  assert.match(out.notes[2]!, /first day of the month/);
});
