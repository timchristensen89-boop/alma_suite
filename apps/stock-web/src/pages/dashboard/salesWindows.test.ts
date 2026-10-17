import assert from 'node:assert/strict';
import test from 'node:test';
import { salesWindows, sameDaysLastMonth, sameDaysLastYear, sum } from './salesWindows';

test('the three Square windows and their comparison spans', () => {
  const [mtd, d7, d30] = salesWindows('2026-10-18');
  assert.deepEqual([mtd!.from, mtd!.to, mtd!.prior.from, mtd!.prior.to, mtd!.lastYear.from, mtd!.lastYear.to], ['2026-10-01', '2026-10-18', '2026-09-01', '2026-09-18', '2025-10-01', '2025-10-18']);
  assert.deepEqual([d7!.from, d7!.to, d7!.prior.from, d7!.prior.to], ['2026-10-12', '2026-10-18', '2026-10-05', '2026-10-11']);
  assert.deepEqual([d30!.from, d30!.to, d30!.prior.from, d30!.prior.to], ['2026-09-19', '2026-10-18', '2026-08-20', '2026-09-18']);
});

test('month and year shifts clamp to the shorter month', () => {
  assert.deepEqual(sameDaysLastMonth('2026-03-01', '2026-03-31'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(sameDaysLastYear('2028-02-01', '2028-02-29'), { from: '2027-02-01', to: '2027-02-28' });
});

test('sums respect the window, the venue scope, and count trading days not rows', () => {
  const entries = [
    { venue: 'St Alma', serviceDate: '2026-10-01', salesCents: 100 },
    { venue: 'Alma Avalon', serviceDate: '2026-10-01', salesCents: 50 },
    { venue: 'St Alma', serviceDate: '2026-10-02', salesCents: 100 },
    { venue: 'St Alma', serviceDate: '2026-09-30', salesCents: 999 }
  ];
  assert.deepEqual(sum(entries, '2026-10-01', '2026-10-31', 'group'), { total: 250, days: 2 });
  assert.deepEqual(sum(entries, '2026-10-01', '2026-10-31', 'Alma Avalon'), { total: 50, days: 1 });
});
