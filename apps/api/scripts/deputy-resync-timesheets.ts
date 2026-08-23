/**
 * Re-import Deputy timesheets over a longer window than the scheduled sync's
 * 14 days, so history picks up what the sync used to drop: the break minutes
 * (Mealbreak was read as seconds but arrives as a datetime, so every break
 * imported as 0) and the leave flag (Deputy files approved leave as
 * timesheets; imported blind they looked like worked shifts).
 *
 * Safe to re-run: the sync upserts by Deputy timesheet id, and a row already
 * EXPORTED to Xero keeps that status — re-importing never re-arms a pushed
 * week. It DOES rewrite times/breaks/venue on Deputy-origin rows, which is
 * the point: Deputy is the source of truth for its own rows.
 *
 *   pnpm --filter @alma/api exec node --import tsx scripts/deputy-resync-timesheets.ts --days 60
 */
import { prisma } from '@alma/db';
import { deputyService } from '../src/services/deputy.service.js';

async function main() {
  const flag = process.argv.indexOf('--days');
  const days = Math.min(Math.max(Number(flag > -1 ? process.argv[flag + 1] : 45) || 45, 1), 120);

  const connection = await deputyService._internal.connectedDeputyConnection();
  const result = await deputyService._internal.syncTimesheets(connection, { lookbackDays: days });

  console.log(`Read ${result.rowsRead} Deputy timesheets over ${days} days: ${result.created} created, ${result.updated} updated.`);
  const reasons = result.skipped.reduce<Record<string, number>>((acc, row) => {
    acc[row.reason] = (acc[row.reason] ?? 0) + 1;
    return acc;
  }, {});
  for (const [reason, count] of Object.entries(reasons)) console.log(`  skipped ${count}: ${reason}`);

  const since = new Date(Date.now() - days * 86_400_000);
  const [withBreaks, leave] = await Promise.all([
    prisma.timesheet.count({ where: { workDate: { gte: since }, breakMinutes: { gt: 0 }, deputyTimesheetId: { not: null } } }),
    prisma.timesheet.count({ where: { workDate: { gte: since }, isLeave: true } })
  ]);
  console.log(`In the window now: ${withBreaks} Deputy timesheets carry a break, ${leave} are marked leave.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
