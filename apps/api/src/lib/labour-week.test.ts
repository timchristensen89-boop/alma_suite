import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { venueInstant } from '@alma/shared';
import { buildLabourWeek, shiftPaidHours, shiftSpanHours, weekDayKeys, type LabourWeekSaleInput, type LabourWeekShiftInput } from './labour-week.js';
import { classifyRosterDepartment } from './roster-department.js';
import { staffCostingRate, weeklyFixedCostCents } from './staff-pay-rates.js';

// Week of Monday 5 October 2026 (NSW Labour Day), Sydney on daylight saving
// (UTC+11) — so a Sydney morning is the previous UTC date, which is the
// case every timezone bug hides in.
const WEEK = '2026-10-05';
const VENUES = ['Alma Avalon', 'St Alma'];
const SUPER = 0.12;

const syd = (day: string, time: string) => venueInstant(day, time)!;
const utcDay = (day: string) => new Date(`${day}T00:00:00Z`);

type Profile = NonNullable<LabourWeekShiftInput['staffProfile']>;
const casual = (id: string, name: string, venue: string | null, rateCents: number | null, roleTitle = 'Chef'): Profile => ({
  id,
  firstName: name,
  lastName: '',
  venue,
  roleTitle,
  contractedWeeklyHours: null,
  employmentType: 'CASUAL',
  payRateCents: rateCents,
  trainingPayRateCents: null,
  payProfile: null
});
const salaried = (id: string, name: string, venue: string | null, annualCents: number, roleTitle = 'Head Chef'): Profile => ({
  id,
  firstName: name,
  lastName: '',
  venue,
  roleTitle,
  contractedWeeklyHours: 38,
  employmentType: 'FULL_TIME',
  payRateCents: null,
  trainingPayRateCents: null,
  payProfile: {
    employmentType: 'FULL_TIME',
    payMode: 'MANUAL_FULL_TIME',
    ordinaryHourlyRateCents: 0,
    casualLoadedHourlyRateCents: null,
    manualFullTimePayAmountCents: annualCents,
    manualFullTimePayFrequency: 'ANNUAL',
    cashHourlyRateCents: null
  }
});

let shiftSeq = 0;
const shift = (
  profile: Profile | null,
  day: string,
  start: string,
  end: string,
  opts: { venue?: string | null; area?: string | null; roleTitle?: string | null; breakMinutes?: number; status?: string } = {}
): LabourWeekShiftInput => ({
  id: `s${++shiftSeq}`,
  staffProfileId: profile?.id ?? null,
  venue: opts.venue === undefined ? (profile?.venue ?? null) : opts.venue,
  area: opts.area === undefined ? 'Kitchen' : opts.area,
  roleTitle: opts.roleTitle ?? null,
  startsAt: syd(day, start),
  endsAt: syd(day, end),
  breakMinutes: opts.breakMinutes ?? 0,
  status: opts.status ?? 'PUBLISHED',
  staffProfile: profile
});

let saleSeq = 0;
const sale = (venue: string, day: string, cents: number, source = 'alma-pos'): LabourWeekSaleInput => ({
  id: `sale${++saleSeq}`,
  venue,
  serviceDate: utcDay(day),
  salesCents: cents,
  source
});

const build = (shifts: LabourWeekShiftInput[], sales: LabourWeekSaleInput[], extra: Partial<Parameters<typeof buildLabourWeek>[0]> = {}) =>
  buildLabourWeek({ weekStart: WEEK, shifts, sales, configuredVenues: VENUES, superRate: SUPER, venueTargets: [], includeRates: true, ...extra });

const venueOf = (payload: ReturnType<typeof build>, name: string) => payload.venues.find((v) => v.venue === name)!;

describe('hours: span is what the roster shows, paid is span minus the unpaid break', () => {
  it('a 10:00–22:30 shift with a 30-minute break is 12.5h span and 12h paid', () => {
    const s = shift(casual('a', 'Andres', 'Alma Avalon', 3000), '2026-10-07', '10:00', '22:30', { breakMinutes: 30 });
    assert.equal(shiftSpanHours(s), 12.5);
    assert.equal(shiftPaidHours(s), 12);
    const payload = build([s], []);
    const avalon = venueOf(payload, 'Alma Avalon');
    assert.equal(avalon.spanHours, 12.5);
    assert.equal(avalon.paidHours, 12);
    assert.equal(avalon.byDepartment.KITCHEN.spanHours, 12.5);
    assert.equal(avalon.byDepartment.KITCHEN.paidHours, 12);
    // Cost is on PAID hours: 12h × $30.00 × 1.12 super = $403.20.
    assert.equal(avalon.costCents, 12 * 3360);
    assert.equal(payload.reconciliation.shifts[0]!.unpaidBreakHours, 0.5);
  });

  it('a shift with no break has paid hours equal to its span', () => {
    const s = shift(casual('a', 'Lu', 'Alma Avalon', 3000), '2026-10-08', '16:00', '22:00');
    assert.equal(shiftPaidHours(s), shiftSpanHours(s));
  });
});

describe('sales: one figure per venue-day, Sydney dates, actual not forecast', () => {
  it('two feeds reporting the same day are one day of takings (the larger), never summed', () => {
    const payload = build([], [sale('Alma Avalon', '2026-10-07', 300_000, 'alma-pos'), sale('Alma Avalon', '2026-10-07', 295_000, 'lightspeed-email')]);
    const avalon = venueOf(payload, 'Alma Avalon');
    assert.equal(avalon.salesCents, 300_000);
    assert.equal(avalon.salesDays, 1);
    const rows = payload.reconciliation.sales;
    assert.deepEqual(rows.map((r) => r.used), [true, false]);
  });

  it('daily sales aggregate per venue and the week is their sum; a day with no row is null, not zero', () => {
    const payload = build([], [sale('Alma Avalon', '2026-10-07', 100_000), sale('Alma Avalon', '2026-10-08', 150_000), sale('St Alma', '2026-10-07', 200_000)]);
    const avalon = venueOf(payload, 'Alma Avalon');
    assert.equal(avalon.salesCents, 250_000);
    assert.equal(avalon.salesDays, 2);
    assert.equal(avalon.days.find((d) => d.date === '2026-10-07')!.salesCents, 100_000);
    assert.equal(avalon.days.find((d) => d.date === '2026-10-09')!.salesCents, null);
    assert.equal(venueOf(payload, 'St Alma').salesCents, 200_000);
    assert.equal(payload.group.salesCents, 450_000);
  });

  it('a sales row under an alias ("Avalon", "Freshwater") lands on the configured venue, so it meets that venue\'s shifts', () => {
    const payload = build(
      [shift(casual('a', 'Andres', 'Alma Avalon', 3000), '2026-10-07', '10:00', '20:00')],
      [sale('Avalon', '2026-10-07', 100_000), sale('St Alma Freshwater', '2026-10-07', 50_000)]
    );
    assert.equal(venueOf(payload, 'Alma Avalon').salesCents, 100_000);
    assert.equal(venueOf(payload, 'St Alma').salesCents, 50_000);
    assert.equal(venueOf(payload, 'Alma Avalon').days.find((d) => d.date === '2026-10-07')!.labourPct, 33.6);
    assert.equal(payload.venues.length, 2);
  });

  it('a sales row from outside the week is ignored', () => {
    const payload = build([], [sale('Alma Avalon', '2026-10-04', 100_000), sale('Alma Avalon', '2026-10-12', 100_000)]);
    assert.equal(payload.group.salesCents, 0);
    assert.equal(payload.reconciliation.sales.length, 0);
  });

  it('a refund-adjusted feed is used as stored: the report never re-grosses or re-nets a stored figure', () => {
    // The feeds store ex-GST, net-of-refund takings (pos.service, lightspeed
    // inbound). The engine does not touch the number: a $1 feed row is $1.
    const payload = build([], [sale('Alma Avalon', '2026-10-07', 1)]);
    assert.equal(payload.group.salesCents, 1);
    assert.match(payload.methodology.sales, /net of refunds/);
  });
});

describe('venue attribution: the shift\'s venue, never only the person\'s home venue', () => {
  const caio = casual('caio', 'Caio', 'St Alma', 3000);

  it('a cross-venue employee is counted at the venue of each shift, once, and the group is the sum', () => {
    const payload = build(
      [
        shift(caio, '2026-10-08', '10:00', '16:30', { venue: 'Alma Avalon' }), // 6.5h at Avalon
        shift(caio, '2026-10-09', '10:00', '20:00', { venue: 'St Alma' }), // 10h at Freshwater
        shift(caio, '2026-10-10', '10:00', '22:00', { venue: null }) // no label → home venue (St Alma), flagged as such
      ],
      []
    );
    const avalon = venueOf(payload, 'Alma Avalon');
    const stAlma = venueOf(payload, 'St Alma');
    assert.equal(avalon.paidHours, 6.5);
    assert.equal(stAlma.paidHours, 22);
    assert.equal(payload.group.paidHours, 28.5);
    assert.equal(avalon.costCents + stAlma.costCents, payload.group.costCents);
    const person = payload.people.find((p) => p.staffProfileId === 'caio')!;
    assert.equal(person.paidHours, 28.5);
    assert.deepEqual(person.venues, [{ venue: 'St Alma', paidHours: 22 }, { venue: 'Alma Avalon', paidHours: 6.5 }]);
    const sources = payload.reconciliation.shifts.map((r) => [r.venue, r.venueSource]);
    assert.deepEqual(sources, [['Alma Avalon', 'explicit'], ['St Alma', 'explicit'], ['St Alma', 'profile']]);
  });

  it('a shift label that is not a venue is kept under that label, flagged, and the week is marked incomplete', () => {
    const payload = build([shift(caio, '2026-10-08', '10:00', '16:00', { venue: 'Both' })], []);
    const both = payload.venues.find((v) => v.venue === 'Both')!;
    assert.equal(both.venueStatus, 'invalid');
    assert.equal(both.paidHours, 6);
    assert.deepEqual(payload.incomplete.unplacedVenueLabels, ['Both']);
    assert.equal(payload.incomplete.flag, true);
    // It is in the group and in no restaurant.
    assert.equal(venueOf(payload, 'St Alma').paidHours, 0);
    assert.equal(payload.group.paidHours, 6);
  });
});

describe('kitchen / FOH / management split', () => {
  it('classifies from the shift area first, then the shift role, then the profile role, and says which decided', () => {
    assert.deepEqual(classifyRosterDepartment({ area: 'Kitchen', shiftRoleTitle: 'Floor', profileRoleTitle: 'Manager' }), { department: 'KITCHEN', basis: 'area: Kitchen' });
    assert.equal(classifyRosterDepartment({ area: 'Floor' }).department, 'FOH');
    assert.equal(classifyRosterDepartment({ area: 'Bar' }).department, 'FOH');
    assert.equal(classifyRosterDepartment({ area: 'Front of House' }).department, 'FOH');
    assert.equal(classifyRosterDepartment({ area: 'Shift', shiftRoleTitle: 'Chef de partie' }).department, 'KITCHEN');
    assert.deepEqual(classifyRosterDepartment({ area: null, shiftRoleTitle: null, profileRoleTitle: 'Head Chef' }), { department: 'KITCHEN', basis: 'profile role: Head Chef' });
    assert.equal(classifyRosterDepartment({ area: 'Kitchen Manager' }).department, 'KITCHEN');
    assert.equal(classifyRosterDepartment({ area: 'Floor Manager' }).department, 'FOH');
    assert.equal(classifyRosterDepartment({ profileRoleTitle: 'Venue Manager' }).department, 'MANAGEMENT');
    assert.equal(classifyRosterDepartment({ area: 'Shift', profileRoleTitle: 'Team member' }).department, 'UNCLASSIFIED');
  });

  it('each department has its own hours, cost and % of the SAME sales, and they sum to the total', () => {
    const payload = build(
      [
        shift(casual('a', 'Andres', 'Alma Avalon', 3000), '2026-10-07', '10:00', '20:00', { area: 'Kitchen' }), // 10h
        shift(casual('b', 'Bea', 'Alma Avalon', 2500, 'Waiter'), '2026-10-07', '16:00', '22:00', { area: 'Floor' }), // 6h
        shift(casual('c', 'Cam', 'Alma Avalon', 4000, 'Venue Manager'), '2026-10-07', '09:00', '13:00', { area: null }) // 4h
      ],
      [sale('Alma Avalon', '2026-10-07', 200_000)]
    );
    const avalon = venueOf(payload, 'Alma Avalon');
    const k = avalon.byDepartment.KITCHEN;
    const f = avalon.byDepartment.FOH;
    const m = avalon.byDepartment.MANAGEMENT;
    assert.equal(k.paidHours, 10);
    assert.equal(f.paidHours, 6);
    assert.equal(m.paidHours, 4);
    assert.equal(k.costCents, 10 * 3360);
    assert.equal(f.costCents, 6 * 2800);
    assert.equal(m.costCents, 4 * 4480);
    assert.equal(k.costCents + f.costCents + m.costCents, avalon.costCents);
    assert.equal(k.labourPct, 16.8);
    assert.equal(f.labourPct, 8.4);
    assert.equal(avalon.labourPct, Math.round(((k.costCents + f.costCents + m.costCents) / 200_000) * 1000) / 10);
  });

  it('an unclassifiable shift stays in the total, is shown as unclassified, and its hours are reported', () => {
    const payload = build([shift(casual('a', 'Pat', 'Alma Avalon', 3000, 'Team member'), '2026-10-07', '10:00', '14:00', { area: 'Shift' })], []);
    const avalon = venueOf(payload, 'Alma Avalon');
    assert.equal(avalon.byDepartment.UNCLASSIFIED.paidHours, 4);
    assert.equal(avalon.paidHours, 4);
    assert.equal(payload.incomplete.unclassifiedHours, 4);
  });
});

describe('cost: the suite costing rate, hourly on paid hours, salaried as a fixed week', () => {
  it('a casual with an hourly rate is paid hours × (rate + super at the configured rate), not the 12% constant', () => {
    const p = casual('a', 'Andres', 'Alma Avalon', 3000);
    const payload = build([shift(p, '2026-10-07', '10:00', '20:00')], [], { superRate: 0.115 });
    assert.equal(venueOf(payload, 'Alma Avalon').costCents, 10 * Math.round(3000 * 1.115));
    assert.equal(payload.methodology.superRatePct, 11.5);
  });

  it('a salaried person costs their fixed weekly salary whatever the hours, plus 1.5× past 45 paid hours', () => {
    const p = salaried('h', 'Hector', 'St Alma', 9_000_000);
    const rate = staffCostingRate(p, SUPER);
    const fixed = weeklyFixedCostCents(rate);
    assert.ok(fixed > 0);
    // 30 paid hours: fixed, no OT.
    const light = build([shift(p, '2026-10-07', '10:00', '20:00'), shift(p, '2026-10-08', '10:00', '20:00'), shift(p, '2026-10-09', '10:00', '20:00')], []);
    const lightPerson = light.people.find((x) => x.staffProfileId === 'h')!;
    assert.equal(lightPerson.salaried, true);
    assert.equal(lightPerson.estWeekCostCents, fixed);
    assert.equal(lightPerson.overtimeHours, 0);
    assert.equal(lightPerson.headroomHours, 0);
    // 50 paid hours: fixed + 5h × OT rate.
    const heavy = build(
      ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((d) => shift(p, d, '09:00', '19:00')),
      []
    );
    const heavyPerson = heavy.people.find((x) => x.staffProfileId === 'h')!;
    assert.equal(heavyPerson.overtimeHours, 5);
    assert.equal(heavyPerson.overtimeCostCents, Math.round(5 * rate.overtimeRateCents!));
    assert.equal(heavyPerson.estWeekCostCents, fixed + Math.round(5 * rate.overtimeRateCents!));
    assert.equal(heavyPerson.headroomHours, 45 - 38);
    assert.equal(heavy.totals.overtimeCostCents, heavyPerson.overtimeCostCents);
  });

  it('a salaried week is spread over the shifts by paid hours, so days and venues sum to the week to the cent', () => {
    const p = salaried('h', 'Hector', 'St Alma', 9_000_000);
    const payload = build(
      [
        shift(p, '2026-10-07', '10:00', '17:00', { venue: 'St Alma' }),
        shift(p, '2026-10-08', '10:00', '21:00', { venue: 'Alma Avalon' }),
        shift(p, '2026-10-09', '10:00', '15:00', { venue: 'St Alma' })
      ],
      []
    );
    const fixed = weeklyFixedCostCents(staffCostingRate(p, SUPER));
    const shiftCost = payload.reconciliation.shifts.reduce((sum, r) => sum + (r.costCents ?? 0), 0);
    assert.equal(shiftCost, fixed);
    const venueCost = payload.venues.reduce((sum, v) => sum + v.costCents, 0);
    assert.equal(venueCost, fixed);
    const dayCost = payload.group.byDay.reduce((sum, d) => sum + d.costCents, 0);
    assert.equal(dayCost, fixed);
    assert.equal(payload.group.costCents, fixed);
  });

  it('no weekend or public-holiday penalty is applied, the week says so, and the holiday is flagged on the day', () => {
    const p = casual('a', 'Andres', 'Alma Avalon', 3000);
    const payload = build([shift(p, '2026-10-05', '10:00', '14:00'), shift(p, '2026-10-10', '10:00', '14:00'), shift(p, '2026-10-11', '10:00', '14:00')], []);
    const avalon = venueOf(payload, 'Alma Avalon');
    for (const date of ['2026-10-05', '2026-10-10', '2026-10-11']) {
      assert.equal(avalon.days.find((d) => d.date === date)!.costCents, 4 * 3360, `${date} costed at the flat rate`);
    }
    assert.equal(avalon.days.find((d) => d.date === '2026-10-05')!.publicHoliday, 'Labour Day');
    assert.equal(avalon.days.find((d) => d.date === '2026-10-10')!.publicHoliday, null);
    assert.ok(payload.methodology.notCosted.some((line) => /penalty/i.test(line)));
  });
});

describe('missing wage rate: never $0 and a reassuring percentage', () => {
  it('a person with no rate has their hours counted, cost null, and the week flagged incomplete', () => {
    const noRate: Profile = { ...casual('n', 'Nova', 'Alma Avalon', null, 'Team member'), employmentType: 'PART_TIME' };
    const payload = build(
      [shift(noRate, '2026-10-07', '10:00', '18:00', { area: 'Floor' }), shift(casual('a', 'Andres', 'Alma Avalon', 3000), '2026-10-07', '10:00', '18:00')],
      [sale('Alma Avalon', '2026-10-07', 100_000)]
    );
    const avalon = venueOf(payload, 'Alma Avalon');
    assert.equal(avalon.paidHours, 16);
    assert.equal(avalon.costedHours, 8);
    assert.equal(avalon.uncostedHours, 8);
    assert.equal(avalon.costCents, 8 * 3360);
    assert.equal(payload.incomplete.flag, true);
    assert.equal(payload.incomplete.uncostedHours, 8);
    assert.deepEqual(payload.incomplete.uncostedPeople, [{ staffProfileId: 'n', name: 'Nova', paidHours: 8 }]);
    const person = payload.people.find((x) => x.staffProfileId === 'n')!;
    assert.equal(person.rateKnown, false);
    assert.equal(person.estWeekCostCents, null);
    assert.equal(payload.reconciliation.shifts.find((r) => r.staffProfileId === 'n')!.costCents, null);
  });

  it('a casual with no explicit rate is costed at the award default casual rate, not $0', () => {
    const payload = build([shift(casual('c', 'Cas', 'Alma Avalon', null), '2026-10-07', '10:00', '14:00')], []);
    assert.equal(payload.incomplete.flag, false);
    assert.ok(venueOf(payload, 'Alma Avalon').costCents > 0);
    assert.match(payload.people[0]!.rateSource, /casual/i);
  });
});

describe('group: dollars over dollars, never an average of percentages', () => {
  it('group % = (Avalon $ + Freshwater $) / (Avalon sales + Freshwater sales)', () => {
    const payload = build(
      [
        shift(casual('a', 'Andres', 'Alma Avalon', 3000), '2026-10-07', '10:00', '20:00'), // $336 on $1,000 = 33.6%
        shift(casual('j', 'Joao', 'St Alma', 3000), '2026-10-07', '10:00', '20:00') // $336 on $4,000 = 8.4%
      ],
      [sale('Alma Avalon', '2026-10-07', 100_000), sale('St Alma', '2026-10-07', 400_000)]
    );
    const avalon = venueOf(payload, 'Alma Avalon');
    const stAlma = venueOf(payload, 'St Alma');
    assert.equal(avalon.labourPct, 33.6);
    assert.equal(stAlma.labourPct, 8.4);
    assert.equal(payload.group.costCents, avalon.costCents + stAlma.costCents);
    assert.equal(payload.group.salesCents, avalon.salesCents + stAlma.salesCents);
    assert.equal(payload.group.labourPct, 13.4); // 672 / 5000
    assert.notEqual(payload.group.labourPct, (33.6 + 8.4) / 2);
  });

  it('Avalon + Freshwater = Group for sales, hours and labour dollars, per day and for the week', () => {
    const payload = build(
      [
        shift(casual('a', 'Andres', 'Alma Avalon', 3000), '2026-10-07', '10:00', '20:00', { breakMinutes: 30 }),
        shift(salaried('h', 'Hector', 'St Alma', 9_000_000), '2026-10-07', '10:00', '20:00'),
        shift(casual('caio', 'Caio', 'St Alma', 3100), '2026-10-08', '10:00', '16:30', { venue: 'Alma Avalon' })
      ],
      [sale('Alma Avalon', '2026-10-07', 100_000), sale('St Alma', '2026-10-07', 200_000), sale('Alma Avalon', '2026-10-08', 50_000)]
    );
    const sum = (pick: (v: (typeof payload.venues)[number]) => number) => payload.venues.reduce((s, v) => s + pick(v), 0);
    assert.equal(sum((v) => v.salesCents), payload.group.salesCents);
    assert.equal(sum((v) => v.paidHours), payload.group.paidHours);
    assert.equal(sum((v) => v.spanHours), payload.group.spanHours);
    assert.equal(sum((v) => v.costCents), payload.group.costCents);
    for (const date of payload.dayKeys) {
      const g = payload.group.byDay.find((d) => d.date === date)!;
      const cells = payload.venues.map((v) => v.days.find((d) => d.date === date)!);
      assert.equal(cells.reduce((s, c) => s + c.costCents, 0), g.costCents, `${date} cost`);
      assert.equal(cells.reduce((s, c) => s + c.paidHours, 0), g.paidHours, `${date} hours`);
      assert.equal(cells.reduce((s, c) => s + (c.salesCents ?? 0), 0), g.salesCents ?? 0, `${date} sales`);
    }
  });

  it('the group target is the venues\' configured target, and the variance is in points', () => {
    const payload = build(
      [shift(casual('a', 'Andres', 'Alma Avalon', 3000), '2026-10-07', '10:00', '20:00')],
      [sale('Alma Avalon', '2026-10-07', 100_000)],
      { venueTargets: [{ name: 'Alma Avalon', targetWagePercent: 28 }, { name: 'St Alma' }] }
    );
    const avalon = venueOf(payload, 'Alma Avalon');
    assert.deepEqual(avalon.target, { wagePct: 28, configured: true, source: 'venue', variancePts: 5.6 });
    assert.equal(venueOf(payload, 'St Alma').target!.configured, false);
    assert.equal(payload.group.target!.source, 'group_average');
  });
});

describe('week and timezone: Sydney days, Monday to Sunday, whatever zone the server or device is in', () => {
  it('weekDayKeys is the seven Sydney dates from the Monday', () => {
    assert.deepEqual(weekDayKeys(WEEK), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  });

  it('a Sunday 23:30 shift is Sunday; a shift at 01:00 Monday Sydney (still Sunday in UTC) belongs to the NEXT week', () => {
    const p = casual('a', 'Andres', 'Alma Avalon', 3000);
    const sundayLate = shift(p, '2026-10-11', '23:00', '23:59');
    const nextMondayEarly: LabourWeekShiftInput = { ...shift(p, '2026-10-12', '01:00', '03:00'), id: 'next' };
    assert.equal(nextMondayEarly.startsAt.toISOString(), '2026-10-11T14:00:00.000Z'); // UTC says Sunday
    const payload = build([sundayLate, nextMondayEarly], []);
    assert.deepEqual(payload.reconciliation.shifts.map((r) => [r.shiftId, r.date]), [[sundayLate.id, '2026-10-11']]);
  });

  it('a shift at 01:00 Monday Sydney (Sunday in UTC) belongs to THIS week', () => {
    const p = casual('a', 'Andres', 'Alma Avalon', 3000);
    const mondayEarly = shift(p, '2026-10-05', '01:00', '03:00');
    assert.equal(mondayEarly.startsAt.toISOString(), '2026-10-04T14:00:00.000Z');
    const payload = build([mondayEarly], []);
    assert.equal(payload.reconciliation.shifts[0]!.date, '2026-10-05');
  });

  it('the week is keyed by the weekStart string the client sends, so a device in Perth or Lisbon gets the same Sydney week', () => {
    const p = casual('a', 'Andres', 'Alma Avalon', 3000);
    const shifts = [shift(p, '2026-10-07', '10:00', '20:00')];
    const sales = [sale('Alma Avalon', '2026-10-07', 100_000)];
    const a = build(shifts, sales);
    const b = build(shifts, sales, { timeZone: 'Australia/Sydney' });
    assert.deepEqual(a, b);
    // Keying by the UTC date instead would move a Sydney-morning shift to the day before.
    const morning = shift(p, '2026-10-07', '08:00', '12:00');
    assert.equal(morning.startsAt.toISOString().slice(0, 10), '2026-10-06');
    assert.equal(build([morning], []).reconciliation.shifts[0]!.date, '2026-10-07');
  });
});

describe('partial data and status', () => {
  it('a venue with takings on only some days reports how many days have takings and leaves the other cells unpriced', () => {
    const p = casual('a', 'Andres', 'Alma Avalon', 3000);
    const payload = build(
      [shift(p, '2026-10-07', '10:00', '20:00'), shift(p, '2026-10-08', '10:00', '20:00')],
      [sale('Alma Avalon', '2026-10-07', 100_000)]
    );
    const avalon = venueOf(payload, 'Alma Avalon');
    assert.equal(avalon.salesDays, 1);
    assert.equal(avalon.days.find((d) => d.date === '2026-10-08')!.salesCents, null);
    assert.equal(avalon.days.find((d) => d.date === '2026-10-08')!.labourPct, null);
    assert.equal(avalon.days.find((d) => d.date === '2026-10-07')!.labourPct, 33.6);
  });

  it('open shifts are unfilled hours, not labour, and a cancelled or draft shift is not in the week', () => {
    // The service only loads PUBLISHED and COMPLETED; the engine still takes whatever it is given.
    const payload = build([shift(null, '2026-10-07', '10:00', '16:00', { venue: 'Alma Avalon' })], []);
    const avalon = venueOf(payload, 'Alma Avalon');
    assert.equal(avalon.openHours, 6);
    assert.equal(avalon.paidHours, 0);
    assert.equal(avalon.costCents, 0);
    assert.equal(payload.reconciliation.shifts[0]!.name, 'Open shift');
  });

  it('a salaried worker with no shift this week is listed as excluded, never silently dropped or silently added', () => {
    const idle = salaried('g', 'Grace', 'St Alma', 8_000_000);
    const payload = build([], [], { activeSalariedStaff: [idle, casual('c', 'Cas', 'St Alma', 3000)] });
    assert.deepEqual(payload.incomplete.unrosteredSalaried.map((s) => s.staffProfileId), ['g']);
    assert.equal(payload.group.costCents, 0);
  });
});

describe('permissions: rates and per-shift cost only for readers allowed to see pay', () => {
  it('without includeRates the shift rows carry hours and department but no rate or cost', () => {
    const payload = build([shift(casual('a', 'Andres', 'Alma Avalon', 3000), '2026-10-07', '10:00', '20:00')], [], { includeRates: false });
    const row = payload.reconciliation.shifts[0]!;
    assert.equal(row.paidHours, 10);
    assert.equal('rateCents' in row, false);
    assert.equal('costCents' in row, false);
    assert.equal(payload.reconciliation.ratesVisible, false);
    // Totals are still there for the manager.
    assert.equal(venueOf(payload, 'Alma Avalon').costCents, 10 * 3360);
  });
});
