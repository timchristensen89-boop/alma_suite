import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeOpenTimes,
  parseWallClock,
  venueDayKey,
  venueDayStart,
  venueWeekday,
  type SlotRule
} from './enquiry-availability.js';

// St Alma's real groups rule, as imported from SevenRooms: 8–20 people,
// Wed–Sun, 4.15pm to a 8.30pm last start, 20 covers an interval.
const groupsRule = (over: Partial<SlotRule> = {}): SlotRule => ({
  id: 'rule-groups',
  servicePeriod: 'DINNER',
  daysOfWeek: [0, 3, 4, 5, 6],
  startTime: '16:15',
  endTime: '23:00',
  intervalMinutes: 15,
  defaultDurationMinutes: 150,
  minPartySize: 8,
  maxPartySize: 20,
  capacity: 20,
  ...over
});

// Saturday 5 September 2026, Sydney. AEST (+10) — outside daylight saving.
const SAT_DAY_START = new Date('2026-09-04T14:00:00Z');
const at = (minutes: number) => new Date(SAT_DAY_START.getTime() + minutes * 60_000);

const day = (over: Partial<Parameters<typeof computeOpenTimes>[0]> = {}) =>
  computeOpenTimes({
    dayStart: SAT_DAY_START,
    weekday: 6,
    partySize: 18,
    rules: [groupsRule()],
    reservations: [],
    blackouts: [],
    ...over
  });

test('a venue that has stated nothing is UNKNOWN, never "no"', () => {
  // The same rule the roster board applies: no rows means nothing has been
  // said. Answering "we are full" off an empty table would be a lie.
  const verdict = computeOpenTimes({
    dayStart: SAT_DAY_START,
    weekday: 6,
    partySize: 18,
    rules: [],
    reservations: [],
    blackouts: []
  });
  assert.equal(verdict.kind, 'UNKNOWN');
});

test('an empty Saturday offers every start the rule allows', () => {
  const verdict = day();
  assert.equal(verdict.kind, 'OPEN');
  assert.ok(verdict.kind === 'OPEN');
  // 16:15 through 20:30 on 15s: the last start whose 150 minutes still fit
  // inside the 23:00 finish.
  assert.equal(verdict.startMinutes[0], 16 * 60 + 15);
  assert.equal(verdict.startMinutes[verdict.startMinutes.length - 1], 20 * 60 + 30);
  assert.equal(verdict.startMinutes.length, 18);
});

test('a party the rules do not cover is NONE, not a guess', () => {
  // 27 people: bigger than any stated rule at either venue today. The draft
  // must fall back to asking rather than inventing a room.
  assert.equal(day({ partySize: 27 }).kind, 'NONE');
});

test('the wrong weekday is closed', () => {
  assert.equal(day({ weekday: 1 }).kind, 'NONE');
});

test('booked covers close the slots they overlap', () => {
  // A group of 18 sitting 6pm–8.30pm leaves 2 of the rule's 20 covers, so
  // every start whose two and a half hours run into theirs is gone. 8.30pm
  // survives because it begins as they finish — the overlap test is
  // half-open, and getting that wrong would cost the venue a real booking.
  const verdict = day({
    reservations: [
      {
        covers: 18,
        startsAt: at(18 * 60),
        endsAt: at(20 * 60 + 30),
        availabilityRuleId: 'rule-groups',
        servicePeriod: 'DINNER'
      }
    ]
  });
  assert.ok(verdict.kind === 'OPEN');
  assert.equal(verdict.startMinutes.includes(18 * 60), false, '6pm is taken');
  assert.equal(verdict.startMinutes.includes(16 * 60 + 15), false, '4.15pm runs into it');
  assert.equal(verdict.startMinutes.includes(20 * 60 + 30), true, '8.30pm starts as they leave');
});

test('a full day is NONE', () => {
  const verdict = day({
    reservations: [
      {
        covers: 20,
        startsAt: at(16 * 60),
        endsAt: at(23 * 60),
        availabilityRuleId: 'rule-groups',
        servicePeriod: 'DINNER'
      }
    ]
  });
  assert.equal(verdict.kind, 'NONE');
});

test("another rule's booking does not eat this rule's covers", () => {
  // Alma's rules are split by party size on purpose so capacity is not
  // double-counted; a booking held against lunch must not close groups.
  const verdict = day({
    reservations: [
      {
        covers: 20,
        startsAt: at(16 * 60),
        endsAt: at(23 * 60),
        availabilityRuleId: 'rule-lunch',
        servicePeriod: 'LUNCH'
      }
    ]
  });
  assert.equal(verdict.kind, 'OPEN');
});

test('a blackout closes the slots it covers', () => {
  const verdict = day({ blackouts: [{ startAt: at(17 * 60), endAt: at(19 * 60) }] });
  assert.ok(verdict.kind === 'OPEN');
  assert.equal(verdict.startMinutes.includes(17 * 60), false);
  assert.equal(verdict.startMinutes.includes(19 * 60), true);
});

test('a malformed rule row is skipped, not thrown', () => {
  // A bad row must not stop staff opening the thread.
  assert.equal(day({ rules: [groupsRule({ startTime: 'evening' })] }).kind, 'NONE');
  assert.equal(parseWallClock('25:00'), null);
  assert.equal(parseWallClock('16:15'), 975);
});

test('the venue day is the venue\'s, not the server\'s', () => {
  // The container runs UTC. 9am Sydney on 5 September is 11pm UTC on the 4th;
  // read in UTC the whole day lands on the wrong date and every overlap check
  // misses. These are the assertions that keep that from coming back.
  const morning = new Date('2026-09-04T23:00:00Z');
  assert.equal(venueDayKey(morning), '2026-09-05');
  assert.equal(venueDayStart(morning).toISOString(), '2026-09-04T14:00:00.000Z');
  assert.equal(venueWeekday(morning), 6);
});

test('daylight saving moves the start of the day', () => {
  // NSW puts clocks forward on the first Sunday in October. 4 October 2026
  // starts at +10 and ends at +11, and the day is 23 hours long.
  const dstMorning = new Date('2026-10-03T20:00:00Z'); // 6am Sun 4 Oct Sydney
  assert.equal(venueDayKey(dstMorning), '2026-10-04');
  assert.equal(venueDayStart(dstMorning).toISOString(), '2026-10-03T14:00:00.000Z');
  // And the day after is a full hour earlier in UTC, because +11 is in force.
  const afterDst = new Date('2026-10-05T02:00:00Z');
  assert.equal(venueDayStart(afterDst).toISOString(), '2026-10-04T13:00:00.000Z');
});
