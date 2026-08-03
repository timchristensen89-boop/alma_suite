import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dedupeGuests,
  guestIdentityKey,
  hasAnyConsent,
  mayEmailForVenue,
  mergeGuests,
  normaliseEmail,
  normalisePhone,
  parseConsent,
  parseCount,
  parseExportDate,
  parseMoneyCents,
  parseTags
} from '@alma/shared';
import type { ImportedGuest } from '@alma/shared';

const g = (over: Partial<ImportedGuest> = {}): ImportedGuest => ({
  firstName: 'Sofi',
  lastName: 'Nipper',
  email: 'sofinipper@hotmail.com',
  phone: null,
  visits: 0,
  noShows: 0,
  cancels: 0,
  spendCents: 0,
  lastVisitAt: null,
  birthday: null,
  tags: [],
  consent: {},
  venue: null,
  ...over
});

test('phone formats of one person reduce to one key', () => {
  const forms = ['+61412345678', '0412 345 678', '(04) 1234 5678', '412345678'];
  const keys = new Set(forms.map(normalisePhone));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(', ')}`);
});

test('a phone too short to identify anyone is null', () => {
  assert.equal(normalisePhone('1234'), null);
  assert.equal(normalisePhone(''), null);
  assert.equal(normalisePhone(null), null);
});

test('email is a dedupe key, not a validity check', () => {
  assert.equal(normaliseEmail('  Gaby.Scott@Live.CO.UK '), 'gaby.scott@live.co.uk');
  // Odd but real addresses must not be dropped.
  assert.equal(normaliseEmail("o'brien+bookings@sub.domain.io"), "o'brien+bookings@sub.domain.io");
  assert.equal(normaliseEmail('not-an-email'), null);
  assert.equal(normaliseEmail(''), null);
});

test('counts and money survive the shapes an export uses', () => {
  assert.equal(parseCount('104'), 104);
  assert.equal(parseCount('1,204'), 1204);
  assert.equal(parseCount(''), 0);
  assert.equal(parseCount('-3'), 0);
  assert.equal(parseMoneyCents('$1,234.50'), 123450);
  assert.equal(parseMoneyCents('358'), 35800);
  assert.equal(parseMoneyCents(''), 0);
});

test('dates parse both shapes in this export, or return null', () => {
  assert.equal(parseExportDate('2026-03-28')?.toISOString(), '2026-03-28T00:00:00.000Z');
  assert.equal(parseExportDate('2023-09-13 06:18:32.728474')?.getUTCFullYear(), 2023);
  assert.equal(parseExportDate(''), null);
  assert.equal(parseExportDate('not a date'), null);
});

test('tags dedupe but keep their category', () => {
  const tags = parseTags(
    'Diner Type:Dine-In Only Guest, All Guests:All Guests, All Guests:All Guests, all guests:ALL GUESTS'
  );
  assert.deepEqual(tags, ['Diner Type:Dine-In Only Guest', 'All Guests:All Guests']);
});

test('only "Yes" is consent', () => {
  assert.equal(parseConsent('Yes'), true);
  assert.equal(parseConsent('yes'), true);
  assert.equal(parseConsent('No'), false);
  assert.equal(parseConsent(''), false);
  assert.equal(parseConsent(undefined), false);
});

test('a name alone is never an identity', () => {
  // Hundreds of guests here are a first name and nothing else. Merging those
  // would fuse strangers and pool their consent.
  assert.equal(guestIdentityKey(g({ email: null, phone: null })), null);
  assert.equal(guestIdentityKey(g({ email: null, phone: '412345678' })), 'phone:412345678');
  assert.equal(guestIdentityKey(g()), 'email:sofinipper@hotmail.com');
});

test('one person split across two venues adds up', () => {
  // The real row pair: 25 visits at St Alma, 4 at Alma Avalon.
  const merged = mergeGuests([
    g({ visits: 25, noShows: 1, lastVisitAt: new Date('2025-06-08'), venue: 'St Alma' }),
    g({ visits: 4, noShows: 0, lastVisitAt: new Date('2022-11-23'), venue: 'Alma Avalon' })
  ]);
  assert.equal(merged.visits, 29);
  assert.equal(merged.noShows, 1);
  assert.equal(merged.lastVisitAt?.toISOString(), new Date('2025-06-08').toISOString());
  assert.equal(merged.venue, 'St Alma');
});

test('merging prefers the fullest name over a stub row', () => {
  const merged = mergeGuests([
    g({ firstName: 'Gaby', lastName: '', visits: 0 }),
    g({ firstName: 'Gaby', lastName: 'Scott', visits: 42 })
  ]);
  assert.equal(merged.lastName, 'Scott');
  assert.equal(merged.visits, 42);
});

test('consent is true if they agreed at any venue, per venue', () => {
  const merged = mergeGuests([
    g({ consent: { 'St Alma': true, 'Alma Avalon': false } }),
    g({ consent: { 'St Alma': false, 'Alma Avalon': false } })
  ]);
  assert.equal(merged.consent['St Alma'], true);
  assert.equal(merged.consent['Alma Avalon'], false);
  assert.equal(hasAnyConsent(merged), true);
  assert.equal(mayEmailForVenue(merged, 'St Alma'), true);
  // Agreeing to one venue is not agreeing to the other.
  assert.equal(mayEmailForVenue(merged, 'Alma Avalon'), false);
});

test('no email means no marketing, whatever the flag says', () => {
  assert.equal(mayEmailForVenue(g({ email: null, consent: { 'St Alma': true } }), 'St Alma'), false);
});

test('dedupe separates the unmatchable rather than dropping them', () => {
  const { guests, unidentifiable } = dedupeGuests([
    g({ email: 'a@b.com', visits: 3 }),
    g({ email: 'a@b.com', visits: 2 }),
    g({ email: null, phone: null, firstName: 'Sarah', lastName: '' })
  ]);
  assert.equal(guests.length, 1);
  assert.equal(guests[0]!.visits, 5);
  assert.equal(unidentifiable.length, 1);
});
