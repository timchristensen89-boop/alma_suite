/**
 * Promotions — real-database integration tests for the one-record rule and
 * publish-together: a promotion's card prints the promotion's price, times
 * and conditions; publishing lands the listing and the card's PDF together
 * or not at all; the public What's On serves publications only; photos are
 * immutable; hide/show/end and the date window decide what the website sees.
 *
 * Opt-in like menu-v2.integration.test.ts: runs only with
 * ALMA_TEST_DATABASE_URL. Publishing a card needs headless Chrome;
 * ALMA_TEST_REQUIRE_CHROME=1 turns a missing Chrome into a failure.
 *
 * Uses (or creates) the venue with slug "st-alma" and names everything it
 * makes "ITESTV2P …"; setup and teardown delete exactly those rows.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AuthUser } from '@alma/shared';

const TEST_DB = process.env.ALMA_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
const REQUIRE_CHROME = process.env.ALMA_TEST_REQUIRE_CHROME === '1';

type Harness = {
  prisma: typeof import('@alma/db').prisma;
  menus: typeof import('./menu.service.js').menuService;
  promotions: typeof import('./promotion.service.js').promotionService;
  chromeOk: boolean;
  closeBrowser: () => Promise<void>;
  HttpError: typeof import('../lib/http.js').HttpError;
};

let h: Harness;
let venueId = '';
let createdVenue = false;

const manager = { id: 'itestv2p-manager', firstName: 'Itest', lastName: 'Manager', email: 'itestv2p-manager@almagroup.com.au', roleTitle: 'Venue Manager', venue: 'St Alma', accountType: 'HUMAN', isAdmin: false, trainingOnly: false, role: 'MANAGER', appAccess: [] } as unknown as AuthUser;

const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function httpError(status: number, code?: string) {
  return (error: unknown) => {
    if (!(error instanceof h.HttpError)) throw error;
    assert.equal(error.statusCode, status, `expected ${status}, got ${error.statusCode}: ${error.message}`);
    if (code) assert.equal((error.details as { code?: string } | undefined)?.code, code);
    return true;
  };
}

async function wipe() {
  const promotions = await h.prisma.promotion.findMany({ where: { name: { startsWith: 'ITESTV2P ' } }, select: { id: true } });
  const menus = await h.prisma.menu.findMany({ where: { name: { startsWith: 'ITESTV2P ' } }, select: { id: true } });
  await h.prisma.menuAuditEvent.deleteMany({ where: { OR: [{ promotionId: { in: promotions.map((p) => p.id) } }, { menuId: { in: menus.map((m) => m.id) } }] } });
  await h.prisma.promotion.deleteMany({ where: { id: { in: promotions.map((p) => p.id) } } });
  await h.prisma.menu.deleteMany({ where: { id: { in: menus.map((m) => m.id) } } });
}

describe('promotions (Postgres)', { skip: TEST_DB ? false : 'skipped: set ALMA_TEST_DATABASE_URL to run' }, () => {
  before(async () => {
    const [{ prisma }, { menuService }, { promotionService }, pdf, http] = await Promise.all([
      import('@alma/db'),
      import('./menu.service.js'),
      import('./promotion.service.js'),
      import('../lib/menu-pdf.js'),
      import('../lib/http.js')
    ]);
    h = { prisma, menus: menuService, promotions: promotionService, chromeOk: pdf.chromeStatus().ok, closeBrowser: pdf.closeMenuBrowser, HttpError: http.HttpError };
    if (REQUIRE_CHROME && !h.chromeOk) throw new Error(`ALMA_TEST_REQUIRE_CHROME=1 but Chrome is not available: ${pdf.chromeStatus().message}`);
    await wipe();
    const existing = await h.prisma.venue.findUnique({ where: { slug: 'st-alma' }, select: { id: true, name: true } });
    if (existing && existing.name !== 'ITESTV2P St Alma') {
      venueId = existing.id;
    } else {
      if (existing) await h.prisma.venue.delete({ where: { id: existing.id } });
      venueId = (await h.prisma.venue.create({ data: { name: 'ITESTV2P St Alma', slug: 'st-alma' } })).id;
      createdVenue = true;
    }
  });

  after(async () => {
    await wipe();
    if (createdVenue) await h.prisma.venue.deleteMany({ where: { slug: 'st-alma', name: 'ITESTV2P St Alma' } });
    await h.closeBrowser();
    await h.prisma.$disconnect();
  });

  it('creates a promotion with its card; the card prints the promotion’s price, times and conditions, typed once', async () => {
    const created = await h.promotions.create(
      { venueId, name: 'ITESTV2P Bottomless', publicTitle: 'Bottomless lunch', summary: 'Lunch that runs long.', timeLabel: 'Fri–Sun · 12–4pm', validDays: [5, 6, 0], startTime: '12:00', heroPriceCents: 9900, heroPriceUnit: 'pp', conditions: 'Two hours from your sitting time.', createCard: true },
      manager
    );
    assert.equal(created.slug, 'itestv2p-bottomless');
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.priceLabel, '$99 pp');
    assert.equal(created.unpublishedChanges, true);
    assert.equal(created.publication, null);
    assert.ok(created.card, 'a card was made');
    assert.equal(created.card.kind, 'PROMOTION');
    assert.equal(created.card.templateKey, 'freshwater_card_a5');
    assert.equal(created.card.name, 'ITESTV2P Bottomless');
    assert.deepEqual(created.card.promotion, { id: created.id, name: 'ITESTV2P Bottomless', status: 'DRAFT' });
    assert.equal(created.listing.title, 'Bottomless lunch');
    assert.equal(created.listing.card, null, 'nothing is published yet');

    // The card's draft reads the promotion's fields, not its own.
    const draft = await h.menus.getDraft(created.card.id);
    assert.equal(draft.menu.promotion?.id, created.id);
    assert.equal(draft.document.heading, 'Bottomless lunch');
    assert.equal(draft.document.whenLine, 'Fri–Sun · 12–4pm');
    assert.equal(draft.document.heroPriceCents, 9900);
    assert.equal(draft.document.heroPriceUnit, 'pp');
    assert.equal(draft.document.conditions, 'Two hours from your sitting time.');

    // Typing other values on the card does not stick: the promotion owns them.
    const saved = await h.menus.saveDraft(
      created.card.id,
      {
        ...draft.document,
        whenLine: 'typed on the card',
        heroPriceCents: 100,
        sections: [{ title: 'To start', headerSuffix: null, subheading: null, sectionType: 'LIST', placement: 'LEFT', page: 1, lead: null, body: null, priceColumns: [], visible: true, items: [{ name: 'Guacamole, tostadas', description: null, priceCents: null, priceUnit: null, prices: [], meta: null, note: null, flags: [], tags: ['VG'], isSeafood: false, visible: true, recipeId: null }] }]
      },
      manager
    );
    assert.equal(saved.document.whenLine, 'Fri–Sun · 12–4pm');
    assert.equal(saved.document.heroPriceCents, 9900);
    assert.equal(saved.document.sections[0]?.items[0]?.name, 'Guacamole, tostadas');

    // Editing the promotion moves the card's draft with it.
    const updated = await h.promotions.update(created.id, { heroPriceCents: 10900, expectedUpdatedAt: created.updatedAt }, manager);
    assert.equal(updated.priceLabel, '$109 pp');
    assert.equal((await h.menus.getDraft(created.card.id)).document.heroPriceCents, 10900);
    await assert.rejects(h.promotions.update(created.id, { summary: 'x', expectedUpdatedAt: created.updatedAt }, manager), httpError(409, 'STALE_PROMOTION'));
    await assert.rejects(h.promotions.create({ venueId, name: 'itestv2p bottomless' }, manager), httpError(409, 'NAME_TAKEN'));
  });

  it('links only this venue’s unlinked promotion cards', async () => {
    const promo = await h.promotions.create({ venueId, name: 'ITESTV2P Taco Tuesday', timeLabel: 'Every Tuesday · from 5pm' }, manager);
    assert.equal(promo.card, null);
    const food = await h.menus.createMenu({ venueId, name: 'ITESTV2P Food', kind: 'FOOD' }, manager);
    await assert.rejects(h.promotions.update(promo.id, { menuId: food.id }, manager), httpError(400));
    const bottomless = (await h.promotions.list()).promotions.find((p) => p.name === 'ITESTV2P Bottomless')!;
    await assert.rejects(h.promotions.update(promo.id, { menuId: bottomless.card!.id }, manager), httpError(409, 'CARD_TAKEN'));
    const card = await h.menus.createMenu({ venueId, name: 'ITESTV2P Taco card', kind: 'PROMOTION' }, manager);
    assert.ok((await h.promotions.list()).unlinkedCards.some((menu) => menu.id === card.id));
    const linked = await h.promotions.update(promo.id, { menuId: card.id }, manager);
    assert.equal(linked.card?.id, card.id);
    assert.equal((await h.menus.get(card.id)).promotion?.name, 'ITESTV2P Taco Tuesday');
    assert.ok(!(await h.promotions.list()).unlinkedCards.some((menu) => menu.id === card.id));
    const unlinked = await h.promotions.update(promo.id, { menuId: null }, manager);
    assert.equal(unlinked.card, null);
    assert.equal((await h.menus.get(card.id)).promotion, null);
  });

  it('stores a listing photo once by content, serves it by fingerprint, and keeps old rows when replaced', async () => {
    const promo = (await h.promotions.list()).promotions.find((p) => p.name === 'ITESTV2P Bottomless')!;
    const withImage = await h.promotions.setImage(promo.id, { dataUrl: PNG_1X1, fileName: 'table.png', alt: 'A long table' }, manager);
    assert.ok(withImage.image);
    assert.match(withImage.image.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(withImage.image.width, 1);
    assert.equal(withImage.image.height, 1);
    assert.equal(withImage.image.alt, 'A long table');
    assert.ok(withImage.image.url.endsWith(`/api/public/promotion-images/${withImage.image.fingerprint}.png`));
    const served = await h.promotions.publicImage(withImage.image.fingerprint);
    assert.equal(served.mimeType, 'image/png');
    assert.equal(served.bytes.length, withImage.image.sizeBytes);
    await assert.rejects(h.promotions.publicImage('0'.repeat(64)), httpError(404));
    await assert.rejects(h.promotions.publicImage('../etc/passwd'), httpError(404));

    // The same bytes again: no second row, same URL.
    const again = await h.promotions.setImage(promo.id, { dataUrl: PNG_1X1, fileName: 'again.png', alt: 'Same photo' }, manager);
    assert.equal(again.image?.id, withImage.image.id);
    assert.equal(await h.prisma.promotionImage.count({ where: { promotionId: promo.id } }), 1);
    const removed = await h.promotions.removeImage(promo.id, manager);
    assert.equal(removed.image, null);
    assert.equal(await h.prisma.promotionImage.count({ where: { promotionId: promo.id } }), 1, 'the row stays for earlier publications');
    await h.promotions.setImage(promo.id, { dataUrl: PNG_1X1, fileName: 'table.png', alt: 'A long table' }, manager);
  });

  it('refuses to publish while the card cannot be, leaving the listing and the card exactly as they were', async () => {
    const promo = (await h.promotions.list()).promotions.find((p) => p.name === 'ITESTV2P Bottomless')!;
    // Make the card unpublishable: GF and GFA on the same dish is an error in every kind.
    const draft = await h.menus.getDraft(promo.card!.id);
    const broken = await h.menus.saveDraft(
      promo.card!.id,
      { ...draft.document, sections: draft.document.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, tags: ['GF', 'GFA'] })) })) },
      manager
    );
    const preview = await h.promotions.publishPreview(promo.id);
    assert.equal(preview.card?.action, 'PUBLISH_DRAFT');
    assert.equal(preview.card?.preview?.canPublish, false);
    assert.equal(preview.canPublish, false);
    assert.deepEqual(preview.listingChanges, ['first publish']);
    await assert.rejects(h.promotions.publish(promo.id, { acknowledgeWarnings: true }, manager), httpError(422, 'VALIDATION'));
    const after = await h.promotions.get(promo.id);
    assert.equal(after.status, 'DRAFT');
    assert.equal(after.publications.length, 0);
    assert.equal(after.card?.draft?.id, broken.version.id, 'the card draft is untouched');
    assert.equal(after.card?.published, null);
    // Put the card right again for the next test.
    await h.menus.saveDraft(promo.card!.id, { ...broken.document, sections: broken.document.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, tags: ['VG'] })) })) }, manager);
  });

  it('publishes the listing and the card together, then reprints the card when the promotion’s price moves', { skip: !h?.chromeOk && !REQUIRE_CHROME ? 'skipped: headless Chrome not available' : false }, async () => {
    const promo = (await h.promotions.list()).promotions.find((p) => p.name === 'ITESTV2P Bottomless')!;
    const published = await h.promotions.publish(promo.id, { acknowledgeWarnings: true }, manager);
    assert.equal(published.status, 'PUBLISHED');
    assert.equal(published.unpublishedChanges, false);
    assert.equal(published.publications.length, 1);
    assert.equal(published.publication?.number, 1);
    assert.equal(published.publication?.cardVersion?.versionNumber, 1);
    assert.equal(published.card?.draft, null, 'the card draft was published');
    assert.equal(published.card?.published?.versionNumber, 1);
    const listing = published.publishedListing!;
    assert.equal(listing.priceLabel, '$109 pp');
    assert.equal(listing.timeLabel, 'Fri–Sun · 12–4pm');
    assert.equal(listing.image?.alt, 'A long table');
    assert.ok(listing.card);
    assert.equal(listing.card.slug, 'itestv2p-bottomless');
    assert.equal(listing.card.heading, 'Bottomless lunch');
    const v1 = listing.card.versionId;
    assert.ok(listing.card.pdfUrl.endsWith(`/api/public/menus/version/${v1}.pdf`));
    // The card's PDF is the one the listing names, and it prints the promotion's figures (the snapshot says so).
    const snapshot = await h.menus.getVersion(v1);
    assert.equal(snapshot.snapshot.heroPriceCents, 10900);
    assert.equal(snapshot.snapshot.whenLine, 'Fri–Sun · 12–4pm');
    const pdf = await h.menus.publicMenuVersionPdf(v1);
    assert.ok(pdf.bytes.length > 1000);

    // The website sees it, by venue and overall.
    const whatsOn = await h.promotions.whatsOn('st-alma');
    const mine = whatsOn.promotions.find((item) => item.slug === 'itestv2p-bottomless');
    assert.ok(mine);
    assert.equal(mine.publicationId, published.publication?.id);
    assert.ok((await h.promotions.whatsOn(null)).promotions.some((item) => item.slug === 'itestv2p-bottomless'));
    await assert.rejects(h.promotions.whatsOn('nowhere'), httpError(404));
    const audit = await h.promotions.listAudit(promo.id);
    assert.equal(audit[0]?.action, 'promotion.published');
    assert.match(audit[0]!.summary, /first publish/);
    assert.match(audit[0]!.summary, /Card "ITESTV2P Bottomless" v1 published/);

    // Price moves on the promotion: the live card is behind, so publishing reprints it as v2 and the listing points at v2.
    const repriced = await h.promotions.update(promo.id, { heroPriceCents: 9900 }, manager);
    assert.equal(repriced.unpublishedChanges, true);
    const preview = await h.promotions.publishPreview(promo.id);
    assert.equal(preview.card?.action, 'REPUBLISH');
    assert.equal(preview.card?.preview?.canPublish, true);
    assert.deepEqual(preview.listingChanges, ['price “$109 pp” → “$99 pp”']);
    const republished = await h.promotions.publish(promo.id, { acknowledgeWarnings: true }, manager);
    assert.equal(republished.publication?.number, 2);
    assert.equal(republished.publication?.cardVersion?.versionNumber, 2);
    assert.equal(republished.card?.published?.versionNumber, 2);
    assert.equal(republished.card?.draft, null);
    const v2 = republished.publishedListing!.card!.versionId;
    assert.notEqual(v2, v1);
    assert.equal((await h.menus.getVersion(v2)).snapshot.heroPriceCents, 9900);
    // The earlier publication's PDF link still resolves (the version is archived, not gone).
    assert.ok((await h.menus.publicMenuVersionPdf(v1)).bytes.length > 1000);
    assert.equal((await h.promotions.whatsOn('st-alma')).promotions.find((item) => item.slug === 'itestv2p-bottomless')?.priceLabel, '$99 pp');
    // Nothing changed: publishing again is a no-op listing diff but still a publication, and the card is current.
    assert.equal((await h.promotions.publishPreview(promo.id)).card?.action, 'CURRENT');
    assert.equal((await h.promotions.get(promo.id)).unpublishedChanges, false);

    // A stale publish is refused and writes nothing.
    await assert.rejects(h.promotions.publish(promo.id, { acknowledgeWarnings: true, expectedUpdatedAt: published.updatedAt }, manager), httpError(409, 'STALE_PROMOTION'));
    assert.equal((await h.promotions.get(promo.id)).publications.length, 2);
  });

  it('hide, show, end and the date window decide what the website sees; a promotion without a card publishes on its own', async () => {
    const taco = (await h.promotions.list()).promotions.find((p) => p.name === 'ITESTV2P Taco Tuesday')!;
    await assert.rejects(h.promotions.setStatus(taco.id, 'show', manager), httpError(409, 'NOT_PUBLISHED'));
    await assert.rejects(h.promotions.setStatus(taco.id, 'hide', manager), httpError(409));
    const published = await h.promotions.publish(taco.id, { acknowledgeWarnings: true }, manager);
    assert.equal(published.status, 'PUBLISHED');
    assert.equal(published.publishedListing?.card, null);
    assert.equal(published.publishedListing?.priceLabel, 'Walk-in');
    const onSite = async () => (await h.promotions.whatsOn('st-alma')).promotions.some((item) => item.slug === 'itestv2p-taco-tuesday');
    assert.equal(await onSite(), true);

    assert.equal((await h.promotions.setStatus(taco.id, 'hide', manager)).status, 'HIDDEN');
    assert.equal(await onSite(), false);
    assert.equal((await h.promotions.setStatus(taco.id, 'show', manager)).status, 'PUBLISHED');
    assert.equal(await onSite(), true);

    // An edit after publishing is not on the website until published again.
    const edited = await h.promotions.update(taco.id, { summary: 'New words' }, manager);
    assert.equal(edited.unpublishedChanges, true);
    assert.equal((await h.promotions.whatsOn('st-alma')).promotions.find((item) => item.slug === 'itestv2p-taco-tuesday')?.summary, '');

    // Ended by date: still PUBLISHED, but not served.
    await h.promotions.update(taco.id, { endsOn: '2020-01-01' }, manager);
    await h.promotions.publish(taco.id, { acknowledgeWarnings: true }, manager);
    assert.equal(await onSite(), false);
    await h.promotions.update(taco.id, { endsOn: null }, manager);
    await h.promotions.publish(taco.id, { acknowledgeWarnings: true }, manager);
    assert.equal(await onSite(), true);

    const ended = await h.promotions.setStatus(taco.id, 'end', manager);
    assert.equal(ended.status, 'ENDED');
    assert.equal(await onSite(), false);
    const list = await h.promotions.list();
    assert.ok(list.ended.some((p) => p.id === taco.id));
    assert.ok(!list.promotions.some((p) => p.id === taco.id));
    // Back from ended: the last publication is what goes live.
    assert.equal((await h.promotions.setStatus(taco.id, 'show', manager)).status, 'PUBLISHED');
    assert.equal(await onSite(), true);
  });
});
