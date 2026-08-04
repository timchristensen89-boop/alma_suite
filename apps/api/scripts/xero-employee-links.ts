/**
 * Which staff the Xero timesheet push cannot send, and what they could link to.
 *
 * Read-only. The push names seven people it would skip because no Xero employee
 * is attached to their profile; this asks Xero who it has, so the links can be
 * made deliberately rather than by hunting through two systems.
 *
 *   docker compose cp <this> suite-api:/workspace/apps/api/scripts/ && \
 *   docker compose exec -T suite-api sh -c \
 *     'cd /workspace/apps/api && node --import tsx scripts/xero-employee-links.ts'
 */
import { prisma } from '@alma/db';
import { integrationService } from '../src/services/integration.service.js';

function nameKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

async function main() {
  // Staff with approved hours but no Xero link — exactly who the push skips.
  const unlinked = await prisma.staffProfile.findMany({
    where: {
      xeroEmployeeId: null,
      mergedIntoStaffProfileId: null,
      timesheets: { some: { status: 'APPROVED' } }
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      venue: true,
      employmentStatus: true,
      _count: { select: { timesheets: { where: { status: 'APPROVED' } } } }
    },
    orderBy: [{ firstName: 'asc' }]
  });

  console.log(`${unlinked.length} staff with approved hours and no Xero employee linked\n`);

  const payload = await integrationService.listXeroEmployees();
  const employees = payload.employees;
  console.log(`Xero reports ${employees.length} employee(s) across the connected tenants.\n`);

  const byName = new Map<string, typeof employees>();
  for (const employee of employees) {
    const key = nameKey(`${employee.firstName ?? ''}${employee.lastName ?? ''}`);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), employee]);
  }
  const byEmail = new Map<string, (typeof employees)[number]>();
  for (const employee of employees) {
    const email = (employee.email ?? '').toLowerCase();
    if (email) byEmail.set(email, employee);
  }

  for (const staff of unlinked) {
    const full = `${staff.firstName} ${staff.lastName}`.trim();
    const key = nameKey(full);
    const exact = byName.get(key) ?? [];
    const viaEmail = staff.email ? byEmail.get(staff.email.toLowerCase()) : undefined;
    // Anyone sharing a first name or a surname, for the cases where the two
    // systems disagree about which is which.
    const loose = employees.filter((employee) => {
      const first = nameKey(employee.firstName);
      const last = nameKey(employee.lastName);
      const parts = [nameKey(staff.firstName), nameKey(staff.lastName)].filter(Boolean);
      return parts.some((part) => part && (first === part || last === part));
    });

    console.log(`${full}  (${staff.employmentStatus}, ${staff.venue ?? 'no venue'}, ${staff._count.timesheets} approved)`);
    if (viaEmail) {
      console.log(`   email match: ${viaEmail.firstName} ${viaEmail.lastName} <${viaEmail.email}>  ${viaEmail.tenantName ?? ''}  ${viaEmail.xeroEmployeeId}`);
    } else if (exact.length > 0) {
      for (const employee of exact) {
        console.log(`   exact name: ${employee.firstName} ${employee.lastName}  ${employee.status}  ${employee.tenantName ?? ''}  ${employee.xeroEmployeeId}`);
      }
    } else if (loose.length > 0) {
      for (const employee of loose.slice(0, 4)) {
        console.log(`   possible:   ${employee.firstName} ${employee.lastName}  ${employee.status}  ${employee.tenantName ?? ''}  ${employee.xeroEmployeeId}`);
      }
    } else {
      console.log('   nothing in Xero resembles this name — they may not be set up in payroll at all.');
    }
    console.log('');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
