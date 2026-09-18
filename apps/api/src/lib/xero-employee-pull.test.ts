import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  abnFromUsi,
  auStateCode,
  buildXeroPullFields,
  employmentBasisFromType,
  employmentTypeFromBasis,
  ordinaryEarningsLine,
  payPeriodWeeks,
  residencyCode,
  selectPullFields,
  taxFileNumberHeldNote,
  weeklyHours,
  type PullableProfile,
  type XeroEmployeeDetail,
  type XeroPullField,
  type XeroSuperFund
} from './xero-employee-pull.js';

// A profile with nothing filled in, so each test says only what it is about.
const emptyProfile: PullableProfile = {
  email: null,
  phone: null,
  dateOfBirth: null,
  startDate: null,
  addressLine1: null,
  addressLine2: null,
  suburb: null,
  state: null,
  postcode: null,
  employmentType: null,
  contractedWeeklyHours: null,
  payRateCents: null,
  xeroPayrollCalendarId: null,
  xeroEarningsRateId: null,
  taxResidencyStatus: null,
  taxFreeThreshold: null,
  hasStudyTrainingLoan: null,
  bankAccountName: null,
  bankBsb: null,
  bankAccountNumber: null,
  superFundName: null,
  superFundAbn: null,
  superFundUsi: null,
  superMemberNumber: null
};

function build(input: {
  profile?: Partial<PullableProfile>;
  employee: XeroEmployeeDetail;
  periodWeeks?: number | null;
  calendarName?: string | null;
  manualPay?: boolean;
  superFunds?: XeroSuperFund[] | null;
}): XeroPullField[] {
  return buildXeroPullFields({
    profile: { ...emptyProfile, ...input.profile },
    employee: input.employee,
    dates: {
      dateOfBirth: input.employee.DateOfBirth ? new Date(input.employee.DateOfBirth) : null,
      startDate: input.employee.StartDate ? new Date(input.employee.StartDate) : null
    },
    periodWeeks: input.periodWeeks ?? null,
    calendarName: input.calendarName ?? null,
    tenantName: 'Alma Freshwater Pty Ltd',
    manualPay: input.manualPay ?? false,
    superFunds: input.superFunds ?? null
  });
}

const find = (fields: XeroPullField[], key: string) => fields.find((field) => field.key === key);

describe('weeklyHours', () => {
  it('reads a fortnight as half a fortnight', () => {
    // The one that matters: 76 hours a fortnight is a 38-hour week, and
    // writing 76 would make the labour report think everyone is on double.
    assert.equal(weeklyHours(76, 2), 38);
  });

  it('leaves a weekly calendar alone', () => {
    assert.equal(weeklyHours(38, 1), 38);
  });

  it('turns a monthly calendar into a sane week', () => {
    assert.equal(weeklyHours(164.67, 52 / 12), 38);
  });

  it('refuses to guess when the period is unknown', () => {
    assert.equal(weeklyHours(76, null), null);
  });

  it('treats zero and nonsense as nothing to say', () => {
    assert.equal(weeklyHours(0, 2), null);
    assert.equal(weeklyHours(Number.NaN, 2), null);
    assert.equal(weeklyHours(undefined, 2), null);
    assert.equal(weeklyHours(76, 0), null);
  });
});

describe('payPeriodWeeks', () => {
  it('knows the cycles Xero names', () => {
    assert.equal(payPeriodWeeks('WEEKLY'), 1);
    assert.equal(payPeriodWeeks('fortnightly'), 2);
    assert.equal(payPeriodWeeks('FOURWEEKLY'), 4);
  });

  it('returns nothing for a cycle it does not know', () => {
    assert.equal(payPeriodWeeks('EVERYFULLMOON'), null);
    assert.equal(payPeriodWeeks(null), null);
  });
});

describe('ordinaryEarningsLine', () => {
  it('prefers the line the employee record names', () => {
    const line = ordinaryEarningsLine({
      OrdinaryEarningsRateID: 'rate-b',
      PayTemplate: {
        EarningsLines: [
          { EarningsRateID: 'rate-a', EarningsType: 'ORDINARYTIMEEARNINGS', RatePerUnit: 25 },
          { EarningsRateID: 'rate-b', RatePerUnit: 31.5 }
        ]
      }
    });
    assert.equal(line?.RatePerUnit, 31.5);
  });

  it('falls back to the ordinary-time line when nothing is named', () => {
    const line = ordinaryEarningsLine({
      PayTemplate: {
        EarningsLines: [
          { EarningsRateID: 'sat', RatePerUnit: 40 },
          { EarningsRateID: 'ord', EarningsType: 'ORDINARYTIMEEARNINGS', RatePerUnit: 28 }
        ]
      }
    });
    assert.equal(line?.RatePerUnit, 28);
  });

  it('has nothing to say about an empty pay template', () => {
    assert.equal(ordinaryEarningsLine({}), undefined);
  });
});

describe('buildXeroPullFields', () => {
  it('never offers a field Xero has nothing for', () => {
    // The rule that stops an empty payroll record blanking a good profile.
    const fields = build({
      profile: { phone: '0400 000 000', addressLine1: '1 Lawrence St', postcode: '2096' },
      employee: { FirstName: 'Dirk', LastName: 'M' }
    });
    assert.equal(find(fields, 'phone'), undefined);
    assert.equal(find(fields, 'addressLine1'), undefined);
    assert.equal(find(fields, 'postcode'), undefined);
  });

  it('shows a real change, and ticks it', () => {
    const fields = build({
      profile: { phone: '0400 000 000' },
      employee: { Mobile: '0411 111 111' }
    });
    const phone = find(fields, 'phone');
    assert.equal(phone?.current, '0400 000 000');
    assert.equal(phone?.incoming, '0411 111 111');
    assert.equal(phone?.differs, true);
    assert.equal(phone?.recommended, true);
  });

  it('shows agreement without calling it a change', () => {
    const fields = build({ profile: { phone: '0411 111 111' }, employee: { Mobile: '0411 111 111' } });
    const phone = find(fields, 'phone');
    assert.equal(phone?.differs, false);
    assert.equal(phone?.recommended, false);
  });

  it('does not treat NSW and New South Wales as a change', () => {
    // Without this the address presents itself as work to do on every pull.
    const fields = build({
      profile: { state: 'New South Wales' },
      employee: { HomeAddress: { Region: 'NSW' } }
    });
    assert.equal(find(fields, 'state')?.differs, false);
  });

  it('still catches a real move interstate', () => {
    const fields = build({ profile: { state: 'NSW' }, employee: { HomeAddress: { Region: 'VIC' } } });
    assert.equal(find(fields, 'state')?.differs, true);
  });

  it('converts standard hours through the calendar, and says so', () => {
    const fields = build({
      employee: {
        PayTemplate: { EarningsLines: [{ EarningsType: 'ORDINARYTIMEEARNINGS', NormalNumberOfUnits: 76 }] }
      },
      periodWeeks: 2,
      calendarName: 'Fortnightly'
    });
    const hours = find(fields, 'contractedWeeklyHours');
    assert.equal(hours?.incoming, '38 h');
    assert.equal(hours?.value, 38);
    assert.match(hours?.note ?? '', /76 hours a pay period on the Fortnightly calendar/);
  });

  it('offers no hours at all when the calendar is unknown', () => {
    const fields = build({
      employee: {
        PayTemplate: { EarningsLines: [{ EarningsType: 'ORDINARYTIMEEARNINGS', NormalNumberOfUnits: 76 }] }
      },
      periodWeeks: null
    });
    assert.equal(find(fields, 'contractedWeeklyHours'), undefined);
  });

  it('reads the rate as cents', () => {
    const fields = build({
      profile: { payRateCents: 2800 },
      employee: { PayTemplate: { EarningsLines: [{ EarningsType: 'ORDINARYTIMEEARNINGS', RatePerUnit: 31.55 }] } }
    });
    const rate = find(fields, 'payRateCents');
    assert.equal(rate?.current, '$28.00');
    assert.equal(rate?.incoming, '$31.55');
    assert.equal(rate?.value, 3155);
  });

  it('does not tick a Xero rate for someone paid outside Xero', () => {
    const fields = build({
      profile: { payRateCents: 2800 },
      employee: { PayTemplate: { EarningsLines: [{ EarningsType: 'ORDINARYTIMEEARNINGS', RatePerUnit: 31.55 }] } },
      manualPay: true
    });
    const rate = find(fields, 'payRateCents');
    assert.equal(rate?.differs, true);
    assert.equal(rate?.recommended, false);
    assert.match(rate?.note ?? '', /paid outside Xero/);
  });

  it('leaves their login address for a person to decide', () => {
    const fields = build({ profile: { email: 'dirk@almagroup.com.au' }, employee: { Email: 'dirk@gmail.com' } });
    const email = find(fields, 'email');
    assert.equal(email?.differs, true);
    assert.equal(email?.recommended, false);
    assert.match(email?.note ?? '', /how they sign in/);
  });

  it('maps the employment basis into the profile\'s own words', () => {
    assert.equal(employmentTypeFromBasis('PARTTIME'), 'Part-time');
    assert.equal(employmentTypeFromBasis('CASUAL'), 'Casual');
    // No equivalent here, so nothing is offered rather than something wrong.
    assert.equal(employmentTypeFromBasis('LABOURHIRE'), null);
    const fields = build({ employee: { TaxDeclaration: { EmploymentBasis: 'LABOURHIRE' } } });
    assert.equal(find(fields, 'employmentType'), undefined);
  });

  it('carries the payroll ids the timesheet export depends on', () => {
    const fields = build({
      employee: { PayrollCalendarID: 'cal-1', OrdinaryEarningsRateID: 'rate-1' },
      calendarName: 'Fortnightly'
    });
    assert.equal(find(fields, 'xeroPayrollCalendarId')?.value, 'cal-1');
    assert.equal(find(fields, 'xeroEarningsRateId')?.value, 'rate-1');
  });

  it('never offers the tax file number, whatever Xero returns — but does offer bank and super', () => {
    // Rule 2, asserted rather than trusted: Xero masks the TFN, so a pull of
    // it would write asterisks over a real number. Bank and super are real
    // values and come through.
    const fields = build({
      employee: {
        TaxDeclaration: { TaxFileNumber: '***456789', EmploymentBasis: 'CASUAL' },
        BankAccounts: [{ BSB: '062000', AccountNumber: '12345678' }],
        SuperMemberships: [{ SuperFundID: 'fund-1', EmployeeNumber: 'M123' }]
      }
    });
    const keys = fields.map((field) => field.key);
    assert.equal(keys.includes('taxFileNumber'), false, 'the TFN must never be pullable');
    assert.ok(fields.every((field) => !String(field.incoming).includes('456789')), 'not even under another key');
    assert.equal(find(fields, 'bankBsb')?.value, '062000');
    assert.equal(find(fields, 'bankAccountNumber')?.value, '12345678');
    assert.equal(find(fields, 'superMemberNumber')?.value, 'M123');
  });

  it('treats blank strings from Xero as nothing, not as a blanking', () => {
    const fields = build({
      profile: { suburb: 'Freshwater' },
      employee: { HomeAddress: { City: '   ' } }
    });
    assert.equal(find(fields, 'suburb'), undefined);
  });
});

describe('selectPullFields', () => {
  const fields: XeroPullField[] = [
    { key: 'phone', label: 'Phone', current: null, incoming: '0411', differs: true, recommended: true, value: '0411' },
    { key: 'suburb', label: 'Suburb', current: 'Freshwater', incoming: 'Freshwater', differs: false, recommended: false, value: 'Freshwater' }
  ];

  it('writes what was ticked', () => {
    const { data, applied } = selectPullFields(fields, ['phone']);
    assert.deepEqual(data, { phone: '0411' });
    assert.deepEqual(applied, [{ key: 'phone', label: 'Phone', value: '0411' }]);
  });

  it('refuses a key Xero had nothing for, rather than writing null', () => {
    // The browser sends keys; a key this code did not just read from Xero must
    // not be able to reach a profile column.
    const { data, skipped } = selectPullFields(fields, ['bankAccountNumber']);
    assert.deepEqual(data, {});
    assert.equal(skipped[0]?.key, 'bankAccountNumber');
  });

  it('skips a field that already agrees', () => {
    const { data, skipped } = selectPullFields(fields, ['suburb']);
    assert.deepEqual(data, {});
    assert.match(skipped[0]?.why ?? '', /same on both sides/);
  });

  it('counts a repeated key once', () => {
    const { applied } = selectPullFields(fields, ['phone', 'phone']);
    assert.equal(applied.length, 1);
  });
});

describe('auStateCode', () => {
  it('folds the spellings staff actually type', () => {
    assert.equal(auStateCode('new south wales'), 'NSW');
    assert.equal(auStateCode(' NSW '), 'NSW');
    assert.equal(auStateCode('Victoria'), 'VIC');
  });

  it('has nothing to say about nothing', () => {
    assert.equal(auStateCode(null), undefined);
    assert.equal(auStateCode('  '), undefined);
  });
});

// What Jacqui's pre-existing Avalon record actually looked like, shape for
// shape: a masked TFN, one Remainder bank account, one super membership by
// fund id, and both the STP2 loan flag and the legacy ones.
describe('bank, super and tax settings come back', () => {
  const employee: XeroEmployeeDetail = {
    TaxDeclaration: {
      TaxFileNumber: '***-***-234',
      EmploymentBasis: 'CASUAL',
      ResidencyStatus: 'AUSTRALIANRESIDENT',
      AustralianResidentForTaxPurposes: true,
      TaxFreeThresholdClaimed: true,
      HasHELPDebt: false,
      HasSFSSDebt: false,
      HasLoanOrStudentDebt: true
    },
    BankAccounts: [{ StatementText: 'Pay', AccountName: 'Jacqueline Flower', BSB: '062000', AccountNumber: '123456789', Remainder: true }],
    SuperMemberships: [{ SuperMembershipID: 'm-1', SuperFundID: 'fund-industry', EmployeeNumber: '12345678' }]
  };
  const funds: XeroSuperFund[] = [
    { SuperFundID: 'fund-industry', Name: 'HOSTPLUS Superannuation Fund - Industry (HOSTPLUS Superannuation Fund)', Type: 'REGULATED', USI: 'HOS0100AU' },
    { SuperFundID: 'fund-basic', Name: 'HOSTPLUS Superannuation Fund - Basic (HOSTPLUS Superannuation Fund)', Type: 'REGULATED', USI: '68657495890003' },
    { SuperFundID: 'fund-smsf', Name: 'THE MACO FUND', Type: 'SMSF', ABN: '61234567890' }
  ];

  it('offers the paying bank account, with the number masked for the screen', () => {
    const fields = build({ employee });
    assert.equal(find(fields, 'bankAccountName')?.incoming, 'Jacqueline Flower');
    assert.equal(find(fields, 'bankBsb')?.incoming, '062-000');
    const account = find(fields, 'bankAccountNumber');
    assert.equal(account?.incoming, '••••••789');
    // The real digits are what gets written; only the display is masked.
    assert.equal(account?.value, '123456789');
    assert.equal(account?.differs, true);
    assert.equal(account?.recommended, true);
  });

  it('sees "062-000" and "062000" as the same BSB', () => {
    const fields = build({ employee, profile: { bankBsb: '062-000', bankAccountNumber: '123456789' } });
    assert.equal(find(fields, 'bankBsb')?.differs, false);
    assert.equal(find(fields, 'bankAccountNumber')?.differs, false);
  });

  it('takes the Remainder account when pay is split', () => {
    const split: XeroEmployeeDetail = {
      BankAccounts: [
        { AccountName: 'Savings', BSB: '111111', AccountNumber: '11111111', Amount: 100, Remainder: false },
        { AccountName: 'Everyday', BSB: '222222', AccountNumber: '22222222', Remainder: true }
      ]
    };
    const fields = build({ employee: split });
    assert.equal(find(fields, 'bankAccountName')?.incoming, 'Everyday');
    assert.equal(find(fields, 'bankBsb')?.incoming, '222-222');
  });

  it('names the fund from the organisation list', () => {
    const fields = build({ employee, superFunds: funds });
    assert.equal(find(fields, 'superFundName')?.incoming, 'HOSTPLUS Superannuation Fund - Industry (HOSTPLUS Superannuation Fund)');
    assert.equal(find(fields, 'superFundUsi')?.incoming, 'HOS0100AU');
    assert.equal(find(fields, 'superMemberNumber')?.incoming, '12345678');
    // A SPIN-style USI says nothing about the ABN, so none is offered.
    assert.equal(find(fields, 'superFundAbn'), undefined);
  });

  it('reads the ABN out of a 14-digit USI', () => {
    assert.equal(abnFromUsi('68657495890003'), '68657495890');
    assert.equal(abnFromUsi('HOS0100AU'), null);
    const basic: XeroEmployeeDetail = { SuperMemberships: [{ SuperFundID: 'fund-basic' }] };
    const fields = build({ employee: basic, superFunds: funds });
    assert.equal(find(fields, 'superFundAbn')?.incoming, '68657495890');
    // The fund is known, the member number isn't — so it is not offered.
    assert.equal(find(fields, 'superMemberNumber'), undefined);
  });

  it('matches the fund name however it was typed', () => {
    const fields = build({
      employee,
      superFunds: funds,
      profile: { superFundName: 'hostplus superannuation fund – industry (hostplus superannuation fund)' }
    });
    assert.equal(find(fields, 'superFundName')?.differs, false);
  });

  it('offers nothing for a membership whose fund is not in the list', () => {
    const fields = build({ employee, superFunds: [] });
    assert.equal(find(fields, 'superFundName'), undefined);
    assert.equal(find(fields, 'superFundUsi'), undefined);
    // The member number still comes from the membership itself.
    assert.equal(find(fields, 'superMemberNumber')?.incoming, '12345678');
  });

  it('never offers the tax file number', () => {
    const fields = build({ employee });
    assert.equal(find(fields, 'taxFileNumber'), undefined);
    assert.ok(fields.every((field) => !field.incoming?.includes('234') || field.key === 'bankAccountNumber' || field.key === 'superMemberNumber'));
  });

  it('says a TFN is held when the profile has none, and stays quiet otherwise', () => {
    const note = taxFileNumberHeldNote({
      firstName: 'Jacqui',
      tenantName: 'Alma Avalon',
      declaration: employee.TaxDeclaration,
      profileTaxFileNumber: null
    });
    assert.match(note ?? '', /ending in 234/);
    assert.match(note ?? '', /Alma Avalon/);
    assert.equal(
      taxFileNumberHeldNote({ firstName: 'Jacqui', tenantName: null, declaration: employee.TaxDeclaration, profileTaxFileNumber: '123 456 782' }),
      null
    );
    assert.equal(taxFileNumberHeldNote({ firstName: 'Jacqui', tenantName: null, declaration: {}, profileTaxFileNumber: null }), null);
  });

  it('reads residency in any spelling', () => {
    assert.equal(residencyCode('An Australian resident for tax purposes'), 'AUSTRALIANRESIDENT');
    assert.equal(residencyCode('A foreign resident for tax purposes'), 'FOREIGNRESIDENT');
    assert.equal(residencyCode('Working holiday maker'), 'WORKINGHOLIDAYMAKER');
    assert.equal(residencyCode('FOREIGNRESIDENT'), 'FOREIGNRESIDENT');
    assert.equal(residencyCode(''), null);

    const agrees = build({ employee, profile: { taxResidencyStatus: 'An Australian resident for tax purposes' } });
    assert.equal(find(agrees, 'taxResidencyStatus')?.differs, false);
    const blank = build({ employee });
    assert.equal(find(blank, 'taxResidencyStatus')?.incoming, 'Australian resident for tax purposes');
  });

  it('a working holiday maker is read from the income type, not the deprecated residency value', () => {
    const whm: XeroEmployeeDetail = {
      IncomeType: 'WORKINGHOLIDAYMAKER',
      TaxDeclaration: { ResidencyStatus: 'FOREIGNRESIDENT', TaxScaleType: 'WORKINGHOLIDAYMAKER' }
    };
    assert.equal(find(build({ employee: whm }), 'taxResidencyStatus')?.incoming, 'Working holiday maker');
  });

  it('reads the threshold and the loan flag, STP2 or legacy', () => {
    const fields = build({ employee });
    assert.equal(find(fields, 'taxFreeThreshold')?.incoming, 'Yes');
    assert.equal(find(fields, 'taxFreeThreshold')?.value, true);
    // HasLoanOrStudentDebt is true even though the legacy HasHELPDebt is false.
    assert.equal(find(fields, 'hasStudyTrainingLoan')?.incoming, 'Yes');

    const legacy = build({ employee: { TaxDeclaration: { HasSFSSDebt: true } } });
    assert.equal(find(legacy, 'hasStudyTrainingLoan')?.incoming, 'Yes');

    const silent = build({ employee: { TaxDeclaration: { TaxFreeThresholdClaimed: false } } });
    assert.equal(find(silent, 'hasStudyTrainingLoan'), undefined);
    assert.equal(find(silent, 'taxFreeThreshold')?.incoming, 'No');
    assert.equal(find(silent, 'taxFreeThreshold')?.value, false);
  });

  it('"Full-time" and "Salaried" are both full time; nonsense is nothing', () => {
    assert.equal(employmentBasisFromType('Full-time'), 'FULLTIME');
    assert.equal(employmentBasisFromType('Salaried'), 'FULLTIME');
    assert.equal(employmentBasisFromType('part time'), 'PARTTIME');
    assert.equal(employmentBasisFromType('Casual'), 'CASUAL');
    assert.equal(employmentBasisFromType('Contractor'), null);
    assert.equal(employmentBasisFromType(null), null);
  });

  it('an empty payroll record offers none of it', () => {
    const fields = build({ employee: {}, profile: { bankBsb: '062000', bankAccountNumber: '1', superFundName: 'HOSTPLUS' } });
    for (const key of ['bankAccountName', 'bankBsb', 'bankAccountNumber', 'superFundName', 'superFundAbn', 'superFundUsi', 'superMemberNumber', 'taxResidencyStatus', 'taxFreeThreshold', 'hasStudyTrainingLoan']) {
      assert.equal(find(fields, key), undefined, `${key} must not be offered`);
    }
  });

  it('writes booleans as booleans', () => {
    const fields = build({ employee });
    const { data } = selectPullFields(fields, ['taxFreeThreshold', 'hasStudyTrainingLoan', 'bankAccountNumber']);
    assert.deepEqual(data, { taxFreeThreshold: true, hasStudyTrainingLoan: true, bankAccountNumber: '123456789' });
  });
});
