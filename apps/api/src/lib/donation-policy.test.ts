import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DONATION_ANNUAL_CAP,
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  assessDonation,
  donationActualCostCents,
  donationCostIfRedeemedCents,
  donationExpectedCostCents,
  donationExpiry,
  donationScore,
  isDonationBlackout,
  isDonationCandidate
} from '@alma/shared';

const YES = {
  local: true,
  bringsPeopleIn: true,
  named: true,
  existingRelationship: true,
  dgrEndorsed: true
};

const OK = { amountCents: 200_00, used: 0, criteria: YES, organisation: 'Freshwater SLSC' };

describe('donationScore', () => {
  it('counts the boxes ticked', () => {
    assert.equal(donationScore(YES), 5);
    assert.equal(donationScore({ local: true, named: true }), 2);
    assert.equal(donationScore({}), 0);
  });

  it('treats three of five as the threshold the policy sets', () => {
    assert.equal(isDonationCandidate({ local: true, named: true }), false);
    assert.equal(isDonationCandidate({ local: true, named: true, bringsPeopleIn: true }), true);
  });
});

describe('assessDonation — the hard stops', () => {
  it('lets a clean request through', () => {
    const verdict = assessDonation(OK);
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.reasons, []);
  });

  it('refuses once the year is spent', () => {
    const verdict = assessDonation({ ...OK, used: DONATION_ANNUAL_CAP });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.remaining, 0);
    assert.match(verdict.reasons.join(' '), /until the calendar turns/);
  });

  it('refuses below the floor', () => {
    const verdict = assessDonation({ ...OK, amountCents: DONATION_MIN_CENTS - 1 });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons.join(' '), /floor/);
  });

  it('refuses an unnamed organisation, because the register needs one', () => {
    const verdict = assessDonation({ ...OK, organisation: '   ' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reasons.join(' '), /Name the organisation/);
  });

  it('warns rather than blocks above the ceiling — the policy allows a real reason', () => {
    const verdict = assessDonation({ ...OK, amountCents: DONATION_MAX_CENTS + 5000 });
    assert.equal(verdict.ok, true);
    assert.match(verdict.warnings.join(' '), /above the .* ceiling/);
  });
});

describe('assessDonation — the soft flags', () => {
  it('flags a thin request that still has allocation', () => {
    const verdict = assessDonation({ ...OK, criteria: { local: true, dgrEndorsed: true } });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.score, 2);
    assert.match(verdict.warnings.join(' '), /2 of 5/);
  });

  it('always asks for the listing when nobody has promised one', () => {
    const verdict = assessDonation({ ...OK, criteria: { ...YES, named: false } });
    assert.match(verdict.warnings.join(' '), /name you/);
  });

  it('says so when it is the last one', () => {
    const verdict = assessDonation({ ...OK, used: DONATION_ANNUAL_CAP - 1 });
    assert.equal(verdict.remaining, 1);
    assert.match(verdict.warnings.join(' '), /last one/);
  });

  it('does not add the last-one warning to a request it is already refusing', () => {
    const verdict = assessDonation({ ...OK, used: DONATION_ANNUAL_CAP - 1, organisation: '' });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.warnings.some((w) => w.includes('last one')), false);
  });
});

describe('donationExpiry', () => {
  it('is twelve months, not the three years a sold card carries', () => {
    assert.equal(donationExpiry(new Date('2026-08-21T10:00:00Z')).toISOString().slice(0, 10), '2027-08-21');
  });

  it('does not spill into a later month when the target month is shorter', () => {
    // 31 Aug + 12 months is 31 Aug, not a rolled-over date.
    assert.equal(donationExpiry(new Date('2026-08-31T02:00:00Z')).toISOString().slice(0, 7), '2027-08');
  });
});

describe('isDonationBlackout', () => {
  // Constructed with local-time components, because the blackout is a venue
  // clock question and the counter iPad stands in the venue.
  const at = (year: number, month: number, day: number, hour: number) => new Date(year, month - 1, day, hour, 0, 0);

  it('blocks Friday evening', () => {
    assert.equal(isDonationBlackout(at(2026, 8, 21, 19)), true); // Friday 7pm
  });

  it('blocks Saturday evening', () => {
    assert.equal(isDonationBlackout(at(2026, 8, 22, 18)), true); // Saturday 6pm
  });

  it('leaves Friday lunch alone — the restriction is on the night service', () => {
    assert.equal(isDonationBlackout(at(2026, 8, 21, 12)), false);
  });

  it('leaves the rest of the week alone', () => {
    assert.equal(isDonationBlackout(at(2026, 8, 20, 20)), false); // Thursday 8pm
    assert.equal(isDonationBlackout(at(2026, 8, 23, 20)), false); // Sunday 8pm
  });
});

describe('the cost model the policy argues from', () => {
  it('reproduces the policy table: a $200 voucher used in full costs about $66', () => {
    assert.equal(donationCostIfRedeemedCents(200_00), 66_00);
  });

  it('reproduces the expected cost at the assumed 70% redemption: about $46', () => {
    assert.equal(donationExpectedCostCents(200_00), 46_20);
  });

  it('charges nothing for value that was never redeemed', () => {
    assert.equal(donationActualCostCents(0), 0);
  });

  it('costs only what actually walked back through the door', () => {
    // $200 voucher, $120 spent against it.
    assert.equal(donationActualCostCents(120_00), 39_60);
  });

  it('puts twelve $200 vouchers inside the range the policy claims', () => {
    const expected = donationExpectedCostCents(12 * 200_00);
    assert.ok(expected >= 500_00 && expected <= 800_00, `${expected} outside $500–800`);
  });
});
