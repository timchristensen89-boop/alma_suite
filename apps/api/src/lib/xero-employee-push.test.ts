import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaxDeclaration,
  employeeEmploymentType,
  employeeIncomeType,
  payrollDetailsNotSent,
  residencyToSend,
  xeroElementWarnings,
  type TaxDeclarationSubject
} from './xero-employee-push.js';

/** tsconfig has noUncheckedIndexedAccess, so index then narrow. */
function at(list: string[], index: number): string {
  const value = list[index];
  assert.ok(value, `expected a warning at index ${index}`);
  return value;
}

const complete = {
  firstName: 'Isla',
  taxFileNumber: '123 456 782',
  bankBsb: '062-000',
  bankAccountNumber: '12345678',
  superFundName: 'HOSTPLUS',
  superFundAbn: '68 657 495 890',
  superFundUsi: 'HOS0100AU'
};

test('a complete profile warns about nothing', () => {
  assert.deepEqual(payrollDetailsNotSent(complete, 'Alma Freshwater Pty Ltd'), []);
});

test('an empty profile names all three blocks it could not send', () => {
  const warnings = payrollDetailsNotSent(
    {
      firstName: 'Isla',
      taxFileNumber: null,
      bankBsb: null,
      bankAccountNumber: null,
      superFundName: null,
      superFundAbn: null,
      superFundUsi: null
    },
    'Alma Avalon'
  );
  assert.equal(warnings.length, 3);
  // The TFN one has to say what it costs: Xero taxes at roughly half without it.
  assert.match(at(warnings, 0), /no-TFN rate/);
  assert.ok(warnings.every((w) => w.includes('Alma Avalon')), 'each warning names the company');
  assert.ok(warnings.every((w) => w.includes('Isla')), 'each warning names the person');
});

test('half a bank account is no bank account', () => {
  // Xero needs both. A BSB on its own silently sends nothing, which is the
  // shape of the original bug.
  const bsbOnly = payrollDetailsNotSent({ ...complete, bankAccountNumber: null }, 'Alma Avalon');
  assert.equal(bsbOnly.length, 1);
  assert.match(at(bsbOnly, 0), /BSB and account number/);

  const accountOnly = payrollDetailsNotSent({ ...complete, bankBsb: null }, 'Alma Avalon');
  assert.equal(accountOnly.length, 1);
});

test('a field of punctuation is not a number', () => {
  // "-" and "n/a" arrive from imported records and are not a TFN.
  const warnings = payrollDetailsNotSent({ ...complete, taxFileNumber: 'n/a' }, 'Alma Avalon');
  assert.equal(warnings.length, 1);
  assert.match(at(warnings, 0), /tax file number/);
});

test('any one super identifier is enough to attempt the fund', () => {
  // The fund is matched on ABN, then USI, then name — so any one of them
  // means the push has something to try, and this warning stays quiet.
  for (const only of ['superFundAbn', 'superFundUsi', 'superFundName'] as const) {
    const stripped = { ...complete, superFundAbn: null, superFundUsi: null, superFundName: null, [only]: 'x' };
    assert.deepEqual(payrollDetailsNotSent(stripped, 'Alma Avalon'), [], `${only} alone should be enough`);
  }
});

test('a 200 carrying rejections is surfaced, not swallowed', () => {
  const warnings = xeroElementWarnings(
    { ValidationErrors: [{ Message: 'Bank account number is invalid' }, { Message: '' }, {}] },
    'Alma Freshwater Pty Ltd'
  );
  assert.equal(warnings.length, 1, 'blank messages are dropped');
  assert.match(at(warnings, 0), /Alma Freshwater Pty Ltd/);
  assert.match(at(warnings, 0), /Bank account number is invalid/);
});

test('no rejections and no element are both silence', () => {
  assert.deepEqual(xeroElementWarnings({}, 'Alma Avalon'), []);
  assert.deepEqual(xeroElementWarnings(undefined, 'Alma Avalon'), []);
});

// ── The tax declaration ─────────────────────────────────────────────────────

const blankTax: TaxDeclarationSubject = {
  taxFileNumber: '123 456 782',
  taxResidencyStatus: null,
  taxFreeThreshold: null,
  hasStudyTrainingLoan: null,
  employmentType: null
};

test('no tax file number, no declaration', () => {
  assert.equal(buildTaxDeclaration({ ...blankTax, taxFileNumber: null }, null), undefined);
  assert.equal(buildTaxDeclaration({ ...blankTax, taxFileNumber: 'n/a' }, null), undefined);
  assert.equal(buildTaxDeclaration(blankTax, null)?.TaxFileNumber, '123456782');
});

test('a foreign resident is not an Australian resident', () => {
  // The old test was `includes('resident')`, which this string also passes.
  const body = buildTaxDeclaration({ ...blankTax, taxResidencyStatus: 'Foreign resident for tax purposes' }, null);
  assert.equal(body?.ResidencyStatus, 'FOREIGNRESIDENT');
  assert.equal(body?.AustralianResidentForTaxPurposes, false);
  assert.equal(body?.TaxScaleType, 'FOREIGN');
  // Foreign residents cannot claim the threshold, so silence means no.
  assert.equal(body?.TaxFreeThresholdClaimed, false);

  const local = buildTaxDeclaration({ ...blankTax, taxResidencyStatus: 'An Australian resident for tax purposes' }, null);
  assert.equal(local?.ResidencyStatus, 'AUSTRALIANRESIDENT');
  assert.equal(local?.AustralianResidentForTaxPurposes, true);
  assert.equal(local?.TaxScaleType, 'REGULAR');
  assert.equal(local?.TaxFreeThresholdClaimed, true);
});

test('a working holiday maker is filed under the WHM income type and scale', () => {
  const profile = { ...blankTax, taxResidencyStatus: 'Working holiday maker' };
  const residency = residencyToSend(profile, null);
  assert.equal(residency, 'WORKINGHOLIDAYMAKER');
  assert.equal(employeeIncomeType(residency, null), 'WORKINGHOLIDAYMAKER');
  const body = buildTaxDeclaration(profile, null);
  // ResidencyStatus=WORKINGHOLIDAYMAKER is deprecated in Xero's schema.
  assert.equal(body?.ResidencyStatus, 'FOREIGNRESIDENT');
  assert.equal(body?.TaxScaleType, 'WORKINGHOLIDAYMAKER');
});

test('income type keeps a rarer filing Xero already has, and defaults to salary and wages', () => {
  assert.equal(employeeIncomeType('AUSTRALIANRESIDENT', null), 'SALARYANDWAGES');
  assert.equal(employeeIncomeType('AUSTRALIANRESIDENT', 'CLOSELYHELDPAYEES'), 'CLOSELYHELDPAYEES');
  assert.equal(employeeIncomeType('AUSTRALIANRESIDENT', 'WORKINGHOLIDAYMAKER'), 'SALARYANDWAGES');
  assert.equal(employeeEmploymentType(null), 'EMPLOYEE');
  assert.equal(employeeEmploymentType('CONTRACTOR'), 'CONTRACTOR');
});

test('employment basis follows the profile, then Xero, then casual', () => {
  assert.equal(buildTaxDeclaration({ ...blankTax, employmentType: 'Full-time' }, null)?.EmploymentBasis, 'FULLTIME');
  assert.equal(buildTaxDeclaration({ ...blankTax, employmentType: 'Salaried' }, { EmploymentBasis: 'CASUAL' })?.EmploymentBasis, 'FULLTIME');
  // Nothing on the profile: a full-timer in Xero stays a full-timer. The old
  // hard-coded CASUAL overwrote this on every push.
  assert.equal(buildTaxDeclaration(blankTax, { EmploymentBasis: 'FULLTIME' })?.EmploymentBasis, 'FULLTIME');
  assert.equal(buildTaxDeclaration(blankTax, null)?.EmploymentBasis, 'CASUAL');
});

test('the profile can switch a study loan on, never off', () => {
  const on = buildTaxDeclaration({ ...blankTax, hasStudyTrainingLoan: true }, { HasLoanOrStudentDebt: false });
  assert.equal(on?.HasLoanOrStudentDebt, true);
  assert.equal(on?.HasHELPDebt, true, 'the legacy flag is kept in step');

  // "Off" on the profile is also what an unanswered question looks like.
  const kept = buildTaxDeclaration({ ...blankTax, hasStudyTrainingLoan: false }, { HasHELPDebt: false, HasLoanOrStudentDebt: true });
  assert.equal(kept?.HasLoanOrStudentDebt, true);

  const legacy = buildTaxDeclaration(blankTax, { HasSFSSDebt: true });
  assert.equal(legacy?.HasLoanOrStudentDebt, true);

  const none = buildTaxDeclaration(blankTax, null);
  assert.equal(none?.HasLoanOrStudentDebt, false);
  assert.equal(none?.HasHELPDebt, false);
});

test('what Xero holds and the profile does not survives the update', () => {
  const existing = {
    ResidencyStatus: 'AUSTRALIANRESIDENT',
    TaxFreeThresholdClaimed: false,
    EligibleToReceiveLeaveLoading: true,
    UpwardVariationTaxWithholdingAmount: 50,
    TaxOffsetEstimatedAmount: 0,
    TaxScaleType: 'SENIORORPENSIONER'
  };
  const body = buildTaxDeclaration(blankTax, existing);
  assert.equal(body?.TaxFreeThresholdClaimed, false, "Xero's answer stands when the profile has none");
  assert.equal(body?.EligibleToReceiveLeaveLoading, true);
  assert.equal(body?.UpwardVariationTaxWithholdingAmount, 50);
  assert.equal(body?.TaxOffsetEstimatedAmount, undefined, 'a zero is not carried');
  assert.equal(body?.TaxScaleType, 'SENIORORPENSIONER', 'a resident scale Xero chose is kept');

  // The profile's own answer still wins.
  assert.equal(buildTaxDeclaration({ ...blankTax, taxFreeThreshold: true }, existing)?.TaxFreeThresholdClaimed, true);
});
