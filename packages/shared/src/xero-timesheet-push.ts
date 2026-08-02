/**
 * Turning Alma's approved timesheets into Xero AU payroll timesheets.
 *
 * Xero does not accept "here are some hours". It accepts one timesheet per
 * employee per *pay period*, where the period boundaries are dictated by the
 * payroll calendar that employee is on, and the hours arrive as a flat array
 * of numbers — one entry per day from the period's start date to its end,
 * inclusive, with zeros for days not worked. Get the array length or the
 * period boundaries wrong and Xero rejects the whole timesheet.
 *
 * All of that is arithmetic, so it lives here where it can be tested without
 * a Xero connection.
 */

/** The Xero AU payroll calendar types that can carry a timesheet. */
export type XeroCalendarType =
  | 'WEEKLY'
  | 'FORTNIGHTLY'
  | 'FOURWEEKLY'
  | 'MONTHLY'
  | 'TWICEMONTHLY'
  | 'QUARTERLY'
  | 'ANNUAL';

/** How many days one period of each calendar type spans. */
const PERIOD_DAYS: Partial<Record<XeroCalendarType, number>> = {
  WEEKLY: 7,
  FORTNIGHTLY: 14,
  FOURWEEKLY: 28
};

export type PayPeriod = {
  /** Inclusive first day, as YYYY-MM-DD. */
  start: string;
  /** Inclusive last day, as YYYY-MM-DD. */
  end: string;
  /** Days in the period — the exact length Xero expects NumberOfUnits to be. */
  days: number;
};

/** YYYY-MM-DD for a date, read in UTC so a timezone never shifts the day. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC on the given calendar day — the canonical form used here. */
export function dayStart(value: Date | string): Date {
  const iso = typeof value === 'string' ? value.slice(0, 10) : isoDay(value);
  return new Date(`${iso}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Whole days between two calendar days, ignoring any time component. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((dayStart(to).getTime() - dayStart(from).getTime()) / 86_400_000);
}

/**
 * The pay period containing `workDate`, for a calendar that started on
 * `calendarStart` and repeats every N days.
 *
 * Xero's PayrollCalendar gives a StartDate and a CalendarType; every period
 * after that is a fixed stride from it. Anchoring on the calendar's own start
 * — rather than, say, the Monday of the week — is what makes the boundaries
 * match what Xero will accept, including for a fortnightly calendar whose
 * weeks are offset from ours.
 *
 * Returns null for calendar types that don't have a fixed day stride
 * (monthly and longer), which timesheets in practice never use.
 */
export function payPeriodFor(
  workDate: Date | string,
  calendarStart: Date | string,
  calendarType: string
): PayPeriod | null {
  const stride = PERIOD_DAYS[calendarType.toUpperCase() as XeroCalendarType];
  if (!stride) return null;

  const anchor = dayStart(calendarStart);
  const target = dayStart(workDate);
  const offset = daysBetween(anchor, target);
  // Floor, not truncate: a work date before the calendar's start date still
  // lands in a whole period, just a negative-indexed one.
  const index = Math.floor(offset / stride);
  const start = addDays(anchor, index * stride);
  return { start: isoDay(start), end: isoDay(addDays(start, stride - 1)), days: stride };
}

/** One approved shift, reduced to the two things a Xero line needs. */
export type PushableEntry = {
  /** The day worked. Time component is ignored. */
  workDate: Date | string;
  /** Paid hours for that day, breaks already deducted. */
  hours: number;
};

/**
 * The NumberOfUnits array for a period: hours per day, start to end inclusive.
 *
 * Two shifts on one day sum into that day's entry, because Xero carries one
 * number per day and splitting them would be a second timesheet line for the
 * same earnings rate — which Xero rejects.
 *
 * Hours are rounded to two decimals. Xero stores four, but a raw float from
 * millisecond arithmetic produces values like 7.999999999999999 that read as
 * wrong on a payslip.
 */
export function unitsForPeriod(entries: PushableEntry[], period: PayPeriod): number[] {
  const units = new Array<number>(period.days).fill(0);
  const start = dayStart(period.start);
  for (const entry of entries) {
    const index = daysBetween(start, dayStart(entry.workDate));
    if (index < 0 || index >= period.days) continue;
    units[index] = (units[index] ?? 0) + entry.hours;
  }
  return units.map((value) => Math.round(value * 100) / 100);
}

/** Whether a period has any hours worth sending. */
export function hasHours(units: number[]): boolean {
  return units.some((value) => value > 0);
}

/** Paid hours for one shift: worked time less the unpaid break. */
export function entryHours(entry: { clockInAt: Date; clockOutAt: Date; breakMinutes: number }): number {
  return Math.max(0, (entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / 36e5 - entry.breakMinutes / 60);
}

/**
 * Group entries into the pay periods they belong to.
 *
 * A selected week can straddle two Xero periods — the buyer of this feature
 * picks a week in Alma, but a fortnightly calendar cuts wherever it likes —
 * so one push for one employee can legitimately produce two timesheets.
 */
export function groupIntoPeriods<T extends PushableEntry>(
  entries: T[],
  calendarStart: Date | string,
  calendarType: string
): Array<{ period: PayPeriod; entries: T[] }> {
  const buckets = new Map<string, { period: PayPeriod; entries: T[] }>();
  for (const entry of entries) {
    const period = payPeriodFor(entry.workDate, calendarStart, calendarType);
    if (!period) continue;
    const bucket = buckets.get(period.start);
    if (bucket) bucket.entries.push(entry);
    else buckets.set(period.start, { period, entries: [entry] });
  }
  return [...buckets.values()].sort((a, b) => a.period.start.localeCompare(b.period.start));
}

/**
 * Xero's payroll dates are .NET `/Date(ms)/` strings on the way in as well as
 * out. It also accepts plain YYYY-MM-DD on POST, which is what we send — but
 * it hands back the .NET form, so reading a date it returned needs this.
 */
export function parseXeroDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const dotNet = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(value);
  if (dotNet) return new Date(Number(dotNet[1]));
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** Per-employee outcome of a push, as reported back to the manager. */
export type XeroTimesheetPushRow = {
  employee: string;
  staffProfileId: string | null;
  status: 'pushed' | 'skipped' | 'failed';
  message: string;
  hours: number;
  periodStart: string | null;
  periodEnd: string | null;
  xeroTimesheetId: string | null;
};

export type XeroTimesheetPushResult = {
  /** Xero timesheets successfully created. */
  pushed: number;
  /** Employees whose push failed, with the reason on their row. */
  failed: number;
  /** Employees with nothing to send in the window. */
  skipped: number;
  /** Alma timesheet rows marked exported off the back of this push. */
  markedExported: number;
  results: XeroTimesheetPushRow[];
  warnings: string[];
};
