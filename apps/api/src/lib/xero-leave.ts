// Turning an approved Alma leave request into a Xero Payroll leave
// application — pure, so every judgement here is exercised by
// xero-leave.test.ts rather than by a live payroll.
//
// Why this exists at all: the timesheet push deliberately drops leave, because
// Xero pays leave through a leave application and sending the same days as
// ordinary hours pays them twice. That was correct, and it left leave reaching
// Xero by no route whatsoever — excluded, warned about, and dropped.
//
// The rules worth stating out loud, because each is a way this could quietly
// cost someone money:
//
//  - A leave type we cannot match in THAT company is refused, never guessed.
//    Xero's leave types are per-organisation, and posting annual leave against
//    a personal-leave type is a balance drawn from the wrong bucket.
//  - OTHER has no Xero equivalent and is always refused. It is the type people
//    pick when none of the others fit, which is exactly when a machine should
//    not choose for them.
//  - Hours per day are never invented. Without a figure we can defend, the
//    application is refused rather than posted with a plausible-looking
//    number — a wrong NumberOfUnits is a wrong leave balance and a wrong pay.
//  - Weekends are not leave. Someone off Friday to Monday takes two days, and
//    billing four is two days of annual leave they never asked for.

/** Alma's leave types, from staffLeaveTypeSchema. */
export type AlmaLeaveType = 'ANNUAL' | 'SICK' | 'PERSONAL' | 'UNPAID' | 'OTHER';

/** A leave type as Xero's PayItems endpoint returns it. */
export type XeroLeaveType = {
  LeaveTypeID?: string;
  Name?: string;
  /** 'Hours' or 'Days' — decides what NumberOfUnits means. */
  TypeOfUnits?: string;
};

/**
 * What each Alma type is called in Xero, best candidate first.
 *
 * Xero's AU defaults are "Annual Leave" and "Personal/Carer's Leave"; most
 * organisations keep those names, and the ones that don't tend to say "Sick
 * Leave". Matching is on the normalised name, so punctuation and case in
 * "Personal / Carer's Leave" do not matter.
 *
 * OTHER is deliberately absent.
 */
const LEAVE_TYPE_CANDIDATES: Record<Exclude<AlmaLeaveType, 'OTHER'>, string[]> = {
  ANNUAL: ['annual leave', 'annual holiday', 'holiday leave'],
  // Personal and sick are the same entitlement under the NES, and Xero AU
  // ships it as one type. Both Alma types look for it under either name.
  PERSONAL: ['personal carers leave', 'personal leave', 'sick leave', 'personal carer s leave'],
  SICK: ['personal carers leave', 'sick leave', 'personal leave', 'personal carer s leave'],
  UNPAID: ['unpaid leave', 'leave without pay']
};

/** Lower-case, letters and digits and single spaces — "Personal/Carer's" folds. */
export function normaliseLeaveName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type LeaveTypeMatch =
  | { ok: true; leaveTypeId: string; name: string; unitsAre: 'Hours' | 'Days' }
  | { ok: false; reason: string };

/**
 * Find the Xero leave type for an Alma leave type, in ONE organisation.
 *
 * Refuses rather than guesses. The caller turns `reason` into a warning that
 * names the company, so a manager knows what to add in Xero and where.
 */
export function matchLeaveType(
  type: AlmaLeaveType,
  available: XeroLeaveType[],
  tenantLabel: string
): LeaveTypeMatch {
  if (type === 'OTHER') {
    return {
      ok: false,
      reason: `"Other" leave has no Xero equivalent — set the request to annual, personal, sick or unpaid, or enter it in ${tenantLabel} by hand.`
    };
  }
  const usable = available.filter((row) => row.LeaveTypeID && row.Name);
  for (const candidate of LEAVE_TYPE_CANDIDATES[type]) {
    const found = usable.find((row) => normaliseLeaveName(row.Name) === candidate);
    if (found?.LeaveTypeID) {
      // Anything that isn't explicitly Days is treated as Hours, which is
      // Xero AU's default and the only one we can compute defensibly.
      const unitsAre = normaliseLeaveName(found.TypeOfUnits) === 'days' ? 'Days' : 'Hours';
      return { ok: true, leaveTypeId: found.LeaveTypeID, name: found.Name ?? '', unitsAre };
    }
  }
  const names = usable.map((row) => row.Name).filter(Boolean).join(', ');
  return {
    ok: false,
    reason:
      `No ${type.toLowerCase()} leave type in ${tenantLabel}` +
      (names ? ` — it has ${names}. Add one in Xero (Payroll → Pay Items → Leave), then push again.` : '. Add one in Xero (Payroll → Pay Items → Leave), then push again.')
  };
}

/**
 * Weekdays from start to end inclusive.
 *
 * Weekends are not leave. Someone off Friday to Monday takes two days; billing
 * four is two days of annual leave they never asked for. Public holidays are
 * NOT excluded — they vary by state and Xero holds the calendar, so a manager
 * shortens the request rather than this guessing.
 */
export function weekdaysBetween(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  let days = 0;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cursor.getTime() <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Ordinary hours in a working day, from the contracted week.
 *
 * Returns null when we have nothing to go on — a casual has no contracted
 * week, and inventing 7.6 for them is inventing a leave balance. The caller
 * refuses the push and says so.
 */
export function hoursPerDay(contractedWeeklyHours: number | null | undefined): number | null {
  if (contractedWeeklyHours === null || contractedWeeklyHours === undefined) return null;
  if (!Number.isFinite(contractedWeeklyHours) || contractedWeeklyHours <= 0) return null;
  // Over a five-day week, which is what the weekday count above assumes.
  return Math.round((contractedWeeklyHours / 5) * 10000) / 10000;
}

/**
 * The part of a leave request that falls inside one pay period.
 *
 * Leave reaches Xero alongside the week's timesheets, so a five-week absence
 * contributes five days to five separate pushes rather than arriving as one
 * application for the whole range. That matters for more than tidiness: a
 * single 28-day personal-leave application draws about three years of accrual
 * at once, and it is only ever obvious that a balance has run out at the week
 * it runs out.
 *
 * Returns null when the request does not touch the period at all.
 */
export function clipLeaveToPeriod(
  leave: { startDate: Date; endDate: Date },
  period: { start: Date; end: Date }
): { startDate: Date; endDate: Date } | null {
  const times = [leave.startDate, leave.endDate, period.start, period.end].map((d) => d.getTime());
  if (times.some((t) => Number.isNaN(t))) return null;
  if (leave.endDate < leave.startDate) return null;
  // `end` is exclusive, matching the timesheet push's `workDate < end`.
  if (period.end <= period.start) return null;
  const startMs = Math.max(leave.startDate.getTime(), period.start.getTime());
  // Step back one day off the exclusive end so both dates are inclusive, the
  // shape planLeaveApplication and Xero both want.
  const endMs = Math.min(leave.endDate.getTime(), period.end.getTime() - 86400000);
  if (endMs < startMs) return null;
  return { startDate: new Date(startMs), endDate: new Date(endMs) };
}

export type LeaveApplicationPlan =
  | {
      ok: true;
      leaveTypeId: string;
      leaveTypeName: string;
      unitsAre: 'Hours' | 'Days';
      days: number;
      /** What goes in NumberOfUnits. */
      units: number;
      startDate: string;
      endDate: string;
      title: string;
    }
  | { ok: false; reason: string };

const isoDay = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Everything needed to POST one leave application, or a reason not to.
 *
 * Nothing here talks to Xero: the caller has already fetched that company's
 * leave types and knows the employee's contracted week.
 */
export function planLeaveApplication(input: {
  type: AlmaLeaveType;
  status: string;
  startDate: Date;
  endDate: Date;
  contractedWeeklyHours: number | null | undefined;
  availableLeaveTypes: XeroLeaveType[];
  tenantLabel: string;
  staffName: string;
}): LeaveApplicationPlan {
  const { type, status, startDate, endDate, contractedWeeklyHours, availableLeaveTypes, tenantLabel, staffName } = input;

  if (status !== 'APPROVED') {
    return { ok: false, reason: `${staffName}'s leave is ${status.toLowerCase()}, not approved — only approved leave goes to payroll.` };
  }
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { ok: false, reason: `${staffName}'s leave has no usable dates.` };
  }
  if (endDate < startDate) {
    return { ok: false, reason: `${staffName}'s leave ends before it starts.` };
  }

  const matched = matchLeaveType(type, availableLeaveTypes, tenantLabel);
  if (!matched.ok) return { ok: false, reason: matched.reason };

  const days = weekdaysBetween(startDate, endDate);
  if (days === 0) {
    return { ok: false, reason: `${staffName}'s leave falls entirely on a weekend — nothing to pay.` };
  }

  let units = days;
  if (matched.unitsAre === 'Hours') {
    const perDay = hoursPerDay(contractedWeeklyHours);
    if (perDay === null) {
      return {
        ok: false,
        reason:
          `${tenantLabel} measures ${matched.name} in hours, and ${staffName} has no contracted weekly hours on their profile — ` +
          `set it, or enter this leave in Xero by hand. Guessing the hours would guess their leave balance.`
      };
    }
    units = Math.round(perDay * days * 100) / 100;
  }

  return {
    ok: true,
    leaveTypeId: matched.leaveTypeId,
    leaveTypeName: matched.name,
    unitsAre: matched.unitsAre,
    days,
    units,
    startDate: isoDay(startDate),
    endDate: isoDay(endDate),
    title: `${matched.name} — ${staffName}`
  };
}
