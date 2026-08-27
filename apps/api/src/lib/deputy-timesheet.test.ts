import assert from 'node:assert/strict';
import test from 'node:test';
import { deputyBreakMinutes, deputyIsLeave, deputyWorkDate } from './deputy-timesheet.js';
import { dayRateKind } from '@alma/shared';

// 10:00 → 18:00, epoch seconds.
const START = 1_760_000_000;
const span = (hours: number) => ({ StartTime: START, EndTime: START + Math.round(hours * 3600) });

test('the unpaid break is the span Deputy did not pay', () => {
  assert.equal(deputyBreakMinutes({ ...span(8), TotalTime: 7.5 }), 30);
});

test('a fully paid span has no break', () => {
  assert.equal(deputyBreakMinutes({ ...span(8), TotalTime: 8 }), 0);
});

test('rounding noise between the span and TotalTime is not a phantom break', () => {
  // 5.933h span against Deputy's two-decimal 5.93 — 0.18 of a minute apart.
  assert.equal(deputyBreakMinutes({ StartTime: START, EndTime: START + 21_360, TotalTime: 5.93 }), 0);
});

test('a datetime Mealbreak is not seconds — the shape that zeroed every break', () => {
  // Without TotalTime this must come out 0, never NaN and never a huge number.
  assert.equal(deputyBreakMinutes({ ...span(8), Mealbreak: '2026-08-20T18:30:00+10:00' }), 0);
});

test('a numeric Mealbreak still works as seconds when TotalTime is absent', () => {
  assert.equal(deputyBreakMinutes({ ...span(8), Mealbreak: 1800 }), 30);
  assert.equal(deputyBreakMinutes({ ...span(8), Mealbreak: '2700' }), 45);
});

test('TotalTime wins over a contradictory Mealbreak', () => {
  assert.equal(deputyBreakMinutes({ ...span(8), TotalTime: 7, Mealbreak: 1800 }), 60);
});

test('no span and no TotalTime falls back to the numeric Mealbreak', () => {
  assert.equal(deputyBreakMinutes({ Mealbreak: 1200 }), 20);
});

test('leave is flagged by IsLeave or by a LeaveRule id', () => {
  assert.equal(deputyIsLeave({ IsLeave: true }), true);
  assert.equal(deputyIsLeave({ IsLeave: 1 }), true);
  assert.equal(deputyIsLeave({ LeaveRule: 7 }), true);
  assert.equal(deputyIsLeave({ IsLeave: false }), false);
  assert.equal(deputyIsLeave({}), false);
});

test('a leave row takes no break, whatever the numbers say', () => {
  assert.equal(deputyBreakMinutes({ ...span(8), TotalTime: 7.6, IsLeave: true }), 0);
});

// workDate: the day worked, pinned in Sydney, stored UTC-midnight.
test('a Saturday-morning shift is a Saturday, not the Friday its UTC instant falls on', () => {
  // Sat 22 Aug 2026, 08:00 Sydney (AEST +10) = 21 Aug 22:00 UTC.
  const clockIn = new Date('2026-08-21T22:00:00Z');
  assert.equal(deputyWorkDate(clockIn).toISOString(), '2026-08-22T00:00:00.000Z');
  // And it must classify onto the Saturday award rate, not weekday.
  assert.equal(dayRateKind(deputyWorkDate(clockIn)), 'saturday');
});

test('a Sunday-morning shift is a Sunday, not the Saturday its UTC instant falls on', () => {
  // Sun 23 Aug 2026, 09:00 Sydney = 22 Aug 23:00 UTC.
  const clockIn = new Date('2026-08-22T23:00:00Z');
  assert.equal(deputyWorkDate(clockIn).toISOString(), '2026-08-23T00:00:00.000Z');
  assert.equal(dayRateKind(deputyWorkDate(clockIn)), 'sunday');
});

test('an afternoon shift keeps the same day in Sydney and UTC', () => {
  // Fri 21 Aug 2026, 16:30 Sydney = 06:30 UTC same date — no drift.
  assert.equal(deputyWorkDate(new Date('2026-08-21T06:30:00Z')).toISOString(), '2026-08-21T00:00:00.000Z');
  assert.equal(dayRateKind(deputyWorkDate(new Date('2026-08-21T06:30:00Z'))), 'weekday');
});
