import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTimesheetWindow, timesheetBoundaryKey, trailingVenueDays } from './timesheet-window.js';

// 2026-09-26 is a Saturday. Sydney is on AEST (+10) until 4 October, so
// 14:00Z on the 26th is midnight on the 27th in Sydney.
const SATURDAY_NOON_SYDNEY = new Date('2026-09-26T02:00:00.000Z');

const ok = (value: ReturnType<typeof resolveTimesheetWindow>) => {
  assert.equal('error' in value, false, JSON.stringify(value));
  return value as Exclude<typeof value, { error: string }>;
};

test('a bare day key is taken as that venue day at UTC midnight (the workDate storage form)', () => {
  assert.equal(timesheetBoundaryKey('2026-09-21'), '2026-09-21');
  const window = ok(resolveTimesheetWindow({ start: '2026-09-21', end: '2026-09-28' }));
  assert.equal(window.start.toISOString(), '2026-09-21T00:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-09-28T00:00:00.000Z');
});

test('an instant is read in the venue zone, so a European browser still asks for the venue Monday', () => {
  // Monday 00:00 in Berlin (CEST) is Sunday 22:00Z — Monday 08:00 in Sydney.
  assert.equal(timesheetBoundaryKey('2026-09-20T22:00:00.000Z'), '2026-09-21');
  // Monday 00:00 in Los Angeles (PDT) is Monday 07:00Z — Monday 17:00 in Sydney.
  assert.equal(timesheetBoundaryKey('2026-09-21T07:00:00.000Z'), '2026-09-21');
  // Monday 00:00 in Sydney itself is Sunday 14:00Z.
  assert.equal(timesheetBoundaryKey('2026-09-20T14:00:00.000Z'), '2026-09-21');
  // Sunday 23:30 in Sydney is still Sunday, even though it is Sunday 13:30Z.
  assert.equal(timesheetBoundaryKey('2026-09-20T13:30:00.000Z'), '2026-09-20');
});

test('the symptom: start thirty days back with no end now runs through today, not a fixed fortnight', () => {
  const window = ok(resolveTimesheetWindow({ start: '2026-08-27', now: SATURDAY_NOON_SYDNEY }));
  assert.equal(window.startKey, '2026-08-27');
  // Exclusive end is tomorrow, so a timesheet worked today (2026-09-26) is in.
  assert.equal(window.endKey, '2026-09-27');
  const workedToday = new Date('2026-09-26T00:00:00.000Z');
  assert.equal(workedToday >= window.start && workedToday < window.end, true);
  // The old default (start + 14 days) stopped at 2026-09-10 and missed this.
  assert.notEqual(window.endKey, '2026-09-10');
});

test('the venue today decides "tomorrow", not the UTC clock', () => {
  // 15:00Z on Saturday 26 Sep is 01:00 Sunday 27 Sep in Sydney.
  const sydneySunday = new Date('2026-09-26T15:00:00.000Z');
  const window = ok(resolveTimesheetWindow({ start: '2026-09-01', now: sydneySunday }));
  assert.equal(window.endKey, '2026-09-28');
});

test('no boundaries at all keeps the week-either-side default', () => {
  const window = ok(resolveTimesheetWindow({ now: SATURDAY_NOON_SYDNEY }));
  assert.equal(window.startKey, '2026-09-19');
  assert.equal(window.endKey, '2026-10-04');
});

test('end alone looks back seven days', () => {
  const window = ok(resolveTimesheetWindow({ end: '2026-09-28', now: SATURDAY_NOON_SYDNEY }));
  assert.equal(window.startKey, '2026-09-21');
  assert.equal(window.endKey, '2026-09-28');
});

test('a start on or after the end never inverts the window', () => {
  const future = ok(resolveTimesheetWindow({ start: '2026-12-01', now: SATURDAY_NOON_SYDNEY }));
  assert.equal(future.startKey, '2026-12-01');
  assert.equal(future.endKey, '2026-12-02');
  const same = ok(resolveTimesheetWindow({ start: '2026-09-21', end: '2026-09-21' }));
  assert.equal(same.endKey, '2026-09-22');
});

test('garbage is reported as an error on the boundary that failed', () => {
  assert.deepEqual(resolveTimesheetWindow({ start: 'yesterday' }), { error: 'start' });
  assert.deepEqual(resolveTimesheetWindow({ start: '2026-09-21', end: '2026-13-45' }), { error: 'end' });
});

test('the trailing window the Staff home card asks for ends after the venue today', () => {
  assert.deepEqual(trailingVenueDays(30, SATURDAY_NOON_SYDNEY), { startKey: '2026-08-27', endKey: '2026-09-27' });
  // Same wall-clock request from a browser that thinks it is still Friday
  // evening in Europe resolves identically, because only the instant matters.
  assert.deepEqual(trailingVenueDays(30, new Date('2026-09-25T20:30:00.000Z')), { startKey: '2026-08-27', endKey: '2026-09-27' });
});
