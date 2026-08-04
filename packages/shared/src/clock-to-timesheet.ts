import { venueDayKey } from './venue-day.js';

/**
 * Turning a finished clock session into a timesheet.
 *
 * This was the missing link between the two halves of the staff app. Somebody
 * could clock on and off from their phone — the session recorded the times, the
 * breaks, the venue and the role — and nothing ever became a timesheet, so the
 * hours never reached payroll. Measured in production: 209 Alma-native
 * timesheets, of which **zero** corresponded to a clock session. Every one came
 * from the Deputy sync or was typed in by hand. That is the reason Deputy still
 * runs.
 *
 * The arithmetic lives here, pure and tested, because it decides what somebody
 * gets paid.
 */

export type FinishedClockSession = {
  id: string;
  staffProfileId: string;
  rosterShiftId: string | null;
  venue: string | null;
  area: string | null;
  roleTitle: string | null;
  clockInAt: Date;
  clockOutAt: Date | null;
  /** Minutes on break, already totalled when the session closed. */
  accumulatedBreakMinutes: number;
  managerNote?: string | null;
};

export type TimesheetDraft = {
  clockSessionId: string;
  staffProfileId: string;
  rosterShiftId: string | null;
  venue: string | null;
  area: string | null;
  roleTitle: string | null;
  /** The venue day the shift *started*, not the UTC date. See below. */
  workDate: Date;
  clockInAt: Date;
  clockOutAt: Date;
  breakMinutes: number;
  /** Paid hours: elapsed time less break, rounded to two decimals. */
  hours: number;
  notes: string | null;
};

/** A session that cannot become a timesheet, and why. */
export type TimesheetRejection = { reason: string };

/**
 * The longest a single session can be before it is more likely a forgotten
 * clock-out than a real shift.
 *
 * Sixteen hours covers a genuinely brutal double; beyond that, somebody went
 * home without clocking off. Converting those silently would put a 30-hour
 * shift on a payslip.
 */
export const MAX_SESSION_HOURS = 16;

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

/**
 * Build the timesheet a finished session should produce.
 *
 * Returns a rejection rather than throwing, so a caller closing a session can
 * record the refusal and still let the person clock off — never trap somebody
 * on shift because the paperwork disagreed with them.
 */
export function timesheetFromClockSession(
  session: FinishedClockSession,
  options: { timeZone?: string } = {}
): { draft: TimesheetDraft } | { rejected: TimesheetRejection } {
  const { clockInAt, clockOutAt } = session;
  if (!clockOutAt) {
    return { rejected: { reason: 'The session is still open.' } };
  }
  if (clockOutAt.getTime() <= clockInAt.getTime()) {
    return { rejected: { reason: 'Clock-out is not after clock-in.' } };
  }

  const elapsedHours = hoursBetween(clockInAt, clockOutAt);
  if (elapsedHours > MAX_SESSION_HOURS) {
    return {
      rejected: {
        reason: `${elapsedHours.toFixed(1)} hours is longer than a shift can be — this looks like a missed clock-out. A manager needs to correct it.`
      }
    };
  }

  // Break can equal the shift (a session opened and closed around a break) but
  // never exceed it, or the paid hours go negative.
  const breakMinutes = Math.max(0, Math.min(session.accumulatedBreakMinutes || 0, Math.floor(elapsedHours * 60)));
  const hours = Math.max(0, Math.round((elapsedHours - breakMinutes / 60) * 100) / 100);

  // The venue day the shift STARTED. A close at 1am belongs to the night that
  // began at 6pm, not to the calendar date it happened to finish on — payroll
  // weeks and penalty rates are worked out from the day worked.
  const dayKey = venueDayKey(clockInAt, options.timeZone);
  const workDate = new Date(`${dayKey}T00:00:00.000Z`);

  return {
    draft: {
      clockSessionId: session.id,
      staffProfileId: session.staffProfileId,
      rosterShiftId: session.rosterShiftId,
      venue: session.venue,
      area: session.area,
      roleTitle: session.roleTitle,
      workDate,
      clockInAt,
      clockOutAt,
      breakMinutes,
      hours,
      notes: session.managerNote?.trim() || null
    }
  };
}
