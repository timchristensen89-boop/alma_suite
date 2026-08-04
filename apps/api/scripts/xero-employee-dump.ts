/**
 * Everything Xero reports, per tenant, with who it is already linked to.
 *
 * Read-only. The link report matched on name and found six staff with no
 * counterpart; if they are in Xero after all, the answer is in here — a
 * different spelling, a legal name, or a tenant whose employees are not coming
 * back at all.
 */
import { prisma } from '@alma/db';
import { integrationService } from '../src/services/integration.service.js';

async function main() {
  const payload = await integrationService.listXeroEmployees();

  const byTenant = new Map<string, typeof payload.employees>();
  for (const employee of payload.employees) {
    const key = employee.tenantName ?? employee.tenantId;
    byTenant.set(key, [...(byTenant.get(key) ?? []), employee]);
  }

  console.log(`${payload.employees.length} employee(s) across ${byTenant.size} tenant(s)\n`);
  for (const [tenant, employees] of byTenant) {
    console.log(`── ${tenant} (${employees.length})`);
    for (const employee of [...employees].sort((a, b) => a.firstName.localeCompare(b.firstName))) {
      const linked = employee.linkedStaffName ? `→ ${employee.linkedStaffName}` : 'NOT LINKED';
      console.log(
        `   ${`${employee.firstName} ${employee.lastName}`.padEnd(28)} ${employee.status.padEnd(10)} ${linked}`
      );
    }
    console.log('');
  }

  const unlinkedInXero = payload.employees.filter((employee) => !employee.linkedStaffId);
  console.log(`${unlinkedInXero.length} Xero employee(s) not linked to any staff profile:`);
  for (const employee of unlinkedInXero) {
    console.log(
      `   ${`${employee.firstName} ${employee.lastName}`.padEnd(28)} ${employee.status.padEnd(10)} ${employee.tenantName ?? ''}  ${employee.xeroEmployeeId}`
    );
  }

  const needsLink = await prisma.staffProfile.findMany({
    where: {
      xeroEmployeeId: null,
      mergedIntoStaffProfileId: null,
      timesheets: { some: { status: 'APPROVED' } }
    },
    select: { firstName: true, lastName: true, email: true, employmentStatus: true }
  });
  console.log(`\n${needsLink.length} staff profile(s) with approved hours and no link:`);
  for (const staff of needsLink) {
    console.log(
      `   ${`${staff.firstName} ${staff.lastName}`.padEnd(28)} ${staff.employmentStatus.padEnd(11)} ${staff.email ?? 'no email'}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
