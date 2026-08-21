import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublic } from './public-paths.js';

/*
 * The roster calendar feed is the reason this file exists.
 *
 * It shipped once with the route written and the allowlist forgotten, and the
 * result was a 401 for every calendar app in the company — invisible in code
 * review, because the route reads as public. These assertions fail loudly if
 * the entry is ever dropped.
 */
test('roster calendar feed answers without a session', () => {
  assert.equal(isPublic('/api/staff/calendar/8xK2mQvR7pLwT4nZ0aYbCdEfGhIjKlMn.ics'), true);
  assert.equal(isPublic('/api/staff/calendar/short.ics'), true, 'the length check belongs to the service, not the gate');
});

test('the calendar entry opens nothing beyond the feed itself', () => {
  // Not an .ics request — a future /api/staff/calendar/* route must opt in
  // deliberately rather than inherit public access from its neighbour.
  assert.equal(isPublic('/api/staff/calendar/token'), false);
  assert.equal(isPublic('/api/staff/calendar/token.ics/shifts'), false);
  // A token may not contain a slash, so no traversal into the rest of staff.
  assert.equal(isPublic('/api/staff/calendar/x/../roster/published.ics'), false);
  assert.equal(isPublic('/api/staff/calendar.ics'), false);
});

test('the rest of the staff surface still needs a session', () => {
  assert.equal(isPublic('/api/staff/me/calendar'), false);
  assert.equal(isPublic('/api/staff/me/calendar/rotate'), false);
  assert.equal(isPublic('/api/staff/abc123/calendar/rotate'), false);
  assert.equal(isPublic('/api/staff/roster/published'), false);
  assert.equal(isPublic('/api/staff/profiles'), false);
});

test('the existing allowlist is unchanged', () => {
  assert.equal(isPublic('/api/health'), true);
  assert.equal(isPublic('/api/auth/login'), true);
  assert.equal(isPublic('/api/staff/invites/by-token/abc'), true);
  assert.equal(isPublic('/api/gift-cards/checkout'), true);
  assert.equal(isPublic('/api/gift-cards/donations'), false);
  assert.equal(isPublic('/api/admin/users'), false);
});
