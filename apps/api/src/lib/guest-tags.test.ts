import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GUEST_TAG_RULES,
  daysUntilBirthday,
  defaultRuleForSlug,
  guestMatchesRule,
  isMeaningfulRule
} from '@alma/shared';
import type { GuestFacts } from '@alma/shared';

const NOW = new Date('2026-08-03T00:00:00.000Z');
const guest = (over: Partial<GuestFacts> = {}): GuestFacts => ({
  totalVisits: 0,
  noShowCount: 0,
  totalSpendCents: 0,
  firstVisitAt: null,
  lastVisitAt: null,
  birthday: null,
  marketingOptIn: false,
  ...over
});
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

test('an empty rule matches nobody, not everybody', () => {
  // The tags shipped with this system all had an empty definition. Reading
  // that as "everyone" would have made all 2,370 guests VIPs on first run.
  assert.equal(guestMatchesRule(guest({ totalVisits: 50 }), {}), false);
  assert.equal(guestMatchesRule(guest({ totalVisits: 50 }), null), false);
  assert.equal(isMeaningfulRule({}), false);
  assert.equal(isMeaningfulRule({ minVisits: 1 }), true);
});

test('first timer is someone who came once, not someone who booked once', () => {
  const rule = DEFAULT_GUEST_TAG_RULES['first-timer']!;
  assert.equal(guestMatchesRule(guest({ totalVisits: 1 }), rule, NOW), true);
  assert.equal(guestMatchesRule(guest({ totalVisits: 2 }), rule, NOW), false);
  // Booked and never turned up: no visits, so not a first timer.
  assert.equal(guestMatchesRule(guest({ totalVisits: 0, noShowCount: 1 }), rule, NOW), false);
});

test('repeat and VIP stack by visit count', () => {
  assert.equal(guestMatchesRule(guest({ totalVisits: 3 }), DEFAULT_GUEST_TAG_RULES['repeat-visitor']!, NOW), true);
  assert.equal(guestMatchesRule(guest({ totalVisits: 2 }), DEFAULT_GUEST_TAG_RULES['repeat-visitor']!, NOW), false);
  assert.equal(guestMatchesRule(guest({ totalVisits: 8 }), DEFAULT_GUEST_TAG_RULES.vip!, NOW), true);
  assert.equal(guestMatchesRule(guest({ totalVisits: 7 }), DEFAULT_GUEST_TAG_RULES.vip!, NOW), false);
});

test('lapsed needs someone who actually came', () => {
  const rule = DEFAULT_GUEST_TAG_RULES['lapsed-guest']!;
  assert.equal(guestMatchesRule(guest({ totalVisits: 2, lastVisitAt: daysAgo(200) }), rule, NOW), true);
  assert.equal(guestMatchesRule(guest({ totalVisits: 2, lastVisitAt: daysAgo(100) }), rule, NOW), false);
  // Never visited is not lapsed — it is a different problem.
  assert.equal(guestMatchesRule(guest({ totalVisits: 0, lastVisitAt: null }), rule, NOW), false);
});

test('no-show risk needs a pattern, not one bad night', () => {
  const rule = DEFAULT_GUEST_TAG_RULES['no-show-risk']!;
  assert.equal(guestMatchesRule(guest({ noShowCount: 1 }), rule, NOW), false);
  assert.equal(guestMatchesRule(guest({ noShowCount: 2 }), rule, NOW), true);
});

test('birthday soon looks forward, and wraps the year end', () => {
  const rule = DEFAULT_GUEST_TAG_RULES['birthday-soon']!;
  assert.equal(guestMatchesRule(guest({ birthday: new Date('1990-08-10T00:00:00Z') }), rule, NOW), true);
  assert.equal(guestMatchesRule(guest({ birthday: new Date('1990-09-30T00:00:00Z') }), rule, NOW), false);
  // A birthday that has just passed is nearly a year away, not overdue.
  assert.equal(guestMatchesRule(guest({ birthday: new Date('1990-08-01T00:00:00Z') }), rule, NOW), false);
});

test('daysUntilBirthday wraps December to January', () => {
  const newYearsEve = new Date('2026-12-28T00:00:00.000Z');
  assert.equal(daysUntilBirthday(new Date('1988-01-03T00:00:00Z'), newYearsEve), 6);
  assert.equal(daysUntilBirthday(new Date('1988-12-28T00:00:00Z'), newYearsEve), 0);
});

test('every condition present must hold', () => {
  const rule = { minVisits: 3, marketingOptInOnly: true };
  assert.equal(guestMatchesRule(guest({ totalVisits: 5, marketingOptIn: true }), rule, NOW), true);
  assert.equal(guestMatchesRule(guest({ totalVisits: 5, marketingOptIn: false }), rule, NOW), false);
  assert.equal(guestMatchesRule(guest({ totalVisits: 1, marketingOptIn: true }), rule, NOW), false);
});

test('a spend rule cannot be earned while no spend reaches the database', () => {
  // Guards the decision not to ship a "big spender" default rule.
  assert.equal(guestMatchesRule(guest({ totalVisits: 20 }), { minSpendCents: 50_000 }, NOW), false);
  assert.equal(DEFAULT_GUEST_TAG_RULES['big-spender'], undefined);
});

test('the segment-shaped rule these tags actually shipped with constrains nothing', () => {
  // This exact object is what was in the database. Reading it as a real rule
  // applied all seven tags to all 2,370 guests — 16,588 assignments.
  const shipped = {
    tagIds: [],
    guestIds: [],
    emailOnly: false,
    excludedTagIds: [],
    marketingOptInOnly: false,
    includeUnsubscribed: false
  } as never;
  assert.equal(isMeaningfulRule(shipped), false);
  assert.equal(guestMatchesRule(guest({ totalVisits: 1 }), shipped, NOW), false);
});

test('a lone true flag is a real constraint', () => {
  assert.equal(isMeaningfulRule({ requiresVisit: true }), true);
  assert.equal(isMeaningfulRule({ marketingOptInOnly: true }), true);
  assert.equal(isMeaningfulRule({ requiresVisit: false }), false);
});

test('defaultRuleForSlug copes with venue-prefixed, underscored slugs', () => {
  // Real slugs here look like "alma-avalon-big_spender".
  assert.deepEqual(defaultRuleForSlug('alma-avalon-first_timer'), DEFAULT_GUEST_TAG_RULES['first-timer']);
  assert.deepEqual(defaultRuleForSlug('alma-avalon-no_show_risk'), DEFAULT_GUEST_TAG_RULES['no-show-risk']);
  assert.deepEqual(defaultRuleForSlug('vip'), DEFAULT_GUEST_TAG_RULES.vip);
  // No default for spend while no spend reaches the database.
  assert.equal(defaultRuleForSlug('alma-avalon-big_spender'), undefined);
  assert.equal(defaultRuleForSlug('something-else'), undefined);
});
