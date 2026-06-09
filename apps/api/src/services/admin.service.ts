import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import type {
  AlmaAppId,
  AuthUser,
  AdminAccessBulkUpdateResult,
  AdminAccessUsersPayload,
  AdminAuditEventsPayload,
  AdminAuditEventSummary,
  AdminIntegrationsStatusPayload,
  AdminOverviewPayload,
  AdminReadinessWarning,
  AdminStaffCostingPayload,
  AdminSystemHealthPayload
} from '@alma/shared';
import {
  adminAccessBulkUpdateInputSchema,
  adminAccessUserCreateInputSchema,
  adminStaffCostingQuerySchema
} from '@alma/shared';
import { env } from '../env.js';
import { integrationService } from './integration.service.js';
import { mailService } from './mail.service.js';
import { settingsService } from './settings.service.js';
import { HttpError } from '../lib/http.js';
import { staffCostingRate, splitOvertimeHours, costForRate, weeklyFixedCostCents, FULL_TIME_ORDINARY_WEEKLY_HOURS } from '../lib/staff-pay-rates.js';

const APP_LABELS: Record<AlmaAppId, string> = {
  COMPLIANCE: 'Compliance',
  STOCK: 'Stock',
  STAFF: 'Staff',
  REPORTS: 'Reports',
  RESERVE: 'Reserve',
  MARKETING: 'Marketing',
  GIFTCARDS: 'Gift Cards',
  TRAINING: 'Training',
  SETTINGS: 'Settings'
};

const APP_IDS = Object.keys(APP_LABELS) as AlmaAppId[];

const ACCESS_PERMISSION_KEYS = [
  {
    key: 'view',
    label: 'View',
    description: 'Can open the app and read permitted venue data.'
  },
  {
    key: 'create',
    label: 'Create',
    description: 'Can add new operational records where the app supports it.'
  },
  {
    key: 'edit',
    label: 'Edit',
    description: 'Can update operational records in permitted venues.'
  },
  {
    key: 'approve',
    label: 'Approve',
    description: 'Can approve reviews, requests, stocktakes or content where available.'
  },
  {
    key: 'export',
    label: 'Export',
    description: 'Can export reports or operational data where available.'
  },
  {
    key: 'delete',
    label: 'Delete',
    description: 'Can archive or remove records where the app allows it.',
    dangerous: true
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'Can manage setup or admin-only actions for that app.',
    dangerous: true
  }
];

const activeStaffWhere: Prisma.StaffProfileWhereInput = {
  accountType: 'HUMAN',
  employmentStatus: 'ACTIVE',
  mergedIntoStaffProfileId: null
};

function startOfMonday(input = new Date()) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function addDays(input: Date, days: number) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function endOfDay(input: Date) {
  const date = new Date(input);
  date.setDate(date.getDate() + 1);
  return date;
}

function parseReportDate(value: string | undefined, fallback: Date, label: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${label} is invalid.`);
  return date;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function hoursBetween(start: Date, end: Date, breakMinutes: number) {
  if (end <= start) return 0;
  return Math.max(0, (end.getTime() - start.getTime()) / 36e5 - breakMinutes / 60);
}

// Staff cost-per-hour resolution (payroll-section rates, salary + overtime past
// 45h/week, super) is shared with the Prime Cost report — see
// ../lib/staff-pay-rates (staffCostingRate / splitOvertimeHours / costForRate).

type CostingRow = {
  actualHours: number;
  actualCostCents: number;
  approvedHours: number;
  approvedCostCents: number;
  scheduledHours: number;
  scheduledCostCents: number;
  staffIds: Set<string>;
  missingRateHours: number;
};

function emptyCostingRow(): CostingRow {
  return {
    actualHours: 0,
    actualCostCents: 0,
    approvedHours: 0,
    approvedCostCents: 0,
    scheduledHours: 0,
    scheduledCostCents: 0,
    staffIds: new Set<string>(),
    missingRateHours: 0
  };
}

function averageHourlyCost(costCents: number, hours: number) {
  return hours > 0 ? Math.round(costCents / hours) : null;
}

function addActual(row: CostingRow, staffProfileId: string, hours: number, costCents: number, approved: boolean, missingRate: boolean) {
  row.actualHours += hours;
  row.actualCostCents += costCents;
  row.staffIds.add(staffProfileId);
  if (approved) {
    row.approvedHours += hours;
    row.approvedCostCents += costCents;
  }
  if (missingRate) row.missingRateHours += hours;
}

function addScheduled(row: CostingRow, staffProfileId: string, hours: number, costCents: number, missingRate: boolean) {
  row.scheduledHours += hours;
  row.scheduledCostCents += costCents;
  row.staffIds.add(staffProfileId);
  if (missingRate) row.missingRateHours += hours;
}

function provider() {
  if (process.env.RESEND_API_KEY && (process.env.RESEND_FROM || process.env.MAIL_FROM)) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'none';
}

function hasAdminPermission(value: unknown) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { admin?: unknown }).admin === true
  );
}

function permissionRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, allowed]) => typeof allowed === 'boolean')
  ) as Record<string, boolean>;
}

function summariseAuditEvent(event: {
  id: string;
  staffProfileId: string;
  eventType: string;
  summary: string;
  createdByName: string | null;
  createdAt: Date;
  staffProfile: {
    firstName: string;
    lastName: string;
    roleTitle: string | null;
    venue: string | null;
  };
}): AdminAuditEventSummary {
  return {
    id: event.id,
    staffProfileId: event.staffProfileId,
    staffName: `${event.staffProfile.firstName} ${event.staffProfile.lastName}`.trim(),
    staffRoleTitle: event.staffProfile.roleTitle,
    venue: event.staffProfile.venue,
    eventType: event.eventType,
    summary: event.summary,
    createdByName: event.createdByName,
    createdAt: event.createdAt.toISOString()
  };
}

function appUrlRows() {
  const entries = [
    ['Compliance', 'COMPLIANCE_WEB_URL', process.env.COMPLIANCE_WEB_URL ?? process.env.FRONTEND_URL ?? null],
    ['Stock', 'STOCK_WEB_URL', process.env.STOCK_WEB_URL ?? null],
    ['Staff', 'STAFF_WEB_URL', process.env.STAFF_WEB_URL ?? null],
    ['Reports', 'REPORTS_WEB_URL', process.env.REPORTS_WEB_URL ?? null],
    ['Reserve', 'RESERVE_WEB_URL', process.env.RESERVE_WEB_URL ?? null],
    ['Marketing', 'MARKETING_WEB_URL', process.env.MARKETING_WEB_URL ?? null],
    ['Gift Cards', 'GIFTCARDS_WEB_URL', process.env.GIFTCARDS_WEB_URL ?? process.env.GIFT_CARDS_WEB_URL ?? null],
    ['API', 'API_PUBLIC_URL', env.publicApiUrl ?? null]
  ] as const;

  return entries.map(([app, envVar, url]) => ({
    app,
    envVar,
    status: url ? 'configured' as const : 'missing' as const,
    url
  }));
}

async function recentAuditEvents(limit = 6, eventType?: string | null) {
  const events = await prisma.staffManagementEvent.findMany({
    where: eventType ? { eventType } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      staffProfile: {
        select: {
          firstName: true,
          lastName: true,
          roleTitle: true,
          venue: true
        }
      }
    }
  });

  return events.map(summariseAuditEvent);
}

export const adminService = {
  async staffCostingReport(input: unknown): Promise<AdminStaffCostingPayload> {
    const query = adminStaffCostingQuerySchema.parse(input ?? {});
    const defaultStart = startOfMonday(new Date());
    const start = parseReportDate(query.start, defaultStart, 'Costing start date');
    const end = parseReportDate(query.end, addDays(start, 7), 'Costing end date');
    if (end <= start) throw new HttpError(400, 'Costing end date must be after the start date.');
    const venueFilter = query.venue?.trim() || null;
    // Reject an unknown venue filter with a clear error instead of silently
    // returning an empty report. Lenient: only enforced when venues are
    // configured, so data drift never hard-blocks the report.
    if (venueFilter) {
      const settingsRow = await prisma.appSettings.findUnique({
        where: { id: 'singleton' },
        select: { venues: true }
      });
      const knownVenues = Array.isArray(settingsRow?.venues)
        ? settingsRow!.venues
            .filter(
              (v): v is { name: string } =>
                typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string'
            )
            .map((v) => v.name)
        : [];
      if (knownVenues.length && !knownVenues.includes(venueFilter)) {
        throw new HttpError(400, `Unknown venue "${venueFilter}".`);
      }
    }
    const staffSelect = {
      id: true,
      firstName: true,
      lastName: true,
      roleTitle: true,
      venue: true,
      payRateCents: true,
      trainingPayRateCents: true,
      payProfile: {
        select: {
          employmentType: true,
          payMode: true,
          ordinaryHourlyRateCents: true,
          casualLoadedHourlyRateCents: true,
          manualFullTimePayAmountCents: true,
          manualFullTimePayFrequency: true,
          cashHourlyRateCents: true
        }
      }
    } satisfies Prisma.StaffProfileSelect;

    const [timesheets, rosterShifts, activeStaff] = await Promise.all([
      prisma.timesheet.findMany({
        where: {
          workDate: { gte: start, lt: end },
          status: { not: 'REJECTED' },
          ...(venueFilter ? { OR: [{ venue: venueFilter }, { venue: null, staffProfile: { venue: venueFilter } }] } : {}),
          staffProfile: {
            accountType: 'HUMAN',
            mergedIntoStaffProfileId: null
          }
        },
        include: { staffProfile: { select: staffSelect } },
        orderBy: [{ workDate: 'asc' }, { clockInAt: 'asc' }]
      }),
      prisma.rosterShift.findMany({
        where: {
          startsAt: { lt: end },
          endsAt: { gt: start },
          status: { not: 'CANCELLED' },
          ...(venueFilter ? { OR: [{ venue: venueFilter }, { venue: null, staffProfile: { venue: venueFilter } }] } : {}),
          staffProfile: {
            accountType: 'HUMAN',
            mergedIntoStaffProfileId: null
          }
        },
        include: { staffProfile: { select: staffSelect } },
        orderBy: [{ startsAt: 'asc' }]
      }),
      // Active salaried staff are costed every week regardless of timesheets, so
      // we need the full active roster (filtered to salaried + costed below).
      prisma.staffProfile.findMany({
        where: {
          accountType: 'HUMAN',
          mergedIntoStaffProfileId: null,
          employmentStatus: 'ACTIVE',
          payProfile: { isNot: null }
        },
        select: staffSelect
      })
    ]);

    const byVenue = new Map<string, CostingRow>();
    const byArea = new Map<string, CostingRow & { venue: string; area: string }>();
    const byRole = new Map<string, CostingRow & { roleTitle: string }>();
    const byStaff = new Map<string, CostingRow & {
      staffProfileId: string;
      staffName: string;
      venue: string;
      roleTitle: string;
      rateCents: number | null;
      rateSource: string;
      missingRate: boolean;
    }>();
    const byDay = new Map<string, Omit<CostingRow, 'staffIds' | 'approvedHours' | 'approvedCostCents' | 'missingRateHours'> & { staffIds: Set<string> }>();
    // Cumulative weekly hours per staff, used to split ordinary vs overtime for
    // salaried full-timers (>45h/week). Actual and scheduled are tracked apart.
    const actualWeekHours = new Map<string, number>();
    const scheduledWeekHours = new Map<string, number>();

    const rowFor = (map: Map<string, CostingRow>, key: string) => {
      const row = map.get(key) ?? emptyCostingRow();
      map.set(key, row);
      return row;
    };
    const areaFor = (venue: string, area: string) => {
      const key = `${venue}|${area}`;
      const row = byArea.get(key) ?? { ...emptyCostingRow(), venue, area };
      byArea.set(key, row);
      return row;
    };
    const roleFor = (roleTitle: string) => {
      const row = byRole.get(roleTitle) ?? { ...emptyCostingRow(), roleTitle };
      byRole.set(roleTitle, row);
      return row;
    };
    const dayFor = (dateKey: string) => {
      const row = byDay.get(dateKey) ?? {
        actualHours: 0,
        actualCostCents: 0,
        scheduledHours: 0,
        scheduledCostCents: 0,
        staffIds: new Set<string>()
      };
      byDay.set(dateKey, row);
      return row;
    };
    // Per-staff rows are split by the venue they actually worked at (from the
    // timesheet/shift), so staff who work across both venues — full-timers
    // especially — show a row per venue with that venue's hours and cost.
    const staffFor = (profile: typeof timesheets[number]['staffProfile'], entryVenue: string) => {
      const venue = entryVenue || profile.venue?.trim() || 'Unassigned';
      const roleTitle = profile.roleTitle?.trim() || 'Unassigned role';
      const rate = staffCostingRate(profile);
      const key = `${profile.id}|${venue}`;
      const row = byStaff.get(key) ?? {
        ...emptyCostingRow(),
        staffProfileId: profile.id,
        staffName: `${profile.firstName} ${profile.lastName}`.trim(),
        venue,
        roleTitle,
        rateCents: rate.rateCents,
        rateSource: rate.source,
        missingRate: !rate.rateCents
      };
      byStaff.set(key, row);
      return row;
    };

    for (const entry of timesheets) {
      const venue = entry.venue?.trim() || entry.staffProfile.venue?.trim() || 'Unassigned';
      const area = entry.area?.trim() || 'Unassigned area';
      const roleTitle = entry.roleTitle?.trim() || entry.staffProfile.roleTitle?.trim() || 'Unassigned role';
      const rate = staffCostingRate(entry.staffProfile);
      const hours = hoursBetween(entry.clockInAt, entry.clockOutAt, entry.breakMinutes);
      const split = splitOvertimeHours(actualWeekHours, entry.staffProfileId, entry.workDate, hours, rate.appliesOvertime);
      // Salaried staff: ordinary hours are covered by their fixed weekly salary
      // (added after the loops), so only their overtime is costed from timesheets.
      const cost = rate.appliesOvertime ? costForRate({ ...rate, ordinaryRateCents: 0 }, split) : costForRate(rate, split);
      const approved = entry.status === 'APPROVED' || entry.status === 'EXPORTED';
      const missingRate = !rate.rateCents && hours > 0;
      addActual(rowFor(byVenue, venue), entry.staffProfileId, hours, cost, approved, missingRate);
      addActual(areaFor(venue, area), entry.staffProfileId, hours, cost, approved, missingRate);
      addActual(roleFor(roleTitle), entry.staffProfileId, hours, cost, approved, missingRate);
      addActual(staffFor(entry.staffProfile, venue), entry.staffProfileId, hours, cost, approved, missingRate);
      const day = dayFor(isoDate(entry.workDate));
      day.actualHours += hours;
      day.actualCostCents += cost;
      day.staffIds.add(entry.staffProfileId);
    }

    for (const shift of rosterShifts) {
      const venue = shift.venue?.trim() || shift.staffProfile.venue?.trim() || 'Unassigned';
      const area = shift.area?.trim() || 'Unassigned area';
      const roleTitle = shift.roleTitle?.trim() || shift.staffProfile.roleTitle?.trim() || 'Unassigned role';
      const rate = staffCostingRate(shift.staffProfile);
      const hours = hoursBetween(shift.startsAt, shift.endsAt, shift.breakMinutes);
      const split = splitOvertimeHours(scheduledWeekHours, shift.staffProfileId, shift.startsAt, hours, rate.appliesOvertime);
      const cost = rate.appliesOvertime ? costForRate({ ...rate, ordinaryRateCents: 0 }, split) : costForRate(rate, split);
      const missingRate = !rate.rateCents && hours > 0;
      addScheduled(rowFor(byVenue, venue), shift.staffProfileId, hours, cost, missingRate);
      addScheduled(areaFor(venue, area), shift.staffProfileId, hours, cost, missingRate);
      addScheduled(roleFor(roleTitle), shift.staffProfileId, hours, cost, missingRate);
      addScheduled(staffFor(shift.staffProfile, venue), shift.staffProfileId, hours, cost, missingRate);
      const day = dayFor(isoDate(shift.startsAt));
      day.scheduledHours += hours;
      day.scheduledCostCents += cost;
      day.staffIds.add(shift.staffProfileId);
    }

    // ── Salaried full-timers: full weekly salary + super, every week ──────────
    // A salaried staffer costs their fixed weekly salary regardless of (or even
    // without) timesheets, so add it across the period — split across the venues
    // they worked by hours, defaulting to their home venue. Overtime past 45h/wk
    // is already costed from timesheets above; ordinary hours are covered here.
    const salariedStaff = activeStaff.filter((profile) => weeklyFixedCostCents(staffCostingRate(profile)) > 0);
    if (salariedStaff.length > 0) {
      const periodDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
      const periodWeeks = periodDays / 7;
      const dayKeys: string[] = [];
      for (let d = new Date(start); d < end; d = addDays(d, 1)) dayKeys.push(isoDate(d));

      const salariedIds = salariedStaff.map((profile) => profile.id);
      const allVenueSheets = await prisma.timesheet.findMany({
        where: {
          workDate: { gte: start, lt: end },
          status: { not: 'REJECTED' },
          staffProfileId: { in: salariedIds },
          staffProfile: { accountType: 'HUMAN', mergedIntoStaffProfileId: null }
        },
        select: {
          staffProfileId: true,
          venue: true,
          clockInAt: true,
          clockOutAt: true,
          breakMinutes: true,
          staffProfile: { select: { venue: true } }
        }
      });
      const hoursByStaffVenue = new Map<string, Map<string, number>>();
      for (const ts of allVenueSheets) {
        const v = ts.venue?.trim() || ts.staffProfile.venue?.trim() || 'Unassigned';
        const h = hoursBetween(ts.clockInAt, ts.clockOutAt, ts.breakMinutes);
        const m = hoursByStaffVenue.get(ts.staffProfileId) ?? new Map<string, number>();
        m.set(v, (m.get(v) ?? 0) + h);
        hoursByStaffVenue.set(ts.staffProfileId, m);
      }

      for (const profile of salariedStaff) {
        const rate = staffCostingRate(profile);
        const fixedForPeriod = Math.round(weeklyFixedCostCents(rate) * periodWeeks);
        if (fixedForPeriod <= 0) continue;
        const hv = hoursByStaffVenue.get(profile.id);
        const totalHours = hv ? Array.from(hv.values()).reduce((a, b) => a + b, 0) : 0;
        const allocations: Array<{ venue: string; fraction: number }> = [];
        if (hv && totalHours > 0) {
          for (const [v, h] of hv) allocations.push({ venue: v, fraction: h / totalHours });
        } else {
          allocations.push({ venue: profile.venue?.trim() || 'Unassigned', fraction: 1 });
        }
        const applied = venueFilter ? allocations.filter((a) => a.venue === venueFilter) : allocations;
        for (const alloc of applied) {
          const cents = Math.round(fixedForPeriod * alloc.fraction);
          if (cents <= 0) continue;
          const roleTitle = profile.roleTitle?.trim() || 'Unassigned role';
          addActual(rowFor(byVenue, alloc.venue), profile.id, 0, cents, true, false);
          addActual(areaFor(alloc.venue, 'Salaried'), profile.id, 0, cents, true, false);
          addActual(roleFor(roleTitle), profile.id, 0, cents, true, false);
          addActual(staffFor(profile, alloc.venue), profile.id, 0, cents, true, false);
          addScheduled(rowFor(byVenue, alloc.venue), profile.id, 0, cents, false);
          addScheduled(areaFor(alloc.venue, 'Salaried'), profile.id, 0, cents, false);
          addScheduled(roleFor(roleTitle), profile.id, 0, cents, false);
          addScheduled(staffFor(profile, alloc.venue), profile.id, 0, cents, false);
          const perDay = cents / dayKeys.length;
          for (const dk of dayKeys) {
            const day = dayFor(dk);
            day.actualCostCents += perDay;
            day.scheduledCostCents += perDay;
            day.staffIds.add(profile.id);
          }
        }
      }
    }

    const totals = Array.from(byVenue.values()).reduce((sum, row) => {
      sum.actualHours += row.actualHours;
      sum.actualCostCents += row.actualCostCents;
      sum.approvedHours += row.approvedHours;
      sum.approvedCostCents += row.approvedCostCents;
      sum.scheduledHours += row.scheduledHours;
      sum.scheduledCostCents += row.scheduledCostCents;
      sum.missingRateHours += row.missingRateHours;
      for (const staffId of row.staffIds) sum.staffIds.add(staffId);
      return sum;
    }, { ...emptyCostingRow(), staffIds: new Set<string>() });

    const missingRateStaff = Array.from(byStaff.values()).filter((row) => row.missingRate && (row.actualHours > 0 || row.scheduledHours > 0));
    const warnings = [
      ...(timesheets.length ? [] : ['No actual timesheets found for this period. Scheduled roster cost is shown as forecast only.']),
      ...(rosterShifts.length ? [] : ['No roster shifts found for this period. Variance against schedule is unavailable.']),
      ...(missingRateStaff.length ? [`${missingRateStaff.length} staff have hours but no hourly rate available, so their cost is understated.`] : [])
    ];

    return {
      generatedAt: new Date().toISOString(),
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        label: `${isoDate(start)} to ${isoDate(addDays(end, -1))}`
      },
      filters: {
        venue: venueFilter,
        source: query.source
      },
      totals: {
        actualHours: totals.actualHours,
        actualCostCents: totals.actualCostCents,
        approvedHours: totals.approvedHours,
        approvedCostCents: totals.approvedCostCents,
        scheduledHours: totals.scheduledHours,
        scheduledCostCents: totals.scheduledCostCents,
        varianceHours: totals.actualHours - totals.scheduledHours,
        varianceCostCents: totals.actualCostCents - totals.scheduledCostCents,
        averageHourlyCostCents: averageHourlyCost(totals.actualCostCents, totals.actualHours),
        missingRateHours: totals.missingRateHours,
        missingRateCount: missingRateStaff.length,
        staffCount: totals.staffIds.size,
        shiftCount: rosterShifts.length,
        timesheetCount: timesheets.length
      },
      sourceQuality: {
        actualTimesheets: timesheets.length > 0,
        scheduledRoster: rosterShifts.length > 0,
        missingRates: missingRateStaff.length > 0,
        notes: warnings
      },
      byVenue: Array.from(byVenue.entries()).map(([venue, row]) => ({
        venue,
        actualHours: row.actualHours,
        actualCostCents: row.actualCostCents,
        approvedHours: row.approvedHours,
        approvedCostCents: row.approvedCostCents,
        scheduledHours: row.scheduledHours,
        scheduledCostCents: row.scheduledCostCents,
        varianceHours: row.actualHours - row.scheduledHours,
        varianceCostCents: row.actualCostCents - row.scheduledCostCents,
        averageHourlyCostCents: averageHourlyCost(row.actualCostCents, row.actualHours),
        staffCount: row.staffIds.size,
        missingRateHours: row.missingRateHours
      })).sort((a, b) => b.actualCostCents - a.actualCostCents),
      byArea: Array.from(byArea.values()).map((row) => ({
        area: row.area,
        venue: row.venue,
        actualHours: row.actualHours,
        actualCostCents: row.actualCostCents,
        scheduledHours: row.scheduledHours,
        scheduledCostCents: row.scheduledCostCents,
        averageHourlyCostCents: averageHourlyCost(row.actualCostCents, row.actualHours),
        staffCount: row.staffIds.size,
        shareOfActualCost: totals.actualCostCents > 0 ? row.actualCostCents / totals.actualCostCents : null
      })).sort((a, b) => b.actualCostCents - a.actualCostCents),
      byRole: Array.from(byRole.values()).map((row) => ({
        roleTitle: row.roleTitle,
        actualHours: row.actualHours,
        actualCostCents: row.actualCostCents,
        scheduledHours: row.scheduledHours,
        scheduledCostCents: row.scheduledCostCents,
        averageHourlyCostCents: averageHourlyCost(row.actualCostCents, row.actualHours),
        staffCount: row.staffIds.size
      })).sort((a, b) => b.actualCostCents - a.actualCostCents),
      byStaff: Array.from(byStaff.values()).map((row) => ({
        staffProfileId: row.staffProfileId,
        staffName: row.staffName,
        venue: row.venue,
        roleTitle: row.roleTitle,
        actualHours: row.actualHours,
        actualCostCents: row.actualCostCents,
        approvedHours: row.approvedHours,
        approvedCostCents: row.approvedCostCents,
        scheduledHours: row.scheduledHours,
        scheduledCostCents: row.scheduledCostCents,
        averageHourlyCostCents: averageHourlyCost(row.actualCostCents, row.actualHours),
        rateCents: row.rateCents,
        rateSource: row.rateSource,
        missingRate: row.missingRate
      })).sort((a, b) => b.actualCostCents - a.actualCostCents),
      daily: Array.from(byDay.entries()).map(([date, row]) => ({
        date,
        actualHours: row.actualHours,
        actualCostCents: row.actualCostCents,
        scheduledHours: row.scheduledHours,
        scheduledCostCents: row.scheduledCostCents,
        varianceCostCents: row.actualCostCents - row.scheduledCostCents
      })).sort((a, b) => a.date.localeCompare(b.date)),
      warnings
    };
  },

  async accessUsers(): Promise<AdminAccessUsersPayload> {
    const users = await prisma.staffProfile.findMany({
      where: {
        accountType: 'HUMAN',
        mergedIntoStaffProfileId: null,
        NOT: { employmentStatus: 'ARCHIVED' }
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        venue: true,
        roleTitle: true,
        employmentStatus: true,
        accountType: true,
        isAdmin: true,
        passwordHash: true,
        pinHash: true,
        pinUpdatedAt: true,
        appAccess: { orderBy: [{ appId: 'asc' }] }
      }
    });

    return {
      generatedAt: new Date().toISOString(),
      apps: APP_IDS.map((appId) => ({ appId, label: APP_LABELS[appId] })),
      permissionKeys: ACCESS_PERMISSION_KEYS,
      users: users.map((user) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        venue: user.venue,
        roleTitle: user.roleTitle,
        employmentStatus: user.employmentStatus,
        accountType: user.accountType,
        isAdmin: user.isAdmin,
        hasPassword: Boolean(user.passwordHash),
        hasPin: Boolean(user.pinHash),
        pinUpdatedAt: user.pinUpdatedAt?.toISOString() ?? null,
        appAccess: user.appAccess.map((access) => ({
          ...access,
          createdAt: access.createdAt.toISOString(),
          updatedAt: access.updatedAt.toISOString(),
          permissions: permissionRecord(access.permissions)
        }))
      }))
    };
  },

  async createAccessUser(input: unknown, actor?: AuthUser | null) {
    const data = adminAccessUserCreateInputSchema.parse(input);
    const email = data.email?.trim().toLowerCase() || null;
    if (email) {
      const existing = await prisma.staffProfile.findUnique({ where: { email } });
      if (existing) throw new HttpError(409, 'A staff profile already exists for that email.');
    }

    const staffPermissions =
      data.staffRole === 'ADMIN'
        ? { view: true, create: true, edit: true, approve: true, export: true, admin: true }
        : data.staffRole === 'MANAGER'
          ? { view: true, create: true, edit: true, approve: true, export: true }
          : { view: true };

    const profile = await prisma.staffProfile.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email,
        venue: data.venue || null,
        roleTitle: data.roleTitle || (data.staffRole === 'MANAGER' ? 'Manager' : 'Team member'),
        employmentStatus: 'ACTIVE',
        appAccess: data.enableStaffApp
          ? {
              create: {
                appId: 'STAFF',
                status: 'ENABLED',
                role: data.staffRole,
                permissions: staffPermissions
              }
            }
          : undefined
      },
      include: { appAccess: { orderBy: [{ appId: 'asc' }] } }
    });

    await prisma.staffManagementEvent.create({
      data: {
        staffProfileId: profile.id,
        eventType: 'ADMIN_ACCESS_USER_CREATED',
        summary: 'Staff user created from Admin access settings.',
        createdById: actor?.id ?? null,
        createdByName: actor ? `${actor.firstName} ${actor.lastName}`.trim() || actor.email : null,
        createdByEmail: actor?.email ?? null,
        metadata: {
          email,
          venue: data.venue || null,
          staffRole: data.staffRole,
          enableStaffApp: data.enableStaffApp
        }
      }
    });

    return profile;
  },

  async bulkUpdateAccess(input: unknown, actor?: AuthUser | null): Promise<AdminAccessBulkUpdateResult> {
    const data = adminAccessBulkUpdateInputSchema.parse(input);
    const users = await prisma.staffProfile.findMany({
      where: {
        id: { in: data.staffProfileIds },
        accountType: 'HUMAN',
        mergedIntoStaffProfileId: null,
        NOT: { employmentStatus: 'ARCHIVED' }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        appAccess: {
          where: { appId: { in: data.appIds } },
          select: { appId: true, permissions: true }
        }
      }
    });

    const existingByUser = new Map(users.map((user) => [user.id, new Map(user.appAccess.map((row) => [row.appId, row]))]));
    let updatedRows = 0;

    await prisma.$transaction(async (tx) => {
      for (const user of users) {
        const existing = existingByUser.get(user.id) ?? new Map();
        for (const appId of data.appIds) {
          const currentPermissions = permissionRecord(existing.get(appId)?.permissions);
          const permissions =
            data.permissionMode === 'REPLACE'
              ? data.permissions
              : { ...currentPermissions, ...data.permissions };
          await tx.staffAppAccess.upsert({
            where: { staffProfileId_appId: { staffProfileId: user.id, appId } },
            update: {
              status: data.status,
              role: data.role,
              permissions,
              notes: data.notes || null
            },
            create: {
              staffProfileId: user.id,
              appId,
              status: data.status,
              role: data.role,
              permissions,
              notes: data.notes || null
            }
          });
          updatedRows += 1;
        }

        await tx.staffManagementEvent.create({
          data: {
            staffProfileId: user.id,
            eventType: 'ADMIN_BULK_APP_ACCESS_UPDATED',
            summary: 'App access updated in bulk from Admin.',
            createdById: actor?.id ?? null,
            createdByName: actor ? `${actor.firstName} ${actor.lastName}`.trim() || actor.email : null,
            createdByEmail: actor?.email ?? null,
            metadata: {
              appIds: data.appIds,
              status: data.status,
              role: data.role,
              permissionMode: data.permissionMode,
              permissionKeys: Object.keys(data.permissions)
            }
          }
        });
      }
    });

    return { updatedUsers: users.length, updatedRows };
  },

  async overview(): Promise<AdminOverviewPayload> {
    const settingsPromise = settingsService.get();
    const activeStaffPromise = prisma.staffProfile.findMany({
      where: activeStaffWhere,
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isAdmin: true,
        venue: true,
        appAccess: {
          select: {
            appId: true,
            status: true,
            role: true,
            permissions: true
          }
        }
      }
    });
    const monday = startOfMonday();
    const mondayEnd = endOfDay(monday);
    const [
      settings,
      activeStaff,
      mondayRosterShiftCount,
      openClockSessions,
      pendingComplianceRecords,
      expiredComplianceRecords,
      auditEvents
    ] = await Promise.all([
      settingsPromise,
      activeStaffPromise,
      prisma.rosterShift.count({ where: { startsAt: { gte: monday, lt: mondayEnd } } }),
      prisma.staffClockSession.count({ where: { status: 'OPEN' } }),
      prisma.staffComplianceRecord.count({
        where: { status: 'PENDING', staffProfile: activeStaffWhere }
      }),
      prisma.staffComplianceRecord.count({
        where: { status: 'EXPIRED', staffProfile: activeStaffWhere }
      }),
      recentAuditEvents(5)
    ]);

    const staffMissingLoginEmail = activeStaff.filter((member) => !member.email?.trim()).length;
    const staffWithoutPassword = activeStaff.filter((member) => !member.passwordHash).length;
    const staffMissingStaffAccess = activeStaff.filter(
      (member) => !member.appAccess.some((access) => access.appId === 'STAFF' && access.status === 'ENABLED')
    ).length;
    const adminUsers = activeStaff.filter((member) => member.isAdmin).length;
    const staffManagersOrAdmins = activeStaff.filter((member) =>
      member.appAccess.some(
        (access) =>
          access.status === 'ENABLED' &&
          access.appId === 'STAFF' &&
          ['ADMIN', 'MANAGER'].includes(access.role.toUpperCase())
      )
    ).length;

    const venueStaffCounts = activeStaff.reduce<Record<string, number>>((acc, member) => {
      const venue = member.venue?.trim() || 'Unassigned';
      acc[venue] = (acc[venue] ?? 0) + 1;
      return acc;
    }, {});

    const configuredVenues = settings.venues.length
      ? settings.venues
      : Object.keys(venueStaffCounts).map((name) => ({ name, address: '', phone: '' }));

    const appAccess = APP_IDS.map((appId) => {
      const rows = activeStaff.flatMap((member) => member.appAccess.filter((access) => access.appId === appId));
      return {
        appId,
        label: APP_LABELS[appId],
        enabled: rows.filter((access) => access.status === 'ENABLED').length,
        pending: rows.filter((access) => access.status === 'PENDING').length,
        disabled: rows.filter((access) => access.status === 'DISABLED').length,
        managerOrAdmin: rows.filter(
          (access) =>
            access.status === 'ENABLED' &&
            (['ADMIN', 'MANAGER'].includes(access.role.toUpperCase()) || hasAdminPermission(access.permissions))
        ).length
      };
    });

    const warningCandidates: Array<AdminReadinessWarning | null> = [
      staffMissingLoginEmail > 0
        ? {
            label: 'Staff missing login email',
            detail: `${staffMissingLoginEmail} active staff profile${staffMissingLoginEmail === 1 ? '' : 's'} need an email before login can work cleanly.`,
            tone: 'warning' as const,
            href: '/staff'
          }
        : null,
      staffMissingStaffAccess > 0
        ? {
            label: 'Staff app access missing',
            detail: `${staffMissingStaffAccess} active staff profile${staffMissingStaffAccess === 1 ? '' : 's'} do not have Staff app access enabled.`,
            tone: 'warning' as const,
            href: '/staff'
          }
        : null,
      staffWithoutPassword > 0
        ? {
            label: 'Password setup incomplete',
            detail: `${staffWithoutPassword} active staff profile${staffWithoutPassword === 1 ? '' : 's'} still need password setup or invite completion.`,
            tone: 'warning' as const,
            href: '/staff'
          }
        : null,
      !mailService.isConfigured()
        ? {
            label: 'Email is not configured',
            detail: 'Password reset and invite email delivery will need Resend or SMTP before production use.',
            tone: 'danger' as const,
            href: '#system-health'
          }
        : null,
      pendingComplianceRecords + expiredComplianceRecords > 0
        ? {
            label: 'Compliance records need attention',
            detail: `${pendingComplianceRecords} pending and ${expiredComplianceRecords} expired staff records are visible across active staff.`,
            tone: 'warning' as const,
            href: '/staff'
          }
        : null,
      openClockSessions > 0
        ? {
            label: 'Open clock sessions',
            detail: `${openClockSessions} clock session${openClockSessions === 1 ? ' is' : 's are'} still open.`,
            tone: 'info' as const
          }
        : null,
      mondayRosterShiftCount === 0
        ? {
            label: 'Monday roster not loaded',
            detail: 'No shifts are rostered for the next Monday window checked by Admin.',
            tone: 'muted' as const
          }
        : null
    ];
    const warnings = warningCandidates.filter((warning): warning is AdminReadinessWarning => warning !== null);

    return {
      generatedAt: new Date().toISOString(),
      readiness: {
        status: warnings.some((warning) => warning.tone === 'danger' || warning.tone === 'warning')
          ? 'needs_attention'
          : 'ready',
        label: warnings.length ? 'Needs attention before broad rollout' : 'Ready for normal manager use',
        warnings
      },
      counts: {
        activeStaff: activeStaff.length,
        staffMissingLoginEmail,
        staffMissingStaffAccess,
        staffWithoutPassword,
        mondayRosterLoaded: mondayRosterShiftCount > 0,
        mondayRosterShiftCount,
        openClockSessions,
        pendingComplianceRecords,
        expiredComplianceRecords,
        adminUsers,
        staffManagersOrAdmins
      },
      business: {
        orgName: settings.orgName,
        primaryContactName: settings.primaryContactName,
        primaryContactEmail: settings.primaryContactEmail,
        primaryContactPhone: settings.primaryContactPhone,
        venues: configuredVenues.map((venue) => ({
          name: venue.name,
          address: venue.address || null,
          phone: venue.phone || null,
          activeStaffCount: venueStaffCounts[venue.name] ?? 0
        }))
      },
      staffDefaults: settings.staffDefaults,
      appAccess,
      handoffLinks: [
        {
          label: 'Staff settings',
          description: 'Current editor for onboarding, staff defaults and access while controls migrate into Admin.',
          appId: 'staff',
          href: '/settings'
        },
        {
          label: 'Staff profiles',
          description: 'Individual notes, role access, password reset, pay setup and merge workflows stay in Staff.',
          appId: 'staff',
          href: '/'
        },
        {
          label: 'Stock setup',
          description: 'Stock items, supplier context and stocktake work stay in Stock for now.',
          appId: 'stock',
          href: '/'
        },
        {
          label: 'Reports',
          description: 'Trading, labour and reporting checks stay in Reports.',
          appId: 'reports',
          href: '/'
        }
      ],
      recentAuditEvents: auditEvents
    };
  },

  async integrationsStatus(): Promise<AdminIntegrationsStatusPayload> {
    const settings = await settingsService.get();
    const mailProvider = provider();
    const integrations = await integrationService.status();

    // Real Govee health — read the canonical integration row so the admin
    // dashboard can show the actual last sync time, last error, and how many
    // sensors we've discovered. Defaults are safe if the table is empty.
    const goveeIntegration = await prisma.temperatureIntegration.findUnique({
      where: { provider: 'govee' },
      include: { _count: { select: { sensors: true } } }
    });

    return {
      ...integrations,
      email: {
        status: mailService.isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
        provider: mailProvider
      },
      govee: {
        status: settings.goveeApiKey ? 'CONFIGURED' : 'NOT_CONFIGURED',
        baseUrl: settings.goveeBaseUrl,
        lastSyncedAt: goveeIntegration?.lastSyncedAt?.toISOString() ?? null,
        lastError: goveeIntegration?.lastError ?? null,
        sensorCount: goveeIntegration?._count.sensors ?? 0
      }
    };
  },

  // Monday weekly summary email — prime cost, top sellers, overdues,
  // upcoming expiries. Runnable manually for testing; Cloud Scheduler can
  // hit this endpoint every Monday morning.
  async sendWeeklySummary({ previewOnly = false }: { previewOnly?: boolean } = {}) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);

    const [overdueIssues, expiringRecords, openLicences] = await Promise.all([
      prisma.issue.count({
        where: {
          status: { notIn: ['RESOLVED', 'CLOSED'] },
          dueDate: { lt: now }
        }
      }),
      prisma.staffComplianceRecord.count({
        where: {
          expiryDate: { gte: now, lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
          staffProfile: { accountType: 'HUMAN' }
        }
      }),
      prisma.liquorLicence.findMany({
        where: { expiryDate: { gte: now, lte: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000) } },
        orderBy: { expiryDate: 'asc' },
        take: 5
      })
    ]);

    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    const recipient = settings?.notifyEmail?.trim();

    const weekLabel = `${start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${new Date(end.getTime() - 1).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    const lines = [
      `Week ending ${weekLabel}`,
      '',
      `• Overdue compliance issues: ${overdueIssues}`,
      `• Staff records expiring within 30 days: ${expiringRecords}`,
      `• Liquor licences expiring within 90 days: ${openLicences.length}`,
      openLicences.length > 0
        ? `\n  Next licence expiries:\n${openLicences.map((l) => `    - ${l.venue}: ${l.licenceType} ${l.licenceNumber} on ${l.expiryDate ? new Date(l.expiryDate).toLocaleDateString('en-AU') : '—'}`).join('\n')}`
        : '',
      '',
      'Open https://alma-compliance.web.app/ to review the full reports.'
    ].filter(Boolean).join('\n');

    if (previewOnly) {
      return { previewOnly: true, recipient, weekLabel, body: lines, overdueIssues, expiringRecords, openLicences: openLicences.length };
    }

    if (!recipient || !mailService.isConfigured()) {
      return { sent: false, reason: !recipient ? 'no recipient configured' : 'mail provider not configured', weekLabel };
    }

    const sendResult = await mailService.sendAlert({
      to: recipient,
      subject: `[Alma weekly summary] Week of ${weekLabel}`,
      title: 'Alma weekly summary',
      body: lines,
      severity: 'info',
      ctaUrl: 'https://alma-reports.web.app/',
      ctaLabel: 'Open reports'
    });

    // Don't claim success if the provider skipped or failed — surface the reason
    // so the admin knows the email didn't actually go out.
    if (sendResult.status !== 'sent') {
      return {
        sent: false,
        reason: sendResult.status === 'failed' ? sendResult.reason : sendResult.reason || 'mail provider did not send',
        weekLabel
      };
    }

    return { sent: true, recipient, weekLabel, overdueIssues, expiringRecords, openLicences: openLicences.length };
  },

  async systemHealth(): Promise<AdminSystemHealthPayload> {
    const mailProvider = provider();
    let database: AdminSystemHealthPayload['database'] = {
      status: 'ok',
      detail: 'Database query succeeded.'
    };
    let migrations: AdminSystemHealthPayload['migrations'] = {
      status: 'not_checked',
      latest: null,
      detail: 'Migration version was not checked.'
    };

    try {
      await prisma.staffProfile.findFirst({ select: { id: true } });
    } catch (error) {
      database = {
        status: 'error',
        detail: error instanceof Error ? error.message : 'Database query failed.'
      };
    }

    try {
      const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
        SELECT migration_name, finished_at
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT 1
      `;
      migrations = {
        status: rows[0]?.migration_name ? 'available' : 'not_checked',
        latest: rows[0]?.migration_name ?? null,
        detail: rows[0]?.migration_name ? 'Latest applied Prisma migration.' : 'No applied Prisma migration was found.'
      };
    } catch {
      migrations = {
        status: 'not_checked',
        latest: null,
        detail: 'Migration table was not available in this environment.'
      };
    }

    return {
      generatedAt: new Date().toISOString(),
      api: { status: 'ok' },
      database,
      email: {
        configured: mailService.isConfigured(),
        provider: mailProvider
      },
      migrations,
      appUrls: appUrlRows()
    };
  },

  async auditEvents(eventType?: string): Promise<AdminAuditEventsPayload> {
    const [events, eventTypes] = await Promise.all([
      recentAuditEvents(25, eventType),
      prisma.staffManagementEvent.findMany({
        select: { eventType: true },
        distinct: ['eventType'],
        orderBy: { eventType: 'asc' }
      })
    ]);

    return {
      eventTypes: eventTypes.map((event) => event.eventType),
      events
    };
  }
};
