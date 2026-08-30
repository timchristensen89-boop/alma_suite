import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthUser } from '@alma/shared';
import { assertMayEnterCounts, isStockManager } from './stock-permissions.js';

// Overrides are deliberately untyped: some of these cases are values the
// AuthUser type forbids but the database can still hold (a lowercase role),
// and those are exactly the ones worth asserting on.
function user(overrides: Record<string, unknown>): AuthUser {
  return { id: 'u1', role: 'STAFF', isAdmin: false, ...overrides } as unknown as AuthUser;
}

const open = { status: 'IN_PROGRESS', appliedAt: null };
const reopened = { status: 'REOPENED', appliedAt: null };

test('isStockManager matches the server rule exactly', () => {
  assert.equal(isStockManager(user({ role: 'MANAGER' })), true);
  assert.equal(isStockManager(user({ role: 'ADMIN' })), true);
  assert.equal(isStockManager(user({ role: 'STAFF', isAdmin: true })), true);
  assert.equal(isStockManager(user({ role: 'STAFF' })), false);
  assert.equal(isStockManager(null), false);
  assert.equal(isStockManager(undefined), false);

  // The comparison is case-sensitive on purpose — it mirrors the check the
  // rest of the suite makes. A lowercase role is not a manager, and the UI
  // must not tick boxes the server will refuse.
  assert.equal(isStockManager(user({ role: 'manager' })), false);
});

test('a counter may write counts to an open stocktake', () => {
  assert.doesNotThrow(() => assertMayEnterCounts(open, undefined));
  assert.doesNotThrow(() => assertMayEnterCounts(reopened, undefined));
  // Save draft re-sends the status it already has; that is not a transition.
  assert.doesNotThrow(() => assertMayEnterCounts(open, 'IN_PROGRESS'));
  assert.doesNotThrow(() => assertMayEnterCounts(reopened, 'REOPENED'));
});

test('a counter cannot move the stocktake to another status', () => {
  // This is the web form's "Submit for review" button, which staff no longer
  // see — but the server refuses it whatever the client sends.
  assert.throws(() => assertMayEnterCounts(open, 'SUBMITTED'), /Manager access required/);
  assert.throws(() => assertMayEnterCounts(open, 'REVIEWED'), /Manager access required/);
  assert.throws(() => assertMayEnterCounts(open, 'LOCKED'), /Manager access required/);
  assert.throws(() => assertMayEnterCounts(open, 'REOPENED'), /Manager access required/);
});

test('a counter cannot write to a stocktake that has left counting', () => {
  for (const status of ['SUBMITTED', 'REVIEWED', 'LOCKED']) {
    assert.throws(
      () => assertMayEnterCounts({ status, appliedAt: null }, undefined),
      /closed for counting/,
      `${status} should be closed to counters`
    );
  }
});

test('a counter can never touch a count already applied to stock', () => {
  // Applied is checked before status, so even an applied count that was
  // reopened stays manager-only: undoing a ledger movement is not counting.
  assert.throws(
    () => assertMayEnterCounts({ status: 'IN_PROGRESS', appliedAt: new Date() }, undefined),
    /applied to stock/
  );
  assert.throws(
    () => assertMayEnterCounts({ status: 'REOPENED', appliedAt: new Date() }, undefined),
    /applied to stock/
  );
});
