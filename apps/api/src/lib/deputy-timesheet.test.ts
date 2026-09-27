import assert from 'node:assert/strict';
import test from 'node:test';
import { deputyBit, deputyBreakMinutes, deputyId, deputyIsLeave, deputyLeaveEvidence, deputyWorkDate } from './deputy-timesheet.js';
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
  assert.equal(deputyIsLeave({ IsLeave: '1' }), true);
  assert.equal(deputyIsLeave({ IsLeave: 'true' }), true);
  assert.equal(deputyIsLeave({ LeaveRule: 7 }), true);
  assert.equal(deputyIsLeave({ LeaveRule: '7' }), true);
  assert.equal(deputyIsLeave({ IsLeave: false }), false);
  assert.equal(deputyIsLeave({}), false);
});

test('a LeaveRule of 0 is Deputy saying "no rule", not a leave rule', () => {
  // The shape that would badge one worked shift in a week as leave while its
  // neighbours import fine: a row carrying LeaveRule 0 where the others carry
  // null. Zero is not an id Deputy ever issues.
  assert.equal(deputyIsLeave({ IsLeave: false, LeaveRule: 0 }), false);
  assert.equal(deputyIsLeave({ LeaveRule: 0 }), false);
  assert.equal(deputyIsLeave({ LeaveRule: '0' }), false);
  assert.equal(deputyIsLeave({ LeaveRule: null }), false);
  assert.equal(deputyIsLeave({ LeaveRule: -1 }), false);
  assert.equal(deputyIsLeave({ IsLeave: 0, LeaveRule: 0, LeaveId: 0 }), false);
});

test('a string "0" or "false" bit is not leave, however truthy JavaScript finds it', () => {
  assert.equal(deputyIsLeave({ IsLeave: '0' }), false);
  assert.equal(deputyIsLeave({ IsLeave: 'false' }), false);
  assert.equal(deputyIsLeave({ IsLeave: '' }), false);
  assert.equal(deputyIsLeave({ IsLeave: null }), false);
});

test('a LeaveId on its own does not make a shift leave', () => {
  // Deputy sets IsLeave on every leave timesheet it creates; the id alone is
  // corroboration, never the trigger, so tightening the read cannot flag more
  // rows than before.
  assert.equal(deputyIsLeave({ LeaveId: 44 }), false);
  assert.equal(deputyIsLeave({ IsLeave: true, LeaveId: 44 }), true);
});

test('deputyBit and deputyId read Deputy\'s loose scalars strictly', () => {
  assert.equal(deputyBit(true), true);
  assert.equal(deputyBit(1), true);
  assert.equal(deputyBit(' TRUE '), true);
  assert.equal(deputyBit(false), false);
  assert.equal(deputyBit(0), false);
  assert.equal(deputyBit('0'), false);
  assert.equal(deputyBit(2), false);
  assert.equal(deputyBit(undefined), false);
  assert.equal(deputyId(7), 7);
  assert.equal(deputyId('12'), 12);
  assert.equal(deputyId(0), null);
  assert.equal(deputyId('0'), null);
  assert.equal(deputyId(1.5), null);
  assert.equal(deputyId(null), null);
  assert.equal(deputyId(undefined), null);
  assert.equal(deputyId('abc'), null);
});

test('the leave evidence note shows the raw fields, including absent ones', () => {
  assert.equal(
    deputyLeaveEvidence({ IsLeave: true, LeaveRule: 7 }),
    'Deputy IsLeave=true LeaveRule=7 LeaveId=absent'
  );
  assert.equal(
    deputyLeaveEvidence({ IsLeave: false, LeaveRule: 0, LeaveId: null }),
    'Deputy IsLeave=false LeaveRule=0 LeaveId=null'
  );
});

test('a worked shift carrying LeaveRule 0 still gets its unpaid break', () => {
  assert.equal(deputyBreakMinutes({ ...span(8), TotalTime: 7.5, IsLeave: false, LeaveRule: 0 }), 30);
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
