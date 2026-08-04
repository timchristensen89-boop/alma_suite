/**
 * Creates or updates a READ-ONLY viewer login (e.g. an external administrator
 * or accountant who needs to see Reports but must never change anything).
 *
 * The account gets admin-level READ scope (org-wide, both venues) but every
 * enabled app access carries permissions.readOnly, which the API middleware
 * enforces as a global write block (see auth-middleware isReadOnlyAccount).
 *
 * Idempotent — safe to re-run. Required env: VIEWER_EMAIL, VIEWER_PASSWORD.
 * Optional: VIEWER_FIRST_NAME / VIEWER_LAST_NAME / VIEWER_ROLE_TITLE.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';

async function main() {
  const email = (process.env.VIEWER_EMAIL ?? '').toLowerCase().trim();
  const password = process.env.VIEWER_PASSWORD ?? '';
  const firstName = process.env.VIEWER_FIRST_NAME ?? 'Viewer';
  const lastName = process.env.VIEWER_LAST_NAME ?? '';
  const roleTitle = process.env.VIEWER_ROLE_TITLE ?? 'Read-only viewer';

  if (!email || !password) {
    throw new Error('VIEWER_EMAIL and VIEWER_PASSWORD are required.');
  }
  if (password.length < 12) {
    throw new Error('VIEWER_PASSWORD must be at least 12 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const profile = await prisma.staffProfile.upsert({
    where: { email },
    update: {
      passwordHash,
      isAdmin: true,
      firstName,
      lastName,
      roleTitle,
      venue: null,
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

  // A single ENABLED access carrying readOnly makes the whole account
  // read-only (the middleware requires EVERY enabled access to carry it, so
  // don't add further accesses to this profile without the flag).
  await prisma.staffAppAccess.upsert({
    where: { staffProfileId_appId: { staffProfileId: profile.id, appId: 'REPORTS' } },
    update: { status: 'ENABLED', role: 'VIEWER', permissions: { readOnly: true }, notes: 'Read-only viewer login' },
    create: {
      staffProfileId: profile.id,
      appId: 'REPORTS',
      status: 'ENABLED',
      role: 'VIEWER',
      permissions: { readOnly: true },
      notes: 'Read-only viewer login'
    }
  });

  console.log(`Read-only viewer ready: ${email} (staffProfileId ${profile.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
