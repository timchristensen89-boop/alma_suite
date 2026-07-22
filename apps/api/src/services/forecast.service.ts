// Forecasting engine (Reports → Forecast).
//
// Server-side, data-driven replacement for the old hardcoded historical-sales
// tables: per venue per day it forecasts covers, sales, wages and COGS over a
// rolling horizon (default 13 weeks), then projects a weekly cash-flow from
// those forecasts plus Xero supplier bills, the payroll cycle, super and GST
// set-asides, and configured fixed outgoings.
//
// Signals used:
//   - SalesActualEntry           day-of-week baselines, trend, YoY, actuals
//   - ReserveReservation         booked covers (floor under sales), no-show rate
//   - RosterShift + pay profiles rostered-week wage costing (same machinery as
//                                the Staff Costing report)
//   - recapWageCents             trailing actual wage %, prior-week payroll
//   - computeActualCogs          trailing actual COGS %
//   - SupplierInvoice            known bills due (cash out)
//
// Every generation writes ForecastDaySnapshot rows (one per venue/date/lead)
// so accuracy can be measured by how far out each prediction was made.

import { prisma, computeActualCogs } from '@alma/db';
import { z } from 'zod';
import {
  forecastConfigUpdateSchema,
  type AuthUser,
  type CashflowComponent,
  type CashflowWeek,
  type ForecastAccuracyBucket,
  type ForecastAccuracyPayload,
  type ForecastAccuracyWeekRow,
  type ForecastCashflowPayload,
  type ForecastConfigPayload,
  type ForecastDay,
  type ForecastFixedCost,
  type ForecastOutlookPayload,
  type ForecastVenueOutlook,
  type ForecastWeek
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import {
  costForRate,
  salariedVenueAllocations,
  splitOvertimeHours,
  staffCostingRate,
  staffPayRateSelect,
  weeklyFixedCostCents
} from '../lib/staff-pay-rates.js';
import { configuredSuperRateFraction, settingsService } from './settings.service.js';
import { recapWageCents } from './reports.service.js';

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 371; // 53 weeks, so YoY (−364d) always has neighbours
const CLOSED_DAY_THRESHOLD_CENTS = 20_000; // < $200 median = venue not trading
const MIN_COVERS_FOR_SPEND_SAMPLE = 10;
const DEFAULT_WAGE_PCT = 32;
const DEFAULT_COGS_PCT = 30;

const outlookQuerySchema = z.object({
  weeks: z.coerce.number().int().min(2).max(26).optional().default(13),
  venue: z.string().optional().or(z.literal(''))
});

const cashflowQuerySchema = z.object({
  weeks: z.coerce.number().int().min(4).max(26).optional().default(13)
});

// ── Sydney service-date helpers ──────────────────────────────────────────────
// Service dates are stored as UTC midnight of the Sydney calendar date (the
// convention used by the Square sync, SevenRooms ingestion and timesheets).

const sydneyDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' });

function sydneyTodayKey(): string {
  return sydneyDayFormatter.format(new Date());
}

function sydneyKeyForInstant(instant: Date): string {
  return sydneyDayFormatter.format(instant);
}

function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function keyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function mondayOf(date: Date): Date {
  const weekday = date.getUTCDay();
  return addDaysUtc(date, weekday === 0 ? -6 : 1 - weekday);
}

function isAdminActor(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN');
}

function actorVenueScope(actor?: AuthUser | null, requestedVenue?: string | null) {
  const venue = requestedVenue?.trim() || null;
  if (!actor || isAdminActor(actor)) return venue;
  if (!actor.venue) throw new HttpError(403, 'Forecasts require a venue-scoped manager.');
  if (venue && venue !== actor.venue) throw new HttpError(403, 'Forecasts are limited to your venue.');
  return actor.venue;
}

function trimmedMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const trimmed = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
  return trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[mid] ?? 0;
}

function pctOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function rosterHoursForShift(entry: { startsAt: Date; endsAt: Date; breakMinutes: number }): number {
  const minutes = (entry.endsAt.getTime() - entry.startsAt.getTime()) / 60_000 - entry.breakMinutes;
  return Math.max(0, minutes) / 60;
}

// ── Outlook ──────────────────────────────────────────────────────────────────

type VenueTarget = {
  name: string;
  targetWagePercent: number | null;
  targetPrimeCostPercent: number | null;
};

async function venueTargets(): Promise<VenueTarget[]> {
  const settings = await settingsService.get();
  return settings.venues.map((v) => ({
    name: v.name,
    targetWagePercent: typeof v.targetWagePercent === 'number' ? v.targetWagePercent : null,
    targetPrimeCostPercent: typeof v.targetPrimeCostPercent === 'number' ? v.targetPrimeCostPercent : null
  }));
}

type BuildOptions = {
  weeks: number;
  venue: string | null;
  persistSnapshots: boolean;
};

async function buildOutlook(options: BuildOptions): Promise<ForecastOutlookPayload> {
  const todayKey = sydneyTodayKey();
  const today = dateFromKey(todayKey);
  const weekStart = mondayOf(today);
  const horizonEnd = addDaysUtc(weekStart, options.weeks * 7); // exclusive
  const historyStart = addDaysUtc(today, -HISTORY_DAYS);

  const allTargets = await venueTargets();
  const targets = options.venue ? allTargets.filter((t) => t.name === options.venue) : allTargets;
  if (targets.length === 0) {
    throw new HttpError(404, options.venue ? `Unknown venue "${options.venue}".` : 'No venues configured.');
  }
  const venueNames = targets.map((t) => t.name);

  const superRate = await configuredSuperRateFraction();

  const [salesRows, liveCoverRows, noShowRows, shiftRows, salariedStaff] = await Promise.all([
    prisma.salesActualEntry.groupBy({
      by: ['venue', 'serviceDate'],
      where: { venue: { in: venueNames }, serviceDate: { gte: historyStart, lte: today } },
      _sum: { salesCents: true }
    }),
    prisma.reserveReservation.groupBy({
      by: ['venue', 'serviceDate'],
      where: {
        venue: { in: venueNames },
        serviceDate: { gte: addDaysUtc(today, -91), lt: horizonEnd },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] }
      },
      _sum: { covers: true }
    }),
    prisma.reserveReservation.groupBy({
      by: ['venue'],
      where: {
        venue: { in: venueNames },
        serviceDate: { gte: addDaysUtc(today, -91), lt: today },
        status: 'NO_SHOW'
      },
      _sum: { covers: true }
    }),
    prisma.rosterShift.findMany({
      where: {
        startsAt: { lt: new Date(horizonEnd.getTime() + DAY_MS) },
        endsAt: { gt: new Date(weekStart.getTime() - DAY_MS) },
        status: { not: 'CANCELLED' },
        staffProfile: { accountType: 'HUMAN', mergedIntoStaffProfileId: null }
      },
      select: {
        venue: true,
        startsAt: true,
        endsAt: true,
        breakMinutes: true,
        staffProfileId: true,
        staffProfile: { select: { venue: true, ...staffPayRateSelect } }
      }
    }),
    prisma.staffProfile.findMany({
      where: {
        accountType: 'HUMAN',
        mergedIntoStaffProfileId: null,
        employmentStatus: 'ACTIVE',
        payProfile: { isNot: null }
      },
      select: { id: true, venue: true, ...staffPayRateSelect }
    })
  ]);

  // venue → dateKey → cents / covers
  const salesByVenue = new Map<string, Map<string, number>>();
  for (const row of salesRows) {
    const map = salesByVenue.get(row.venue) ?? new Map<string, number>();
    const key = keyOf(row.serviceDate);
    map.set(key, (map.get(key) ?? 0) + (row._sum.salesCents ?? 0));
    salesByVenue.set(row.venue, map);
  }
  const coversByVenue = new Map<string, Map<string, number>>();
  for (const row of liveCoverRows) {
    const map = coversByVenue.get(row.venue) ?? new Map<string, number>();
    const key = keyOf(row.serviceDate);
    map.set(key, (map.get(key) ?? 0) + (row._sum.covers ?? 0));
    coversByVenue.set(row.venue, map);
  }
  const noShowCoversByVenue = new Map<string, number>();
  for (const row of noShowRows) noShowCoversByVenue.set(row.venue, row._sum.covers ?? 0);

  // ── Roster costing (hourly staff per venue-day; salaried per venue-week) ──
  const hourlyCostByVenueDay = new Map<string, number>(); // `${venue}|${dateKey}`
  const venueWeeksWithRoster = new Set<string>(); // `${venue}|${weekKey}`
  const salariedRosterHours = new Map<string, Map<string, Map<string, number>>>(); // weekKey → staffId → venue → hours
  const overtimeTracker = new Map<string, number>();
  const salariedIds = new Set(salariedStaff.map((s) => s.id));

  const sortedShifts = [...shiftRows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const shift of sortedShifts) {
    const dayKey = sydneyKeyForInstant(shift.startsAt);
    const day = dateFromKey(dayKey);
    if (day < weekStart || day >= horizonEnd) continue;
    const venue = shift.venue?.trim() || shift.staffProfile.venue?.trim() || 'Unassigned';
    if (!venueNames.includes(venue)) continue;
    const weekKey = keyOf(mondayOf(day));
    venueWeeksWithRoster.add(`${venue}|${weekKey}`);
    const hours = rosterHoursForShift(shift);
    const rate = staffCostingRate(shift.staffProfile, superRate);
    if (rate.appliesOvertime || salariedIds.has(shift.staffProfileId)) {
      // Salaried: fixed weekly cost handled below; track hours for allocation.
      const byStaff = salariedRosterHours.get(weekKey) ?? new Map<string, Map<string, number>>();
      const byVenue = byStaff.get(shift.staffProfileId) ?? new Map<string, number>();
      byVenue.set(venue, (byVenue.get(venue) ?? 0) + hours);
      byStaff.set(shift.staffProfileId, byVenue);
      salariedRosterHours.set(weekKey, byStaff);
      continue;
    }
    const split = splitOvertimeHours(overtimeTracker, shift.staffProfileId, day, hours, rate.appliesOvertime);
    const cost = costForRate(rate, split);
    const mapKey = `${venue}|${dayKey}`;
    hourlyCostByVenueDay.set(mapKey, (hourlyCostByVenueDay.get(mapKey) ?? 0) + cost);
  }

  // Salaried weekly fixed cost allocated to venues by rostered hours (home
  // venue when unrostered) — mirrors recapWageCents' attribution.
  const salariedCostByVenueWeek = new Map<string, number>(); // `${venue}|${weekKey}`
  const weekKeys: string[] = [];
  for (let w = 0; w < options.weeks; w += 1) weekKeys.push(keyOf(addDaysUtc(weekStart, w * 7)));
  for (const weekKey of weekKeys) {
    const byStaff = salariedRosterHours.get(weekKey);
    for (const profile of salariedStaff) {
      const rate = staffCostingRate(profile, superRate);
      const fixed = weeklyFixedCostCents(rate);
      if (fixed <= 0) continue;
      const allocations = salariedVenueAllocations(
        byStaff?.get(profile.id) ?? new Map<string, number>(),
        profile.venue?.trim() || 'Unassigned'
      );
      for (const alloc of allocations) {
        if (!venueNames.includes(alloc.venue)) continue;
        const mapKey = `${alloc.venue}|${weekKey}`;
        salariedCostByVenueWeek.set(mapKey, (salariedCostByVenueWeek.get(mapKey) ?? 0) + Math.round(fixed * alloc.fraction));
      }
    }
  }

  // ── Trailing wage % and COGS % (last 4 complete weeks) ──
  const trailingEnd = weekStart; // Monday of the current week
  const trailingStart = addDaysUtc(trailingEnd, -28);
  const trailingByVenue = new Map<string, { wagePct: number | null; cogsPct: number | null; cogsQuality: string | null }>();
  await Promise.all(
    venueNames.map(async (venue) => {
      const [wageCents, cogs, salesAgg] = await Promise.all([
        recapWageCents(venue, trailingStart, trailingEnd),
        computeActualCogs({ venue, start: trailingStart, end: trailingEnd }),
        prisma.salesActualEntry.aggregate({
          where: { venue, serviceDate: { gte: trailingStart, lt: trailingEnd } },
          _sum: { salesCents: true }
        })
      ]);
      const salesCents = salesAgg._sum.salesCents ?? 0;
      const wagePctRaw = salesCents > 0 ? (wageCents / salesCents) * 100 : null;
      const cogsPctRaw = salesCents > 0 ? (cogs.cogsCents / salesCents) * 100 : null;
      trailingByVenue.set(venue, {
        wagePct: wagePctRaw != null ? Math.min(60, Math.max(15, wagePctRaw)) : null,
        cogsPct: cogsPctRaw != null ? Math.min(50, Math.max(15, cogsPctRaw)) : null,
        cogsQuality: cogs.quality
      });
    })
  );

  const venues: ForecastVenueOutlook[] = [];

  for (const target of targets) {
    const venue = target.name;
    const sales = salesByVenue.get(venue) ?? new Map<string, number>();
    const covers = coversByVenue.get(venue) ?? new Map<string, number>();

    // History stats.
    const historyDays = sales.size;
    const firstDataKey = [...sales.keys()].sort()[0];
    const firstDataDate = firstDataKey ? dateFromKey(firstDataKey) : null;

    // Trend: last 28 full days vs the 28 before.
    let trendFactor = 1;
    if (firstDataDate && firstDataDate <= addDaysUtc(today, -56)) {
      let recent = 0;
      let prior = 0;
      for (let i = 1; i <= 28; i += 1) recent += sales.get(keyOf(addDaysUtc(today, -i))) ?? 0;
      for (let i = 29; i <= 56; i += 1) prior += sales.get(keyOf(addDaysUtc(today, -i))) ?? 0;
      if (prior > 0 && recent > 0) trendFactor = Math.min(1.15, Math.max(0.85, recent / prior));
    }

    // Per-weekday baselines from the last 8 same-weekday actuals.
    const weekdayValues = new Map<number, number[]>();
    for (let weekday = 0; weekday < 7; weekday += 1) weekdayValues.set(weekday, []);
    for (let back = 1; back <= 56; back += 1) {
      const d = addDaysUtc(today, -back);
      if (firstDataDate && d < firstDataDate) continue;
      weekdayValues.get(d.getUTCDay())!.push(sales.get(keyOf(d)) ?? 0);
    }
    const closedWeekdays: number[] = [];
    const baselineByWeekday = new Map<number, number>();
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const values = weekdayValues.get(weekday) ?? [];
      if (values.length >= 3 && median(values) < CLOSED_DAY_THRESHOLD_CENTS) {
        closedWeekdays.push(weekday);
        baselineByWeekday.set(weekday, 0);
      } else {
        baselineByWeekday.set(weekday, trimmedMean(values));
      }
    }

    // Historical final covers per weekday (last 8 weeks of reservations).
    const weekdayCovers = new Map<number, number[]>();
    for (let back = 1; back <= 56; back += 1) {
      const d = addDaysUtc(today, -back);
      const c = covers.get(keyOf(d)) ?? 0;
      const list = weekdayCovers.get(d.getUTCDay()) ?? [];
      list.push(c);
      weekdayCovers.set(d.getUTCDay(), list);
    }

    // No-show rate: no-show covers ÷ (kept + no-show) over the last 91 days.
    let keptCovers = 0;
    for (let back = 1; back <= 91; back += 1) keptCovers += covers.get(keyOf(addDaysUtc(today, -back))) ?? 0;
    const noShowCovers = noShowCoversByVenue.get(venue) ?? 0;
    const noShowRate = keptCovers + noShowCovers > 0 ? Math.min(0.3, noShowCovers / (keptCovers + noShowCovers)) : 0;

    // Average spend per cover over the trailing 8 weeks (days with real covers).
    let spendSampleSales = 0;
    let spendSampleCovers = 0;
    for (let back = 1; back <= 56; back += 1) {
      const key = keyOf(addDaysUtc(today, -back));
      const dayCovers = covers.get(key) ?? 0;
      const daySales = sales.get(key) ?? 0;
      if (dayCovers >= MIN_COVERS_FOR_SPEND_SAMPLE && daySales > 0) {
        spendSampleSales += daySales;
        spendSampleCovers += dayCovers;
      }
    }
    const avgSpendPerCoverCents = spendSampleCovers > 0 ? Math.round(spendSampleSales / spendSampleCovers) : null;

    const trailing = trailingByVenue.get(venue) ?? { wagePct: null, cogsPct: null, cogsQuality: null };
    const wagePctForRatio = trailing.wagePct ?? target.targetWagePercent ?? DEFAULT_WAGE_PCT;
    const cogsPctForRatio =
      trailing.cogsPct ??
      (target.targetPrimeCostPercent != null && target.targetWagePercent != null
        ? Math.max(15, target.targetPrimeCostPercent - target.targetWagePercent)
        : DEFAULT_COGS_PCT);

    // ── Assemble days ──
    const days: ForecastDay[] = [];
    const totalDays = options.weeks * 7;
    for (let i = 0; i < totalDays; i += 1) {
      const date = addDaysUtc(weekStart, i);
      const key = keyOf(date);
      const weekday = date.getUTCDay();
      const weekKey = keyOf(mondayOf(date));
      const isPast = date < today;
      const isToday = key === todayKey;
      const closed = closedWeekdays.includes(weekday);

      const actualSalesCents = sales.get(key) ?? null;
      const yoy = sales.get(keyOf(addDaysUtc(date, -364))) ?? null;
      const rawBaseline = baselineByWeekday.get(weekday) ?? 0;
      const blended = yoy != null && yoy > 0 && rawBaseline > 0 ? rawBaseline * 0.7 + yoy * 0.3 : rawBaseline;
      const baselineSalesCents = closed ? 0 : Math.round(blended * trendFactor);

      const bookedCovers = covers.get(key) ?? 0;
      const keptBooked = Math.round(bookedCovers * (1 - noShowRate));
      const weekdayCoverHistory = weekdayCovers.get(weekday) ?? [];
      const historicalCovers = Math.round(trimmedMean(weekdayCoverHistory));
      const expectedCovers = closed ? 0 : isPast ? bookedCovers : Math.max(keptBooked, historicalCovers);

      // Sales: booked covers act as a floor, never a drag (sparse booking data
      // must not pull forecasts down) — same rule the Sales report introduced.
      const bookedFloorCents =
        !closed && avgSpendPerCoverCents != null && keptBooked > 0 ? keptBooked * avgSpendPerCoverCents : 0;
      let salesForecastCents: number;
      let salesMethod: ForecastDay['method']['sales'];
      if (isPast) {
        salesForecastCents = actualSalesCents ?? baselineSalesCents;
        salesMethod = actualSalesCents != null ? 'actual+pace' : 'history';
      } else if (isToday) {
        salesForecastCents = Math.max(actualSalesCents ?? 0, baselineSalesCents, bookedFloorCents);
        salesMethod = (actualSalesCents ?? 0) >= Math.max(baselineSalesCents, bookedFloorCents) ? 'actual+pace' : bookedFloorCents > baselineSalesCents ? 'history+bookings' : 'history';
      } else {
        salesForecastCents = Math.max(baselineSalesCents, bookedFloorCents);
        salesMethod = bookedFloorCents > baselineSalesCents ? 'history+bookings' : 'history';
      }

      // Wages: cost the roster when one exists for this venue-week, otherwise
      // apply the trailing actual wage %.
      const weekHasRoster = venueWeeksWithRoster.has(`${venue}|${weekKey}`);
      let wagesForecastCents: number;
      let rosterCostCents: number | null = null;
      let wagesMethod: ForecastDay['method']['wages'];
      if (weekHasRoster) {
        const hourly = hourlyCostByVenueDay.get(`${venue}|${key}`) ?? 0;
        const salariedWeek = salariedCostByVenueWeek.get(`${venue}|${weekKey}`) ?? 0;
        const openDays = 7 - closedWeekdays.length || 7;
        const salariedShare = closed ? 0 : Math.round(salariedWeek / openDays);
        wagesForecastCents = hourly + salariedShare;
        rosterCostCents = wagesForecastCents;
        wagesMethod = 'roster';
      } else {
        wagesForecastCents = Math.round((salesForecastCents * wagePctForRatio) / 100);
        wagesMethod = 'ratio';
      }

      const cogsForecastCents = Math.round((salesForecastCents * cogsPctForRatio) / 100);
      const cogsMethod: ForecastDay['method']['cogs'] =
        trailing.cogsPct != null ? 'trailing_actual' : target.targetPrimeCostPercent != null ? 'target' : 'default';

      days.push({
        date: key,
        weekday,
        isPast,
        isToday,
        closed,
        bookedCovers,
        expectedCovers,
        actualSalesCents,
        baselineSalesCents,
        salesForecastCents,
        lastYearSalesCents: yoy,
        wagesForecastCents,
        rosterCostCents,
        cogsForecastCents,
        method: { sales: salesMethod, wages: wagesMethod, cogs: cogsMethod }
      });
    }

    const weeks = rollupWeeks(days);

    venues.push({
      venue,
      days,
      weeks,
      assumptions: {
        avgSpendPerCoverCents,
        noShowRate: Math.round(noShowRate * 1000) / 1000,
        trendFactor: Math.round(trendFactor * 1000) / 1000,
        trailingWagePct: trailing.wagePct != null ? Math.round(trailing.wagePct * 10) / 10 : null,
        trailingCogsPct: trailing.cogsPct != null ? Math.round(trailing.cogsPct * 10) / 10 : null,
        cogsQuality: trailing.cogsQuality,
        targetWagePercent: target.targetWagePercent,
        targetPrimeCostPercent: target.targetPrimeCostPercent,
        closedWeekdays,
        historyDays
      }
    });
  }

  // Cross-venue weekly totals.
  const totalsWeeks: ForecastWeek[] = [];
  for (let w = 0; w < options.weeks; w += 1) {
    const weekKey = keyOf(addDaysUtc(weekStart, w * 7));
    let salesFc = 0;
    let actual = 0;
    let lastYear = 0;
    let lastYearSeen = false;
    let expectedCovers = 0;
    let bookedCovers = 0;
    let wages = 0;
    let cogs = 0;
    for (const v of venues) {
      const week = v.weeks[w];
      if (!week) continue;
      salesFc += week.salesForecastCents;
      actual += week.actualSalesCents;
      if (week.lastYearSalesCents != null) {
        lastYear += week.lastYearSalesCents;
        lastYearSeen = true;
      }
      expectedCovers += week.expectedCovers;
      bookedCovers += week.bookedCovers;
      wages += week.wagesForecastCents;
      cogs += week.cogsForecastCents;
    }
    totalsWeeks.push({
      weekStart: weekKey,
      salesForecastCents: salesFc,
      actualSalesCents: actual,
      lastYearSalesCents: lastYearSeen ? lastYear : null,
      expectedCovers,
      bookedCovers,
      wagesForecastCents: wages,
      cogsForecastCents: cogs,
      wagePct: pctOf(wages, salesFc),
      cogsPct: pctOf(cogs, salesFc),
      primePct: pctOf(wages + cogs, salesFc)
    });
  }

  const payload: ForecastOutlookPayload = {
    generatedAt: new Date().toISOString(),
    horizonWeeks: options.weeks,
    venues,
    totals: { weeks: totalsWeeks }
  };

  if (options.persistSnapshots) {
    await persistSnapshots(payload, today).catch(() => {
      // Snapshots are best-effort accuracy telemetry — never fail the request.
    });
  }

  return payload;
}

function rollupWeeks(days: ForecastDay[]): ForecastWeek[] {
  const weeks: ForecastWeek[] = [];
  for (let w = 0; w * 7 < days.length; w += 1) {
    const chunk = days.slice(w * 7, w * 7 + 7);
    if (chunk.length === 0) break;
    let salesFc = 0;
    let actual = 0;
    let lastYear = 0;
    let lastYearSeen = false;
    let expectedCovers = 0;
    let bookedCovers = 0;
    let wages = 0;
    let cogs = 0;
    for (const day of chunk) {
      salesFc += day.salesForecastCents;
      actual += day.actualSalesCents ?? 0;
      if (day.lastYearSalesCents != null) {
        lastYear += day.lastYearSalesCents;
        lastYearSeen = true;
      }
      expectedCovers += day.expectedCovers;
      bookedCovers += day.bookedCovers;
      wages += day.wagesForecastCents;
      cogs += day.cogsForecastCents;
    }
    weeks.push({
      weekStart: chunk[0]!.date,
      salesForecastCents: salesFc,
      actualSalesCents: actual,
      lastYearSalesCents: lastYearSeen ? lastYear : null,
      expectedCovers,
      bookedCovers,
      wagesForecastCents: wages,
      cogsForecastCents: cogs,
      wagePct: pctOf(wages, salesFc),
      cogsPct: pctOf(cogs, salesFc),
      primePct: pctOf(wages + cogs, salesFc)
    });
  }
  return weeks;
}

async function persistSnapshots(payload: ForecastOutlookPayload, today: Date) {
  const rows: Array<{
    venue: string;
    forecastDate: Date;
    leadDays: number;
    coversForecast: number;
    salesForecastCents: number;
    wagesForecastCents: number;
    cogsForecastCents: number;
    method: object;
  }> = [];
  for (const venueOutlook of payload.venues) {
    for (const day of venueOutlook.days) {
      const date = dateFromKey(day.date);
      if (date < today) continue;
      rows.push({
        venue: venueOutlook.venue,
        forecastDate: date,
        leadDays: Math.round((date.getTime() - today.getTime()) / DAY_MS),
        coversForecast: day.expectedCovers,
        salesForecastCents: day.salesForecastCents,
        wagesForecastCents: day.wagesForecastCents,
        cogsForecastCents: day.cogsForecastCents,
        method: day.method
      });
    }
  }
  if (rows.length === 0) return;
  // First generation of the day wins for each (venue, date, lead); later runs
  // the same day are no-ops, keeping snapshots stable for accuracy scoring.
  await prisma.forecastDaySnapshot.createMany({ data: rows, skipDuplicates: true });
}

// ── Config ───────────────────────────────────────────────────────────────────

const CONFIG_ID = 'singleton';

function normaliseFixedCosts(value: unknown): ForecastFixedCost[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ForecastFixedCost =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { id?: unknown }).id === 'string' &&
      typeof (item as { name?: unknown }).name === 'string' &&
      typeof (item as { amountCents?: unknown }).amountCents === 'number' &&
      typeof (item as { cadence?: unknown }).cadence === 'string'
  );
}

async function ensureConfig() {
  const existing = await prisma.forecastConfig.findUnique({ where: { id: CONFIG_ID } });
  if (existing) return existing;
  return prisma.forecastConfig.create({ data: { id: CONFIG_ID } });
}

function configToPayload(row: Awaited<ReturnType<typeof ensureConfig>>): ForecastConfigPayload {
  return {
    openingBalanceCents: row.openingBalanceCents,
    openingBalanceDate: row.openingBalanceDate ? row.openingBalanceDate.toISOString() : null,
    supplierPaymentLagDays: row.supplierPaymentLagDays,
    cardSettlementLagDays: row.cardSettlementLagDays,
    payrollFrequency: row.payrollFrequency === 'FORTNIGHTLY' ? 'FORTNIGHTLY' : 'WEEKLY',
    payrollPayWeekday: row.payrollPayWeekday,
    fixedCosts: normaliseFixedCosts(row.fixedCosts)
  };
}

// ── Cash flow ────────────────────────────────────────────────────────────────

const COMPONENT_LABELS: Record<CashflowComponent, string> = {
  sales_settlement: 'Takings (settled)',
  supplier_bills_due: 'Supplier bills due (Xero)',
  supplier_projected: 'Projected supplier spend',
  net_wages: 'Wages (net of super)',
  super_remittance: 'Super remittance',
  gst_remittance: 'GST (BAS)',
  fixed_costs: 'Fixed outgoings'
};

// BAS quarters: Sep→28 Oct, Dec→28 Feb, Mar→28 Apr, Jun→28 Jul.
const BAS_DUE_BY_QUARTER_END_MONTH: Record<number, { month: number; day: number }> = {
  8: { month: 9, day: 28 }, // Sep quarter → 28 Oct
  11: { month: 1, day: 28 }, // Dec quarter → 28 Feb
  2: { month: 3, day: 28 }, // Mar quarter → 28 Apr
  5: { month: 6, day: 28 } // Jun quarter → 28 Jul
};

// Super is due 28 days after quarter end (28 Oct / 28 Jan / 28 Apr / 28 Jul).
const SUPER_DUE_BY_QUARTER_END_MONTH: Record<number, { month: number; day: number }> = {
  8: { month: 9, day: 28 },
  11: { month: 0, day: 28 },
  2: { month: 3, day: 28 },
  5: { month: 6, day: 28 }
};

function quarterEndMonth(date: Date): number {
  const month = date.getUTCMonth();
  if (month <= 2) return 2;
  if (month <= 5) return 5;
  if (month <= 8) return 8;
  return 11;
}

function nextOccurrence(due: { month: number; day: number }, after: Date): Date {
  const year = after.getUTCFullYear();
  for (const y of [year, year + 1]) {
    const candidate = new Date(Date.UTC(y, due.month, due.day));
    if (candidate >= after) return candidate;
  }
  return new Date(Date.UTC(year + 1, due.month, due.day));
}

async function buildCashflow(weeks: number): Promise<ForecastCashflowPayload> {
  const todayKey = sydneyTodayKey();
  const today = dateFromKey(todayKey);
  const weekStart = mondayOf(today);
  const horizonEnd = addDaysUtc(weekStart, weeks * 7);

  const [outlook, configRow, superRate, openBills] = await Promise.all([
    buildOutlook({ weeks, venue: null, persistSnapshots: false }),
    ensureConfig(),
    configuredSuperRateFraction(),
    prisma.supplierInvoice.findMany({
      where: { status: 'AUTHORISED' },
      select: { supplierName: true, totalCents: true, dueDate: true, invoiceDate: true }
    })
  ]);
  const config = configToPayload(configRow);

  // Daily all-venue sales forecast across the horizon.
  const dailySales = new Map<string, number>();
  for (const venueOutlook of outlook.venues) {
    for (const day of venueOutlook.days) {
      dailySales.set(day.date, (dailySales.get(day.date) ?? 0) + day.salesForecastCents);
    }
  }

  const weekIndexOf = (date: Date): number => Math.floor((date.getTime() - weekStart.getTime()) / (7 * DAY_MS));
  const clampWeek = (index: number): number => Math.min(weeks - 1, Math.max(0, index));

  type Bucket = Map<CashflowComponent, number>;
  const inflows: Bucket[] = Array.from({ length: weeks }, () => new Map());
  const outflows: Bucket[] = Array.from({ length: weeks }, () => new Map());
  const estimatedFlags = new Set<CashflowComponent>(['supplier_projected', 'gst_remittance', 'super_remittance']);
  const add = (buckets: Bucket[], index: number, key: CashflowComponent, cents: number) => {
    if (cents <= 0) return;
    const bucket = buckets[clampWeek(index)];
    if (!bucket) return;
    bucket.set(key, (bucket.get(key) ?? 0) + cents);
  };

  const notes: string[] = [];

  // Opening balance boundary: takings up to and including this date are assumed
  // to already be in the bank balance.
  const openingAsOf = config.openingBalanceDate ? dateFromKey(keyOf(new Date(config.openingBalanceDate))) : addDaysUtc(today, -1);
  if (!config.openingBalanceDate) {
    notes.push('No opening balance date set — the projection starts from $' + (config.openingBalanceCents / 100).toLocaleString() + ' as of today. Set the real bank balance under Assumptions.');
  } else if (openingAsOf < addDaysUtc(today, -14)) {
    notes.push('The opening balance was last set more than two weeks ago — update it so the runway is anchored to reality.');
  }

  // 1) Inflows: forecast takings settle after the card-settlement lag.
  let accruedSalesCents = 0;
  let accruedPurchasesCents = 0;
  for (const [dateKey, salesCents] of dailySales) {
    const saleDate = dateFromKey(dateKey);
    if (saleDate <= openingAsOf) continue;
    accruedSalesCents += salesCents;
    const settleDate = addDaysUtc(saleDate, config.cardSettlementLagDays);
    if (settleDate < today) continue;
    add(inflows, weekIndexOf(settleDate), 'sales_settlement', salesCents);
  }

  // 2) Known supplier bills (Xero AUTHORISED, i.e. approved and unpaid).
  for (const bill of openBills) {
    const due = bill.dueDate ?? addDaysUtc(bill.invoiceDate ?? today, config.supplierPaymentLagDays);
    const dueClamped = due < today ? today : due;
    if (dueClamped >= horizonEnd) continue;
    add(outflows, weekIndexOf(dueClamped), 'supplier_bills_due', bill.totalCents);
  }

  // 3) Projected supplier spend for stock bought from tomorrow onwards (COGS %
  //    of forecast sales), paid after the configured supplier lag. Known bills
  //    above cover purchases already invoiced.
  const cogsPctBlend = (() => {
    let cogs = 0;
    let salesTotal = 0;
    for (const venueOutlook of outlook.venues) {
      for (const week of venueOutlook.weeks) {
        cogs += week.cogsForecastCents;
        salesTotal += week.salesForecastCents;
      }
    }
    return salesTotal > 0 ? cogs / salesTotal : DEFAULT_COGS_PCT / 100;
  })();
  for (const [dateKey, salesCents] of dailySales) {
    const saleDate = dateFromKey(dateKey);
    if (saleDate <= today) continue;
    const purchaseCents = Math.round(salesCents * cogsPctBlend);
    accruedPurchasesCents += purchaseCents;
    const payDate = addDaysUtc(saleDate, config.supplierPaymentLagDays);
    if (payDate >= horizonEnd) continue;
    add(outflows, weekIndexOf(payDate), 'supplier_projected', purchaseCents);
  }

  // 4) Wages: each week's forecast wages (super split out) paid on the payday
  //    of the following week. Last week's actual payroll is included when its
  //    payday is still ahead.
  const superFraction = superRate / (1 + superRate);
  let superAccruedCents = 0;
  const paydayForWeek = (weekMonday: Date): Date => {
    // Payday in the week AFTER the worked week: Mon+7 .. Mon+13.
    const base = addDaysUtc(weekMonday, 7);
    const offset = (config.payrollPayWeekday - base.getUTCDay() + 7) % 7;
    return addDaysUtc(base, offset);
  };

  const priorWeekStart = addDaysUtc(weekStart, -7);
  const priorWeekWages = await recapWageCents(null, priorWeekStart, weekStart);
  {
    const payday = paydayForWeek(priorWeekStart);
    if (payday >= today && payday < horizonEnd) {
      const superPart = Math.round(priorWeekWages * superFraction);
      superAccruedCents += superPart;
      add(outflows, weekIndexOf(payday), 'net_wages', priorWeekWages - superPart);
    }
  }
  outlook.totals.weeks.forEach((week, index) => {
    const weekMonday = addDaysUtc(weekStart, index * 7);
    const payday = paydayForWeek(weekMonday);
    const superPart = Math.round(week.wagesForecastCents * superFraction);
    superAccruedCents += superPart;
    if (payday < today || payday >= horizonEnd) return;
    add(outflows, weekIndexOf(payday), 'net_wages', week.wagesForecastCents - superPart);
  });
  if (config.payrollFrequency === 'FORTNIGHTLY') {
    notes.push('Payroll is set to fortnightly but the projection books each week on its following payday — treat pay-week timing as approximate.');
  }

  // 5) Super remittance: accrued super paid 28 days after each quarter end.
  {
    const due = nextOccurrence(SUPER_DUE_BY_QUARTER_END_MONTH[quarterEndMonth(today)]!, today);
    if (due < horizonEnd) {
      add(outflows, weekIndexOf(due), 'super_remittance', superAccruedCents);
      notes.push('Super remittance covers only wages accrued inside this projection window — super owing from before this window is not included.');
    }
  }

  // 6) GST: 1/11th of takings less 1/11th of purchases, remitted at the next
  //    BAS due date. Only GST accrued inside the window is projected.
  {
    const due = nextOccurrence(BAS_DUE_BY_QUARTER_END_MONTH[quarterEndMonth(today)]!, today);
    if (due < horizonEnd) {
      const gstCents = Math.max(0, Math.round(accruedSalesCents / 11 - accruedPurchasesCents / 11));
      add(outflows, weekIndexOf(due), 'gst_remittance', gstCents);
      notes.push('GST is estimated as 1/11th of forecast takings less purchases accrued in this window — BAS liabilities from earlier quarters are not included.');
    }
  }

  // 7) Fixed outgoings.
  for (const cost of config.fixedCosts) {
    if (cost.cadence === 'WEEKLY') {
      for (let w = 0; w < weeks; w += 1) add(outflows, w, 'fixed_costs', cost.amountCents);
      continue;
    }
    const day = Math.min(28, Math.max(1, cost.dayOfMonth ?? 1));
    for (let cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, day)); cursor < horizonEnd; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, day))) {
      if (cursor < today) continue;
      const monthIndex = cursor.getUTCMonth() + 1;
      if (cost.cadence === 'MONTHLY') {
        add(outflows, weekIndexOf(cursor), 'fixed_costs', cost.amountCents);
      } else if (cost.cadence === 'QUARTERLY') {
        const anchor = cost.month ?? 1;
        if ((monthIndex - anchor + 12) % 3 === 0) add(outflows, weekIndexOf(cursor), 'fixed_costs', cost.amountCents);
      } else if (cost.cadence === 'ANNUAL') {
        if (monthIndex === (cost.month ?? 1)) add(outflows, weekIndexOf(cursor), 'fixed_costs', cost.amountCents);
      }
    }
  }

  notes.push('There is no live bank feed — the balance line is opening balance plus projected movements, not the actual bank ledger.');

  // Assemble weeks.
  const weeksOut: CashflowWeek[] = [];
  let balance = config.openingBalanceCents;
  let lowest: { weekStart: string; balanceCents: number } | null = null;
  for (let w = 0; w < weeks; w += 1) {
    const weekKey = keyOf(addDaysUtc(weekStart, w * 7));
    const components: CashflowWeek['components'] = [];
    let inflowCents = 0;
    let outflowCents = 0;
    for (const [key, amount] of inflows[w] ?? new Map<CashflowComponent, number>()) {
      inflowCents += amount;
      components.push({ key, label: COMPONENT_LABELS[key], amountCents: amount, direction: 'in', estimated: estimatedFlags.has(key) });
    }
    for (const [key, amount] of outflows[w] ?? new Map<CashflowComponent, number>()) {
      outflowCents += amount;
      components.push({ key, label: COMPONENT_LABELS[key], amountCents: amount, direction: 'out', estimated: estimatedFlags.has(key) });
    }
    balance += inflowCents - outflowCents;
    if (!lowest || balance < lowest.balanceCents) lowest = { weekStart: weekKey, balanceCents: balance };
    weeksOut.push({
      weekStart: weekKey,
      inflowCents,
      outflowCents,
      netCents: inflowCents - outflowCents,
      closingBalanceCents: balance,
      components: components.sort((a, b) => b.amountCents - a.amountCents)
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    horizonWeeks: weeks,
    config,
    openingBalanceCents: config.openingBalanceCents,
    weeks: weeksOut,
    lowestBalance: lowest,
    notes
  };
}

// ── Accuracy ─────────────────────────────────────────────────────────────────

const ACCURACY_BUCKETS = [
  { leadLabel: '1–2 days out', leadDaysMin: 1, leadDaysMax: 2 },
  { leadLabel: '~1 week out', leadDaysMin: 5, leadDaysMax: 9 },
  { leadLabel: '~2 weeks out', leadDaysMin: 12, leadDaysMax: 16 }
];

async function buildAccuracy(): Promise<ForecastAccuracyPayload> {
  const today = dateFromKey(sydneyTodayKey());
  const since = addDaysUtc(today, -56);

  const [snapshots, actualRows, coverRows] = await Promise.all([
    prisma.forecastDaySnapshot.findMany({
      where: { forecastDate: { gte: since, lt: today } },
      select: { venue: true, forecastDate: true, leadDays: true, salesForecastCents: true, coversForecast: true }
    }),
    prisma.salesActualEntry.groupBy({
      by: ['venue', 'serviceDate'],
      where: { serviceDate: { gte: since, lt: today } },
      _sum: { salesCents: true }
    }),
    prisma.reserveReservation.groupBy({
      by: ['venue', 'serviceDate'],
      where: { serviceDate: { gte: since, lt: today }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
      _sum: { covers: true }
    })
  ]);

  const actualSales = new Map<string, number>();
  for (const row of actualRows) {
    const key = `${row.venue}|${keyOf(row.serviceDate)}`;
    actualSales.set(key, (actualSales.get(key) ?? 0) + (row._sum.salesCents ?? 0));
  }
  const actualCovers = new Map<string, number>();
  for (const row of coverRows) {
    const key = `${row.venue}|${keyOf(row.serviceDate)}`;
    actualCovers.set(key, (actualCovers.get(key) ?? 0) + (row._sum.covers ?? 0));
  }

  const buckets: ForecastAccuracyBucket[] = ACCURACY_BUCKETS.map((bucket) => {
    // One snapshot per venue-day: the lead closest to the bucket centre.
    const centre = (bucket.leadDaysMin + bucket.leadDaysMax) / 2;
    const best = new Map<string, (typeof snapshots)[number]>();
    for (const snap of snapshots) {
      if (snap.leadDays < bucket.leadDaysMin || snap.leadDays > bucket.leadDaysMax) continue;
      const key = `${snap.venue}|${keyOf(snap.forecastDate)}`;
      const current = best.get(key);
      if (!current || Math.abs(snap.leadDays - centre) < Math.abs(current.leadDays - centre)) best.set(key, snap);
    }
    let salesErrSum = 0;
    let salesBiasSum = 0;
    let salesN = 0;
    let coversErrSum = 0;
    let coversN = 0;
    for (const [key, snap] of best) {
      const actual = actualSales.get(key) ?? 0;
      if (actual > 0) {
        const err = (snap.salesForecastCents - actual) / actual;
        salesErrSum += Math.abs(err);
        salesBiasSum += err;
        salesN += 1;
      }
      const covers = actualCovers.get(key) ?? 0;
      if (covers > 0 && snap.coversForecast > 0) {
        coversErrSum += Math.abs(snap.coversForecast - covers) / covers;
        coversN += 1;
      }
    }
    return {
      ...bucket,
      sampleDays: best.size,
      salesMapePct: salesN > 0 ? Math.round((salesErrSum / salesN) * 1000) / 10 : null,
      salesBiasPct: salesN > 0 ? Math.round((salesBiasSum / salesN) * 1000) / 10 : null,
      coversMapePct: coversN > 0 ? Math.round((coversErrSum / coversN) * 1000) / 10 : null
    };
  });

  // Weekly forecast-vs-actual (using the ~1-week-out snapshots).
  const weekRowMap = new Map<string, { forecast: number; actual: number }>();
  const weekBest = new Map<string, (typeof snapshots)[number]>();
  for (const snap of snapshots) {
    if (snap.leadDays < 5 || snap.leadDays > 9) continue;
    const key = `${snap.venue}|${keyOf(snap.forecastDate)}`;
    const current = weekBest.get(key);
    if (!current || Math.abs(snap.leadDays - 7) < Math.abs(current.leadDays - 7)) weekBest.set(key, snap);
  }
  for (const [key, snap] of weekBest) {
    const venue = key.split('|')[0] ?? '';
    const weekKey = `${venue}|${keyOf(mondayOf(snap.forecastDate))}`;
    const row = weekRowMap.get(weekKey) ?? { forecast: 0, actual: 0 };
    row.forecast += snap.salesForecastCents;
    row.actual += actualSales.get(key) ?? 0;
    weekRowMap.set(weekKey, row);
  }
  const recentWeeks: ForecastAccuracyWeekRow[] = [...weekRowMap.entries()]
    .map(([key, row]) => {
      const [venue = '', weekStartKey = ''] = key.split('|');
      return {
        weekStart: weekStartKey,
        venue,
        forecastSalesCents: row.forecast,
        actualSalesCents: row.actual,
        variancePct: row.forecast > 0 && row.actual > 0 ? Math.round(((row.actual - row.forecast) / row.forecast) * 1000) / 10 : null
      };
    })
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : a.venue.localeCompare(b.venue)));

  return { buckets, recentWeeks };
}

// ── Public service ───────────────────────────────────────────────────────────

export const forecastService = {
  async outlook(query: unknown, actor: AuthUser): Promise<ForecastOutlookPayload> {
    const parsed = outlookQuerySchema.parse(query ?? {});
    const venue = actorVenueScope(actor, parsed.venue?.trim() || null);
    return buildOutlook({ weeks: parsed.weeks, venue, persistSnapshots: true });
  },

  async cashflow(query: unknown, actor: AuthUser): Promise<ForecastCashflowPayload> {
    // Cash flow spans the whole business, so it is org-wide by design; venue
    // managers still see it (they run the P&L conversation on the ground).
    actorVenueScope(actor, null);
    const parsed = cashflowQuerySchema.parse(query ?? {});
    return buildCashflow(parsed.weeks);
  },

  async accuracy(): Promise<ForecastAccuracyPayload> {
    return buildAccuracy();
  },

  async getConfig(): Promise<ForecastConfigPayload> {
    return configToPayload(await ensureConfig());
  },

  async updateConfig(input: unknown): Promise<ForecastConfigPayload> {
    const data = forecastConfigUpdateSchema.parse(input ?? {});
    await ensureConfig();
    const updated = await prisma.forecastConfig.update({
      where: { id: CONFIG_ID },
      data: {
        ...(data.openingBalanceCents !== undefined && { openingBalanceCents: data.openingBalanceCents }),
        ...(data.openingBalanceDate !== undefined && {
          openingBalanceDate: data.openingBalanceDate ? new Date(data.openingBalanceDate) : null
        }),
        ...(data.supplierPaymentLagDays !== undefined && { supplierPaymentLagDays: data.supplierPaymentLagDays }),
        ...(data.cardSettlementLagDays !== undefined && { cardSettlementLagDays: data.cardSettlementLagDays }),
        ...(data.payrollFrequency !== undefined && { payrollFrequency: data.payrollFrequency }),
        ...(data.payrollPayWeekday !== undefined && { payrollPayWeekday: data.payrollPayWeekday }),
        ...(data.fixedCosts !== undefined && { fixedCosts: data.fixedCosts })
      }
    });
    return configToPayload(updated);
  },

  // Nightly scheduler entry point: generate the full-horizon forecast for all
  // venues purely to write the day's accuracy snapshots.
  async runScheduledSnapshot(): Promise<{ ok: true; venues: number; days: number }> {
    const outlook = await buildOutlook({ weeks: 13, venue: null, persistSnapshots: true });
    return {
      ok: true,
      venues: outlook.venues.length,
      days: outlook.venues.reduce((sum, v) => sum + v.days.length, 0)
    };
  }
};
