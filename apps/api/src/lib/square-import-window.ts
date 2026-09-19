// The window a rolling Square import reads, and why its start is pinned to a
// local midnight.
//
// A Square import writes each service day's total as a REPLACEMENT: the sum
// of the payments it fetched for that day. For five weeks the scheduled sync
// read "now minus seven days" as a raw instant, so the oldest day in every run
// was covered only from that time of day onwards — and the last run that
// still caught a payment on a given day (the window's start creeping past
// 9pm) overwrote its correct total with the late-evening tail. St Alma's
// Saturdays read $700 instead of $9,000. Nothing here may write a day it did
// not read in full: the window starts at a local midnight, and the guard
// below refuses any day that begins before the start.
//
// Pure, covered by square-import-window.test.ts.

export const SYDNEY = 'Australia/Sydney';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Minutes east of UTC for `timeZone` at `date`, from the wall clock Intl reports. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-09-19" for the local calendar day `date` falls on in `timeZone`. */
export function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}

/** Move a date key by whole calendar days — no time zone involved. */
export function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The instant local midnight of `key` happens in `timeZone`. Two passes so a
 * daylight-saving change between the guess and the answer is corrected. */
export function localMidnightUtc(key: string, timeZone: string): Date {
  if (!DATE_KEY.test(key)) throw new Error(`Not a date key: ${key}`);
  const naive = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  let candidate = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  const offsetThere = zoneOffsetMs(candidate, timeZone);
  if (candidate.getTime() !== naive - offsetThere) candidate = new Date(naive - offsetThere);
  return candidate;
}

export function isLocalMidnight(date: Date, timeZone: string): boolean {
  return localMidnightUtc(localDateKey(date, timeZone), timeZone).getTime() === date.getTime();
}

/** The first service day that lies wholly inside a window starting at
 * `start`: the start's own day when it begins at midnight, else the next. */
export function firstWholeDayKey(start: Date, timeZone: string): string {
  const key = localDateKey(start, timeZone);
  return isLocalMidnight(start, timeZone) ? key : shiftDateKey(key, 1);
}

export type ImportWindow = { start: Date; end: Date };

/** A scheduled run: today so far, plus the previous `lookbackDays` days in
 * full. Today is partial on purpose — that is the live figure, and it only
 * ever grows until the next run replaces it. */
export function rollingImportWindow(now: Date, lookbackDays: number, timeZone: string = SYDNEY): ImportWindow {
  const days = Math.max(0, Math.floor(lookbackDays));
  const start = localMidnightUtc(shiftDateKey(localDateKey(now, timeZone), -days), timeZone);
  return { start, end: now };
}

/** One edge of an explicit range, from a form or a script. A bare date means
 * the whole of that local day: as a start, its midnight; as an end, the
 * midnight after it. A full timestamp is taken literally. Null when there is
 * nothing there or it cannot be read. */
export function parseImportEdge(value: unknown, role: 'start' | 'end', timeZone: string = SYDNEY): Date | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (DATE_KEY.test(text)) {
    return localMidnightUtc(role === 'end' ? shiftDateKey(text, 1) : text, timeZone);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** An explicit range: needs a readable start; the end defaults to now and
 * never reaches past it. */
export function explicitImportWindow(
  input: { startDate?: unknown; endDate?: unknown },
  now: Date,
  timeZone: string = SYDNEY
): ImportWindow | null {
  const start = parseImportEdge(input.startDate, 'start', timeZone);
  if (!start) return null;
  let end = parseImportEdge(input.endDate, 'end', timeZone) ?? now;
  if (end.getTime() > now.getTime()) end = now;
  return { start, end };
}
