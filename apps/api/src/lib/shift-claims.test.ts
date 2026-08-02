import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canApproveClaim,
  canClaimShift,
  canOfferShift,
  isShiftAvailable,
  isSwapOffer,
  type ClaimableShift
} from '@alma/shared';

const NOW = new Date(2026, 7, 2, 12, 0);
const LATER = new Date(2026, 7, 6, 18, 0);
const LATER_END = new Date(2026, 7, 6, 23, 0);

const shift = (over: Partial<ClaimableShift> = {}): ClaimableShift => ({
  staffProfileId: null,
  status: 'PUBLISHED',
  startsAt: LATER,
  endsAt: LATER_END,
  venue: 'Alma Avalon',
  offeredAt: null,
  ...over
});

const sam = { id: 'sam', role: 'STAFF', venue: 'Alma Avalon' };
const bonnie = { id: 'bonnie', role: 'STAFF', venue: 'Alma Avalon' };

test('a shift nobody is on is available; a held one is not', () => {
  assert.equal(isShiftAvailable(shift()), true);
  assert.equal(isShiftAvailable(shift({ staffProfileId: 'sam' })), false);
});

test('a held shift becomes available once offered, and reads as a swap', () => {
  const offered = shift({ staffProfileId: 'sam', offeredAt: NOW });
  assert.equal(isShiftAvailable(offered), true);
  assert.equal(isSwapOffer(offered), true);
  // An unfilled shift is available but is not a swap — nobody is giving it up.
  assert.equal(isSwapOffer(shift()), false);
});

test('an open shift can be claimed', () => {
  assert.deepEqual(canClaimShift(shift(), sam, NOW), { ok: true, kind: 'OPEN' });
});

test('an offered shift can be claimed by someone else, as a swap', () => {
  const offered = shift({ staffProfileId: 'sam', offeredAt: NOW });
  assert.deepEqual(canClaimShift(offered, bonnie, NOW), { ok: true, kind: 'SWAP' });
});

test('you cannot claim your own shift, even while you are offering it', () => {
  // The clearer message wins: "already yours" rather than "already taken".
  const mine = shift({ staffProfileId: 'sam', offeredAt: NOW });
  assert.deepEqual(canClaimShift(mine, sam, NOW), { ok: false, reason: 'That is already your shift.' });
});

test("you cannot claim somebody's shift they have not offered", () => {
  const theirs = shift({ staffProfileId: 'bonnie' });
  assert.deepEqual(canClaimShift(theirs, sam, NOW), {
    ok: false,
    reason: 'Someone has already been given that shift.'
  });
});

test('a draft shift is not claimable — it has not been published to anyone', () => {
  assert.deepEqual(canClaimShift(shift({ status: 'DRAFT' }), sam, NOW), {
    ok: false,
    reason: 'That shift is not open for claiming yet.'
  });
});

test('a shift that has started is not claimable', () => {
  const past = shift({ startsAt: new Date(2026, 7, 1, 18, 0), endsAt: new Date(2026, 7, 1, 23, 0) });
  assert.deepEqual(canClaimShift(past, sam, NOW), { ok: false, reason: 'That shift has already started.' });
});

test('staff cannot claim across venues, managers can', () => {
  const other = shift({ venue: 'St Alma' });
  assert.deepEqual(canClaimShift(other, sam, NOW), { ok: false, reason: 'That shift is at another venue.' });
  // A manager may look after more than one venue; their scoping is separate.
  assert.deepEqual(canClaimShift(other, { id: 'mgr', role: 'MANAGER', venue: 'Alma Avalon' }, NOW), {
    ok: true,
    kind: 'OPEN'
  });
});

test('only the holder may offer a shift', () => {
  assert.deepEqual(canOfferShift(shift({ staffProfileId: 'bonnie' }), sam, NOW), {
    ok: false,
    reason: 'That is not your shift to offer.'
  });
  assert.deepEqual(canOfferShift(shift({ staffProfileId: 'sam' }), sam, NOW), { ok: true });
});

test('an unpublished, started, or already-offered shift cannot be offered', () => {
  assert.equal(canOfferShift(shift({ staffProfileId: 'sam', status: 'DRAFT' }), sam, NOW).ok, false);
  assert.equal(
    canOfferShift(shift({ staffProfileId: 'sam', startsAt: new Date(2026, 7, 1) }), sam, NOW).ok,
    false
  );
  assert.deepEqual(canOfferShift(shift({ staffProfileId: 'sam', offeredAt: NOW }), sam, NOW), {
    ok: false,
    reason: 'You have already offered that shift.'
  });
});

test('approving an open shift fills it; approving an offered one is a swap', () => {
  assert.deepEqual(canApproveClaim(shift(), 'sam'), { ok: true, swapped: false });
  assert.deepEqual(canApproveClaim(shift({ staffProfileId: 'bonnie', offeredAt: NOW }), 'sam'), {
    ok: true,
    swapped: true
  });
});

test('approval is refused once the shift has been filled by someone else', () => {
  // The case this guards: two claims on one open shift, the first approved,
  // then a manager clicks approve on the second.
  assert.deepEqual(canApproveClaim(shift({ staffProfileId: 'bonnie' }), 'sam'), {
    ok: false,
    reason: 'That shift has already been filled.'
  });
});

test('approval is refused when the shift is already the claimer’s', () => {
  // Reachable when an offer is withdrawn and re-approved, or on a double
  // click: the second approval must not silently succeed as a no-op.
  assert.deepEqual(canApproveClaim(shift({ staffProfileId: 'sam', offeredAt: NOW }), 'sam'), {
    ok: false,
    reason: 'That shift is already theirs.'
  });
});
