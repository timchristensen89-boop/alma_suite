/**
 * Donation and sponsorship vouchers.
 *
 * ALMA's written policy (docs/donation-policy.md, August 2026) turns what used
 * to be a judgement call into a lookup: vouchers not cash, twelve a year across
 * all venues, $50–$200 each, twelve months, dine-in, never a Friday or
 * Saturday night. Everything in this file is that policy expressed once, so the
 * counter iPad, the admin screen and the API cannot drift apart on it.
 *
 * Pure by design — no database, no dates from the environment beyond what the
 * caller passes in — so the rules can be tested directly.
 */

/** Calendar-year allocation across ALL venues, not per venue. */
export const DONATION_ANNUAL_CAP = 12;

/**
 * Face value band. The policy allows no exception upward "without a real reason".
 * The floor came down from $150 to $50 in September 2026 so a small voucher can
 * go to a school raffle without spending a $150 allocation slot on it.
 */
export const DONATION_MIN_CENTS = 50_00;
export const DONATION_MAX_CENTS = 200_00;

/**
 * Twelve months, not the three years a sold card carries.
 *
 * A card sold to a consumer must run at least three years under the Australian
 * Consumer Law. A voucher given away as a raffle or auction prize is a
 * different animal — it is supplied at no cost as part of a marketing
 * promotion, which is one of the carve-outs from that minimum. That is the
 * basis for the shorter term here, and it is worth Tim confirming with his
 * accountant rather than taking from this comment.
 */
export const DONATION_EXPIRY_MONTHS = 12;

/** Blackout starts at this hour, local venue time. "Friday or Saturday night." */
export const DONATION_BLACKOUT_FROM_HOUR = 17;

/** Friday and Saturday, as JS getDay() numbers. */
export const DONATION_BLACKOUT_DAYS = [5, 6] as const;

/**
 * Kitchen food cost, used to turn face value into what a redeemed voucher
 * actually costs the business. The policy's own working number.
 */
export const DONATION_FOOD_COST_RATE = 0.33;

/**
 * The rate the policy assumes when it estimates the programme at $500–800 a
 * year. It is explicitly an assumption to be replaced by measurement — the
 * donation report shows the real one alongside it.
 */
export const DONATION_ASSUMED_REDEMPTION_RATE = 0.7;

/**
 * The five things that make a request worth saying yes to. Three or more and
 * it is a candidate; fewer and the answer is no even with allocation left.
 */
export const DONATION_CRITERIA = [
  {
    id: 'local',
    label: 'Local',
    hint: 'Their supporters are already your catchment.'
  },
  {
    id: 'bringsPeopleIn',
    label: 'Brings people in',
    hint: 'The prize walks through your door. A voucher beats a hamper.'
  },
  {
    id: 'named',
    label: 'You get named',
    hint: 'Logo in the programme, mention from the stage, listing on the site. This is what makes it marketing.'
  },
  {
    id: 'existingRelationship',
    label: 'Existing relationship',
    hint: 'A repeat ask from someone who has supported you beats a cold email.'
  },
  {
    id: 'dgrEndorsed',
    label: 'DGR endorsed',
    hint: 'Check ABN Lookup. Not a dealbreaker, but it changes the tax treatment.'
  }
] as const;

export type DonationCriterionId = (typeof DONATION_CRITERIA)[number]['id'];

/** Three of five. The policy's own threshold. */
export const DONATION_CANDIDATE_SCORE = 3;

export type DonationCriteria = Record<DonationCriterionId, boolean>;

export const EMPTY_DONATION_CRITERIA: DonationCriteria = {
  local: false,
  bringsPeopleIn: false,
  named: false,
  existingRelationship: false,
  dgrEndorsed: false
};

/** How many of the five a request meets. */
export function donationScore(criteria: Partial<DonationCriteria>): number {
  return DONATION_CRITERIA.reduce((count, criterion) => (criteria[criterion.id] ? count + 1 : count), 0);
}

/** Three or more and it is worth a yes, allocation permitting. */
export function isDonationCandidate(criteria: Partial<DonationCriteria>): boolean {
  return donationScore(criteria) >= DONATION_CANDIDATE_SCORE;
}

export type DonationVerdict = {
  /** Whether the voucher can be issued at all. */
  ok: boolean;
  /** Plain sentence for the screen. Empty when ok. */
  reasons: string[];
  /** Soft flags — issue it, but say this out loud first. */
  warnings: string[];
  score: number;
  remaining: number;
};

/**
 * Everything the policy says no to, in one place.
 *
 * `used` is how many of the year's twelve are already gone. Hard stops go in
 * `reasons`; things a director may knowingly override go in `warnings`, because
 * a policy that cannot be overridden by the person who wrote it stops being a
 * policy and starts being an obstacle.
 */
export function assessDonation(input: {
  amountCents: number;
  used: number;
  criteria: Partial<DonationCriteria>;
  organisation?: string;
}): DonationVerdict {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const remaining = Math.max(0, DONATION_ANNUAL_CAP - input.used);
  const score = donationScore(input.criteria);

  if (!input.organisation || !input.organisation.trim()) {
    reasons.push('Name the organisation asking. The register is worthless without it.');
  }
  if (remaining <= 0) {
    reasons.push(
      `All ${DONATION_ANNUAL_CAP} donations for this year are gone. The answer is no until the calendar turns.`
    );
  }
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    reasons.push('Enter the face value.');
  } else if (input.amountCents < DONATION_MIN_CENTS) {
    reasons.push(`The policy floor is ${formatAud(DONATION_MIN_CENTS)}.`);
  } else if (input.amountCents > DONATION_MAX_CENTS) {
    // Upward is the one the policy guards: "no exceptions upward without a real
    // reason". So it warns rather than blocks, and the reason gets written down.
    warnings.push(
      `${formatAud(input.amountCents)} is above the ${formatAud(DONATION_MAX_CENTS)} ceiling. Put the real reason in the notes.`
    );
  }

  if (score < DONATION_CANDIDATE_SCORE) {
    warnings.push(
      `Only ${score} of ${DONATION_CRITERIA.length} boxes ticked — the policy wants ${DONATION_CANDIDATE_SCORE}. Worth a second look before it goes out.`
    );
  }
  if (!input.criteria.named) {
    warnings.push('Nobody has promised to name you. Ask for the listing — that is what makes this sponsorship rather than charity.');
  }
  if (remaining === 1 && reasons.length === 0) {
    warnings.push('This is the last one for the year.');
  }

  return { ok: reasons.length === 0, reasons, warnings, score, remaining };
}

/** The conditions, printed on the voucher and in the email. One source. */
export function donationConditions(): string {
  return [
    `Valid for ${DONATION_EXPIRY_MONTHS} months from issue.`,
    'Dine-in only.',
    'Not valid Friday or Saturday evenings.',
    'Not redeemable for cash.'
  ].join(' ');
}

/** Twelve months on from the day it is issued. */
export function donationExpiry(issuedAt: Date): Date {
  const expires = new Date(issuedAt.getTime());
  expires.setMonth(expires.getMonth() + DONATION_EXPIRY_MONTHS);
  return expires;
}

/**
 * Is this moment inside the blackout?
 *
 * Used to warn at the counter when a donation voucher is presented on a Friday
 * or Saturday night — the restriction is otherwise just ink on a card, and the
 * whole point of the blackout is to protect the two services that are already
 * full.
 */
export function isDonationBlackout(when: Date): boolean {
  return (
    (DONATION_BLACKOUT_DAYS as readonly number[]).includes(when.getDay()) &&
    when.getHours() >= DONATION_BLACKOUT_FROM_HOUR
  );
}

/**
 * What a voucher costs if it is redeemed in full: face value at food cost.
 * A $200 voucher against a 33% food cost is $66 of actual outlay.
 */
export function donationCostIfRedeemedCents(faceValueCents: number, foodCostRate = DONATION_FOOD_COST_RATE): number {
  return Math.round(faceValueCents * foodCostRate);
}

/**
 * Cost of value that has actually been redeemed. Unredeemed balance costs
 * nothing — that is the entire argument for vouchers over cash.
 */
export function donationActualCostCents(redeemedCents: number, foodCostRate = DONATION_FOOD_COST_RATE): number {
  return Math.round(redeemedCents * foodCostRate);
}

/** Expected cost across a programme, at an assumed redemption rate. */
export function donationExpectedCostCents(
  faceValueCents: number,
  redemptionRate = DONATION_ASSUMED_REDEMPTION_RATE,
  foodCostRate = DONATION_FOOD_COST_RATE
): number {
  return Math.round(faceValueCents * redemptionRate * foodCostRate);
}

function formatAud(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format(cents / 100);
}

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export type DonationRecord = {
  id: string;
  year: number;
  sequence: number;
  organisation: string;
  cause: string | null;
  contactName: string | null;
  contactEmail: string | null;
  venue: string;
  eventDate: string | null;
  criteria: DonationCriteria;
  score: number;
  listingEvidence: string | null;
  notes: string | null;
  approvedByName: string | null;
  createdAt: string;
  /** When and where the voucher email last went out; null until it is sent. */
  sentAt: string | null;
  sentTo: string | null;
  card: {
    code: string;
    status: string;
    initialValueCents: number;
    balanceCents: number;
    redeemedCents: number;
    expiresAt: string | null;
    lastRedeemedAt: string | null;
  };
};

export type DonationAllocation = {
  year: number;
  cap: number;
  used: number;
  remaining: number;
};

export type DonationReport = {
  year: number;
  allocation: DonationAllocation;
  summary: {
    /** What it looks like from the outside: the sum of face values. */
    faceValueCents: number;
    /** What has actually walked back through the door. */
    redeemedCents: number;
    /** Redeemed value at food cost — the real number. */
    actualCostCents: number;
    /** What the policy's 70% assumption would have predicted. */
    expectedCostCents: number;
    /** Measured, not assumed. Null until at least one voucher has expired or been used. */
    redemptionRate: number | null;
    /** Vouchers with nothing drawn against them yet. */
    unusedCount: number;
    expiredUnusedCents: number;
  };
  byVenue: Array<{ venue: string; count: number; faceValueCents: number; redeemedCents: number }>;
  donations: DonationRecord[];
};
