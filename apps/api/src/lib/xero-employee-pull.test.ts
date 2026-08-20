import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  auStateCode,
  buildXeroPullFields,
  employmentTypeFromBasis,
  ordinaryEarningsLine,
  payPeriodWeeks,
  selectPullFields,
  weeklyHours,
  type PullableProfile,
  type XeroEmployeeDetail,
  type XeroPullField
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
  xeroEarningsRateId: null
};

function build(input: {
  profile?: Partial<PullableProfile>;
  employee: XeroEmployeeDetail;
  periodWeeks?: number | null;
  calendarName?: string | null;
  manualPay?: boolean;
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
    manualPay: input.manualPay ?? false
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

  it('never offers tax, bank or super, whatever Xero returns', () => {
    // Rule 2, asserted rather than trusted: these travel outward only.
    const fields = build({
      employee: {
        TaxDeclaration: { TaxFileNumber: '***456789', EmploymentBasis: 'CASUAL' },
        BankAccounts: [{ BSB: '062000', AccountNumber: '12345678' }],
        SuperMemberships: [{ SuperFundID: 'fund-1', EmployeeNumber: 'M123' }]
      }
    });
    const keys = fields.map((field) => field.key);
    for (const forbidden of [
      'taxFileNumber',
      'taxResidencyStatus',
      'taxFreeThreshold',
      'bankAccountName',
      'bankBsb',
      'bankAccountNumber',
      'superFundName',
      'superFundAbn',
      'superFundUsi',
      'superMemberNumber'
    ]) {
      assert.equal(keys.includes(forbidden), false, `${forbidden} must never be pullable`);
    }
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
