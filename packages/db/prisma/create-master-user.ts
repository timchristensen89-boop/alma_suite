/**
 * Creates or updates a master (admin) user so there is a known login for the
 * Alma Suite instance. Idempotent — safe to re-run. Values can be overridden
 * via environment variables (MASTER_USER_EMAIL / MASTER_USER_PASSWORD /
 * MASTER_USER_FIRST_NAME / MASTER_USER_LAST_NAME).
 */
import bcrypt from 'bcryptjs';
import type { AlmaAppId, StaffAppAccessStatus } from '@prisma/client';
import { prisma } from '../src/prisma.js';

const MASTER_APP_ACCESS: Array<{
  appId: AlmaAppId;
  status: StaffAppAccessStatus;
  role: string;
  notes: string;
}> = [
  { appId: 'COMPLIANCE', status: 'ENABLED', role: 'MANAGER', notes: 'Master admin access' },
  { appId: 'STOCK', status: 'ENABLED', role: 'MANAGER', notes: 'Master admin access' },
  { appId: 'STAFF', status: 'ENABLED', role: 'MANAGER', notes: 'Master admin access' },
  { appId: 'REPORTS', status: 'ENABLED', role: 'USER', notes: 'Master admin access' },
  { appId: 'SETTINGS', status: 'ENABLED', role: 'ADMIN', notes: 'Master admin access' }
];

async function main() {
  const email = (process.env.MASTER_USER_EMAIL ?? 'tim@almagroup.com.au').toLowerCase();
  const password = process.env.MASTER_USER_PASSWORD ?? 'Tim@lma2017';
  const firstName = process.env.MASTER_USER_FIRST_NAME ?? 'Tim';
  const lastName = process.env.MASTER_USER_LAST_NAME ?? 'Christensen';
  const roleTitle = process.env.MASTER_USER_ROLE ?? 'Owner / Master Admin';

  const passwordHash = await bcrypt.hash(password, 10);

  const profile = await prisma.staffProfile.upsert({
    where: { email },
    update: {
      passwordHash,
      isAdmin: true,
      firstName,
      lastName,
      roleTitle,
      employmentStatus: 'ACTIVE'
    },
    create: {
      email,
      firstName,
      lastName,
      roleTitle,
      employmentStatus: 'ACTIVE',
      isAdmin: true,
      passwordHash
    }
  });

  await prisma.$transaction(
    MASTER_APP_ACCESS.map((access) =>
      prisma.staffAppAccess.upsert({
        where: {
          staffProfileId_appId: {
            staffProfileId: profile.id,
            appId: access.appId
          }
        },
        update: {
          status: access.status,
          role: access.role,
          notes: access.notes
        },
        create: {
          staffProfileId: profile.id,
          appId: access.appId,
          status: access.status,
          role: access.role,
          notes: access.notes
        }
      })
    )
  );

  console.log(`Master user ready: ${profile.email} (id=${profile.id})`);
  console.log(`  Password: ${password}`);
  console.log('  isAdmin:  true');
  console.log(`  appAccess: ${MASTER_APP_ACCESS.map((access) => access.appId).join(', ')}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
