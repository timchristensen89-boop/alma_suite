/**
 * Production bootstrap seed.
 *
 * This is intentionally tiny and non-destructive. It only creates required
 * operational basics and, when env credentials are provided, one production
 * admin account. Do not add demo records here.
 */
import bcrypt from 'bcryptjs';
import type { AlmaAppId, StaffAppAccessStatus } from '@prisma/client';
import { prisma } from '../src/prisma.js';

type VenueInput = {
  name: string;
  slug?: string;
  address?: string | null;
  lga?: string | null;
};

const PROD_ADMIN_ACCESS: Array<{
  appId: AlmaAppId;
  status: StaffAppAccessStatus;
  role: string;
  notes: string;
}> = [
  { appId: 'COMPLIANCE', status: 'ENABLED', role: 'MANAGER', notes: 'Production admin access' },
  { appId: 'STOCK', status: 'ENABLED', role: 'MANAGER', notes: 'Production admin access' },
  { appId: 'STAFF', status: 'ENABLED', role: 'MANAGER', notes: 'Production admin access' },
  { appId: 'REPORTS', status: 'ENABLED', role: 'USER', notes: 'Production admin access' },
  { appId: 'TRAINING', status: 'ENABLED', role: 'USER', notes: 'Production admin access' },
  { appId: 'SETTINGS', status: 'ENABLED', role: 'ADMIN', notes: 'Production admin access' }
];

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseVenues(): VenueInput[] {
  const raw = process.env.ALMA_VENUES_JSON;

  if (!raw?.trim()) {
    return [
      { name: 'Alma Avalon', slug: 'alma-avalon' },
      { name: 'St Alma', slug: 'st-alma' }
    ];
  }

  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('ALMA_VENUES_JSON must be a JSON array.');
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`ALMA_VENUES_JSON[${index}] must be an object.`);
    }

    const venue = entry as Record<string, unknown>;
    const name = typeof venue.name === 'string' ? venue.name.trim() : '';

    if (!name) {
      throw new Error(`ALMA_VENUES_JSON[${index}].name is required.`);
    }

    return {
      name,
      slug: typeof venue.slug === 'string' && venue.slug.trim() ? venue.slug.trim() : slugify(name),
      address: typeof venue.address === 'string' ? venue.address.trim() : null,
      lga: typeof venue.lga === 'string' ? venue.lga.trim() : null
    };
  });
}

async function bootstrapVenues(venues: VenueInput[]) {
  for (const venue of venues) {
    await prisma.venue.upsert({
      where: { slug: venue.slug ?? slugify(venue.name) },
      update: {
        name: venue.name,
        address: venue.address ?? null,
        lga: venue.lga ?? null
      },
      create: {
        name: venue.name,
        slug: venue.slug ?? slugify(venue.name),
        address: venue.address ?? null,
        lga: venue.lga ?? null
      }
    });
  }
}

async function bootstrapSettings(venues: VenueInput[]) {
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {
      orgName: process.env.ALMA_ORG_NAME ?? 'Alma Group',
      primaryContactName: process.env.ALMA_PRIMARY_CONTACT_NAME || null,
      primaryContactEmail: process.env.ALMA_PRIMARY_CONTACT_EMAIL || null,
      primaryContactPhone: process.env.ALMA_PRIMARY_CONTACT_PHONE || null,
      venues
    },
    create: {
      id: 'singleton',
      orgName: process.env.ALMA_ORG_NAME ?? 'Alma Group',
      primaryContactName: process.env.ALMA_PRIMARY_CONTACT_NAME || null,
      primaryContactEmail: process.env.ALMA_PRIMARY_CONTACT_EMAIL || null,
      primaryContactPhone: process.env.ALMA_PRIMARY_CONTACT_PHONE || null,
      venues
    }
  });
}

async function bootstrapAdmin() {
  const email = process.env.PROD_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PROD_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('No production admin created. Set PROD_ADMIN_EMAIL and PROD_ADMIN_PASSWORD to create one.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const profile = await prisma.staffProfile.upsert({
    where: { email },
    update: {
      firstName: process.env.PROD_ADMIN_FIRST_NAME ?? 'Production',
      lastName: process.env.PROD_ADMIN_LAST_NAME ?? 'Admin',
      roleTitle: process.env.PROD_ADMIN_ROLE ?? 'Production Admin',
      employmentStatus: 'ACTIVE',
      isAdmin: true,
      passwordHash
    },
    create: {
      email,
      firstName: process.env.PROD_ADMIN_FIRST_NAME ?? 'Production',
      lastName: process.env.PROD_ADMIN_LAST_NAME ?? 'Admin',
      roleTitle: process.env.PROD_ADMIN_ROLE ?? 'Production Admin',
      employmentStatus: 'ACTIVE',
      isAdmin: true,
      passwordHash
    }
  });

  await prisma.$transaction(
    PROD_ADMIN_ACCESS.map((access) =>
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

  console.log(`Production admin ready: ${profile.email ?? email}`);
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Running production bootstrap outside NODE_ENV=production. No demo data will be created.');
  }

  const venues = parseVenues();
  await bootstrapVenues(venues);
  await bootstrapSettings(venues);
  await bootstrapAdmin();
  console.log(`Production bootstrap complete. Venues: ${venues.map((venue) => venue.name).join(', ')}`);
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
