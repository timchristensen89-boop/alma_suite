import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAvailability, formatMinutes, type AvailabilityRule } from '@alma/shared';

// Local-time helper: the venue reasons about shifts in its own clock.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 7, day, hour, minute);
const rule = (over: Partial<AvailabilityRule> = {}): AvailabilityRule => ({
  weekday: 6, startMinute: null, endMinute: null, available: true, ...over,
});

test('no stated availability never objects', () => {
  // The rule that keeps this feature from becoming a wall of false warnings on
  // the day it ships: a venue that has not filled anything in rosters as before.
  assert.equal(checkAvailability(at(1, 9), at(1, 17), []).kind, 'NOT_STATED');
});

test('a shift inside stated hours is available', () => {
  // 1 Aug 2026 is a Saturday.
  const rules = [rule({ weekday: 6, startMinute: 17 * 60, endMinute: 24 * 60 })];
  assert.equal(checkAvailability(at(1, 18), at(1, 23), rules).kind, 'AVAILABLE');
});

test('a shift running past stated hours objects, and says what was stated', () => {
  const rules = [rule({ weekday: 6, startMinute: 17 * 60, endMinute: 21 * 60 })];
  const verdict = checkAvailability(at(1, 18), at(1, 23), rules);
  assert.equal(verdict.kind, 'OUTSIDE_STATED_HOURS');
  assert.match((verdict as { detail: string }).detail, /5pm–9pm/);
});

test('touching stated hours is not enough — the whole shift must fit', () => {
  // "Available 5-9pm" should object to 8pm-1am even though they overlap.
  const rules = [rule({ weekday: 6, startMinute: 17 * 60, endMinute: 21 * 60 })];
  assert.equal(checkAvailability(at(1, 20), at(2, 1), rules).kind, 'OUTSIDE_STATED_HOURS');
});

test('an explicit unavailable rule blocks and explains', () => {
  const rules = [rule({ weekday: 6, available: false, note: 'uni lectures' })];
  const verdict = checkAvailability(at(1, 9), at(1, 17), rules);
  assert.equal(verdict.kind, 'MARKED_UNAVAILABLE');
  assert.match((verdict as { detail: string }).detail, /uni lectures/);
});

test('stating only what you cannot do leaves the rest of the day open', () => {
  // "I cannot work Saturday mornings" implies Saturday evening is fine.
  const rules = [rule({ weekday: 6, available: false, startMinute: 0, endMinute: 12 * 60 })];
  assert.equal(checkAvailability(at(1, 18), at(1, 23), rules).kind, 'AVAILABLE');
  assert.equal(checkAvailability(at(1, 9), at(1, 11), rules).kind, 'MARKED_UNAVAILABLE');
});

test('rules only apply to their own weekday', () => {
  const rules = [rule({ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 })];
  // Saturday shift, Monday rule — nothing stated for Saturday.
  assert.equal(checkAvailability(at(1, 9), at(1, 17), rules).kind, 'NOT_STATED');
});

test('effective dates put a rule in and out of season', () => {
  const rules = [rule({ weekday: 6, available: false, effectiveFrom: new Date(2026, 8, 1) })];
  // 1 Aug is before the rule starts, so it does not apply yet.
  assert.equal(checkAvailability(at(1, 9), at(1, 17), rules).kind, 'NOT_STATED');
  const expired = [rule({ weekday: 6, available: false, effectiveTo: new Date(2026, 6, 1) })];
  assert.equal(checkAvailability(at(1, 9), at(1, 17), expired).kind, 'NOT_STATED');
});

test('a one-off unavailability beats any recurring rule', () => {
  const rules = [rule({ weekday: 6, startMinute: 0, endMinute: 24 * 60 })];
  const blocks = [{ startsAt: at(1, 0), endsAt: at(2, 0), reason: 'wedding' }];
  const verdict = checkAvailability(at(1, 18), at(1, 23), rules, blocks);
  assert.equal(verdict.kind, 'MARKED_UNAVAILABLE');
  assert.match((verdict as { detail: string }).detail, /wedding/);
});

test('an overnight shift is matched against the day it starts', () => {
  // 7pm-1am on Saturday is a Saturday shift, not a Sunday one.
  const rules = [rule({ weekday: 6, startMinute: 17 * 60, endMinute: 24 * 60 })];
  assert.equal(checkAvailability(at(1, 19), at(2, 1), rules).kind, 'AVAILABLE');
});

test('times read the way a roster reads them', () => {
  assert.equal(formatMinutes(0), '12am');
  assert.equal(formatMinutes(9 * 60), '9am');
  assert.equal(formatMinutes(12 * 60), '12pm');
  assert.equal(formatMinutes(17 * 60 + 30), '5:30pm');
  assert.equal(formatMinutes(24 * 60), 'midnight');
});
