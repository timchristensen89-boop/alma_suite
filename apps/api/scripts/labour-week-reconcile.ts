// Labour vs takings reconciliation — the audit behind GET /api/staff/labour-week.
//
// Prints, for one week, the raw daily takings rows per venue before any
// aggregation, the per-shift reconciliation table (person, venue, date,
// department, start, end, span, break, paid, rate, cost, basis, shift id)
// and the venue / group totals, all from the same engine the page uses
// (lib/labour-week.ts). Read-only.
//
//   # against the database (inside the suite-api container):
//   node --import tsx scripts/labour-week-reconcile.ts --week 2026-10-05
//
//   # against rows exported from production as JSON (see --export-sql):
//   node --import tsx scripts/labour-week-reconcile.ts --week 2026-10-05 --rows rows.json
//
//   # print the read-only SQL that produces rows.json:
//   node --import tsx scripts/labour-week-reconcile.ts --export-sql
//
// Pay rates are printed. Run it where that is appropriate.

import { readFileSync } from 'node:fs';
import { buildLabourWeek, type LabourWeekSaleInput, type LabourWeekShiftInput, type UnrosteredSalariedInput } from '../src/lib/labour-week.js';

type Rows = {
  weekStart: string;
  configuredVenues: string[];
  superGuaranteePercent: number | null;
  venueTargets: Array<{ name: string; targetWagePercent?: number | null; targetPrimeCostPercent?: number | null }>;
  shifts: Array<Omit<LabourWeekShiftInput, 'startsAt' | 'endsAt'> & { startsAt: string; endsAt: string }>;
  sales: Array<Omit<LabourWeekSaleInput, 'serviceDate'> & { serviceDate: string }>;
  activeSalariedStaff?: UnrosteredSalariedInput[];
};

const EXPORT_SQL = `
-- Read-only export for labour-week-reconcile.ts. Replace :week with the Monday (YYYY-MM-DD).
-- Window = Sydney Monday 00:00 to the following Monday 00:00; serviceDate is UTC midnight of the Sydney date.
WITH w AS (
  SELECT ':week'::date AS week_start
), bounds AS (
  SELECT (week_start::timestamp AT TIME ZONE 'Australia/Sydney') AS starts_at,
         ((week_start + 7)::timestamp AT TIME ZONE 'Australia/Sydney') AS ends_at,
         week_start::timestamp AS sales_from, (week_start + 6)::timestamp AS sales_to
  FROM w
)
SELECT json_build_object(
  'weekStart', (SELECT week_start FROM w),
  'configuredVenues', (SELECT coalesce(json_agg(v->>'name'), '[]'::json) FROM "AppSettings" s, json_array_elements(s.venues::json) v WHERE s.id = 'singleton'),
  'superGuaranteePercent', (SELECT "superGuaranteePercent" FROM "AppSettings" WHERE id = 'singleton'),
  'venueTargets', (SELECT coalesce(json_agg(json_build_object('name', v->>'name', 'targetWagePercent', (v->>'targetWagePercent')::float)), '[]'::json) FROM "AppSettings" s, json_array_elements(s.venues::json) v WHERE s.id = 'singleton'),
  'shifts', (
    SELECT coalesce(json_agg(json_build_object(
      'id', r.id, 'staffProfileId', r."staffProfileId", 'venue', r.venue, 'area', r.area, 'roleTitle', r."roleTitle",
      'startsAt', to_char(r."startsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'endsAt', to_char(r."endsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'breakMinutes', r."breakMinutes", 'status', r.status,
      'staffProfile', CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
        'id', p.id, 'firstName', p."firstName", 'lastName', p."lastName", 'venue', p.venue, 'roleTitle', p."roleTitle",
        'contractedWeeklyHours', p."contractedWeeklyHours", 'employmentType', p."employmentType",
        'payRateCents', p."payRateCents", 'trainingPayRateCents', p."trainingPayRateCents",
        'payProfile', CASE WHEN pp.id IS NULL THEN NULL ELSE json_build_object(
          'employmentType', pp."employmentType", 'payMode', pp."payMode", 'ordinaryHourlyRateCents', pp."ordinaryHourlyRateCents",
          'casualLoadedHourlyRateCents', pp."casualLoadedHourlyRateCents", 'manualFullTimePayAmountCents', pp."manualFullTimePayAmountCents",
          'manualFullTimePayFrequency', pp."manualFullTimePayFrequency", 'cashHourlyRateCents', pp."cashHourlyRateCents") END
      ) END
    ) ORDER BY r."startsAt"), '[]'::json)
    FROM "RosterShift" r
    LEFT JOIN "StaffProfile" p ON p.id = r."staffProfileId"
    LEFT JOIN "StaffPayProfile" pp ON pp."staffProfileId" = p.id, bounds b
    WHERE r."startsAt" >= b.starts_at AND r."startsAt" < b.ends_at AND r.status IN ('PUBLISHED','COMPLETED')
  ),
  'sales', (
    SELECT coalesce(json_agg(json_build_object('id', e.id, 'venue', e.venue, 'serviceDate', to_char(e."serviceDate", 'YYYY-MM-DD'), 'salesCents', e."salesCents", 'source', e.source, 'notes', e.notes) ORDER BY e.venue, e."serviceDate", e.source), '[]'::json)
    FROM "SalesActualEntry" e, bounds b WHERE e."serviceDate" >= b.sales_from AND e."serviceDate" <= b.sales_to
  ),
  'activeSalariedStaff', (
    SELECT coalesce(json_agg(json_build_object('id', p.id, 'firstName', p."firstName", 'lastName', p."lastName", 'venue', p.venue,
      'employmentType', p."employmentType", 'payRateCents', p."payRateCents", 'trainingPayRateCents', p."trainingPayRateCents",
      'payProfile', CASE WHEN pp.id IS NULL THEN NULL ELSE json_build_object(
          'employmentType', pp."employmentType", 'payMode', pp."payMode", 'ordinaryHourlyRateCents', pp."ordinaryHourlyRateCents",
          'casualLoadedHourlyRateCents', pp."casualLoadedHourlyRateCents", 'manualFullTimePayAmountCents', pp."manualFullTimePayAmountCents",
          'manualFullTimePayFrequency', pp."manualFullTimePayFrequency", 'cashHourlyRateCents', pp."cashHourlyRateCents") END)), '[]'::json)
    FROM "StaffProfile" p LEFT JOIN "StaffPayProfile" pp ON pp."staffProfileId" = p.id
    WHERE p."accountType" = 'HUMAN' AND p."mergedIntoStaffProfileId" IS NULL AND p."employmentStatus" = 'ACTIVE'
  )
)::text;
`;

const money = (cents: number | null | undefined) => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`);
const h = (value: number) => value.toFixed(2);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return { week: get('--week'), rows: get('--rows'), exportSql: args.includes('--export-sql') };
}

async function loadRows(week: string, rowsPath: string | undefined): Promise<Rows> {
  if (rowsPath) return JSON.parse(readFileSync(rowsPath, 'utf8')) as Rows;
  const { prisma, prismaCogsReader } = await import('@alma/db');
  const { staffPayRateSelect } = await import('../src/lib/staff-pay-rates.js');
  const { venueDayStart, nextDayKey } = await import('@alma/shared');
  const { weekDayKeys } = await import('../src/lib/labour-week.js');
  const dayKeys = weekDayKeys(week);
  const windowStart = venueDayStart(week)!;
  const windowEnd = venueDayStart(nextDayKey(dayKeys[6]!)!)!;
  const [shifts, sales, settings, configuredVenues, activeSalariedStaff] = await Promise.all([
    prisma.rosterShift.findMany({
      where: { startsAt: { gte: windowStart, lt: windowEnd }, status: { in: ['PUBLISHED', 'COMPLETED'] } },
      select: {
        id: true, staffProfileId: true, venue: true, area: true, roleTitle: true, startsAt: true, endsAt: true, breakMinutes: true, status: true,
        staffProfile: { select: { id: true, firstName: true, lastName: true, venue: true, roleTitle: true, contractedWeeklyHours: true, ...staffPayRateSelect } }
      }
    }),
    prisma.salesActualEntry.findMany({
      where: { serviceDate: { gte: new Date(`${week}T00:00:00Z`), lte: new Date(`${dayKeys[6]}T00:00:00Z`) } },
      select: { id: true, venue: true, serviceDate: true, salesCents: true, source: true, notes: true }
    }),
    prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { venues: true, superGuaranteePercent: true } }),
    prismaCogsReader.configuredVenues(),
    prisma.staffProfile.findMany({
      where: { accountType: 'HUMAN', mergedIntoStaffProfileId: null, employmentStatus: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, venue: true, ...staffPayRateSelect }
    })
  ]);
  const venueTargets = Array.isArray(settings?.venues) ? (settings!.venues as Rows['venueTargets']) : [];
  await prisma.$disconnect();
  return {
    weekStart: week,
    configuredVenues,
    superGuaranteePercent: settings?.superGuaranteePercent ?? null,
    venueTargets,
    shifts: shifts.map((s) => ({ ...s, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
    sales: sales.map((s) => ({ ...s, serviceDate: s.serviceDate.toISOString() })),
    activeSalariedStaff
  };
}

async function main() {
  const { week, rows: rowsPath, exportSql } = parseArgs();
  if (exportSql) {
    process.stdout.write(EXPORT_SQL);
    return;
  }
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    console.error('Usage: labour-week-reconcile.ts --week YYYY-MM-DD [--rows rows.json] | --export-sql');
    process.exit(2);
  }
  const rows = await loadRows(week, rowsPath);
  const superRate = Math.min(30, Math.max(0, rows.superGuaranteePercent ?? 12)) / 100;
  const payload = buildLabourWeek({
    weekStart: rows.weekStart || week,
    shifts: rows.shifts.map((s) => ({ ...s, startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) })),
    sales: rows.sales.map((s) => ({ ...s, serviceDate: new Date(s.serviceDate.length === 10 ? `${s.serviceDate}T00:00:00Z` : s.serviceDate) })),
    configuredVenues: rows.configuredVenues,
    superRate,
    venueTargets: rows.venueTargets ?? [],
    activeSalariedStaff: rows.activeSalariedStaff ?? [],
    includeRates: true
  });

  console.log(`\n=== LABOUR VS TAKINGS — week of ${payload.weekStart} to ${payload.weekEnd} (${payload.timeZone}) ===`);
  console.log(`configured venues: ${rows.configuredVenues.join(' | ')} · super ${payload.methodology.superRatePct}% · shifts ${rows.shifts.length} · sales rows ${rows.sales.length}`);

  console.log('\n--- RAW TAKINGS ROWS (before aggregation) ---');
  console.log('date       | venue (resolved)  | label on row          | source               | ex-GST     | used');
  for (const row of payload.reconciliation.sales) {
    console.log(`${row.date} | ${row.venue.padEnd(17)} | ${row.venueLabel.padEnd(21)} | ${row.source.padEnd(20)} | ${money(row.salesCents).padStart(10)} | ${row.used ? 'yes' : 'no'}`);
  }

  console.log('\n--- DAILY TAKINGS USED, BY VENUE ---');
  for (const venue of payload.venues) {
    console.log(`${venue.venue}: ${venue.days.map((d) => `${d.date.slice(5)} ${d.salesCents == null ? '—' : money(d.salesCents)}`).join(' · ')}  => week ${money(venue.salesCents)} (${venue.salesDays}/7 days)`);
  }
  console.log(`GROUP: ${money(payload.group.salesCents)}`);

  console.log('\n--- SHIFT RECONCILIATION ---');
  console.log('date       | person               | venue (from)              | dept         | start-end   | span  | break | paid  | rate/h  | cost      | basis | shift id');
  for (const row of payload.reconciliation.shifts) {
    const st = new Date(row.startsAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' });
    const en = new Date(row.endsAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' });
    console.log(
      `${row.date} | ${row.name.padEnd(20).slice(0, 20)} | ${`${row.venue} (${row.venueSource})`.padEnd(25).slice(0, 25)} | ${row.department.padEnd(12)} | ${st}-${en} | ${h(row.spanHours).padStart(5)} | ${h(row.unpaidBreakHours).padStart(5)} | ${h(row.paidHours).padStart(5)} | ${(row.rateCents == null ? 'none' : (row.rateCents / 100).toFixed(2)).padStart(7)} | ${money(row.costCents).padStart(9)} | ${row.departmentBasis} · ${row.costBasis} | ${row.shiftId}`
    );
  }

  console.log('\n--- PER PERSON ---');
  for (const p of payload.people) {
    console.log(`${p.name.padEnd(22)} ${p.employmentType.padEnd(10)} ${p.salaried ? 'salary ' : 'hourly '} span ${h(p.spanHours).padStart(6)} paid ${h(p.paidHours).padStart(6)}  ${p.venues.map((v) => `${v.venue} ${h(v.paidHours)}h`).join(', ')}  cost ${money(p.estWeekCostCents)}  (${p.rateSource})`);
  }

  console.log('\n--- VENUE / GROUP TOTALS ---');
  const line = (name: string, f: typeof payload.group, sales: number) => {
    const k = f.byDepartment.KITCHEN;
    const o = f.byDepartment.FOH;
    const m = f.byDepartment.MANAGEMENT;
    const u = f.byDepartment.UNCLASSIFIED;
    console.log(`${name}`);
    console.log(`  sales ${money(sales)} · span ${h(f.spanHours)}h · paid ${h(f.paidHours)}h · open ${h(f.openHours)}h · uncosted ${h(f.uncostedHours)}h`);
    console.log(`  kitchen: span ${h(k.spanHours)}h paid ${h(k.paidHours)}h cost ${money(k.costCents)} = ${k.labourPct ?? '—'}%`);
    console.log(`  FOH:     span ${h(o.spanHours)}h paid ${h(o.paidHours)}h cost ${money(o.costCents)} = ${o.labourPct ?? '—'}%`);
    console.log(`  mgmt:    paid ${h(m.paidHours)}h cost ${money(m.costCents)} = ${m.labourPct ?? '—'}%   unclassified: paid ${h(u.paidHours)}h cost ${money(u.costCents)}`);
    console.log(`  TOTAL labour ${money(f.costCents)} = ${f.labourPct ?? '—'}% of sales`);
  };
  for (const venue of payload.venues) line(`${venue.venue} [${venue.venueStatus}]`, venue, venue.salesCents);
  line('GROUP', payload.group, payload.group.salesCents);
  const sumVenues = payload.venues.reduce((s, v) => s + v.costCents, 0);
  console.log(`\nreconciliation: Σ venue labour ${money(sumVenues)} vs group ${money(payload.group.costCents)} → ${sumVenues === payload.group.costCents ? 'OK' : 'MISMATCH'}`);
  console.log(`incomplete: ${JSON.stringify(payload.incomplete)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
