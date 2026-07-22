import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addDaysUtc, dateFromKey, keyOf, median, mondayOf, pctOf, trimmedMean } from './forecast-math.js';
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
