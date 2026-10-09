/**
 * Venue scope at the route guards, against a real Postgres.
 *
 * Opt-in like menu.integration.test.ts: runs only with ALMA_TEST_DATABASE_URL.
 * Seeds two venues ("ITESTMA St Alma", "ITESTMA Alma Avalon" — reusing the
 * real slugs when the venues already exist), one menu each with a published
 * version, one promotion each; then asks the guards what each kind of user
 * may do and cleans up after itself. No Chrome: nothing is rendered.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AuthUser } from '@alma/shared';

const TEST_DB = process.env.ALMA_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

type Harness = {
  prisma: typeof import('@alma/db').prisma;
  access: typeof import('./menu-access.js');
  HttpError: typeof import('./http.js').HttpError;
};

function person(over: Partial<AuthUser>): AuthUser {
  return {
    id: `itestma-${Math.random().toString(36).slice(2, 8)}`,
    firstName: 'Test',
    lastName: 'Person',
    email: null,
    roleTitle: 'Chef de partie',
    venue: null,
    accountType: 'HUMAN',
    isAdmin: false,
    trainingOnly: false,
    role: 'STAFF',
    appAccess: [],
    ...over
  } as AuthUser;
}

const grant = (role: string, permissions: Record<string, boolean> = {}) => [{ appId: 'MENUS' as const, status: 'ENABLED' as const, role, permissions }];

describe('menu-access guards (Postgres)', { skip: TEST_DB ? false : 'skipped: set ALMA_TEST_DATABASE_URL to run' }, () => {
  let h: Harness;
  const made = { venues: [] as string[], menus: [] as string[], promotions: [] as string[] };
  let stAlma: { id: string; slug: string };
  let avalon: { id: string; slug: string };
  let stAlmaMenu: string;
  let avalonMenu: string;
  let stAlmaVersion: string;
  let stAlmaPromotion: string;
  let avalonPromotion: string;

  before(async () => {
    h = {
      prisma: (await import('@alma/db')).prisma,
      access: await import('./menu-access.js'),
      HttpError: (await import('./http.js')).HttpError
    };
    const venue = async (slug: string, name: string) => {
      const existing = await h.prisma.venue.findUnique({ where: { slug }, select: { id: true, slug: true } });
      if (existing) return existing;
      const created = await h.prisma.venue.create({ data: { slug, name }, select: { id: true, slug: true } });
      made.venues.push(created.id);
      return created;
    };
    stAlma = await venue('st-alma', 'ITESTMA St Alma');
    avalon = await venue('alma-avalon', 'ITESTMA Alma Avalon');
    const menu = async (venueId: string, slug: string) => {
      const row = await h.prisma.menu.create({
        data: {
          venueId,
          name: `ITESTMA ${slug}`,
          slug,
          templateKey: 'freshwater_alacarte',
          versions: { create: { versionNumber: 1, state: 'PUBLISHED' } }
        },
        select: { id: true, versions: { select: { id: true } } }
      });
      made.menus.push(row.id);
      return row;
    };
    const st = await menu(stAlma.id, 'itestma-food');
    stAlmaMenu = st.id;
    stAlmaVersion = st.versions[0]?.id ?? assert.fail('seed version missing');
    avalonMenu = (await menu(avalon.id, 'itestma-food')).id;
    const promotion = async (venueId: string, slug: string) => {
      const row = await h.prisma.promotion.create({ data: { venueId, slug, name: `ITESTMA ${slug}` }, select: { id: true } });
      made.promotions.push(row.id);
      return row.id;
    };
    stAlmaPromotion = await promotion(stAlma.id, 'itestma-promo');
    avalonPromotion = await promotion(avalon.id, 'itestma-promo');
  });

  after(async () => {
    if (!h) return;
    await h.prisma.menuAuditEvent.deleteMany({ where: { OR: [{ menuId: { in: made.menus } }, { promotionId: { in: made.promotions } }] } });
    await h.prisma.promotion.deleteMany({ where: { id: { in: made.promotions } } });
    await h.prisma.menuVersion.deleteMany({ where: { menuId: { in: made.menus } } });
    await h.prisma.menu.deleteMany({ where: { id: { in: made.menus } } });
    if (made.venues.length) await h.prisma.venue.deleteMany({ where: { id: { in: made.venues } } });
    await h.prisma.$disconnect();
  });

  const status = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return 'ok';
    } catch (error) {
      if (error instanceof h.HttpError) return error.statusCode;
      throw error;
    }
  };

  it('resolves the venue from a menu, a version, a promotion and a venue id', async () => {
    assert.equal((await h.access.resolveMenuVenue({ menuId: stAlmaMenu }))?.slug, 'st-alma');
    assert.equal((await h.access.resolveMenuVenue({ versionId: stAlmaVersion }))?.slug, 'st-alma');
    assert.equal((await h.access.resolveMenuVenue({ promotionId: avalonPromotion }))?.slug, 'alma-avalon');
    assert.equal((await h.access.resolveMenuVenue({ venueId: avalon.id }))?.slug, 'alma-avalon');
    assert.equal(await h.access.resolveMenuVenue({ menuId: 'nope' }), null);
  });

  it('a St Alma-limited chef reads St Alma, and the other venue reads as not found', async () => {
    const chef = person({ roleTitle: 'Head Chef', appAccess: grant('USER', { menusVenueStAlma: true }) });
    assert.equal(await status(() => h.access.assertMenuVenueAccess(chef, { menuId: stAlmaMenu })), 'ok');
    assert.equal(await status(() => h.access.assertMenuVenueAccess(chef, { versionId: stAlmaVersion })), 'ok');
    assert.equal(await status(() => h.access.assertMenuVenueAccess(chef, { promotionId: stAlmaPromotion })), 'ok');
    assert.equal(await status(() => h.access.assertMenuVenueAccess(chef, { menuId: avalonMenu })), 404);
    assert.equal(await status(() => h.access.assertMenuVenueAccess(chef, { promotionId: avalonPromotion })), 404);
    assert.equal(await status(() => h.access.assertMenuVenueAccess(chef, { venueId: avalon.id })), 404);
    // Drafting is open to them on their venue; publishing is not, even there — and the title does not help.
    assert.equal(await status(() => h.access.assertMenuPublisher(chef, { menuId: stAlmaMenu })), 403);
    assert.equal(await status(() => h.access.assertMenuPublisher(chef, { menuId: avalonMenu })), 404);
  });

  it('an unlimited chef reads both venues and publishes neither', async () => {
    const chef = person({ roleTitle: 'Head Chef', appAccess: grant('USER') });
    assert.equal(await status(() => h.access.assertMenuVenueAccess(chef, { menuId: stAlmaMenu })), 'ok');
    assert.equal(await status(() => h.access.assertMenuVenueAccess(chef, { menuId: avalonMenu })), 'ok');
    assert.equal(await status(() => h.access.assertMenuPublisher(chef, { menuId: stAlmaMenu })), 403);
    assert.equal(await status(() => h.access.assertMenuPublisher(chef, { promotionId: avalonPromotion })), 403);
  });

  it('a venue manager publishes on their venue only; the other venue is not found', async () => {
    const dirk = person({ roleTitle: 'Venue Manager', role: 'MANAGER', appAccess: grant('USER', { menusPublish: true, menusVenueStAlma: true }) });
    assert.equal(await status(() => h.access.assertMenuPublisher(dirk, { menuId: stAlmaMenu })), 'ok');
    assert.equal(await status(() => h.access.assertMenuPublisher(dirk, { versionId: stAlmaVersion })), 'ok');
    assert.equal(await status(() => h.access.assertMenuPublisher(dirk, { promotionId: stAlmaPromotion })), 'ok');
    assert.equal(await status(() => h.access.assertMenuPublisher(dirk, { venueId: stAlma.id })), 'ok');
    assert.equal(await status(() => h.access.assertMenuPublisher(dirk, { menuId: avalonMenu })), 404);
    assert.equal(await status(() => h.access.assertMenuPublisher(dirk, { promotionId: avalonPromotion })), 404);
    assert.equal(await status(() => h.access.assertMenuPublisher(dirk, { venueId: avalon.id })), 404);
    const trystan = person({ roleTitle: 'Venue Manager', role: 'MANAGER', appAccess: grant('USER', { menusPublish: true, menusVenueAlmaAvalon: true }) });
    assert.equal(await status(() => h.access.assertMenuPublisher(trystan, { menuId: avalonMenu })), 'ok');
    assert.equal(await status(() => h.access.assertMenuPublisher(trystan, { menuId: stAlmaMenu })), 404);
  });

  it('a manager-like title without a Menus grant publishes nowhere', async () => {
    const titled = person({ roleTitle: 'Venue Manager', role: 'MANAGER' });
    assert.equal(await status(() => h.access.assertMenuPublisher(titled, { menuId: stAlmaMenu })), 403);
    assert.equal(await status(() => h.access.assertMenuPublisher(titled, { menuId: avalonMenu })), 403);
  });

  it('admins read and publish everywhere, limits or not; nobody is 401', async () => {
    const admin = person({ isAdmin: true, role: 'ADMIN', appAccess: grant('USER', { menusVenueStAlma: true }) });
    assert.equal(await status(() => h.access.assertMenuPublisher(admin, { menuId: stAlmaMenu })), 'ok');
    assert.equal(await status(() => h.access.assertMenuPublisher(admin, { menuId: avalonMenu })), 'ok');
    assert.equal(await status(() => h.access.assertMenuPublisher(admin, { promotionId: avalonPromotion })), 'ok');
    assert.equal(await status(() => h.access.assertMenuVenueAccess(undefined, { menuId: stAlmaMenu })), 401);
  });

  it('a missing record is left for the service, in scope or not', async () => {
    const dirk = person({ appAccess: grant('USER', { menusPublish: true, menusVenueStAlma: true }) });
    assert.equal(await status(() => h.access.assertMenuVenueAccess(dirk, { menuId: 'does-not-exist' })), 'ok');
    assert.equal(await status(() => h.access.assertMenuPublisher(dirk, { menuId: 'does-not-exist' })), 'ok');
  });
});
