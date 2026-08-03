/**
 * Dry-run the Xero timesheet push over everything approved and not yet sent.
 *
 * Read-only: pushTimesheetsToXero does every lookup and builds the real payload
 * but stops before writing when dryRun is set, which is the only way to see
 * which employees would fail without leaving drafts in Xero for someone to
 * delete afterwards.
 *
 *   docker compose exec -T suite-api sh -c \
 *     'cd /workspace/apps/api && node --import tsx scripts/dry-run-xero-timesheets.ts'
 */
import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { integrationService } from '../src/services/integration.service.js';

async function main() {
  const admin = await prisma.staffProfile.findFirst({
    where: { isAdmin: true, employmentStatus: 'ACTIVE' },
    include: { appAccess: { select: { appId: true, status: true, role: true, permissions: true } } }
  });
  if (!admin) throw new Error('No active admin profile to run as.');

  const actor = {
    id: admin.id,
    firstName: admin.firstName,
    lastName: admin.lastName,
    email: admin.email,
    roleTitle: admin.roleTitle,
    venue: admin.venue,
    accountType: admin.accountType,
    isAdmin: true,
    role: 'ADMIN',
    appAccess: admin.appAccess
  } as unknown as AuthUser;

  const range = await prisma.timesheet.aggregate({
    where: { status: 'APPROVED' },
    _min: { workDate: true },
    _max: { workDate: true },
    _count: true
  });
  if (!range._min.workDate || !range._max.workDate) {
    console.log('Nothing approved.');
    return;
  }

  const start = range._min.workDate.toISOString().slice(0, 10);
  const end = range._max.workDate.toISOString().slice(0, 10);
  console.log(`${range._count} approved timesheets, ${start} to ${end}`);
  console.log('Running a DRY RUN — nothing is written to Xero.\n');

  const result = await integrationService.pushTimesheetsToXero(actor, { start, end, dryRun: true });

  const byStatus = new Map<string, number>();
  for (const row of result.results ?? []) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  }
  console.log('Outcome by status:');
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(10)} ${count}`);
  }

  const failures = (result.results ?? []).filter((row) => row.status !== 'pushed');
  if (failures.length > 0) {
    console.log('\nWould fail:');
    for (const row of failures.slice(0, 25)) {
      console.log(`  ${String(row.employee).padEnd(28)} ${row.message}`);
    }
    if (failures.length > 25) console.log(`  …and ${failures.length - 25} more`);
  }

  const ok = (result.results ?? []).filter((row) => row.status === 'pushed');
  const hours = ok.reduce((sum, row) => sum + (row.hours ?? 0), 0);
  console.log(`\nWould send ${ok.length} timesheet(s), ${hours.toFixed(2)} hours in total.`);
  if (ok.length > 0) {
    console.log('\nFirst few:');
    for (const row of ok.slice(0, 8)) {
      console.log(`  ${String(row.employee).padEnd(28)} ${row.periodStart} → ${row.periodEnd}  ${row.message}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
