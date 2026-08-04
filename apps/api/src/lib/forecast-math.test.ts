import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addDaysUtc, baselineForDate, buildBaselineModel, dateFromKey, keyOf, median, mondayOf, nextOccurrence, pctOf, quarterEndMonth, quarterStartOf, trimmedMean } from './forecast-math.js';
import { nswHolidayName } from './nsw-holidays.js';

describe('date helpers', () => {
  it('round-trips a date key through UTC midnight', () => {
    assert.equal(keyOf(dateFromKey('2026-07-22')), '2026-07-22');
  });

  it('mondayOf maps every day of a week to that Monday', () => {
    // 2026-07-20 is a Monday.
    for (let i = 0; i < 7; i += 1) {
      assert.equal(keyOf(mondayOf(addDaysUtc(dateFromKey('2026-07-20'), i))), '2026-07-20');
    }
  });

  it('mondayOf handles Sunday (start-of-week edge)', () => {
    assert.equal(keyOf(mondayOf(dateFromKey('2026-07-26'))), '2026-07-20');
  });

  it('addDaysUtc crosses month and year boundaries', () => {
    assert.equal(keyOf(addDaysUtc(dateFromKey('2026-12-31'), 1)), '2027-01-01');
    assert.equal(keyOf(addDaysUtc(dateFromKey('2026-03-01'), -1)), '2026-02-28');
  });

  it('YoY offset of -364 days lands on the same weekday', () => {
    const date = dateFromKey('2026-07-25'); // Saturday
    assert.equal(addDaysUtc(date, -364).getUTCDay(), date.getUTCDay());
  });
});

describe('trimmedMean', () => {
  it('averages small samples untrimmed', () => {
    assert.equal(trimmedMean([100, 200, 300]), 200);
  });

  it('drops one outlier at each end with 5+ samples', () => {
    // One bomb Saturday (0) and one blowout (10000) must not swing the mean.
    assert.equal(trimmedMean([0, 900, 1000, 1100, 10000]), 1000);
  });

  it('returns 0 on empty input', () => {
    assert.equal(trimmedMean([]), 0);
  });
});

describe('median', () => {
  it('handles odd and even counts', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), 0);
  });
});

describe('pctOf', () => {
  it('rounds to one decimal and guards divide-by-zero', () => {
    assert.equal(pctOf(1, 3), 33.3);
    assert.equal(pctOf(5, 0), null);
  });
});

describe('nsw holidays', () => {
  it('knows fixed and movable 2026 holidays', () => {
    assert.equal(nswHolidayName('2026-01-26'), 'Australia Day');
    assert.equal(nswHolidayName('2026-04-03'), 'Good Friday');
    assert.equal(nswHolidayName('2026-10-05'), 'Labour Day');
  });

  it('knows substitute days', () => {
    assert.equal(nswHolidayName('2027-12-27'), 'Christmas Day (additional)');
    assert.equal(nswHolidayName('2028-01-03'), "New Year's Day (additional)");
  });

  it('returns null for ordinary days', () => {
    assert.equal(nswHolidayName('2026-07-22'), null);
  });
});

describe('buildBaselineModel + baselineForDate', () => {
  // Synthetic venue: closed Mondays, $1000 Fridays, $500 other days, flat.
  const sales = new Map<string, number>();
  const anchor = dateFromKey('2026-07-20'); // Monday
  for (let back = 1; back <= 120; back += 1) {
    const d = addDaysUtc(anchor, -back);
    const wd = d.getUTCDay();
    sales.set(keyOf(d), wd === 1 ? 0 : wd === 5 ? 100_000 : 50_000);
  }
  const firstDataDate = addDaysUtc(anchor, -120);
  const noHolidays = () => false;

  const model = buildBaselineModel({ sales, anchor, firstDataDate, isHoliday: noHolidays, closedThresholdCents: 20_000 });

  it('detects the closed weekday and flat trend', () => {
    assert.ok(model.closedWeekdays.includes(1));
    assert.equal(model.trendFactor, 1);
  });

  it('reproduces the weekly pattern', () => {
    const friday = dateFromKey('2026-07-24');
    const tuesday = dateFromKey('2026-07-21');
    const monday = dateFromKey('2026-07-27');
    // YoY (-364d) has no data in this fixture, so baselines are pure weekday means.
    assert.equal(baselineForDate(model, sales, friday, noHolidays).baselineCents, 100_000);
    assert.equal(baselineForDate(model, sales, tuesday, noHolidays).baselineCents, 50_000);
    assert.equal(baselineForDate(model, sales, monday, noHolidays).baselineCents, 0);
  });

  it('blends YoY 70/30 only when holiday-status matches', () => {
    const friday = dateFromKey('2026-07-24');
    const withYoy = new Map(sales);
    withYoy.set(keyOf(addDaysUtc(friday, -364)), 200_000);
    assert.equal(baselineForDate(model, withYoy, friday, noHolidays).baselineCents, 130_000); // 0.7*100k + 0.3*200k
    // Same date flagged as a holiday this year but not last year → no blend.
    const holidayThisYear = (key: string) => key === keyOf(friday);
    assert.equal(baselineForDate(model, withYoy, friday, holidayThisYear).baselineCents, 100_000);
  });

  it('keeps holiday trading out of the weekday samples', () => {
    const spiked = new Map(sales);
    const lastFriday = keyOf(addDaysUtc(anchor, -3)); // Friday before anchor
    spiked.set(lastFriday, 1_000_000); // a blowout holiday Friday
    const holidayFn = (key: string) => key === lastFriday;
    const guarded = buildBaselineModel({ sales: spiked, anchor, firstDataDate, isHoliday: holidayFn, closedThresholdCents: 20_000 });
    const unguarded = buildBaselineModel({ sales: spiked, anchor, firstDataDate, isHoliday: noHolidays, closedThresholdCents: 20_000 });
    const friday = dateFromKey('2026-07-24');
    assert.equal(baselineForDate(guarded, spiked, friday, holidayFn).baselineCents, 100_000);
    // Without the guard the spike leaks into the trend factor (clamped to 1.15).
    assert.ok(baselineForDate(unguarded, spiked, friday, noHolidays).baselineCents > 100_000);
  });
});

describe('cash-flow calendar', () => {
  it('quarterEndMonth and quarterStartOf agree', () => {
    assert.equal(quarterEndMonth(dateFromKey('2026-07-22')), 8); // Sep quarter
    assert.equal(keyOf(quarterStartOf(dateFromKey('2026-07-22'))), '2026-07-01');
    assert.equal(keyOf(quarterStartOf(dateFromKey('2026-01-15'))), '2026-01-01');
    assert.equal(keyOf(quarterStartOf(dateFromKey('2026-12-31'))), '2026-10-01');
  });

  it('nextOccurrence wraps the year', () => {
    // BAS for the Dec quarter is due 28 Feb — from November that's next year.
    assert.equal(keyOf(nextOccurrence({ month: 1, day: 28 }, dateFromKey('2026-11-15'))), '2027-02-28');
    // Same-day boundary counts as "at/after".
    assert.equal(keyOf(nextOccurrence({ month: 6, day: 28 }, dateFromKey('2026-07-28'))), '2026-07-28');
  });
});
