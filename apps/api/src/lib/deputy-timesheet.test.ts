import assert from 'node:assert/strict';
import test from 'node:test';
import { deputyBreakMinutes, deputyIsLeave } from './deputy-timesheet.js';

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
