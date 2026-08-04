/**
 * Which Xero organisations the token can actually reach, versus the ones we
 * recorded at connect time.
 *
 * Read-only. Employees are fetched per *recorded* tenant, so an organisation
 * added to the Xero connection after we stored that list is invisible — its
 * staff look "not in Xero" when they are simply in an org we never ask about.
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
  const actor = { ...admin, isAdmin: true, role: 'ADMIN' } as unknown as AuthUser;

  const connection = await prisma.integrationConnection.findFirst({
    where: { provider: 'XERO', status: 'CONNECTED' }
  });
  const meta = (connection?.metadata ?? {}) as Record<string, unknown>;
  const recorded = Array.isArray(meta.xeroTenants) ? (meta.xeroTenants as Array<Record<string, unknown>>) : [];
  console.log(`Recorded at connect time: ${recorded.length} organisation(s)`);
  for (const tenant of recorded) console.log(`   ${String(tenant.name)}  ${String(tenant.id)}`);

  // Goes through the service so the access token is refreshed if it has expired.
  const health = await integrationService.checkXeroHealth(actor);
  console.log(`\nXero health: token ${health.tokenStatus}, tenants ${health.tenantStatus}, count ${health.tenantCount ?? 'unknown'}`);
  if (health.message) console.log(`   ${health.message}`);

  if (typeof health.tenantCount === 'number' && health.tenantCount > recorded.length) {
    console.log(
      `\n>>> Xero authorises ${health.tenantCount} organisation(s) but only ${recorded.length} are recorded.` +
        ' Staff in the unrecorded one(s) will never be found. Reconnect Xero to pick them up.'
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
