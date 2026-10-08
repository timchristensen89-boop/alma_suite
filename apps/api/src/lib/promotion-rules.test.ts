import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPublicPromotion,
  diffPublicPromotions,
  MENU_DOCUMENT_DEFAULTS,
  PROMOTION_FIELD_DEFAULTS,
  promotionCardOverlay,
  promotionCreateInputSchema,
  promotionFieldsSchema,
  promotionImageInputSchema,
  promotionPriceLabel,
  promotionRunsOn,
  promotionUpdateInputSchema,
  validatePromotionFields,
  venueToday,
  type PromotionFields,
  type PublicPromotion
} from '@alma/shared';
import { imageDimensions } from './image-dimensions.js';

/**
 * Promotions: the listing rules, the public item and the card overlay,
 * exercised without a database. The service's publish-together behaviour is
 * covered by promotion.integration.test.ts against Postgres.
 */

function fields(over: Partial<PromotionFields> = {}): PromotionFields {
  return promotionFieldsSchema.parse({ name: 'Happy hour', ...over });
}

const venue = { name: 'Alma Avalon', slug: 'alma-avalon' };

function listing(over: Partial<PromotionFields> = {}, extra: Partial<Parameters<typeof buildPublicPromotion>[0]> = {}): PublicPromotion {
  return buildPublicPromotion({ slug: 'happy-hour', venue, fields: fields(over), image: null, card: null, publishedAt: '2026-10-08T00:00:00.000Z', publicationId: 'pub-1', ...extra });
}

describe('promotion fields', () => {
  it('fills every default, trims, de-duplicates weekdays and empties a blank unit', () => {
    const f = fields({ validDays: [5, 6, 5, 0], heroPriceUnit: '  ', summary: '  Early drinks.  ' });
    assert.deepEqual(f.validDays, [0, 5, 6]);
    assert.equal(f.heroPriceUnit, null);
    assert.equal(f.summary, 'Early drinks.');
    assert.equal(f.bookDestination, 'OPENTABLE');
    assert.equal(f.sortOrder, 0);
    assert.equal(PROMOTION_FIELD_DEFAULTS.name, 'Promotion');
  });

  it('refuses malformed dates, times, links and prices', () => {
    assert.throws(() => fields({ startsOn: '14/11/2026' }));
    assert.throws(() => fields({ startTime: '5pm' }));
    assert.throws(() => fields({ bookUrl: 'opentable' }));
    assert.throws(() => fields({ heroPriceCents: -1 }));
    assert.throws(() => fields({ heroPriceCents: 12.5 }));
    assert.throws(() => fields({ name: '' }));
  });

  it('create and update inputs carry the link and the lock, and refuse an empty update', () => {
    const create = promotionCreateInputSchema.parse({ venueId: 'v1', name: 'Bottomless', createCard: true, heroPriceCents: 9900, heroPriceUnit: 'pp' });
    assert.equal(create.createCard, true);
    assert.equal(create.heroPriceCents, 9900);
    assert.throws(() => promotionCreateInputSchema.parse({ venueId: 'v1', name: 'X', createCard: true, menuId: 'm1' }), /not both/);
    const update = promotionUpdateInputSchema.parse({ timeLabel: 'Fri–Sun · 12–4pm', expectedUpdatedAt: '2026-10-08T00:00:00.000Z' });
    assert.equal(update.timeLabel, 'Fri–Sun · 12–4pm');
    assert.throws(() => promotionUpdateInputSchema.parse({ expectedUpdatedAt: 'x' }), /Nothing to change/);
    assert.throws(() => promotionImageInputSchema.parse({ dataUrl: 'data:image/gif;base64,AAAA' }));
    assert.equal(promotionImageInputSchema.parse({ dataUrl: 'data:image/png;base64,AAAA' }).fileName, 'photo');
  });
});

describe('promotion validation and labels', () => {
  it('blocks a window that ends before it starts and a URL button without a link; warns on missing copy', () => {
    const bad = validatePromotionFields(fields({ startsOn: '2026-12-01', endsOn: '2026-11-01', bookDestination: 'URL', bookUrl: null, summary: '', timeLabel: '' }));
    assert.deepEqual(
      bad.errors.map((issue) => issue.code),
      ['WINDOW', 'BOOK_URL']
    );
    assert.deepEqual(
      bad.warnings.map((issue) => issue.code),
      ['NO_SUMMARY', 'NO_TIME']
    );
    const fine = validatePromotionFields(fields({ summary: 'Drinks.', timeLabel: 'Wed–Sun', validDays: [3] }));
    assert.deepEqual(fine.errors, []);
    assert.deepEqual(fine.warnings, []);
    // An OpenTable button with no weekdays cannot pick the next date.
    assert.deepEqual(validatePromotionFields(fields({ summary: 'x', timeLabel: 'x' })).warnings.map((issue) => issue.code), ['NO_DAYS']);
  });

  it('derives the price label from the hero price, honours the override, and says Walk-in without a price', () => {
    assert.equal(promotionPriceLabel(fields({ heroPriceCents: 9900, heroPriceUnit: 'pp' })), '$99 pp');
    assert.equal(promotionPriceLabel(fields({ heroPriceCents: 1250 })), '$12.50');
    assert.equal(promotionPriceLabel(fields({ heroPriceCents: 500, priceLabel: '$5 tacos' })), '$5 tacos');
    assert.equal(promotionPriceLabel(fields()), 'Walk-in');
  });

  it('runs between its dates, inclusive, and always when it has none', () => {
    assert.equal(promotionRunsOn({ startsOn: null, endsOn: null }, '2026-10-08'), true);
    assert.equal(promotionRunsOn({ startsOn: '2026-10-08', endsOn: '2026-10-08' }, '2026-10-08'), true);
    assert.equal(promotionRunsOn({ startsOn: '2026-10-09', endsOn: null }, '2026-10-08'), false);
    assert.equal(promotionRunsOn({ startsOn: null, endsOn: '2026-10-07' }, '2026-10-08'), false);
    assert.match(venueToday(new Date('2026-10-08T15:30:00.000Z')), /^2026-10-09$/, 'Sydney is ahead of UTC');
  });
});

describe('the public listing item', () => {
  it('is built from the working copy: title falls back to the name, booking and price resolve', () => {
    const item = listing({ publicTitle: '', summary: 'Early drinks.', heroPriceCents: 9900, heroPriceUnit: 'pp', bookDestination: 'URL', bookUrl: 'https://example.com/book', bookLabel: '' });
    assert.equal(item.title, 'Happy hour');
    assert.equal(item.priceLabel, '$99 pp');
    assert.deepEqual(item.price, { cents: 9900, unit: 'pp' });
    assert.deepEqual(item.booking, { destination: 'URL', label: 'Reserve', url: 'https://example.com/book' });
    assert.equal(listing({ bookDestination: 'NONE' }).booking.label, '');
    assert.equal(listing({ bookDestination: 'OPENTABLE', bookUrl: 'https://x.y' }).booking.url, null, 'a URL is only carried for a URL button');
  });

  it('diffs field by field in plain words and ignores the publication identity', () => {
    const before = listing({ heroPriceCents: 8900, heroPriceUnit: 'pp', summary: 'A', validDays: [6, 0] });
    const same = { ...before, publishedAt: '2026-10-09T00:00:00.000Z', publicationId: 'pub-2' };
    assert.deepEqual(diffPublicPromotions(before, same), []);
    const after = listing(
      { heroPriceCents: 9900, heroPriceUnit: 'pp', summary: 'B', validDays: [5, 6, 0], publicTitle: 'Bottomless lunch' },
      { image: { url: 'https://api/x.jpg', width: 1, height: 1, alt: '' }, card: { slug: 'c', name: 'Card', heading: 'Card', versionId: 'v2', pdfUrl: '', livePdfUrl: '', jsonUrl: '' } }
    );
    assert.deepEqual(diffPublicPromotions(before, after), [
      'title “Happy hour” → “Bottomless lunch”',
      'description changed',
      'weekdays Sat Sun → Fri Sat Sun',
      'price “$89 pp” → “$99 pp”',
      'photo added',
      'menu PDF added'
    ]);
    assert.deepEqual(diffPublicPromotions(null, after), ['first publish']);
    assert.deepEqual(diffPublicPromotions(after, { ...after, card: { ...after.card!, versionId: 'v3' } }), ['menu PDF updated']);
  });

  it('the card overlay carries exactly the promotion-owned fields onto a document', () => {
    const overlay = promotionCardOverlay(fields({ timeLabel: 'Fri–Sun · 12–4pm', heroPriceCents: 9900, heroPriceUnit: 'pp', conditions: 'Two hours.' }));
    const typed = { ...MENU_DOCUMENT_DEFAULTS, heading: 'Bottomless', whenLine: 'typed on the card', heroPriceCents: 1 };
    const doc = { ...typed, ...overlay };
    assert.equal(doc.whenLine, 'Fri–Sun · 12–4pm');
    assert.equal(doc.heroPriceCents, 9900);
    assert.equal(doc.heroPriceUnit, 'pp');
    assert.equal(doc.conditions, 'Two hours.');
    assert.equal(doc.heading, 'Bottomless', 'the heading stays the card’s');
    assert.deepEqual(Object.keys(overlay).sort(), ['conditions', 'heroPriceCents', 'heroPriceUnit', 'whenLine']);
  });
});

describe('image dimensions from headers', () => {
  it('reads PNG, JPEG and WebP sizes and answers null for anything else', () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    assert.deepEqual(imageDimensions(png, 'image/png'), { width: 1, height: 1 });
    // SOI, an APP0 segment, then SOF0 with height 240 and width 320.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xf0, 0x01, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(imageDimensions(jpeg, 'image/jpeg'), { width: 320, height: 240 });
    // RIFF....WEBPVP8X + 10-byte chunk payload: flags(4), width-1 (3 bytes LE), height-1 (3 bytes LE).
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBPVP8X'),
      Buffer.from([10, 0, 0, 0]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([0x3f, 0x01, 0x00]), // 320 - 1
      Buffer.from([0xef, 0x00, 0x00]), // 240 - 1
      Buffer.alloc(8)
    ]);
    assert.deepEqual(imageDimensions(webp, 'image/webp'), { width: 320, height: 240 });
    assert.equal(imageDimensions(Buffer.from('not an image'), 'image/png'), null);
    assert.equal(imageDimensions(png, 'image/gif'), null);
  });
});
