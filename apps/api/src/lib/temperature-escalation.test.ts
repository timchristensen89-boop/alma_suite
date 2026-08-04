import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEMPERATURE_ESCALATION_THRESHOLD,
  TEMPERATURE_ESCALATION_WINDOW_MINUTES,
  decideTemperatureEscalation
} from '@alma/shared';

const T = (minutesAgo: number, status = 'OUT_OF_RANGE') => ({
  recordedAt: new Date(Date.UTC(2026, 7, 3, 12, 0) - minutesAgo * 60_000),
  status
});
const now = (status = 'OUT_OF_RANGE') => T(0, status);

test('an in-range reading says nothing', () => {
  const d = decideTemperatureEscalation(now('IN_RANGE'), [T(60), T(120)]);
  assert.deepEqual(d, { warn: false, escalate: false, breachesInWindow: 0, spanMinutes: 0 });
});

test('the first breach warns the head chef and raises nothing', () => {
  const d = decideTemperatureEscalation(now(), []);
  assert.equal(d.warn, true);
  assert.equal(d.escalate, false);
  assert.equal(d.breachesInWindow, 1);
});

test('the second breach still only warns', () => {
  const d = decideTemperatureEscalation(now(), [T(60)]);
  assert.equal(d.warn, true);
  assert.equal(d.escalate, false);
  assert.equal(d.breachesInWindow, 2);
});

test('the third breach in the window becomes a job', () => {
  // Hourly sensors: readings at T-120, T-60 and now. Two hours elapsed, which
  // is the tightest three readings can possibly be.
  const d = decideTemperatureEscalation(now(), [T(120), T(60)]);
  assert.equal(d.warn, true);
  assert.equal(d.escalate, true);
  assert.equal(d.breachesInWindow, 3);
  assert.equal(d.spanMinutes, 120);
});

test('breaches spread beyond the window do not add up', () => {
  // Yesterday's problem must not combine with today's into a false third.
  const d = decideTemperatureEscalation(now(), [T(400), T(300)]);
  assert.equal(d.escalate, false);
  assert.equal(d.breachesInWindow, 1);
});

test('an in-range reading between breaches does not count towards three', () => {
  const d = decideTemperatureEscalation(now(), [T(120), T(60, 'IN_RANGE')]);
  assert.equal(d.breachesInWindow, 2);
  assert.equal(d.escalate, false);
});

test('a fridge left warm overnight raises one job, not twelve', () => {
  const many = [T(150), T(90), T(30)];
  assert.equal(decideTemperatureEscalation(now(), many).escalate, true);
  assert.equal(decideTemperatureEscalation(now(), many, { alreadyEscalated: true }).escalate, false);
  // It still warns, because the fridge is still wrong.
  assert.equal(decideTemperatureEscalation(now(), many, { alreadyEscalated: true }).warn, true);
});

test('a duplicate reading at the same instant is not two strikes', () => {
  const d = decideTemperatureEscalation(now(), [T(0), T(60)]);
  assert.equal(d.breachesInWindow, 2);
  assert.equal(d.escalate, false);
});

test('the window fits three hourly readings and excludes a fourth hour', () => {
  assert.equal(TEMPERATURE_ESCALATION_WINDOW_MINUTES, 180);
  assert.equal(TEMPERATURE_ESCALATION_THRESHOLD, 3);
  // 179 minutes back is inside; 181 is not.
  assert.equal(decideTemperatureEscalation(now(), [T(179), T(60)]).breachesInWindow, 3);
  assert.equal(decideTemperatureEscalation(now(), [T(181), T(60)]).breachesInWindow, 2);
});
