import assert from 'node:assert/strict';
import test from 'node:test';
import { rosterPushNotification } from '@alma/shared';

// Sydney is UTC+10 in August, so these instants are evening shifts locally.
const friEvening = {
  startsAt: '2026-08-21T07:00:00.000Z',
  endsAt: '2026-08-21T13:00:00.000Z',
  venue: 'St Alma',
  area: 'Floor',
  roleTitle: 'Bar'
};
const satEvening = {
  startsAt: '2026-08-22T07:00:00.000Z',
  endsAt: '2026-08-22T13:00:00.000Z',
  venue: 'Alma Avalon',
  area: null,
  roleTitle: 'Floor'
};

test('one shift reads as the shift itself', () => {
  const { title, body } = rosterPushNotification([friEvening]);
  assert.equal(title, 'Your roster is up');
  assert.equal(body, 'Friday 21 August, 5:00pm – 11:00pm · Bar · St Alma');
});

test('several shifts lead with the count and spell out the first', () => {
  const { title, body } = rosterPushNotification([satEvening, friEvening]);
  assert.equal(title, 'Your roster is up — 2 shifts');
  // Sorted, so "first up" is Friday even though Saturday was passed first.
  assert.equal(body, 'First up: Friday 21 August, 5:00pm – 11:00pm · Bar · St Alma');
});

test('sorting does not mutate the caller’s array', () => {
  const shifts = [satEvening, friEvening];
  rosterPushNotification(shifts);
  assert.equal(shifts[0], satEvening, 'the array passed in should be left alone');
});

test('an empty roster still says something true', () => {
  const { title, body } = rosterPushNotification([]);
  assert.equal(title, 'Your roster is up');
  assert.ok(body.length > 0);
});

test('the whole thing stays short enough for a lock screen', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({
    ...friEvening,
    startsAt: `2026-08-2${i + 1}T07:00:00.000Z`,
    endsAt: `2026-08-2${i + 1}T13:00:00.000Z`
  }));
  const { title, body } = rosterPushNotification(many);
  assert.ok(title.length <= 64, `title too long: ${title.length}`);
  assert.ok(body.length <= 120, `body too long: ${body.length}`);
});
