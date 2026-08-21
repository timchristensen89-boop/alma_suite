/**
 * The venue's calendar day, as opposed to the server's or the phone's.
 *
 * Sydney runs ten or eleven hours ahead of UTC, so "today" is a different date
 * depending on who is asking. A client sending its own `toISOString()` day is
 * asking for the UTC date, which for most of a Sydney morning is yesterday —
 * which is how a board of ten opening checks reads as empty at 9am.
 *
 * Everything here works from the IANA zone rather than a fixed offset, because
 * a hardcoded +10 is wrong for the half of the year Sydney is on daylight
 * saving, and the two transition days are 23 and 25 hours long.
 */

export const VENUE_TIME_ZONE = 'Australia/Sydney';

/** The venue-local calendar day for an instant, as YYYY-MM-DD. */
export function venueDayKey(instant: Date = new Date(), timeZone = VENUE_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a plain string.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);
}

/**
 * How far ahead of UTC the zone is at a given instant, in milliseconds.
 *
 * Read by formatting the instant into the zone and treating the result as if
 * it were UTC — the difference is the offset that was actually in force,
 * daylight saving included.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // hour12:false yields 24 for midnight in some engines; %24 normalises it.
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asIfUtc - instant.getTime();
}

/**
 * The UTC instant of a venue-local wall-clock time on a venue-local day.
 *
 * This is the one to reach for whenever a stored `HH:MM` — an availability
 * rule, a service start, a cut-off — has to become a real instant. Building it
 * with `setHours` instead uses the SERVER's zone, and the API containers run
 * UTC, so a 6pm rule becomes 6pm UTC: four or five in the morning in Sydney.
 *
 * Two passes: guess using the offset in force at the naive instant, then
 * correct using the offset actually in force at the guess. That second pass is
 * what makes the daylight-saving boundaries land correctly — on those days the
 * offset before and after the time differ.
 *
 * A wall-clock time that does not exist (2am on the morning the clocks go
 * forward) resolves to the instant the clock skips to, which is 3am.
 */
export function venueInstant(day: string, time = '00:00', timeZone = VENUE_TIME_ZONE): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(midnight)) return null;
  const wallClock = midnight + ((hour * 60 + minute) * 60 + second) * 1000;
  const firstGuess = wallClock - zoneOffsetMs(new Date(wallClock), timeZone);
  return new Date(wallClock - zoneOffsetMs(new Date(firstGuess), timeZone));
}

/** The UTC instant at which a venue-local day begins. */
export function venueDayStart(day: string, timeZone = VENUE_TIME_ZONE): Date | null {
  return venueInstant(day, '00:00', timeZone);
}

/**
 * The day of the week a YYYY-MM-DD falls on, 0 = Sunday, matching `getDay()`.
 *
 * Read off the calendar date itself rather than off an instant, because an
 * instant's weekday depends on which zone you ask in — and the weekday a
 * roster or an availability rule means is the venue's, always.
 */
export function venueWeekday(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : new Date(parsed).getUTCDay();
}

/** A wall-clock label for an instant, in the venue's zone — "6:00 pm". */
export function venueTimeLabel(instant: Date, timeZone = VENUE_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone
  }).format(instant);
}

/** The YYYY-MM-DD after the one given, or null if that isn't a date. */
export function nextDayKey(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The half-open UTC window `[start, end)` covering one venue-local day.
 *
 * Half-open on purpose: an instant at exactly the next midnight belongs to the
 * next day, and a closed window would double-count it.
 */
export function venueDayBounds(day: string, timeZone = VENUE_TIME_ZONE): { gte: Date; lt: Date } | null {
  const gte = venueDayStart(day, timeZone);
  const next = nextDayKey(day);
  if (!gte || !next) return null;
  const lt = venueDayStart(next, timeZone);
  return lt ? { gte, lt } : null;
}

/** The window covering the venue's today. */
export function venueTodayBounds(now: Date = new Date(), timeZone = VENUE_TIME_ZONE) {
  return venueDayBounds(venueDayKey(now, timeZone), timeZone);
}
