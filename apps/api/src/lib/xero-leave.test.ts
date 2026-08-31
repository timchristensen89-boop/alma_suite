import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hoursPerDay,
  matchLeaveType,
  normaliseLeaveName,
  planLeaveApplication,
  weekdaysBetween,
  type XeroLeaveType
} from './xero-leave.js';

/** What Xero AU ships with, as PayItems returns it. */
const XERO_DEFAULTS: XeroLeaveType[] = [
  { LeaveTypeID: 'annual-id', Name: 'Annual Leave', TypeOfUnits: 'Hours' },
  { LeaveTypeID: 'personal-id', Name: "Personal/Carer's Leave", TypeOfUnits: 'Hours' },
  { LeaveTypeID: 'unpaid-id', Name: 'Unpaid Leave', TypeOfUnits: 'Hours' }
];

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function reasonOf(result: { ok: boolean; reason?: string }): string {
  assert.equal(result.ok, false, 'expected a refusal');
  assert.ok(result.reason, 'a refusal must say why');
  return result.reason;
}

// ── name folding ───────────────────────────────────────────────────────────

test("Personal/Carer's Leave folds to something matchable", () => {
  assert.equal(normaliseLeaveName("Personal/Carer's Leave"), 'personal carer s leave');
  assert.equal(normaliseLeaveName('  ANNUAL   LEAVE '), 'annual leave');
  assert.equal(normaliseLeaveName(null), '');
});

// ── type matching ──────────────────────────────────────────────────────────

test('the Xero AU defaults are matched for every type that has one', () => {
  for (const [type, expected] of [
    ['ANNUAL', 'annual-id'],
    ['PERSONAL', 'personal-id'],
    ['SICK', 'personal-id'],
    ['UNPAID', 'unpaid-id']
  ] as const) {
    const match = matchLeaveType(type, XERO_DEFAULTS, 'Alma Avalon');
    assert.equal(match.ok, true, `${type} should match`);
    if (match.ok) assert.equal(match.leaveTypeId, expected);
  }
});

test('sick falls back to a plain Sick Leave type when there is no personal one', () => {
  const match = matchLeaveType('SICK', [{ LeaveTypeID: 'sick-id', Name: 'Sick Leave' }], 'Alma Avalon');
  assert.equal(match.ok, true);
  if (match.ok) assert.equal(match.leaveTypeId, 'sick-id');
});

test('OTHER is always refused, even when the company has plenty of types', () => {
  const reason = reasonOf(matchLeaveType('OTHER', XERO_DEFAULTS, 'Alma Avalon'));
  assert.match(reason, /no Xero equivalent/);
  assert.match(reason, /Alma Avalon/);
});

test('a missing type is refused, and the refusal lists what the company does have', () => {
  const reason = reasonOf(matchLeaveType('ANNUAL', [{ LeaveTypeID: 'x', Name: 'Unpaid Leave' }], 'Alma Freshwater Pty Ltd'));
  assert.match(reason, /Alma Freshwater Pty Ltd/);
  assert.match(reason, /Unpaid Leave/, 'says what is there, so the gap is obvious');
  assert.match(reason, /Pay Items/, 'says where to fix it');
});

test('a type with no id is not a match', () => {
  // Xero has returned rows without an id; treating one as a match would post
  // against nothing.
  const reason = reasonOf(matchLeaveType('ANNUAL', [{ Name: 'Annual Leave' }], 'Alma Avalon'));
  assert.match(reason, /No annual leave type/);
});

test('a Days-based type is reported as Days', () => {
  const match = matchLeaveType('ANNUAL', [{ LeaveTypeID: 'a', Name: 'Annual Leave', TypeOfUnits: 'Days' }], 'Alma Avalon');
  assert.equal(match.ok, true);
  if (match.ok) assert.equal(match.unitsAre, 'Days');
});

// ── weekday counting ───────────────────────────────────────────────────────

test('Friday to Monday is two days, not four', () => {
  // 2026-08-28 is a Friday, 2026-08-31 the Monday after.
  assert.equal(weekdaysBetween(day('2026-08-28'), day('2026-08-31')), 2);
});

test('a single weekday is one day, and a single weekend day is none', () => {
  assert.equal(weekdaysBetween(day('2026-08-31'), day('2026-08-31')), 1);
  assert.equal(weekdaysBetween(day('2026-08-29'), day('2026-08-29')), 0);
});

test('a full working week is five, and a fortnight is ten', () => {
  assert.equal(weekdaysBetween(day('2026-08-31'), day('2026-09-04')), 5);
  assert.equal(weekdaysBetween(day('2026-08-31'), day('2026-09-11')), 10);
});

test('backwards and invalid ranges count nothing', () => {
  assert.equal(weekdaysBetween(day('2026-09-04'), day('2026-08-31')), 0);
  assert.equal(weekdaysBetween(new Date('nope'), day('2026-08-31')), 0);
});

// ── hours per day ──────────────────────────────────────────────────────────

test('a contracted week divides over five days', () => {
  assert.equal(hoursPerDay(38), 7.6);
  assert.equal(hoursPerDay(20), 4);
});

test('a casual has no contracted week, and none is invented', () => {
  assert.equal(hoursPerDay(null), null);
  assert.equal(hoursPerDay(undefined), null);
  assert.equal(hoursPerDay(0), null);
  assert.equal(hoursPerDay(-5), null);
});

// ── the whole plan ─────────────────────────────────────────────────────────

const base = {
  type: 'ANNUAL' as const,
  status: 'APPROVED',
  startDate: day('2026-08-31'),
  endDate: day('2026-09-04'),
  contractedWeeklyHours: 38 as number | null,
  availableLeaveTypes: XERO_DEFAULTS,
  tenantLabel: 'Alma Avalon',
  staffName: 'Isla'
};

test('a full week of annual leave on 38 hours is 38 hours over 5 days', () => {
  const plan = planLeaveApplication(base);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.days, 5);
  assert.equal(plan.units, 38);
  assert.equal(plan.unitsAre, 'Hours');
  assert.equal(plan.leaveTypeId, 'annual-id');
  assert.equal(plan.startDate, '2026-08-31');
  assert.equal(plan.endDate, '2026-09-04');
});

test('only approved leave goes to payroll', () => {
  for (const status of ['PENDING', 'DECLINED', 'CANCELLED']) {
    const reason = reasonOf(planLeaveApplication({ ...base, status }));
    assert.match(reason, /only approved leave/);
  }
});

test('a casual is refused rather than given invented hours', () => {
  // This is the important one. A plausible number here is a wrong leave
  // balance and a wrong pay, and nothing would ever flag it.
  const reason = reasonOf(planLeaveApplication({ ...base, contractedWeeklyHours: null }));
  assert.match(reason, /no contracted weekly hours/);
  assert.match(reason, /Guessing/);
});

test('a Days-based company needs no hours at all', () => {
  const plan = planLeaveApplication({
    ...base,
    contractedWeeklyHours: null,
    availableLeaveTypes: [{ LeaveTypeID: 'a', Name: 'Annual Leave', TypeOfUnits: 'Days' }]
  });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.units, 5);
    assert.equal(plan.unitsAre, 'Days');
  }
});

test('leave that lands entirely on a weekend is refused', () => {
  const reason = reasonOf(
    planLeaveApplication({ ...base, startDate: day('2026-08-29'), endDate: day('2026-08-30') })
  );
  assert.match(reason, /weekend/);
});

test('a backwards range is refused before anything else is computed', () => {
  const reason = reasonOf(
    planLeaveApplication({ ...base, startDate: day('2026-09-04'), endDate: day('2026-08-31') })
  );
  assert.match(reason, /ends before it starts/);
});

test('the type refusal carries through the plan, naming the company', () => {
  const reason = reasonOf(planLeaveApplication({ ...base, type: 'OTHER' }));
  assert.match(reason, /Alma Avalon/);
});

test('a long weekend off is two days, priced as two', () => {
  const plan = planLeaveApplication({ ...base, startDate: day('2026-08-28'), endDate: day('2026-08-31') });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.days, 2);
    assert.equal(plan.units, 15.2);
  }
});
