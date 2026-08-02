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

/**
 * Which award rate a day's hours belong on.
 *
 * Hospitality awards pay a different rate on weekends, and Xero models that as
 * separate earnings rates rather than a loading — so the hours have to be split
 * across several timesheet lines, one per rate. Sending everything on the
 * ordinary rate underpays every weekend shift.
 *
 * Public holidays are a fourth rate that this cannot detect: the date alone
 * doesn't say whether it was a holiday, and a wrong guess is a payroll error.
 * They stay on the weekday rate and the push warns when an employee has a
 * public-holiday rate available, so someone checks the draft in Xero.
 */
export type DayRateKind = 'weekday' | 'saturday' | 'sunday';

/** The kind of day a YYYY-MM-DD falls on, read in UTC. */
export function dayRateKind(day: Date | string): DayRateKind {
  const weekday = dayStart(day).getUTCDay();
  if (weekday === 6) return 'saturday';
  if (weekday === 0) return 'sunday';
  return 'weekday';
}

/**
 * One NumberOfUnits array per rate kind, each the full length of the period
 * with zeros on the days that belong to a different rate. Xero wants a line
 * per earnings rate, and every line spans the whole period.
 */
export function splitUnitsByDay(
  entries: PushableEntry[],
  period: PayPeriod
): Record<DayRateKind, number[]> {
  const start = dayStart(period.start);
  const out: Record<DayRateKind, number[]> = {
    weekday: new Array<number>(period.days).fill(0),
    saturday: new Array<number>(period.days).fill(0),
    sunday: new Array<number>(period.days).fill(0)
  };
  for (const entry of entries) {
    const index = Math.floor((dayStart(entry.workDate).getTime() - start.getTime()) / 86_400_000);
    if (index < 0 || index >= period.days) continue;
    const bucket = out[dayRateKind(entry.workDate)];
    bucket[index] = (bucket[index] ?? 0) + entry.hours;
  }
  for (const kind of ['weekday', 'saturday', 'sunday'] as DayRateKind[]) {
    out[kind] = out[kind]!.map((value) => Math.round(value * 100) / 100);
  }
  return out;
}

/**
 * Classify a Xero earnings rate by its name.
 *
 * Every one of these is ORDINARYTIMEEARNINGS to Xero — the award distinction
 * lives only in the name a payroll admin typed ("Casual F&B Gr2 Saturday").
 * That makes name matching the only signal available, so it is deliberately
 * narrow: anything it doesn't recognise stays on the weekday rate rather than
 * being guessed onto a penalty rate.
 */
export function classifyEarningsRateName(name: string | undefined | null): DayRateKind | 'publicHoliday' | null {
  const text = (name ?? '').toLowerCase();
  if (!text) return null;
  if (/public\s*hol|\bph\b/.test(text)) return 'publicHoliday';
  if (/saturday|\bsat\b/.test(text)) return 'saturday';
  if (/sunday|\bsun\b/.test(text)) return 'sunday';
  if (/weekday|ordinary|monday|mon\s*[-–]\s*fri/.test(text)) return 'weekday';
  return null;
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
