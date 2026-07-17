// Phase 4.5 — Scheduled CSV exports.
// This pass ships the underlying CSV generation behind admin-protected
// endpoints. The owner can pull standardised reports as CSV from Admin.
// A follow-up pass will add Google Drive OAuth + a Cloud Scheduler job
// that drops the same CSVs into a Drive folder once a week.

import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { staffCostingRate, staffPayRateSelect } from '../lib/staff-pay-rates.js';
import { configuredSuperRateFraction } from './settings.service.js';

type ExportKind = 'sales-by-day' | 'wages-by-week' | 'timesheets' | 'stocktake-variance' | 'low-stock';

const EXPORT_KINDS: ExportKind[] = ['sales-by-day', 'wages-by-week', 'timesheets', 'stocktake-variance', 'low-stock'];

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
}

function assertAdmin(actor: AuthUser): void {
  if (!(actor.isAdmin || actor.role === 'ADMIN')) {
    throw new HttpError(403, 'CSV exports are Admin-only. Ask an Alma admin to download these.');
  }
}

function parseDateRange(query: { start?: string; end?: string }): { start: Date; end: Date } {
  const end = query.end ? new Date(query.end) : new Date();
  if (Number.isNaN(end.getTime())) throw new HttpError(400, 'Invalid end date.');
  const startFallback = new Date(end);
  startFallback.setDate(startFallback.getDate() - 30);
  const start = query.start ? new Date(query.start) : startFallback;
  if (Number.isNaN(start.getTime())) throw new HttpError(400, 'Invalid start date.');
  if (start > end) throw new HttpError(400, 'Start date must be before end date.');
  return { start, end };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

export const exportsService = {
  EXPORT_KINDS,

  // List of known exports with a short description per item. Used by the
  // Admin "Exports" page to render download buttons.
  async listAvailable() {
    return [
      { kind: 'sales-by-day', label: 'Sales by day', description: 'One row per venue per day with sales total and cover counts.' },
      { kind: 'wages-by-week', label: 'Wages by week', description: 'One row per venue per ISO week with rostered hours, actual hours, and wage spend.' },
      { kind: 'timesheets', label: 'Timesheets', description: 'One row per approved timesheet — date, staff, venue, hours, wage value, payment method.' },
      { kind: 'stocktake-variance', label: 'Stocktake variance', description: 'Recent stocktake variance entries: expected vs counted, value impact.' },
      { kind: 'low-stock', label: 'Low stock snapshot', description: 'Items currently below par level — one row per item with on-hand vs par.' }
    ];
  },

  async generate(kind: ExportKind, query: { start?: string; end?: string; venue?: string }, actor: AuthUser): Promise<{ filename: string; csv: string }> {
    assertAdmin(actor);
    if (!EXPORT_KINDS.includes(kind)) {
      throw new HttpError(404, 'Unknown export.');
    }

    const range = (kind === 'low-stock') ? null : parseDateRange(query);
    const venueFilter = query.venue?.trim() || null;

    switch (kind) {
      case 'sales-by-day':
        return generateSalesByDay(range!, venueFilter);
      case 'wages-by-week':
        return generateWagesByWeek(range!, venueFilter);
      case 'timesheets':
        return generateTimesheets(range!, venueFilter);
      case 'stocktake-variance':
        return generateStocktakeVariance(range!);
      case 'low-stock':
        return generateLowStock();
    }
  }
};

async function generateSalesByDay(range: { start: Date; end: Date }, venueFilter: string | null) {
  const rows = await prisma.salesActualEntry.findMany({
    where: {
      serviceDate: { gte: range.start, lte: range.end },
      ...(venueFilter ? { venue: venueFilter } : {})
    },
    orderBy: [{ serviceDate: 'asc' }, { venue: 'asc' }]
  });

  // Bucket by date+venue in case multiple sources reported on the same day.
  const bucket = new Map<string, { date: string; venue: string; salesCents: number; sources: Set<string> }>();
  for (const row of rows) {
    const date = dateOnly(row.serviceDate);
    const key = `${date}|${row.venue}`;
    const current = bucket.get(key) ?? { date, venue: row.venue, salesCents: 0, sources: new Set<string>() };
    current.salesCents += row.salesCents;
    current.sources.add(row.source);
    bucket.set(key, current);
  }
  const headers = ['date', 'venue', 'salesAud', 'sources'];
  const csvRows = Array.from(bucket.values())
    .sort((a, b) => (a.date === b.date ? a.venue.localeCompare(b.venue) : a.date.localeCompare(b.date)))
    .map((entry) => ({
      date: entry.date,
      venue: entry.venue,
      salesAud: formatCents(entry.salesCents),
      sources: Array.from(entry.sources).join(';')
    }));
  return {
    filename: `alma-sales-by-day-${dateOnly(range.start)}-to-${dateOnly(range.end)}.csv`,
    csv: toCsv(headers, csvRows)
  };
}

async function generateWagesByWeek(range: { start: Date; end: Date }, venueFilter: string | null) {
  const timesheets = await prisma.timesheet.findMany({
    where: {
      status: 'APPROVED',
      workDate: { gte: range.start, lte: range.end },
      ...(venueFilter ? { venue: venueFilter } : {})
    },
    include: {
      staffProfile: { select: { firstName: true, lastName: true, ...staffPayRateSelect } }
    },
    orderBy: [{ workDate: 'asc' }]
  });

  // Cost hours at the canonical rate (award/payProfile, casual default, salaried
  // ÷45h equivalent, all incl. super) so the export reconciles with the reports
  // instead of using a naked payRateCents that dropped super and award rates.
  const superRate = await configuredSuperRateFraction();

  // Bucket by ISO week + venue.
  function isoWeek(date: Date): string {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
    target.setUTCDate(target.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  type Bucket = { week: string; venue: string; hours: number; wageCents: number; shifts: number };
  const buckets = new Map<string, Bucket>();
  for (const ts of timesheets) {
    const venue = ts.venue ?? 'Unassigned';
    const week = isoWeek(ts.workDate);
    const key = `${week}|${venue}`;
    const hours = ts.clockInAt && ts.clockOutAt
      ? Math.max(0, ((ts.clockOutAt.getTime() - ts.clockInAt.getTime()) / 3_600_000) - (ts.breakMinutes ?? 0) / 60)
      : 0;
    const rate = ts.staffProfile ? staffCostingRate(ts.staffProfile, superRate).ordinaryRateCents ?? 0 : 0;
    const wageCents = Math.round(hours * rate);
    const bucket = buckets.get(key) ?? { week, venue, hours: 0, wageCents: 0, shifts: 0 };
    bucket.hours += hours;
    bucket.wageCents += wageCents;
    bucket.shifts += 1;
    buckets.set(key, bucket);
  }

  const headers = ['week', 'venue', 'hours', 'wages', 'shifts'];
  const rows = Array.from(buckets.values())
    .sort((a, b) => (a.week === b.week ? a.venue.localeCompare(b.venue) : a.week.localeCompare(b.week)))
    .map((bucket) => ({
      week: bucket.week,
      venue: bucket.venue,
      hours: bucket.hours.toFixed(2),
      wages: formatCents(bucket.wageCents),
      shifts: bucket.shifts
    }));
  return {
    filename: `alma-wages-by-week-${dateOnly(range.start)}-to-${dateOnly(range.end)}.csv`,
    csv: toCsv(headers, rows)
  };
}

async function generateTimesheets(range: { start: Date; end: Date }, venueFilter: string | null) {
  const timesheets = await prisma.timesheet.findMany({
    where: {
      workDate: { gte: range.start, lte: range.end },
      ...(venueFilter ? { venue: venueFilter } : {})
    },
    include: {
      staffProfile: { select: { firstName: true, lastName: true, email: true, ...staffPayRateSelect } }
    },
    orderBy: [{ workDate: 'asc' }, { venue: 'asc' }]
  });

  // Canonical hourly rate (incl. super + award + casual default) so each row's
  // wage reconciles with the reports rather than using a naked payRateCents.
  const superRate = await configuredSuperRateFraction();

  const headers = ['date', 'staffName', 'email', 'venue', 'role', 'hours', 'breakMinutes', 'wages', 'status', 'paymentMethod'];
  const rows = timesheets.map((ts) => {
    const hours = ts.clockInAt && ts.clockOutAt
      ? Math.max(0, ((ts.clockOutAt.getTime() - ts.clockInAt.getTime()) / 3_600_000) - (ts.breakMinutes ?? 0) / 60)
      : 0;
    const rate = ts.staffProfile ? staffCostingRate(ts.staffProfile, superRate).ordinaryRateCents ?? 0 : 0;
    return {
      date: dateOnly(ts.workDate),
      staffName: ts.staffProfile ? `${ts.staffProfile.firstName} ${ts.staffProfile.lastName}` : '',
      email: ts.staffProfile?.email ?? '',
      venue: ts.venue ?? '',
      role: ts.roleTitle ?? '',
      hours: hours.toFixed(2),
      breakMinutes: ts.breakMinutes ?? 0,
      wages: formatCents(Math.round(hours * rate)),
      status: ts.status,
      paymentMethod: ts.paymentMethod
    };
  });
  return {
    filename: `alma-timesheets-${dateOnly(range.start)}-to-${dateOnly(range.end)}.csv`,
    csv: toCsv(headers, rows)
  };
}

async function generateStocktakeVariance(range: { start: Date; end: Date }) {
  // The stocktake variance model may differ between forks. We probe for it
  // safely so the endpoint stays useful even when the schema is leaner.
  const stocktakeModel = (prisma as unknown as { stockCountEntry?: { findMany: typeof prisma.staffProfile.findMany } }).stockCountEntry;
  if (!stocktakeModel?.findMany) {
    return {
      filename: `alma-stocktake-variance-${dateOnly(range.start)}-to-${dateOnly(range.end)}.csv`,
      csv: toCsv(['note'], [{ note: 'Stocktake variance export is not yet wired in this fork.' }])
    };
  }
  const rows = await stocktakeModel.findMany({
    where: { createdAt: { gte: range.start, lte: range.end } },
    orderBy: [{ createdAt: 'desc' }],
    take: 5000
  } as never);
  const headers = ['date', 'venue', 'itemName', 'expected', 'counted', 'variance', 'unit', 'valueCents'];
  const csvRows = (rows as Array<Record<string, unknown>>).map((row) => ({
    date: row.createdAt instanceof Date ? dateOnly(row.createdAt) : '',
    venue: row.venue ?? '',
    itemName: row.itemName ?? row.name ?? '',
    expected: row.expected ?? '',
    counted: row.counted ?? '',
    variance: typeof row.expected === 'number' && typeof row.counted === 'number' ? (Number(row.counted) - Number(row.expected)).toFixed(2) : '',
    unit: row.unit ?? '',
    valueCents: formatCents(typeof row.valueCents === 'number' ? row.valueCents : null)
  }));
  return {
    filename: `alma-stocktake-variance-${dateOnly(range.start)}-to-${dateOnly(range.end)}.csv`,
    csv: toCsv(headers, csvRows)
  };
}

async function generateLowStock() {
  const stockItemModel = (prisma as unknown as { stockItem?: { findMany: typeof prisma.staffProfile.findMany } }).stockItem;
  if (!stockItemModel?.findMany) {
    return {
      filename: `alma-low-stock-${dateOnly(new Date())}.csv`,
      csv: toCsv(['note'], [{ note: 'Stock item export is not yet wired in this fork.' }])
    };
  }
  const rows = await stockItemModel.findMany({
    take: 5000,
    orderBy: [{ name: 'asc' }]
  } as never);
  const headers = ['name', 'unit', 'onHand', 'parLevel', 'reorderPoint', 'category', 'venue'];
  const lowOnly = (rows as Array<Record<string, unknown>>).filter((row) => {
    const par = typeof row.parLevel === 'number' ? row.parLevel : 0;
    const onHand = typeof row.onHand === 'number' ? row.onHand : 0;
    return onHand <= par;
  });
  const csvRows = lowOnly.map((row) => ({
    name: row.name ?? '',
    unit: row.unit ?? '',
    onHand: row.onHand ?? '',
    parLevel: row.parLevel ?? '',
    reorderPoint: row.reorderPoint ?? '',
    category: row.categoryName ?? row.category ?? '',
    venue: row.venue ?? ''
  }));
  return {
    filename: `alma-low-stock-${dateOnly(new Date())}.csv`,
    csv: toCsv(headers, csvRows)
  };
}
