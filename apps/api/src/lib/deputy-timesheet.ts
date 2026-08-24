/**
 * Reading a Deputy Timesheet row, defensively.
 *
 * BREAKS. Deputy's `Mealbreak` field is not a duration — it comes back as a
 * datetime — so parsing it as "seconds" produced NaN and every imported
 * break landed as 0 minutes. Reported from the floor: breaks logged in
 * Deputy weren't reaching the timesheets, so everyone was being paid through
 * their breaks. The trustworthy figure is `TotalTime`, Deputy's own PAID
 * hours for the shift (elapsed less unpaid breaks): the unpaid break is
 * simply elapsed − TotalTime. `Mealbreak` is kept only as a fallback for the
 * plain-number shape, in case Deputy sends seconds somewhere.
 *
 * LEAVE. Deputy writes approved leave into the same Timesheet resource,
 * flagged `IsLeave` with a `LeaveRule` id. Imported blind, a week of annual
 * leave looked exactly like a week worked: it pushed to Xero as ordinary
 * hours (double pay, since Xero also pays the leave application) and drew a
 * share of the tip pool. A leave row also gets no break — there is no shift
 * to take a break from.
 *
 * DAY WORKED. `workDate` is the calendar day a shift belongs to, stored the
 * way the rest of the suite stores it: UTC-midnight of that day (a manual
 * timesheet's `new Date('2026-08-22')` lands there, and `dayStart` reads the
 * day back by slicing the UTC date). Deputy hands us a clock-in *instant*, and
 * for a weekend MORNING shift the Sydney day and the UTC day differ — Saturday
 * 8am in Sydney is Friday 10pm UTC. Storing the raw instant let the award-rate
 * classifier (dayRateKind, off the UTC weekday) bill Saturday mornings at the
 * ordinary weekday rate and Sunday mornings at the Saturday rate: systematic
 * weekend underpayment on exactly the staff the weekend rates exist for. So
 * the import pins the day in the VENUE's zone first.
 *
 * Pure and tested (deputy-timesheet.test.ts): this decides what people are
 * paid.
 */
import { venueDayKey, VENUE_TIME_ZONE } from '@alma/shared';

export type DeputyTimesheetFields = {
  StartTime?: number;
  EndTime?: number;
  Mealbreak?: number | string;
  TotalTime?: number | string;
  IsLeave?: boolean | number;
  LeaveRule?: number | null;
};

export function deputyIsLeave(ts: DeputyTimesheetFields): boolean {
  return Boolean(ts.IsLeave) || ts.LeaveRule != null;
}

/** Seconds only when the value actually looks like a number — never a date. */
function mealbreakSecondsToMinutes(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value / 60));
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    return Math.max(0, Math.round(Number(value.trim()) / 60));
  }
  return 0;
}

export function deputyBreakMinutes(ts: DeputyTimesheetFields): number {
  if (deputyIsLeave(ts)) return 0;

  const elapsedMinutes =
    typeof ts.StartTime === 'number' && typeof ts.EndTime === 'number' && ts.EndTime > ts.StartTime
      ? (ts.EndTime - ts.StartTime) / 60
      : null;
  const paidHours = typeof ts.TotalTime === 'number' ? ts.TotalTime : Number(ts.TotalTime);

  if (elapsedMinutes !== null && Number.isFinite(paidHours) && paidHours > 0) {
    // Deputy's paid hours already exclude the unpaid break, so the break is
    // whatever is left of the span. Clamped: a TotalTime at or above the
    // span (fully paid, or rounding noise) means no unpaid break.
    const breakMinutes = Math.round(elapsedMinutes - paidHours * 60);
    return Math.min(Math.max(0, breakMinutes), Math.round(elapsedMinutes));
  }

  return mealbreakSecondsToMinutes(ts.Mealbreak);
}

/**
 * The calendar day a clock-in instant belongs to, in the venue's zone, stored
 * as UTC-midnight of that day — the canonical `workDate` form. Pinning the day
 * in Sydney (not UTC) is what keeps a Saturday-morning shift on the Saturday
 * award rate instead of Friday's ordinary rate.
 */
export function deputyWorkDate(clockInAt: Date, timeZone = VENUE_TIME_ZONE): Date {
  return new Date(`${venueDayKey(clockInAt, timeZone)}T00:00:00.000Z`);
}
