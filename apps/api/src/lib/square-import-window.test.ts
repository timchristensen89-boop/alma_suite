import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  explicitImportWindow,
  firstWholeDayKey,
  localDateKey,
  localMidnightUtc,
  rollingImportWindow,
  shiftDateKey,
  SYDNEY
} from './square-import-window.js';

// Sydney is UTC+10 (AEST) until the first Sunday of October, UTC+11 (AEDT)
// after. 2026's flip is Sunday 4 October at 2am.
const iso = (date: Date) => date.toISOString();

describe('localMidnightUtc', () => {
  it('is 14:00 UTC the day before under AEST, 13:00 under AEDT', () => {
    assert.equal(iso(localMidnightUtc('2026-09-12', SYDNEY)), '2026-09-11T14:00:00.000Z');
    assert.equal(iso(localMidnightUtc('2026-10-06', SYDNEY)), '2026-10-05T13:00:00.000Z');
  });

  it('handles the day the clocks change', () => {
    // Midnight on 4 October is still AEST; the flip happens at 2am.
    assert.equal(iso(localMidnightUtc('2026-10-04', SYDNEY)), '2026-10-03T14:00:00.000Z');
    assert.equal(iso(localMidnightUtc('2026-10-05', SYDNEY)), '2026-10-04T13:00:00.000Z');
  });

  it('round-trips through localDateKey', () => {
    for (const key of ['2026-01-01', '2026-04-05', '2026-09-19', '2026-10-04', '2026-12-31']) {
      assert.equal(localDateKey(localMidnightUtc(key, SYDNEY), SYDNEY), key);
    }
  });
});

describe('rollingImportWindow', () => {
  it('starts at Sydney midnight `lookbackDays` days before today, and ends now', () => {
    // 12:15pm Sydney on Friday 19 September.
    const now = new Date('2026-09-19T02:15:00.000Z');
    const window = rollingImportWindow(now, 7, SYDNEY);
    // Seven whole days back is Saturday 12 September, from its very start.
    assert.equal(iso(window.start), '2026-09-11T14:00:00.000Z');
    assert.equal(window.end, now);
  });

  it('is the shape of the bug: the raw instant seven days ago is NOT a day boundary', () => {
    const now = new Date('2026-09-19T02:15:00.000Z');
    const raw = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    assert.equal(firstWholeDayKey(raw, SYDNEY), '2026-09-13', 'a raw start on the 12th at lunchtime only covers the 13th onwards');
    assert.equal(firstWholeDayKey(rollingImportWindow(now, 7).start, SYDNEY), '2026-09-12');
  });

  it('counts days on the Sydney calendar across the daylight-saving flip', () => {
    // Noon AEDT on Tuesday 6 October, looking back over the 4 October flip.
    const now = new Date('2026-10-06T01:00:00.000Z');
    const window = rollingImportWindow(now, 7, SYDNEY);
    // 29 September at midnight AEST — a raw 7×24h subtraction would land at
    // 1am, an hour into the day.
    assert.equal(iso(window.start), '2026-09-28T14:00:00.000Z');
    assert.equal(localDateKey(window.start, SYDNEY), '2026-09-29');
  });

  it('a lookback of zero is just today so far', () => {
    const now = new Date('2026-09-19T02:15:00.000Z');
    assert.equal(iso(rollingImportWindow(now, 0).start), '2026-09-18T14:00:00.000Z');
  });
});

describe('firstWholeDayKey', () => {
  it('is the same day for a midnight start and the next day otherwise', () => {
    assert.equal(firstWholeDayKey(new Date('2026-09-11T14:00:00.000Z'), SYDNEY), '2026-09-12');
    assert.equal(firstWholeDayKey(new Date('2026-09-11T14:00:00.001Z'), SYDNEY), '2026-09-13');
    assert.equal(firstWholeDayKey(new Date('2026-09-12T11:15:00.000Z'), SYDNEY), '2026-09-13');
  });
});

describe('explicitImportWindow', () => {
  const now = new Date('2026-09-19T02:15:00.000Z');

  it('reads a bare date as the whole Sydney day, inclusive of the end date', () => {
    const window = explicitImportWindow({ startDate: '2026-09-01', endDate: '2026-09-07' }, now);
    assert.equal(iso(window?.start ?? new Date(0)), '2026-08-31T14:00:00.000Z');
    // The end is the midnight AFTER the 7th, so the 7th is in full.
    assert.equal(iso(window?.end ?? new Date(0)), '2026-09-07T14:00:00.000Z');
  });

  it('takes a full timestamp literally, as the backfill sends it', () => {
    const window = explicitImportWindow(
      { startDate: '2026-09-11T14:00:00.000Z', endDate: '2026-09-18T14:00:00.000Z' },
      now
    );
    assert.equal(iso(window?.start ?? new Date(0)), '2026-09-11T14:00:00.000Z');
    assert.equal(iso(window?.end ?? new Date(0)), '2026-09-18T14:00:00.000Z');
  });

  it('never reaches past now, and defaults the end to now', () => {
    const open = explicitImportWindow({ startDate: '2026-09-18' }, now);
    assert.equal(open?.end, now);
    const future = explicitImportWindow({ startDate: '2026-09-18', endDate: '2026-12-31' }, now);
    assert.equal(future?.end, now);
  });

  it('is nothing when no dates were given, and nothing for an unreadable start', () => {
    assert.equal(explicitImportWindow({}, now), null);
    assert.equal(explicitImportWindow({ startDate: 'last tuesday' }, now), null);
  });
});

describe('shiftDateKey', () => {
  it('crosses month and year ends', () => {
    assert.equal(shiftDateKey('2026-09-01', -1), '2026-08-31');
    assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
  });
});
