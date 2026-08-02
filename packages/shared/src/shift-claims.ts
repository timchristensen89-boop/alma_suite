/**
 * The rules deciding who may take which shift.
 *
 * These are pure so they can be tested without a database, and so the same
 * answer is given in every place that asks — the staff app deciding whether to
 * show a button, and the API deciding whether to honour the request.
 *
 * Deliberately NOT here: clash and leave checks. Those need to query the
 * roster, so the service owns them. Everything decidable from the shift and
 * the person alone lives in this file.
 */

/** The parts of a shift these rules read. */
export type ClaimableShift = {
  staffProfileId: string | null;
  status: string;
  startsAt: Date;
  endsAt: Date;
  venue: string | null;
  offeredAt: Date | null;
};

export type ClaimVerdict =
  | { ok: true; kind: 'OPEN' | 'SWAP' }
  | { ok: false; reason: string };

/**
 * A shift is up for grabs when nobody is on it, or when its holder has offered
 * it to the team. A shift somebody holds and has NOT offered is theirs.
 */
export function isShiftAvailable(shift: Pick<ClaimableShift, 'staffProfileId' | 'offeredAt'>): boolean {
  return shift.staffProfileId === null || shift.offeredAt !== null;
}

export function isSwapOffer(shift: Pick<ClaimableShift, 'staffProfileId' | 'offeredAt'>): boolean {
  return shift.staffProfileId !== null && shift.offeredAt !== null;
}

/**
 * May this person ask for this shift?
 *
 * Order matters: the most specific, most useful message wins. Being told "that
 * is already your shift" is more helpful than "someone already has that
 * shift", even though both are true.
 */
export function canClaimShift(
  shift: ClaimableShift,
  claimer: { id: string; role: string; venue: string | null },
  now: Date
): ClaimVerdict {
  if (shift.staffProfileId === claimer.id) {
    return { ok: false, reason: 'That is already your shift.' };
  }
  if (!isShiftAvailable(shift)) {
    return { ok: false, reason: 'Someone has already been given that shift.' };
  }
  if (shift.status !== 'PUBLISHED') {
    return { ok: false, reason: 'That shift is not open for claiming yet.' };
  }
  if (shift.startsAt <= now) {
    return { ok: false, reason: 'That shift has already started.' };
  }
  // Venue scoping applies to staff only. A manager may be looking after more
  // than one venue, and the service scopes their view separately.
  if (claimer.role === 'STAFF' && claimer.venue && shift.venue && shift.venue !== claimer.venue) {
    return { ok: false, reason: 'That shift is at another venue.' };
  }
  return { ok: true, kind: isSwapOffer(shift) ? 'SWAP' : 'OPEN' };
}

/** May this person offer this shift to the team? */
export function canOfferShift(
  shift: ClaimableShift,
  offerer: { id: string },
  now: Date
): { ok: true } | { ok: false; reason: string } {
  if (shift.staffProfileId !== offerer.id) {
    return { ok: false, reason: 'That is not your shift to offer.' };
  }
  if (shift.status !== 'PUBLISHED') {
    return { ok: false, reason: 'You can only offer a published shift.' };
  }
  if (shift.startsAt <= now) {
    return { ok: false, reason: 'That shift has already started.' };
  }
  if (shift.offeredAt) {
    return { ok: false, reason: 'You have already offered that shift.' };
  }
  return { ok: true };
}

/**
 * May a manager hand this shift to this claimer?
 *
 * Approval is checked again at decision time, not just when the claim was
 * made: a shift can be filled, withdrawn or taken back between somebody asking
 * and somebody answering.
 */
export function canApproveClaim(
  shift: ClaimableShift,
  claimerStaffProfileId: string
): { ok: true; swapped: boolean } | { ok: false; reason: string } {
  if (shift.staffProfileId === claimerStaffProfileId) {
    return { ok: false, reason: 'That shift is already theirs.' };
  }
  const swap = isSwapOffer(shift);
  if (shift.staffProfileId && !swap) {
    return { ok: false, reason: 'That shift has already been filled.' };
  }
  return { ok: true, swapped: swap };
}
