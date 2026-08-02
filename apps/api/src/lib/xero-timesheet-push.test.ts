import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyEarningsRateName,
  dayRateKind,
  entryHours,
  groupIntoPeriods,
  hasHours,
  parseXeroDate,
  payPeriodFor,
  splitUnitsByDay,
  unitsForPeriod
} from '@alma/shared';

test('payPeriodFor returns the week a date falls in for a weekly calendar', () => {
  // Calendar starts Monday 2026-07-06.
  assert.deepEqual(payPeriodFor('2026-07-09', '2026-07-06', 'WEEKLY'), {
    start: '2026-07-06',
    end: '2026-07-12',
    days: 7
  });
});

test('payPeriodFor puts the first and last day in their own period, not the next', () => {
  assert.equal(payPeriodFor('2026-07-06', '2026-07-06', 'WEEKLY')?.start, '2026-07-06');
  assert.equal(payPeriodFor('2026-07-12', '2026-07-06', 'WEEKLY')?.start, '2026-07-06');
  assert.equal(payPeriodFor('2026-07-13', '2026-07-06', 'WEEKLY')?.start, '2026-07-13');
});

test('payPeriodFor honours a fortnight offset from our idea of a week', () => {
  // Xero's fortnight starts Wednesday 2026-07-01. The following Tuesday is
  // still inside it; the Wednesday after starts the next one.
  assert.deepEqual(payPeriodFor('2026-07-14', '2026-07-01', 'FORTNIGHTLY'), {
    start: '2026-07-01',
    end: '2026-07-14',
    days: 14
  });
  assert.equal(payPeriodFor('2026-07-15', '2026-07-01', 'FORTNIGHTLY')?.start, '2026-07-15');
});

test('payPeriodFor handles a work date before the calendar start', () => {
  // Floor, not truncate — otherwise 2026-06-29 and 2026-07-06 share a period.
  assert.deepEqual(payPeriodFor('2026-06-29', '2026-07-06', 'WEEKLY'), {
    start: '2026-06-29',
    end: '2026-07-05',
    days: 7
  });
});

test('payPeriodFor ignores a time component and is case-insensitive', () => {
  assert.equal(payPeriodFor('2026-07-09T23:30:00.000Z', '2026-07-06', 'WEEKLY')?.start, '2026-07-06');
  assert.equal(payPeriodFor(new Date('2026-07-09T13:00:00.000Z'), '2026-07-06', 'weekly')?.start, '2026-07-06');
});

test('payPeriodFor returns null for calendars with no fixed day stride', () => {
  assert.equal(payPeriodFor('2026-07-09', '2026-07-01', 'MONTHLY'), null);
  assert.equal(payPeriodFor('2026-07-09', '2026-07-01', 'TWICEMONTHLY'), null);
});

const WEEK = { start: '2026-07-06', end: '2026-07-12', days: 7 };

test('unitsForPeriod lays hours out one per day with zeros for days off', () => {
  const units = unitsForPeriod(
    [
      { workDate: '2026-07-06', hours: 8 },
      { workDate: '2026-07-09', hours: 6.5 }
    ],
    WEEK
  );
  assert.deepEqual(units, [8, 0, 0, 6.5, 0, 0, 0]);
});

test('unitsForPeriod sums two shifts on one day instead of emitting two entries', () => {
  const units = unitsForPeriod(
    [
      { workDate: '2026-07-08', hours: 4 },
      { workDate: '2026-07-08', hours: 3.5 }
    ],
    WEEK
  );
  assert.equal(units[2], 7.5);
  assert.equal(units.length, 7);
});

test('unitsForPeriod drops entries outside the period instead of writing past the array', () => {
  const units = unitsForPeriod(
    [
      { workDate: '2026-07-05', hours: 8 },
      { workDate: '2026-07-13', hours: 8 },
      { workDate: '2026-07-10', hours: 5 }
    ],
    WEEK
  );
  assert.deepEqual(units, [0, 0, 0, 0, 5, 0, 0]);
});

test('unitsForPeriod rounds float noise out of the payslip', () => {
  // 8h of millisecond arithmetic can land as 7.999999999999999.
  assert.equal(unitsForPeriod([{ workDate: '2026-07-06', hours: 7.999999999999999 }], WEEK)[0], 8);
});

test('unitsForPeriod always returns exactly as many numbers as the period has days', () => {
  assert.equal(unitsForPeriod([], { start: '2026-07-01', end: '2026-07-14', days: 14 }).length, 14);
});

test('hasHours is false for an all-zero week so we never post an empty timesheet', () => {
  assert.equal(hasHours([0, 0, 0, 0, 0, 0, 0]), false);
  assert.equal(hasHours([0, 0, 0.5, 0, 0, 0, 0]), true);
});

test('entryHours deducts the unpaid break', () => {
  assert.equal(
    entryHours({
      clockInAt: new Date('2026-07-06T07:00:00.000Z'),
      clockOutAt: new Date('2026-07-06T15:00:00.000Z'),
      breakMinutes: 30
    }),
    7.5
  );
});

test('entryHours never returns negative hours when the break swallows the shift', () => {
  assert.equal(
    entryHours({
      clockInAt: new Date('2026-07-06T07:00:00.000Z'),
      clockOutAt: new Date('2026-07-06T07:15:00.000Z'),
      breakMinutes: 30
    }),
    0
  );
});

test('groupIntoPeriods splits a selected week that straddles two Xero fortnights', () => {
  const groups = groupIntoPeriods(
    [
      { workDate: '2026-07-13', hours: 8 },
      { workDate: '2026-07-14', hours: 8 },
      { workDate: '2026-07-16', hours: 8 }
    ],
    '2026-07-01',
    'FORTNIGHTLY'
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.period.start, '2026-07-01');
  assert.equal(groups[0]?.entries.length, 2);
  assert.equal(groups[1]?.period.start, '2026-07-15');
  assert.equal(groups[1]?.entries.length, 1);
});

test('groupIntoPeriods returns periods in date order', () => {
  const groups = groupIntoPeriods(
    [
      { workDate: '2026-07-20', hours: 4 },
      { workDate: '2026-07-06', hours: 4 },
      { workDate: '2026-07-13', hours: 4 }
    ],
    '2026-07-06',
    'WEEKLY'
  );
  assert.deepEqual(groups.map((group) => group.period.start), ['2026-07-06', '2026-07-13', '2026-07-20']);
});

test('groupIntoPeriods drops entries whose calendar type has no fixed stride', () => {
  assert.deepEqual(groupIntoPeriods([{ workDate: '2026-07-06', hours: 4 }], '2026-07-01', 'MONTHLY'), []);
});

test('parseXeroDate reads the .NET date form Xero payroll returns', () => {
  assert.equal(parseXeroDate('/Date(1783296000000+0000)/')?.toISOString(), '2026-07-06T00:00:00.000Z');
});

test('parseXeroDate reads a plain ISO date too', () => {
  assert.equal(parseXeroDate('2026-07-06')?.toISOString(), '2026-07-06T00:00:00.000Z');
});

test('parseXeroDate returns null rather than an Invalid Date', () => {
  assert.equal(parseXeroDate(null), null);
  assert.equal(parseXeroDate(''), null);
  assert.equal(parseXeroDate('not a date'), null);
});

test('dayRateKind names the award rate a day belongs on', () => {
  // 2026-07-25 is a Saturday, 2026-07-26 a Sunday, 2026-07-27 a Monday.
  assert.equal(dayRateKind('2026-07-25'), 'saturday');
  assert.equal(dayRateKind('2026-07-26'), 'sunday');
  assert.equal(dayRateKind('2026-07-27'), 'weekday');
  assert.equal(dayRateKind('2026-07-24'), 'weekday');
});

test('splitUnitsByDay puts weekend hours on their own lines', () => {
  // Week of Mon 2026-07-20: Sat is index 5, Sun index 6.
  const period = { start: '2026-07-20', end: '2026-07-26', days: 7 };
  const split = splitUnitsByDay(
    [
      { workDate: '2026-07-21', hours: 8 },
      { workDate: '2026-07-25', hours: 6 },
      { workDate: '2026-07-26', hours: 5 }
    ],
    period
  );
  assert.deepEqual(split.weekday, [0, 8, 0, 0, 0, 0, 0]);
  assert.deepEqual(split.saturday, [0, 0, 0, 0, 0, 6, 0]);
  assert.deepEqual(split.sunday, [0, 0, 0, 0, 0, 0, 5]);
});

test('splitUnitsByDay keeps every line the full length of the period', () => {
  const period = { start: '2026-07-01', end: '2026-07-14', days: 14 };
  const split = splitUnitsByDay([{ workDate: '2026-07-04', hours: 4 }], period);
  assert.equal(split.weekday.length, 14);
  assert.equal(split.saturday.length, 14);
  assert.equal(split.sunday.length, 14);
});

test('splitUnitsByDay sums two shifts on one weekend day', () => {
  const period = { start: '2026-07-20', end: '2026-07-26', days: 7 };
  const split = splitUnitsByDay(
    [
      { workDate: '2026-07-25', hours: 4 },
      { workDate: '2026-07-25', hours: 3.5 }
    ],
    period
  );
  assert.equal(split.saturday[5], 7.5);
});

test('classifyEarningsRateName reads the award names Xero actually carries', () => {
  assert.equal(classifyEarningsRateName('Casual F&B Gr2 Saturday'), 'saturday');
  assert.equal(classifyEarningsRateName('Casual F&B Gr2 Sunday'), 'sunday');
  assert.equal(classifyEarningsRateName('Casual F&B Gr2 Weekdays '), 'weekday');
  assert.equal(classifyEarningsRateName('Casual F&B Gr2 Public Holiday'), 'publicHoliday');
  assert.equal(classifyEarningsRateName('Ordinary Hours'), 'weekday');
});

test('classifyEarningsRateName refuses to guess', () => {
  // An unrecognised rate must not be promoted onto a penalty rate.
  assert.equal(classifyEarningsRateName('Overtime Hours (exempt from super)'), null);
  assert.equal(classifyEarningsRateName('Redundancy'), null);
  assert.equal(classifyEarningsRateName(''), null);
  assert.equal(classifyEarningsRateName(null), null);
});
