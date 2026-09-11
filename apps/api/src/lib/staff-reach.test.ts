import assert from 'node:assert/strict';
import test from 'node:test';
import { reachesEveryVenue, staffProfileAccessDenial, staffProfileReach } from './staff-reach.js';

const admin = { id: 'admin-1', role: 'ADMIN' as const, isAdmin: true };
const stAlmaManager = { id: 'mgr-freshwater', role: 'MANAGER' as const, isAdmin: false };
const staffMember = { id: 'staff-1', role: 'STAFF' as const, isAdmin: false };

test('a manager based at one venue reaches a hire at the other', () => {
  // The bug this locks out: a St Alma manager onboarding onto Alma Avalon was
  // refused because the venues differed. People management is group-wide.
  assert.equal(staffProfileAccessDenial(stAlmaManager, 'new-avalon-hire'), null);
  assert.deepEqual(staffProfileReach(stAlmaManager), {});
});

test('a manager works every venue, a staff member does not', () => {
  // Rosters, timesheets, clocking, devices, shift tasks and messages all
  // take their venue from the request for a manager, never from their profile.
  assert.equal(reachesEveryVenue(stAlmaManager), true);
  assert.equal(reachesEveryVenue(admin), true);
  assert.equal(reachesEveryVenue(staffMember), false);
});

test('an admin reaches everyone', () => {
  assert.equal(staffProfileAccessDenial(admin, 'anyone'), null);
  assert.deepEqual(staffProfileReach(admin), {});
});

test('a staff member reaches only themselves', () => {
  assert.equal(staffProfileAccessDenial(staffMember, staffMember.id), null);
  assert.equal(
    staffProfileAccessDenial(staffMember, 'someone-else'),
    'You can only access your own staff profile.'
  );
  assert.deepEqual(staffProfileReach(staffMember), { id: staffMember.id });
});

test('no actor means no narrowing — the caller decides what an anonymous list may see', () => {
  assert.deepEqual(staffProfileReach(undefined), {});
  assert.deepEqual(staffProfileReach(null), {});
});
