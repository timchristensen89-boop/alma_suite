import assert from 'node:assert/strict';
import test from 'node:test';
import { nextDayKey, venueDayBounds, venueDayKey, venueDayStart } from '@alma/shared';

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
