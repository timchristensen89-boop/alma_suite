import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFLINE_CLOCK_MAX_AGE_HOURS, resolveClockTime } from '@alma/shared';

const NOW = new Date('2026-08-03T09:00:00.000Z');

test('no client time means server time', () => {
  const result = resolveClockTime(undefined, NOW);
  assert.equal(result.at.getTime(), NOW.getTime());
  assert.equal(result.source, 'server');
  assert.equal(result.adjusted, false);
});

test('a genuine offline clock keeps the moment the button was pressed', () => {
  // Queued at 08:12, replayed when the wifi returned at 09:00.
  const pressed = '2026-08-03T08:12:00.000Z';
  const result = resolveClockTime(pressed, NOW);
  assert.equal(result.at.toISOString(), pressed);
  assert.equal(result.source, 'offline');
  assert.equal(result.adjusted, false);
});

test('a phone running fast cannot clock into the future', () => {
  const result = resolveClockTime('2026-08-03T09:30:00.000Z', NOW);
  assert.equal(result.at.getTime(), NOW.getTime());
  assert.equal(result.adjusted, true);
});

test('a time older than the window is clamped, not accepted', () => {
  // Twenty hours back would be a shift written into yesterday.
  const result = resolveClockTime('2026-08-02T13:00:00.000Z', NOW);
  const floor = NOW.getTime() - OFFLINE_CLOCK_MAX_AGE_HOURS * 3600_000;
  assert.equal(result.at.getTime(), floor);
  assert.equal(result.adjusted, true);
});

test('exactly at the window edge is still trusted', () => {
  const edge = new Date(NOW.getTime() - OFFLINE_CLOCK_MAX_AGE_HOURS * 3600_000);
  const result = resolveClockTime(edge.toISOString(), NOW);
  assert.equal(result.at.getTime(), edge.getTime());
  assert.equal(result.adjusted, false);
});

test('rubbish falls back to server time rather than throwing', () => {
  assert.equal(resolveClockTime('not a time', NOW).at.getTime(), NOW.getTime());
  assert.equal(resolveClockTime('', NOW).source, 'server');
});
