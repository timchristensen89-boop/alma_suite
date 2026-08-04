/**
 * Automatic guest tags.
 *
 * The guest database is the asset that has to outlive whichever booking system
 * the venue is on — SevenRooms today, OpenTable next. So a tag is derived from
 * facts every booking system supplies (did they come, when, how often, did they
 * not show) rather than from anything vendor-specific.
 *
 * The rules are data, not code, so a manager can change "lapsed" from 180 days
 * to 120 without a deploy. Evaluation is pure and lives here so it can be
 * tested without a database.
 */

/** What a guest looks like once their reservations have been rolled up. */
export type GuestFacts = {
  totalVisits: number;
  noShowCount: number;
  totalSpendCents: number;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  birthday: Date | null;
  marketingOptIn: boolean;
};

/**
 * A tag rule. Every field is optional; those present must all hold, so a rule
 * with no conditions matches nobody rather than everybody — a tag that
 * silently applies to the entire database is worse than one that never fires.
 */
export type GuestTagRule = {
  minVisits?: number;
  maxVisits?: number;
  minSpendCents?: number;
  /** Days since the last visit must be at least this — "lapsed". */
  minDaysSinceLastVisit?: number;
  /** Days since the last visit must be at most this — "recent". */
  maxDaysSinceLastVisit?: number;
  minNoShows?: number;
  /** Their birthday falls within this many days from now. */
  birthdayWithinDays?: number;
  /** Only guests who have opted in to marketing. */
  marketingOptInOnly?: boolean;
  /** Must have visited at least once — excludes a booking that never happened. */
  requiresVisit?: boolean;
};

const DAY_MS = 86_400_000;

/** Whole days between two instants, floored. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Days until the guest's next birthday, ignoring the year they were born.
 *
 * Returns 0 on the day itself. Wraps the year end, so on 28 December a
 * 3 January birthday is six days away rather than minus three hundred.
 */
export function daysUntilBirthday(birthday: Date, now: Date = new Date()): number {
  const month = birthday.getUTCMonth();
  const day = birthday.getUTCDate();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let next = new Date(Date.UTC(today.getUTCFullYear(), month, day));
  if (next.getTime() < today.getTime()) {
    next = new Date(Date.UTC(today.getUTCFullYear() + 1, month, day));
  }
  return daysBetween(today, next);
}

/** Every key that narrows who a tag applies to. */
const NUMERIC_CONDITIONS = [
  'minVisits',
  'maxVisits',
  'minSpendCents',
  'minDaysSinceLastVisit',
  'maxDaysSinceLastVisit',
  'minNoShows',
  'birthdayWithinDays'
] as const;

/**
 * Whether a rule actually constrains anything.
 *
 * Only the keys above count. This matters more than it looks: the tags shipped
 * with a segment-shaped object —
 * `{ tagIds: [], guestIds: [], emailOnly: false, ... }` — which has keys and
 * values but constrains nothing. Testing "does this object have any non-false
 * value" said yes, because an empty array is neither null nor false, and every
 * tag was then applied to every guest.
 */
export function isMeaningfulRule(rule: GuestTagRule | null | undefined): boolean {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as GuestTagRule;
  if (NUMERIC_CONDITIONS.some((key) => typeof r[key] === 'number')) return true;
  // A flag alone is a real constraint: "anyone who has visited", "anyone
  // opted in".
  return r.requiresVisit === true || r.marketingOptInOnly === true;
}

/**
 * Whether a guest matches a rule.
 *
 * An empty rule matches nobody. That is deliberate: the tags shipped with this
 * system all carried an empty definition, and treating that as "everyone"
 * would have tagged 2,370 guests as VIPs the first time it ran.
 */
export function guestMatchesRule(
  facts: GuestFacts,
  rule: GuestTagRule | null | undefined,
  now: Date = new Date()
): boolean {
  if (!isMeaningfulRule(rule)) return false;
  const r = rule as GuestTagRule;

  if (r.requiresVisit && facts.totalVisits < 1) return false;
  if (r.minVisits !== undefined && facts.totalVisits < r.minVisits) return false;
  if (r.maxVisits !== undefined && facts.totalVisits > r.maxVisits) return false;
  if (r.minSpendCents !== undefined && facts.totalSpendCents < r.minSpendCents) return false;
  if (r.minNoShows !== undefined && facts.noShowCount < r.minNoShows) return false;
  if (r.marketingOptInOnly && !facts.marketingOptIn) return false;

  if (r.minDaysSinceLastVisit !== undefined) {
    // Never visited is not the same as lapsed; a rule about how long since
    // someone came needs someone who came.
    if (!facts.lastVisitAt) return false;
    if (daysBetween(facts.lastVisitAt, now) < r.minDaysSinceLastVisit) return false;
  }
  if (r.maxDaysSinceLastVisit !== undefined) {
    if (!facts.lastVisitAt) return false;
    if (daysBetween(facts.lastVisitAt, now) > r.maxDaysSinceLastVisit) return false;
  }
  if (r.birthdayWithinDays !== undefined) {
    if (!facts.birthday) return false;
    if (daysUntilBirthday(facts.birthday, now) > r.birthdayWithinDays) return false;
  }

  return true;
}

/**
 * Sensible starting rules for the tags this system ships with.
 *
 * Thresholds are a starting point a manager should argue with, not a truth —
 * which is exactly why they are stored as data on the tag rather than compiled
 * in. "Big spender" is deliberately absent: no spend reaches this database
 * yet, so a spend tag would be a badge nobody could earn.
 */
export const DEFAULT_GUEST_TAG_RULES: Record<string, GuestTagRule> = {
  'first-timer': { requiresVisit: true, maxVisits: 1 },
  'repeat-visitor': { minVisits: 3 },
  'lapsed-guest': { requiresVisit: true, minDaysSinceLastVisit: 180 },
  'no-show-risk': { minNoShows: 2 },
  'birthday-soon': { birthdayWithinDays: 14 },
  vip: { minVisits: 8 }
};


/**
 * The default rule for a tag slug.
 *
 * Slugs in this database carry a venue prefix and underscores —
 * "alma-avalon-big_spender" — so an exact lookup against "big-spender" finds
 * nothing. Match the meaningful tail instead, which also survives a venue
 * being renamed.
 */
export function defaultRuleForSlug(slug: string): GuestTagRule | undefined {
  const normalised = slug.toLowerCase().replace(/_/g, '-');
  const direct = DEFAULT_GUEST_TAG_RULES[normalised];
  if (direct) return direct;
  const key = Object.keys(DEFAULT_GUEST_TAG_RULES).find((candidate) => normalised.endsWith(candidate));
  return key ? DEFAULT_GUEST_TAG_RULES[key] : undefined;
}
