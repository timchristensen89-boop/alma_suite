// What we can honestly offer a guest on a given day. Pure, so the draft
// generator and its tests apply the SAME rule. Covered by
// enquiry-availability.test.ts.
//
// This exists because a suggested reply that names times is only worth having
// if those times are real. The rule the whole module is built around: an
// enquiry we cannot price against stated availability gets NO times at all —
// the caller drops a tier rather than guessing. Promising 3pm when the room is
// full costs more than sending nothing.
//
// Two deliberate departures from `listPublicSlots` in reserve.service.ts,
// which answers the same question for the public booking widget:
//
//  1. Time is handled in the venue's own zone, not the server's. The widget's
//     slot generator builds its rule windows with `Date.setHours`, so on a
//     UTC host (which is what the container is — the Dockerfile sets no TZ) a
//     rule of "17:00" becomes 5pm UTC = 3am Sydney, and it then compares that
//     window against reservation instants that ARE correct. Every overlap
//     check misses, no covers are counted, and everything looks free. That is
//     the exact failure this feature must not have, so here the caller passes
//     the instant of local midnight and everything is measured in minutes
//     from it.
//  2. Nothing throws. A malformed rule row is skipped, not turned into a 400:
//     one bad row must not stop staff opening an enquiry thread.

/** An availability rule, as stored — `startTime`/`endTime` are "HH:MM" wall clock. */
export type SlotRule = {
  id: string;
  servicePeriod: string | null;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  defaultDurationMinutes: number;
  minPartySize: number;
  maxPartySize: number;
  capacity: number;
};

export type SlotReservation = {
  covers: number;
  startsAt: Date;
  endsAt: Date;
  availabilityRuleId: string | null;
  servicePeriod: string | null;
};

export type SlotBlackout = { startAt: Date; endAt: Date };

/**
 * What we know about a day, in the three states a draft can act on.
 *
 * UNKNOWN and NONE are kept apart even though both send the draft down a tier:
 * "the venue has never stated its hours" and "we looked and there is nothing"
 * are different facts, and the one staff see on the thread should say which.
 */
export type DayAvailability =
  | { kind: 'UNKNOWN'; reason: string }
  | { kind: 'NONE' }
  | { kind: 'OPEN'; startMinutes: number[] };

const MINUTE = 60_000;

/** "HH:MM" as minutes from midnight, or null if the row is not that. */
export function parseWallClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** The venue's calendar day for an instant, as `YYYY-MM-DD`. */
export function venueDayKey(instant: Date, timeZone = 'Australia/Sydney'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);
}

/** Minutes east of UTC that the zone is running at a given instant (600 or 660 for Sydney). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = offset ? /GMT([+-])(\d{2}):(\d{2})/.exec(offset) : null;
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The instant at which the venue's calendar day containing `instant` began.
 *
 * Done in two passes on purpose. Guessing the offset from the instant itself
 * is wrong on the two changeover days each year — on the October Sunday the
 * offset at 8pm (+11) is not the offset at midnight (+10) — so the first guess
 * is re-measured at the answer and redone if the zone moved under it.
 */
export function venueDayStart(instant: Date, timeZone = 'Australia/Sydney'): Date {
  const midnightAsUtc = new Date(`${venueDayKey(instant, timeZone)}T00:00:00Z`);
  const firstGuess = zoneOffsetMinutes(midnightAsUtc, timeZone);
  const start = new Date(midnightAsUtc.getTime() - firstGuess * MINUTE);
  const settled = zoneOffsetMinutes(start, timeZone);
  return settled === firstGuess ? start : new Date(midnightAsUtc.getTime() - settled * MINUTE);
}

/** Day of the week (0 = Sunday) the venue is on at an instant. */
export function venueWeekday(instant: Date, timeZone = 'Australia/Sydney'): number {
  return new Date(`${venueDayKey(instant, timeZone)}T00:00:00Z`).getUTCDay();
}

/**
 * The start times, in minutes from local midnight, that could still take a
 * party of this size on this day.
 *
 * No rules for the venue means we return UNKNOWN, never NONE. This is the same
 * rule the roster board applies in @alma/shared's availability matching: an
 * absence of rows means nothing has been stated, not that the answer is no. A
 * venue that has never filled in its hours must produce a draft that asks,
 * not one that tells the guest they cannot come.
 */
export function computeOpenTimes(input: {
  dayStart: Date;
  weekday: number;
  partySize: number;
  rules: SlotRule[];
  reservations: SlotReservation[];
  blackouts: SlotBlackout[];
}): DayAvailability {
  if (input.rules.length === 0) {
    return { kind: 'UNKNOWN', reason: 'no availability rules for this venue' };
  }
  if (!Number.isInteger(input.partySize) || input.partySize <= 0) {
    return { kind: 'UNKNOWN', reason: 'party size unknown' };
  }

  const dayStartMs = input.dayStart.getTime();
  const minutesFrom = (at: Date) => (at.getTime() - dayStartMs) / MINUTE;
  const reservations = input.reservations.map((row) => ({
    covers: row.covers,
    startMinute: minutesFrom(row.startsAt),
    endMinute: minutesFrom(row.endsAt),
    availabilityRuleId: row.availabilityRuleId,
    servicePeriod: row.servicePeriod
  }));
  const blackouts = input.blackouts.map((row) => ({
    startMinute: minutesFrom(row.startAt),
    endMinute: minutesFrom(row.endAt)
  }));

  const open = new Set<number>();
  for (const rule of input.rules) {
    if (!rule.daysOfWeek.includes(input.weekday)) continue;
    if (input.partySize < rule.minPartySize || input.partySize > rule.maxPartySize) continue;

    const ruleStart = parseWallClock(rule.startTime);
    const ruleEnd = parseWallClock(rule.endTime);
    if (ruleStart === null || ruleEnd === null || ruleEnd <= ruleStart) continue;
    if (rule.intervalMinutes <= 0 || rule.defaultDurationMinutes <= 0) continue;

    for (let cursor = ruleStart; cursor < ruleEnd; cursor += rule.intervalMinutes) {
      const slotEnd = cursor + rule.defaultDurationMinutes;
      if (slotEnd > ruleEnd) break;
      if (blackouts.some((out) => out.startMinute < slotEnd && out.endMinute > cursor)) continue;

      // Capacity is counted per rule, matching how the booking widget counts
      // it: a booking held against the groups rule must not eat the ordinary
      // dinner rule's covers, or the same seats get sold twice.
      const reserved = reservations.reduce((sum, row) => {
        if (!(row.startMinute < slotEnd && row.endMinute > cursor)) return sum;
        if (row.availabilityRuleId && row.availabilityRuleId !== rule.id) return sum;
        if (!row.availabilityRuleId && rule.servicePeriod && row.servicePeriod !== rule.servicePeriod) return sum;
        return sum + row.covers;
      }, 0);

      if (rule.capacity - reserved < input.partySize) continue;
      open.add(cursor);
    }
  }

  if (open.size === 0) return { kind: 'NONE' };
  return { kind: 'OPEN', startMinutes: [...open].sort((a, b) => a - b) };
}
