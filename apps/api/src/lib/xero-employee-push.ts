// ── What a push to Xero Payroll did NOT carry ──────────────────────────────
//
// Every payroll block on the employee body is conditional on the profile
// holding the data, so a profile with no bank, no TFN and no super pushes
// cleanly and silently sends none of them. Xero then taxes them at the no-TFN
// rate — roughly half their pay — and the push reports "created". That is how
// a push can succeed and still leave someone to be typed in by hand.
//
// Pure so the wording is testable without a Xero connection.
import {
  employmentBasisFromType,
  residencyCode,
  residencyFromXero,
  studyLoanFromXero,
  digitsOnly,
  type ResidencyCode,
  type XeroTaxDeclaration
} from './xero-employee-pull.js';

export type PayrollPushSubject = {
  firstName: string;
  taxFileNumber: string | null;
  bankBsb: string | null;
  bankAccountNumber: string | null;
  superFundName: string | null;
  superFundAbn: string | null;
  superFundUsi: string | null;
};

const hasDigits = (value: string | null) => Boolean(value && /\d/.test(value));

/** Human-readable warnings for every payroll block the push will omit. */
export function payrollDetailsNotSent(staff: PayrollPushSubject, tenantLabel: string): string[] {
  const out: string[] = [];
  const who = staff.firstName;
  if (!hasDigits(staff.taxFileNumber)) {
    out.push(
      `No tax file number on ${who}'s profile, so no tax declaration went to ${tenantLabel} — Xero will tax them at the no-TFN rate until one is added.`
    );
  }
  if (!hasDigits(staff.bankBsb) || !hasDigits(staff.bankAccountNumber)) {
    out.push(`No BSB and account number on ${who}'s profile, so no bank account went to ${tenantLabel}.`);
  }
  if (!staff.superFundAbn && !staff.superFundUsi && !staff.superFundName) {
    out.push(`No super fund on ${who}'s profile, so no super membership went to ${tenantLabel}.`);
  }
  return out;
}

/** Xero Payroll answers 200 and puts per-employee rejections in the body. */
export function xeroElementWarnings(
  element: { ValidationErrors?: Array<{ Message?: string }> } | undefined,
  tenantLabel: string
): string[] {
  const messages = (element?.ValidationErrors ?? [])
    .map((error) => (error.Message ?? '').trim())
    .filter(Boolean);
  return messages.map((message) => `Xero rejected part of the record in ${tenantLabel}: ${message}`);
}

// ── The tax declaration ─────────────────────────────────────────────────────
//
// Three things this used to get wrong, each of which changes someone's pay:
//
//  - Employment basis was hard-coded CASUAL, so every push of a full-timer
//    told Xero they were casual — and on an update, overwrote the right value.
//  - Residency was `text.includes('resident')`, which "Foreign resident for
//    tax purposes" also satisfies. Foreign residents were pushed as Australian
//    residents and under-taxed.
//  - The study-loan flag was never sent, and whatever Xero already knew about
//    loans, leave loading or withholding variations was not carried on the
//    update, so a push could quietly reset it.
//
// The rule now: the profile wins where it says something; where it is silent,
// what Xero already holds stands; and only then a default. A study loan is
// the one asymmetry — the profile can switch it ON, never off, because "off"
// on the profile is also what an unanswered question looks like, and clearing
// a real loan means a tax bill for the employee at year end.

export type TaxDeclarationSubject = {
  taxFileNumber: string | null;
  taxResidencyStatus: string | null;
  taxFreeThreshold: boolean | null;
  hasStudyTrainingLoan: boolean | null;
  employmentType: string | null;
};

export type XeroTaxDeclarationBody = {
  TaxFileNumber: string;
  EmploymentBasis: string;
  ResidencyStatus: 'AUSTRALIANRESIDENT' | 'FOREIGNRESIDENT';
  AustralianResidentForTaxPurposes: boolean;
  TaxScaleType: string;
  TaxFreeThresholdClaimed: boolean;
  HasLoanOrStudentDebt: boolean;
  HasHELPDebt: boolean;
  EligibleToReceiveLeaveLoading?: boolean;
  TaxOffsetEstimatedAmount?: number;
  UpwardVariationTaxWithholdingAmount?: number;
  ApprovedWithholdingVariationPercentage?: number;
};

const KNOWN_BASES = new Set(['FULLTIME', 'PARTTIME', 'CASUAL', 'LABOURHIRE', 'NONEMPLOYEE']);
const AU_RESIDENT_SCALES = new Set(['REGULAR', 'ACTORSARTISTSENTERTAINERS', 'HORTICULTURISTORSHEARER', 'SENIORORPENSIONER']);

/** Which residency the push will state: the profile's, else Xero's, else
 * Australian resident — the overwhelming default here. */
export function residencyToSend(
  profile: Pick<TaxDeclarationSubject, 'taxResidencyStatus'>,
  existing: XeroTaxDeclaration | null | undefined
): ResidencyCode {
  return (
    residencyCode(profile.taxResidencyStatus) ??
    residencyFromXero({ TaxDeclaration: existing ?? undefined }) ??
    'AUSTRALIANRESIDENT'
  );
}

/** STP Phase 2 wants the income type at the employee level. Working holiday
 * makers are their own type; everyone else here is on salary and wages,
 * unless Xero already files them as something rarer (closely held, labour
 * hire), which a push must not undo. */
export function employeeIncomeType(residency: ResidencyCode, existingIncomeType: string | null | undefined): string {
  if (residency === 'WORKINGHOLIDAYMAKER') return 'WORKINGHOLIDAYMAKER';
  const existing = (existingIncomeType ?? '').trim().toUpperCase();
  if (existing && existing !== 'WORKINGHOLIDAYMAKER') return existing;
  return 'SALARYANDWAGES';
}

/** The tax declaration to send, or undefined when the profile has no tax file
 * number — Xero refuses a declaration without one, and the caller already
 * warns that nothing went. */
export function buildTaxDeclaration(
  profile: TaxDeclarationSubject,
  existing: XeroTaxDeclaration | null | undefined
): XeroTaxDeclarationBody | undefined {
  const tfn = digitsOnly(profile.taxFileNumber);
  if (tfn.length < 8) return undefined;

  const existingBasis = (existing?.EmploymentBasis ?? '').trim().toUpperCase();
  const basis = employmentBasisFromType(profile.employmentType) ?? (KNOWN_BASES.has(existingBasis) ? existingBasis : 'CASUAL');

  const residency = residencyToSend(profile, existing);
  // ResidencyStatus=WORKINGHOLIDAYMAKER is deprecated in Xero's own schema;
  // a working holiday maker is a foreign resident on the WHM tax scale, with
  // the income type (set by the caller) doing the rest.
  const residencyStatus = residency === 'AUSTRALIANRESIDENT' ? 'AUSTRALIANRESIDENT' : 'FOREIGNRESIDENT';
  const existingScale = (existing?.TaxScaleType ?? '').trim().toUpperCase();
  const taxScaleType =
    residency === 'WORKINGHOLIDAYMAKER'
      ? 'WORKINGHOLIDAYMAKER'
      : residency === 'FOREIGNRESIDENT'
        ? 'FOREIGN'
        : AU_RESIDENT_SCALES.has(existingScale)
          ? existingScale
          : 'REGULAR';

  const threshold =
    profile.taxFreeThreshold ??
    (typeof existing?.TaxFreeThresholdClaimed === 'boolean' ? existing.TaxFreeThresholdClaimed : residency === 'AUSTRALIANRESIDENT');

  const loan = profile.hasStudyTrainingLoan === true ? true : (studyLoanFromXero(existing ?? undefined) ?? false);

  const body: XeroTaxDeclarationBody = {
    TaxFileNumber: tfn,
    EmploymentBasis: basis,
    ResidencyStatus: residencyStatus,
    AustralianResidentForTaxPurposes: residency === 'AUSTRALIANRESIDENT',
    TaxScaleType: taxScaleType,
    TaxFreeThresholdClaimed: threshold,
    // The STP2 flag and the legacy one it replaced, kept in step so an
    // organisation on either reading sees the same answer.
    HasLoanOrStudentDebt: loan,
    HasHELPDebt: loan
  };

  // Settings the profile has no opinion on. Carried across an update so
  // that posting the declaration cannot reset them.
  if (typeof existing?.EligibleToReceiveLeaveLoading === 'boolean') {
    body.EligibleToReceiveLeaveLoading = existing.EligibleToReceiveLeaveLoading;
  }
  for (const key of [
    'TaxOffsetEstimatedAmount',
    'UpwardVariationTaxWithholdingAmount',
    'ApprovedWithholdingVariationPercentage'
  ] as const) {
    const value = (existing as Record<string, unknown> | null | undefined)?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) body[key] = value;
  }
  return body;
}

/** Xero's employment type (STP2): keep what it has, default to employee. */
export function employeeEmploymentType(existing: string | null | undefined): string {
  const value = (existing ?? '').trim().toUpperCase();
  return value === 'CONTRACTOR' ? 'CONTRACTOR' : 'EMPLOYEE';
}
