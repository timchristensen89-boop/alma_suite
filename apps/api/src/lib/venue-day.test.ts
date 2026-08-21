import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextDayKey,
  venueDayBounds,
  venueDayKey,
  venueDayStart,
  venueInstant,
  venueTimeLabel,
  venueWeekday
} from '@alma/shared';

const spanHours = (day: string) => {
  const b = venueDayBounds(day)!;
  return (b.lt.getTime() - b.gte.getTime()) / 3_600_000;
};
// Every instant in the window must format back to the same venue day, and the
// instant just before it must not.
const covers = (day: string) => {
  const b = venueDayBounds(day)!;
  return (
    venueDayKey(b.gte) === day &&
    venueDayKey(new Date(b.lt.getTime() - 1)) === day &&
    venueDayKey(new Date(b.gte.getTime() - 1)) !== day
  );
};

test('a winter day is 24 hours at UTC+10', () => {
  assert.equal(spanHours('2026-08-03'), 24);
  assert.equal(venueDayStart('2026-08-03')?.toISOString(), '2026-08-02T14:00:00.000Z');
  assert.equal(covers('2026-08-03'), true);
});

test('a summer day is 24 hours at UTC+11', () => {
  assert.equal(spanHours('2026-01-15'), 24);
  assert.equal(venueDayStart('2026-01-15')?.toISOString(), '2026-01-14T13:00:00.000Z');
  assert.equal(covers('2026-01-15'), true);
});

test('the day daylight saving starts is 23 hours, not 24', () => {
  // Sydney springs forward on the first Sunday of October: 2am becomes 3am.
  assert.equal(spanHours('2026-10-04'), 23);
  assert.equal(covers('2026-10-04'), true);
});

test('the day daylight saving ends is 25 hours, not 24', () => {
  // First Sunday of April: 3am goes back to 2am.
  assert.equal(spanHours('2026-04-05'), 25);
  assert.equal(covers('2026-04-05'), true);
});

test('a run stamped late UTC belongs to the next venue day', () => {
  // The symptom that started this: the scheduler raised runs at 21:30 UTC on
  // 2 August, which is 07:30 on the 3rd in Sydney. Asking for the UTC date
  // found nothing.
  const run = new Date('2026-08-02T21:30:10.361Z');
  assert.equal(venueDayKey(run), '2026-08-03');
  const bounds = venueDayBounds('2026-08-03')!;
  assert.equal(run >= bounds.gte && run < bounds.lt, true);
  const utcDay = run.toISOString().slice(0, 10);
  const wrong = venueDayBounds(utcDay)!;
  assert.equal(run >= wrong.gte && run < wrong.lt, false);
});

test('the window is half-open so midnight belongs to the next day only', () => {
  const bounds = venueDayBounds('2026-08-03')!;
  assert.equal(venueDayKey(bounds.lt), '2026-08-04');
});

test('nextDayKey rolls months and years', () => {
  assert.equal(nextDayKey('2026-08-03'), '2026-08-04');
  assert.equal(nextDayKey('2026-08-31'), '2026-09-01');
  assert.equal(nextDayKey('2026-12-31'), '2027-01-01');
  assert.equal(nextDayKey('2028-02-28'), '2028-02-29');
  assert.equal(nextDayKey('nonsense'), null);
});

test('a malformed day is rejected rather than guessed', () => {
  assert.equal(venueDayStart('not-a-day'), null);
  assert.equal(venueDayBounds('2026-8-3'), null);
});


// ── Wall-clock times ────────────────────────────────────────────────────────
//
// These cover the fault that put a 6pm dinner slot into the small hours. The
// API containers run UTC, so building a rule time with `setHours(18, 0)` gave
// 18:00 UTC — and 18:00 UTC is four or five in the morning here, on the FOLLOWING
// day. The public widget booked that instant verbatim.

test('a 6pm rule is 6pm in the venue, not 6pm UTC (winter)', () => {
  assert.equal(venueInstant('2026-06-15', '18:00')!.toISOString(), '2026-06-15T08:00:00.000Z');
});

test('a 6pm rule is 6pm in the venue, not 6pm UTC (summer)', () => {
  // An hour earlier in UTC than the winter case: Sydney is +11 on daylight saving.
  assert.equal(venueInstant('2026-12-15', '18:00')!.toISOString(), '2026-12-15T07:00:00.000Z');
});

test('the old server-zone reading landed a dinner slot at 4am the NEXT day', () => {
  const wrong = new Date('2026-06-15T18:00:00.000Z'); // what setHours(18) produced under TZ=UTC
  const right = venueInstant('2026-06-15', '18:00')!;
  assert.notEqual(wrong.getTime(), right.getTime());
  assert.equal(venueDayKey(wrong), '2026-06-16');
  assert.equal(venueDayKey(right), '2026-06-15');
  assert.equal(venueTimeLabel(right), '6:00 pm');
});

test('a slot label reads in the venue zone whatever the server is set to', () => {
  assert.equal(venueTimeLabel(new Date('2026-12-15T07:00:00.000Z')), '6:00 pm');
  assert.equal(venueTimeLabel(new Date('2026-06-15T08:00:00.000Z')), '6:00 pm');
});

test('an evening service holds its wall-clock hour across both transition days', () => {
  assert.equal(venueTimeLabel(venueInstant('2026-10-04', '18:00')!), '6:00 pm'); // clocks forward
  assert.equal(venueTimeLabel(venueInstant('2026-04-05', '18:00')!), '6:00 pm'); // clocks back
});

test('a wall-clock time the clocks skip resolves forward, not backward', () => {
  // 2am does not exist on the morning daylight saving starts; 3am is the instant
  // the clock jumps to, and jumping back to 1am would put a booking before it.
  const skipped = venueInstant('2026-10-04', '02:00')!;
  assert.equal(venueTimeLabel(skipped), '3:00 am');
  assert.equal(venueDayKey(skipped), '2026-10-04');
});

test('midnight is the day start, so the two agree', () => {
  assert.equal(venueInstant('2026-10-04', '00:00')!.getTime(), venueDayStart('2026-10-04')!.getTime());
});

test('a malformed or out-of-range wall clock is rejected rather than guessed', () => {
  assert.equal(venueInstant('2026-06-15', '25:00'), null);
  assert.equal(venueInstant('2026-06-15', '18:60'), null);
  assert.equal(venueInstant('2026-06-15', 'dinner'), null);
  assert.equal(venueInstant('not-a-day', '18:00'), null);
});

// ── Weekday ─────────────────────────────────────────────────────────────────
//
// An availability rule's daysOfWeek is the VENUE's weekday. Read off a UTC
// instant it can name the day either side, and a Sunday rule would open on
// Saturday night.

test('the weekday is the calendar date, not whatever zone you ask in', () => {
  assert.equal(venueWeekday('2026-10-04'), 0); // Sunday
  assert.equal(venueWeekday('2026-06-15'), 1); // Monday
  assert.equal(venueWeekday('2026-12-15'), 2); // Tuesday
  assert.equal(venueWeekday('not-a-day'), null);
});

test('the weekday agrees with the venue day it belongs to', () => {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const render = new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Sydney', weekday: 'short' });
  for (const day of ['2026-04-05', '2026-06-15', '2026-10-04', '2026-12-15']) {
    const noon = venueInstant(day, '12:00')!;
    assert.equal(names[venueWeekday(day)!], render.format(noon));
    assert.equal(venueDayKey(noon), day);
  }
});
