import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkFatigue,
  DEFAULT_FATIGUE_POLICY,
  describeCertificationBlock,
  expiredCertificationsForShift,
  type ComplianceRecordForRostering,
  type ShiftForFatigue
} from '@alma/shared';

/* ---------------------------------------------------------------- */
/* Certification                                                     */
/* ---------------------------------------------------------------- */

const SHIFT_DAY = new Date('2026-08-10T18:00:00.000Z');
const cert = (over: Partial<ComplianceRecordForRostering> = {}): ComplianceRecordForRostering => ({
  recordType: 'RSA',
  title: 'RSA Certificate',
  status: 'APPROVED',
  expiryDate: null,
  ...over
});

test('a certificate that expired before the shift is reported', () => {
  const blocks = expiredCertificationsForShift([cert({ expiryDate: '2026-07-01T00:00:00.000Z' })], SHIFT_DAY);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.recordType, 'RSA');
});

test('a certificate expiring after the shift is fine', () => {
  const blocks = expiredCertificationsForShift([cert({ expiryDate: '2027-01-01T00:00:00.000Z' })], SHIFT_DAY);
  assert.deepEqual(blocks, []);
});

test('no expiry date recorded is NOT treated as expired', () => {
  // The rule that stops this becoming a wall of false blocks: in the live data
  // almost every certificate has no expiry recorded. Unknown is not expired.
  assert.deepEqual(expiredCertificationsForShift([cert({ expiryDate: null })], SHIFT_DAY), []);
});

test('having no certificate at all is not reported here', () => {
  // Absence is a different problem — an onboarding gap, not a lapsed permit —
  // and blocking a roster on it would stop work that may not need the permit.
  assert.deepEqual(expiredCertificationsForShift([], SHIFT_DAY), []);
});

test('a record explicitly marked EXPIRED counts even with no date', () => {
  const blocks = expiredCertificationsForShift([cert({ status: 'EXPIRED' })], SHIFT_DAY);
  assert.equal(blocks.length, 1);
  assert.equal(describeCertificationBlock(blocks[0]!), 'RSA Certificate is marked expired');
});

test('a renewal clears the old expired certificate', () => {
  // Somebody who renewed holds both records. Reporting the old one would make
  // every renewal read as a breach.
  const blocks = expiredCertificationsForShift(
    [
      cert({ expiryDate: '2026-07-01T00:00:00.000Z' }),
      cert({ expiryDate: '2027-07-01T00:00:00.000Z' })
    ],
    SHIFT_DAY
  );
  assert.deepEqual(blocks, []);
});

test('a renewal of a DIFFERENT certificate does not clear the expired one', () => {
  const blocks = expiredCertificationsForShift(
    [
      cert({ recordType: 'RSA', title: 'RSA', expiryDate: '2026-07-01T00:00:00.000Z' }),
      cert({ recordType: 'FIRST_AID', title: 'First Aid', expiryDate: '2027-07-01T00:00:00.000Z' })
    ],
    SHIFT_DAY
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.recordType, 'RSA');
});

test('training and other records are never a reason to refuse a shift', () => {
  const blocks = expiredCertificationsForShift(
    [
      cert({ recordType: 'TRAINING', expiryDate: '2020-01-01T00:00:00.000Z' }),
      cert({ recordType: 'OTHER', expiryDate: '2020-01-01T00:00:00.000Z' })
    ],
    SHIFT_DAY
  );
  assert.deepEqual(blocks, []);
});

test('a rejected certificate is ignored — it was never valid', () => {
  const blocks = expiredCertificationsForShift(
    [cert({ status: 'REJECTED', expiryDate: '2026-07-01T00:00:00.000Z' })],
    SHIFT_DAY
  );
  assert.deepEqual(blocks, []);
});

/* ---------------------------------------------------------------- */
/* Fatigue                                                           */
/* ---------------------------------------------------------------- */

// 2026-08-10 is a Monday.
const shift = (id: string, day: number, startHour: number, endHour: number, breakMinutes = 0): ShiftForFatigue => ({
  id,
  startsAt: `2026-08-${String(day).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:00:00.000Z`,
  endsAt: `2026-08-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:00:00.000Z`,
  breakMinutes
});

test('a shift with nothing around it raises nothing', () => {
  assert.deepEqual(checkFatigue(shift('a', 10, 9, 17), []), []);
});

test('a late finish followed by an early start warns about rest', () => {
  const previous = shift('prev', 10, 17, 23);        // finishes 23:00 Mon
  const candidate = shift('next', 11, 6, 14);        // starts 06:00 Tue — 7h off
  const warnings = checkFatigue(candidate, [previous]);
  const rest = warnings.find((w) => w.kind === 'SHORT_REST');
  assert.ok(rest, 'expected a short-rest warning');
  assert.equal(rest!.kind === 'SHORT_REST' && rest.restHours, 7);
});

test('rest is measured in both directions, not just backwards', () => {
  // Rostering the EARLIER shift last is the same problem, and used to be the
  // easy one to miss: nothing before it, so a backwards-only check says fine.
  const later = shift('later', 11, 6, 14);
  const candidate = shift('earlier', 10, 17, 23);
  assert.ok(checkFatigue(candidate, [later]).some((w) => w.kind === 'SHORT_REST'));
});

test('a full night off raises nothing', () => {
  const previous = shift('prev', 10, 9, 17);   // finishes 17:00
  const candidate = shift('next', 11, 9, 17);  // starts 09:00 — 16h off
  assert.deepEqual(checkFatigue(candidate, [previous]), []);
});

test('an overlapping shift is not a rest problem', () => {
  // Double-booking is refused elsewhere; reporting it as "0h rest" here would
  // be a second, confusing message about the same thing.
  const other = shift('other', 10, 12, 20);
  const candidate = shift('cand', 10, 9, 17);
  assert.deepEqual(checkFatigue(candidate, [other]).filter((w) => w.kind === 'SHORT_REST'), []);
});

test('a seventh day in a row warns', () => {
  const existing = [4, 5, 6, 7, 8, 9].map((day, i) => shift(`d${i}`, day, 9, 15));
  const warnings = checkFatigue(shift('cand', 10, 9, 15), existing);
  const days = warnings.find((w) => w.kind === 'TOO_MANY_DAYS');
  assert.ok(days, 'expected a consecutive-days warning');
  assert.equal(days!.kind === 'TOO_MANY_DAYS' && days.consecutiveDays, 7);
});

test('the run counts days on BOTH sides of the new shift', () => {
  // Filling a gap in the middle of two runs joins them into one long run —
  // the case a backwards-only count reports as 4 days instead of 7.
  const before = [7, 8, 9].map((day, i) => shift(`b${i}`, day, 9, 15));
  const after = [11, 12, 13].map((day, i) => shift(`a${i}`, day, 9, 15));
  const warnings = checkFatigue(shift('cand', 10, 9, 15), [...before, ...after]);
  const days = warnings.find((w) => w.kind === 'TOO_MANY_DAYS');
  assert.ok(days);
  assert.equal(days!.kind === 'TOO_MANY_DAYS' && days.consecutiveDays, 7);
});

test('six days in a row is within policy', () => {
  const existing = [5, 6, 7, 8, 9].map((day, i) => shift(`d${i}`, day, 9, 15));
  assert.deepEqual(checkFatigue(shift('cand', 10, 9, 15), existing).filter((w) => w.kind === 'TOO_MANY_DAYS'), []);
});

test('a heavy week warns on hours, and breaks are not counted as work', () => {
  // Six 9-hour days = 54h gross. With a 60m break each that is 48h paid,
  // which is exactly the policy limit and must NOT warn.
  const existing = [10, 11, 12, 13, 14].map((day, i) => shift(`d${i}`, day, 9, 18, 60));
  const candidate = shift('cand', 15, 9, 18, 60);
  assert.deepEqual(checkFatigue(candidate, existing).filter((w) => w.kind === 'TOO_MANY_HOURS'), []);

  // The same week without breaks is 54h and does warn.
  const noBreaks = [10, 11, 12, 13, 14].map((day, i) => shift(`d${i}`, day, 9, 18));
  const hours = checkFatigue(shift('cand', 15, 9, 18), noBreaks).find((w) => w.kind === 'TOO_MANY_HOURS');
  assert.ok(hours);
  assert.equal(hours!.kind === 'TOO_MANY_HOURS' && hours.weeklyHours, 54);
});

test('hours from an adjacent week are not counted', () => {
  // 2026-08-10 is a Monday, so 9 Aug is the previous week and must not add in.
  const previousWeek = [3, 4, 5, 6, 7, 8, 9].map((day, i) => shift(`p${i}`, day, 9, 21));
  assert.deepEqual(
    checkFatigue(shift('cand', 10, 9, 12), previousWeek).filter((w) => w.kind === 'TOO_MANY_HOURS'),
    []
  );
});

test('re-saving an existing shift does not warn against itself', () => {
  const self = shift('same', 10, 9, 17);
  assert.deepEqual(checkFatigue(self, [self]), []);
});

test('cancelled shifts are ignored', () => {
  const cancelled = { ...shift('x', 10, 17, 23), status: 'CANCELLED' };
  assert.deepEqual(checkFatigue(shift('cand', 11, 6, 14), [cancelled]), []);
});

test('the policy is configurable', () => {
  const previous = shift('prev', 10, 17, 23);
  const candidate = shift('next', 11, 6, 14); // 7h off
  const relaxed = { ...DEFAULT_FATIGUE_POLICY, minRestHours: 6 };
  assert.deepEqual(checkFatigue(candidate, [previous], relaxed).filter((w) => w.kind === 'SHORT_REST'), []);
});
