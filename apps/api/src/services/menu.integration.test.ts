/**
 * Menu Editor — real-database integration tests.
 *
 * Opt-in: runs only when ALMA_TEST_DATABASE_URL points at a Postgres with the
 * migration history applied. Without it every test here is skipped, so the
 * ordinary `pnpm --filter @alma/api test` stays database-free.
 *
 *   ALMA_TEST_DATABASE_URL=postgresql://alma:alma@127.0.0.1:5432/alma_suite_v18 \
 *     node --import tsx --test src/services/menu.integration.test.ts
 *
 * Publishing is exercised only when headless Chrome is available too (the
 * publish path renders the PDF); the draft/restore/audit invariants run
 * regardless.
 *
 * Every row these tests create hangs off a venue whose slug starts with
 * "itest-", and is deleted again in setup, so a run can be repeated.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MenuDocument } from '@alma/shared';

const TEST_DB = process.env.ALMA_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

type Harness = {
  prisma: typeof import('@alma/db').prisma;
  menus: typeof import('./menu.service.js').menuService;
  chromeOk: boolean;
  closeBrowser: () => Promise<void>;
  HttpError: typeof import('../lib/http.js').HttpError;
};

let h: Harness;
let venueId = '';
let menuId = '';

const chef = { id: 'itest-chef', firstName: 'Itest', lastName: 'Chef', email: 'itest-chef@almagroup.com.au', roleTitle: 'Head Chef', venue: 'ITEST', accountType: 'HUMAN', isAdmin: false, trainingOnly: false, role: 'STAFF', appAccess: [] } as unknown as import('@alma/shared').AuthUser;

const DOC: MenuDocument = {
  dietaryNote: 'Dietaries catered with notice.',
  surchargeLine: 'A surcharge of 10% applies on weekends.',
  sections: [
    {
      title: 'To start',
      headerSuffix: null,
      subheading: null,
      sectionType: 'STANDARD',
      placement: 'LEFT',
      visible: true,
      items: [
        { dishKey: 'it-guac', name: 'Guacamole', description: 'Tostadas', priceCents: 1700, priceUnit: null, tags: ['VG', 'GFA'], isSeafood: false, visible: true, recipeId: null },
        { dishKey: 'it-prawn', name: 'Prawn tostada', description: 'Avocado', priceCents: 2300, priceUnit: null, tags: ['GFA', 'I'], isSeafood: true, visible: true, recipeId: null }
      ]
    },
    {
      title: 'Trust our chef',
      headerSuffix: null,
      subheading: 'For the whole table.',
      sectionType: 'SET_MENUS',
      placement: 'FULL',
      visible: true,
      items: [{ dishKey: 'it-grazing', name: 'Grazing', description: 'A lighter spread.', priceCents: 4900, priceUnit: 'pp', tags: [], isSeafood: false, visible: true, recipeId: null }]
    }
  ]
};

async function wipe() {
  const venues = await h.prisma.venue.findMany({ where: { slug: { startsWith: 'itest-' } }, select: { id: true } });
  await h.prisma.menuAuditEvent.deleteMany({ where: { menu: { venueId: { in: venues.map((v) => v.id) } } } });
  await h.prisma.menu.deleteMany({ where: { venueId: { in: venues.map((v) => v.id) } } });
  await h.prisma.venue.deleteMany({ where: { id: { in: venues.map((v) => v.id) } } });
}

describe('menu service (Postgres)', { skip: TEST_DB ? false : 'skipped: set ALMA_TEST_DATABASE_URL to run' }, () => {
  before(async () => {
    const [{ prisma }, { menuService }, pdf, http] = await Promise.all([
      import('@alma/db'),
      import('./menu.service.js'),
      import('../lib/menu-pdf.js'),
      import('../lib/http.js')
    ]);
    h = { prisma, menus: menuService, chromeOk: pdf.chromeStatus().ok, closeBrowser: pdf.closeMenuBrowser, HttpError: http.HttpError };
    await wipe();
    const venue = await h.prisma.venue.create({ data: { name: 'ITEST Venue', slug: 'itest-venue' } });
    venueId = venue.id;
    const menu = await h.prisma.menu.create({ data: { venueId, name: 'ITEST Food', templateKey: 'freshwater_alacarte' } });
    menuId = menu.id;
  });

  after(async () => {
    await wipe();
    await h.closeBrowser();
    await h.prisma.$disconnect();
  });

  it('starts an empty draft, saves it, keeps dish keys stable, and writes the audit trail', async () => {
    const created = await h.menus.createDraft(menuId, chef);
    assert.equal(created.version.state, 'DRAFT');
    assert.equal(created.version.versionNumber, 1);
    assert.deepEqual(created.document.sections, []);
    assert.equal(created.publishedDocument, null);

    const saved = await h.menus.saveDraft(menuId, DOC, chef);
    assert.equal(saved.document.sections.length, 2);
    assert.deepEqual(
      saved.document.sections[0]!.items.map((item) => item.dishKey),
      ['it-guac', 'it-prawn']
    );

    // A new dish without a key gets one; existing keys survive a re-save by id.
    const again = await h.menus.saveDraft(
      menuId,
      {
        ...saved.document,
        sections: saved.document.sections.map((section, index) =>
          index === 0
            ? { ...section, items: [...section.items.map(({ dishKey: _k, ...rest }) => rest), { name: 'Oysters', description: null, priceCents: 2400, priceUnit: null, tags: ['A'], isSeafood: true, visible: true, recipeId: null }] }
            : section
        )
      },
      chef
    );
    const keys = again.document.sections[0]!.items.map((item) => item.dishKey);
    assert.equal(keys[0], 'it-guac');
    assert.equal(keys[1], 'it-prawn');
    assert.match(keys[2] ?? '', /^oysters-/);

    const audit = await h.menus.listAudit(menuId);
    assert.deepEqual(audit.map((entry) => entry.action), ['draft.saved', 'draft.saved', 'draft.created']);
    assert.equal(audit[0]!.actor.name, 'Itest Chef');
    assert.match(audit[0]!.summary, /1 dish added/);
  });

  it('refuses a second draft and a stale save, and a no-op save does not move updatedAt', async () => {
    await assert.rejects(h.menus.createDraft(menuId, chef), (error: unknown) => error instanceof h.HttpError && error.statusCode === 409);
    await assert.rejects(
      h.menus.saveDraft(menuId, { ...DOC, expectedUpdatedAt: new Date(0).toISOString() }, chef),
      (error: unknown) => error instanceof h.HttpError && error.statusCode === 409
    );
    const before = await h.menus.getDraft(menuId);
    const same = await h.menus.saveDraft(menuId, { ...before.document, expectedUpdatedAt: before.version.updatedAt }, chef);
    assert.equal(same.version.updatedAt, before.version.updatedAt);
    // Two editors with the same updatedAt: the second write finds the row moved on and is refused.
    const a = { ...before.document, dietaryNote: 'A was here', expectedUpdatedAt: before.version.updatedAt };
    const b = { ...before.document, dietaryNote: 'B was here', expectedUpdatedAt: before.version.updatedAt };
    const results = await Promise.allSettled([h.menus.saveDraft(menuId, a, chef), h.menus.saveDraft(menuId, b, chef)]);
    const outcomes = results.map((result) => (result.status === 'fulfilled' ? 'ok' : result.reason instanceof h.HttpError ? result.reason.statusCode : 'error')).sort();
    assert.deepEqual(outcomes, [409, 'ok']);
    // Concurrent "start a draft" clicks on a menu without one produce exactly one draft.
    const venue2 = await h.prisma.venue.create({ data: { name: 'ITEST Venue 2', slug: 'itest-venue-2' } });
    const menu2 = await h.prisma.menu.create({ data: { venueId: venue2.id, name: 'ITEST Food 2', templateKey: 'avalon_alacarte' } });
    const starts = await Promise.allSettled([h.menus.createDraft(menu2.id, chef), h.menus.createDraft(menu2.id, chef), h.menus.createDraft(menu2.id, chef)]);
    assert.equal(starts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(await h.prisma.menuVersion.count({ where: { menuId: menu2.id, state: 'DRAFT' } }), 1);
    // put the footer back for the rest of the run
    const current = await h.menus.getDraft(menuId);
    await h.menus.saveDraft(menuId, { ...current.document, dietaryNote: DOC.dietaryNote }, chef);
  });

  it('blocks publish on a validation error without touching the draft', async () => {
    const draft = await h.menus.getDraft(menuId);
    const broken = { ...draft.document, sections: draft.document.sections.map((section, index) => (index === 0 ? { ...section, items: section.items.map((item) => (item.dishKey === 'it-prawn' ? { ...item, tags: ['GFA' as const] } : item)) } : section)) };
    await h.menus.saveDraft(menuId, broken, chef);
    await assert.rejects(h.menus.publish(menuId, {}, chef), (error: unknown) => {
      assert.ok(error instanceof h.HttpError);
      assert.equal(error.statusCode, 422);
      const details = error.details as { validation: { errors: Array<{ code: string }> } };
      assert.deepEqual(details.validation.errors.map((issue) => issue.code), ['SEAFOOD_NO_ORIGIN']);
      return true;
    });
    const still = await h.menus.getDraft(menuId);
    assert.equal(still.version.state, 'DRAFT');
    // put the origin tag back for the rest of the run
    await h.menus.saveDraft(menuId, draft.document, chef);
  });

  it('publishes with a PDF, then restoring the published version creates a new draft and leaves history untouched', async (t) => {
    if (!h.chromeOk) {
      t.skip('headless Chrome not available');
      return;
    }
    const started = Date.now();
    const published = await h.menus.publish(menuId, {}, chef);
    const elapsed = Date.now() - started;
    assert.equal(published.version.state, 'PUBLISHED');
    assert.equal(published.version.hasPdf, true);
    assert.ok(elapsed < 15_000, `publish took ${elapsed} ms`);
    assert.equal(published.snapshot.sections.length, 2);
    const pdf = await h.menus.getVersionPdf(published.version.id);
    assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.filename, /itest-venue-itest-food-v1\.pdf/);

    // No draft now; the home card shows the published version.
    const summary = await h.menus.get(menuId);
    assert.equal(summary.published?.versionNumber, 1);
    assert.equal(summary.draft, null);

    // Restore v1 → draft v2. v1 is unchanged, byte for byte.
    const before = await h.prisma.menuVersion.findUniqueOrThrow({ where: { id: published.version.id } });
    const restored = await h.menus.restore(published.version.id, {}, chef);
    assert.equal(restored.version.state, 'DRAFT');
    assert.equal(restored.version.versionNumber, 2);
    assert.equal(restored.version.restoredFromVersionId, published.version.id);
    // The dish keys from v1 come back exactly; the Oysters key minted in the first test survives too.
    const restoredKeys = restored.document.sections.flatMap((section) => section.items.map((item) => item.dishKey));
    assert.equal(restoredKeys.length, 4);
    assert.deepEqual([restoredKeys[0], restoredKeys[1], restoredKeys[3]], ['it-guac', 'it-prawn', 'it-grazing']);
    assert.match(restoredKeys[2] ?? '', /^oysters-/);
    const afterRow = await h.prisma.menuVersion.findUniqueOrThrow({ where: { id: published.version.id } });
    assert.equal(afterRow.state, 'PUBLISHED');
    assert.equal(afterRow.updatedAt.toISOString(), before.updatedAt.toISOString());
    assert.equal(Buffer.from(afterRow.pdfData!).equals(Buffer.from(before.pdfData!)), true);
    assert.deepEqual(afterRow.snapshotJson, before.snapshotJson);

    // A second restore needs explicit consent to replace the draft.
    await assert.rejects(h.menus.restore(published.version.id, {}, chef), (error: unknown) => error instanceof h.HttpError && error.statusCode === 409);
    const replaced = await h.menus.restore(published.version.id, { replaceDraft: true }, chef);
    assert.equal(replaced.version.versionNumber, 3);
    const versions = await h.menus.listVersions(menuId);
    assert.deepEqual(versions.map((version) => [version.versionNumber, version.state]), [[3, 'DRAFT'], [1, 'PUBLISHED']]);

    // Change a price in the draft, publish v3: v1 archives, v3 is live, the diff names the price change.
    const draft = await h.menus.getDraft(menuId);
    const repriced = { ...draft.document, sections: draft.document.sections.map((section) => ({ ...section, items: section.items.map((item) => (item.dishKey === 'it-guac' ? { ...item, priceCents: 1800 } : item)) })) };
    await h.menus.saveDraft(menuId, repriced, chef);
    const preview = await h.menus.publishPreview(menuId);
    assert.equal(preview.canPublish, true);
    assert.deepEqual(preview.diff.priceChanges.map((change) => [change.name, change.from, change.to]), [['Guacamole', '17', '18']]);
    const v3 = await h.menus.publish(menuId, {}, chef);
    assert.equal(v3.version.versionNumber, 3);
    const after3 = await h.menus.listVersions(menuId);
    assert.deepEqual(after3.map((version) => [version.versionNumber, version.state]), [[3, 'PUBLISHED'], [1, 'ARCHIVED']]);

    const audit = await h.menus.listAudit(menuId);
    assert.equal(audit[0]!.action, 'published');
    assert.match(audit[0]!.summary, /Published v3 \(replacing v1\): 1 price change/);
    assert.ok(audit.some((entry) => entry.action === 'restored'));
  });
});
