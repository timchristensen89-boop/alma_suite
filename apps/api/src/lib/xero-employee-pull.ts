// Turning a Xero Payroll employee record into "here is what differs from the
// profile" — pure, so the same rules that decide what a manager is shown are
// the ones the tests exercise. Covered by xero-employee-pull.test.ts.
//
// The rules worth stating out loud, because each one is a way this could
// quietly corrupt a staff record:
//
//  - A field Xero has NOTHING for is not offered at all. An empty payroll
//    record must never be able to blank out what the profile knows.
//  - Standard hours are stated per PAY PERIOD, so they mean nothing until the
//    calendar's cycle is known. 76 hours is 38 a week on a fortnightly
//    calendar and 76 on a weekly one, and writing the wrong one turns a normal
//    contract into a doubled one that the labour report then measures against.
//  - "NSW" and "New South Wales" are the same state. Without folding them the
//    address would present itself as a change on every single pull.
//  - Tax file numbers, bank accounts and super memberships never appear here.
//    They travel outward only, and Xero masks the TFN it hands back, so
//    "pulling" it would replace a real number with asterisks.

/** Xero AU payroll wants the state as a code — "New South Wales" comes back as
 * "Invalid Region", which is not a phrase anyone would connect to a state
 * field. Staff type it however they like, so normalise both directions. */
const AU_STATE_CODES: Record<string, string> = {
  'new south wales': 'NSW', nsw: 'NSW',
  victoria: 'VIC', vic: 'VIC',
  queensland: 'QLD', qld: 'QLD',
  'south australia': 'SA', sa: 'SA',
  'western australia': 'WA', wa: 'WA',
  tasmania: 'TAS', tas: 'TAS',
  'northern territory': 'NT', nt: 'NT',
  'australian capital territory': 'ACT', act: 'ACT'
};

export function auStateCode(value: string | null | undefined): string | undefined {
  const key = (value ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return AU_STATE_CODES[key] ?? value?.trim().toUpperCase().slice(0, 3);
}

/** Weeks in one pay period, by Xero's calendar type. */
const PAY_PERIOD_WEEKS: Record<string, number> = {
  WEEKLY: 1,
  FORTNIGHTLY: 2,
  FOURWEEKLY: 4,
  TWICEMONTHLY: 52 / 24,
  MONTHLY: 52 / 12,
  QUARTERLY: 13,
  YEARLY: 52,
  ANNUALLY: 52
};

export function payPeriodWeeks(calendarType: string | null | undefined): number | null {
  const key = (calendarType ?? '').trim().toUpperCase();
  if (!key) return null;
  return PAY_PERIOD_WEEKS[key] ?? null;
}

/** Xero's employment basis codes in the words the profile's own dropdown uses.
 * LABOURHIRE and SUPERINCOMESTREAM have no equivalent here, so they are left
 * off rather than mapped to something close but wrong. */
const EMPLOYMENT_BASIS: Record<string, string> = {
  FULLTIME: 'Full-time',
  PARTTIME: 'Part-time',
  CASUAL: 'Casual'
};

export function employmentTypeFromBasis(basis: string | null | undefined): string | null {
  return EMPLOYMENT_BASIS[(basis ?? '').trim().toUpperCase()] ?? null;
}

export type XeroEarningsLine = {
  EarningsRateID?: string;
  EarningsType?: string;
  RatePerUnit?: number;
  NormalNumberOfUnits?: number;
};

export type XeroEmployeeDetail = {
  EmployeeID?: string;
  FirstName?: string;
  LastName?: string;
  Status?: string;
  Email?: string;
  Phone?: string;
  Mobile?: string;
  DateOfBirth?: string;
  StartDate?: string;
  TerminationDate?: string;
  PayrollCalendarID?: string;
  OrdinaryEarningsRateID?: string;
  HomeAddress?: {
    AddressLine1?: string;
    AddressLine2?: string;
    City?: string;
    Region?: string;
    PostalCode?: string;
  };
  PayTemplate?: { EarningsLines?: XeroEarningsLine[] };
  TaxDeclaration?: { EmploymentBasis?: string; TaxFileNumber?: string };
  BankAccounts?: unknown[];
  SuperMemberships?: unknown[];
  LeaveBalances?: Array<{ LeaveName?: string; NumberOfUnits?: number; TypeOfUnits?: string }>;
};

/** The line their ordinary hours are paid against: the one the employee record
 * names, else the one typed as ordinary time, else the first. */
export function ordinaryEarningsLine(employee: XeroEmployeeDetail): XeroEarningsLine | undefined {
  const lines = employee.PayTemplate?.EarningsLines ?? [];
  return (
    (employee.OrdinaryEarningsRateID
      ? lines.find((line) => line.EarningsRateID === employee.OrdinaryEarningsRateID)
      : undefined) ??
    lines.find((line) => line.EarningsType === 'ORDINARYTIMEEARNINGS') ??
    lines[0]
  );
}

/** Hours a week, from hours a pay period. Null when either half is unknown —
 * a guessed contract is worse than no contract. */
export function weeklyHours(unitsPerPeriod: number | null | undefined, periodWeeks: number | null): number | null {
  if (typeof unitsPerPeriod !== 'number' || !Number.isFinite(unitsPerPeriod) || unitsPerPeriod <= 0) return null;
  if (!periodWeeks || periodWeeks <= 0) return null;
  return Math.round(unitsPerPeriod / periodWeeks);
}

export type XeroPullField = {
  key: string;
  label: string;
  current: string | null;
  incoming: string | null;
  differs: boolean;
  /** Ticked by default. False for the ones a manager should look at first — a
   * login address, or a Xero rate for someone who is paid outside Xero. */
  recommended: boolean;
  note?: string;
  /** What would actually be written. Never sent to the browser. */
  value: Date | string | number | null;
};

/** The profile columns this reads. Narrow on purpose: anything not listed here
 * cannot be touched by a pull. */
export type PullableProfile = {
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  startDate: Date | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  employmentType: string | null;
  contractedWeeklyHours: number | null;
  payRateCents: number | null;
  xeroPayrollCalendarId: string | null;
  xeroEarningsRateId: string | null;
};

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isoDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function money(cents: number | null | undefined): string | null {
  return cents === null || cents === undefined ? null : `$${(cents / 100).toFixed(2)}`;
}

export function buildXeroPullFields(input: {
  profile: PullableProfile;
  employee: XeroEmployeeDetail;
  /** Already parsed by the caller — Xero hands dates back in more than one shape. */
  dates: { dateOfBirth: Date | null; startDate: Date | null };
  periodWeeks: number | null;
  calendarName: string | null;
  tenantName: string | null;
  /** Paid outside Xero (manual salary or cash), so its rate is not their pay. */
  manualPay: boolean;
}): XeroPullField[] {
  const { profile, employee, dates, periodWeeks, calendarName, tenantName, manualPay } = input;
  const fields: XeroPullField[] = [];

  function offer(field: {
    key: string;
    label: string;
    current: string | null;
    incoming: string | null;
    value: Date | string | number | null;
    /** Overrides the string comparison where two spellings mean one thing. */
    same?: boolean;
    recommended?: boolean;
    note?: string;
  }) {
    if (field.incoming === null) return;
    const differs = field.same === true ? false : field.incoming !== field.current;
    fields.push({
      key: field.key,
      label: field.label,
      current: field.current,
      incoming: field.incoming,
      differs,
      recommended: differs && (field.recommended ?? true),
      note: field.note,
      value: field.value
    });
  }

  offer({
    key: 'dateOfBirth',
    label: 'Date of birth',
    current: isoDateOnly(profile.dateOfBirth),
    incoming: isoDateOnly(dates.dateOfBirth),
    value: dates.dateOfBirth
  });
  offer({
    key: 'startDate',
    label: 'Start date',
    current: isoDateOnly(profile.startDate),
    incoming: isoDateOnly(dates.startDate),
    value: dates.startDate
  });

  const phone = text(employee.Mobile) ?? text(employee.Phone);
  offer({ key: 'phone', label: 'Phone', current: profile.phone, incoming: phone, value: phone });

  const email = text(employee.Email);
  offer({
    key: 'email',
    label: 'Email',
    current: profile.email,
    incoming: email,
    value: email,
    recommended: false,
    note: 'This is also how they sign in — changing it changes their login.'
  });

  const address = employee.HomeAddress ?? {};
  const line1 = text(address.AddressLine1);
  offer({ key: 'addressLine1', label: 'Street address', current: profile.addressLine1, incoming: line1, value: line1 });
  const line2 = text(address.AddressLine2);
  offer({ key: 'addressLine2', label: 'Address line 2', current: profile.addressLine2, incoming: line2, value: line2 });
  const suburb = text(address.City);
  offer({ key: 'suburb', label: 'Suburb', current: profile.suburb, incoming: suburb, value: suburb });
  const state = text(address.Region);
  offer({
    key: 'state',
    label: 'State',
    current: profile.state,
    incoming: state,
    value: state,
    same: state !== null && auStateCode(profile.state) === auStateCode(state)
  });
  const postcode = text(address.PostalCode);
  offer({ key: 'postcode', label: 'Postcode', current: profile.postcode, incoming: postcode, value: postcode });

  const basis = employmentTypeFromBasis(employee.TaxDeclaration?.EmploymentBasis);
  offer({ key: 'employmentType', label: 'Employment type', current: profile.employmentType, incoming: basis, value: basis });

  const ordinary = ordinaryEarningsLine(employee);
  const units = typeof ordinary?.NormalNumberOfUnits === 'number' ? ordinary.NormalNumberOfUnits : null;
  const hours = weeklyHours(units, periodWeeks);
  offer({
    key: 'contractedWeeklyHours',
    label: 'Contracted hours a week',
    current: profile.contractedWeeklyHours === null ? null : `${profile.contractedWeeklyHours} h`,
    incoming: hours === null ? null : `${hours} h`,
    value: hours,
    note: hours === null ? undefined : `${units} hours a pay period on the ${calendarName ?? 'payroll'} calendar.`
  });

  const rateCents =
    typeof ordinary?.RatePerUnit === 'number' && ordinary.RatePerUnit > 0 ? Math.round(ordinary.RatePerUnit * 100) : null;
  offer({
    key: 'payRateCents',
    label: 'Base rate an hour',
    current: money(profile.payRateCents),
    incoming: money(rateCents),
    value: rateCents,
    recommended: !manualPay,
    note: manualPay ? 'They are paid outside Xero, so this is not what they actually get.' : undefined
  });

  const calendarId = text(employee.PayrollCalendarID);
  offer({
    key: 'xeroPayrollCalendarId',
    label: 'Payroll calendar ID',
    current: profile.xeroPayrollCalendarId,
    incoming: calendarId,
    value: calendarId,
    note: calendarName ? `${calendarName} in ${tenantName ?? 'Xero'}.` : undefined
  });
  const earningsRateId = text(employee.OrdinaryEarningsRateID);
  offer({
    key: 'xeroEarningsRateId',
    label: 'Ordinary earnings rate ID',
    current: profile.xeroEarningsRateId,
    incoming: earningsRateId,
    value: earningsRateId,
    note: 'The timesheet export sends hours against this rate.'
  });

  return fields;
}

/** Turn the keys a manager ticked into the columns to write. Anything not in
 * `fields`, or already the same on both sides, is refused rather than written:
 * the browser sends keys, and only what this code just read from Xero can
 * reach a profile. */
export function selectPullFields(
  fields: XeroPullField[],
  wanted: string[]
): {
  data: Record<string, Date | string | number | null>;
  applied: Array<{ key: string; label: string; value: string | null }>;
  skipped: Array<{ key: string; why: string }>;
} {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const data: Record<string, Date | string | number | null> = {};
  const applied: Array<{ key: string; label: string; value: string | null }> = [];
  const skipped: Array<{ key: string; why: string }> = [];
  // Deduplicated, because a repeated key in the body is a mistake, not a
  // reason to report the same change twice.
  for (const key of [...new Set(wanted)]) {
    const field = byKey.get(key);
    if (!field) {
      skipped.push({ key, why: 'Xero has nothing for that field.' });
      continue;
    }
    if (!field.differs) {
      skipped.push({ key, why: 'Already the same on both sides.' });
      continue;
    }
    data[key] = field.value;
    applied.push({ key, label: field.label, value: field.incoming });
  }
  return { data, applied, skipped };
}
