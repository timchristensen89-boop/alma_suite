// Availability matching.
//
// The rule this encodes: an ABSENCE of availability rows means nothing has
// been stated, not that someone is unavailable. A venue that never fills this
// in must roster exactly as it did before, so "no rows" always returns "no
// objection". Anything else would turn a new feature into a wall of false
// warnings on day one.

export interface AvailabilityRule {
  weekday: number;
  startMinute: number | null;
  endMinute: number | null;
  available: boolean;
  note?: string | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}

export interface UnavailabilityBlock {
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

/** Minutes from midnight, in the venue's local reckoning of the date. */
const minutesOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes();

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/** A rule applies to a date when it is in season and on the right weekday. */
function ruleAppliesOn(rule: AvailabilityRule, date: Date): boolean {
  if (rule.weekday !== date.getDay()) return false;
  if (rule.effectiveFrom && date < rule.effectiveFrom) return false;
  if (rule.effectiveTo && date > rule.effectiveTo) return false;
  return true;
}

export type AvailabilityVerdict =
  | { kind: 'NOT_STATED' }
  | { kind: 'AVAILABLE' }
  | { kind: 'OUTSIDE_STATED_HOURS'; detail: string }
  | { kind: 'MARKED_UNAVAILABLE'; detail: string };

/**
 * Check a proposed shift against someone's stated availability.
 *
 * Returns a verdict rather than a boolean because the three "no" cases read
 * very differently to a manager: nothing stated at all, stated but this shift
 * falls outside it, and explicitly marked unavailable.
 */
export function checkAvailability(
  shiftStart: Date,
  shiftEnd: Date,
  rules: readonly AvailabilityRule[],
  blocks: readonly UnavailabilityBlock[] = [],
): AvailabilityVerdict {
  // A one-off block is the strongest signal and is checked first.
  const blocking = blocks.find((block) => shiftStart < block.endsAt && block.startsAt < shiftEnd);
  if (blocking) {
    return {
      kind: 'MARKED_UNAVAILABLE',
      detail: blocking.reason?.trim()
        ? `unavailable — ${blocking.reason.trim()}`
        : 'marked unavailable for this date',
    };
  }

  const applicable = rules.filter((rule) => ruleAppliesOn(rule, shiftStart));
  if (applicable.length === 0) return { kind: 'NOT_STATED' };

  const shiftFrom = minutesOfDay(shiftStart);
  // A shift ending at or past midnight runs to the end of the day for this
  // comparison; availability is expressed per weekday, so a 7pm-1am shift is
  // matched against the evening rule it starts in.
  const rawTo = minutesOfDay(shiftEnd);
  const shiftTo = rawTo <= shiftFrom ? 24 * 60 : rawTo;

  const covering = (rule: AvailabilityRule) => {
    const from = rule.startMinute ?? 0;
    const to = rule.endMinute ?? 24 * 60;
    return overlaps(shiftFrom, shiftTo, from, to);
  };

  const blocked = applicable.find((rule) => !rule.available && covering(rule));
  if (blocked) {
    return {
      kind: 'MARKED_UNAVAILABLE',
      detail: blocked.note?.trim() ? `not available — ${blocked.note.trim()}` : 'not available at this time',
    };
  }

  const positives = applicable.filter((rule) => rule.available);
  // Only unavailable rules stated for this day: everything else that day is
  // implicitly fine, because the staff member described what they cannot do.
  if (positives.length === 0) return { kind: 'AVAILABLE' };

  // A shift must be FULLY inside stated availability, not merely touching it —
  // "available 5pm-9pm" should object to a shift that runs until midnight.
  const fullyCovered = positives.some((rule) => {
    const from = rule.startMinute ?? 0;
    const to = rule.endMinute ?? 24 * 60;
    return shiftFrom >= from && shiftTo <= to;
  });
  if (fullyCovered) return { kind: 'AVAILABLE' };

  const windows = positives
    .map((rule) => `${formatMinutes(rule.startMinute ?? 0)}–${formatMinutes(rule.endMinute ?? 24 * 60)}`)
    .join(', ');
  return { kind: 'OUTSIDE_STATED_HOURS', detail: `available ${windows}` };
}

export function formatMinutes(minute: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minute)));
  if (clamped === 24 * 60) return 'midnight';
  const hour = Math.floor(clamped / 60);
  const min = clamped % 60;
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return min === 0 ? `${display}${suffix}` : `${display}:${String(min).padStart(2, '0')}${suffix}`;
}
