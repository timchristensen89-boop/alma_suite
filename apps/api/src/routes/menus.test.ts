import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { fromMenuParam, fromPromotionParam, fromVenueBody, fromVersionParam, requireMenuPublisherFor } from '../lib/menu-access.js';

/**
 * The gate the menu routes add on top of the auth middleware: who may
 * publish, and on which venue. The venue itself is looked up in the database
 * (menu-access.ts), so these tests exercise the guard with no venue in the
 * request — the create route with a bad body — which is the one path that
 * decides on the grant alone. The per-venue rule is covered in
 * ../lib/menu-rules.test.ts; the lookups are one-line Prisma selects.
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

const noVenue = requireMenuPublisherFor(() => null);

async function run(who: AuthUser | undefined): Promise<number | 'ok'> {
  let outcome: number | 'ok' = 'ok';
  await noVenue({ user: who } as unknown as Request, {} as Response, (error?: unknown) => {
    if (error instanceof HttpError) outcome = error.statusCode;
    else if (error) outcome = 500;
  });
  return outcome;
}

describe('requireMenuPublisherFor — the grant alone', () => {
  it('admins and explicit Menus publishers may publish', async () => {
    assert.equal(await run(user({ role: 'ADMIN' })), 'ok');
    assert.equal(await run(user({ isAdmin: true })), 'ok');
    assert.equal(await run(user({ appAccess: [{ appId: 'MENUS', status: 'ENABLED', role: 'MANAGER', permissions: {} }] })), 'ok');
    assert.equal(await run(user({ appAccess: [{ appId: 'MENUS', status: 'ENABLED', role: 'USER', permissions: { menusPublish: true } }] })), 'ok');
  });

  it('a manager-like title, the head chef, a draft-only chef, a shared iPad and an anonymous caller may not', async () => {
    assert.equal(await run(user({ role: 'MANAGER', roleTitle: 'Venue Manager' })), 403);
    assert.equal(await run(user({ roleTitle: 'Head Chef' })), 403);
    assert.equal(await run(user({ appAccess: [{ appId: 'MENUS', status: 'ENABLED', role: 'USER', permissions: {} }] })), 403);
    assert.equal(await run(user({ isAdmin: true, accountType: 'VENUE_DEVICE' })), 403);
    assert.equal(await run(undefined), 401);
  });
});

describe('venue sources — where each route finds its venue', () => {
  const req = (params: Record<string, string>, body?: unknown) => ({ params, body }) as unknown as Request;
  it('reads the route params and the create body', () => {
    assert.deepEqual(fromMenuParam(req({ menuId: 'm1' })), { menuId: 'm1' });
    assert.deepEqual(fromVersionParam(req({ versionId: 'v1' })), { versionId: 'v1' });
    assert.deepEqual(fromPromotionParam(req({ promotionId: 'p1' })), { promotionId: 'p1' });
    assert.deepEqual(fromVenueBody(req({}, { venueId: 'ven1', name: 'Tuesday' })), { venueId: 'ven1' });
  });
  it('yields nothing for a create without a venue, so the schema reports it', () => {
    assert.equal(fromVenueBody(req({}, { name: 'Tuesday' })), null);
    assert.equal(fromVenueBody(req({}, undefined)), null);
    assert.equal(fromVenueBody(req({}, { venueId: 42 })), null);
  });
});
