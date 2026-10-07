import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { requireMenuPublisher } from './menus.js';

/**
 * The one gate the menu routes add on top of the auth middleware: who may
 * publish. Drafting is open to anyone the middleware lets into /api/menus.
 */

function user(over: Partial<AuthUser>): AuthUser {
  return {
    id: 'u1',
    firstName: 'A',
    lastName: 'B',
    email: 'chef@almagroup.com.au',
    roleTitle: 'Chef de partie',
    venue: 'St Alma',
    accountType: 'HUMAN',
    isAdmin: false,
    trainingOnly: false,
    role: 'STAFF',
    appAccess: [],
    ...over
  } as AuthUser;
}

function run(who: AuthUser | undefined): number | 'ok' {
  let outcome: number | 'ok' = 'ok';
  requireMenuPublisher({ user: who } as unknown as Request, {} as Response, (error?: unknown) => {
    if (error instanceof HttpError) outcome = error.statusCode;
    else if (error) outcome = 500;
  });
  return outcome;
}

describe('requireMenuPublisher', () => {
  it('managers, admins and the head chef may publish', () => {
    assert.equal(run(user({ role: 'MANAGER' })), 'ok');
    assert.equal(run(user({ role: 'ADMIN' })), 'ok');
    assert.equal(run(user({ isAdmin: true })), 'ok');
    assert.equal(run(user({ roleTitle: 'Head Chef' })), 'ok');
    assert.equal(run(user({ roleTitle: 'head chef (kitchen)' })), 'ok');
    assert.equal(run(user({ appAccess: [{ appId: 'MENUS', status: 'ENABLED', role: 'MANAGER', permissions: {} }] })), 'ok');
  });

  it('a chef with draft rights only, a shared iPad and an anonymous caller may not', () => {
    assert.equal(run(user({ appAccess: [{ appId: 'MENUS', status: 'ENABLED', role: 'USER', permissions: {} }] })), 403);
    assert.equal(run(user({ role: 'MANAGER', accountType: 'VENUE_DEVICE' })), 403);
    assert.equal(run(undefined), 401);
  });
});
