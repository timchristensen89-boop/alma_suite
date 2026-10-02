import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { requireCorporateOwner } from './corporate-gift-cards.js';
import { requireManager } from '../lib/auth-middleware.js';

/**
 * The two gates the corporate routes use. requireManager is the suite's own;
 * requireCorporateOwner stacks the gift-card owner check on top of it. Both
 * are exercised with a fake request so the permission matrix in the route
 * file's header comment is checked, not just described.
 */

function user(over: Partial<AuthUser>): AuthUser {
  return {
    id: 'u1',
    firstName: 'A',
    lastName: 'B',
    email: 'manager@almagroup.com.au',
    roleTitle: 'Manager',
    venue: null,
    accountType: 'STAFF',
    isAdmin: false,
    trainingOnly: false,
    role: 'MANAGER',
    appAccess: [],
    ...over
  } as AuthUser;
}

function run(guard: (req: Request, res: Response, next: (error?: unknown) => void) => void, who: AuthUser | undefined): number | 'ok' {
  let outcome: number | 'ok' = 'ok';
  guard({ user: who } as unknown as Request, {} as Response, (error?: unknown) => {
    if (error instanceof HttpError) outcome = error.statusCode;
    else if (error) outcome = 500;
  });
  return outcome;
}

describe('corporate route guards', () => {
  it('managers and admins pass the manager gate; staff, iPads and anonymous do not', () => {
    assert.equal(run(requireManager, user({ role: 'MANAGER' })), 'ok');
    assert.equal(run(requireManager, user({ role: 'ADMIN' })), 'ok');
    assert.equal(run(requireManager, user({ role: 'STAFF', isAdmin: true })), 'ok');
    assert.equal(run(requireManager, user({ role: 'STAFF' })), 403);
    assert.equal(run(requireManager, user({ role: 'MANAGER', accountType: 'VENUE_DEVICE' })), 403);
    assert.equal(run(requireManager, undefined), 401);
  });

  it('only the gift card owner passes the owner gate — a manager cannot change pricing or mark money received', () => {
    assert.equal(run(requireCorporateOwner, user({ role: 'ADMIN', email: 'tim@almagroup.com.au' })), 'ok');
    assert.equal(run(requireCorporateOwner, user({ role: 'ADMIN', email: 'TIM@almagroup.com.au' })), 'ok');
    assert.equal(run(requireCorporateOwner, user({ role: 'MANAGER' })), 403);
    assert.equal(run(requireCorporateOwner, user({ role: 'ADMIN', isAdmin: true, email: 'someone@almagroup.com.au' })), 403);
    assert.equal(run(requireCorporateOwner, user({ role: 'STAFF' })), 403);
    assert.equal(run(requireCorporateOwner, user({ role: 'MANAGER', email: 'tim@almagroup.com.au', accountType: 'VENUE_DEVICE' })), 403);
    assert.equal(run(requireCorporateOwner, undefined), 401);
  });
});
