/**
 * The two checks a roster should run before it puts somebody on a shift:
 * are they still certified to do the work, and is the pattern of work
 * reasonable?
 *
 * Pure, so the staff app can warn while a manager is dragging a shift around
 * and the API can enforce the same answer on save, without the two drifting.
 */

/* ------------------------------------------------------------------ */
/* Certification                                                       */
/* ------------------------------------------------------------------ */

/**
 * Record types that say somebody is permitted to do the work. TRAINING and
 * OTHER are deliberately excluded: they are useful to track, but an expired
 * internal training module is not a reason to refuse a shift.
 */
export const CERTIFICATION_RECORD_TYPES = ['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY'] as const;
export type CertificationRecordType = (typeof CERTIFICATION_RECORD_TYPES)[number];

export type ComplianceRecordForRostering = {
  recordType: string;
  title: string;
  status: string;
  expiryDate: string | Date | null;
};

export type CertificationBlock = {
  recordType: string;
  title: string;
  expiredOn: string;
};

function asDate(value: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Certifications this person holds that will have EXPIRED by the time the
 * shift starts.
 *
 * This only ever reports a certificate with a recorded expiry date that has
 * passed. It deliberately says nothing about a missing certificate, or one
 * with no expiry recorded — in this data most certificates have no expiry
 * date at all, so treating "unknown" as "expired" would flag nearly everyone
 * and the warning would be learnt and ignored, hiding the real ones.
 *
 * A record already marked EXPIRED counts even without a date, because someone
 * has explicitly said so.
 */
export function expiredCertificationsForShift(
  records: ComplianceRecordForRostering[],
  shiftStartsAt: Date
): CertificationBlock[] {
  const out: CertificationBlock[] = [];
  for (const record of records) {
    if (!CERTIFICATION_RECORD_TYPES.includes(record.recordType as CertificationRecordType)) continue;
    // A rejected certificate was never valid; a superseded one will have been
    // replaced by a newer record of the same type, handled below.
    if (record.status === 'REJECTED') continue;

    const expiry = asDate(record.expiryDate);
    if (expiry && expiry < shiftStartsAt) {
      out.push({ recordType: record.recordType, title: record.title, expiredOn: expiry.toISOString() });
    } else if (!expiry && record.status === 'EXPIRED') {
      out.push({ recordType: record.recordType, title: record.title, expiredOn: '' });
    }
  }

  // Somebody who renewed has two records of the same type: the old expired one
  // and the new valid one. Only report a type where NOTHING valid covers the
  // shift, or every renewal would read as a breach.
  return out.filter((blocked) => !records.some((record) =>
    record.recordType === blocked.recordType &&
    record.status !== 'REJECTED' &&
    record.status !== 'EXPIRED' &&
    (() => {
      const expiry = asDate(record.expiryDate);
      return expiry === null || expiry >= shiftStartsAt;
    })()
  ));
}

export function describeCertificationBlock(block: CertificationBlock): string {
  if (!block.expiredOn) return `${block.title} is marked expired`;
  const on = new Date(block.expiredOn).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${block.title} expired on ${on}`;
}

/* ------------------------------------------------------------------ */
/* Fatigue                                                             */
/* ------------------------------------------------------------------ */

/**
 * Venue policy, not law. These are the numbers a venue chooses to roster to;
 * they are defaults, meant to be adjusted, and they are surfaced as warnings
 * rather than refusals so a manager who knows better is never stuck.
 */
export type FatiguePolicy = {
  /** Hours off between the end of one shift and the start of the next. */
  minRestHours: number;
  /** Days in a row somebody may be rostered. */
  maxConsecutiveDays: number;
  /** Hours across the roster week. */
  maxWeeklyHours: number;
};

export const DEFAULT_FATIGUE_POLICY: FatiguePolicy = {
  minRestHours: 10,
  maxConsecutiveDays: 6,
  maxWeeklyHours: 48
};

export type ShiftForFatigue = {
  id: string;
  startsAt: string | Date;
  endsAt: string | Date;
  breakMinutes?: number;
  status?: string;
};

export type FatigueWarning =
  | { kind: 'SHORT_REST'; message: string; restHours: number; againstShiftId: string }
  | { kind: 'TOO_MANY_DAYS'; message: string; consecutiveDays: number }
  | { kind: 'TOO_MANY_HOURS'; message: string; weeklyHours: number };

const HOUR_MS = 60 * 60 * 1000;

function paidHours(shift: ShiftForFatigue): number {
  const start = asDate(shift.startsAt);
  const end = asDate(shift.endsAt);
  if (!start || !end) return 0;
  const gross = (end.getTime() - start.getTime()) / HOUR_MS;
  return Math.max(0, gross - (shift.breakMinutes ?? 0) / 60);
}

function dayKey(value: string | Date): string {
  const date = asDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

function roundHours(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * What is unreasonable about putting this person on this shift, given what
 * they are already rostered?
 *
 * `existing` should be the person's other shifts across at least the
 * surrounding week; anything cancelled is ignored, and the candidate shift
 * itself is excluded by id so re-saving an existing shift does not warn about
 * clashing with itself.
 */
export function checkFatigue(
  candidate: ShiftForFatigue,
  existing: ShiftForFatigue[],
  policy: FatiguePolicy = DEFAULT_FATIGUE_POLICY
): FatigueWarning[] {
  const warnings: FatigueWarning[] = [];
  const start = asDate(candidate.startsAt);
  const end = asDate(candidate.endsAt);
  if (!start || !end) return warnings;

  const others = existing
    .filter((shift) => shift.id !== candidate.id && shift.status !== 'CANCELLED')
    .filter((shift) => asDate(shift.startsAt) && asDate(shift.endsAt));

  // Rest — against the nearest shift on either side, not just the previous
  // one. A late finish before an early start is the same problem whichever
  // direction it is being rostered from.
  for (const other of others) {
    const otherStart = asDate(other.startsAt)!;
    const otherEnd = asDate(other.endsAt)!;
    // Overlaps are a double-booking, which the roster refuses elsewhere. Rest
    // is only meaningful between shifts that do not overlap.
    if (otherStart < end && otherEnd > start) continue;
    const gapHours = otherEnd <= start
      ? (start.getTime() - otherEnd.getTime()) / HOUR_MS
      : (otherStart.getTime() - end.getTime()) / HOUR_MS;
    if (gapHours < policy.minRestHours) {
      warnings.push({
        kind: 'SHORT_REST',
        restHours: roundHours(gapHours),
        againstShiftId: other.id,
        message: `Only ${roundHours(gapHours)}h off around this shift — the venue rosters ${policy.minRestHours}h between shifts.`
      });
      break; // One rest warning is enough; naming every neighbour is noise.
    }
  }

  // Consecutive days — the run this shift would belong to.
  const workedDays = new Set(others.map((shift) => dayKey(shift.startsAt)));
  workedDays.add(dayKey(candidate.startsAt));
  let run = 1;
  const oneDay = 24 * HOUR_MS;
  const candidateDay = new Date(`${dayKey(candidate.startsAt)}T00:00:00.000Z`);
  for (let offset = 1; ; offset += 1) {
    if (!workedDays.has(new Date(candidateDay.getTime() - offset * oneDay).toISOString().slice(0, 10))) break;
    run += 1;
  }
  for (let offset = 1; ; offset += 1) {
    if (!workedDays.has(new Date(candidateDay.getTime() + offset * oneDay).toISOString().slice(0, 10))) break;
    run += 1;
  }
  if (run > policy.maxConsecutiveDays) {
    warnings.push({
      kind: 'TOO_MANY_DAYS',
      consecutiveDays: run,
      message: `That makes ${run} days in a row — the venue rosters at most ${policy.maxConsecutiveDays}.`
    });
  }

  // Weekly hours — the seven days containing this shift, Monday-based to match
  // how the roster board and pay week are cut.
  const day = candidateDay.getUTCDay();
  const weekStart = new Date(candidateDay.getTime() - ((day + 6) % 7) * oneDay);
  const weekEnd = new Date(weekStart.getTime() + 7 * oneDay);
  const weeklyHours = [...others, candidate]
    .filter((shift) => {
      const shiftStart = asDate(shift.startsAt)!;
      return shiftStart >= weekStart && shiftStart < weekEnd;
    })
    .reduce((sum, shift) => sum + paidHours(shift), 0);
  if (weeklyHours > policy.maxWeeklyHours) {
    warnings.push({
      kind: 'TOO_MANY_HOURS',
      weeklyHours: roundHours(weeklyHours),
      message: `That week reaches ${roundHours(weeklyHours)}h — the venue rosters at most ${policy.maxWeeklyHours}h.`
    });
  }

  return warnings;
}
