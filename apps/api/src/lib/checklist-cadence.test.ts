import assert from 'node:assert/strict';
import test from 'node:test';
import { describeChecklistCadence, isChecklistDue } from '@alma/shared';

// 2026-08-03 is a Monday, 2026-08-08 a Saturday, 2026-08-09 a Sunday.
const MONDAY = new Date(2026, 7, 3);
const SATURDAY = new Date(2026, 7, 8);
const SUNDAY = new Date(2026, 7, 9);

test('DAILY is due every day', () => {
  assert.equal(isChecklistDue(MONDAY, 'DAILY'), true);
  assert.equal(isChecklistDue(SUNDAY, 'DAILY'), true);
});

test('WEEKDAYS skips the weekend', () => {
  assert.equal(isChecklistDue(MONDAY, 'WEEKDAYS'), true);
  assert.equal(isChecklistDue(SATURDAY, 'WEEKDAYS'), false);
  assert.equal(isChecklistDue(SUNDAY, 'WEEKDAYS'), false);
});

test('WEEKLY lands on its chosen day only', () => {
  assert.equal(isChecklistDue(MONDAY, 'WEEKLY', 1), true);
  assert.equal(isChecklistDue(SATURDAY, 'WEEKLY', 1), false);
  assert.equal(isChecklistDue(SATURDAY, 'WEEKLY', 6), true);
});

test('WEEKLY with no day set still happens, on Monday', () => {
  assert.equal(isChecklistDue(MONDAY, 'WEEKLY', null), true);
  assert.equal(isChecklistDue(SATURDAY, 'WEEKLY', undefined), false);
});

test('MONTHLY lands on its day', () => {
  assert.equal(isChecklistDue(new Date(2026, 7, 1), 'MONTHLY', 1), true);
  assert.equal(isChecklistDue(new Date(2026, 7, 2), 'MONTHLY', 1), false);
  assert.equal(isChecklistDue(new Date(2026, 7, 15), 'MONTHLY', 15), true);
});

test('MONTHLY set past the end of a short month falls to its last day', () => {
  // February 2027 has 28 days; the 31st must not simply skip the month.
  assert.equal(isChecklistDue(new Date(2027, 1, 28), 'MONTHLY', 31), true);
  assert.equal(isChecklistDue(new Date(2027, 1, 27), 'MONTHLY', 31), false);
  // And a month that does reach the 31st still uses it.
  assert.equal(isChecklistDue(new Date(2026, 7, 31), 'MONTHLY', 31), true);
  assert.equal(isChecklistDue(new Date(2026, 7, 28), 'MONTHLY', 31), false);
});

test('MANUAL is never auto-generated', () => {
  assert.equal(isChecklistDue(MONDAY, 'MANUAL'), false);
  assert.equal(isChecklistDue(SUNDAY, 'MANUAL', 1), false);
});

test('describeChecklistCadence reads like a sentence', () => {
  assert.equal(describeChecklistCadence('DAILY'), 'Every day');
  assert.equal(describeChecklistCadence('WEEKLY', 3), 'Every Wednesday');
  assert.equal(describeChecklistCadence('WEEKLY', null), 'Every Monday');
  assert.equal(describeChecklistCadence('MONTHLY', 1), '1st of the month');
  assert.equal(describeChecklistCadence('MONTHLY', 2), '2nd of the month');
  assert.equal(describeChecklistCadence('MONTHLY', 3), '3rd of the month');
  assert.equal(describeChecklistCadence('MONTHLY', 11), '11th of the month');
  assert.equal(describeChecklistCadence('MONTHLY', 22), '22nd of the month');
  assert.equal(describeChecklistCadence('MANUAL'), 'Only when someone starts it');
});
