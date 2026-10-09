/**
 * Menus V2 — real-database integration tests for what V2 added to the
 * service: kinds and templates per kind, immutable slugs, visibility, the
 * private-event details, multi-page publishing with the per-page gate, the
 * public read surface, and reading a v1 snapshot back.
 *
 * Opt-in like menu.integration.test.ts: runs only with ALMA_TEST_DATABASE_URL
 * (a Postgres with the migration history applied). Publishing needs headless
 * Chrome; ALMA_TEST_REQUIRE_CHROME=1 turns a missing Chrome into a failure.
 *
 * Templates are bound to the real venue slugs, so this file creates (or
 * reuses) a venue with slug "st-alma" and names everything it makes
 * "ITESTV2 …"; setup and teardown delete exactly those menus, and the venue
 * only if this file created it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MENU_DOCUMENT_DEFAULTS, type MenuDocument, type MenuSectionDocument } from '@alma/shared';

const TEST_DB = process.env.ALMA_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
const REQUIRE_CHROME = process.env.ALMA_TEST_REQUIRE_CHROME === '1';

type Harness = {
  prisma: typeof import('@alma/db').prisma;
  menus: typeof import('./menu.service.js').menuService;
  chromeOk: boolean;
  closeBrowser: () => Promise<void>;
  HttpError: typeof import('../lib/http.js').HttpError;
};

let h: Harness;
let venueId = '';
let createdVenue = false;

const manager = { id: 'itestv2-manager', firstName: 'Itest', lastName: 'Manager', email: 'itestv2-manager@almagroup.com.au', roleTitle: 'Venue Manager', venue: 'St Alma', accountType: 'HUMAN', isAdmin: false, trainingOnly: false, role: 'MANAGER', appAccess: [] } as unknown as import('@alma/shared').AuthUser;

function section(over: Partial<MenuSectionDocument> & { title: string }): MenuSectionDocument {
  return { headerSuffix: null, subheading: null, sectionType: 'STANDARD', placement: 'LEFT', page: 1, lead: null, body: null, priceColumns: [], visible: true, items: [], ...over };
}

function cocktail(name: string, price: number) {
  return { dishKey: `v2-${name.toLowerCase().replace(/\s+/g, '-')}`, name, description: 'Tequila, lime, agave', priceCents: price, priceUnit: null, prices: [], meta: null, note: null, flags: [], tags: [], isSeafood: false, visible: true, recipeId: null };
}

const DRINKS: MenuDocument = {
  ...MENU_DOCUMENT_DEFAULTS,
  pageCount: 3,
  surchargeLine: 'A surcharge of 10% applies on weekends and 15% on public holidays.',
  sections: [
    section({ title: 'Cocktails', page: 2, subheading: 'All margaritas available spicy on request.', items: [cocktail('Classic margarita', 2300), cocktail('Tommy’s margarita', 2300)] }),
    section({
      title: 'Wine',
      page: 3,
      sectionType: 'TABLE',
      priceColumns: ['150 mL', '250 mL', 'Bottle'],
      items: [{ ...cocktail('Riesling', 0), priceCents: null, prices: [1400, null, 6800], meta: 'Eden Valley', description: null }]
    }),
    section({ title: 'Beer', page: 3, sectionType: 'LIST', items: [{ ...cocktail('Corona', 0), priceCents: null, description: null }] })
  ]
};

async function wipeMenus() {
  const menus = await h.prisma.menu.findMany({ where: { name: { startsWith: 'ITESTV2 ' } }, select: { id: true } });
  const ids = menus.map((menu) => menu.id);
  await h.prisma.menuAuditEvent.deleteMany({ where: { menuId: { in: ids } } });
  await h.prisma.menu.deleteMany({ where: { id: { in: ids } } });
}

describe('menus v2 (Postgres)', { skip: TEST_DB ? false : 'skipped: set ALMA_TEST_DATABASE_URL to run' }, () => {
  before(async () => {
    const [{ prisma }, { menuService }, pdf, http] = await Promise.all([import('@alma/db'), import('./menu.service.js'), import('../lib/menu-pdf.js'), import('../lib/http.js')]);
    h = { prisma, menus: menuService, chromeOk: pdf.chromeStatus().ok, closeBrowser: pdf.closeMenuBrowser, HttpError: http.HttpError };
    if (REQUIRE_CHROME && !h.chromeOk) throw new Error(`ALMA_TEST_REQUIRE_CHROME=1 but Chrome is not available: ${pdf.chromeStatus().message}`);
    // A previous run that died may have left menus behind — and, if it made the venue, the venue.
    await wipeMenus();
    const existing = await h.prisma.venue.findUnique({ where: { slug: 'st-alma' }, select: { id: true, name: true } });
    if (existing && existing.name !== 'ITESTV2 St Alma') {
      venueId = existing.id;
    } else {
      if (existing) await h.prisma.venue.delete({ where: { id: existing.id } });
      venueId = (await h.prisma.venue.create({ data: { name: 'ITESTV2 St Alma', slug: 'st-alma' } })).id;
      createdVenue = true;
    }
  });

  after(async () => {
    await wipeMenus();
    if (createdVenue) await h.prisma.venue.deleteMany({ where: { slug: 'st-alma', name: 'ITESTV2 St Alma' } });
    await h.closeBrowser();
    await h.prisma.$disconnect();
  });

  it('creates menus by kind on the venue’s template for that kind, with a slug that survives a rename', async () => {
    const drinks = await h.menus.createMenu({ venueId, name: 'ITESTV2 Drinks', kind: 'DRINKS' }, manager);
    assert.equal(drinks.kind, 'DRINKS');
    assert.equal(drinks.templateKey, 'freshwater_drinks_binder');
    assert.equal(drinks.slug, 'itestv2-drinks');
    assert.equal(drinks.visibility, 'PUBLIC');
    assert.equal(drinks.printedHeading, 'Drinks', 'the template title until the draft has a heading');
    const draft = await h.menus.getDraft(drinks.id);
    assert.equal(draft.document.pageCount, 1);
    assert.match(draft.document.surchargeLine, /vintages/i, 'the template’s footer default');

    // Functions is a group document: any venue may own it; the food template is refused for it.
    const functions = await h.menus.createMenu({ venueId, name: 'ITESTV2 Functions', kind: 'FUNCTIONS' }, manager);
    assert.equal(functions.templateKey, 'group_functions_a4');
    await assert.rejects(h.menus.createMenu({ venueId, name: 'ITESTV2 Wrong', kind: 'FUNCTIONS', templateKey: 'freshwater_alacarte' }, manager), (error: unknown) => error instanceof h.HttpError && error.statusCode === 400);
    // Promotions and private events share the venue's A5 card; a kind no venue has a template for is refused (409, not a crash).
    const promo = await h.menus.createMenu({ venueId, name: 'ITESTV2 Promo', kind: 'PROMOTION' }, manager);
    assert.equal(promo.templateKey, 'freshwater_card_a5');
    assert.equal(promo.promotion, null, 'a card is not a promotion until one links it');
    await assert.rejects(h.menus.createMenu({ venueId: (await h.prisma.venue.create({ data: { name: 'ITESTV2 Manly', slug: 'itestv2-manly' } })).id, name: 'ITESTV2 Promo', kind: 'PROMOTION' }, manager), (error: unknown) => error instanceof h.HttpError && error.statusCode === 409);
    await h.prisma.venue.deleteMany({ where: { slug: 'itestv2-manly' } });

    // Slugs are de-duplicated when two names slugify the same way, and never change on rename.
    const a = await h.menus.createMenu({ venueId, name: 'ITESTV2 Tuesday', kind: 'FOOD' }, manager);
    const b = await h.menus.createMenu({ venueId, name: 'ITESTV2 Tuesday!', kind: 'FOOD' }, manager);
    assert.equal(a.slug, 'itestv2-tuesday');
    assert.equal(b.slug, 'itestv2-tuesday-2');
    const renamed = await h.menus.updateMenu(a.id, { name: 'ITESTV2 Taco Tuesday' }, manager);
    assert.equal(renamed.name, 'ITESTV2 Taco Tuesday');
    assert.equal(renamed.slug, 'itestv2-tuesday');
    const audit = await h.menus.listAudit(a.id);
    assert.equal(audit[0]!.action, 'menu.renamed');

    // Visibility and the private-event details are PATCHable on their own; nothing else moves.
    const detailed = await h.menus.updateMenu(b.id, { visibility: 'PRIVATE', eventName: 'Smith wedding', eventDate: '2026-11-14', guestCount: 40 }, manager);
    assert.equal(detailed.visibility, 'PRIVATE');
    assert.equal(detailed.event.eventName, 'Smith wedding');
    assert.equal(detailed.event.eventDate, '2026-11-14T00:00:00.000Z');
    assert.equal(detailed.event.guestCount, 40);
    assert.equal(detailed.name, 'ITESTV2 Tuesday!');
    assert.equal((await h.menus.listAudit(b.id))[0]!.action, 'menu.updated');
    await assert.rejects(h.menus.updateMenu(b.id, {}, manager));
  });

  it('publishes a three-page drinks menu, serves it publicly, and keeps drafts, private and archived menus off the public surface', { skip: !h?.chromeOk && !REQUIRE_CHROME ? 'skipped: headless Chrome not available' : false }, async () => {
    const drinks = (await h.menus.list()).find((menu) => menu.name === 'ITESTV2 Drinks')!;
    // Nothing is public before a publish.
    const before = await h.menus.publicMenus('st-alma');
    assert.equal(before.menus.some((menu) => menu.slug === drinks.slug), false);
    await assert.rejects(h.menus.publicMenu('st-alma', drinks.slug), (error: unknown) => error instanceof h.HttpError && error.statusCode === 404);

    const saved = await h.menus.saveDraft(drinks.id, DRINKS, manager);
    assert.equal(saved.document.pageCount, 3);
    assert.deepEqual(saved.document.sections.map((section) => section.page), [2, 3, 3]);
    assert.deepEqual(saved.document.sections[1]!.items[0]!.prices, [1400, null, 6800]);

    const preview = await h.menus.publishPreview(drinks.id);
    assert.equal(preview.validation.ok, true, JSON.stringify(preview.validation.errors));
    assert.equal(preview.fill?.pages?.length, 3);
    assert.equal(preview.canPublish, true);

    const published = await h.menus.publish(drinks.id, { acknowledgeWarnings: true }, manager);
    assert.equal(published.version.state, 'PUBLISHED');
    assert.equal(published.version.pageCount, 3);
    assert.equal(published.snapshot.schemaVersion, 2);
    assert.equal(published.snapshot.pageCount, 3);
    const pdf = await h.menus.getVersionPdf(published.version.id);
    assert.equal(pdf.filename, `st-alma-${drinks.slug}-v1.pdf`);
    assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    assert.equal((await PDFDocument.load(pdf.bytes, { updateMetadata: false })).getPageCount(), 3);

    // Public surface: the summary, the snapshot and the PDF, by venue slug and menu slug.
    const listed = (await h.menus.publicMenus('st-alma')).menus.find((menu) => menu.slug === drinks.slug)!;
    assert.equal(listed.kind, 'DRINKS');
    assert.equal(listed.format, 'A5L');
    assert.equal(listed.pageCount, 3);
    assert.equal(listed.versionId, published.version.id);
    assert.match(listed.pdfUrl, new RegExp(`/api/public/menus/st-alma/${drinks.slug}\\.pdf\\?v=${published.version.id}$`));
    const doc = await h.menus.publicMenu('st-alma', drinks.slug);
    assert.equal(doc.document.sections[1]!.sectionType, 'TABLE');
    assert.equal(doc.venue.slug, 'st-alma');
    const publicPdf = await h.menus.publicMenuPdf('st-alma', drinks.slug);
    assert.equal(publicPdf.filename, `st-alma-${drinks.slug}.pdf`);
    assert.equal(publicPdf.versionId, published.version.id);

    // A new draft changes nothing public; a private menu and an archived menu disappear from it.
    await h.menus.createDraft(drinks.id, manager);
    assert.equal((await h.menus.publicMenu('st-alma', drinks.slug)).versionId, published.version.id);
    await h.menus.updateMenu(drinks.id, { visibility: 'PRIVATE' }, manager);
    await assert.rejects(h.menus.publicMenu('st-alma', drinks.slug), (error: unknown) => error instanceof h.HttpError && error.statusCode === 404);
    await h.menus.updateMenu(drinks.id, { visibility: 'PUBLIC' }, manager);
    await h.menus.archiveMenu(drinks.id, manager);
    assert.equal((await h.menus.publicMenus('st-alma')).menus.some((menu) => menu.slug === drinks.slug), false);
    await h.menus.unarchiveMenu(drinks.id, manager);
    assert.equal((await h.menus.publicMenus('st-alma')).menus.some((menu) => menu.slug === drinks.slug), true);

    // The per-page gate: forty cocktails on one A5 card overflow page 2 and block publishing.
    const current = await h.menus.getDraft(drinks.id);
    const stuffed = {
      ...current.document,
      sections: current.document.sections.map((section, index) => (index === 0 ? { ...section, items: Array.from({ length: 40 }, (_v, i) => cocktail(`Cocktail ${i + 1}`, 2300)) } : section))
    };
    await h.menus.saveDraft(drinks.id, stuffed, manager);
    const overflowing = await h.menus.publishPreview(drinks.id);
    const overflow = overflowing.validation.errors.find((issue) => issue.code === 'OVERFLOW');
    assert.ok(overflow, 'page 2 overflows');
    assert.equal(overflow!.page, 2);
    assert.match(overflow!.message, /Page 2 runs past the sheet/);
    await assert.rejects(h.menus.publish(drinks.id, { acknowledgeWarnings: true }, manager), (error: unknown) => error instanceof h.HttpError && error.statusCode === 422);
    // A section on a page the menu does not have is an error too.
    await h.menus.saveDraft(drinks.id, { ...current.document, sections: current.document.sections.map((section) => ({ ...section, page: 4 })) }, manager);
    const stray = await h.menus.publishPreview(drinks.id);
    assert.ok(stray.validation.errors.some((issue) => issue.code === 'PAGE_OUT_OF_RANGE'));
    // A single-sheet template refuses a second page.
    const tuesday = (await h.menus.list()).find((menu) => menu.name === 'ITESTV2 Taco Tuesday')!;
    const tuesdayDraft = await h.menus.getDraft(tuesday.id);
    await h.menus.saveDraft(tuesday.id, { ...tuesdayDraft.document, pageCount: 2, sections: [section({ title: 'Tacos', items: [cocktail('Barramundi', 900)] })] }, manager);
    assert.ok((await h.menus.publishPreview(tuesday.id)).validation.errors.some((issue) => issue.code === 'PAGE_OUT_OF_RANGE'));
  });

  it('reads a v1 snapshot as a v2 document and restores it into a valid draft', async () => {
    const menu = await h.prisma.menu.create({ data: { venueId, name: 'ITESTV2 Legacy', slug: 'itestv2-legacy', templateKey: 'freshwater_alacarte', versionCounter: 1 } });
    const legacy = await h.prisma.menuVersion.create({
      data: {
        menuId: menu.id,
        versionNumber: 1,
        state: 'PUBLISHED',
        publishedAt: new Date('2026-10-01T00:00:00Z'),
        snapshotJson: {
          schemaVersion: 1,
          menuId: menu.id,
          menuName: 'ITESTV2 Legacy',
          templateKey: 'freshwater_alacarte',
          venue: { id: venueId, name: 'St Alma', slug: 'st-alma' },
          versionNumber: 1,
          publishedAt: '2026-10-01T00:00:00.000Z',
          heading: '',
          dietaryNote: 'Dietaries.',
          surchargeLine: 'Surcharge.',
          sections: [{ title: 'To start', headerSuffix: null, subheading: null, sectionType: 'STANDARD', placement: 'LEFT', visible: true, items: [{ dishKey: 'legacy-guac', name: 'Guacamole', description: 'Tostadas', priceCents: 1700, priceUnit: null, tags: ['VG'], isSeafood: false, visible: true, recipeId: null }] }]
        }
      }
    });
    const read = await h.menus.getVersion(legacy.id);
    assert.equal(read.snapshot.schemaVersion, 1, 'the stored version is reported as it was written');
    assert.equal(read.snapshot.pageCount, 1);
    assert.equal(read.snapshot.showPrices, true);
    assert.equal(read.snapshot.sections[0]!.page, 1);
    assert.deepEqual(read.snapshot.sections[0]!.items[0]!.prices, []);
    const restored = await h.menus.restore(legacy.id, { replaceDraft: true }, manager);
    assert.equal(restored.version.versionNumber, 2);
    assert.equal(restored.document.sections[0]!.items[0]!.dishKey, 'legacy-guac');
    assert.deepEqual(restored.document.sections[0]!.priceColumns, []);
    assert.equal(restored.document.conditions, '');
    const diff = await h.menus.diffVersion(legacy.id, 'draft');
    assert.equal(diff.summary, 'No content changes');
    // The public summary of a legacy publish reads page count 1.
    const listed = (await h.menus.publicMenus('st-alma')).menus.find((item) => item.slug === 'itestv2-legacy')!;
    assert.equal(listed.pageCount, 1);
    assert.equal(listed.format, 'A4');
    assert.equal(listed.heading, 'À la carte');
  });
});
