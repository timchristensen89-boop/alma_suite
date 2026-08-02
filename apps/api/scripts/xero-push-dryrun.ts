/**
 * Dry-run the Xero timesheet push against whatever database this process is
 * pointed at, and print the per-employee outcome.
 *
 * Every lookup a real push does happens here — connection, scopes, payroll
 * calendars, individual employee records, earnings rates, period grouping —
 * and it stops before the POST. That makes it safe to run against production
 * when someone reports "it won't push" and the UI only shows one line.
 *
 *   node --import tsx scripts/xero-push-dryrun.ts 2026-07-20 2026-07-27
 */
import { integrationService } from '../src/services/integration.service.js';
import type { AuthUser } from '@alma/shared';

const [start, end, venue] = process.argv.slice(2);
if (!start || !end) {
  console.error('Usage: xero-push-dryrun.ts <start YYYY-MM-DD> <end YYYY-MM-DD>');
  process.exit(1);
}

const actor = { id: 'dry-run', role: 'ADMIN', isAdmin: true, venue: null } as unknown as AuthUser;

try {
  const result = await integrationService.pushTimesheetsToXero(actor, { start, end, venue, dryRun: true });
  console.log(`\nwould push: ${result.pushed}   failed: ${result.failed}   skipped: ${result.skipped}\n`);
  for (const row of result.results) {
    console.log(`  [${row.status.padEnd(7)}] ${row.employee.padEnd(24)} ${row.periodStart ?? '—'}..${row.periodEnd ?? '—'}  ${row.message}`);
  }
  if (result.warnings.length) console.log(`\nwarnings: ${result.warnings.join(' | ')}`);
} catch (error) {
  console.error('\nPUSH BLOCKED:', error instanceof Error ? error.message : error);
  if (error && typeof error === 'object' && 'status' in error) console.error('status:', (error as { status: unknown }).status);
}
process.exit(0);
