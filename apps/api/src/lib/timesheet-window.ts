// The date window behind `GET /api/staff/timesheets`, pure so the Staff home
// card, the Timesheets page and the tests all resolve the SAME window.
// Covered by timesheet-window.test.ts.
//
// `Timesheet.workDate` is stored as UTC midnight of the SYDNEY calendar day
// (see clock-to-timesheet.ts and deputy-timesheet.ts), so a window is really a
// pair of venue day keys compared as UTC-midnight instants. Callers may send
// either a bare `YYYY-MM-DD` (taken as that venue day) or a full ISO instant
// (mapped to the venue day it falls in) — a browser in Europe sending its own
// local Monday midnight still lands on the venue's Monday.
//
// Background: the Staff home "Awaiting approval" card sent `start` thirty days
// back and no `end`, and a missing `end` used to default to `start + 14 days`.
// The card therefore counted timesheets worked 30-16 days ago and never the
// current fortnight, while the Timesheets page (which always sends `end`) saw
// the whole week — one vs nineteen for the same queue.

import { venueDayKey } from '@alma/shared';

const DAY_MS = 86_400_000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** UTC midnight of a YYYY-MM-DD, the storage form of `workDate`. */
export function workDateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDaysToKey(key: string, days: number): string {
  return new Date(workDateFromKey(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The venue day a caller-supplied boundary means. Bare day keys are taken as
 * is; anything else must parse as an instant and is read in the venue zone.
 * Returns null when the value is not a date at all.
 */
export function timesheetBoundaryKey(value: string): string | null {
  const trimmed = value.trim();
  if (DAY_KEY.test(trimmed)) {
    return Number.isNaN(workDateFromKey(trimmed).getTime()) ? null : trimmed;
  }
  const instant = new Date(trimmed);
  if (Number.isNaN(instant.getTime())) return null;
  return venueDayKey(instant);
}

export type TimesheetWindow = {
  /** Inclusive first venue day, YYYY-MM-DD. */
  startKey: string;
  /** Exclusive last venue day, YYYY-MM-DD. */
  endKey: string;
  /** `workDate >= start` — UTC midnight of startKey. */
  start: Date;
  /** `workDate < end` — UTC midnight of endKey. */
  end: Date;
};

/**
 * Resolve the `[start, end)` window for a timesheet listing.
 *
 * - Both given: exactly that window.
 * - Only `start`: through the venue's today (end = tomorrow), so "since day X"
 *   means up to now rather than a fixed fortnight from X.
 * - Only `end`: the seven venue days before it.
 * - Neither: the venue week either side of today (7 days back, 7 ahead), the
 *   default the Timesheets page has always relied on.
 *
 * `end` never resolves to or before `start`; a caller asking for a start in
 * the future gets a one-day window rather than an inverted one.
 */
export function resolveTimesheetWindow(input: {
  start?: string | null;
  end?: string | null;
  now?: Date;
}): TimesheetWindow | { error: 'start' | 'end' } {
  const todayKey = venueDayKey(input.now ?? new Date());
  const tomorrowKey = addDaysToKey(todayKey, 1);

  let startKey: string | null = null;
  if (input.start) {
    startKey = timesheetBoundaryKey(input.start);
    if (!startKey) return { error: 'start' };
  }
  let endKey: string | null = null;
  if (input.end) {
    endKey = timesheetBoundaryKey(input.end);
    if (!endKey) return { error: 'end' };
  }

  if (!startKey && !endKey) {
    startKey = addDaysToKey(todayKey, -7);
    endKey = addDaysToKey(todayKey, 8);
  } else if (startKey && !endKey) {
    endKey = tomorrowKey;
  } else if (!startKey && endKey) {
    startKey = addDaysToKey(endKey, -7);
  }

  if (endKey! <= startKey!) endKey = addDaysToKey(startKey!, 1);

  return {
    startKey: startKey!,
    endKey: endKey!,
    start: workDateFromKey(startKey!),
    end: workDateFromKey(endKey!)
  };
}

/** The venue's trailing N-day window ending today (inclusive), as day keys. */
export function trailingVenueDays(days: number, now: Date = new Date()): { startKey: string; endKey: string } {
  const todayKey = venueDayKey(now);
  return { startKey: addDaysToKey(todayKey, -days), endKey: addDaysToKey(todayKey, 1) };
}
