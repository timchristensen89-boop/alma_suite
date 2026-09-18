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
//  - Bank account, super membership and tax settings DO come back — payroll is
//    where those are kept current, and a person who already exists in one
//    company's payroll should not have to be typed in again for the other.
//    Account numbers are masked before they reach the browser; the apply
//    re-reads Xero and writes the real digits itself.
//  - The tax file number is the one exception. Xero masks it in every
//    response ("***-***-234"), so "pulling" it would replace a real number
//    with asterisks. It is reported as held, never offered.

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

/** The other direction: the profile's employment type as Xero's basis code.
 * "Salaried" is a full-time arrangement here. Anything unrecognised is null so
 * the caller can fall back to what Xero already holds rather than guess. */
export function employmentBasisFromType(
  employmentType: string | null | undefined
): 'FULLTIME' | 'PARTTIME' | 'CASUAL' | null {
  const key = (employmentType ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return null;
  if (key.startsWith('full') || key === 'salaried' || key === 'salary') return 'FULLTIME';
  if (key.startsWith('part')) return 'PARTTIME';
  if (key.startsWith('casual')) return 'CASUAL';
  return null;
}

// ── Tax residency ──────────────────────────────────────────────────────────
// The profile stores residency as free text and four spellings of "Australian
// resident for tax purposes" exist in production. Both directions go through
// one code so "An Australian resident for tax purposes" and AUSTRALIANRESIDENT
// never present themselves as a change.

export type ResidencyCode = 'AUSTRALIANRESIDENT' | 'FOREIGNRESIDENT' | 'WORKINGHOLIDAYMAKER';

export const RESIDENCY_LABELS: Record<ResidencyCode, string> = {
  AUSTRALIANRESIDENT: 'Australian resident for tax purposes',
  FOREIGNRESIDENT: 'Foreign resident for tax purposes',
  WORKINGHOLIDAYMAKER: 'Working holiday maker'
};

export function residencyCode(value: string | null | undefined): ResidencyCode | null {
  const key = (value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!key) return null;
  if (key.includes('workingholiday')) return 'WORKINGHOLIDAYMAKER';
  if (key.includes('foreign') || key.includes('nonresident') || key.includes('notaresident')) return 'FOREIGNRESIDENT';
  if (key.includes('australian') || key.includes('resident')) return 'AUSTRALIANRESIDENT';
  return null;
}

export type XeroTaxDeclaration = {
  TaxFileNumber?: string;
  TFNExemptionType?: string;
  EmploymentBasis?: string;
  AustralianResidentForTaxPurposes?: boolean;
  ResidencyStatus?: string;
  TaxScaleType?: string;
  TaxFreeThresholdClaimed?: boolean;
  // The STP Phase 2 flag, and the four it replaced. Old records still carry
  // the old ones, so a pull reads all five.
  HasLoanOrStudentDebt?: boolean;
  HasHELPDebt?: boolean;
  HasSFSSDebt?: boolean;
  HasTradeSupportLoanDebt?: boolean;
  HasStudentStartupLoan?: boolean;
  EligibleToReceiveLeaveLoading?: boolean;
  UpdatedDateUTC?: string;
};

/** What Xero says about residency, as the profile's canonical label. The
 * STP2 income type outranks the deprecated WORKINGHOLIDAYMAKER residency
 * value, and the old boolean is the fallback for records never migrated. */
export function residencyFromXero(employee: {
  TaxDeclaration?: XeroTaxDeclaration;
  IncomeType?: string;
}): ResidencyCode | null {
  const declaration = employee.TaxDeclaration ?? {};
  if ((employee.IncomeType ?? '').toUpperCase() === 'WORKINGHOLIDAYMAKER') return 'WORKINGHOLIDAYMAKER';
  if ((declaration.TaxScaleType ?? '').toUpperCase() === 'WORKINGHOLIDAYMAKER') return 'WORKINGHOLIDAYMAKER';
  const coded = residencyCode(declaration.ResidencyStatus);
  if (coded) return coded;
  if (declaration.AustralianResidentForTaxPurposes === true) return 'AUSTRALIANRESIDENT';
  if (declaration.AustralianResidentForTaxPurposes === false) return 'FOREIGNRESIDENT';
  return null;
}

/** Whether Xero has a study or training loan recorded. Null when the record
 * says nothing either way, so an old record cannot clear a flag here. */
export function studyLoanFromXero(declaration: XeroTaxDeclaration | undefined): boolean | null {
  if (!declaration) return null;
  const flags = [
    declaration.HasLoanOrStudentDebt,
    declaration.HasHELPDebt,
    declaration.HasSFSSDebt,
    declaration.HasTradeSupportLoanDebt,
    declaration.HasStudentStartupLoan
  ].filter((flag): flag is boolean => typeof flag === 'boolean');
  if (flags.length === 0) return null;
  return flags.some(Boolean);
}

export type XeroBankAccount = {
  StatementText?: string;
  AccountName?: string;
  BSB?: string;
  AccountNumber?: string;
  Remainder?: boolean;
  Amount?: number;
};

export type XeroSuperMembership = {
  SuperMembershipID?: string;
  SuperFundID?: string;
  EmployeeNumber?: string;
};

export type XeroSuperFund = {
  SuperFundID?: string;
  Name?: string;
  Type?: string;
  ABN?: string;
  USI?: string;
  EmployerNumber?: string;
};

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
  IncomeType?: string;
  EmploymentType?: string;
  IsSTP2Qualified?: boolean;
  HomeAddress?: {
    AddressLine1?: string;
    AddressLine2?: string;
    City?: string;
    Region?: string;
    PostalCode?: string;
  };
  PayTemplate?: { EarningsLines?: XeroEarningsLine[] };
  TaxDeclaration?: XeroTaxDeclaration;
  BankAccounts?: XeroBankAccount[];
  SuperMemberships?: XeroSuperMembership[];
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

// ── Bank and super ─────────────────────────────────────────────────────────

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/** The account their pay lands in. Xero allows several with fixed amounts
 * split off; the one marked Remainder takes the balance and is "their"
 * account for any purpose here. */
export function payingBankAccount(accounts: XeroBankAccount[] | undefined): XeroBankAccount | undefined {
  const usable = (accounts ?? []).filter((account) => digitsOnly(account.BSB) && digitsOnly(account.AccountNumber));
  return usable.find((account) => account.Remainder === true) ?? usable[0];
}

/** "062000" → "062-000". A BSB is a branch code, not a secret. */
export function formatBsb(value: string | null | undefined): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
}

/** Everything but the last three digits, for the screen. */
export function maskDigits(value: string | null | undefined): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;
  if (digits.length <= 3) return '•'.repeat(digits.length);
  return `${'•'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}

/** Regulated funds are listed by USI, and most Australian USIs are the fund's
 * ABN plus a three-digit product suffix ("68657495890003" is HOSTPLUS,
 * ABN 68 657 495 890). Legacy SPIN-style codes ("HOS0100AU") say nothing
 * about the ABN. */
export function abnFromUsi(usi: string | null | undefined): string | null {
  const text = (usi ?? '').trim();
  return /^\d{14}$/.test(text) ? text.slice(0, 11) : null;
}

export function superFundAbn(fund: XeroSuperFund): string | null {
  return digitsOnly(fund.ABN) || abnFromUsi(fund.USI);
}

/** The fund behind their membership, from the organisation's fund list. */
export function resolveSuperFund(
  employee: Pick<XeroEmployeeDetail, 'SuperMemberships'>,
  funds: XeroSuperFund[] | null | undefined
): { fund: XeroSuperFund | null; memberNumber: string | null } | null {
  const membership = (employee.SuperMemberships ?? []).find((row) => row.SuperFundID) ?? employee.SuperMemberships?.[0];
  if (!membership) return null;
  const fund = (funds ?? []).find((row) => row.SuperFundID && row.SuperFundID === membership.SuperFundID) ?? null;
  const memberNumber = (membership.EmployeeNumber ?? '').trim() || null;
  return { fund, memberNumber };
}

function sameText(left: string | null, right: string | null): boolean {
  const fold = (value: string | null) => (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return fold(left) === fold(right);
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
  value: Date | string | number | boolean | null;
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
  taxResidencyStatus: string | null;
  taxFreeThreshold: boolean | null;
  hasStudyTrainingLoan: boolean | null;
  bankAccountName: string | null;
  bankBsb: string | null;
  bankAccountNumber: string | null;
  superFundName: string | null;
  superFundAbn: string | null;
  superFundUsi: string | null;
  superMemberNumber: string | null;
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

function yesNo(value: boolean | null | undefined): string | null {
  return value === null || value === undefined ? null : value ? 'Yes' : 'No';
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
  /** The organisation's super funds, so a membership's fund id becomes a
   * name, ABN and USI. Null when the caller could not read them. */
  superFunds?: XeroSuperFund[] | null;
}): XeroPullField[] {
  const { profile, employee, dates, periodWeeks, calendarName, tenantName, manualPay } = input;
  const fields: XeroPullField[] = [];

  function offer(field: {
    key: string;
    label: string;
    current: string | null;
    incoming: string | null;
    value: Date | string | number | boolean | null;
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
  offer({
    key: 'employmentType',
    label: 'Employment type',
    current: profile.employmentType,
    incoming: basis,
    value: basis,
    same: basis !== null && employmentBasisFromType(profile.employmentType) === employmentBasisFromType(basis)
  });

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

  // ── Tax settings. The TFN itself is deliberately absent: see the header. ──
  const declaration = employee.TaxDeclaration;
  const residency = residencyFromXero(employee);
  offer({
    key: 'taxResidencyStatus',
    label: 'Tax residency',
    current: profile.taxResidencyStatus,
    incoming: residency ? RESIDENCY_LABELS[residency] : null,
    value: residency ? RESIDENCY_LABELS[residency] : null,
    same: residency !== null && residencyCode(profile.taxResidencyStatus) === residency
  });
  const threshold = typeof declaration?.TaxFreeThresholdClaimed === 'boolean' ? declaration.TaxFreeThresholdClaimed : null;
  offer({
    key: 'taxFreeThreshold',
    label: 'Claims the tax-free threshold',
    current: yesNo(profile.taxFreeThreshold),
    incoming: yesNo(threshold),
    value: threshold
  });
  const loan = studyLoanFromXero(declaration);
  offer({
    key: 'hasStudyTrainingLoan',
    label: 'Study or training loan',
    current: yesNo(profile.hasStudyTrainingLoan),
    incoming: yesNo(loan),
    value: loan,
    note: 'HELP, VSL, SFSS or similar — Xero withholds extra when this is on.'
  });

  // ── Bank account: where their pay goes. ──
  const bank = payingBankAccount(employee.BankAccounts);
  const accountName = text(bank?.AccountName);
  offer({
    key: 'bankAccountName',
    label: 'Bank account name',
    current: profile.bankAccountName,
    incoming: accountName,
    value: accountName,
    same: accountName !== null && sameText(profile.bankAccountName, accountName)
  });
  const bsb = digitsOnly(bank?.BSB) || null;
  offer({
    key: 'bankBsb',
    label: 'BSB',
    current: formatBsb(profile.bankBsb),
    incoming: formatBsb(bsb),
    value: bsb,
    same: bsb !== null && digitsOnly(profile.bankBsb) === bsb
  });
  const accountNumber = digitsOnly(bank?.AccountNumber) || null;
  offer({
    key: 'bankAccountNumber',
    label: 'Bank account number',
    current: maskDigits(profile.bankAccountNumber),
    incoming: maskDigits(accountNumber),
    value: accountNumber,
    same: accountNumber !== null && digitsOnly(profile.bankAccountNumber) === accountNumber,
    note: 'Where Xero pays them. Only the last three digits are shown here.'
  });

  // ── Super: the membership's fund, named from the organisation's fund list. ──
  const membership = resolveSuperFund(employee, input.superFunds);
  const fund = membership?.fund ?? null;
  const fundName = text(fund?.Name);
  offer({
    key: 'superFundName',
    label: 'Super fund',
    current: profile.superFundName,
    incoming: fundName,
    value: fundName,
    same: fundName !== null && sameText(profile.superFundName, fundName),
    note: membership && !fund ? undefined : fund?.Type === 'SMSF' ? 'A self-managed fund.' : undefined
  });
  const fundAbn = fund ? superFundAbn(fund) : null;
  offer({
    key: 'superFundAbn',
    label: 'Super fund ABN',
    current: profile.superFundAbn,
    incoming: fundAbn,
    value: fundAbn,
    same: fundAbn !== null && digitsOnly(profile.superFundAbn) === fundAbn
  });
  const fundUsi = text(fund?.USI)?.toUpperCase() ?? null;
  offer({
    key: 'superFundUsi',
    label: 'Super fund USI',
    current: profile.superFundUsi,
    incoming: fundUsi,
    value: fundUsi,
    same: fundUsi !== null && (profile.superFundUsi ?? '').trim().toUpperCase() === fundUsi
  });
  const memberNumber = membership?.memberNumber ?? null;
  offer({
    key: 'superMemberNumber',
    label: 'Super member number',
    current: profile.superMemberNumber,
    incoming: memberNumber,
    value: memberNumber,
    same: memberNumber !== null && (profile.superMemberNumber ?? '').trim() === memberNumber
  });

  return fields;
}

/** Xero holds a tax file number it will not hand back. Worth saying when the
 * profile has none, because a push from here would otherwise strip the tax
 * declaration in the OTHER company and tax them at the no-TFN rate. */
export function taxFileNumberHeldNote(input: {
  firstName: string;
  tenantName: string | null;
  declaration: XeroTaxDeclaration | undefined;
  profileTaxFileNumber: string | null;
}): string | null {
  const held = (input.declaration?.TaxFileNumber ?? '').trim();
  if (!held) return null;
  if (digitsOnly(input.profileTaxFileNumber).length >= 8) return null;
  const tail = digitsOnly(held).slice(-3);
  return `${input.tenantName ?? 'Xero'} holds a tax file number for ${input.firstName}${
    tail ? ` ending in ${tail}` : ''
  } that Xero will not hand back — type it onto the profile from their TFN declaration before pushing them anywhere else.`;
}

/** Turn the keys a manager ticked into the columns to write. Anything not in
 * `fields`, or already the same on both sides, is refused rather than written:
 * the browser sends keys, and only what this code just read from Xero can
 * reach a profile. */
export function selectPullFields(
  fields: XeroPullField[],
  wanted: string[]
): {
  data: Record<string, Date | string | number | boolean | null>;
  applied: Array<{ key: string; label: string; value: string | null }>;
  skipped: Array<{ key: string; why: string }>;
} {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const data: Record<string, Date | string | number | boolean | null> = {};
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
