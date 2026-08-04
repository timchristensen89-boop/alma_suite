/**
 * Dry-run the Xero pay rate sync and print what it would change.
 *
 * Reads every connected Xero organisation, matches employees to Alma profiles,
 * pulls each one's ordinary earnings rate off their pay template, and writes
 * nothing. Use it to answer "why didn't so-and-so's rate come across".
 *
 *   node --import tsx scripts/xero-payrates-dryrun.ts
 */
import { integrationService } from '../src/services/integration.service.js';
import type { AuthUser } from '@alma/shared';

const actor = { id: 'dry-run', role: 'ADMIN', isAdmin: true, venue: null } as unknown as AuthUser;

try {
  const result = await integrationService.syncXeroPayRates(actor, { dryRun: true });
  for (const tenant of result.tenants ?? []) {
    console.log(`org ${tenant.tenantName ?? tenant.tenantId}: ${tenant.employees} active employees${tenant.error ? `  ERROR: ${tenant.error}` : ''}`);
  }
  console.log(`\nwould update: ${result.synced}   skipped: ${result.skipped}   unmatched: ${result.notMatched}\n`);
  for (const row of result.updated) {
    const was = row.previousPayRateCents === null ? 'unset' : `$${(row.previousPayRateCents / 100).toFixed(2)}`;
    console.log(`  [rate ] ${`${row.firstName} ${row.lastName}`.padEnd(24)} ${was} -> $${(row.newPayRateCents / 100).toFixed(2)}`);
  }
  for (const row of result.skippedDetail ?? []) {
    console.log(`  [skip ] ${row.name.padEnd(24)} ${row.reason}`);
  }
  for (const row of result.unmatched) {
    console.log(`  [nolink] ${`${row.firstName} ${row.lastName}`.padEnd(23)} in Xero (${row.xeroEmployeeId}), no Alma profile matched`);
  }
} catch (error) {
  console.error('\nSYNC BLOCKED:', error instanceof Error ? error.message : error);
}
process.exit(0);
