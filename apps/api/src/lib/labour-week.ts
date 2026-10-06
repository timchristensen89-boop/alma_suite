// The Labour vs takings week, built once from rows and nothing else.
//
// This is the engine behind GET /api/staff/labour-week. It is pure — shifts,
// sales rows, configured venues, the super rate and the venue targets go in;
// the whole payload comes out — so every rule below is covered by
// labour-week.test.ts and a number on the page can be traced to the rows
// that made it (the payload carries them, see `reconciliation`).
//
// What it fixes, each of which the page used to get wrong:
//
//   • HOURS. One figure was shown as "Rostered" but was span minus breaks.
//     Both concepts are now carried — `spanHours` (what the roster board
//     shows, start to end) and `paidHours` (span minus the unpaid break) —
//     and the page says which is which. Cost is always on paid hours.
//   • VENUE. A shift's venue label was used raw: "Avalon" and "Alma Avalon"
//     were two venues, a shift with no label was "Unassigned venue" even
//     when the person works at one venue, and a sales row under an alias
//     never met its shifts. Shifts now go through lib/labour-allocation
//     (explicit venue label, else profile venue, else flagged) and sales
//     through @alma/shared resolveVenueLabel, so a venue's sales and its
//     labour are keyed the same way. Attribution is from the SHIFT's venue
//     first — a Caio shift at Avalon is Avalon labour whatever his home
//     venue says — and every shift lands in exactly one venue.
//   • DEPARTMENT. Kitchen, FOH and management are split from the shift's
//     area / role (lib/roster-department), each with hours, cost and its
//     own % of the same sales. "Labour %" is never kitchen-only in
//     disguise, and a shift nobody can place is shown as unclassified.
//   • COST. Cost follows the suite's documented labour methodology
//     (docs/metric-definitions.md): the resolved costing rate from
//     lib/staff-pay-rates (award / agreed rate incl. super at the
//     CONFIGURED rate — the page used to fall back to the 12% constant),
//     hourly people on paid hours, salaried people at their fixed weekly
//     cost plus overtime past 45h, allocated across their shifts by paid
//     hours so Σ days = Σ venues = the week, to the cent. A person with no
//     rate is NOT costed at $0 and quietly shown as a reassuring %: their
//     hours are counted, their cost is `null`, and the week is flagged
//     `incomplete` with who and how many hours are uncosted.
//   • GROUP. The group % is group dollars over group sales — never the
//     mean of the venue percentages.
//   • TIME. Days are Sydney days (venueDayKey); the week is Monday to
//     Sunday in Sydney whatever the server or browser zone is.
//
// What it deliberately does NOT do, and says so in the payload
// (`methodology`): weekend and public-holiday penalty rates and casual
// loading as a multiplier are not part of the suite's costing engine
// anywhere, so they are not invented here. Holidays in the week are
// flagged on the day so nobody reads a flat-rate figure as a holiday-aware
// one. Timesheets (actual hours) are a different report (Prime cost).

import {
  DEPARTMENTS,
  resolveCostTargets,
  resolveVenueLabel,
  venueDayKey,
  type DepartmentFigures,
  type LabourFigures,
  type LabourWeekDayCell,
  type LabourWeekPayload,
  type LabourWeekPerson,
  type LabourWeekSaleRow,
  type LabourWeekShiftRow,
  type LabourWeekVenue,
  type RosterDepartment,
  type VenueTargetInput
} from '@alma/shared';
export type { LabourWeekPayload } from '@alma/shared';
import { resolveLabourVenue, type LabourVenueKey } from './labour-allocation.js';
import { nswHolidayName } from './nsw-holidays.js';
import { classifyRosterDepartment } from './roster-department.js';
import { FULL_TIME_ORDINARY_WEEKLY_HOURS, staffCostingRate, weeklyFixedCostCents, type StaffCostProfile } from './staff-pay-rates.js';
import { bestVenueDaySales } from './sales-day-totals.js';

export type LabourWeekShiftInput = {
  id: string;
  staffProfileId: string | null;
  venue: string | null;
  area: string | null;
  roleTitle: string | null;
  startsAt: Date;
  endsAt: Date;
  breakMinutes: number;
  status: string;
  staffProfile:
    | ({
        id: string;
        firstName: string;
        lastName: string;
        venue: string | null;
        roleTitle: string | null;
        contractedWeeklyHours: number | null;
      } & StaffCostProfile)
    | null;
};

export type LabourWeekSaleInput = {
  id: string;
  venue: string;
  serviceDate: Date;
  salesCents: number;
  source: string;
  notes?: string | null;
};

/** A salaried worker who is active but has no shift this week — excluded from the roster cost, and said so. */
export type UnrosteredSalariedInput = { id: string; firstName: string; lastName: string; venue: string | null } & StaffCostProfile;

export type LabourWeekBuildInput = {
  weekStart: string;
  shifts: LabourWeekShiftInput[];
  sales: LabourWeekSaleInput[];
  configuredVenues: string[];
  superRate: number;
  venueTargets: VenueTargetInput[];
  activeSalariedStaff?: UnrosteredSalariedInput[];
  /** Whether per-shift rates and costs may be shown to this reader. */
  includeRates: boolean;
  timeZone?: string;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;
export const pct1 = (numerator: number, denominator: number | null): number | null =>
  denominator != null && denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

export function weekDayKeys(weekStart: string): string[] {
  const base = new Date(`${weekStart}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + i * 24 * 3_600_000).toISOString().slice(0, 10));
}

export function shiftSpanHours(shift: { startsAt: Date; endsAt: Date }): number {
  return Math.max(0, (shift.endsAt.getTime() - shift.startsAt.getTime()) / 3_600_000);
}

export function shiftPaidHours(shift: { startsAt: Date; endsAt: Date; breakMinutes: number }): number {
  return Math.max(0, shiftSpanHours(shift) - Math.max(0, shift.breakMinutes ?? 0) / 60);
}

const emptyDepartment = (): DepartmentFigures => ({ spanHours: 0, paidHours: 0, costedHours: 0, uncostedHours: 0, costCents: 0, labourPct: null });
const emptyFigures = (): LabourFigures => ({
  ...emptyDepartment(),
  openHours: 0,
  byDepartment: { KITCHEN: emptyDepartment(), FOH: emptyDepartment(), MANAGEMENT: emptyDepartment(), UNCLASSIFIED: emptyDepartment() }
});

function addTo(target: DepartmentFigures, span: number, paid: number, costCents: number | null) {
  target.spanHours += span;
  target.paidHours += paid;
  if (costCents == null) target.uncostedHours += paid;
  else {
    target.costedHours += paid;
    target.costCents += costCents;
  }
}

function finish(figures: LabourFigures, salesCents: number | null): LabourFigures {
  const fin = (d: DepartmentFigures): DepartmentFigures => ({
    spanHours: round2(d.spanHours),
    paidHours: round2(d.paidHours),
    costedHours: round2(d.costedHours),
    uncostedHours: round2(d.uncostedHours),
    costCents: d.costCents,
    labourPct: pct1(d.costCents, salesCents)
  });
  return {
    ...fin(figures),
    openHours: round2(figures.openHours),
    byDepartment: {
      KITCHEN: fin(figures.byDepartment.KITCHEN),
      FOH: fin(figures.byDepartment.FOH),
      MANAGEMENT: fin(figures.byDepartment.MANAGEMENT),
      UNCLASSIFIED: fin(figures.byDepartment.UNCLASSIFIED)
    }
  };
}

const normaliseType = (value: string | null | undefined) => (value ?? '').toUpperCase().replace(/[\s-]+/g, '_');

export function buildLabourWeek(input: LabourWeekBuildInput): LabourWeekPayload {
  const timeZone = input.timeZone ?? 'Australia/Sydney';
  const dayKeys = weekDayKeys(input.weekStart);
  const daySet = new Set(dayKeys);
  const superRate = input.superRate;

  // ── Sales: one figure per venue-day, venue labels resolved to configured venues ──
  const saleRows: LabourWeekSaleRow[] = [];
  const resolvedSales: Array<{ venue: string; serviceDate: Date; salesCents: number; id: string }> = [];
  for (const sale of input.sales) {
    const date = sale.serviceDate.toISOString().slice(0, 10);
    if (!daySet.has(date)) continue;
    const resolved = resolveVenueLabel(sale.venue, input.configuredVenues);
    const venue = resolved.venue ?? sale.venue.trim();
    resolvedSales.push({ venue, serviceDate: sale.serviceDate, salesCents: sale.salesCents, id: sale.id });
    saleRows.push({ id: sale.id, date, venue, venueLabel: sale.venue, source: sale.source, salesCents: sale.salesCents, used: false, notes: sale.notes ?? null });
  }
  const bestByVenueDay = bestVenueDaySales(resolvedSales);
  // Mark the row the figure came from: the first row carrying the max.
  const usedIds = new Set<string>();
  for (const [key, cents] of bestByVenueDay) {
    const [venue, date] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
    const winner = saleRows.find((row) => row.venue === venue && row.date === date && row.salesCents === cents && !usedIds.has(row.id));
    if (winner) usedIds.add(winner.id);
  }
  for (const row of saleRows) row.used = usedIds.has(row.id);

  // ── Shifts: place each in one venue-day, one department, one person ──
  type Placed = {
    shift: LabourWeekShiftInput;
    date: string;
    venue: LabourVenueKey;
    department: ReturnType<typeof classifyRosterDepartment>;
    span: number;
    paid: number;
    costCents: number | null;
    costBasis: string;
    rateCents: number | null;
    rateSource: string;
  };
  const placed: Placed[] = [];
  const sorted = [...input.shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  type PersonAgg = {
    profile: NonNullable<LabourWeekShiftInput['staffProfile']>;
    rate: ReturnType<typeof staffCostingRate>;
    salaried: boolean;
    employmentType: string;
    paid: number;
    span: number;
    shifts: Placed[];
    venues: Map<string, number>;
  };
  const people = new Map<string, PersonAgg>();
  for (const shift of sorted) {
    const date = venueDayKey(shift.startsAt, timeZone);
    if (!daySet.has(date)) continue;
    const span = shiftSpanHours(shift);
    const paid = shiftPaidHours(shift);
    const venue = resolveLabourVenue(shift.venue, shift.staffProfile?.venue, input.configuredVenues);
    const department = classifyRosterDepartment({ area: shift.area, shiftRoleTitle: shift.roleTitle, profileRoleTitle: shift.staffProfile?.roleTitle });
    const entry: Placed = { shift, date, venue, department, span, paid, costCents: null, costBasis: '', rateCents: null, rateSource: '' };
    placed.push(entry);
    if (!shift.staffProfile) continue;
    const profile = shift.staffProfile;
    let person = people.get(profile.id);
    if (!person) {
      const rate = staffCostingRate(profile, superRate);
      person = {
        profile,
        rate,
        salaried: weeklyFixedCostCents(rate) > 0,
        employmentType: normaliseType(profile.payProfile?.employmentType ?? profile.employmentType) || 'CASUAL',
        paid: 0,
        span: 0,
        shifts: [],
        venues: new Map()
      };
      people.set(profile.id, person);
    }
    person.paid += paid;
    person.span += span;
    person.shifts.push(entry);
    person.venues.set(venue.key, (person.venues.get(venue.key) ?? 0) + paid);
  }

  // ── Cost each person's week, then spread it across their shifts by paid hours ──
  const peopleRows: LabourWeekPerson[] = [];
  const uncostedPeople: LabourWeekPayload['incomplete']['uncostedPeople'] = [];
  let totalOvertimeCents = 0;
  for (const person of people.values()) {
    const { rate, profile } = person;
    const rateKnown = rate.ordinaryRateCents != null && rate.ordinaryRateCents > 0;
    const contract = profile.contractedWeeklyHours ?? (person.employmentType === 'FULL_TIME' ? 38 : null);
    const overtimeHours = person.salaried ? Math.max(0, person.paid - FULL_TIME_ORDINARY_WEEKLY_HOURS) : 0;
    const headroomHours = person.salaried && contract != null ? Math.max(0, Math.min(person.paid, FULL_TIME_ORDINARY_WEEKLY_HOURS) - contract) : 0;
    const overAgreedHours = !person.salaried && contract != null ? Math.max(0, person.paid - contract) : 0;

    let weekCostCents: number | null = null;
    let overtimeCostCents: number | null = null;
    let basis = '';
    if (!rateKnown) {
      uncostedPeople.push({ staffProfileId: profile.id, name: `${profile.firstName} ${profile.lastName}`.trim(), paidHours: round2(person.paid) });
    } else if (person.salaried) {
      // Documented methodology: a salary is a fixed weekly cost (÷45h incl.
      // super) whatever the hours, plus overtime past 45h at the OT rate.
      const fixed = weeklyFixedCostCents(rate);
      const otRate = rate.overtimeRateCents ?? Math.round(rate.ordinaryRateCents! * 1.5);
      overtimeCostCents = Math.round(overtimeHours * otRate);
      weekCostCents = fixed + overtimeCostCents;
      basis = `weekly salary ${rate.source}${overtimeHours > 0 ? ` + ${round2(overtimeHours)}h OT` : ''}`;
      totalOvertimeCents += overtimeCostCents;
    } else {
      weekCostCents = Math.round(person.paid * rate.ordinaryRateCents!);
      overtimeCostCents = 0;
      basis = `${rate.source}`;
    }

    // Spread the week's cost over the shifts by paid hours; the last shift
    // takes the rounding remainder so the shifts sum to the week exactly.
    if (weekCostCents != null) {
      let allocated = 0;
      person.shifts.forEach((entry, index) => {
        const isLast = index === person.shifts.length - 1;
        const share = person.paid > 0 ? (isLast ? weekCostCents! - allocated : Math.round((weekCostCents! * entry.paid) / person.paid)) : isLast ? weekCostCents! : 0;
        allocated += share;
        entry.costCents = share;
        entry.rateCents = rate.ordinaryRateCents;
        entry.rateSource = rate.source;
        entry.costBasis = person.salaried
          ? `${round2(entry.paid)}h share of ${basis}`
          : `${round2(entry.paid)}h × $${(rate.ordinaryRateCents! / 100).toFixed(2)} (${rate.source})`;
      });
    } else {
      for (const entry of person.shifts) {
        entry.rateSource = rate.source;
        entry.costBasis = 'no costing rate on file — hours counted, not costed';
      }
    }

    peopleRows.push({
      staffProfileId: profile.id,
      name: `${profile.firstName} ${profile.lastName}`.trim(),
      employmentType: person.employmentType,
      salaried: person.salaried,
      contractedWeeklyHours: contract,
      spanHours: round1(person.span),
      paidHours: round1(person.paid),
      headroomHours: round1(headroomHours),
      overtimeHours: round1(overtimeHours),
      overAgreedHours: round1(overAgreedHours),
      overtimeCostCents,
      estWeekCostCents: weekCostCents,
      rateKnown,
      rateSource: rate.source,
      venues: [...person.venues.entries()].map(([venue, paidHours]) => ({ venue, paidHours: round1(paidHours) })).sort((a, b) => b.paidHours - a.paidHours)
    });
  }
  peopleRows.sort((a, b) => b.overtimeHours - a.overtimeHours || b.paidHours - a.paidHours || a.name.localeCompare(b.name));

  // ── Aggregate: venue → day → department. Σ cells = venue = group, to the cent ──
  const venueKeys = new Map<string, LabourVenueKey>();
  for (const venue of input.configuredVenues) venueKeys.set(venue, { key: venue, status: 'configured', source: 'explicit' });
  for (const entry of placed) if (!venueKeys.has(entry.venue.key)) venueKeys.set(entry.venue.key, entry.venue);
  for (const key of bestByVenueDay.keys()) {
    const venue = key.slice(0, key.lastIndexOf('|'));
    if (!venueKeys.has(venue)) venueKeys.set(venue, resolveLabourVenue(venue, null, input.configuredVenues));
  }

  const cellFor = new Map<string, LabourFigures>();
  const cell = (venue: string, date: string) => {
    const k = `${venue}|${date}`;
    const existing = cellFor.get(k) ?? emptyFigures();
    cellFor.set(k, existing);
    return existing;
  };
  for (const entry of placed) {
    const c = cell(entry.venue.key, entry.date);
    if (!entry.shift.staffProfile) {
      c.openHours += entry.paid;
      continue;
    }
    addTo(c, entry.span, entry.paid, entry.costCents);
    addTo(c.byDepartment[entry.department.department], entry.span, entry.paid, entry.costCents);
  }

  const sumInto = (target: LabourFigures, source: LabourFigures) => {
    const add = (t: DepartmentFigures, s: DepartmentFigures) => {
      t.spanHours += s.spanHours;
      t.paidHours += s.paidHours;
      t.costedHours += s.costedHours;
      t.uncostedHours += s.uncostedHours;
      t.costCents += s.costCents;
    };
    add(target, source);
    target.openHours += source.openHours;
    for (const d of DEPARTMENTS) add(target.byDepartment[d], source.byDepartment[d]);
  };

  const venues: LabourWeekVenue[] = [];
  const group = emptyFigures();
  const groupByDay = new Map<string, { figures: LabourFigures; salesCents: number | null }>();
  for (const date of dayKeys) groupByDay.set(date, { figures: emptyFigures(), salesCents: null });
  let groupSales = 0;
  let groupSalesDays = 0;
  const unplacedVenueLabels = new Set<string>();

  const orderedVenueKeys = [...venueKeys.values()].sort((a, b) => {
    const rank = (v: LabourVenueKey) => (v.status === 'configured' ? 0 : v.status === 'invalid' ? 1 : 2);
    return rank(a) - rank(b) || a.key.localeCompare(b.key);
  });
  for (const venueKey of orderedVenueKeys) {
    const venueFigures = emptyFigures();
    let salesCents = 0;
    let salesDays = 0;
    const days: LabourWeekDayCell[] = [];
    for (const date of dayKeys) {
      const figures = cellFor.get(`${venueKey.key}|${date}`) ?? emptyFigures();
      const daySales = bestByVenueDay.get(`${venueKey.key}|${date}`) ?? null;
      if (daySales != null) {
        salesCents += daySales;
        salesDays += 1;
        const g = groupByDay.get(date)!;
        g.salesCents = (g.salesCents ?? 0) + daySales;
      }
      sumInto(venueFigures, figures);
      sumInto(groupByDay.get(date)!.figures, figures);
      days.push({ ...finish(figures, daySales), date, venue: venueKey.key, salesCents: daySales, publicHoliday: nswHolidayName(date) });
    }
    const hasAnything = venueFigures.paidHours > 0 || venueFigures.openHours > 0 || salesDays > 0 || venueKey.status === 'configured';
    if (!hasAnything) continue;
    if (venueKey.status !== 'configured' && (venueFigures.paidHours > 0 || venueFigures.openHours > 0)) unplacedVenueLabels.add(venueKey.key);
    sumInto(group, venueFigures);
    groupSales += salesCents;
    groupSalesDays += salesDays;
    const targets = venueKey.status === 'configured' ? resolveCostTargets(input.venueTargets, venueKey.key) : null;
    const finished = finish(venueFigures, salesCents);
    venues.push({
      ...finished,
      venue: venueKey.key,
      venueStatus: venueKey.status,
      salesCents,
      salesDays,
      days,
      target: targets
        ? {
            wagePct: targets.wagePct,
            configured: targets.configured.wage,
            source: targets.source,
            variancePts: finished.labourPct == null ? null : round1(finished.labourPct - targets.wagePct)
          }
        : null
    });
  }

  const groupTargets = resolveCostTargets(input.venueTargets, null);
  const groupFinished = finish(group, groupSales);
  const unclassifiedHours = round2(group.byDepartment.UNCLASSIFIED.paidHours);
  const uncostedHours = round2(group.uncostedHours);

  const unrosteredSalaried = (input.activeSalariedStaff ?? [])
    .filter((staff) => !people.has(staff.id))
    .map((staff) => {
      const rate = staffCostingRate(staff, superRate);
      const fixed = weeklyFixedCostCents(rate);
      return { staffProfileId: staff.id, name: `${staff.firstName} ${staff.lastName}`.trim(), weeklyFixedCostCents: fixed > 0 ? fixed : null };
    })
    .filter((staff) => staff.weeklyFixedCostCents != null);

  const shiftRows: LabourWeekShiftRow[] = placed.map((entry) => {
    const row: LabourWeekShiftRow = {
      shiftId: entry.shift.id,
      staffProfileId: entry.shift.staffProfileId,
      name: entry.shift.staffProfile ? `${entry.shift.staffProfile.firstName} ${entry.shift.staffProfile.lastName}`.trim() : 'Open shift',
      date: entry.date,
      venue: entry.venue.key,
      venueSource: entry.venue.source,
      venueLabel: entry.shift.venue,
      department: entry.department.department,
      departmentBasis: entry.department.basis,
      area: entry.shift.area,
      roleTitle: entry.shift.roleTitle ?? entry.shift.staffProfile?.roleTitle ?? null,
      startsAt: entry.shift.startsAt.toISOString(),
      endsAt: entry.shift.endsAt.toISOString(),
      spanHours: round2(entry.span),
      unpaidBreakHours: round2(Math.max(0, entry.shift.breakMinutes ?? 0) / 60),
      paidHours: round2(entry.paid),
      status: entry.shift.status
    };
    if (input.includeRates) {
      row.rateCents = entry.rateCents;
      row.rateSource = entry.rateSource;
      row.costCents = entry.shift.staffProfile ? entry.costCents : null;
      row.costBasis = entry.shift.staffProfile ? entry.costBasis : 'open shift — nobody on it, not costed';
    }
    return row;
  });

  const estCostCents = peopleRows.reduce((sum, row) => sum + (row.estWeekCostCents ?? 0), 0);

  return {
    weekStart: input.weekStart,
    weekEnd: dayKeys[6]!,
    timeZone,
    dayKeys,
    venueNames: venues.map((v) => v.venue),
    venues,
    group: {
      ...groupFinished,
      salesCents: groupSales,
      salesDays: groupSalesDays,
      target: {
        wagePct: groupTargets.wagePct,
        configured: groupTargets.configured.wage,
        source: groupTargets.source,
        variancePts: groupFinished.labourPct == null ? null : round1(groupFinished.labourPct - groupTargets.wagePct)
      },
      byDay: dayKeys.map((date) => {
        const g = groupByDay.get(date)!;
        return { ...finish(g.figures, g.salesCents), date, salesCents: g.salesCents, publicHoliday: nswHolidayName(date) };
      })
    },
    people: peopleRows,
    incomplete: {
      flag: uncostedHours > 0 || unplacedVenueLabels.size > 0,
      uncostedHours,
      uncostedPeople,
      unplacedVenueLabels: [...unplacedVenueLabels].sort(),
      unclassifiedHours,
      unrosteredSalaried
    },
    methodology: {
      sales: 'Actual takings from SalesActualEntry: ex GST, net of refunds, ex tips; one figure per venue-day (the largest across feeds); Sydney service dates. Not forecast.',
      hours: 'Rostered span = shift start to end as shown on the roster. Paid hours = span minus the unpaid break on the shift. Cost is on paid hours. Published and completed shifts only.',
      cost: `Costing rate per person from their pay profile (award / agreed rate incl. ${Math.round(superRate * 1000) / 10}% super). Hourly staff: paid hours × rate. Salaried staff: fixed weekly salary ÷ 45h incl. super, plus 1.5× past 45 paid hours, spread over their shifts by paid hours. Venue = the shift's venue (profile venue only when the shift has none). Department from the shift's area, then its role, then the person's role.`,
      notCosted: [
        'Saturday, Sunday and public-holiday penalty rates (not part of the suite costing engine; holidays are flagged on the day).',
        'Casual loading as a multiplier (a casual is costed at the loaded rate on file, or the award default).',
        'Salaried staff with no shift this week (listed under incomplete.unrosteredSalaried).',
        'Open shifts (nobody on them): hours shown as unfilled, no cost.'
      ],
      superRatePct: Math.round(superRate * 1000) / 10
    },
    reconciliation: { shifts: shiftRows, sales: saleRows, ratesVisible: input.includeRates },
    totals: { salesCents: groupSales, estCostCents, overtimeCostCents: totalOvertimeCents }
  };
}
