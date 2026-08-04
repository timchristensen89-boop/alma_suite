import test from 'node:test';
import assert from 'node:assert/strict';
import { timesheetFromClockSession, MAX_SESSION_HOURS, type FinishedClockSession } from '@alma/shared';

/**
 * A clock session becoming a timesheet. This decides what somebody is paid, so
 * the cases below are the ones that actually happen on a venue floor: a night
 * shift finishing after midnight, a forgotten clock-out, a break longer than
 * the shift it was taken from.
 */

/** Sydney is UTC+10 in winter, so 18:00 local is 08:00Z. */
function sydney(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
    (h ?? 0) - 10,
    m ?? 0
  ));
}

function session(overrides: Partial<FinishedClockSession> = {}): FinishedClockSession {
  return {
    id: 'session-1',
    staffProfileId: 'staff-1',
    rosterShiftId: 'shift-1',
    venue: 'Alma Avalon',
    area: 'Floor',
    roleTitle: 'Floor staff',
    clockInAt: sydney('2026-08-04', '17:00'),
    clockOutAt: sydney('2026-08-04', '23:00'),
    accumulatedBreakMinutes: 30,
    managerNote: null,
    ...overrides
  };
}

function draftOf(result: ReturnType<typeof timesheetFromClockSession>) {
  assert.ok('draft' in result, 'expected a draft, got a rejection');
  return result.draft;
}

test('an ordinary shift becomes a timesheet with paid hours net of break', () => {
  const draft = draftOf(timesheetFromClockSession(session()));
  assert.equal(draft.hours, 5.5); // six hours less a thirty-minute break
  assert.equal(draft.breakMinutes, 30);
  assert.equal(draft.venue, 'Alma Avalon');
  assert.equal(draft.roleTitle, 'Floor staff');
  assert.equal(draft.rosterShiftId, 'shift-1');
  assert.equal(draft.clockSessionId, 'session-1');
});

test('a night shift is dated the day it started, not the day it ended', () => {
  // On at 6pm Monday, off at 1am Tuesday. Payroll weeks and penalty rates run
  // off the day worked; dating this to Tuesday moves it into the wrong week.
  const draft = draftOf(
    timesheetFromClockSession(
      session({
        clockInAt: sydney('2026-08-03', '18:00'),
        clockOutAt: sydney('2026-08-04', '01:00'),
        accumulatedBreakMinutes: 0
      })
    )
  );
  assert.equal(draft.workDate.toISOString().slice(0, 10), '2026-08-03');
  assert.equal(draft.hours, 7);
});

test('a forgotten clock-out is refused rather than paid', () => {
  const result = timesheetFromClockSession(
    session({
      clockInAt: sydney('2026-08-03', '17:00'),
      clockOutAt: sydney('2026-08-05', '09:00') // 40 hours
    })
  );
  assert.ok('rejected' in result);
  assert.match(result.rejected.reason, /missed clock-out/);
});

test('a shift exactly at the limit still converts', () => {
  const draft = draftOf(
    timesheetFromClockSession(
      session({
        clockInAt: sydney('2026-08-04', '06:00'),
        clockOutAt: sydney('2026-08-04', `${6 + MAX_SESSION_HOURS}:00`),
        accumulatedBreakMinutes: 0
      })
    )
  );
  assert.equal(draft.hours, MAX_SESSION_HOURS);
});

test('a break longer than the shift cannot make the hours negative', () => {
  const draft = draftOf(
    timesheetFromClockSession(
      session({
        clockInAt: sydney('2026-08-04', '17:00'),
        clockOutAt: sydney('2026-08-04', '18:00'),
        accumulatedBreakMinutes: 120
      })
    )
  );
  assert.equal(draft.hours, 0);
  assert.equal(draft.breakMinutes, 60, 'break is capped at the length of the shift');
});

test('a session still open produces nothing', () => {
  const result = timesheetFromClockSession(session({ clockOutAt: null }));
  assert.ok('rejected' in result);
  assert.match(result.rejected.reason, /still open/);
});

test('clocking out before clocking in is refused', () => {
  const result = timesheetFromClockSession(
    session({ clockInAt: sydney('2026-08-04', '17:00'), clockOutAt: sydney('2026-08-04', '16:00') })
  );
  assert.ok('rejected' in result);
  assert.match(result.rejected.reason, /not after/);
});

test('a session with no rostered shift still becomes a timesheet', () => {
  // People get called in. The hours are real whether or not anyone planned them.
  const draft = draftOf(timesheetFromClockSession(session({ rosterShiftId: null, accumulatedBreakMinutes: 0 })));
  assert.equal(draft.rosterShiftId, null);
  assert.equal(draft.hours, 6);
});

test('minutes are not lost to rounding', () => {
  const draft = draftOf(
    timesheetFromClockSession(
      session({
        clockInAt: sydney('2026-08-04', '17:00'),
        clockOutAt: sydney('2026-08-04', '22:20'),
        accumulatedBreakMinutes: 25
      })
    )
  );
  // 5h20m less 25m = 4h55m = 4.92h
  assert.equal(draft.hours, 4.92);
});

test('a manager note is carried onto the timesheet', () => {
  const draft = draftOf(timesheetFromClockSession(session({ managerNote: '  Stayed to close  ' })));
  assert.equal(draft.notes, 'Stayed to close');
});

test('a session across the daylight-saving change is still dated correctly', () => {
  // NSW clocks go forward on the first Sunday in October; the venue day helper
  // handles the 23-hour day, so a shift starting that evening still belongs to
  // the day it started.
  const draft = draftOf(
    timesheetFromClockSession(
      session({
        clockInAt: new Date('2026-10-04T08:00:00.000Z'),
        clockOutAt: new Date('2026-10-04T13:00:00.000Z'),
        accumulatedBreakMinutes: 0
      })
    )
  );
  assert.equal(draft.workDate.toISOString().slice(0, 10), '2026-10-04');
  assert.equal(draft.hours, 5);
});
