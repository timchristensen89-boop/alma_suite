/**
 * Merge the two duplicate staff profiles that split a person's Xero link from
 * their hours.
 *
 *   Enzo Funada Yamashita → Enzo Yamashita
 *   Aja                   → Aja Verdouw
 *
 * The merge itself moves compliance records, app access, training and the pay
 * profile, and deliberately leaves roster/timesheet history on the archived
 * duplicate for audit. It does not carry the Xero employee link, and it refuses
 * an archived canonical — which matters for Aja, where the link sits on the
 * archived half. So the link is moved explicitly where the survivor has none.
 */
import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { staffService } from '../src/services/staff.service.js';

const PAIRS = [
  { canonical: 'Enzo Yamashita', duplicate: 'Enzo Funada Yamashita' },
  { canonical: 'Aja Verdouw', duplicate: 'Aja' }
];

async function findByName(full: string) {
  const [firstName, ...rest] = full.split(' ');
  const lastName = rest.join(' ');
  const rows = await prisma.staffProfile.findMany({
    where: { firstName, lastName, accountType: 'HUMAN', mergedIntoStaffProfileId: null },
    select: { id: true, firstName: true, lastName: true, employmentStatus: true, xeroEmployeeId: true }
  });
  if (rows.length !== 1) throw new Error(`Expected exactly one "${full}", found ${rows.length}`);
  return rows[0]!;
}

async function main() {
  const admin = await prisma.staffProfile.findFirst({
    where: { isAdmin: true, employmentStatus: 'ACTIVE' },
    include: { appAccess: { select: { appId: true, status: true, role: true, permissions: true } } }
  });
  if (!admin) throw new Error('No active admin to act as.');
  const actor = { ...admin, isAdmin: true, role: 'ADMIN' } as unknown as AuthUser;

  for (const pair of PAIRS) {
    const canonical = await findByName(pair.canonical);
    const duplicate = await findByName(pair.duplicate);
    console.log(`\n${pair.duplicate} → ${pair.canonical}`);
    console.log(`   survivor  ${canonical.employmentStatus.padEnd(11)} xero=${canonical.xeroEmployeeId ?? 'none'}`);
    console.log(`   duplicate ${duplicate.employmentStatus.padEnd(11)} xero=${duplicate.xeroEmployeeId ?? 'none'}`);

    const result = await staffService.mergeDuplicateStaff(
      { canonicalStaffProfileId: canonical.id, duplicateStaffProfileIds: [duplicate.id], confirmation: 'MERGE STAFF' },
      actor
    );
    console.log(`   merged: ${JSON.stringify(result.moved ?? result)}`);

    // Carry the Xero link when only the archived half had it.
    if (!canonical.xeroEmployeeId && duplicate.xeroEmployeeId) {
      await prisma.staffProfile.update({
        where: { id: canonical.id },
        data: { xeroEmployeeId: duplicate.xeroEmployeeId }
      });
      console.log(`   moved the Xero link onto ${pair.canonical}`);
    }
  }

  const left = await prisma.staffProfile.count({
    where: { xeroEmployeeId: null, mergedIntoStaffProfileId: null, timesheets: { some: { status: 'APPROVED' } } }
  });
  console.log(`\n${left} staff profile(s) still have approved hours and no Xero link.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
