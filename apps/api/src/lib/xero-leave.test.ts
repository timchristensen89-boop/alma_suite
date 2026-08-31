import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alreadyInXeroReason,
  clipLeaveToPeriod,
  hoursPerDay,
  matchLeaveType,
  normaliseLeaveName,
  planLeaveApplication,
  overlappingLeave,
  parseXeroLeaveDate,
  weekdaysBetween,
  type XeroLeaveApplication,
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

// ── clipping to the pay period ─────────────────────────────────────────────
//
// The week is [start, end) — `end` exclusive, matching the timesheet push's
// `workDate < end`.

const week = { start: day('2026-08-31'), end: day('2026-09-07') }; // Mon..Sun

function clipped(startIso: string, endIso: string) {
  const out = clipLeaveToPeriod({ startDate: day(startIso), endDate: day(endIso) }, week);
  return out ? [out.startDate.toISOString().slice(0, 10), out.endDate.toISOString().slice(0, 10)] : null;
}

test('leave inside the week is unchanged', () => {
  assert.deepEqual(clipped('2026-09-01', '2026-09-03'), ['2026-09-01', '2026-09-03']);
});

test('leave running past both ends becomes exactly the week', () => {
  // Janaina's case: 26 Aug to 2 Oct pushed against one week gives that week
  // only — five days, not twenty-eight.
  assert.deepEqual(clipped('2026-08-26', '2026-10-02'), ['2026-08-31', '2026-09-06']);
  const out = clipLeaveToPeriod(
    { startDate: day('2026-08-26'), endDate: day('2026-10-02') },
    week
  );
  assert.ok(out);
  assert.equal(weekdaysBetween(out.startDate, out.endDate), 5, 'one working week, not the whole absence');
});

test('the exclusive end never leaks the next day in', () => {
  // 7 Sep is the next period's Monday. Clipping must stop at the 6th.
  assert.deepEqual(clipped('2026-09-05', '2026-09-09'), ['2026-09-05', '2026-09-06']);
});

test('leave entirely outside the week clips to nothing', () => {
  assert.equal(clipped('2026-08-01', '2026-08-30'), null, 'ends before the week');
  assert.equal(clipped('2026-09-07', '2026-09-11'), null, 'starts on the exclusive end');
});

test('leave touching a single boundary day survives', () => {
  assert.deepEqual(clipped('2026-08-20', '2026-08-31'), ['2026-08-31', '2026-08-31']);
  assert.deepEqual(clipped('2026-09-06', '2026-09-30'), ['2026-09-06', '2026-09-06']);
});

test('nonsense in gives nothing out', () => {
  assert.equal(clipped('2026-09-05', '2026-09-01'), null, 'backwards leave');
  assert.equal(
    clipLeaveToPeriod({ startDate: day('2026-09-01'), endDate: day('2026-09-02') }, { start: week.end, end: week.start }),
    null,
    'backwards period'
  );
  assert.equal(
    clipLeaveToPeriod({ startDate: new Date('nope'), endDate: day('2026-09-02') }, week),
    null,
    'invalid date'
  );
});

test('a clipped week of sick leave on 40 hours is 5 days, 40 hours', () => {
  // The end-to-end shape: clip, then plan. This is what one weekly push sends
  // for Janaina — not 224 hours.
  const slice = clipLeaveToPeriod({ startDate: day('2026-08-26'), endDate: day('2026-10-02') }, week);
  assert.ok(slice);
  const plan = planLeaveApplication({
    ...base,
    type: 'SICK',
    startDate: slice.startDate,
    endDate: slice.endDate,
    contractedWeeklyHours: 40,
    staffName: 'Janaina'
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.days, 5);
  assert.equal(plan.units, 40);
  assert.equal(plan.leaveTypeId, 'personal-id');
});

// ── the duplicate guard ────────────────────────────────────────────────────
//
// The one that stops a second leave application being paid over days Xero
// already covers.

test("Xero's .NET date format is read, not silently dropped", () => {
  // A date this failed to parse would be an overlap never found — the exact
  // failure the guard exists to prevent.
  const dotNet = parseXeroLeaveDate('/Date(1756598400000+1000)/');
  assert.ok(dotNet);
  assert.equal(dotNet.toISOString().slice(0, 10), '2025-08-31');
  assert.equal(parseXeroLeaveDate('2026-09-01')?.toISOString().slice(0, 10), '2026-09-01');
  assert.equal(parseXeroLeaveDate(''), null);
  assert.equal(parseXeroLeaveDate(null), null);
  assert.equal(parseXeroLeaveDate('not a date'), null);
});

const week1 = { startDate: '2026-08-31', endDate: '2026-09-04' };
const app = (start: string, end: string, extra: Partial<XeroLeaveApplication> = {}): XeroLeaveApplication => ({
  LeaveApplicationID: 'existing-1',
  EmployeeID: 'emp-1',
  StartDate: start,
  EndDate: end,
  ...extra
});

test('an application over the same days blocks the push', () => {
  assert.ok(overlappingLeave(week1, [app('2026-08-31', '2026-09-04')]));
});

test('any overlap at all blocks it, however small', () => {
  assert.ok(overlappingLeave(week1, [app('2026-09-04', '2026-09-11')]), 'shares the last day');
  assert.ok(overlappingLeave(week1, [app('2026-08-20', '2026-08-31')]), 'shares the first day');
  assert.ok(overlappingLeave(week1, [app('2026-01-01', '2026-12-31')]), 'swallows the week whole');
  assert.ok(overlappingLeave(week1, [app('2026-09-01', '2026-09-02')]), 'sits inside it');
});

test('leave that does not touch the week does not block it', () => {
  assert.equal(overlappingLeave(week1, [app('2026-08-24', '2026-08-30')]), null, 'ends the day before');
  assert.equal(overlappingLeave(week1, [app('2026-09-05', '2026-09-09')]), null, 'starts the day after');
  assert.equal(overlappingLeave(week1, []), null, 'nothing on file');
});

test('a different type of leave blocks it just the same', () => {
  // Already booked as annual leave means already paid for that absence.
  // Adding personal leave on top is the same double payment, relabelled.
  const annual = app('2026-09-01', '2026-09-02', { LeaveTypeID: 'annual-id' });
  assert.ok(overlappingLeave(week1, [annual]));
});

test('another employee\'s leave is not this employee\'s problem', () => {
  const someoneElse = app('2026-08-31', '2026-09-04', { EmployeeID: 'emp-2' });
  assert.equal(overlappingLeave(week1, [someoneElse], 'emp-1'), null);
  // With no employee filter it still blocks — the caller is expected to have
  // fetched one employee's applications.
  assert.ok(overlappingLeave(week1, [someoneElse]));
});

test('an unreadable date is treated as an overlap', () => {
  // Refusing a push that might be a duplicate costs a manual check. Sending
  // one that is costs a leave balance.
  assert.ok(overlappingLeave(week1, [app('', '')]), 'no dates at all');
  assert.ok(overlappingLeave(week1, [app('rubbish', '2026-09-04')]), 'half unreadable');
});

test('the refusal says who, where, when and why', () => {
  const reason = alreadyInXeroReason(
    app('2026-08-31', '2026-09-04', { Title: 'Personal/Carer\'s Leave — Janaina' }),
    'Janaina',
    'Alma Avalon'
  );
  assert.match(reason, /Alma Avalon/);
  assert.match(reason, /Janaina/);
  assert.match(reason, /2026-08-31 to 2026-09-04/);
  assert.match(reason, /pay the absence twice/);
});
