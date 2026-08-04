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
 * The UTC instant at which a venue-local day begins.
 *
 * Two passes: guess using the offset in force at the naive instant, then
 * correct using the offset actually in force at the guess. That second pass is
 * what makes the daylight-saving boundaries land correctly — on those days the
 * offset before and after midnight differ.
 */
export function venueDayStart(day: string, timeZone = VENUE_TIME_ZONE): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const wallClock = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(wallClock)) return null;
  const firstGuess = wallClock - zoneOffsetMs(new Date(wallClock), timeZone);
  return new Date(wallClock - zoneOffsetMs(new Date(firstGuess), timeZone));
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
