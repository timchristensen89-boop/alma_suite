/**
 * The accounts the Menus browser suites sign in with, on a DISPOSABLE
 * database only. Refuses to run against anything that does not look local.
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:5433/alma_e2e \
 *     node --import tsx scripts/seed-e2e-accounts.ts
 *
 * Creates (idempotently) five staff accounts sharing one password, covering
 * every way a person can or cannot publish a menu (canPublishMenus):
 *
 *   itest-admin@example.test      admin                       publishes
 *   itest-manager@example.test    MENUS at MANAGER            publishes
 *   itest-headchef@example.test   role title "Head Chef"      publishes
 *   itest-sous@example.test       MENUS at USER + Publish menus toggle   publishes
 *   itest-chef@example.test       MENUS at USER               drafts only
 *
 * Password: the E2E_PASSWORD env, default "Itest!2026".
 */
import bcrypt from 'bcryptjs';
import { prisma } from '@alma/db';

const url = process.env.DATABASE_URL ?? '';
if (process.env.NODE_ENV === 'production' || !/@(127\.0\.0\.1|localhost|postgres)(:\d+)?\//.test(url)) {
  console.error('seed-e2e-accounts: refusing — DATABASE_URL must point at a local, disposable database.');
  process.exit(1);
}

const PASSWORD = process.env.E2E_PASSWORD ?? 'Itest!2026';

type Account = {
  email: string;
  firstName: string;
  lastName: string;
  roleTitle: string;
  isAdmin: boolean;
  menus: { role: 'MANAGER' | 'USER'; permissions?: Record<string, unknown> } | null;
};

const ACCOUNTS: Account[] = [
  { email: 'itest-admin@example.test', firstName: 'Itest', lastName: 'Admin', roleTitle: 'Owner', isAdmin: true, menus: { role: 'MANAGER' } },
  { email: 'itest-manager@example.test', firstName: 'Itest', lastName: 'Manager', roleTitle: 'Venue Manager', isAdmin: false, menus: { role: 'MANAGER' } },
  { email: 'itest-headchef@example.test', firstName: 'Itest', lastName: 'Headchef', roleTitle: 'Head Chef', isAdmin: false, menus: { role: 'USER' } },
  { email: 'itest-sous@example.test', firstName: 'Itest', lastName: 'Sous', roleTitle: 'Sous Chef', isAdmin: false, menus: { role: 'USER', permissions: { menusPublish: true } } },
  { email: 'itest-chef@example.test', firstName: 'Itest', lastName: 'Chef', roleTitle: 'Chef de Partie', isAdmin: false, menus: { role: 'USER' } }
];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const account of ACCOUNTS) {
    const profile = await prisma.staffProfile.upsert({
      where: { email: account.email },
      update: { passwordHash, isAdmin: account.isAdmin, firstName: account.firstName, lastName: account.lastName, roleTitle: account.roleTitle, employmentStatus: 'ACTIVE' },
      create: { email: account.email, firstName: account.firstName, lastName: account.lastName, roleTitle: account.roleTitle, employmentStatus: 'ACTIVE', isAdmin: account.isAdmin, passwordHash }
    });
    if (account.menus) {
      await prisma.staffAppAccess.upsert({
        where: { staffProfileId_appId: { staffProfileId: profile.id, appId: 'MENUS' } },
        update: { status: 'ENABLED', role: account.menus.role, permissions: account.menus.permissions ?? {} },
        create: { staffProfileId: profile.id, appId: 'MENUS', status: 'ENABLED', role: account.menus.role, permissions: account.menus.permissions ?? {}, notes: 'Browser-suite account' }
      });
    }
    console.log(`${account.email.padEnd(32)} ${account.isAdmin ? 'admin' : account.roleTitle.padEnd(16)} MENUS ${account.menus?.role ?? '—'}${account.menus?.permissions?.menusPublish ? ' + Publish menus' : ''}`);
  }
  console.log(`password: ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
